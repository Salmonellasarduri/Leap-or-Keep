// アートのWebP圧縮(Web公開: スマホ初回ロード対策。元PNGは tmp/art-png/ へ退避)
// usage: node tools/compress-art.mjs
import sharp from "sharp";
import { readdirSync, mkdirSync, renameSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const ART = path.join(ROOT, "art");
const BAK = path.join(ROOT, "tmp", "art-png");
mkdirSync(BAK, { recursive: true });

let before = 0, after = 0;
for (const f of readdirSync(ART).filter(f => f.endsWith(".png"))) {
  const src = path.join(ART, f);
  const out = path.join(ART, f.replace(/\.png$/, ".webp"));
  before += statSync(src).size;
  // 背景アートは1280px幅で十分(表示は最大でもビューポート幅)
  await sharp(src).resize({ width: 1280, withoutEnlargement: true }).webp({ quality: 80 }).toFile(out);
  after += statSync(out).size;
  renameSync(src, path.join(BAK, f));
  console.log(`${f} -> ${path.basename(out)} (${(statSync(out).size / 1024).toFixed(0)}KB)`);
}
console.log(`total: ${(before / 1048576).toFixed(1)}MB -> ${(after / 1048576).toFixed(2)}MB`);
