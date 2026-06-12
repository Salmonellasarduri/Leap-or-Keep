// エージェント用CLI(ステートレス・リプレイ式): 状態 = シード+選択IDログ(JSONファイル)
// usage:
//   node agent/cli.mjs new [--seed 7] [--ship vagrants|bellyroll|astra] [--contracts heavy,swarm] [--asc 0] [--file tmp/run.json]
//   node agent/cli.mjs state [--file ...]
//   node agent/cli.mjs choose <choiceId> [--file ...]
//   node agent/cli.mjs log [--file ...]        … 選択ログと結果(記事用)
// 毎回シードからリプレイするので、ファイルが正なら状態は常に正(決定論)。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { newGame, replay, legalChoices, applyChoice, observe, LK } from "./protocol.mjs";

const args = process.argv.slice(2);
const cmd = args[0];
function opt(name, dflt) { const i = args.indexOf("--" + name); return i >= 0 ? args[i + 1] : dflt; }
const file = opt("file", "tmp/agent-run.json");

function load() { return JSON.parse(readFileSync(file, "utf8")); }
function save(data) { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(data)); }
function show(s, note) {
  const out = [];
  if (note) out.push(note);
  out.push(observe(s));
  const cs = legalChoices(s);
  if (cs.length) {
    out.push(`\nCHOICES (${cs.length}件 — \`node agent/cli.mjs choose <id>\` で選択):`);
    for (const c of cs) out.push(`  ${c.id}  …${c.label}`);
  } else out.push("\n(選択肢なし — ラン終了)");
  console.log(out.join("\n"));
}

if (cmd === "new") {
  const data = {
    opts: {
      seed: Number(opt("seed", Math.floor(Math.random() * 1e9))),
      ship: opt("ship", "vagrants"),
      asc: Number(opt("asc", 0)),
      contracts: (opt("contracts", "") || "").split(",").filter(Boolean),
    },
    ids: [],
  };
  save(data);
  show(newGame(data.opts), `# 新規ラン (seed=${data.opts.seed}, ship=${data.opts.ship}${data.opts.contracts.length ? ", 契約=" + data.opts.contracts.join(",") : ""}) → ${file}`);
} else if (cmd === "state") {
  const data = load();
  show(replay(data.opts, data.ids));
} else if (cmd === "choose") {
  const id = args[1];
  if (!id) { console.error("usage: choose <choiceId>"); process.exit(1); }
  const data = load();
  const s = replay(data.opts, data.ids);
  const legal = legalChoices(s);
  // 完全一致のみ許可(列挙外IDの抑止)。leap/loadout系は形式一致でも可
  const exact = legal.some(c => c.id === id);
  const freeform = /^(leap:|loadout:)/.test(id);
  if (!exact && !freeform) {
    console.error(`✖ 不正な選択: "${id}" は合法手リストにない。現在の合法手:`);
    for (const c of legal.slice(0, 40)) console.error(`  ${c.id}  …${c.label}`);
    if (legal.length > 40) console.error(`  …他${legal.length - 40}件(state で全件)`);
    process.exit(1);
  }
  const r = applyChoice(s, id);
  if (!r.ok) { console.error(`✖ 失敗: ${r.msg || "?"}`); process.exit(1); }
  data.ids.push(id);
  save(data);
  show(s, `✔ ${id}`);
} else if (cmd === "log") {
  const data = load();
  const s = replay(data.opts, data.ids);
  console.log(JSON.stringify({
    opts: data.opts, choices: data.ids.length, ids: data.ids,
    over: s.run.over, win: s.run.win, reason: s.run.reason, zone: s.run.zone,
    score: s.run.over ? LK.runScore(s) : null,
    captain: s.run.over ? LK.captainType(s) : null,
    log: s.run.log.slice(0, 40).map(l => l.msg),
  }, null, 1));
} else {
  console.error("usage: node agent/cli.mjs new|state|choose|log [...]");
  process.exit(1);
}
