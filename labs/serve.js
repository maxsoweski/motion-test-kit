#!/usr/bin/env node
// Tiny static file server for kit labs. Modern Chrome blocks ES module
// imports over file:// (CORS), so labs need an HTTP origin. This isn't a
// "build step" — it's a static-file server with zero transformation.
//
//   node labs/serve.js [port]
//
// Default port: 5174 (avoids well-dipper's 5173).

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

const PORT = parseInt(process.argv[2] || process.env.PORT || '5174', 10);
const ROOT = resolve(import.meta.dirname, '..');

const MIME = {
  '.html': 'text/html',
  '.js':   'text/javascript',
  '.mjs':  'text/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.webm': 'video/webm',
};

const server = createServer(async (req, res) => {
  let pathname = decodeURIComponent(req.url.split('?')[0]);
  if (pathname === '/') pathname = '/labs/accumulator-lab.html';
  const fsPath = resolve(ROOT + pathname);
  if (!fsPath.startsWith(ROOT)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  try {
    const s = await stat(fsPath);
    if (s.isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    const data = await readFile(fsPath);
    const mime = MIME[extname(fsPath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': mime, 'cache-control': 'no-cache' });
    res.end(data);
  } catch (e) {
    res.writeHead(404); res.end('not found');
  }
});

// Bind explicitly to 0.0.0.0 so WSL2 localhost forwarding to Windows works
// (default-bind sometimes lands on ::1-only, which Windows Chrome can't reach).
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Kit labs serving at http://localhost:${PORT}/`);
  console.log(`  Accumulator lab:  http://localhost:${PORT}/labs/accumulator-lab.html`);
});
