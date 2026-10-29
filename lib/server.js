'use strict';

const http = require('http');
const crypto = require('crypto');
const os = require('os');
const { spawn } = require('child_process');
const { loadAll } = require('./goals');
const { renderHtml } = require('./render');

function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true })
      .on('error', () => {})
      .unref();
  } catch (_) {
    /* best effort */
  }
}

// IPv4 addresses usable by another device on the local network. Skip loopback and
// link-local addresses, which are not useful for connecting from a phone or tablet.
function lanUrls(port) {
  const out = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const address of entries || []) {
      if ((address.family === 'IPv4' || address.family === 4) && !address.internal &&
          !address.address.startsWith('169.254.')) out.push(`http://${address.address}:${port}`);
    }
  }
  return [...new Set(out)].sort();
}

// Is a goalpulse server for this root answering at url? (Used to reuse a running dashboard.)
function ping(url, root) {
  return new Promise((resolve) => {
    const req = http.get(url + '/api/goals', { timeout: 800 }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          resolve(res.statusCode === 200 && Array.isArray(j.goals) && (!root || j.root === root));
        } catch (_) {
          resolve(false);
        }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

// Read-only server: GET / serves the dashboard, GET /api/goals serves every goal's state.
// Binds to all interfaces by default for local-network access. With idleExitMs the process
// exits after that long without a request, so a background dashboard never lingers forever.
function serve({ root, port = 4317, host = '0.0.0.0', idleExitMs = 0 }) {
  return new Promise((resolve, reject) => {
    let last = Date.now();
    const server = http.createServer((req, res) => {
      last = Date.now();
      const url = new URL(req.url, 'http://localhost');
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405).end();
        return;
      }
      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(renderHtml(null));
      } else if (url.pathname === '/favicon.ico') {
        res.writeHead(204).end();
      } else if (url.pathname === '/api/goals') {
        const goals = loadAll(root);
        const etag =
          'W/"' +
          crypto
            .createHash('md5')
            .update(goals.map((g) => `${g.slug}:${g.rev}:${g.archived}`).join('|'))
            .digest('hex') +
          '"';
        if (req.headers['if-none-match'] === etag) {
          res.writeHead(304, { ETag: etag }).end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', ETag: etag });
        res.end(JSON.stringify({ root, goals }));
      } else {
        res.writeHead(404).end('not found');
      }
    });

    let tries = 0;
    server.on('error', (err) => {
      if (/** @type {NodeJS.ErrnoException} */ (err).code === 'EADDRINUSE' && tries++ < 10) server.listen(++port, host);
      else reject(err);
    });
    server.listen(port, host, () => {
      if (idleExitMs)
        setInterval(() => {
          if (Date.now() - last > idleExitMs) process.exit(0);
        }, 30000);
      const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;
      resolve({ server, port, host, url, lanUrls: host === '0.0.0.0' ? lanUrls(port) : [] });
    });
  });
}

module.exports = { serve, ping, openBrowser, lanUrls };
