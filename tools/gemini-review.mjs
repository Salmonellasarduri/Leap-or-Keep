// gemini-review — Gemini(最新)を「素人ワイルドカード枠」として監査フローに差す薄いヘルパー。
// 役割分担: Sol(codex/GPT-5.6)=職人の craft 監査+処方 / Gemini=初見プレイヤーの目。
// 特性の活かし方: 点数を出させない。初見の違和感/詰まり/突飛な1案だけ出させ、
//   出力の大半は Claude が捨て、稀に刺さる1個だけ拾う(=「だいたい的外れ、たまにクリティカル」)。
//
// 使い方:
//   node tools/gemini-review.mjs --img tmp/phase1-desktop.png [--img tmp/x.gif] \
//        --brief tmp/brief.txt  [-o tmp/gemini-review.md] [--model gemini-2.5-pro]
//   node tools/gemini-review.mjs --img a.png "この盤面、初見でどこが分かりにくい?"   # briefをインラインで
//   node tools/gemini-review.mjs --list-models        # 利用可能モデル一覧(最新IDの確認用・要APIキー)
//
// 認証: gemini CLI が GEMINI_API_KEY(AI Studio 無料キー)を要求する。未設定なら下で明示エラー。
//   OAuth(Login with Google)はこのアカウントが Code Assist 無料枠 ineligible のため不可(2026-07-14実測)。
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// 最新モデル。AI Studio の最新IDに合わせて調整可(--model / 環境変数 GEMINI_REVIEW_MODEL でも上書き)。
// 正確な最新IDは `--list-models` で確認できる。
const DEFAULT_MODEL = process.env.GEMINI_REVIEW_MODEL || "gemini-2.5-pro";

// --- 引数パース ---
const argv = process.argv.slice(2);
const imgs = [], inline = [];
let brief = null, out = null, model = DEFAULT_MODEL, listModels = false, persona = "playtester";
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--img" || a === "-i") imgs.push(argv[++i]);
  else if (a === "--brief" || a === "-b") brief = argv[++i];
  else if (a === "--model" || a === "-m") model = argv[++i];
  else if (a === "--persona") persona = argv[++i];
  else if (a === "-o") out = argv[++i];
  else if (a === "--list-models") listModels = true;
  else inline.push(a);
}

// --- 認証プリフライト(スタックトレースでなく人間向けメッセージに) ---
function keyMissing() {
  return !process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY;
}
if (keyMissing()) {
  console.error([
    "✗ GEMINI_API_KEY が未設定です。Gemini はこのアカウントでは APIキー方式のみ動作します。",
    "  1) https://aistudio.google.com/apikey で無料キーを発行",
    "  2) PowerShell:  setx GEMINI_API_KEY \"<key>\"  (新しいシェルで有効)",
    "     もしくは  ~/.gemini/.env  に  GEMINI_API_KEY=<key>  を1行",
    "  ※ キーは環境変数/ .env にのみ置く。ソースやコミットに書かない。",
  ].join("\n"));
  process.exit(2);
}

// --- モデル一覧(最新ID確認用) ---
if (listModels) {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
  if (!res.ok) { console.error("model list failed:", res.status, await res.text().catch(() => "")); process.exit(1); }
  const j = await res.json();
  for (const m of j.models || []) {
    if ((m.supportedGenerationMethods || []).includes("generateContent"))
      console.log(m.name.replace(/^models\//, ""), "—", m.displayName || "");
  }
  process.exit(0);
}

// --- ペルソナ(採点させない。初見の目だけ) ---
const PERSONAS = {
  playtester: `あなたは、このゲーム/画面を「今はじめて見た普通のプレイヤー」です。ゲームデザイナーでも専門家でもありません。
重要な制約:
- 点数・評価・スコアは出さないでください。
- 賢く・専門的に見せようとしないでください。素直に、短く、率直に。
次の3つだけ答えてください(各短く):
1) 第一印象(2-3文): 最初の3秒で何を感じ・気づく? かっこいい所/分かりにくい所/ダサい所は?
2) 引っかかり(最大3つ): 初見の人が理解できない・誤解しそうな具体的な箇所を挙げる。
3) 突飛な思いつき(1つだけ): 予想外の提案を1つ。変でも間違っててもOK。
あなたの意見はだいたい的外れで構いません。正直であることだけが大事です。`,
};
const personaText = PERSONAS[persona] || PERSONAS.playtester;

// --- brief(コンテキスト=何を見るか)を組む ---
let briefText = "";
if (brief) { if (!existsSync(brief)) { console.error("brief not found:", brief); process.exit(1); } briefText = readFileSync(brief, "utf8"); }
if (inline.length) briefText += (briefText ? "\n" : "") + inline.join(" ");
if (!imgs.length && !briefText) { console.error("画像(--img)かブリーフ(--brief/インライン)を1つは渡してください。"); process.exit(1); }

// 画像を絶対@パスで注入(gemini の @ 構文はファイル内容=画像をマルチモーダルで取り込む)
const absImgs = imgs.map(p => { const ap = path.resolve(p); if (!existsSync(ap)) { console.error("image not found:", ap); process.exit(1); } return ap; });
const imgDirs = [...new Set(absImgs.map(p => path.dirname(p)))];
const imgTokens = absImgs.map(p => "@" + p).join(" ");

const prompt = `${personaText}\n\n== 見てほしいもの ==\n${briefText || "(添付の画像/映像)"}\n\n${imgTokens}`;

// --- gemini 呼び出し(cwd=temp で巨大リポのworkspace走査を避け、画像親dirだけ include) ---
const geminiBin = process.platform === "win32" ? "gemini.cmd" : "gemini";
const args = ["-m", model, "-p", prompt];
for (const d of imgDirs) { args.push("--include-directories", d); }

const child = spawn(geminiBin, args, { cwd: tmpdir(), shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] });
let stdout = "", stderr = "";
child.stdout.on("data", d => { stdout += d; });
child.stderr.on("data", d => { stderr += d; });
child.on("error", e => { console.error("gemini 起動失敗:", e.message, "\n(gemini CLI が PATH にあるか確認)"); process.exit(1); });
child.on("close", code => {
  const body = stdout.trim();
  if (code !== 0 || !body) {
    console.error(`gemini exit ${code}`);
    if (stderr) console.error(stderr.split("\n").slice(-8).join("\n"));
    process.exit(code || 1);
  }
  const header = `# Gemini 素人枠レビュー（${model}）\n> 役割=初見プレイヤーのワイルドカード。**大半は的外れ前提**。Claudeが稀に刺さる1点だけ拾う。\n\n`;
  const md = header + body + "\n";
  if (out) { writeFileSync(out, md); console.log("→", out); }
  else console.log(md);
});
