/**
 * 스마트 소비 분석기 - 로컬 정적 서버
 * Node 내장 모듈만 사용 (추가 설치 불필요)
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const PORT = Number(process.env.PORT) || 5500;
const ROOT = __dirname;

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

function openBrowser(url) {
  const cmd =
    process.platform === "win32"
      ? `cmd /c start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

const server = http.createServer((req, res) => {
  try {
    const reqUrl = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
    let rel = decodeURIComponent(reqUrl.pathname);
    if (rel === "/") rel = "/index.html";

    const filePath = path.normalize(path.join(ROOT, rel));
    if (!filePath.startsWith(ROOT)) {
      return send(res, 403, "Forbidden");
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
    console.error(`[ERROR] Port ${PORT} is already in use.`);
    console.error("Close the other program using that port, then try again.");
  } else {
    console.error("[ERROR] Failed to start server:", err.message);
  }
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${PORT}/index.html`;
  console.log("");
  console.log("  ========================================");
  console.log("   Smart Expense Tracker");
  console.log("  ========================================");
  console.log(`  Server: ${url}`);
  console.log("  Keep this window open while using the app.");
  console.log("  Press Ctrl+C to stop.");
  console.log("");
  openBrowser(url);
});
