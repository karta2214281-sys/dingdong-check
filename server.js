'use strict';
// 網站伺服器：提供 public/ 的頁面，以及 POST /check 檢查錯字。
// 文章只在記憶體裡處理，不寫進檔案、資料庫或 log。

const http = require('http');
const fs = require('fs');
const path = require('path');
const { check } = require('./lib/check');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.resolve(__dirname, 'public');
const MAX_BODY = 1000000;
// 一次最多檢查的字數（不算空白和換行），要跟 public/client.js 的 MAX_CHARS 一樣
const MAX_CHARS = 100000;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8');
}

function plain(res, status, body) {
  send(res, status, body, 'text/plain; charset=utf-8');
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = (err, val) => {
      if (done) return;
      done = true;
      if (err) reject(err);
      else resolve(val);
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        const err = new Error('too big');
        err.status = 413;
        finish(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => finish(null, Buffer.concat(chunks)));
    req.on('error', finish);
  });
}

function publicFile(urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (rel.includes('\0')) return null;
  if (rel === '/') rel = '/index.html';
  const file = path.resolve(PUBLIC, '.' + rel);
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) return null;
  if (!TYPES[path.extname(file)]) return null;
  return file;
}

async function handleCheck(req, res) {
  let raw;
  try {
    raw = await readBody(req, MAX_BODY);
  } catch (err) {
    sendJson(res, err.status || 400, { error: err.status === 413 ? '文章太長' : '讀取失敗' });
    return;
  }
  let text;
  try {
    const body = JSON.parse(raw.toString('utf8') || '{}');
    if (!body || typeof body.text !== 'string') throw new Error('bad');
    text = body.text;
  } catch {
    sendJson(res, 400, { error: '格式不正確' });
    return;
  }
  if (text.replace(/\s/g, '').length > MAX_CHARS) {
    sendJson(res, 413, { error: '文章太長' });
    return;
  }
  sendJson(res, 200, { issues: check(text, { suggestions: true }) });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && url.pathname === '/check') {
    handleCheck(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: '檢查失敗' });
    });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    plain(res, 405, '不支援的方法');
    return;
  }
  // 給 UptimeRobot 之類的監測服務用，讓 Render 免費方案不會休眠。回應很小，不會吃流量。
  if (url.pathname === '/healthz') {
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end();
    } else {
      plain(res, 200, 'ok');
    }
    return;
  }
  const file = publicFile(url.pathname);
  if (!file) {
    plain(res, 404, '找不到');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      plain(res, 404, '找不到');
      return;
    }
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)], 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    send(res, 200, data, TYPES[path.extname(file)]);
  });
});

server.listen(PORT, () => {
  console.log('訂咚錯字檢查器 http://127.0.0.1:' + PORT + '/');
});
