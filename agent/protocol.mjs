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

export const DEFAULT_AGENT_UNDO_LIMIT = 2;

function hasOpt(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function normalizeUndoLimit(value) {
  if (value === null || value === "unlimited" || value === "none") return null;
  if (value === undefined) return DEFAULT_AGENT_UNDO_LIMIT;
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_AGENT_UNDO_LIMIT;
  return Math.max(0, Math.floor(n));
}

function chapterFor(s) {
  return LK.bossChapterForZone ? LK.bossChapterForZone(s.run.zone) : Math.ceil(s.run.zone / 3);
}

function resetAgentUndo(s) {
  const policy = s.agentPolicy || {};
  s.agentPolicy = {
    ...policy,
    undoChapter: chapterFor(s),
    undoRemaining: policy.undoLimit === null ? null : policy.undoLimit,
  };
  return s.agentPolicy;
}

function initAgentPolicy(s, opts = {}) {
  const value = hasOpt(opts, "agentUndoLimit") ? opts.agentUndoLimit : opts.undoLimit;
  s.agentPolicy = {
    undoLimit: normalizeUndoLimit(value),
    undoChapter: chapterFor(s),
    undoRemaining: null,
  };
  resetAgentUndo(s);
  return s.agentPolicy;
}

function ensureAgentPolicy(s) {
  if (!s.agentPolicy || !hasOpt(s.agentPolicy, "undoLimit")) initAgentPolicy(s);
  if (s.agentPolicy.undoChapter !== chapterFor(s)) resetAgentUndo(s);
  return s.agentPolicy;
}

function agentCanUndo(s) {
  if (!LK.canUndo(s)) return false;
  const policy = ensureAgentPolicy(s);
  return policy.undoRemaining === null || policy.undoRemaining > 0;
}

function undoLabel(s) {
  const policy = ensureAgentPolicy(s);
  if (policy.undoRemaining === null) return "ターン全体をやり直す";
  return `ターン全体をやり直す(このボス区間の残り${policy.undoRemaining}/${policy.undoLimit})`;
}

// ---------- ゲーム生成 ----------
export function newGame(opts = {}) {
  const seed = Number.isFinite(opts.seed) ? opts.seed : 1;
  const s = LK.newRun(seed, opts.deck || null, {
    shipId: opts.ship || "vagrants",
    asc: opts.asc || 0,
    contracts: opts.contracts || [],
  });
  // エージェントの記憶(過去の引き継ぎ群)を持ち込む — 観測の冒頭に想起される
  if (opts.memory && opts.memory.length) s.run.priorVoyages = opts.memory;
  initAgentPolicy(s, opts);
  LK.startEncounter(s, null);
  s.screen = "battle";
  return s;
}

export function replay(opts, ids) {
  // 既存の保存済みログはagentUndoLimitを持たない。リプレイ互換のため旧ログだけは無制限として読む。
  const replayOpts = !hasOpt(opts, "agentUndoLimit") && !hasOpt(opts, "undoLimit")
    ? { ...opts, agentUndoLimit: null }
    : opts;
  const s = newGame(replayOpts);
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
    const bossChapter = LK.bossChapterForZone ? LK.bossChapterForZone(run.zone) : undefined;
    add("route_safe", `安全ルート(敵: ${zt.safe.map(t => t === "apex" ? LK.bossOf(s, bossChapter) : t).join(",")} / コモン遺物)`);
    add("route_danger", `危険ルート(敵: ${zt.danger.map(t => t === "apex" ? LK.bossOf(s, bossChapter) : t).join(",")} / レア遺物)`);
    return out;
  }
  if (s.screen === "relic") {
    const r = s.pendingRelic;
    add("relic_seal", `封印: カーゴへ(売却価値${r ? r.value : "?"} — 帰還で確定)`);
    if (LK.canDeploy ? LK.canDeploy(s) : true) add("relic_deploy", "展開: 即戦力カード化(価値放棄+喪失リスク)");
    return out;
  }
  if (s.screen === "leapkeep") {
    const raw = LK.cargoValue(s);
    const mult = LK.rewardMultiplier ? LK.rewardMultiplier(run) : 1;
    const payout = LK.cargoPayoutValue ? LK.cargoPayoutValue(s) : raw;
    add("keep", `帰還する(ランを勝利で終える — 価値${raw}×x${mult}=${payout}を確定 / SCORE ${LK.scorePreview(s).keep})`);
    if (run.zone < LK.CONFIG.ZONES) {
      const cost = LK.fuelCost(s);
      const cards = LK.aliveCards(s);
      const nextMult = LK.nextRewardMultiplier ? LK.nextRewardMultiplier(run) : mult * 2;
      const combos = kCombos(cards.map(c => c.uid), cost).slice(0, 200);
      for (const combo of combos) {
        const names = combo.map(u => LK.defOf(cards.find(c => c.uid === u)).name).join("+");
        add(`leap:${combo.join(",")}`, `跳ぶ(燃料: ${names}を永久ロスト / 次のボス帰還で倍率x${mult}->x${nextMult}、同じ荷ならSCORE ${LK.scorePreview(s).leap}〜)`);
      }
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
  if (enc.phase === "restshift") {
    add("restshift_skip", "そのまま耐える(姿勢制御を使わない)");
    for (const o of LK.restShiftOptions(s))
      add(`restshift:${o.unitId}:${o.dir}`, `姿勢制御: ${o.unitId === "ship" ? "旗艦" : "随伴機"}を${o.dir}(${o.x},${o.y})へ1マス退避(慣性そのまま・敵の予告から身をずらせ)`);
    return out;
  }
  if (enc.phase === "drift") { add("drift", "慣性解決(ラウンド頭の滑り — 全員が影の位置へ)"); return out; }
  if (enc.phase === "enemy") { add("enemy_turn", "敵ターン実行(予告どおり動く)"); return out; }

  if (enc.phase === "player") {
    if (enc.awaitEnd) {
      add("commit", "ターン確定(敵ターンへ — 2枚は消耗へ)");
      if (agentCanUndo(s)) add("undo", undoLabel(s));
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
    if (agentCanUndo(s)) add("undo", undoLabel(s));
    return out;
  }
  return out;
}

function uniq(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function addTag(tags, tag) {
  if (tag && !tags.includes(tag)) tags.push(tag);
}

function addFact(facts, fact) {
  if (fact && !facts.includes(fact)) facts.push(fact);
}

function threatCells(enc) {
  const cells = new Set();
  for (const it of enc && enc.intents || []) {
    for (const c of it.attackCells || []) cells.add(`${c.x},${c.y}`);
  }
  return cells;
}

function specTags(spec) {
  const tags = [];
  switch (spec && spec.kind) {
    case "move": case "brake_move": case "warp": case "ram":
      addTag(tags, "position"); break;
    case "attack": case "attack_line": case "pierce": case "attack_multi":
    case "attack_all": case "execute": case "attack_push": case "attack_pull":
      addTag(tags, "attack"); break;
    case "push": case "pull": case "pull_all": case "setdrift":
      addTag(tags, "control"); break;
    case "shield":
      addTag(tags, "defense"); break;
    case "heal":
      addTag(tags, "repair"); break;
    case "salvage":
      addTag(tags, "resource"); break;
    case "spawnhaz":
      addTag(tags, "setup"); break;
  }
  if (spec && spec.selfDmg) addTag(tags, "self_damage");
  if (spec && spec.lost) addTag(tags, "burns_card");
  return tags;
}

function damageForTarget(state, spec, target) {
  if (!spec || !target) return 0;
  if (spec.kind === "execute") return spec.dmg + (target.hp < target.maxHp ? spec.bonus || 0 : 0);
  return spec.dmg || 0;
}

function actionMeta(state, id, tags, facts) {
  const enc = state.enc;
  const parts = id.split(":");
  const idx = Number(parts[1]);
  const unitId = parts[2];
  const mode = parts[3];
  const spec = enc && enc.pending ? LK.actionSpec(state, idx) : null;
  for (const tag of specTags(spec)) addTag(tags, tag);
  const unit = enc ? LK.unitById(enc, unitId) : null;
  let hideReason = "";
  if (mode === "cell" && unit) {
    const [x, y] = (parts[4] || "").split(",").map(Number);
    const threats = threatCells(enc);
    addTag(tags, "move_choice");
    const startsThreatened = threats.has(`${unit.x},${unit.y}`);
    const endsThreatened = threats.has(`${x},${y}`);
    if (endsThreatened) {
      addTag(tags, "steps_into_threat");
      addFact(facts, "steps_into_threat");
    } else if (startsThreatened) {
      addTag(tags, "avoids_damage");
      addFact(facts, "escape_option");
    }
    if (unit.id === "ship" && unit.hp <= 2 && (startsThreatened || endsThreatened)) addFact(facts, "survival_critical");
  } else if (mode === "stay" && unit) {
    addTag(tags, "brake");
    if (spec && spec.kind === "brake_move" && !unit.drift) {
      addTag(tags, "no_effect");
      hideReason = "brake_stay_without_drift";
    }
  } else if (mode === "target") {
    const target = enc ? LK.unitById(enc, parts[4]) : null;
    if (target) {
      addTag(tags, target.side === "enemy" ? "enemy_target" : "hazard_target");
      if (target.type === "mine") addTag(tags, "mine_interaction");
      const dmg = damageForTarget(state, spec, target);
      if (dmg > 0) {
        addTag(tags, "causes_damage");
        addFact(facts, "deals_damage");
        if (LK.effDamage(target, dmg) >= target.hp) {
          addTag(tags, "lethal");
          addFact(facts, "lethal_target");
        }
      }
    }
  } else if (mode === "multi") {
    addTag(tags, "multi_target");
  } else if (mode === "go") {
    if (spec && spec.kind === "heal" && unit && unit.hp >= unit.maxHp && !spec.shield) {
      addTag(tags, "no_effect");
      hideReason = "heal_full_hp";
    } else if (spec && spec.kind === "heal") {
      addFact(facts, "repair_available");
      if (unit && unit.hp <= 2) addFact(facts, "survival_recovery");
    }
  }
  return hideReason;
}

function pairBucket(state, id, tags) {
  const parts = id.split(":");
  const a = LK.cardByUid(state, parts[1]);
  const b = LK.cardByUid(state, parts[3]);
  const aHalf = parts[2];
  if (!a || !b) return "pair:unknown";
  const bHalf = aHalf === "top" ? "bottom" : "top";
  const specs = [LK.cardSpec(state, a, aHalf), LK.cardSpec(state, b, bHalf)];
  const kinds = [];
  for (const spec of specs) {
    kinds.push(spec.kind || "unknown");
    for (const tag of specTags(spec)) addTag(tags, tag);
  }
  return "pair:" + kinds.sort().join("+");
}

function annotateChoice(state, choice, rawChoices) {
  const tags = [];
  const facts = [];
  const head = choice.id.split(":")[0];
  let hideReason = "";
  let bucket = head;
  let consequenceSummary = "";
  const enc = state.enc;
  const ship = enc ? LK.unitById(enc, "ship") : null;
  const pendingDamage = LK.pendingDamage(state);
  if (["enemy_turn", "drift", "clear_continue"].includes(head)) { addTag(tags, "progress"); addTag(tags, "forced_progress"); }
  if (["commit", "keep"].includes(head)) addTag(tags, "progress");
  if (head === "keep") { addTag(tags, "safe"); addTag(tags, "high_stakes"); addFact(facts, "safe_route"); addFact(facts, "locks_payout"); consequenceSummary = "ランを勝利で終えて現在のカーゴ価値を確定する"; }
  if (head.startsWith("route_")) { addTag(tags, "route"); addTag(tags, "high_stakes"); }
  if (head === "route_safe") { addTag(tags, "safe"); addFact(facts, "safe_route"); consequenceSummary = "安全ルートへ進む"; }
  if (head === "route_danger") { addTag(tags, "risk"); addTag(tags, "temptation"); addTag(tags, "upside"); addFact(facts, "greedy_route"); consequenceSummary = "危険ルートへ進み、レア報酬の可能性を取る"; }
  if (head.startsWith("camp_")) addTag(tags, "camp");
  if (head === "camp_resupply" && LK.hasContract(state.run, "norepair")) {
    addTag(tags, "blocked");
    hideReason = "blocked_by_contract";
  }
  if (head.startsWith("relic_")) { addTag(tags, "relic"); addTag(tags, "high_stakes"); }
  if (head === "relic_seal") { addTag(tags, "safe"); addFact(facts, "locks_payout"); consequenceSummary = "遺物を封印してカーゴ価値に変える"; }
  if (head === "relic_deploy") { addTag(tags, "risk"); addTag(tags, "temptation"); addTag(tags, "resource_loss"); addTag(tags, "upside"); addFact(facts, "greedy_route"); addFact(facts, "trades_payout_for_power"); consequenceSummary = "遺物価値を放棄して即戦力カード化する"; }
  if (head === "leap") { addTag(tags, "risk"); addTag(tags, "resource_loss"); addTag(tags, "high_stakes"); addTag(tags, "temptation"); addTag(tags, "upside"); addFact(facts, "greedy_route"); addFact(facts, "burns_fuel_cards"); addFact(facts, "raises_reward_multiplier"); consequenceSummary = "カードを燃料にして次の深度へ跳び、将来倍率を上げる"; }
  if (head === "loadout" || head === "loadout_default") addTag(tags, "loadout");
  if (head === "undo") { addTag(tags, "recovery_only"); bucket = "undo"; }
  if (head === "damage_hp") {
    addTag(tags, "takes_damage"); addTag(tags, "resource_preserve"); addTag(tags, "high_stakes");
    addFact(facts, "takes_damage");
    const unit = pendingDamage && enc ? LK.unitById(enc, pendingDamage.unitId) : null;
    if (unit && unit.id === "ship") addFact(facts, "ship_damage");
    if (unit && unit.hp <= 2) addFact(facts, "survival_critical");
    if (unit && pendingDamage && pendingDamage.dmg >= unit.hp) addFact(facts, unit.id === "ship" ? "incoming_lethal" : "unit_lethal_damage");
    if (unit && pendingDamage) consequenceSummary = `${unit.name} HP ${unit.hp}->${Math.max(0, unit.hp - pendingDamage.dmg)} (${pendingDamage.src})`;
  }
  if (head === "damage_burn") {
    addTag(tags, "resource_loss"); addTag(tags, "avoids_damage"); addTag(tags, "survival"); addTag(tags, "high_stakes");
    addFact(facts, "prevents_pending_damage"); addFact(facts, "burns_card");
    consequenceSummary = "カードを永久ロストして保留中ダメージを無効化する";
  }
  if (head === "salvage_card") addTag(tags, "resource");
  if (head === "salvage_repair") { addTag(tags, "repair"); addFact(facts, "repair_available"); if (ship && ship.hp <= 2) addFact(facts, "survival_recovery"); }
  if (head === "rest_random") { addTag(tags, "rest"); addTag(tags, "random"); addTag(tags, "resource_loss"); addTag(tags, "high_stakes"); addFact(facts, "random_loss"); addFact(facts, "burns_card"); consequenceSummary = "ランダムに1枚永久ロストして休息する"; }
  if (head === "rest_choose") { addTag(tags, "rest"); addTag(tags, "resource_loss"); addTag(tags, "high_stakes"); addFact(facts, "burns_card"); if (ship && ship.hp <= 2 && !state.run.freeChooseRest) addFact(facts, "survival_critical"); consequenceSummary = state.run.freeChooseRest > 0 ? "選んだカードを永久ロストして無償休息する" : "旗艦HPを支払い、選んだカードを永久ロストして休息する"; }
  if (head === "fizzle") {
    addTag(tags, "low_value");
    const idx = choice.id.split(":")[1];
    bucket = `fizzle:${idx}`;
  }
  if (head === "pair") {
    addTag(tags, "pair");
    bucket = pairBucket(state, choice.id, tags);
  }
  if (head === "act") {
    addTag(tags, "action");
    hideReason = actionMeta(state, choice.id, tags, facts) || hideReason;
    bucket = ["act", ...uniq(tags).filter(t => ["attack", "position", "control", "defense", "repair", "resource", "setup", "lethal", "avoids_damage"].includes(t)).sort()].join(":");
  }
  return {
    id: choice.id,
    label: choice.label,
    tags: uniq(tags),
    risk_facts: uniq(facts),
    consequence_summary: consequenceSummary,
    bucket,
    hide_from_agent: !!hideReason,
    hide_reason: hideReason || null,
  };
}

function choiceScore(meta, index) {
  let score = 1000 - index;
  const t = new Set(meta.tags || []);
  if (t.has("progress")) score += 200;
  if (t.has("lethal")) score += 120;
  if (t.has("avoids_damage")) score += 90;
  if (t.has("causes_damage")) score += 70;
  if (t.has("attack")) score += 55;
  if (t.has("position")) score += 40;
  if (t.has("defense")) score += 35;
  if (t.has("repair")) score += 30;
  if (t.has("resource")) score += 25;
  if (t.has("setup")) score += 20;
  if (t.has("risk")) score -= 15;
  if (t.has("low_value")) score -= 80;
  if (t.has("recovery_only")) score -= 100;
  return score;
}

function selectDiverseChoices(choices, maxChoices) {
  const sorted = choices.map((c, i) => ({ c, i, score: choiceScore(c, i) }))
    .sort((a, b) => b.score - a.score || a.i - b.i);
  const selected = [];
  const ids = new Set();
  const buckets = new Set();
  for (const item of sorted) {
    if (selected.length >= maxChoices) break;
    if (buckets.has(item.c.bucket)) continue;
    selected.push(item);
    ids.add(item.c.id);
    buckets.add(item.c.bucket);
  }
  for (const item of sorted) {
    if (selected.length >= maxChoices) break;
    if (ids.has(item.c.id)) continue;
    selected.push(item);
    ids.add(item.c.id);
  }
  selected.sort((a, b) => a.i - b.i);
  return selected.map(x => x.c);
}

const POLICY_BLOCK_TAGS = new Set(["high_stakes", "risk", "resource_loss", "random", "takes_damage", "self_damage", "burns_card"]);
const POLICY_LOW_VALUE_TAGS = new Set(["low_value", "recovery_only", "no_effect", "blocked"]);

function profileTagCounts(profile) {
  const raw = profile && profile.tag_counts || profile && profile.tagCounts || {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    const n = Number(value);
    if (key && Number.isFinite(n) && n > 0) out[key] = n;
  }
  return out;
}

function topTags(tagCounts, limit = 8) {
  return Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count }));
}

function hasAnyTag(choice, set) {
  return (choice.tags || []).some(t => set.has(t));
}

function canAutoSingleChoice(choice) {
  const tags = new Set(choice.tags || []);
  if (hasAnyTag(choice, POLICY_BLOCK_TAGS)) return false;
  return tags.has("forced_progress") || tags.has("progress");
}

function profileScore(choice, tagCounts) {
  let score = 0;
  for (const tag of choice.tags || []) score += tagCounts[tag] || 0;
  return score;
}

function policyChoice(choice, reason, confidence, extra = {}) {
  return {
    id: choice.id,
    reason,
    confidence,
    tags: choice.tags || [],
    bucket: choice.bucket || choice.id.split(":")[0],
    ...extra,
  };
}

export function decisionPolicy(choices, opts = {}) {
  const enabled = opts.enabled !== false;
  const maxAutoChoices = Math.max(1, Number(opts.maxAutoChoices || 2));
  const visible = (choices || []).filter(c => !c.hide_from_agent);
  const tagCounts = profileTagCounts(opts.profile || {});
  const profileTotal = Number((opts.profile || {}).total || 0);
  const base = {
    schema: "lok_decision_policy/1.0",
    enabled,
    max_auto_choices: maxAutoChoices,
    auto_choice: null,
    skip_reason: "",
    profile: {
      total: Number.isFinite(profileTotal) ? Math.max(0, Math.floor(profileTotal)) : 0,
      top_tags: topTags(tagCounts),
    },
  };
  if (!enabled) return { ...base, skip_reason: "disabled" };
  if (!visible.length) return { ...base, skip_reason: "no_choices" };
  if (visible.length > maxAutoChoices) return { ...base, skip_reason: "too_many_choices" };
  if (visible.length === 1) {
    if (!canAutoSingleChoice(visible[0])) return { ...base, skip_reason: "single_choice_requires_connector" };
    return {
      ...base,
      auto_choice: policyChoice(visible[0], "single_visible_choice", 1.0),
    };
  }

  const scored = visible.map((choice, index) => ({
    choice,
    index,
    score: choiceScore(choice, index),
    profile_score: profileScore(choice, tagCounts),
    blocked: hasAnyTag(choice, POLICY_BLOCK_TAGS),
    low_value: hasAnyTag(choice, POLICY_LOW_VALUE_TAGS),
  }));
  if (scored.some(x => x.blocked)) {
    return { ...base, skip_reason: "high_stakes_small_choice" };
  }

  const nonLow = scored.filter(x => !x.low_value);
  if (nonLow.length === 1) {
    return {
      ...base,
      auto_choice: policyChoice(nonLow[0].choice, "dominates_low_value", 0.92, {
        compared_choice_ids: visible.map(c => c.id),
        score_gap: nonLow[0].score - Math.max(...scored.filter(x => x !== nonLow[0]).map(x => x.score)),
      }),
    };
  }

  const sorted = [...scored].sort((a, b) => b.score - a.score || a.index - b.index);
  const scoreGap = sorted[0].score - sorted[1].score;
  if (scoreGap >= 120 && !sorted[0].blocked) {
    return {
      ...base,
      auto_choice: policyChoice(sorted[0].choice, "dominant_small_choice", 0.86, {
        compared_choice_ids: visible.map(c => c.id),
        score_gap: scoreGap,
      }),
    };
  }

  if (base.profile.total > 0) {
    const byProfile = [...scored].sort((a, b) => b.profile_score - a.profile_score || b.score - a.score || a.index - b.index);
    const profileGap = byProfile[0].profile_score - byProfile[1].profile_score;
    if (profileGap > 0 && !byProfile[0].blocked) {
      return {
        ...base,
        auto_choice: policyChoice(byProfile[0].choice, "profile_small_choice", Math.min(0.84, 0.62 + profileGap / Math.max(8, base.profile.total * 2)), {
          compared_choice_ids: visible.map(c => c.id),
          profile_score: byProfile[0].profile_score,
          profile_gap: profileGap,
        }),
      };
    }
  }
  return { ...base, skip_reason: "profile_insufficient" };
}

export function agentChoices(s, opts = {}) {
  const raw = legalChoices(s);
  const maxChoices = Math.max(2, Number(opts.maxChoices || 12));
  const threshold = Math.max(maxChoices, Number(opts.threshold || maxChoices));
  const annotated = raw.map((choice, index) => ({ ...annotateChoice(s, choice, raw), index }));
  let visible = annotated.filter(c => !c.hide_from_agent);
  const hidden = annotated.filter(c => c.hide_from_agent);
  if (!visible.length && hidden.length) {
    const restored = hidden.shift();
    restored.hide_from_agent = false;
    restored.hide_reason = null;
    visible = [restored];
  }
  if (visible.length > threshold) {
    const keep = selectDiverseChoices(visible, maxChoices);
    const keepIds = new Set(keep.map(c => c.id));
    for (const c of visible) {
      if (!keepIds.has(c.id)) hidden.push({ ...c, hide_from_agent: true, hide_reason: "choice_cap" });
    }
    visible = keep;
  }
  const reasonCounts = {};
  for (const c of hidden) reasonCounts[c.hide_reason || "unknown"] = (reasonCounts[c.hide_reason || "unknown"] || 0) + 1;
  const clean = c => ({
    id: c.id,
    label: c.label,
    tags: c.tags || [],
    risk_facts: c.risk_facts || [],
    consequence_summary: c.consequence_summary || "",
    bucket: c.bucket || c.id.split(":")[0],
    hide_from_agent: !!c.hide_from_agent,
    hide_reason: c.hide_reason || null,
  });
  const cleanHidden = c => ({
    id: c.id,
    tags: c.tags || [],
    bucket: c.bucket || c.id.split(":")[0],
    hide_from_agent: true,
    hide_reason: c.hide_reason || null,
  });
  const visibleClean = visible.map(clean);
  const hiddenClean = hidden.map(cleanHidden);
  return {
    schema: "lok_choice_meta/1.0",
    raw_count: raw.length,
    visible_count: visible.length,
    hidden_count: hidden.length,
    reason_counts: reasonCounts,
    decision_policy: decisionPolicy(visibleClean, {
      enabled: opts.decisionPolicy !== false,
      maxAutoChoices: opts.autoSmallMax || 2,
      profile: opts.profile || {},
    }),
    choices: visibleClean,
    hidden: hiddenClean,
  };
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
        if (r.ok && !s.run.over) { resetAgentUndo(s); LK.startEncounter(s, null); s.screen = "battle"; }
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
      case "restshift": return LK.restShift(s, rest[0], rest[1]);
      case "restshift_skip": return LK.restShiftSkip(s);
      case "drift": return LK.driftPhase(s);
      case "enemy_turn": LK.enemyPhaseAll(s); return { ok: true };
      case "commit": return LK.commitTurn(s);
      case "undo": {
        if (!LK.canUndo(s)) return LK.undoTurn(s);
        const policy = ensureAgentPolicy(s);
        if (policy.undoRemaining !== null && policy.undoRemaining <= 0)
          return { ok: false, msg: `undo limit exhausted for this boss chapter (${policy.undoLimit})` };
        const r = LK.undoTurn(s);
        if (r.ok && policy.undoRemaining !== null) policy.undoRemaining = Math.max(0, policy.undoRemaining - 1);
        return r;
      }
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
    L.push(`SCORE ${LK.runScore(s)} / ZONE ${run.zone} / 物理キル${run.physKills || 0} / カーゴ価値${LK.cargoValue(s)} / 深度倍率x${LK.rewardMultiplier ? LK.rewardMultiplier(run) : 1} / 精算価値${LK.cargoPayoutValue ? LK.cargoPayoutValue(s) : LK.cargoValue(s)}`);
    L.push(`船長診断: 『${ct.name}』 — ${ct.title} ${ct.subs.join(" ")}`);
    L.push(`(${ct.jab} ${ct.praise})`);
    return L.join("\n");
  }
  // 記憶の想起: 持ち込んだ過去の航海(引き継ぎ)を最初の戦域の冒頭だけ表示
  if (run.priorVoyages && run.zone === 1 && run.encIdx === 0 && enc && enc.round === 1)
    for (const line of LK.carryoverDigest(run.priorVoyages)) L.push(line);
  L.push(`ZONE ${run.zone}/${LK.CONFIG.ZONES}《${LK.ZONE_NAMES[run.zone - 1]}》第${run.encIdx + 1}戦域 / 旗艦HP${(enc && LK.unitById(enc, "ship")) ? LK.unitById(enc, "ship").hp : run.shipHp ?? "?"} / 残カード${LK.aliveCards(s).length}枚(=寿命) / カーゴ価値${LK.cargoValue(s)} / 深度倍率x${LK.rewardMultiplier ? LK.rewardMultiplier(run) : 1}`);
  const undoPolicy = ensureAgentPolicy(s);
  if (undoPolicy.undoRemaining !== null)
    L.push(`AI undo残り ${undoPolicy.undoRemaining}/${undoPolicy.undoLimit} (このボス区間)`);
  if (s.screen === "loadout") {
    const pool = LK.cardsIn(s, "pool");
    L.push("出撃前 — プール: " + pool.map(c => `${c.uid}=${LK.defOf(c).name}${c.up ? "+" : ""}${c.relicId ? "◆" : ""}`).join(" "));
    L.push("(loadout:<uid6つカンマ区切り> で自由編成も可)");
    return L.join("\n");
  }
  if (s.screen !== "battle" || !enc) {
    if (s.screen === "leapkeep") {
      const raw = LK.cargoValue(s);
      const mult = LK.rewardMultiplier ? LK.rewardMultiplier(run) : 1;
      const payout = LK.cargoPayoutValue ? LK.cargoPayoutValue(s) : raw;
      L.push(`ボス後チェックポイント: KEEPなら価値${raw}×x${mult}=${payout}を確定。${run.zone < LK.CONFIG.ZONES ? `LEAPならカード燃料を失い、次のボス帰還倍率はx${LK.nextRewardMultiplier ? LK.nextRewardMultiplier(run) : mult * 2}。` : "ここが最深部なのでLEAPはない。"}`);
    }
    L.push(`画面: ${s.screen}`);
    return L.join("\n");
  }
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
