// Serves .email-previews/ over HTTP so the rendered emails can be inspected in
// a browser (file:// pages block remote images and devtools-style checks).
// Run: npm run email:preview:serve  (defaults to http://localhost:3010)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = path.join(process.cwd(), ".email-previews");
const port = Number(process.env.PORT || 3010);

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": file.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream", "cache-control": "no-store" });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, () => console.log(`email previews at http://localhost:${port}/`));
