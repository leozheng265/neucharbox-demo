// The contract mock (test/fixtures/live-mock.mjs) over HTTP, for browser checks of the live client.
// Usage: node test/mock-live.mjs [port=8787] [--pace 350] [--mode json|html|down] [--code NCB-TEST-CASE] [--scenes home,elder] [--origin http://localhost:8765]
// The page is served on http://localhost:8765 (serve.py; any other localhost port works too); point it here with
// ?liveApi=http://localhost:<port>.
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { createMockLive, MOCK_CODE } from './fixtures/live-mock.mjs';

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : def; };
const port = Number(argv.find((a, i) => /^\d+$/.test(a) && !argv[i - 1]?.startsWith('--')) || 8787);
const code = opt('code', MOCK_CODE), mode = opt('mode', 'json'), pace = Number(opt('pace', 0)), scenes = opt('scenes', 'home').split(',').filter(Boolean);
const ORIGIN = opt('origin', 'http://localhost:8765'); // the page's origin (CORS); --origin http://localhost:8766 for a second worktree
const mock = createMockLive({ code, mode, pace, scenes, scene: scenes[0] });
// The page's origin when it is a local one (a second preview server, e.g. serve.py 8766), else serve.py's default.
const corsFor = (origin) => ({ 'access-control-allow-origin': /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '') ? origin : ORIGIN, vary: 'Origin' });

const server = createServer(async (req, res) => {
  if (mode === 'down') { req.socket.destroy(); return; }
  const CORS = corsFor(req.headers.origin);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...CORS, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'Authorization, Content-Type, Accept, ngrok-skip-browser-warning', 'access-control-max-age': '600' });
    res.end(); return;
  }
  const chunks = []; for await (const c of req) chunks.push(c);
  const ac = new AbortController(); res.on('close', () => ac.abort());
  try {
    const r = await mock.fetch(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks).toString('utf8') : undefined, signal: ac.signal });
    res.writeHead(r.status, { ...Object.fromEntries(r.headers), ...CORS });
    res.flushHeaders(); // an event stream with nothing to say yet must still answer
    if (r.body) Readable.fromWeb(r.body).on('error', () => res.end()).pipe(res); else res.end();
  } catch { res.destroy(); }
});
server.listen(port, () => console.log(`mock live server on http://localhost:${port} · code ${code}`));
