// 自動プレイ+ビート撮影ドライバ: 視覚QA用に1ランを通しでプレイし、見どころをPNG保存
// usage: node tools/playrun.mjs <runName> <seed> [ship]   → tmp/<runName>-NNN-<tag>.png
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
mkdirSync(path.join(ROOT, "tmp"), { recursive: true });
const PORT = 8398;
const MIME = { ".html": "text/html; charset=utf-8" };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/") p = "/index.html";
  try { res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream" }); res.end(await readFile(path.join(ROOT, p))); }
  catch { res.writeHead(404); res.end(); }
}).listen(PORT);

const [runName = "run1", seed = "101", ship = "vagrants"] = process.argv.slice(2);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 920 } });
page.on("pageerror", e => console.error("pageerror:", e.message));
page.on("console", m => { if (m.type() === "error") console.error("console.error:", m.text()); });
await page.goto(`http://localhost:${PORT}/index.html?seed=${seed}`, { waitUntil: "load" });

// ドライバ本体をページに注入
await page.evaluate((shipId) => {
  localStorage.removeItem("lok_meta_v1");
  const D = window.__drv = { ship: shipId, seen: {}, pauseTag: null, guard: 0 };
  const { UI } = lkDebug();
  UI.stepping = true; UI.hintsSeen = true; // UI側の非同期ステッパーを止めて手動駆動

  D.policyHalf = (S, idx) => {
    if (!S.enc || !S.enc.pending || !S.enc.pending[idx] || S.enc.pending[idx].done) return;
    const spec = LK.actionSpec(S, idx), enc = S.enc;
    for (const u of LK.players(enc)) {
      switch (spec.kind) {
        case "move": case "brake_move": {
          const opts = LK.moveOptions(S, u, spec);
          if (!opts.length) { if (spec.kind === "brake_move" && LK.execAction(S, idx, { unitId: u.id, cell: null }).ok) return; continue; }
          const es = LK.targetables(enc).filter(t => t.side === "enemy");
          const best = es.length ? opts.reduce((b, o) => { const d = Math.min(...es.map(e => LK.tdist(o, e))); return (!b || d < b.d) ? { o, d } : b; }, null).o : opts[0];
          if (LK.execAction(S, idx, { unitId: u.id, cell: { x: best.x, y: best.y }, dir: best.dir }).ok) return;
          break;
        }
        case "ram": { const o = LK.ramOptions(S, u, spec).find(o => o.hit) || LK.ramOptions(S, u, spec)[0]; if (o && LK.execAction(S, idx, { unitId: u.id, dir: o.dir }).ok) return; break; }
        case "warp": { for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) if (!LK.unitAt(enc, x, y) && LK.execAction(S, idx, { unitId: u.id, cell: { x, y } }).ok) return; break; }
        case "attack": case "attack_line": case "push": case "pull": case "attack_push": case "attack_pull": case "setdrift": {
          let ts = LK.attackTargets(S, u, spec).filter(t => t.side === "enemy").sort((a, b) => a.hp - b.hp);
          if (!ts.length) continue;
          const p = { unitId: u.id, targetId: ts[0].id }; if (spec.kind === "setdrift") p.dir = "left";
          if (LK.execAction(S, idx, p).ok) return; break;
        }
        case "attack_all": case "pull_all": { if (LK.attackTargets(S, u, spec).length && LK.execAction(S, idx, { unitId: u.id }).ok) return; break; }
        case "attack_multi": { const ts = LK.attackTargets(S, u, spec).filter(t => t.side === "enemy"); if (ts.length && LK.execAction(S, idx, { unitId: u.id, targetIds: ts.slice(0, spec.count).map(t => t.id) }).ok) return; break; }
        case "heal": case "shield": { if (LK.execAction(S, idx, { unitId: u.id }).ok) return; break; }
        case "salvage": { const d = LK.cardsIn(S, "discard")[0]; if (d && LK.execAction(S, idx, { unitId: u.id, salvageUid: d.uid }).ok) return; break; }
      }
    }
    LK.fizzleAction(S, idx);
  };

  // 1ビート進める。モーダル類は「初回は撮影のため停止→次ビートで解決」
  D.step = () => {
    const { S } = lkDebug();
    const tags = [];
    const once = t => { if (!D.seen[t]) { D.seen[t] = 1; tags.push(t); } };
    const pauseOnce = t => { if (!D.seen[t]) { D.seen[t] = 1; D.pauseTag = t; tags.push(t); return true; } return false; };
    if (D.pauseTag) D.pauseTag = null; // 前ビートで撮影済み→今回は解決して進む
    const before = { phys: S.run.physKills || 0, foes: S.enc ? LK.enemies(S.enc).length : 0, zone: S.run.zone };

    if (S.run.over) { once("summary"); render(); return { done: true, tags, screen: S.screen }; }
    switch (S.screen) {
      case "title": H.begin(); break;
      case "shipselect": { lkDebug().META.ships = ["vagrants", "bellyroll", "astra"]; H.pickShip(D.ship); break; }
      case "deckbuild": H.confirmDeck(); break;
      case "loadout": H.confirmLoad(); lkDebug().UI.stepping = true; once("z" + S.run.zone + "-open"); break;
      case "upgrade": { if (!pauseOnce("upgrade")) { const c = LK.aliveCards(S).filter(c => !c.up).sort((a, b) => (LK.defOf(b).bottom.dmg || 0) - (LK.defOf(a).bottom.dmg || 0))[0]; LK.applyUpgrade(S, c ? c.uid : null); render(); } break; }
      case "route": H.route(LK.aliveCards(S).length >= 8 ? "danger" : "safe"); break;
      case "relic": { if (!pauseOnce("relic")) H.relic(LK.aliveCards(S).length <= 7 ? "deploy" : "seal"); break; }
      case "event": { if (!pauseOnce("event")) { S.pendingEvent && S.pendingEvent.type === "grave" ? H.eventGravePray() : H.eventSkip(); } break; }
      case "leapkeep": {
        if (!pauseOnce("leapkeep")) {
          if (S.run.zone >= 5 || LK.aliveCards(S).length < 6) { H.keepAsk(); H.keepGo(); }
          else { H.leapAsk(); let g = 0; while (lkDebug().S.screen === "leapkeep" && g++ < 3) { const c = LK.aliveCards(S).filter(x => !LK.defOf(x).relic)[0] || LK.aliveCards(S)[0]; H.fuelPick(c.uid); } }
        }
        break;
      }
      case "battle": {
        const enc = S.enc;
        if (LK.pendingDamage(S)) {
          if (!pauseOnce("damage")) {
            const q = LK.pendingDamage(S), u = LK.unitById(enc, q.unitId);
            const burn = [...LK.cardsIn(S, "discard"), ...LK.cardsIn(S, "hand")];
            (u.id === "ship" && u.hp <= Math.max(0, q.dmg - u.shield) && burn.length) ? H.dmgBurn(burn[0].uid) : H.dmgHp();
          }
          break;
        }
        if (enc.phase === "crashsalvage") { if (!pauseOnce("salvage")) { const d = LK.cardsIn(S, "discard")[0]; d ? H.crashPick(d.uid) : (enc.crashSalvage = 0, LK.pump(S), render()); } break; }
        if (enc.phase === "rest") {
          if (!pauseOnce("rest")) {
            const ship = LK.unitById(enc, "ship");
            const all = [...LK.cardsIn(S, "hand"), ...LK.cardsIn(S, "discard")];
            const pick = all.filter(c => !LK.defOf(c).relic)[0] || all[0];
            if (ship.hp >= 3 && pick) { H.restChoose(); H.restLose(pick.uid); }
            else H.restRandom();
          }
          break;
        }
        if (enc.phase === "cleared") { if (!pauseOnce("clear-z" + S.run.zone)) H.afterClear(); break; }
        if (enc.phase === "drift") { LK.driftPhase(S); render(); once("drift"); break; }
        if (enc.phase === "enemy") { LK.enemyStep(S); render(); once("enemyturn"); break; }
        if (enc.phase === "player") {
          if (!enc.pending) {
            const hand = LK.cardsIn(S, "hand");
            const sc = hand.map(c => ({ c, v: (LK.defOf(c).bottom.kind || "").startsWith("attack") ? (LK.defOf(c).bottom.dmg || 1) : 0 })).sort((a, b) => b.v - a.v);
            LK.selectPair(S, sc[0].c.uid, "top", sc[1].c.uid);
          }
          D.policyHalf(S, 0); D.policyHalf(S, 1);
          if (S.enc && S.enc.awaitEnd) LK.commitTurn(S);
          render();
          const phys = (S.run.physKills || 0) > before.phys;
          const kill = S.enc && LK.enemies(S.enc).length < before.foes;
          if (phys) once("physkill");
          else if (kill) once("kill");
          break;
        }
        break;
      }
    }
    const S2 = lkDebug().S;
    return { done: !!S2.run.over && S2.screen === "summary" && !!D.seen["summary"], tags, screen: S2.screen, zone: S2.run.zone, over: S2.run.over };
  };
}, ship);

let seq = 0, guard = 0;
const shots = [];
while (guard++ < 600) {
  const r = await page.evaluate(() => window.__drv.step());
  if (r.tags && r.tags.length) {
    const tag = r.tags.join("+").replace(/[^a-z0-9+-]/gi, "");
    await page.waitForTimeout(120);
    const f = `${runName}-${String(++seq).padStart(3, "0")}-${tag}.png`;
    await page.screenshot({ path: path.join(ROOT, "tmp", f) });
    shots.push(f);
  }
  if (r.done) break;
}
const final = await page.evaluate(() => { const { S } = lkDebug(); return { win: S.run.win, zone: S.run.zone, score: S.run.score, phys: S.run.physKills || 0, reason: S.run.reason }; });
console.log(JSON.stringify({ runName, seed, ship, final, frames: shots }, null, 1));
await browser.close();
server.close();
