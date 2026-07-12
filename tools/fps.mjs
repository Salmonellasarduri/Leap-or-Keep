// Phase 2 品質ゲート: ホロ盤面のフレームタイム計測(R25)
// 中級スマホ近似 = CPUスロットル4x + モバイルviewport(390x844) + DPR3(実装側で1.5にキャップされることも確認)
// 合否: ドリフトビート中のフレームタイム p95 ≤ 17.5ms(60Hz vsyncの16.67±計測ジッタを許容)
//       かつ 33ms超のヒッチ ≤ 4回(renderBattleのinnerHTML全再構築+fxパイプライン由来の既知ヒッチ枠。
//       2026-07-12実測: 同条件のDOM版ベースライン=p95 33.4ms/ヒッチ7回 — holo版の方が軽い)
// usage: node tools/fps.mjs [--desktop] [--headless]
//   既定はヘッドあり(ヘッドレスはSwiftShaderでGPU計測にならない — 参考値のみ)
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = 8414;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript" };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/") p = "/index.html";
  try { const body = await readFile(path.join(ROOT, p)); res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(PORT);

const desktop = process.argv.includes("--desktop");
const headless = process.argv.includes("--headless");
const noholo = process.argv.includes("--noholo"); // DOM版ベースライン計測(ヒッチの帰属切り分け用)
if (headless) console.warn("warn: headless=SwiftShaderレンダ — fps数値は実GPUと無関係(参考値)");

const browser = await chromium.launch({ headless });
const page = await browser.newPage(desktop
  ? { viewport: { width: 1280, height: 920 } }
  : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const cdp = await page.context().newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: desktop ? 1 : 4 });

page.on("pageerror", e => console.error("pageerror:", e.message));
await page.goto(`http://localhost:${PORT}/index.html?seed=42`, { waitUntil: "load" });
await page.waitForFunction(() => window.__holoReady || window.__holoFailed);

const result = await page.evaluate(async (noholo) => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  localStorage.removeItem("lok_meta_v1");
  H.begin(); H.pickShip("vagrants"); H.confirmLoad(); H.dismissHints();
  if (noholo) { lkDebug().META.holo = false; render(); }
  else if (!window.__holoReady) return { error: "holo not ready (fallback env?)" };
  await sleep(600);

  const dpr = (() => { const c = document.getElementById("holo-canvas"); return c ? (c.width / c.clientWidth).toFixed(2) : null; })();

  function measure(ms) {
    return new Promise(res => {
      const deltas = []; let last = 0; const t0 = performance.now();
      const f = t => {
        if (last) deltas.push(t - last);
        last = t;
        if (t - t0 < ms) requestAnimationFrame(f); else res(deltas);
      };
      requestAnimationFrame(f);
    });
  }
  const stat = d => {
    const hitches = d.filter(x => x > 33).length;
    d.sort((a, b) => a - b);
    const p = q => d[Math.min(d.length - 1, Math.floor(d.length * q))];
    return { frames: d.length, avg: +(d.reduce((s, x) => s + x, 0) / d.length).toFixed(2), p50: +p(.5).toFixed(2), p95: +p(.95).toFixed(2), max: +d[d.length - 1].toFixed(2), hitches };
  };

  // 1) アイドル(ボブ・ちらつき・パルス動作中)
  const idle = stat(await measure(2500));

  // 2) ドリフトビート+機雷連鎖(最重量シーン): gif.mjs chainheroと同処方
  const S = lkDebug().S;
  S.enc.units = S.enc.units.filter(u => u.side === "player" || u.side === "enemy");
  const mk = (id, x, y) => S.enc.units.push({ id, side: "hazard", type: "mine", name: "係留機雷", icon: "☄️", x, y, hp: 1, maxHp: 1, dmg: 2, drift: null, shield: 0, alive: true });
  mk("m1", 2, 2); mk("m2", 3, 2); mk("m3", 4, 2); mk("m4", 3, 3);
  const es = LK.enemies(S.enc);
  es[0].x = 1; es[0].y = 2; es[0].hp = 1; es[0].drift = "right";
  for (const p of LK.players(S.enc)) p.drift = null;
  S.enc.step = "drift"; S.enc.phase = null; render();
  await sleep(300);
  const mp = measure(1600);
  lkDebug().UI.salvageReady = true;
  LK.driftPhase(S); render();
  const beat = stat(await mp);

  return { dpr, idle, beat, pass: beat.p95 <= 17.5 && beat.hitches <= 4 };
}, noholo);

console.log(JSON.stringify({ mode: (desktop ? "desktop(throttle1x)" : "mobile390x844(throttle4x,DPR3)") + (noholo ? " [DOM baseline]" : ""), headless, ...result }, null, 1));
await browser.close(); server.close();
process.exit(result && result.pass === false ? 1 : 0);
