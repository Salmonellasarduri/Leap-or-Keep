// エージェントプロトコルの完全性テスト:
// 「列挙された合法手をランダムに選び続けるだけで、必ずラン終了に到達できる」(stuck/例外/列挙バグ=ゼロ)
// usage: node tests/agent.mjs [runs=120]
import { newGame, legalChoices, applyChoice, observe, LK } from "../agent/protocol.mjs";

let failed = 0, passed = 0;
function ok(cond, name, detail) {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${name}${detail ? " — " + detail : ""}`); }
}

const N = Number(process.argv[2] || 120);
const kinds = new Set();
let totalSteps = 0, deepest = 1, wins = 0;
const ships = ["vagrants", "bellyroll", "astra"];

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

// 主要choice種のカバレッジ(列挙器が全フェイズを出している証拠)
for (const k of ["pair", "act", "fizzle", "commit", "drift", "enemy_turn", "damage_hp", "rest_random", "clear_continue", "keep", "leap"])
  ok(kinds.has(k), `choice kind covered: ${k}`, [...kinds].join(","));

console.log(`\nagent protocol: ${N} random-legal runs / avg steps ${(totalSteps / Math.max(1, N)).toFixed(0)} / deepest zone ${deepest} / wins ${wins}`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
