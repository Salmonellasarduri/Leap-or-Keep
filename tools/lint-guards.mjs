// Leap or Keep — 静的ガード(lessons の機械化)
// 「二度と踏まない」を散文でなくコードで固定する。プロンプト記載は従われない(lesson-record 卒業パス4)。
// usage: node tools/lint-guards.mjs
//   全ガード PASS で exit 0 / いずれか違反で exit 1(index.html の実行番で位置を報告)
//
// 由来 lessons:
//   L-037 LOGIC 区間純度   … LOGIC-START〜END に DOM/import/three 参照が入ると sim+agent が全滅する
//   L-038 EN_RULES.unshift … i18n ルールを push すると末尾の汎用「$1 — $2」分割に食われ発火しない
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(here, "..", "index.html");
const src = readFileSync(file, "utf8");
const lines = src.split("\n");

let violations = 0;
const fail = (line, rule, msg) => {
  violations++;
  console.error(`  VIOLATION [${rule}] index.html:${line}\n    ${msg}`);
};

// ---- Guard 1 (L-037): LOGIC 区間はブラウザ/モジュール参照ゼロ ----
// tests/sim.mjs と agent は LOGIC-START〜END を node:vm({module,console}のみ)で評価する。
// document/window/import/THREE 等が居ると評価時に ReferenceError で全テストが道連れになる。
const startIdx = lines.findIndex(l => l.includes("LOGIC-START"));
const endIdx = lines.findIndex(l => l.includes("LOGIC-END"));
if (startIdx < 0 || endIdx < 0) {
  console.error("  VIOLATION [logic-markers] LOGIC-START/END マーカーが見つからない(tests/sim.mjs も抽出不能)");
  violations++;
} else {
  // 単語境界での識別子参照を禁止。直前が「.」のプロパティアクセス(obj.location 等)は
  // vm 上で無害なので (?<!\.) で除外し、素の global 参照だけを違反にする。
  const FORBIDDEN = /(?<![.\w])(document|window|globalThis|localStorage|sessionStorage|THREE|addEventListener|removeEventListener|querySelector|querySelectorAll|getElementById|requestAnimationFrame|cancelAnimationFrame|navigator|location)\b/;
  const IMPORTS = /(^|;)\s*(import|export)\s|[^.\w]require\s*\(/;
  for (let i = startIdx + 1; i < endIdx; i++) {
    const raw = lines[i];
    // 行コメント除去(素朴でよい: 文字列内の // は稀、誤検知しても安全側)
    const code = raw.replace(/\/\/.*$/, "");
    if (FORBIDDEN.test(code)) {
      fail(i + 1, "logic-purity", `禁止識別子: ${code.match(FORBIDDEN)[0]} — LOGIC 区間は純ロジックのみ。UI/描画は LOGIC-END の外へ`);
    }
    if (IMPORTS.test(code)) {
      fail(i + 1, "logic-purity", `import/export/require は LOGIC 区間に置けない(vm 評価が壊れる)`);
    }
  }
}

// ---- Guard 2 (L-038): EN_RULES への追加は unshift のみ ----
// EN_RULES は先勝ち。末尾に汎用分割ルール(^(.+) — (.+)$ 等)が居るため push した具体ルールは届かない。
lines.forEach((raw, i) => {
  const code = raw.replace(/\/\/.*$/, "");
  if (/\bEN_RULES\s*\.\s*push\s*\(/.test(code)) {
    fail(i + 1, "en-rules-unshift", "EN_RULES.push は汎用分割ルールに食われる。EN_RULES.unshift(...) を使う");
  }
});

if (violations) {
  console.error(`\nlint-guards: ${violations} 件の違反。上記を修正すること。`);
  process.exit(1);
}
console.log("lint-guards: OK — LOGIC純度(L-037) / EN_RULES.unshift(L-038) 合格");
