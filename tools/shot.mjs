// 自前スクリーンショット/視覚検証ハーネス(Playwright)
// MCPプレビューのscreenshot不調(L-005)を恒久回避し、自走時の視覚検証を自立させる。
// usage:
//   node tools/shot.mjs <scenario> [seed]
//   node tools/shot.mjs all            … 全シナリオ撮影
// 出力: tmp/shot-<scenario>.png
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
mkdirSync(path.join(ROOT, "tmp"), { recursive: true });
const PORT = 8399;

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/") p = "/index.html";
  try {
    const data = await readFile(path.join(ROOT, p));
    res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream" });
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
}).listen(PORT);

// 各シナリオ: ページ内で実行する準備スクリプト(H/LK/lkDebugが使える)
const SCENARIOS = {
  title: `/* タイトルのまま */`,
  shipselect: `H.begin();`,
  battle: `
    H.begin(); H.pickShip("vagrants"); H.confirmLoad(); H.dismissHints();
    const S=lkDebug().S; const hand=LK.cardsIn(S,"hand");
    H.halfClick(hand[0].uid,"top"); H.halfClick(hand[1].uid,"bottom");`,
  "battle-flat": `
    lkDebug().META.tilt=false;
    H.begin(); H.pickShip("vagrants"); H.confirmLoad(); H.dismissHints();`,
  rest: `
    H.begin(); H.pickShip("vagrants"); H.confirmLoad(); H.dismissHints();
    const S=lkDebug().S;
    for(const c of LK.cardsIn(S,"hand")) c.loc="discard";
    S.enc.step="upkeep"; LK.pump(S); render();`,
  leapkeep: `
    H.begin(); H.pickShip("vagrants"); H.confirmLoad(); H.dismissHints();
    const S=lkDebug().S;
    S.run.cargo=["starmap","nano"]; S.run.relicsSeen=["starmap","nano"];
    S.screen="leapkeep"; render();`,
  summary: `
    H.begin(); H.pickShip("vagrants"); H.confirmLoad(); H.dismissHints();
    const S=lkDebug().S;
    S.run.cargo=["starmap"]; S.run.relicsSeen=["starmap"]; S.run.zone=3; S.run.physKills=4;
    LK.doKeep(S); render();`,
  hangar: `lkDebug().META.credits=25; H.hangar();`,
  relic: `
    H.begin(); H.pickShip("vagrants"); H.confirmLoad(); H.dismissHints();
    const S=lkDebug().S;
    S.run.encIdx=1; S.run.route="danger";
    S.pendingRelic=LK.RELIC_DEFS.find(r=>r.id==="fusion");
    S.screen="relic"; render();`,
  // 物理キルの瞬間(盤面クローズアップ): 1HP敵を機雷へドリフト衝突→誘爆→スタンプ
  physkill: { clip: "#board", delay: 250, script: `
    H.begin(); H.pickShip("vagrants"); H.confirmLoad(); H.dismissHints();
    const S=lkDebug().S;
    S.enc.units=S.enc.units.filter(u=>u.side==="player"||u.side==="enemy");
    const e=LK.enemies(S.enc)[0];
    S.enc.units.push({id:"hm",side:"hazard",type:"mine",name:"係留機雷",icon:"☄️",x:2,y:2,hp:1,maxHp:1,dmg:2,drift:null,shield:0,alive:true});
    e.x=1; e.y=2; e.hp=1; e.drift="right";
    for(const p of LK.players(S.enc)) p.drift=null;
    LK.cardsIn(S,"hand")[0].loc="discard";
    S.enc.step="drift"; S.enc.phase=null;
    LK.driftPhase(S); render();` },
  "boss-warning": `
    H.begin(); H.pickShip("vagrants"); H.confirmLoad(); H.dismissHints();
    const S=lkDebug().S;
    S.run.zone=5; S.run.encIdx=1; S.run.route="danger"; S.run.shipHp=8;
    LK.finishEncounter(S); S.run.encIdx=1; S.screen="loadout"; H.confirmLoad();`,
  "boss-fight": { delay: 400, script: `
    H.begin(); H.pickShip("vagrants"); H.confirmLoad(); H.dismissHints();
    const S=lkDebug().S;
    S.run.zone=5; S.run.encIdx=1; S.run.route="danger"; S.run.shipHp=8;
    LK.finishEncounter(S); S.run.encIdx=1; S.screen="loadout"; H.confirmLoad();
    H.bossEngage();
    const boss=S.enc.units.find(u=>u.type==="apex"); boss.hp=9; render();` },
  campfire: `
    H.begin(); H.pickShip("vagrants"); H.confirmLoad(); H.dismissHints();
    const S=lkDebug().S;
    S.run.shipHp=5;
    for(const e of LK.enemies(S.enc)) e.alive=false;
    LK.pump(S); H.afterClear(); render();`,
  // 船長診断カード(なばて公開ループの主役)
  shindan: `
    H.begin(); H.pickShip("bellyroll"); H.confirmLoad(); H.dismissHints();
    const S=lkDebug().S;
    Object.assign(S.run,{kills:12, physKills:9, routeTotal:3, routeDanger:3, undoCount:1, chooseRest:0,
      zone:5, physKills:9, bonusValue:4, bossKilled:true, contracts:["heavy","minefield","norepair"]});
    S.run.cargo=["starmap","annihil"]; S.run.relicsSeen=["starmap","annihil"]; S.run.shipHp=4;
    LK.doKeep(S); render();`,
  "summary-best": `
    H.begin(); H.pickShip("vagrants"); H.confirmLoad(); H.dismissHints();
    const S=lkDebug().S;
    S.run.cargo=["starmap","annihil"]; S.run.relicsSeen=["starmap","annihil"];
    S.run.zone=4; S.run.physKills=7; S.run.bonusValue=4;
    LK.doKeep(S); render();`,
  // v0.8.1: ボス3種 — 正体ごとのWARNINGと戦闘画面
  "boss-jugg-warning": `
    H.begin(); H.pickShip("vagrants"); H.confirmLoad(); H.dismissHints();
    const S=lkDebug().S;
    S.run.zone=5; S.run.encIdx=1; S.run.route="danger"; S.run.shipHp=8; S.run.bossType="juggernaut";
    LK.finishEncounter(S); S.run.encIdx=1; S.screen="loadout"; H.confirmLoad();`,
  "boss-jugg": { delay: 500, script: `
    H.begin(); H.pickShip("vagrants"); H.confirmLoad(); H.dismissHints();
    const S=lkDebug().S;
    S.run.zone=5; S.run.encIdx=1; S.run.route="danger"; S.run.shipHp=8; S.run.bossType="juggernaut";
    LK.finishEncounter(S); S.run.encIdx=1; S.screen="loadout"; H.confirmLoad();
    H.bossEngage();
    const b=S.enc.units.find(u=>u.type==="juggernaut"); b.hp=8; render();` },
  "boss-brood": { delay: 500, script: `
    H.begin(); H.pickShip("vagrants"); H.confirmLoad(); H.dismissHints();
    const S=lkDebug().S;
    S.run.zone=5; S.run.encIdx=1; S.run.route="danger"; S.run.shipHp=8; S.run.bossType="broodmother";
    LK.finishEncounter(S); S.run.encIdx=1; S.screen="loadout"; H.confirmLoad();
    H.bossEngage();
    const b=S.enc.units.find(u=>u.type==="broodmother"); b.hp=6; render();` },
  // v0.8: 航行契約の選択UI(デッキ編成画面)
  contracts: `
    lkDebug().META.unlocked=["c_tractor","c_gravshot","c_harpoon"];
    H.begin(); H.pickShip("vagrants");
    H.toggleContract("heavy"); H.toggleContract("minefield"); H.toggleContract("norepair");`,
  // v0.8: 新敵5種+重力渦+フレア予告を1画面に
  menagerie: { delay: 900, clip: "#boardwrap", script: `
    H.begin(); H.pickShip("vagrants"); H.confirmLoad(); H.dismissHints();
    const S=lkDebug().S;
    S.enc.units=S.enc.units.filter(u=>u.side==="player");
    const mk=(id,type,x,y)=>{const d=LK.ENEMY_DEFS[type];S.enc.units.push({id,side:"enemy",type,name:d.name,icon:d.icon,x,y,hp:d.hp,maxHp:d.hp,dmg:d.dmg,drift:null,shield:0,alive:true,charge:null,patIdx:0});};
    mk("w","warden",3,0); mk("s","splitter",4,2); mk("m","mender",3,4); mk("b","blinker",2,0); mk("o","bomber",1,2);
    S.run.zone=4; S.enc.well={x:2,y:2};
    S.enc.intents=[]; S.enc.step="intents"; S.enc.phase=null; LK.pump(S);
    S.enc.flareRow=4; render(); // 予告中の姿(pump前に置くと即発火して消費される)` },
};

async function shoot(browser, name, seed) {
  const sc = SCENARIOS[name];
  const script = typeof sc === "string" ? sc : sc.script;
  const page = await browser.newPage({ viewport: { width: 1280, height: 920 } });
  page.on("console", m => { if (m.type() === "error") console.error(`[${name}] console.error:`, m.text()); });
  page.on("pageerror", e => console.error(`[${name}] pageerror:`, e.message));
  await page.goto(`http://localhost:${PORT}/index.html?seed=${seed}`, { waitUntil: "load" });
  await page.evaluate(() => localStorage.removeItem("lok_meta_v1"));
  await page.evaluate(script);
  await page.waitForTimeout(typeof sc === "object" && sc.delay !== undefined ? sc.delay : 700);
  const file = path.join(ROOT, "tmp", `shot-${name}.png`);
  if (typeof sc === "object" && sc.clip) await page.locator(sc.clip).screenshot({ path: file });
  else await page.screenshot({ path: file });
  console.log(`ok: tmp/shot-${name}.png`);
  await page.close();
}

const arg = process.argv[2] || "battle";
const seed = process.argv[3] || "42";
const names = arg === "all" ? Object.keys(SCENARIOS) : [arg];
if (names.some(n => !(n in SCENARIOS))) { console.error("unknown scenario. available:", Object.keys(SCENARIOS).join(", ")); process.exit(1); }

const browser = await chromium.launch();
for (const n of names) {
  try { await shoot(browser, n, seed); }
  catch (e) { console.error(`FAIL ${n}:`, e.message); }
}
await browser.close();
server.close();
