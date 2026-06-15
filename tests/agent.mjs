// エージェントプロトコルの完全性テスト:
// 「列挙された合法手をランダムに選び続けるだけで、必ずラン終了に到達できる」(stuck/例外/列挙バグ=ゼロ)
// usage: node tests/agent.mjs [runs=120]
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { newGame, replay, legalChoices, agentChoices, decisionPolicy, applyChoice, observe, LK, DEFAULT_AGENT_UNDO_LIMIT } from "../agent/protocol.mjs";

let failed = 0, passed = 0;
function ok(cond, name, detail) {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${name}${detail ? " — " + detail : ""}`); }
}

const N = Number(process.argv[2] || 120);
const kinds = new Set();
let totalSteps = 0, deepest = 1, wins = 0;
const ships = ["vagrants", "bellyroll", "astra"];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "agent", "cli.mjs");

for (let i = 0; i < N; i++) {
  const rnd = (() => { let a = (7700 + i) ^ 0x9e3779b9; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const opts = { seed: 7700 + i, ship: ships[i % 3], contracts: i % 5 === 0 ? ["heavy", "minefield"] : [] };
  let s;
  try { s = newGame(opts); } catch (e) { ok(false, `newGame seed=${opts.seed}`, e.message); continue; }
  let steps = 0, stuck = false;
  while (!s.run.over) {
    if (++steps > 3000) { stuck = true; break; }
    const cs = legalChoices(s);
    if (!cs.length) { stuck = true; ok(false, `no choices but not over (seed=${opts.seed})`, observe(s).slice(0, 200)); break; }
    const c = cs[Math.floor(rnd() * cs.length)];
    kinds.add(c.id.split(":")[0]);
    const r = applyChoice(s, c.id);
    if (!r.ok) { ok(false, `enumerated choice failed (seed=${opts.seed})`, `${c.id}: ${r.msg}`); stuck = true; break; }
  }
  if (!stuck) { totalSteps += steps; deepest = Math.max(deepest, s.run.zone); if (s.run.win) wins++; }
  ok(!stuck, `run ${opts.seed} terminates`, `steps=${steps}`);
  if (s.run.over) {
    const ct = LK.captainType(s);
    ok(!!ct && !!ct.name, `captainType at end (seed=${opts.seed})`);
  }
}

// ボス後チェックポイントはランダム合法手だけでは到達率が低いため、構成済み状態で直接カバーする。
{
  const sKeep = LK.newRun(8801);
  sKeep.screen = "leapkeep";
  sKeep.run.zone = 3;
  const keepChoices = legalChoices(sKeep);
  ok(keepChoices.some(c => c.id === "keep"), "checkpoint exposes keep");
  const keepResult = applyChoice(sKeep, "keep");
  ok(keepResult.ok && sKeep.run.over && sKeep.run.win, "checkpoint keep ends in win");
  kinds.add("keep");

  const sLeap = LK.newRun(8802);
  sLeap.screen = "leapkeep";
  sLeap.run.zone = 3;
  const leapChoice = legalChoices(sLeap).find(c => c.id.startsWith("leap:"));
  ok(!!leapChoice, "checkpoint exposes leap");
  if (leapChoice) {
    const leapResult = applyChoice(sLeap, leapChoice.id);
    ok(leapResult.ok && sLeap.run.zone === 4 && !sLeap.run.over, "checkpoint leap advances to next chapter");
    kinds.add("leap");
  }
}

// 非人間入口のundoは、考え直し用の有限リソースとしてボス区間ごとに制限される。
{
  const s = newGame({ seed: 9901, ship: "vagrants" });
  ok(observe(s).includes(`AI undo残り ${DEFAULT_AGENT_UNDO_LIMIT}/${DEFAULT_AGENT_UNDO_LIMIT}`), "observation exposes AI undo budget");

  let pair = legalChoices(s).find(c => c.id.startsWith("pair:"));
  ok(!!pair, "initial pair exists for undo-budget test");
  if (pair) ok(applyChoice(s, pair.id).ok, "pair before first undo");

  for (let i = 0; i < DEFAULT_AGENT_UNDO_LIMIT; i++) {
    if (i > 0) {
      pair = legalChoices(s).find(c => c.id.startsWith("pair:"));
      ok(!!pair && applyChoice(s, pair.id).ok, `pair before undo ${i + 1}`);
    }
    ok(legalChoices(s).some(c => c.id === "undo"), `undo exposed while budget remains ${i + 1}`);
    const r = applyChoice(s, "undo");
    ok(r.ok, `undo ${i + 1} spends budget`);
  }

  ok(observe(s).includes(`AI undo残り 0/${DEFAULT_AGENT_UNDO_LIMIT}`), "observation shows exhausted undo budget");
  pair = legalChoices(s).find(c => c.id.startsWith("pair:"));
  ok(!!pair && applyChoice(s, pair.id).ok, "pair after undo budget exhausted");
  ok(!legalChoices(s).some(c => c.id === "undo"), "exhausted undo is removed from legal choices");
  const blocked = applyChoice(s, "undo");
  ok(!blocked.ok && /undo limit exhausted/.test(blocked.msg || ""), "direct undo is rejected after budget exhaustion", blocked.msg);

  s.screen = "leapkeep";
  s.run.zone = 3;
  const leapChoice = legalChoices(s).find(c => c.id.startsWith("leap:"));
  ok(!!leapChoice, "leap exists for undo-budget reset");
  if (leapChoice) {
    const leapResult = applyChoice(s, leapChoice.id);
    ok(leapResult.ok && observe(s).includes(`AI undo残り ${DEFAULT_AGENT_UNDO_LIMIT}/${DEFAULT_AGENT_UNDO_LIMIT}`), "undo budget resets after leap to next boss chapter");
  }

  const old = newGame({ seed: 9902, ship: "vagrants", agentUndoLimit: null });
  const oldPair = legalChoices(old).find(c => c.id.startsWith("pair:"));
  const legacyIds = oldPair ? [oldPair.id, "undo", oldPair.id, "undo", oldPair.id, "undo"] : [];
  if (legacyIds.length) {
    const replayed = replay({ seed: 9902, ship: "vagrants" }, legacyIds);
    ok(replayed.agentPolicy.undoRemaining === null, "legacy replay without agentUndoLimit remains unlimited");
  }
}

// agentChoices は人間/UI用の合法手を変えず、非人間入口だけにタグと明白な除外を与える。
{
  const s = newGame({ seed: 9911, ship: "astra" });
  const raw = legalChoices(s);
  const view = agentChoices(s, { maxChoices: 12, threshold: 12 });
  ok(view.schema === "lok_choice_meta/1.0", "agentChoices emits versioned metadata");
  ok(view.raw_count === raw.length, "agentChoices preserves raw choice count");
  ok(view.visible_count === view.choices.length && view.visible_count <= 12, "agentChoices caps crowded openings");
  ok(view.hidden_count === view.hidden.length && view.hidden_count > 0, "agentChoices hides overflow only from agent view");
  ok((view.reason_counts.choice_cap || 0) > 0, "agentChoices records choice_cap reason");
  ok(view.choices.every(c => raw.some(r => r.id === c.id)), "agentChoices visible ids remain legal");
  ok(view.choices.some(c => (c.tags || []).length), "agentChoices annotates visible choices with tags");

  const camp = newGame({ seed: 9912, ship: "astra", contracts: ["norepair"] });
  camp.screen = "upgrade";
  const campRaw = legalChoices(camp);
  const campView = agentChoices(camp);
  ok(campRaw.some(c => c.id === "camp_resupply"), "legalChoices keeps blocked camp_resupply visible for compatibility");
  ok(campView.hidden.some(c => c.id === "camp_resupply" && c.hide_reason === "blocked_by_contract"), "agentChoices hides blocked camp_resupply");

  const forced = newGame({ seed: 9913, ship: "astra" });
  forced.enc.phase = "cleared";
  const forcedView = agentChoices(forced);
  ok(forcedView.decision_policy.auto_choice.id === "clear_continue", "decisionPolicy auto-selects single visible choice");

  const route = newGame({ seed: 9914, ship: "astra" });
  route.screen = "route";
  const routeView = agentChoices(route);
  ok(!routeView.decision_policy.auto_choice && routeView.decision_policy.skip_reason === "high_stakes_small_choice", "decisionPolicy leaves high-stakes route choice to connector");
  const dangerRoute = routeView.choices.find(c => c.id === "route_danger");
  ok(dangerRoute && dangerRoute.risk_facts.includes("greedy_route"), "CHOICE_META labels danger route as fact, not recommendation");
  ok(!("recommended_id" in routeView) && !("recommendation" in dangerRoute), "CHOICE_META does not emit recommendations");

  const singleHighStakes = decisionPolicy([
    { id: "keep", tags: ["progress", "safe", "high_stakes"], bucket: "keep" },
  ]);
  ok(!singleHighStakes.auto_choice && singleHighStakes.skip_reason === "single_choice_requires_connector", "decisionPolicy does not auto-select single high-stakes choice");

  const blockedVsLow = decisionPolicy([
    { id: "damage_hp", tags: ["takes_damage", "high_stakes"], bucket: "damage_hp" },
    { id: "fizzle:0", tags: ["low_value"], bucket: "fizzle:0" },
  ]);
  ok(!blockedVsLow.auto_choice && blockedVsLow.skip_reason === "high_stakes_small_choice", "decisionPolicy leaves high-stakes vs low-value choice to connector");

  const selfDamageVsLow = decisionPolicy([
    { id: "act:0:ship:target:self", tags: ["self_damage", "attack"], bucket: "act:attack" },
    { id: "fizzle:0", tags: ["low_value"], bucket: "fizzle:0" },
  ]);
  ok(!selfDamageVsLow.auto_choice && selfDamageVsLow.skip_reason === "high_stakes_small_choice", "decisionPolicy does not auto-select self-damage over fizzle");

  const profiled = decisionPolicy([
    { id: "attack", tags: ["attack"], bucket: "act:attack" },
    { id: "guard", tags: ["defense"], bucket: "act:defense" },
  ], { profile: { total: 3, tag_counts: { defense: 3 } } });
  ok(profiled.auto_choice && profiled.auto_choice.id === "guard" && profiled.auto_choice.reason === "profile_small_choice", "decisionPolicy uses tag profile for two good choices");
}

// CLI の非人間入口は CHOICE_META を出し、選択タグ profile を run JSON に永続化する。
{
  const dir = mkdtempSync(path.join(tmpdir(), "lok-agent-cli-"));
  const file = path.join(dir, "run.json");
  try {
    const newOut = execFileSync(process.execPath, [
      cliPath,
      "new",
      "--seed", "9911",
      "--ship", "astra",
      "--file", file,
      "--agent-choices",
      "--choice-max", "2",
      "--choice-threshold", "2",
    ], { encoding: "utf8" });
    const metaLine = newOut.split(/\r?\n/).find(line => line.startsWith("CHOICE_META "));
    ok(!!metaLine, "CLI new --agent-choices emits CHOICE_META");
    const meta = metaLine ? JSON.parse(metaLine.slice("CHOICE_META ".length)) : null;
    ok(meta && meta.schema === "lok_choice_meta/1.0", "CLI CHOICE_META keeps schema");
    ok(meta && meta.decision_policy && meta.decision_policy.schema === "lok_decision_policy/1.0", "CLI CHOICE_META includes decision_policy schema");
    const firstChoiceId = meta && meta.choices && meta.choices[0] && meta.choices[0].id;
    ok(!!firstChoiceId, "CLI CHOICE_META lists visible choices");
    ok(Array.isArray(meta.choices[0].risk_facts), "CLI CHOICE_META includes additive risk_facts array");
    ok(typeof meta.choices[0].consequence_summary === "string", "CLI CHOICE_META includes additive consequence_summary string");

    const chooseOut = execFileSync(process.execPath, [
      cliPath,
      "choose",
      firstChoiceId,
      "--file", file,
      "--agent-choices",
      "--choice-max", "2",
      "--choice-threshold", "2",
    ], { encoding: "utf8" });
    ok(chooseOut.includes("CHOICE_META "), "CLI choose --agent-choices keeps CHOICE_META output");
    const saved = JSON.parse(readFileSync(file, "utf8"));
    ok(saved.agentChoiceProfile && saved.agentChoiceProfile.schema === "lok_choice_profile/1.0", "CLI persists agentChoiceProfile schema");
    ok(saved.agentChoiceProfile && saved.agentChoiceProfile.total === 1, "CLI increments agentChoiceProfile total");
    ok(Object.values(saved.agentChoiceProfile.tag_counts || {}).some(n => n > 0), "CLI persists agentChoiceProfile tag counts");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 主要choice種のカバレッジ(列挙器が全フェイズを出している証拠)
for (const k of ["pair", "act", "fizzle", "commit", "drift", "enemy_turn", "damage_hp", "rest_random", "clear_continue", "keep", "leap"])
  ok(kinds.has(k), `choice kind covered: ${k}`, [...kinds].join(","));

// 航海記録: --wowで刻んだ瞬間は必ず★行として残る(イナンナRun#003指摘の回帰防止)
{
  const s = newGame({ seed: 5, ship: "vagrants" });
  // 1ターン進めて物理キル等が無くてもwowが残ることを確認(テキスト付き)
  const r1 = s.run.zone, e1 = s.run.encIdx, rr = s.enc ? s.enc.round : 0;
  const ch1 = LK.voyageChronicle(s, [{ z: r1, e: e1, r: rr, text: "ここが頂点" }]);
  ok(ch1.some(l => l.startsWith("★") && l.includes("ここが頂点")), "text-bearing wow becomes a ★ chronicle row", JSON.stringify(ch1));
  // 大量wowでも★が過剰増殖しない(textなしは近傍1件のみ昇格)
  const ev = s.run.events || [];
  const baseStars = LK.voyageChronicle(s, []).filter(l => l.startsWith("★")).length;
  ok(baseStars === 0, "no stars without marks");
}

// 記憶インターフェース(想い出+引き継ぎ2ch): イナンナ用途の汎用機構
{
  // 引き継ぎダイジェストが newGame.memory から想起される
  const mem = [{ ship: "astra", result: "win", zone: 4, score: 510, captain: "狩人型", note: "次は殲滅プロトコルの声を聞く" }];
  const s = newGame({ seed: 42, ship: "vagrants", memory: mem });
  const obs = observe(s);
  ok(obs.includes("【記憶】") && obs.includes("最高ZONE4"), "prior voyages recalled at game start", obs.split("\n")[0]);
  ok(obs.includes("次は殲滅プロトコル"), "carryover note surfaced");
  // 記憶が無いランでは想起行が出ない
  const s2 = newGame({ seed: 42, ship: "vagrants" });
  ok(!observe(s2).includes("【記憶】"), "no recall line without memory");
  // voyageMemory / carryoverRecord の形
  const vm = LK.voyageMemory(s2, [{ at: 0, text: "出航" }], []);
  ok(vm.kind === "voyage-memory" && vm.captain && Array.isArray(vm.chronicle) && Array.isArray(vm.voice), "voyageMemory shape");
  ok(typeof LK.voyageMemoryProse(vm) === "string" && LK.voyageMemoryProse(vm).includes("航海の記憶"), "prose rendering");
  const co = LK.carryoverRecord(s2, "心残り");
  ok(co.captain && co.note === "心残り" && (co.result === "win" || co.result === "loss"), "carryoverRecord shape");
}

console.log(`\nagent protocol: ${N} random-legal runs / avg steps ${(totalSteps / Math.max(1, N)).toFixed(0)} / deepest zone ${deepest} / wins ${wins}`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
