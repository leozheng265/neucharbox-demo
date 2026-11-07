// Check 18: the live client against the contract mock (test/fixtures/live-mock.mjs).
//   liveChecks({ report, initialOf, guardHits }) runs the checks below. Tasks 2-5 add the client's own; this file
//   also holds the harness they share (check / eq / ok / harness and the stub LiveView, panel and ui).
import { createStore } from '../js/engine/store.js';
import { virtualTime } from './clock.mjs';
import { createMockLive, MOCK_CODE } from './fixtures/live-mock.mjs';
import home from '../js/scenes/home.js';
import { LIVE_CONFIG, liveApiBase } from '../js/live-config.js';
import { createLiveApi, LiveError } from '../js/engine/liveapi.js';
import { createSseParser, openEventStream } from '../js/engine/sse.js';

export { MOCK_CODE };
const BASE = 'http://mock/live/api/';

export async function liveChecks({ report, initialOf, guardHits }) {
  const postSetup = (scene) => { const init = initialOf(scene); for (const [k, v] of Object.entries(init)) if (v && typeof v === 'object' && 'status' in v && k !== 'hub') v.status = 'online'; init.hub = { status: 'on', led: 1 }; return init; };
  const stores = new Set();
  let cur = []; // the running check's problems
  const eq = (got, want, what = '') => { if (JSON.stringify(got) !== JSON.stringify(want)) cur.push(`${what ? `${what}: ` : ''}got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); };
  const ok = (cond, what = 'check failed') => { if (!cond) cur.push(what); };

  // check(tag, fn): fn runs on the virtual clock (its onFrame ticks every store a harness made). A throw is a problem.
  async function check(tag, fn) {
    const problems = cur = [];
    const short = (e) => String(e.stack || e.message || e).split('\n').slice(0, 2).join(' | ');
    try { await virtualTime(fn, { onFrame: (now) => { for (const s of stores) s.tick(now); } }); } catch (e) { problems.push(`threw: ${short(e)}`); }
    stores.clear();
    report(tag, problems);
  }

  // The stub view / panel / ui the controller (js/engine/live.js) is written against, logging into one array.
  function harness({ mock = createMockLive(), storage, entered = false } = {}) {
    const log = [], store = createStore(postSetup(home)); stores.add(store);
    const rec = (source) => (method, ...args) => { log.push([source, method, ...args]); };
    const h = { mock, store, log, codes: null, card: null, checklist: null, lastAccess: null, live: null };
    const mem = (() => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; })();
    h.codes = storage ?? mem;
    const checklist = () => {
      const c = { steps: {}, texts: {}, pills: {}, loose: [] };
      c.mergeSteps = (steps) => { log.push(['checklist', 'mergeSteps', steps]); for (const s of steps) { c.texts[s.id] = s.text; c.steps[s.id] ??= 'pending'; } };
      c.step = (id, status) => { log.push(['checklist', 'step', id, status]); c.steps[id] = status; };
      c.call = ({ callId, step, label }) => { log.push(['checklist', 'call', callId, step, label]); c.pills[callId] = `${label} · …`; if (step == null) c.loose.push(callId); };
      c.result = ({ callId, text }) => { log.push(['checklist', 'result', callId, text]); const p = String(c.pills[callId] ?? '').split(' · ')[0]; c.pills[callId] = `${p} · ${text}`; };
      c.timeline = (row) => log.push(['checklist', 'timeline', row]);
      c.done = () => log.push(['checklist', 'done']);
      h.checklist = c; return c;
    };
    h.view = {
      ...Object.fromEntries(['user', 'ncb', 'chips', 'planning', 'reading', 'sayDelta', 'summary', 'endCard', 'failures', 'lost', 'input', 'live'].map((m) => [m, rec('view').bind(null, m)])),
      planCard(spec, { onApprove, onDecline }) {
        log.push(['view', 'planCard', spec]);
        const card = { enabled: false, approve: onApprove, decline: onDecline };
        for (const m of ['enable', 'busy', 'declined', 'close']) card[m] = (...a) => { if (m === 'enable') card.enabled = true; if (m === 'busy' || m === 'declined' || m === 'close') card.enabled = false; log.push(['card', m, spec.kind, ...a]); };
        card.toChecklist = (o) => { log.push(['card', 'toChecklist', spec.kind]); const c = checklist(); c.mergeSteps(spec.steps); return c; };
        for (const m of ['approve', 'decline']) { const f = card[m]; card[m] = () => f?.(); }
        h.card = card; return card;
      },
      checklist(steps, o) { log.push(['view', 'checklist', steps, o]); const c = checklist(); c.mergeSteps(steps); return c; },
      access(spec, { onCode, onApply, onBack }) {
        log.push(['view', 'access', spec]);
        const a = { code: (t) => onCode(t), apply: (f) => onApply(f), back: () => onBack(), close: rec('access').bind(null, 'close') };
        h.lastAccess = a; return a;
      },
    };
    h.panel = { mark: rec('panel').bind(null, 'mark'), reveal: rec('panel').bind(null, 'reveal') };
    let alive = true;
    h.ui = { alive: () => alive, ...Object.fromEntries(['status', 'beats', 'resetRoom', 'offerGuided', 'track', 'rewind'].map((m) => [m, rec('ui').bind(null, m)])), baseline: () => null };
    h.ui.kill = () => { alive = false; };
    h.find = (source, method) => log.filter((e) => e[0] === source && e[1] === method).at(-1)?.slice(2);
    h.has = (source, method, ...args) => log.some((e) => e[0] === source && e[1] === method && args.every((a, i) => JSON.stringify(e[2 + i]) === JSON.stringify(a)));
    h.order = (source, method, ...args) => log.findIndex((e) => e[0] === source && e[1] === method && args.every((a, i) => JSON.stringify(e[2 + i]) === JSON.stringify(a)));
    h.until = async (source, method) => { for (let i = 0; i < 4000 && !log.some((e) => e[0] === source && e[1] === method); i++) await new Promise((r) => setTimeout(r, 10)); return h.find(source, method); };
    if (entered) throw new Error('harness({ entered: true }) needs the live controller (Task 4)');
    return h;
  }

  const readFrames = async (res, n) => { // the first n frames of an event stream, as text
    const reader = res.body.getReader(), dec = new TextDecoder(); let buf = '';
    while ((buf.match(/\n\n/g) || []).length < n) { const r = await reader.read(); if (r.done) break; buf += dec.decode(r.value); }
    await reader.cancel();
    return buf.split('\n\n').filter(Boolean).slice(0, n).map((f) => `${f}\n\n`);
  };

  await check('mock · health and auth', async () => {
    const m = createMockLive(), j = async (r) => [r.status, await r.json()];
    eq(await j(await m.fetch(`${BASE}health`)), [200, { ok: true, liveEnabled: true, scenes: ['home'] }]);
    eq((await m.fetch(`${BASE}sessions`, { method: 'POST', body: '{"scene":"home"}' })).status, 401);
    const r = await m.fetch(`${BASE}sessions`, { method: 'POST', headers: { authorization: `Bearer ${MOCK_CODE.toLowerCase()}` }, body: '{"scene":"home"}' });
    const s = await r.json(); eq(r.status, 201);
    ok(s.sessionId && s.state.lamp.status === 'online' && s.suggestions.length >= 2 && s.clock.label === 'Fri 16:30', 'session body');
  });

  await check('mock · SSE framing and resume', async () => {
    const m = createMockLive(), auth = { authorization: `Bearer ${MOCK_CODE}` };
    const { sessionId } = await (await m.fetch(`${BASE}sessions`, { method: 'POST', headers: auth, body: '{"scene":"home"}' })).json();
    const stream = await m.fetch(`${BASE}sessions/${sessionId}/events`, { headers: auth });
    eq(stream.headers.get('content-type'), 'text/event-stream');
    const post = await m.fetch(`${BASE}sessions/${sessionId}/requests`, { method: 'POST', headers: auth, body: '{"text":"Movie night"}' });
    const { requestId } = await post.json(); eq([post.status, requestId], [202, 'r1']);
    eq(await readFrames(stream, 2), [
      `id: 1\nevent: planning\ndata: {"rid":"r1"}\n\n`,
      `id: 2\nevent: reading\ndata: {"device":"soil","rid":"r1"}\n\n`]);
    const again = await m.fetch(`${BASE}sessions/${sessionId}/events?after=2`, { headers: auth });
    const [f] = await readFrames(again, 1);
    ok(f.startsWith('id: 3\nevent: plan\ndata: {"steps":[{"id":"s1"') && f.endsWith(',"rid":"r1"}\n\n'), `resume frame: ${f.slice(0, 60)}`);
  });

  // A small client over the mock for the contract checks below.
  const rig = (opts) => {
    const m = createMockLive(opts), auth = { authorization: `Bearer ${MOCK_CODE}` };
    const post = async (path, body) => { const r = await m.fetch(`${BASE}${path}`, { method: 'POST', headers: auth, body: JSON.stringify(body ?? {}) }); return [r.status, await r.json()]; };
    const kinds = async (sid, after = 0) => { const r = await m.fetch(`${BASE}sessions/${sid}/events?after=${after}`, { headers: auth }); const rd = r.body.getReader(), dec = new TextDecoder(); let b = ''; for (;;) { const x = await Promise.race([rd.read(), new Promise((res) => setTimeout(() => res({ done: true }), 5))]); if (x.done) break; b += dec.decode(x.value); } await rd.cancel(); return [...b.matchAll(/event: (\w+)/g)].map((a) => a[1]); };
    const settle = () => new Promise((r) => setTimeout(r, 1));
    return { m, post, kinds, settle, session: async () => (await post('sessions', { scene: 'home' }))[1].sessionId };
  };

  await check('mock · contract: busy, errors, reset, done last', async () => {
    const { m, post, kinds, settle, session } = rig({ remaining: 1 }), sid = await session();
    const [, { requestId: rid }] = await post(`sessions/${sid}/requests`, { text: 'Movie night' }); await settle();
    eq((await post(`sessions/${sid}/requests`, { text: 'again' }))[1].error, 'busy', 'second request');
    eq(await post(`sessions/${sid}/reset`), [409, { error: 'busy', message: (await post(`sessions/${sid}/reset`))[1].message }], 'reset mid-request');
    await post(`sessions/${sid}/requests/${rid}/approve`); await settle();
    const ks = await kinds(sid); eq(ks.at(-1), 'done'); eq(ks.filter((k) => k === 'done').length, 1, 'one done');
    const n = ks.length; eq((await post(`sessions/${sid}/reset`))[0], 200); eq((await kinds(sid)).length, n, 'reset pushed an event');
    eq((await post(`sessions/${sid}/requests`, { text: 'again' }))[1].error, 'code_limit', 'remaining 0');
    m.set({ off: 'budget' }); eq((await post(`sessions/${sid}/requests`, { text: 'again' }))[1].error, 'budget', 'budget before code_limit');
    m.set({ off: 'live_off' }); eq((await post(`sessions/${sid}/requests`, { text: 'again' }))[0], 503);
  });

  await check('mock · contract: what-if order, declined runs', async () => {
    const { post, kinds, settle, session } = rig(), sid = await session();
    let [, { requestId: rid }] = await post(`sessions/${sid}/requests`, { text: 'Movie night' }); await settle();
    await post(`sessions/${sid}/requests/${rid}/approve`); await settle();
    const before = (await kinds(sid)).length;
    const [st, { requestId: w }] = await post(`sessions/${sid}/requests/${rid}/whatif`, { device: 'lamp' }); await settle();
    const wk = (await kinds(sid)).slice(before); eq(st, 202); ok(w !== rid);
    eq(wk.slice(0, 3), ['room', 'plan', 'step'], 'what-if starts room, plan, run'); ok(!wk.includes('awaiting_approval'), 'what-if asks nothing'); eq(wk.at(-1), 'done');
    eq((await post(`sessions/${sid}/requests/${rid}/whatif`, { device: 'lamp' }))[0], 202, 'same rid replays again'); await settle();
    // a declined request is not a what-if target
    [, { requestId: rid }] = await post(`sessions/${sid}/requests`, { text: 'Movie night' }); await settle();
    await post(`sessions/${sid}/requests/${rid}/decline`); await settle();
    eq((await post(`sessions/${sid}/requests/${rid}/whatif`, { device: 'lamp' }))[1].error, 'not_waiting', 'what-if after declined');
    // a declined re-plan emits no `declined` and the run goes on
    const sid2 = await session(); let r2, r3; [, { requestId: r2 }] = await post(`sessions/${sid2}/requests`, { text: 'water the plant' }); await settle();
    await post(`sessions/${sid2}/requests/${r2}/approve`); await settle(); await post(`sessions/${sid2}/requests/${r2}/decline`); await settle();
    const k2 = await kinds(sid2); ok(!k2.includes('declined'), 'declined re-plan'); eq(k2.slice(-2), ['summary', 'done']);
    // done {limit}: no what-if
    const sid3 = await session(); [, { requestId: r3 }] = await post(`sessions/${sid3}/requests`, { text: 'limit' }); await settle();
    await post(`sessions/${sid3}/requests/${r3}/approve`); await settle();
    eq((await post(`sessions/${sid3}/requests/${r3}/whatif`, { device: 'lamp' }))[1].error, 'not_waiting', 'what-if after limit');
  });
  // ---- Task 2: config and API client ----
  await check('config · ?liveApi= only for localhost', () => {
    const at = (q) => liveApiBase({ search: q });
    eq(at('?liveApi=http://localhost:8787/'), 'http://localhost:8787');
    eq(at('?liveApi=http://127.0.0.1:8787'), 'http://127.0.0.1:8787');
    eq(at('?liveApi=https://evil.example'), LIVE_CONFIG.apiBase);
    eq(at('?liveApi=http://localhost.evil.example'), LIVE_CONFIG.apiBase);
    eq(at('?liveApi=javascript:alert(1)'), LIVE_CONFIG.apiBase);
  });

  const apiOf = (mock, extra = {}) => createLiveApi({ base: 'http://mock', fetch: mock.fetch, getCode: () => MOCK_CODE, ...extra });
  const fails = async (p) => { try { await p; return null; } catch (e) { return e instanceof LiveError ? { status: e.status, kind: e.kind } : { notLiveError: String(e) }; } };

  await check('api · health: ok, disabled, HTML 200 → offline, down → offline, slow → offline', async () => {
    const m = createMockLive(), api = apiOf(m);
    eq(await api.health(), { ok: true, liveEnabled: true, scenes: ['home'] }, 'json');
    ok(!('authorization' in m.calls[0].headers), 'health sends no authorization');
    eq(m.calls[0].headers['ngrok-skip-browser-warning'], '1', 'ngrok header on health');
    m.set({ liveEnabled: false }); eq(await api.health(), { ok: true, liveEnabled: false, scenes: ['home'] }, 'disabled');
    m.set({ liveEnabled: true, mode: 'html' }); eq(await api.health(), { ok: false, liveEnabled: false, scenes: [] }, 'html');
    m.set({ mode: 'down' }); eq(await api.health(), { ok: false, liveEnabled: false, scenes: [] }, 'down');
    const t0 = performance.now(), slow = createLiveApi({ base: 'http://mock', fetch: () => new Promise(() => {}) });
    eq(await slow.health(), { ok: false, liveEnabled: false, scenes: [] }, 'slow');
    eq(Math.round(performance.now() - t0), 4000, 'health gives up after 4000 ms');
  });

  await check('api · headers and errors', async () => {
    const m = createMockLive(), api = apiOf(m), last = () => m.calls.at(-1);
    const { sessionId: sid } = await api.createSession('home');
    eq(last().headers.authorization, `Bearer ${MOCK_CODE}`, 'session auth');
    await api.request(sid, 'Movie night');
    eq(last().headers.authorization, `Bearer ${MOCK_CODE}`, 'request auth');
    eq(last().headers['ngrok-skip-browser-warning'], '1', 'ngrok header');
    eq(last().headers['content-type'], 'application/json', 'content-type');
    eq(last().body, { text: 'Movie night' }, 'request body');
    m.set({ remaining: 20 }); eq(await api.check('ncb-test-case'), { remainingToday: 20 });
    eq(last().body, { code: 'ncb-test-case' }, 'check body'); ok(!('authorization' in last().headers), 'check sends no authorization');
    eq(last().path, 'access/check'); ok(!JSON.stringify(m.calls.map((c) => [c.path, c.query])).includes(MOCK_CODE), 'code never in a url');
    await api.apply({ email: 'a@b.c', interest: 'home', wouldTry: 'x', scene: 'home', website: '' }); ok(!('authorization' in last().headers), 'apply sends no authorization');
    eq(await fails(apiOf(m, { getCode: () => 'NOPE' }).createSession('home')), { status: 401, kind: 'bad_code' }, 'bad code');
    eq(await fails(api.check('nope')), { status: 401, kind: 'bad_code' }, 'check bad code');
    const m2 = createMockLive(), a2 = apiOf(m2), { sessionId: s2 } = await a2.createSession('home');
    eq(await fails(a2.request(s2, 'x'.repeat(401))), { status: 400, kind: 'too_long' }, 'too long');
    m2.set({ remaining: 0 }); eq(await fails(a2.request(s2, 'hi')), { status: 429, kind: 'code_limit' }, 'limit');
    m2.set({ off: 'budget' }); eq(await fails(a2.createSession('home')), { status: 429, kind: 'budget' }, 'budget');
    m2.set({ off: 'live_off' }); eq(await fails(a2.request(s2, 'hi')), { status: 503, kind: 'live_off' }, 'live_off');
    const e = await a2.request(s2, 'hi').catch((x) => x); ok(typeof e.message === 'string' && e.message.length > 0, 'message from the body');
    m2.set({ off: null, mode: 'html' }); eq(await fails(a2.createSession('home')), { status: 200, kind: 'bad_response' }, 'html');
    m2.set({ mode: 'down' }); eq(await fails(a2.createSession('home')), { status: 0, kind: 'network' }, 'down');
    const slow = createLiveApi({ base: 'http://mock', fetch: () => new Promise(() => {}), timeoutMs: 500 });
    eq(await fails(slow.reset('s')), { status: 0, kind: 'network' }, 'timeout');
    const m3 = createMockLive(), a3 = apiOf(m3), { sessionId: s3 } = await a3.createSession('home');
    ok(a3.eventsUrl(s3, 4).endsWith(`/live/api/sessions/${s3}/events?after=4`) && !a3.eventsUrl(s3).includes('after'), 'eventsUrl');
    ok(!a3.eventsUrl(s3, 4).includes(MOCK_CODE), 'eventsUrl has no code'); eq(a3.headers().Authorization, `Bearer ${MOCK_CODE}`, 'sse headers');
  });

  // ---- Task 3: the event stream ----
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // A recorder for openEventStream: events, statuses, and waiters woken by each callback (no polling, no timers).
  const watch = () => {
    const w = { events: [], statuses: [], waiters: [] };
    const wake = () => { w.waiters = w.waiters.filter(([f, r]) => { if (f()) { r(); return false; } return true; }); };
    w.onEvent = (e) => { w.events.push(e); wake(); };
    w.onStatus = (s) => { w.statuses.push(s); wake(); };
    w.until = (f) => (f() ? Promise.resolve() : new Promise((r) => w.waiters.push([f, r])));
    return w;
  };
  // A fetch that counts calls, records when each began and its signal, then hands on to `inner`.
  const counting = (inner) => {
    const f = (url, init) => { f.log.push({ at: performance.now(), url: String(url), signal: init?.signal }); return inner(url, init); };
    f.log = []; return f;
  };
  // A hand-made event stream: `script(push, signal)` writes into it; it errors when the signal aborts.
  const scripted = (script) => (url, init) => {
    const enc = new TextEncoder();
    const body = new ReadableStream({ start(c) {
      const push = (t) => { try { c.enqueue(enc.encode(t)); } catch { /* closed */ } };
      init.signal.addEventListener('abort', () => { try { c.error(new DOMException('aborted', 'AbortError')); } catch { /* done */ } }, { once: true });
      script(push, init.signal);
    } });
    return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
  };
  const frame = (id, event, data) => `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  await check('sse · parser: chunk splits, CRLF, multi-line data, comments, bad JSON', () => {
    const got = [], p = createSseParser((e) => got.push(e));
    for (const c of ['id: 1\r\nev', 'ent: state\r\ndata: {"path":"lamp.on",', '"value":true,"ms":0}\r\n\r\n', ': ping\n\n',
                     'id: 2\nevent: say\ndata: {"delta":\ndata: "hi"}\n\n', 'id: 3\nevent: x\ndata: {nope\n\n']) p.push(c);
    eq(got, [{ id: 1, event: 'state', data: { path: 'lamp.on', value: true, ms: 0 } }, { id: 2, event: 'say', data: { delta: 'hi' } }]);
    // a CR at the end of a chunk may be half of a CRLF; an event cut off by end() is dropped
    const g2 = [], p2 = createSseParser((e) => g2.push(e));
    p2.push('id: 4\revent: a\rdata: {"n":1}\r'); p2.push('\n\r'); p2.push('\n'); p2.push('id: 5\ndata: {"n":2}\n'); p2.end(); p2.push('\n');
    eq(g2, [{ id: 4, event: 'a', data: { n: 1 } }], 'CR, split CRLF, end() drops a half event');
  });

  await check('sse · resume after a drop asks ?after=lastId and skips repeats', async () => {
    const mock = createMockLive(), api = apiOf(mock), { sessionId: sid } = await api.createSession('home');
    // the second stream starts with a copy of event 5, as a flaky proxy might replay it
    let nEvents = 0;
    const f = counting((url, init) => {
      if (!/\/events/.test(url) || ++nEvents < 2) return mock.fetch(url, init);
      return mock.fetch(url, init).then((res) => {
        const enc = new TextEncoder(), reader = res.body.getReader();
        const body = new ReadableStream({ async start(c) {
          c.enqueue(enc.encode(frame(5, 'say', { delta: 'e5', rid: 'r1' })));
          for (;;) { const r = await reader.read().catch(() => ({ done: true })); if (r.done) return c.close(); c.enqueue(r.value); }
        } });
        return new Response(body, { status: 200, headers: res.headers });
      });
    });
    const w = watch(), es = openEventStream({ api, sessionId: sid, fetch: f, onEvent: w.onEvent, onStatus: w.onStatus });
    await w.until(() => w.statuses.includes('open'));
    for (let i = 1; i <= 5; i++) mock.push(sid, 'say', { delta: `e${i}`, rid: 'r1' });
    await w.until(() => w.events.length === 5); eq(es.lastId, 5, 'lastId');
    const t0 = performance.now(); mock.drop(sid);
    await w.until(() => w.statuses.filter((s) => s === 'open').length === 2);
    eq(w.statuses, ['open', 'retrying', 'open']);
    eq(Math.round(performance.now() - t0), 500, 'first backoff');
    const gets = mock.calls.filter((c) => c.path.endsWith('/events'));
    eq(gets.map((c) => c.query.after ?? null), [null, '5'], 'resume asks ?after=5');
    mock.push(sid, 'say', { delta: 'e6', rid: 'r1' });
    await w.until(() => w.events.length === 6);
    eq(w.events.map((e) => e.id), [1, 2, 3, 4, 5, 6], 'no event twice');
    // a second drop: opening reset the backoff, so the wait is 500 ms again, not 1000
    const t1 = performance.now(); mock.drop(sid);
    await w.until(() => w.statuses.filter((s) => s === 'open').length === 3); eq(Math.round(performance.now() - t1), 500, 'backoff reset by open');
    eq(gets[0].headers.accept, 'text/event-stream'); eq(gets[0].headers.authorization, `Bearer ${MOCK_CODE}`, 'auth header');
    ok(!f.log.some((c) => c.url.includes(MOCK_CODE)), 'no code in a url');
    es.close();
  });

  await check('sse · 404 → gone, 401 → unauthorized, backoff used up → lost, HTML 200 → lost, close() is silent', async () => {
    // 404: the session expired under the stream
    { const mock = createMockLive(), api = apiOf(mock), { sessionId: sid } = await api.createSession('home'), f = counting(mock.fetch), w = watch();
      const es = openEventStream({ api, sessionId: sid, fetch: f, onEvent: w.onEvent, onStatus: w.onStatus });
      await w.until(() => w.statuses.includes('open')); mock.expire(sid);
      await w.until(() => w.statuses.includes('gone')); await sleep(30000);
      eq(w.statuses, ['open', 'retrying', 'gone'], '404 statuses'); eq(f.log.length, 2, 'no GET after gone'); es.close(); }
    // 401: the code stopped working
    { const mock = createMockLive(), api = apiOf(mock), { sessionId: sid } = await api.createSession('home'), f = counting(mock.fetch), w = watch();
      const es = openEventStream({ api, sessionId: sid, fetch: f, onEvent: w.onEvent, onStatus: w.onStatus });
      await w.until(() => w.statuses.includes('open')); mock.set({ code: 'NCB-OTHR-CODE' }); mock.drop(sid);
      await w.until(() => w.statuses.includes('unauthorized')); await sleep(30000);
      eq(w.statuses, ['open', 'retrying', 'unauthorized'], '401 statuses'); eq(f.log.length, 2, 'no GET after unauthorized'); es.close(); }
    // the server is down: first attempt + five retries, at 0, 500, 1500, 3500, 7500, 15500 ms
    { const mock = createMockLive({ mode: 'down' }), api = apiOf(mock), f = counting(mock.fetch), w = watch(), t0 = performance.now();
      const es = openEventStream({ api, sessionId: 'sess-1', fetch: f, onEvent: w.onEvent, onStatus: w.onStatus });
      await w.until(() => w.statuses.includes('lost')); await sleep(60000);
      eq(w.statuses, ['retrying', 'retrying', 'retrying', 'retrying', 'retrying', 'lost'], 'down statuses');
      eq(f.log.map((c) => Math.round(c.at - t0)), [0, 500, 1500, 3500, 7500, 15500], 'six GETs on the backoff'); es.close(); }
    // an HTML 200 (interstitial, captive portal) is a failed attempt, never "open"
    { const mock = createMockLive({ mode: 'html' }), api = apiOf(mock), f = counting(mock.fetch), w = watch();
      const es = openEventStream({ api, sessionId: 'sess-1', fetch: f, onEvent: w.onEvent, onStatus: w.onStatus });
      await w.until(() => w.statuses.includes('lost')); await sleep(60000);
      ok(!w.statuses.includes('open'), 'html never opens'); eq(w.statuses.at(-1), 'lost'); eq(f.log.length, 6, 'html: six GETs'); es.close(); }
    // a 5xx is retried too
    { const w = watch(), f = counting(() => Promise.resolve(new Response('{}', { status: 502, headers: { 'content-type': 'application/json' } })));
      const es = openEventStream({ api: apiOf(createMockLive()), sessionId: 's', fetch: f, onEvent: w.onEvent, onStatus: w.onStatus, backoff: [10, 10] });
      await w.until(() => w.statuses.includes('lost')); eq(w.statuses, ['retrying', 'retrying', 'lost'], '502'); eq(f.log.length, 3); es.close(); }
    // close() while retrying: silence, no further GET
    { const mock = createMockLive({ mode: 'down' }), api = apiOf(mock), f = counting(mock.fetch), w = watch();
      const es = openEventStream({ api, sessionId: 'sess-1', fetch: f, onEvent: w.onEvent, onStatus: w.onStatus });
      await w.until(() => w.statuses.includes('retrying')); es.close(); await sleep(60000);
      eq(w.statuses, ['retrying'], 'silent after close'); eq(f.log.length, 1, 'no GET after close'); }
    // close() with a fetch in flight aborts its signal; one with an open stream does too, and no callback follows
    { const w = watch(), f = counting(() => new Promise(() => {}));
      const es = openEventStream({ api: apiOf(createMockLive()), sessionId: 's', fetch: f, onEvent: w.onEvent, onStatus: w.onStatus });
      await sleep(10); ok(!f.log[0].signal.aborted); es.close(); ok(f.log[0].signal.aborted, 'pending fetch aborted'); await sleep(60000); eq(w.statuses, []); eq(f.log.length, 1); }
    { const mock = createMockLive(), api = apiOf(mock), { sessionId: sid } = await api.createSession('home'), f = counting(mock.fetch), w = watch();
      const es = openEventStream({ api, sessionId: sid, fetch: f, onEvent: w.onEvent, onStatus: w.onStatus });
      await w.until(() => w.statuses.includes('open')); es.close(); mock.push(sid, 'say', { delta: 'late', rid: 'r1' }); await sleep(60000);
      ok(f.log[0].signal.aborted, 'open stream aborted'); eq(w.events.length, 0, 'no event after close'); eq(w.statuses, ['open']); eq(f.log.length, 1); }
  });

  await check('sse · 45 s with no bytes (no ping) → reconnect', async () => {
    // one event, then silence: aborted at 45 s, 'retrying', then a GET with ?after=1
    { const w = watch(), t0 = performance.now(); let abortedAt = null;
      const f = counting(scripted((push, signal) => { signal.addEventListener('abort', () => { abortedAt ??= performance.now() - t0; }); if (f.log.length === 1) push(frame(1, 'say', { delta: 'a', rid: 'r1' })); }));
      const es = openEventStream({ api: apiOf(createMockLive()), sessionId: 'sess-1', fetch: f, onEvent: w.onEvent, onStatus: w.onStatus });
      await w.until(() => f.log.length === 2);
      eq(Math.round(abortedAt), 45000, 'aborted at 45 s'); eq(w.statuses.slice(0, 2), ['open', 'retrying']);
      ok(f.log[1].url.endsWith('events?after=1'), `resume url ${f.log[1].url}`); eq(Math.round(f.log[1].at - t0), 45500, 'then the 500 ms backoff');
      es.close(); }
    // a ping every 15 s keeps it open for two minutes
    { const w = watch(); let iv;
      const f = counting(scripted((push, signal) => { iv = setInterval(() => push(': ping\n\n'), 15000); signal.addEventListener('abort', () => clearInterval(iv)); }));
      const es = openEventStream({ api: apiOf(createMockLive()), sessionId: 'sess-1', fetch: f, onEvent: w.onEvent, onStatus: w.onStatus });
      await sleep(120000); eq(f.log.length, 1, 'one GET in 120 s'); ok(!f.log[0].signal.aborted, 'never aborted'); eq(w.statuses, ['open']);
      es.close(); clearInterval(iv); }
  });
}
