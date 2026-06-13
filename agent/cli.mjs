// エージェント用CLI(ステートレス・リプレイ式): 状態 = シード+選択IDログ(JSONファイル)
// usage:
//   node agent/cli.mjs new [--seed 7] [--ship vagrants|bellyroll|astra] [--contracts heavy,swarm] [--asc 0] [--file tmp/run.json]
//   node agent/cli.mjs state [--file ...]
//   node agent/cli.mjs choose <id> [<id2> <id3>…] [--say "一言"] [--file ...]   … 複数手を一括実行可
//   node agent/cli.mjs log [--file ...]        … 選択ログ+セリフ+結果(記事用)
// 毎回シードからリプレイするので、ファイルが正なら状態は常に正(決定論)。
// 高速化: 合法手が1つだけの強制フェイズ(慣性解決/敵ターン等)は自動進行する(⏩表示)。
// セリフ: --say はその判断への一言コメント(実況素材)。logで時系列に出る。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { newGame, replay, legalChoices, applyChoice, observe, autoForward, LK } from "./protocol.mjs";

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
  let say = null, wow = false;
  const ids = [];
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--say") { say = args[++i]; continue; }
    if (args[i] === "--wow") { wow = true; continue; }
    if (args[i] === "--file") { ++i; continue; }
    if (!args[i].startsWith("--")) ids.push(args[i]);
  }
  if (!ids.length) { console.error("usage: choose <id> [<id2>…] [--say \"一言\"] [--wow]"); process.exit(1); }
  const data = load();
  data.says = data.says || [];
  data.wows = data.wows || [];
  const s = replay(data.opts, data.ids);
  if (say) data.says.push({ at: data.ids.length, text: say });
  if (wow) data.wows.push({ z: s.run.zone, e: s.run.encIdx, r: s.enc ? s.enc.round : 0 }); // 「今の瞬間」を航海記録に刻む
  const notes = [];
  for (const id of ids) {
    const legal = legalChoices(s);
    const exact = legal.some(c => c.id === id);
    const freeform = /^(leap:|loadout:)/.test(id); // 組合せ系は形式一致でも可
    if (!exact && !freeform) {
      save(data); // ここまでの成功分は保存済み
      console.error(`✖ "${id}" は現在の合法手にない(直前までの${notes.length}手は適用済み)。現在の合法手:`);
      for (const c of legal.slice(0, 40)) console.error(`  ${c.id}  …${c.label}`);
      if (legal.length > 40) console.error(`  …他${legal.length - 40}件(state で全件)`);
      process.exit(1);
    }
    const r = applyChoice(s, id);
    if (!r.ok) { save(data); console.error(`✖ 失敗: ${id}: ${r.msg || "?"}(直前までは適用済み)`); process.exit(1); }
    data.ids.push(id);
    notes.push(`✔ ${id}`);
    // 強制手(合法手1つ)の自動進行
    const fwd = autoForward(s);
    if (fwd.length) { data.ids.push(...fwd); notes.push(`⏩ 自動進行: ${fwd.join(" → ")}`); }
    if (s.run.over) break;
  }
  save(data);
  show(s, notes.join("\n"));
} else if (cmd === "log") {
  const data = load();
  const s = replay(data.opts, data.ids);
  // セリフを手の位置に差し込んだ実況タイムライン(記事素材)
  const says = data.says || [];
  const timeline = data.ids.map((id, i) => {
    const said = says.filter(x => x.at === i).map(x => x.text);
    return said.length ? `${id}  💬「${said.join("」「")}」` : id;
  });
  console.log(JSON.stringify({
    opts: data.opts, choices: data.ids.length,
    over: s.run.over, win: s.run.win, reason: s.run.reason, zone: s.run.zone,
    score: s.run.over ? LK.runScore(s) : null,
    captain: s.run.over ? LK.captainType(s) : null,
    chronicle: LK.voyageChronicle(s, data.wows || []),
    timeline,
    gameLog: s.run.log.slice(0, 30).map(l => l.msg),
  }, null, 1));
} else if (cmd === "chronicle") {
  // LLMなしで生成される航海記録(★=船長がwowで刻んだ瞬間)
  const data = load();
  const s = replay(data.opts, data.ids);
  console.log(LK.voyageChronicle(s, data.wows || []).join("\n"));
} else {
  console.error("usage: node agent/cli.mjs new|state|choose|log [...]");
  process.exit(1);
}
