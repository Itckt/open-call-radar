import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.env.PORT || 4173);
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".csv": "text/csv", ".svg": "image/svg+xml", ".json": "application/json" };
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const relative = pathname.replace(/^\/+/, "") || "index.html";
    const target = path.resolve(root, relative);
    if (!target.startsWith(root + path.sep) || relative.split(/[\\/]/).some(part => part.startsWith("."))) {
      response.writeHead(403); response.end("Forbidden"); return;
    }
    const body = await fs.readFile(target);
    response.writeHead(200, { "Content-Type": (types[path.extname(target)] || "application/octet-stream") + "; charset=utf-8", "Cache-Control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});
server.listen(port, "127.0.0.1", () => console.log("Local: http://127.0.0.1:" + port));
