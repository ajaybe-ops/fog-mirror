#!/usr/bin/env node
/**
 * Zero-dependency static server for FOG MIRROR.
 *
 *   npm start            # http://127.0.0.1:8765
 *   PORT=3000 npm start  # custom port
 *
 * Camera and microphone require a secure context: localhost is treated as
 * secure by browsers, so local development works without TLS.
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

const ROOT = resolve(process.cwd());
const PORT = Number(process.env.PORT || process.argv[2] || 8765);
const HOST = process.env.HOST || "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

function send(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(body);
}

const server = createServer(async (request, response) => {
  try {
    if (request.method !== "GET" && request.method !== "HEAD") {
      send(response, 405, "Method Not Allowed", { Allow: "GET, HEAD" });
      return;
    }

    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      send(response, 400, "Bad Request");
      return;
    }

    let target = resolve(ROOT, `.${normalize(pathname)}`);
    if (target !== ROOT && !target.startsWith(ROOT + sep)) {
      send(response, 403, "Forbidden");
      return;
    }

    let info = await stat(target);
    if (info.isDirectory()) {
      target = join(target, "index.html");
      info = await stat(target);
    }
    if (!info.isFile()) {
      send(response, 404, "Not Found");
      return;
    }

    const body = await readFile(target);
    const headers = {
      "Content-Type": MIME[extname(target).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": String(body.byteLength),
    };
    if (request.method === "HEAD") {
      response.writeHead(200, headers);
      response.end();
      return;
    }
    send(response, 200, body, headers);
  } catch (error) {
    if (error && error.code === "ENOENT") send(response, 404, "Not Found");
    else {
      console.error(error);
      send(response, 500, "Internal Server Error");
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  FOG MIRROR\n  http://${HOST}:${PORT}\n  Ctrl+C to stop\n`);
});
