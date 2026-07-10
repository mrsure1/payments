/**
 * 스마트 소비 분석기 - 로컬 정적 서버 + 공유 데이터 API
 * Node 내장 모듈만 사용 (추가 설치 불필요)
 *
 * localhost / 127.0.0.1 이 서로 다른 LocalStorage를 쓰므로
 * data/store.json 으로 양쪽 데이터를 합쳐 공유합니다.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const PORT = Number(process.env.PORT) || 5500;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const STORE_PATH = path.join(DATA_DIR, "store.json");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
}

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(STORE_PATH)) {
    const empty = {
      schema: [],
      data: {},
      google_client_id: "",
      google_api_key: "",
      theme: "",
      updatedAt: null,
    };
    fs.writeFileSync(STORE_PATH, JSON.stringify(empty, null, 2), "utf8");
  }
}

function readStore() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
  } catch {
    return { schema: [], data: {}, google_client_id: "", google_api_key: "", theme: "", updatedAt: null };
  }
}

function writeStore(payload) {
  ensureStore();
  const next = {
    schema: Array.isArray(payload.schema) ? payload.schema : [],
    data: payload.data && typeof payload.data === "object" ? payload.data : {},
    google_client_id: payload.google_client_id || "",
    google_api_key: payload.google_api_key || "",
    theme: payload.theme || "",
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(STORE_PATH, JSON.stringify(next, null, 2), "utf8");
  return next;
}

function openBrowser(url) {
  const cmd =
    process.platform === "win32"
      ? `cmd /c start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url || "/", `http://localhost:${PORT}`);
    let rel = decodeURIComponent(reqUrl.pathname);

    if (req.method === "OPTIONS") {
      return send(res, 204, "", {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
    }

    // 공유 데이터 API
    if (rel === "/api/data") {
      if (req.method === "GET") {
        return sendJson(res, 200, readStore());
      }
      if (req.method === "POST") {
        const raw = await readBody(req);
        let payload;
        try {
          payload = JSON.parse(raw || "{}");
        } catch {
          return sendJson(res, 400, { error: "Invalid JSON" });
        }
        return sendJson(res, 200, writeStore(payload));
      }
      return sendJson(res, 405, { error: "Method Not Allowed" });
    }

    if (rel === "/") rel = "/index.html";

    const filePath = path.normalize(path.join(ROOT, rel));
    if (!filePath.startsWith(ROOT)) {
      return send(res, 403, "Forbidden");
    }

    // data 폴더는 API로만 접근
    if (filePath.startsWith(DATA_DIR)) {
      return send(res, 404, "Not Found");
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      return send(res, 404, "Not Found");
    }

    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || "application/octet-stream";
    const data = fs.readFileSync(filePath);
    send(res, 200, data, {
      "Content-Type": type,
      "Cache-Control": "no-store",
    });
  } catch (err) {
    send(res, 500, "Server Error");
    console.error(err);
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    const url = `http://127.0.0.1:${PORT}/index.html`;
    console.error(`[ERROR] Port ${PORT} is already in use.`);
    console.error("Opening the existing server in your browser...");
    openBrowser(url);
    console.error("If the page does not load, close other start.bat windows and retry.");
  } else {
    console.error("[ERROR] Failed to start server:", err.message);
  }
  process.exit(1);
});

// localhost / 127.0.0.1 모두 접속 가능하도록 모든 인터페이스에 바인딩
server.listen(PORT, "0.0.0.0", () => {
  ensureStore();
  const url = `http://127.0.0.1:${PORT}/index.html`;
  console.log("");
  console.log("  ========================================");
  console.log("   Smart Expense Tracker");
  console.log("  ========================================");
  console.log(`  Server: ${url}`);
  console.log(`  Also:   http://localhost:${PORT}/index.html`);
  console.log("  Shared store: data/store.json");
  console.log("  Keep this window open while using the app.");
  console.log("  Press Ctrl+C to stop.");
  console.log("");
  openBrowser(url);
});
