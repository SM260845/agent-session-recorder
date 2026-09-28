import http from 'node:http';
import fs from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';
import { listSessions, readSession, sessionFile, parseJsonl } from './store.js';
import { renderPage } from './ui.js';

/** Local-only viewer: HTTP + WebSocket live stream. Binds 127.0.0.1 by default. */
export function startViewer(opts: { port?: number; host?: string; pollMs?: number } = {}): Promise<{ server: http.Server; url: string; close: () => Promise<void> }> {
  const host = opts.host ?? '127.0.0.1';
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const json = (v: unknown) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
    if (url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(renderPage({ title: 'agent-blackbox viewer', live: true })); return; }
    if (url.pathname === '/api/sessions') return json(listSessions());
    const m = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (m) return json(readSession(decodeURIComponent(m[1])));
    res.writeHead(404); res.end('not found');
  });
  const wss = new WebSocketServer({ server, path: '/ws' });
  const timers = new Set<NodeJS.Timeout>();
  wss.on('connection', (ws: WebSocket, req) => {
    const id = new URL(req.url ?? '', 'http://x').searchParams.get('session') ?? '';
    const file = sessionFile(id);
    let offset = fs.existsSync(file) ? fs.statSync(file).size : 0;
    let buf = '';
    const t = setInterval(() => {
      if (!fs.existsSync(file)) return;
      const size = fs.statSync(file).size;
      if (size <= offset) return;
      const fd = fs.openSync(file, 'r');
      const chunk = Buffer.alloc(size - offset);
      fs.readSync(fd, chunk, 0, chunk.length, offset);
      fs.closeSync(fd);
      offset = size;
      buf += chunk.toString('utf8');
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const e of parseJsonl(lines.join('\n'))) ws.send(JSON.stringify(e));
    }, opts.pollMs ?? 300);
    timers.add(t);
    ws.on('close', () => { clearInterval(t); timers.delete(t); });
  });
  return new Promise((resolve) => {
    server.listen(opts.port ?? 4318, host, () => {
      const addr = server.address() as { port: number };
      resolve({
        server, url: `http://${host}:${addr.port}`,
        close: () => new Promise<void>((r) => { timers.forEach(clearInterval); wss.clients.forEach((c) => c.terminate()); wss.close(); server.close(() => r()); }),
      });
    });
  });
}
