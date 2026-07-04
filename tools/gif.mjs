// 6秒GIF自動撮影: 連鎖花火シナリオをCDPスクリーンキャストで録画→盤面クロップ→GIF化
// usage: node tools/gif.mjs [scenario] [seed]   … 既定: chainhero 42
// 出力: tmp/gif-<scenario>.gif(幅640、~12.5fps)
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import gifenc from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifenc;

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = 8396;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript" };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/") p = "/index.html";
  try {
    const data = await readFile(path.join(ROOT, p));
    res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream" });
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
}).listen(PORT);

// 理想の6秒構成(Codex処方): 0-1.2s 溜め(意図表示・機雷の脈動) → 連鎖カスケード → 残光
const SCENARIOS = {
  chainhero: {
    lead: 1200, total: 6000, script: `
    H.begin(); H.pickShip("vagrants"); H.confirmLoad(); H.dismissHints();
    const S=lkDebug().S;
    S.enc.units=S.enc.units.filter(u=>u.side==="player"||u.side==="enemy");
    const mk=(id,x,y)=>S.enc.units.push({id,side:"hazard",type:"mine",name:"係留機雷",icon:"☄️",x,y,hp:1,maxHp:1,dmg:2,drift:null,shield:0,alive:true});
    mk("m1",2,2); mk("m2",3,2); mk("m3",4,2); mk("m4",3,3);
    const es=LK.enemies(S.enc);
    es[0].x=1; es[0].y=2; es[0].hp=1; es[0].drift="right";      // 滑り込んで起爆
    if(es[1]){ es[1].x=4; es[1].y=3; es[1].hp=2; es[1].drift=null; } // 連鎖の爆風で散る(下段=上部カウンタと重ならない)
    for(const p of LK.players(S.enc)) p.drift=null;
    LK.cardsIn(S,"hand")[0].loc="discard";
    S.enc.step="drift"; S.enc.phase=null; render();`,
    trigger: `
      // GIF専用(状態は無改変): ①salvageReadyを先に立てて800ms後の再render(=fx全滅)を封じる ②モーダルはCSSで隠す
      const st=document.createElement("style"); st.textContent="#app #overlay{display:none!important}"; document.head.appendChild(st);
      lkDebug().UI.salvageReady=true;
      const S=lkDebug().S; LK.driftPhase(S); render();`,
  },
};

const name = process.argv[2] || "chainhero";
const seed = process.argv[3] || "42";
const sc = SCENARIOS[name];
if (!sc) { console.error("unknown scenario:", Object.keys(SCENARIOS).join(", ")); process.exit(1); }

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 920 } });
page.on("pageerror", e => console.error("pageerror:", e.message));
await page.goto(`http://localhost:${PORT}/index.html?seed=${seed}`, { waitUntil: "load" });
await page.evaluate(() => localStorage.removeItem("lok_meta_v1"));
await page.evaluate(sc.script);
await page.waitForTimeout(300);
const box = await page.locator("#board").boundingBox();
if (!box) { console.error("board not found"); process.exit(1); }

// スクリーンキャスト収集
const frames = []; // {ts, buf}
const cdp = await page.context().newCDPSession(page);
cdp.on("Page.screencastFrame", async ev => {
  frames.push({ ts: ev.metadata.timestamp, buf: Buffer.from(ev.data, "base64") });
  try { await cdp.send("Page.screencastFrameAck", { sessionId: ev.sessionId }); } catch {}
});
await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });

const t0 = Date.now();
await page.waitForTimeout(sc.lead);          // 溜め(意図・脈動を見せる)
await page.evaluate(sc.trigger);             // カスケード開始
await page.waitForTimeout(sc.total - (Date.now() - t0));
await cdp.send("Page.stopScreencast");
await page.waitForTimeout(200);
console.log(`captured ${frames.length} frames`);
if (frames.length < 10) { console.error("too few frames"); process.exit(1); }

// 80ms(12.5fps)へリサンプル: 各tickに最も近い直前フレームを採用
const STEP = 0.08;
const start = frames[0].ts, end = frames[frames.length - 1].ts;
const picked = [];
for (let t = start; t <= end; t += STEP) {
  let best = frames[0];
  for (const f of frames) { if (f.ts <= t) best = f; else break; }
  picked.push(best);
}
console.log(`resampled to ${picked.length} frames @80ms`);

// 盤面クロップ→幅640→GIF
const OUT_W = 640;
const gif = GIFEncoder();
let outH = 0;
for (const f of picked) {
  const { data, info } = await sharp(f.buf)
    .extract({ left: Math.round(box.x), top: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) })
    .resize({ width: OUT_W })
    .raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  outH = info.height;
  const rgba = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const palette = quantize(rgba, 256);
  const index = applyPalette(rgba, palette);
  gif.writeFrame(index, info.width, info.height, { palette, delay: 80 });
}
gif.finish();
const out = path.join(ROOT, "tmp", `gif-${name}.gif`);
await writeFile(out, gif.bytes());
console.log(`ok: tmp/gif-${name}.gif (${OUT_W}x${outH}, ${picked.length}f, ${(gif.bytes().length / 1024 / 1024).toFixed(2)}MB)`);
await browser.close();
server.close();
