// Leap or Keep — エージェントプレイ・プロトコル層
// 設計: ①合法手をID列挙し、エージェントはIDを選ぶだけ(誤入力が構造的に不可能)
//       ②状態 = シード+選択IDログ(決定論リプレイ — 保存・再開・検証がタダ)
//       ③ゲーム本体は人間版と完全に同一(LOGIC層をそのまま実行。インターフェースだけを足す)
// 既知の差分: ゾーンイベント(漂流船/墓標)はUI層実装のためエージェント版では発生しない(シムと同条件)
import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const html = readFileSync(path.join(here, "..", "index.html"), "utf8");
const m = html.match(/\/\* ===== LOGIC-START ===== \*\/([\s\S]*?)\/\* ===== LOGIC-END ===== \*\//);
if (!m) throw new Error("LOGIC markers not found");
const sandbox = { module: { exports: {} }, console };
vm.createContext(sandbox);
vm.runInContext(m[1], sandbox, { filename: "lok-logic.js" });
export const LK = sandbox.module.exports;

// ---------- ゲーム生成 ----------
export function newGame(opts = {}) {
  const seed = Number.isFinite(opts.seed) ? opts.seed : 1;
  const s = LK.newRun(seed, opts.deck || null, {
    shipId: opts.ship || "vagrants",
    asc: opts.asc || 0,
    contracts: opts.contracts || [],
  });
  LK.startEncounter(s, null);
  s.screen = "battle";
  return s;
}

export function replay(opts, ids) {
  const s = newGame(opts);
  for (const id of ids) {
    const r = applyChoice(s, id);
    if (!r.ok) throw new Error(`replay failed at "${id}": ${r.msg}`);
  }
  return s;
}

// ---------- 合法手の列挙 ----------
const DIRJA = { up: "↑", down: "↓", left: "←", right: "→" };

export function legalChoices(s) {
  const out = [];
  const add = (id, label) => out.push({ id, label });
  const run = s.run, enc = s.enc;
  if (run.over) return out;

  // 戦闘外スクリーン
  if (s.screen === "upgrade") {
    for (const c of LK.aliveCards(s).filter(c => !c.up))
      add(`camp_upgrade:${c.uid}`, `強化(+): ${LK.defOf(c).name}`);
    add("camp_resupply", `補給: 旗艦HP+3+随伴機全快${LK.hasContract(run, "norepair") ? "(契約で封鎖中=失敗する)" : ""}`);
    add("camp_scrap", "物資回収: 売却価値+1");
    return out;
  }
  if (s.screen === "route") {
    const zt = LK.ZONE_TABLE[run.zone - 1];
    add("route_safe", `安全ルート(敵: ${zt.safe.map(t => t === "apex" ? LK.bossOf(s) : t).join(",")} / コモン遺物)`);
    add("route_danger", `危険ルート(敵: ${zt.danger.map(t => t === "apex" ? LK.bossOf(s) : t).join(",")} / レア遺物)`);
    return out;
  }
  if (s.screen === "relic") {
    const r = s.pendingRelic;
    add("relic_seal", `封印: カーゴへ(売却価値${r ? r.value : "?"} — 帰還で確定)`);
    if (LK.canDeploy ? LK.canDeploy(s) : true) add("relic_deploy", "展開: 即戦力カード化(価値放棄+喪失リスク)");
    return out;
  }
  if (s.screen === "leapkeep") {
    add("keep", "帰還する(ランを勝利で終える — カーゴ確定)");
    const cost = LK.fuelCost(s);
    const cards = LK.aliveCards(s);
    const combos = kCombos(cards.map(c => c.uid), cost).slice(0, 200);
    for (const combo of combos) {
      const names = combo.map(u => LK.defOf(cards.find(c => c.uid === u)).name).join("+");
      add(`leap:${combo.join(",")}`, `跳ぶ(燃料: ${names}を永久ロスト)`);
    }
    return out;
  }
  if (s.screen === "loadout") {
    add("loadout_default", "出撃(ロードアウト自動: プール先頭6枚)");
    // #002イナンナ指摘: 展開遺物がプール末尾に入り、デフォルト編成だと一生手札に来ない
    const pool = LK.cardsIn(s, "pool");
    if (pool.length > 6 && pool.some(c => c.relicId || c.up)) {
      const fresh = [...pool].sort((a, b) => ((a.relicId ? 0 : 1) + (a.up ? 0 : .5)) - ((b.relicId ? 0 : 1) + (b.up ? 0 : .5))).slice(0, 6);
      add(`loadout:${fresh.map(c => c.uid).join(",")}`, `出撃(遺物・強化カード優先: ${fresh.map(c => LK.defOf(c).name + (c.up ? "+" : "")).join("/")})`);
    }
    return out;
  }

  if (!enc) return out;
  // 戦闘内フェイズ(pumpの優先順に従う)
  if (LK.pendingDamage(s)) {
    const q = LK.pendingDamage(s);
    const u = LK.unitById(enc, q.unitId);
    add("damage_hp", `HPで受ける: ${u ? u.name : "?"}に${q.dmg}ダメージ(${q.src})`);
    for (const c of [...LK.cardsIn(s, "hand"), ...LK.cardsIn(s, "discard")])
      add(`damage_burn:${c.uid}`, `カードで無効化: 『${LK.defOf(c).name}』を永久ロスト`);
    return out;
  }
  if (enc.phase === "crashsalvage") {
    const ship = LK.unitById(enc, "ship");
    if (ship.hp < ship.maxHp) add("salvage_repair", `装甲板: 旗艦HP+1(${ship.hp}/${ship.maxHp})`);
    for (const c of LK.cardsIn(s, "discard"))
      add(`salvage_card:${c.uid}`, `カード回収: 『${LK.defOf(c).name}』を手札へ`);
    if (!out.length) add("salvage_repair", "装甲板(満タンでも消化)");
    return out;
  }
  if (enc.phase === "cleared") { add("clear_continue", "戦域クリア — 続行"); return out; }
  if (enc.phase === "rest") {
    add("rest_random", "休息(成り行き): ランダムに1枚永久ロスト(無償)");
    const ship = LK.unitById(enc, "ship");
    if (ship.hp > 1 || run.freeChooseRest > 0)
      for (const c of [...LK.cardsIn(s, "hand"), ...LK.cardsIn(s, "discard")])
        add(`rest_choose:${c.uid}`, `休息(自選${run.freeChooseRest > 0 ? "・無償" : "・旗艦HP-1"}): 『${LK.defOf(c).name}』を手放す`);
    return out;
  }
  if (enc.phase === "drift") { add("drift", "慣性解決(ラウンド頭の滑り — 全員が影の位置へ)"); return out; }
  if (enc.phase === "enemy") { add("enemy_turn", "敵ターン実行(予告どおり動く)"); return out; }

  if (enc.phase === "player") {
    if (enc.awaitEnd) {
      add("commit", "ターン確定(敵ターンへ — 2枚は消耗へ)");
      if (LK.canUndo(s)) add("undo", "ターン全体をやり直す");
      return out;
    }
    if (!enc.pending) {
      // 正規化: pair:A:top:B と pair:B:bottom:A は同じ手札割当(実行順は act の順で選べる)なので片方だけ列挙(#001指摘で半減)
      const hand = LK.cardsIn(s, "hand");
      for (let i = 0; i < hand.length; i++) for (let j = i + 1; j < hand.length; j++) {
        const a = hand[i], b = hand[j];
        for (const half of ["top", "bottom"]) {
          const sa = LK.cardSpec(s, a, half), sb = LK.cardSpec(s, b, half === "top" ? "bottom" : "top");
          add(`pair:${a.uid}:${half}:${b.uid}`,
            `${LK.defOf(a).name}の${half === "top" ? "▲" : "▼"}(${sa.label}) + ${LK.defOf(b).name}の${half === "top" ? "▼" : "▲"}(${sb.label})`);
        }
      }
      return out;
    }
    // pending中: 未実行の半面ごとに対象を列挙
    enc.pending.forEach((p, idx) => {
      if (p.done) return;
      const spec = LK.actionSpec(s, idx);
      const prefix = `act:${idx}`;
      const halfName = `[${idx}]${spec.label}`;
      for (const u of LK.players(enc)) {
        switch (spec.kind) {
          case "move": case "brake_move": {
            for (const o of LK.moveOptions(s, u, spec))
              add(`${prefix}:${u.id}:cell:${o.x},${o.y}:${o.dir}`, `${halfName}: ${u.name}が(${o.x},${o.y})へ${DIRJA[o.dir]}`);
            if (spec.kind === "brake_move")
              add(`${prefix}:${u.id}:stay`, `${halfName}: ${u.name}その場で制動(慣性消去)`);
            break;
          }
          case "ram": {
            const dirs = new Set(LK.ramOptions(s, u, spec).map(o => o.dir));
            for (const d of dirs) add(`${prefix}:${u.id}:dir:${d}`, `${halfName}: ${u.name}が${DIRJA[d]}へ突進`);
            break;
          }
          case "warp": {
            for (let x = 0; x < LK.CONFIG.GRID; x++) for (let y = 0; y < LK.CONFIG.GRID; y++)
              if (!LK.unitAt(enc, x, y)) add(`${prefix}:${u.id}:cell:${x},${y}`, `${halfName}: ${u.name}が(${x},${y})へ転移`);
            break;
          }
          case "attack": case "attack_line": case "pierce": case "push": case "pull":
          case "attack_push": case "attack_pull": case "execute": {
            for (const t of LK.attackTargets(s, u, spec))
              add(`${prefix}:${u.id}:target:${t.id}`, `${halfName}: ${u.name}→${t.name}(HP${t.hp})`);
            break;
          }
          case "setdrift": {
            for (const t of LK.attackTargets(s, u, spec)) for (const d of LK.DIR_KEYS)
              add(`${prefix}:${u.id}:target:${t.id}:dir:${d}`, `${halfName}: ${t.name}のドリフトを${DIRJA[d]}に書換`);
            break;
          }
          case "attack_multi": {
            const ts = LK.attackTargets(s, u, spec);
            for (const t of ts) add(`${prefix}:${u.id}:multi:${t.id}`, `${halfName}: ${u.name}→${t.name}`);
            for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++)
              add(`${prefix}:${u.id}:multi:${ts[i].id},${ts[j].id}`, `${halfName}: ${u.name}→${ts[i].name}+${ts[j].name}`);
            break;
          }
          case "attack_all": case "pull_all":
            if (LK.attackTargets(s, u, spec).length)
              add(`${prefix}:${u.id}:go`, `${halfName}: ${u.name}が範囲実行(対象${LK.attackTargets(s, u, spec).length}体)`);
            break;
          case "spawnhaz": case "shield":
            add(`${prefix}:${u.id}:go`, `${halfName}: ${u.name}が実行`);
            break;
          case "heal":
            add(`${prefix}:${u.id}:go`, `${halfName}: ${u.name}を回復(HP${u.hp}/${u.maxHp})`);
            break;
          case "salvage": {
            for (const c of LK.cardsIn(s, "discard"))
              add(`${prefix}:${u.id}:salvage:${c.uid}`, `${halfName}: 『${LK.defOf(c).name}』を回収`);
            break;
          }
        }
      }
      add(`fizzle:${idx}`, `${halfName}: 不発にする(対象なし/温存)`);
    });
    if (LK.canUndo(s)) add("undo", "ターン全体をやり直す");
    return out;
  }
  return out;
}

// 強制手の自動進行: 合法手が1つしかない=判断が存在しない → 自動で適用(プレイ時間短縮の核)
// 適用したIDの配列を返す(リプレイ用に必ずログへ保存すること)
export function autoForward(s, max = 30) {
  const applied = [];
  for (let i = 0; i < max; i++) {
    if (s.run.over) break;
    const cs = legalChoices(s);
    if (cs.length !== 1) break;
    const r = applyChoice(s, cs[0].id);
    if (!r.ok) break;
    applied.push(cs[0].id);
  }
  return applied;
}

function kCombos(arr, k) {
  if (k <= 0) return [[]];
  const out = [];
  (function rec(start, acc) {
    if (acc.length === k) { out.push([...acc]); return; }
    for (let i = start; i < arr.length; i++) { acc.push(arr[i]); rec(i + 1, acc); acc.pop(); }
  })(0, []);
  return out;
}

// ---------- 選択の適用 ----------
export function applyChoice(s, id) {
  const enc = s.enc;
  const [head, ...rest] = id.split(":");
  try {
    switch (head) {
      case "camp_upgrade": return LK.applyUpgrade(s, rest[0]);
      case "camp_resupply": return LK.applyResupply(s);
      case "camp_scrap": return LK.applyScrapLoot(s);
      case "route_safe": LK.chooseRoute(s, "safe"); return { ok: true };
      case "route_danger": LK.chooseRoute(s, "danger"); return { ok: true };
      case "relic_seal": LK.resolveRelic(s, "seal"); return { ok: true };
      case "relic_deploy": LK.resolveRelic(s, "deploy"); return { ok: true };
      case "keep": LK.doKeep(s); return { ok: true };
      case "leap": {
        const r = LK.doLeap(s, rest.join(":").split(","));
        if (r.ok && !s.run.over) { LK.startEncounter(s, null); s.screen = "battle"; }
        return r;
      }
      case "loadout_default": LK.startEncounter(s, null); s.screen = "battle"; return { ok: true };
      case "loadout": LK.startEncounter(s, rest.join(":").split(",")); s.screen = "battle"; return { ok: true };
      case "damage_hp": return LK.resolveDamage(s, "hp");
      case "damage_burn": return LK.resolveDamage(s, "burn", rest[0]);
      case "salvage_repair": return LK.crashSalvageRepair(s);
      case "salvage_card": return LK.crashSalvagePick(s, rest[0]);
      case "clear_continue": {
        LK.finishEncounter(s);
        return { ok: true };
      }
      case "rest_random": return LK.doRest(s, "random");
      case "rest_choose": return LK.doRest(s, "choose", rest[0]);
      case "drift": return LK.driftPhase(s);
      case "enemy_turn": LK.enemyPhaseAll(s); return { ok: true };
      case "commit": return LK.commitTurn(s);
      case "undo": return LK.undoTurn(s);
      case "pair": return LK.selectPair(s, rest[0], rest[1], rest[2]);
      case "fizzle": return LK.fizzleAction(s, Number(rest[0]));
      case "act": {
        const idx = Number(rest[0]); const unitId = rest[1]; const mode = rest[2];
        const params = { unitId };
        if (mode === "cell") {
          const [x, y] = rest[3].split(",").map(Number);
          params.cell = { x, y };
          if (rest[4]) params.dir = rest[4];
        } else if (mode === "stay") params.cell = null;
        else if (mode === "dir") params.dir = rest[3];
        else if (mode === "target") { params.targetId = rest[3]; if (rest[4] === "dir") params.dir = rest[5]; }
        else if (mode === "multi") params.targetIds = rest[3].split(",");
        else if (mode === "salvage") params.salvageUid = rest[3];
        return LK.execAction(s, idx, params);
      }
      default: return { ok: false, msg: `unknown choice: ${id}` };
    }
  } catch (e) {
    return { ok: false, msg: `error: ${e.message}` };
  }
}

// ---------- 観測(日本語テキスト — LLMが読む前提でコンパクトに) ----------
export function observe(s) {
  const run = s.run, enc = s.enc, L = [];
  if (run.over) {
    const ct = LK.captainType(s);
    L.push(`=== ラン終了: ${run.win ? "勝利(" + (run.bossKilled ? "伝説" : "帰還") + ")" : "敗北(" + run.reason + ")"} ===`);
    L.push(`SCORE ${LK.runScore(s)} / ZONE ${run.zone} / 物理キル${run.physKills || 0} / カーゴ価値${LK.cargoValue(s)}`);
    L.push(`船長診断: 『${ct.name}』 — ${ct.title} ${ct.subs.join(" ")}`);
    L.push(`(${ct.jab} ${ct.praise})`);
    return L.join("\n");
  }
  L.push(`ZONE ${run.zone}/5《${LK.ZONE_NAMES[run.zone - 1]}》第${run.encIdx + 1}戦域 / 旗艦HP${(enc && LK.unitById(enc, "ship")) ? LK.unitById(enc, "ship").hp : run.shipHp ?? "?"} / 残カード${LK.aliveCards(s).length}枚(=寿命) / カーゴ価値${LK.cargoValue(s)}`);
  if (s.screen === "loadout") {
    const pool = LK.cardsIn(s, "pool");
    L.push("出撃前 — プール: " + pool.map(c => `${c.uid}=${LK.defOf(c).name}${c.up ? "+" : ""}${c.relicId ? "◆" : ""}`).join(" "));
    L.push("(loadout:<uid6つカンマ区切り> で自由編成も可)");
    return L.join("\n");
  }
  if (s.screen !== "battle" || !enc) { L.push(`画面: ${s.screen}`); return L.join("\n"); }
  L.push(`ラウンド${enc.round} フェイズ:${enc.phase}${enc.flareRow !== null && enc.flareRow !== undefined ? ` ☀フレア予告:y=${enc.flareRow}行が次R頭に1ダメ` : ""}${LK.cardsIn(s, "hand").length <= 2 && enc.phase === "player" ? " ⚠手札残少 — 尽きると強制休息(1枚永久ロスト+そのラウンド無防備)" : ""}`);
  if (enc.container && !enc.container.taken)
    L.push(`箱=漂流コンテナ@(${enc.container.x},${enc.container.y}): ユニットが乗れば価値+2。⚠敵全滅で戦域即終了=回収はその前に`);
  // 盤面(x→右, y→下, トーラス=端はループ)
  const G = LK.CONFIG.GRID;
  const grid = Array.from({ length: G }, () => Array(G).fill("・"));
  if (enc.well) grid[enc.well.y][enc.well.x] = "渦";
  if (enc.container && !enc.container.taken) grid[enc.container.y][enc.container.x] = "箱";
  for (const u of enc.units) if (u.alive) grid[u.y][u.x] = u.id === "ship" ? "船" : u.id === "drone" ? "機" : (u.side === "hazard" ? (u.type === "mine" ? "雷" : "岩") : shortId(u.id));
  L.push("  " + [...Array(G).keys()].map(x => "x" + x).join(" "));
  grid.forEach((row, y) => L.push(`y${y} ` + row.join(" ")));
  // ユニット詳細+意図
  for (const u of enc.units.filter(u => u.alive)) {
    let line = `${u.id === "ship" ? "船" : u.id === "drone" ? "機" : shortId(u.id)}=${u.name}@(${u.x},${u.y}) HP${u.hp}/${u.maxHp}${u.shield ? "+盾" + u.shield : ""}${u.drift ? " 慣性" + DIRJA[u.drift] : ""}`;
    const it = enc.intents && enc.intents.find(i => i.unitId === u.id);
    if (it && u.side === "enemy") {
      const parts = [];
      if (it.teleport && it.moveTo) parts.push(`(${it.moveTo.x},${it.moveTo.y})へ転移`);
      else if (it.moveTo) parts.push(`(${it.moveTo.x},${it.moveTo.y})へ移動`);
      if (it.healTarget) parts.push(`${shortId(it.healTarget)}を修復+1`);
      if (it.summon) parts.push(`(${it.summon.x},${it.summon.y})に${it.summon.type || "mine"}を産卵`);
      if (it.detonate) parts.push("自爆(周囲1に2)");
      else if (it.rush) parts.push(`${DIRJA[it.rush]}レーンへ轢断突進(最初の1体に${it.dmg})`);
      else if (it.fire) parts.push(`直線発射${it.dmg}: ${it.attackCells.map(c => `(${c.x},${c.y})`).join("")}`);
      else if (it.chargeCells) parts.push(`充填中(次R: ${it.chargeCells.slice(0, 6).map(c => `(${c.x},${c.y})`).join("")}${it.chargeCells.length > 6 ? "…" : ""})`);
      else if (it.attackCells && it.attackCells.length) parts.push(`攻撃${it.dmg}: ${it.attackCells.map(c => `(${c.x},${c.y})`).join("")}`);
      line += " → " + (parts.join(" / ") || "様子見");
    }
    L.push(line);
  }
  // 敵タイプ解説(#001指摘: 「装甲」「転移」の理由が観測から読めない → 図鑑1行を出す)
  const seen = new Set();
  for (const u of enc.units.filter(u => u.alive && u.side !== "player")) {
    if (seen.has(u.type)) continue;
    seen.add(u.type);
    L.push(`※${u.name}: ${LK.ENEMY_DEFS[u.type].desc}`);
  }
  // 手札
  const hand = LK.cardsIn(s, "hand");
  if (hand.length) {
    L.push("手札: " + hand.map(c => {
      const st = LK.cardSpec(s, c, "top"), sb = LK.cardSpec(s, c, "bottom");
      return `${c.uid}=${LK.defOf(c).name}${c.up ? "+" : ""}[▲${st.label}${st.lost ? "🔥" : ""}|▼${sb.label}${sb.lost ? "🔥" : ""}]`;
    }).join(" "));
  }
  if (enc.pending) L.push(`プレイ中ペア: ${enc.pending.map((p, i) => `[${i}]${p.done ? "済" : "未"}`).join(" ")}`);
  return L.join("\n");
}
function shortId(id) { return id.length <= 3 ? id : id.slice(0, 3); }
