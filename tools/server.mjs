// minimal static server for preview (no deps)
import { createServer } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

const root = await realpath(process.cwd());
const PORT = Number(process.argv[2] || 8321);
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml",
  ".webp": "image/webp", ".glb": "model/gltf-binary" };
const PUBLIC_FILES = new Set(["/index.html", "/holo.js"]);
const PUBLIC_PREFIXES = ["/art/", "/vendor/"];

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html";
    const candidate = await realpath(path.resolve(root, "." + p));
    if (candidate !== root && !candidate.startsWith(root + path.sep)) {
      res.writeHead(403, { "content-type": "text/plain" }); res.end("403");
      return;
    }
    const publicPath = "/" + path.relative(root, candidate).split(path.sep).join("/");
    if (!PUBLIC_FILES.has(publicPath) && !PUBLIC_PREFIXES.some(prefix => publicPath.startsWith(prefix))) {
      res.writeHead(404, { "content-type": "text/plain" }); res.end("404");
      return;
    }
    const data = await readFile(candidate);
    res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }); res.end("404");
  }
}).listen(PORT, "127.0.0.1", () => console.log("static server on http://localhost:" + PORT));
