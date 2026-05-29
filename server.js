const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

// Было: const PORT = 8765; const HOST = "127.0.0.1";
// Стало под Render:
const PORT = process.env.PORT || 8765;
const HOST = "0.0.0.0"; 
const ROOT = __dirname;
const STATE_FILE = path.join(ROOT, "juno-shared-state.json");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

async function readSharedState() {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeSharedState(parsed);
  } catch {
    return normalizeSharedState({});
  }
}

function normalizeSharedState(value) {
  return {
    users: Array.isArray(value.users) ? value.users : [],
    chats: Array.isArray(value.chats) ? value.chats : [],
    messages: value.messages && typeof value.messages === "object" ? value.messages : {},
    presence: value.presence && typeof value.presence === "object" ? value.presence : {},
    typing: value.typing && typeof value.typing === "object" ? value.typing : {},
    calls: value.calls && typeof value.calls === "object" ? value.calls : {},
  };
}

async function writeSharedState(value) {
  await fs.writeFile(STATE_FILE, JSON.stringify(normalizeSharedState(value), null, 2), "utf8");
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  response.end(JSON.stringify(value));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 25 * 1024 * 1024) {
        reject(new Error("Request body is too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.resolve(ROOT, `.${requestedPath}`);

  if (!filePath.startsWith(ROOT)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    response.end(file);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") {
      sendJson(response, 204, {});
      return;
    }

    if (request.url.startsWith("/api/state")) {
      if (request.method === "GET") {
        sendJson(response, 200, await readSharedState());
        return;
      }

      if (request.method === "POST") {
        const body = await readBody(request);
        await writeSharedState(JSON.parse(body || "{}"));
        sendJson(response, 200, await readSharedState());
        return;
      }

      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }

    if (request.method === "GET" || request.method === "HEAD") {
      await serveStatic(request, response);
      return;
    }

    response.writeHead(405);
    response.end("Method not allowed");
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Juno server: http://${HOST}:${PORT}/index.html`);
});
