import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createStore } from './store.js';
import { createMetrics } from './metrics.js';
import { AppError } from './validation.js';

const ASSETS = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
]);
const MAX_BODY_BYTES = 8192;

function send(res, status, body, contentType = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': contentType });
  if (status === 204) return res.end();
  res.end(contentType.startsWith('application/json') ? JSON.stringify(body) : body);
}

function readJson(req) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new AppError(415, 'Use Content-Type: application/json.');
  }
  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    let rejected = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (rejected) return;
      if (size > MAX_BODY_BYTES) {
        rejected = true;
        chunks = [];
        reject(new AppError(413, 'Request body is too large.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (rejected) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new AppError(400, 'Request body must be valid JSON.')); }
    });
    req.on('error', reject);
  });
}

function securityHeaders(res) {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
}

export function createApp({ databasePath = ':memory:', environment = 'development', version = 'dev', logger = console.log } = {}) {
  const store = createStore(databasePath);
  const metrics = createMetrics();
  const started = performance.now();
  const uptime = () => (performance.now() - started) / 1000;
  const assets = new Map([...ASSETS].map(([path, [name, type]]) => [path,
    [readFileSync(new URL(`../public/${name}`, import.meta.url)), type]]));

  async function route(req, res, url, setLabel) {
    const path = url.pathname;
    if (req.method === 'GET' && assets.has(path)) {
      setLabel('static');
      const [body, type] = assets.get(path);
      return send(res, 200, body, type);
    }
    if (req.method === 'GET' && path === '/health') {
      setLabel('/health');
      const healthy = store.healthy();
      return send(res, healthy ? 200 : 503, { status: healthy ? 'ok' : 'unhealthy', environment, version });
    }
    if (req.method === 'GET' && path === '/metrics') {
      setLabel('/metrics');
      return send(res, 200, metrics.render(store.stats(), uptime()), 'text/plain; version=0.0.4; charset=utf-8');
    }
    if (req.method === 'GET' && path === '/api/info') {
      setLabel('/api/info');
      return send(res, 200, { name: 'Taskboard', environment, version });
    }
    if (req.method === 'GET' && path === '/api/stats') {
      setLabel('/api/stats');
      return send(res, 200, store.stats());
    }
    if (path === '/api/tasks') {
      setLabel('/api/tasks');
      if (req.method === 'GET') return send(res, 200, { tasks: store.list(url.searchParams) });
      if (req.method === 'POST') {
        const task = store.create(await readJson(req));
        res.setHeader('Location', `/api/tasks/${task.id}`);
        return send(res, 201, task);
      }
      res.setHeader('Allow', 'GET, POST');
      throw new AppError(405, 'Method not allowed.');
    }
    const match = /^\/api\/tasks\/([^/]+)$/.exec(path);
    if (match) {
      setLabel('/api/tasks/:id');
      if (req.method === 'GET') return send(res, 200, store.get(match[1]));
      if (req.method === 'PATCH') return send(res, 200, store.update(match[1], await readJson(req)));
      if (req.method === 'DELETE') {
        store.remove(match[1]);
        return send(res, 204);
      }
      res.setHeader('Allow', 'GET, PATCH, DELETE');
      throw new AppError(405, 'Method not allowed.');
    }
    throw new AppError(404, 'Route not found.');
  }

  const server = createServer(async (req, res) => {
    securityHeaders(res);
    const start = performance.now();
    let label = 'unmatched';
    res.on('finish', () => {
      const seconds = (performance.now() - start) / 1000;
      metrics.observe(req.method, label, res.statusCode, seconds);
      logger(JSON.stringify({ method: req.method, route: label, status: res.statusCode, durationMs: Math.round(seconds * 1000) }));
    });
    try {
      // A fixed URL base avoids trusting the Host header for URL parsing.
      const url = new URL(req.url, 'http://localhost');
      if (['POST', 'PATCH', 'DELETE'].includes(req.method) && req.headers.origin) {
        let origin;
        try { origin = new URL(req.headers.origin); }
        catch { throw new AppError(403, 'Invalid request origin.'); }
        if (origin.host !== req.headers.host || origin.protocol !== 'http:') {
          throw new AppError(403, 'Cross-origin changes are not allowed.');
        }
      }
      await route(req, res, url, (value) => { label = value; });
    } catch (error) {
      req.resume();
      const status = error instanceof AppError ? error.status : 500;
      if (status === 500) logger(JSON.stringify({ error: 'Internal application error' }));
      send(res, status, { error: status === 500 ? 'Internal server error.' : error.message });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.on('close', () => store.close());
  return { server, store };
}
