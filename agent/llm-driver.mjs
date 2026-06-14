// 汎用LLMドライバ: OpenAI互換API(ollama等)のモデルにLeap or Keepをプレイさせる
// 「安価なエージェントAIでも遊べるか」の検証用。会話履歴なし(毎手フル観測のステートレス)で小型モデルに優しい
// usage: node agent/llm-driver.mjs --model qwen2.5:7b [--endpoint http://localhost:11434/v1] [--seed 7] [--ship vagrants] [--maxturns 150] [--undo-limit 2|unlimited] [--file tmp/llm-run.json]
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { newGame, legalChoices, applyChoice, observe, autoForward, LK, DEFAULT_AGENT_UNDO_LIMIT } from "./protocol.mjs";

const args = process.argv.slice(2);
function opt(name, dflt) { const i = args.indexOf("--" + name); return i >= 0 ? args[i + 1] : dflt; }
const MODEL = opt("model", "qwen2.5:7b");
const EP = opt("endpoint", "http://localhost:11434/v1");
const SEED = Number(opt("seed", 7));
const SHIP = opt("ship", "vagrants");
const MAXTURNS = Number(opt("maxturns", 150));
const FILE = opt("file", `tmp/llm-run-${MODEL.replace(/[^a-z0-9.]/gi, "_")}.json`);
function undoLimitOpt() {
  const raw = opt("undo-limit", String(DEFAULT_AGENT_UNDO_LIMIT));
  if (/^(unlimited|none)$/i.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : DEFAULT_AGENT_UNDO_LIMIT;
}
const AGENT_UNDO_LIMIT = undoLimitOpt();

const SYSTEM = `あなたは宇宙ローグライク「Leap or Keep」の船長AI。盤面と合法手リスト(CHOICES)を見て、最善の手をひとつ選ぶ。

ルール要諦:
- カード=寿命。手札が尽きると1枚永久ロスト。旗艦HP0か全カード喪失で敗北。「keep」を選べば勝利確定で終了
- 敵の行動は全部予告されている(→以降)。攻撃予告マスから逃げろ
- 移動した者は次ラウンド同方向に1マス滑る(慣性)。盤の端はループする
- 敵を機雷(雷)や岩にぶつけると物理キル=ボーナス
- 方針: ZONE3に到達したら、無理せずkeep(帰還)を選んで勝利を確定させること。被弾はdamage_hpで受けてよい

回答形式(厳守): 説明は1行まで。**最後の行にCHOICESにあるidをひとつだけ**書く。それ以外の文字を最終行に含めるな。`;

async function ask(obs, choices, retryNote) {
  const user = `${retryNote ? retryNote + "\n\n" : ""}${obs}\n\nCHOICES:\n${choices.map(c => `${c.id}  …${c.label}`).join("\n")}\n\n最後の行に選ぶidだけを書け。`;
  const res = await fetch(`${EP}/chat/completions`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }], temperature: 0.4, max_tokens: 220 }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const j = await res.json();
  const text = (j.choices[0].message.content || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  return { raw: text, pick: (lines[lines.length - 1] || "").replace(/^["'`*\s]+|["'`*\s.]+$/g, "") };
}

const t0 = Date.now();
const s = newGame({ seed: SEED, ship: SHIP, agentUndoLimit: AGENT_UNDO_LIMIT });
const ids = [];
let invalid = 0, fallback = 0, turns = 0;
mkdirSync(path.dirname(FILE), { recursive: true });

while (!s.run.over && turns < MAXTURNS) {
  const fwd = autoForward(s);
  ids.push(...fwd);
  if (s.run.over) break;
  const choices = legalChoices(s);
  if (!choices.length) break;
  turns++;
  const obs = observe(s);
  let chosen = null, note = "";
  for (let attempt = 0; attempt < 2 && !chosen; attempt++) {
    try {
      const { pick } = await ask(obs, choices, note);
      const hit = choices.find(c => c.id === pick) || (/^(leap:|loadout:)/.test(pick) && { id: pick });
      if (hit) chosen = hit.id;
      else { invalid++; note = `✖ 前回の回答「${pick}」はCHOICESに存在しないidだった。リストから正確にコピーすること。`; }
    } catch (e) { console.error("API error:", e.message); await new Promise(r => setTimeout(r, 1500)); }
  }
  if (!chosen) { fallback++; chosen = choices[0].id; } // 2回失敗→先頭手で前進(完走性優先)
  const r = applyChoice(s, chosen);
  if (!r.ok) { fallback++; const c2 = legalChoices(s)[0]; if (!c2) break; applyChoice(s, c2.id); ids.push(c2.id); continue; }
  ids.push(chosen);
  console.error(`[${turns}] ${chosen}${invalid ? ` (累計不正${invalid})` : ""}`);
}

const mins = ((Date.now() - t0) / 60000).toFixed(1);
const result = {
  model: MODEL, seed: SEED, ship: SHIP, minutes: Number(mins), turns,
  invalidPicks: invalid, fallbacks: fallback,
  over: s.run.over, win: s.run.win, reason: s.run.reason, zone: s.run.zone,
  score: s.run.over ? LK.runScore(s) : null,
  captain: s.run.over ? (({ name, title }) => ({ name, title }))(LK.captainType(s)) : null,
  chronicle: LK.voyageChronicle(s, []),
};
writeFileSync(FILE, JSON.stringify({ opts: { seed: SEED, ship: SHIP, agentUndoLimit: AGENT_UNDO_LIMIT }, ids, result }, null, 1));
console.log(JSON.stringify(result, null, 1));
