// EN モード全画面監査: 各シーンを再現し、未翻訳の日本語テキストノード/ツールチップ断片を列挙する
// usage: node tools/i18n-audit.mjs [sceneName]   … 省略時は全シーン
// 出力: tmp/i18n-leftovers.json({scene:[text,...]}, 全体dedup)+コンソール要約
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = 8397;
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

const BATTLE_SETUP = `H.begin(); H.pickShip("vagrants"); H.confirmLoad(); H.dismissHints();`;

const SCENES = {
  title: `/* タイトルのまま */`,
  shipselect: `H.begin();`,
  contracts: `
    lkDebug().META.unlocked=["c_tractor","c_gravshot","c_harpoon"];
    H.begin(); H.pickShip("vagrants");
    H.toggleContract("heavy"); H.toggleContract("minefield"); H.toggleContract("norepair");`,
  hangar: `lkDebug().META.credits=25; H.hangar();`,
  battle: BATTLE_SETUP,
  dmgmodal: `${BATTLE_SETUP}
    const S=lkDebug().S;
    S.enc.dmgQueue.push({unitId:"ship",dmg:2,src:"衝突"}); render();`,
  rest: `${BATTLE_SETUP}
    const S=lkDebug().S;
    for(const c of LK.cardsIn(S,"hand")) c.loc="discard";
    S.enc.step="upkeep"; LK.pump(S); render();`,
  restchoose: `${BATTLE_SETUP}
    const S=lkDebug().S;
    for(const c of LK.cardsIn(S,"hand")) c.loc="discard";
    S.enc.step="upkeep"; LK.pump(S); render(); H.restChoose();`,
  restshift: `${BATTLE_SETUP}
    const S=lkDebug().S;
    for(const c of LK.cardsIn(S,"hand")) c.loc="discard";
    S.enc.step="upkeep"; LK.pump(S); LK.doRest(S,"random"); render();`,
  "title-moments": `lkDebug().META.moments={legend:1,chain3:1,phys5:1}; lkDebug().META.types={hunter:1}; render();`,
  salvage: `${BATTLE_SETUP}
    const S=lkDebug().S;
    S.enc.units=S.enc.units.filter(u=>u.side==="player"||u.side==="enemy");
    const e=LK.enemies(S.enc)[0];
    S.enc.units.push({id:"hm",side:"hazard",type:"mine",name:"係留機雷",icon:"☄️",x:2,y:2,hp:1,maxHp:1,dmg:2,drift:null,shield:0,alive:true});
    e.x=1; e.y=2; e.hp=1; e.drift="right";
    for(const p of LK.players(S.enc)) p.drift=null;
    LK.cardsIn(S,"hand")[0].loc="discard";
    S.enc.step="drift"; S.enc.phase=null;
    LK.driftPhase(S); render();`,
  campfire: `${BATTLE_SETUP}
    const S=lkDebug().S;
    S.run.shipHp=5;
    for(const e of LK.enemies(S.enc)) e.alive=false;
    LK.pump(S); H.afterClear(); render();`,
  relic: `${BATTLE_SETUP}
    const S=lkDebug().S;
    S.run.encIdx=1; S.run.route="danger";
    S.pendingRelic=LK.RELIC_DEFS.find(r=>r.id==="fusion");
    S.screen="relic"; render();`,
  leapkeep: `${BATTLE_SETUP}
    const S=lkDebug().S;
    S.run.cargo=["starmap","nano"]; S.run.relicsSeen=["starmap","nano"];
    S.screen="leapkeep"; render();`,
  keepask: `${BATTLE_SETUP}
    const S=lkDebug().S;
    S.run.cargo=["starmap"]; S.run.relicsSeen=["starmap"];
    S.screen="leapkeep"; render(); H.keepAsk();`,
  leapask: `${BATTLE_SETUP}
    const S=lkDebug().S;
    S.run.cargo=["starmap"]; S.run.relicsSeen=["starmap"];
    S.screen="leapkeep"; render(); H.leapAsk();`,
  "event-wreck": `${BATTLE_SETUP}
    const S=lkDebug().S; S.pendingEvent={type:"wreck"}; S.screen="event"; render();`,
  "event-grave": `${BATTLE_SETUP}
    const S=lkDebug().S; S.pendingEvent={type:"grave"}; S.screen="event"; render();`,
  // ボスは3の倍数ゾーンの第2戦域のみ。正体は bossTypes={章:正体} で固定(shot.mjsの修正と同方式)
  "boss-warning": `${BATTLE_SETUP}
    const S=lkDebug().S;
    S.run.zone=6; S.run.encIdx=1; S.run.route="danger"; S.run.shipHp=8; S.run.bossTypes={2:"apex"};
    LK.finishEncounter(S); S.run.encIdx=1; S.screen="loadout"; H.confirmLoad();`,
  "boss-fight": `${BATTLE_SETUP}
    const S=lkDebug().S;
    S.run.zone=6; S.run.encIdx=1; S.run.route="danger"; S.run.shipHp=8; S.run.bossTypes={2:"apex"};
    LK.finishEncounter(S); S.run.encIdx=1; S.screen="loadout"; H.confirmLoad();
    H.bossEngage(); render();`,
  menagerie: `${BATTLE_SETUP}
    const S=lkDebug().S;
    S.enc.units=S.enc.units.filter(u=>u.side==="player");
    const mk=(id,type,x,y)=>{const d=LK.ENEMY_DEFS[type];S.enc.units.push({id,side:"enemy",type,name:d.name,icon:d.icon,x,y,hp:d.hp,maxHp:d.hp,dmg:d.dmg,drift:null,shield:0,alive:true,charge:null,patIdx:0});};
    mk("w","warden",3,0); mk("s","splitter",4,2); mk("m","mender",3,4); mk("b","blinker",2,0); mk("o","bomber",1,2);
    S.run.zone=4; S.enc.well={x:2,y:2};
    S.enc.intents=[]; S.enc.step="intents"; S.enc.phase=null; LK.pump(S);
    S.enc.flareRow=4; render();`,
  "summary-win": `${BATTLE_SETUP}
    const S=lkDebug().S;
    S.run.cargo=["starmap"]; S.run.relicsSeen=["starmap"]; S.run.zone=3; S.run.physKills=4;
    LK.doKeep(S); render();`,
  "summary-legend": `
    H.begin(); H.pickShip("bellyroll"); H.confirmLoad(); H.dismissHints();
    const S=lkDebug().S;
    Object.assign(S.run,{kills:12, physKills:9, routeTotal:3, routeDanger:3, undoCount:1, chooseRest:0,
      zone:5, bonusValue:4, bossKilled:true, chainBest:4, chainLinks:5, contracts:["heavy","minefield","norepair"]});
    S.run.cargo=["starmap","annihil"]; S.run.relicsSeen=["starmap","annihil"]; S.run.shipHp=4;
    LK.doKeep(S); render();`,
  "summary-loss": `${BATTLE_SETUP}
    const S=lkDebug().S;
    for(const c of LK.cardsIn(S,"pool")) c.loc="lost";
    S.enc.step="upkeep"; LK.pump(S); render();`,
  tutorialdone: `
    const S0=lkDebug().S||{};
    H.begin(); H.pickShip("vagrants"); H.confirmLoad(); H.dismissHints();
    const S=lkDebug().S; S.screen="tutorialdone"; render();`,
};

function collectScript() {
  return `(()=>{
    const out=new Set();
    const app=document.getElementById("app");
    if(!app) return [];
    const w=document.createTreeWalker(app,NodeFilter.SHOW_TEXT);
    let n;
    while((n=w.nextNode())){
      const t=(n.nodeValue||"").trim();
      if(t&&/[぀-ヿ㐀-鿿]/.test(t)) out.add(t.slice(0,120));
    }
    for(const el of app.querySelectorAll("[data-tt]")){
      for(const seg of el.dataset.tt.split(/<br\\/?>/)){
        const t=seg.replace(/<[^>]+>/g,"").trim();
        if(t&&/[぀-ヿ㐀-鿿]/.test(t)) out.add("[tt] "+t.slice(0,120));
      }
    }
    return [...out];
  })()`;
}

const only = process.argv[2];
const names = only ? [only] : Object.keys(SCENES);
const browser = await chromium.launch();
const result = {};
const global = new Set();
for (const name of names) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 920 } });
  page.on("pageerror", e => console.error(`[${name}] pageerror:`, e.message));
  try {
    await page.goto(`http://localhost:${PORT}/index.html?seed=42&lang=en`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__holoReady || window.__holoFailed); // holo初期化とのレース防止(R23)
    await page.evaluate(() => localStorage.removeItem("lok_meta_v1"));
    await page.evaluate(SCENES[name]);
    await page.waitForTimeout(700);
    const found = await page.evaluate(collectScript());
    const fresh = found.filter(t => !global.has(t));
    found.forEach(t => global.add(t));
    result[name] = found;
    console.log(`${name}: ${found.length} JP nodes (${fresh.length} new)`);
  } catch (e) { console.error(`FAIL ${name}:`, e.message); result[name] = ["<SCENE FAILED: " + e.message + ">"]; }
  await page.close();
}
await writeFile(path.join(ROOT, "tmp", "i18n-leftovers.json"), JSON.stringify(result, null, 2));
console.log(`total unique: ${global.size} -> tmp/i18n-leftovers.json`);
await browser.close();
server.close();
