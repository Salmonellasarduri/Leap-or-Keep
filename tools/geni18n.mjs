// i18n辞書注入: tools/i18n/i18n-*.part.json({exact:{JP:EN}, rules:[[regexSrc, tpl]]})をマージし、
// index.html の I18N-DICT-START/END マーカー間へ生成コードを書き込む。再実行可(冪等)。
// ファイル名昇順にマージ、重複キー/ルールは先勝ち — i18n-aaa-fix が最優先の上書き層。
// usage: node tools/geni18n.mjs
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIR = path.join(ROOT, "tools", "i18n");
const parts = readdirSync(DIR).filter(f => /^i18n-.*\.part\.json$/.test(f)).sort();
if (!parts.length) { console.error("no tools/i18n/i18n-*.part.json found"); process.exit(1); }

const exact = {}, rules = [];
for (const f of parts) {
  const j = JSON.parse(readFileSync(path.join(DIR, f), "utf8"));
  for (const [k, v] of Object.entries(j.exact || {})) {
    const key = k.trim();
    if (exact[key] && exact[key] !== v) console.warn(`dup key (kept first): ${key}`);
    else exact[key] = v;
  }
  for (const r of j.rules || []) {
    try { new RegExp(r[0]); rules.push(r); }
    catch (e) { console.warn(`bad regex skipped (${f}): ${r[0]}`); }
  }
}

const file = path.join(ROOT, "index.html");
const html = readFileSync(file, "utf8");
const S = "/* I18N-DICT-START", E = "/* I18N-DICT-END */";
const i1 = html.indexOf(S), i2 = html.indexOf(E);
if (i1 < 0 || i2 < 0) { console.error("markers not found in index.html"); process.exit(1); }
const head = html.slice(0, i1), tail = html.slice(i2 + E.length);
const startLine = html.slice(i1, html.indexOf("*/", i1) + 2);
const block = `${startLine}
const EN_EXACT=${JSON.stringify(exact)};
const EN_RULES=${JSON.stringify(rules)};
${E}`;
writeFileSync(file, head + block + tail);
console.log(`injected from [${parts.join(", ")}]: ${Object.keys(exact).length} exact / ${rules.length} rules`);
