// Check 18: the live client against the contract mock (test/fixtures/live-mock.mjs).
//   liveChecks({ report, initialOf, guardHits }) runs the checks below. Tasks 2-5 add the client's own; this file
//   also holds the harness they share (check / eq / ok / harness and the stub LiveView, panel and ui).
import { createStore } from '../js/engine/store.js';
import { virtualTime } from './clock.mjs';
import { createMockLive, MOCK_CODE, SCRIPTS, RULE1, SCHED1 } from './fixtures/live-mock.mjs';
import home from '../js/scenes/home.js';
import { LIVE_CONFIG, liveApiBase } from '../js/live-config.js';
import { createLiveApi, LiveError } from '../js/engine/liveapi.js';
import { createSseParser, openEventStream } from '../js/engine/sse.js';
import { createLive, codeStore, normalizeCode, LIVE_COPY, automationsOf } from '../js/engine/live.js';
import { createLiveEntry } from '../js/engine/liveentry.js';
import { FRESH_START } from '../js/engine/flow.js';
import { REPLAYING } from '../js/engine/whatif.js';

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
  async function harness({ mock = createMockLive(), storage, entered = false } = {}) {
    const log = [], store = createStore(postSetup(home)); stores.add(store);
    const rec = (source) => (method, ...args) => { log.push([source, method, ...args]); };
    const h = { mock, store, log, codes: null, card: null, checklist: null, lastAccess: null, live: null };
    const mem = (() => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; })();
    h.codes = codeStore(storage ?? mem);
    const checklist = () => {
      const c = { steps: {}, texts: {}, pills: {}, loose: [] };
      c.mergeSteps = (steps) => { log.push(['checklist', 'mergeSteps', steps]); for (const s of steps) { c.texts[s.id] = s.text; c.steps[s.id] ??= 'pending'; } };
      c.step = (id, status) => { log.push(['checklist', 'step', id, status]); c.steps[id] = status; };
      c.call = ({ callId, step, label }) => { log.push(['checklist', 'call', callId, step, label]); c.pills[callId] = `${label} · …`; if (step == null) c.loose.push(callId); };
      c.result = ({ callId, text, ok }) => { log.push(['checklist', 'result', callId, text, ok]); const p = String(c.pills[callId] ?? '').split(' · ')[0]; c.pills[callId] = `${p} · ${text}`; };
      c.timeline = (row) => log.push(['checklist', 'timeline', row]);
      c.done = () => log.push(['checklist', 'done']);
      h.checklist = c; return c;
    };
    h.view = {
      ...Object.fromEntries(['user', 'ncb', 'chips', 'planning', 'reading', 'sayDelta', 'summary', 'failures', 'lost', 'input', 'live', 'closeChips', 'ruleLine'].map((m) => [m, rec('view').bind(null, m)])),
      endCard(...a) { log.push(['view', 'endCard', ...a]); return { close: () => log.push(['end', 'close']) }; },
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
    h.ui = { alive: () => alive, ...Object.fromEntries(['status', 'beats', 'resetRoom', 'offerGuided', 'track', 'rewind', 'editing', 'clock', 'automations', 'automationFlash', 'availability'].map((m) => [m, rec('ui').bind(null, m)])), baseline: () => null };
    h.ui.kill = () => { alive = false; };
    h.find = (source, method) => log.filter((e) => e[0] === source && e[1] === method).at(-1)?.slice(2);
    h.has = (source, method, ...args) => log.some((e) => e[0] === source && e[1] === method && args.every((a, i) => JSON.stringify(e[2 + i]) === JSON.stringify(a)));
    h.order = (source, method, ...args) => log.findIndex((e) => e[0] === source && e[1] === method && args.every((a, i) => JSON.stringify(e[2 + i]) === JSON.stringify(a)));
    h.until = async (source, method) => { for (let i = 0; i < 4000 && !log.some((e) => e[0] === source && e[1] === method); i++) await new Promise((r) => setTimeout(r, 10)); return h.find(source, method); };
    h.live = createLive({ scene: home, store, view: h.view, panel: h.panel, ui: h.ui, base: 'http://mock', fetch: mock.fetch, codes: h.codes });
    if (entered) { await h.live.open(); if (h.lastAccess) await h.lastAccess.code(MOCK_CODE); }
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

  await check('rig · set and advance follow the contract', async () => {
    const { m, post, kinds, settle, session } = rig(), sid = await session();
    const frames = async (after = 0) => { const r = await m.fetch(`${BASE}sessions/${sid}/events?after=${after}`, { headers: { authorization: `Bearer ${MOCK_CODE}` } }); const rd = r.body.getReader(), dec = new TextDecoder(); let b = ''; for (;;) { const x = await Promise.race([rd.read(), new Promise((res) => setTimeout(() => res({ done: true }), 5))]); if (x.done) break; b += dec.decode(x.value); } await rd.cancel(); return [...b.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map((a) => [a[1], JSON.parse(a[2])]); };
    eq(await post(`sessions/${sid}/set`, { path: 'soil.moisture', value: 20 }), [202, {}], 'set ok');
    const fr = await frames();
    eq(fr, [['state', { path: 'soil.moisture', value: 20, ms: 0, src: 'edit' }]], 'idle edit frame has src and no rid');
    ok(!('rid' in fr[0][1]), 'no rid key');
    eq((await post(`sessions/${sid}/set`, { path: 'lamp.on', value: true }))[1].error, 'bad_value', 'path not editable');
    eq((await post(`sessions/${sid}/set`, { path: 'lamp.brightness', value: 2 }))[0], 400, 'out of range');
    eq((await post(`sessions/${sid}/set`, { path: 'pump.running', value: 1 }))[0], 400, 'wrong type');
    eq((await post(`sessions/${sid}/set`, { path: 'lamp.status', value: 'fault' }))[0], 400, 'status not editable');
    eq((await post(`sessions/${sid}/set`, { path: 'lamp.brightness', value: 0.5 }))[0], 202); eq((await frames(1)).map((f) => f[0]), ['state', 'state'], 'lamp.on follows brightness');
    await new Promise((r) => setTimeout(r, 5001)); // the rate window (10 per 5 s) is shared by set and advance
    for (const h of [0, -1, 169, '2']) eq((await post(`sessions/${sid}/advance`, { hours: h }))[1].error, 'bad_value', `hours ${h}`);
    const n = (await frames()).length;
    const [st, body] = await post(`sessions/${sid}/advance`, { hours: 3 });
    eq(st, 200); eq(body.clock.hour, 19.5, 'end clock'); eq(body.clock.label, 'Fri 19:30');
    const cf = (await frames(n)).filter((f) => f[0] === 'clock');
    ok(cf.length >= 1 && cf.every((f) => f[1].src === 'edit' && !('rid' in f[1])), 'clock frames src edit, no rid');
    eq(cf.at(-1)[1].hour, 19.5);
    const [, { requestId: rid }] = await post(`sessions/${sid}/requests`, { text: 'Movie night' }); await settle();
    eq((await post(`sessions/${sid}/advance`, { hours: 1 }))[1].error, 'busy', 'advance mid-request');
    eq((await post(`sessions/${sid}/set`, { path: 'soil.moisture', value: 10 }))[0], 202); await settle();
    const ev = (await frames()).filter((f) => f[0] === 'state' && f[1].src === 'edit').at(-1);
    eq(ev[1].rid, rid, 'edit during a request carries its rid');
  });

  await check('rig · edit rate limit and faults', async () => {
    const { m, post, session } = rig(), sid = await session();
    for (let i = 0; i < 10; i++) eq((await post(`sessions/${sid}/set`, { path: 'soil.moisture', value: i }))[0], 202, `set ${i}`);
    eq(await post(`sessions/${sid}/set`, { path: 'soil.moisture', value: 1 }), [429, { error: 'rate', message: (await post(`sessions/${sid}/set`, { path: 'soil.moisture', value: 1 }))[1].message }], '11th is rate');
    eq((await post(`sessions/${sid}/advance`, { hours: 1 }))[1].error, 'rate', 'shared with advance');
    await new Promise((r) => setTimeout(r, 5001));
    eq((await post(`sessions/${sid}/set`, { path: 'soil.moisture', value: 5 }))[0], 202, 'window passed');
    m.push(sid, 'state', { path: 'pump.status', value: 'fault', ms: 0 });
    await new Promise((r) => setTimeout(r, 5001));
    eq((await post(`sessions/${sid}/set`, { path: 'pump.running', value: true }))[1].error, 'device_unavailable', 'fault');
    eq((await post(`sessions/${sid}/set`, 'x'.repeat(1)))[1].error, 'bad_request', 'malformed body');
    ok(typeof m.edit === 'function', 'edit helper');
  });

  await check('api · set and advance post to the contract routes', async () => {
    const m = createMockLive(), api = createLiveApi({ base: 'http://mock', fetch: m.fetch, getCode: () => MOCK_CODE });
    const { sessionId } = await api.createSession('home');
    eq(await api.set(sessionId, 'soil.moisture', 12), {}, 'set resolves');
    const c = m.calls.at(-1); eq([c.method, c.path, c.body], ['POST', `sessions/${sessionId}/set`, { path: 'soil.moisture', value: 12 }]);
    const a = await api.advance(sessionId, 2); eq(a.clock.hour, 18.5);
    eq(m.calls.at(-1).body, { hours: 2 });
    let err; try { await api.set(sessionId, 'lamp.on', true); } catch (e) { err = e; }
    ok(err instanceof LiveError && err.kind === 'bad_value' && err.status === 400, 'LiveError bad_value');
  });

  await check('mock · contract: what-if order, declined runs', async () => {
    const { post, kinds, settle, session } = rig(), sid = await session();
    let [, { requestId: rid }] = await post(`sessions/${sid}/requests`, { text: 'Movie night' }); await settle();
    await post(`sessions/${sid}/requests/${rid}/approve`); await settle();
    const before = (await kinds(sid)).length;
    const [st, { requestId: w }] = await post(`sessions/${sid}/requests/${rid}/whatif`, { device: 'lamp' }); await settle();
    const wk = (await kinds(sid)).slice(before); eq(st, 202); ok(w !== rid);
    eq(wk.slice(0, 4), ['room', 'automations', 'plan', 'step'], 'what-if starts room, its automations, plan, run'); ok(!wk.includes('awaiting_approval'), 'what-if asks nothing'); eq(wk.at(-1), 'done');
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
    const got = [], p = createSseParser((e) => got.push(e)), warns = [], warn = console.warn;
    console.warn = (...a) => warns.push(a); // the bad JSON warns on purpose: keep it out of the test output, and count it
    try {
      for (const c of ['id: 1\r\nev', 'ent: state\r\ndata: {"path":"lamp.on",', '"value":true,"ms":0}\r\n\r\n', ': ping\n\n',
                       'id: 2\nevent: say\ndata: {"delta":\ndata: "hi"}\n\n', 'id: 3\nevent: x\ndata: {nope\n\n']) p.push(c);
    } finally { console.warn = warn; }
    eq(warns.length, 1, 'one warning, for the bad JSON');
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

  // ---- Task 4: controller part 1 (access, session, room) ----
  const waitFor = async (f) => { for (let i = 0; i < 4000 && !f(); i++) await sleep(25); ok(f(), 'timed out waiting'); };
  const posts = (m) => m.calls.filter((c) => c.method === 'POST' && c.path === 'sessions');
  const eventGets = (m) => m.calls.filter((c) => c.path.endsWith('/events'));
  const accessCount = (t) => t.log.filter((e) => e[0] === 'view' && e[1] === 'access').length;

  await check('copy · LIVE_COPY passes the guardrails', () => {
    const hits = [];
    for (const [k, v] of Object.entries(LIVE_COPY)) {
      const outs = typeof v === 'function' ? [6, 'the soil sensor', 'x', null, 1, 0].flatMap((a) => [v(a), v(a, true), v(a, false)]) : [v];
      for (const o of outs) { ok(typeof o === 'string', `${k} is text`); for (const g of guardHits(o)) hits.push(`${k}: ${g}`); }
    }
    eq(hits, []);
    eq(LIVE_COPY.replanIntro('the soil reads 28%.'), 'I need to change the plan: the soil reads 28%.');
    eq([LIVE_COPY.left(1), LIVE_COPY.left(5), LIVE_COPY.statusDone(null), LIVE_COPY.statusDone(1), LIVE_COPY.whatIfAsk('the lamp', false), LIVE_COPY.whatIfAsk('the lamps', true)],
      ['1 live request left today', '5 live requests left today', 'Done', 'Done · 1 live request left today', 'What if the lamp fails?', 'What if the lamps fail?']);
    eq(normalizeCode(' ncb-test case '), 'NCB-TESTCASE');
  });

  await check('access · no code → panel; good code → session, room and intro', async () => {
    const t = await harness(); await t.live.open();
    eq(t.find('view', 'access')[0], { mode: 'code' }); eq(t.live.phase, 'access'); eq(t.live.active, true);
    eq(await t.lastAccess.code(' ncb-test-case '), null);
    eq(t.codes.get(), MOCK_CODE); eq(t.live.phase, 'idle'); eq(t.live.active, true); ok(t.has('view', 'live', true)); ok(t.has('access', 'close'), 'panel closed');
    eq(t.find('view', 'chips')[0].length >= 2, true); eq(t.find('view', 'chips')[2], 'Try:');
    ok(t.find('view', 'ncb')[0].startsWith('Live AI is on. Type what you want these 6 devices'));
    eq(t.store.get('lamp.status'), 'online'); eq(t.find('ui', 'beats')[0], { current: 'ask', recoverHidden: true, skippable: [] });
    eq(t.find('ui', 'status')[0], 'Live AI · 6 devices · waiting for your request'); ok(t.has('view', 'input', true));
    ok(!JSON.stringify(t.mock.calls.map((c) => [c.path, c.query])).includes(MOCK_CODE), 'code never in a url');
    t.live.close();
  });

  await check('access · bad code → badCode, nothing stored', async () => {
    const t = await harness(); await t.live.open();
    eq(await t.lastAccess.code('NCB-NOPE-NOPE'), LIVE_COPY.badCode);
    eq(t.codes.get(), null); eq(posts(t.mock).length, 0); eq(t.live.phase, 'access');
    t.mock.set({ remaining: 0 }); eq(await t.lastAccess.code(MOCK_CODE), LIVE_COPY.noneLeft); eq(t.codes.get(), null, 'none left: not stored');
    t.mock.set({ remaining: 5, mode: 'down' }); eq(await t.lastAccess.code(MOCK_CODE), LIVE_COPY.offline);
    t.mock.set({ mode: 'json' });
    eq(await t.lastAccess.apply({ email: 'a@b.c', interest: 'home', wouldTry: 'x', website: '' }), LIVE_COPY.applied);
    eq(t.mock.calls.at(-1).body.scene, 'home');
    t.mock.set({ mode: 'down' }); eq(await t.lastAccess.apply({ email: 'a@b.c' }), LIVE_COPY.offline);
    t.live.close();
  });

  await check('access · stored code → straight in; stored code now 401 → cleared, panel says savedCodeGone', async () => {
    const a = await harness(); a.codes.set(MOCK_CODE); await a.live.open();
    eq(a.live.phase, 'idle'); eq(accessCount(a), 0, 'no panel'); ok(a.has('view', 'live', true)); a.live.close();
    const b = await harness(); b.codes.set('NCB-OTHR-CODE'); await b.live.open();
    eq(b.codes.get(), null); eq(b.find('view', 'access')[0], { mode: 'code', note: LIVE_COPY.savedCodeGone }); eq(posts(b.mock).length, 0);
    const c = await harness({ mock: createMockLive({ remaining: 0 }) }); c.codes.set(MOCK_CODE); await c.live.open();
    eq(c.find('view', 'access')[0], { mode: 'code', note: LIVE_COPY.noneLeft }); eq(c.codes.get(), MOCK_CODE, 'a code with none left is kept');
    const d = await harness(); d.codes.set(MOCK_CODE); await d.live.open(); d.live.close();
    const e = await harness(); e.codes.set(MOCK_CODE); e.mock.set({ mode: 'down' }); await e.live.open();
    eq(e.find('view', 'access')[0], { mode: 'offline' }); eq(e.codes.get(), MOCK_CODE, 'offline keeps the code');
  });

  await check('access · offline (health html / down / liveEnabled false) → offline panel, live stays inactive', async () => {
    for (const opts of [{ mode: 'html' }, { mode: 'down' }, { liveEnabled: false }, { scenes: ['lab'] }]) {
      const t = await harness({ mock: createMockLive(opts) });
      eq(await t.live.probe(), false, JSON.stringify(opts)); eq(t.live.available, false);
      await t.live.open(); eq(t.find('view', 'access')[0], { mode: 'offline' }, JSON.stringify(opts)); eq(posts(t.mock).length, 0);
      t.lastAccess.back(); ok(t.has('ui', 'offerGuided'), 'offered guided'); eq(t.live.active, false); eq(t.live.phase, 'off'); ok(t.has('access', 'close'));
    }
    const ok1 = await harness(); eq(await ok1.live.probe(), true); eq(ok1.live.available, true);
  });

  await check('storage throws → code works for the visit', async () => {
    const t = await harness({ storage: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } } });
    await t.live.open(); eq(await t.lastAccess.code(MOCK_CODE), null); eq(t.live.phase, 'idle'); eq(t.codes.get(), null);
    eq(posts(t.mock).length, 1); t.live.close();
    // the property read itself throws (Safari, site data blocked): no storage passed, localStorage getter throws
    const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { get() { throw new Error('blocked'); }, configurable: true });
    try { const c = codeStore(); eq(c.get(), null); c.set('x'); c.clear(); } finally { if (real) Object.defineProperty(globalThis, 'localStorage', real); else delete globalThis.localStorage; }
  });

  await check('401 mid-session → access panel', async () => {
    const t = await harness({ entered: true }), sid = t.live.sessionId; eq(t.live.phase, 'idle'); eq(accessCount(t), 1);
    t.mock.set({ code: 'NCB-OTHR-CODE' }); t.mock.drop(sid);
    await waitFor(() => accessCount(t) === 2);
    eq(t.codes.get(), null); eq(t.find('view', 'access')[0], { mode: 'code', note: LIVE_COPY.savedCodeGone }); eq(t.live.phase, 'access');
    ok(t.log.findLastIndex((e) => e[0] === 'view' && e[1] === 'input' && e[2] === false) > t.order('view', 'input', true), 'input off after entering');
    const gets = eventGets(t.mock).length; await sleep(60000); eq(eventGets(t.mock).length, gets, 'stream closed, no more GETs');
    t.mock.set({ code: MOCK_CODE }); eq(await t.lastAccess.code(MOCK_CODE), null); eq(t.live.phase, 'idle'); ok(t.live.sessionId !== sid, 'new session after re-entering');
    t.live.close();
  });

  await check('room · applyRoom merges onto the baseline, keeps room-only fields', async () => {
    const t = await harness({ entered: true }), base = t.store.snapshot(), sid = t.live.sessionId;
    eq(base.soil.probeOut, false); t.ui.baseline = () => base;
    t.store.set('soil.probeOut', true); t.store.set('lamp.brightness', 0.9);
    const marks = () => t.log.filter((e) => e[0] === 'panel' && e[1] === 'mark' && e[3] === null).length, statuses = () => t.log.filter((e) => e[0] === 'ui' && e[1] === 'status').length;
    const m0 = marks(), s0 = statuses(), r0 = t.log.filter((e) => e[1] === 'resetRoom').length;
    t.mock.push(sid, 'room', { state: { lamp: { on: true, brightness: 0.5, status: 'online' }, soil: { moisture: 20 }, env: { hour: 20 } }, clock: { iso: '2026-11-13T20:00:00', label: 'Fri 20:00', hour: 20 } });
    await waitFor(() => t.store.get('lamp.brightness') === 0.5);
    eq(t.store.get('soil.probeOut'), false, 'room-only field back to baseline'); eq(t.store.get('soil.moisture'), 20); eq(t.store.get('lamp.on'), true);
    eq(t.store.get('pump.running'), base.pump.running, 'untouched device back to baseline'); eq(t.store.get('env.hour'), 20);
    eq(marks() - m0, 6, 'panel.mark(id, null) for all six'); eq(statuses(), s0, 'the instant clock leaves the status line alone');
    eq(t.log.filter((e) => e[1] === 'resetRoom').length - r0, 1, 'ui.resetRoom once');
    // a clock event outside the current request is ignored (the rid filter, Task 5; the weekend check covers clock events)
    t.mock.push(sid, 'clock', { iso: '2026-11-13T21:00:00', label: 'Fri 21:00', hour: 21 });
    await sleep(100); eq(t.store.get('env.hour'), 20, 'clock of no current request'); eq(statuses(), s0, 'and no status line');
    t.live.close();
  });

  await check('session · 404 on the stream → fresh session with timedOut notice', async () => {
    const t = await harness({ entered: true }), sid = t.live.sessionId;
    t.mock.expire(sid);
    await waitFor(() => t.live.sessionId !== sid && t.live.phase === 'idle');
    eq(posts(t.mock).length, 2); eq(t.find('view', 'ncb')[0], LIVE_COPY.timedOut); ok(t.log.findLastIndex((e) => e[0] === 'view' && e[1] === 'input' && e[2] === true) > t.order('view', 'ncb', LIVE_COPY.timedOut), 'input on after the notice');
    eq(t.find('ui', 'beats')[0], { current: 'ask', recoverHidden: true, skippable: [] }); eq(t.live.active, true);
    await waitFor(() => eventGets(t.mock).at(-1).path.includes(t.live.sessionId));
    ok([null, '0'].includes(eventGets(t.mock).at(-1).query.after ?? null), 'the new stream starts from the beginning');
    t.live.close();
  });

  await check('session · POST sessions 429 budget → limitGlobal; 503 live_off → offline; both back to guided', async () => {
    for (const [off, line] of [['budget', LIVE_COPY.limitGlobal], ['live_off', LIVE_COPY.offline]]) {
      const t = await harness(); await t.live.open(); t.mock.set({ off });
      eq(await t.lastAccess.code(MOCK_CODE), null, off); eq(t.find('view', 'ncb')[0], line, off); ok(t.has('ui', 'offerGuided'), 'guided'); eq(t.live.active, false); eq(t.live.phase, 'off');
      eq(eventGets(t.mock).length, 0, 'no stream opened');
    }
  });

  await check('access · 429 rate → rate copy, not offline; stored nothing', async () => {
    const t = await harness(); await t.live.open();
    t.mock.set({ checkRate: true }); eq(await t.lastAccess.code(MOCK_CODE), LIVE_COPY.rate); eq(t.codes.get(), null); eq(posts(t.mock).length, 0, 'no session opened'); eq(t.live.phase, 'access');
    t.mock.set({ checkRate: false }); eq(await t.lastAccess.code(MOCK_CODE), null, 'works again');
    t.live.close();
  });

  await check('session · POST sessions 429 global_limit → busy copy; code_limit keeps the daily copy', async () => {
    for (const [sessionCap, line] of [['global_limit', LIVE_COPY.sessionsBusy], ['code_limit', LIVE_COPY.limitCode]]) {
      const t = await harness(); await t.live.open(); t.mock.set({ sessionCap });
      eq(await t.lastAccess.code(MOCK_CODE), null, sessionCap); eq(t.find('view', 'ncb')[0], line, sessionCap); ok(t.has('ui', 'offerGuided'), 'guided'); eq(t.live.active, false);
      eq(eventGets(t.mock).length, 0, 'no stream opened');
    }
  });

  await check('close · silent after close(); exit() and ui death too', async () => {
    const t = await harness({ entered: true }), sid = t.live.sessionId, n0 = t.log.length;
    t.live.close(); t.mock.push(sid, 'room', { state: { lamp: { brightness: 0.7 } }, clock: { iso: 'x', label: 'x', hour: 3 } }); await sleep(2000);
    eq(t.log.length, n0, 'nothing logged after close'); ok(t.store.get('lamp.brightness') !== 0.7);
    // a room event (no rid filter applies to it), so the silence below comes from the ui / exit guards
    const u = await harness({ entered: true }); u.ui.kill(); const m = u.log.length; u.mock.push(u.live.sessionId, 'room', { state: { lamp: { brightness: 0.7 } }, clock: { iso: 'x', label: 'x', hour: 3 } }); await sleep(2000);
    eq(u.log.length, m, 'nothing after ui.alive() false'); ok(u.store.get('lamp.brightness') !== 0.7, 'room untouched after ui death'); u.live.close();
    const e = await harness({ entered: true }), esid = e.live.sessionId; e.live.exit('Back'); eq(e.find('ui', 'offerGuided')[0], 'Back'); eq(e.live.active, false); ok(e.has('view', 'live', false)); ok(e.has('ui', 'track', false));
    const m2 = e.log.length; e.mock.push(esid, 'room', { state: { lamp: { brightness: 0.7 } }, clock: { iso: 'x', label: 'x', hour: 4 } }); await sleep(2000); eq(e.log.length, m2, 'silent after exit'); ok(e.store.get('lamp.brightness') !== 0.7, 'room untouched after exit');
  });

  // ---- Task 5: controller part 2 (requests, the event stream, what-ifs, limits) ----
  const MOVIE = 'Movie night, but keep an eye on the plant', WATER = 'Water the plant if it needs it';
  const settle = () => sleep(1); // every event already on its way lands first
  const count = (t, source, method) => t.log.filter((e) => e[0] === source && e[1] === method).length;
  const postsTo = (m, re) => m.calls.filter((c) => c.method === 'POST' && re.test(c.path));
  const lastInput = (t) => t.log.filter((e) => e[0] === 'view' && e[1] === 'input').at(-1)?.[2];
  const statusesFrom = (t, i) => t.log.slice(i).filter((e) => e[0] === 'ui' && e[1] === 'status').map((e) => e[2]);
  // The kinds of every event the mock holds for a session: a fresh GET from the start, read until it goes quiet.
  const streamKinds = async (m, sid) => {
    const r = await m.fetch(`${BASE}sessions/${sid}/events`, { headers: { authorization: `Bearer ${MOCK_CODE}` } });
    const rd = r.body.getReader(), dec = new TextDecoder(); let b = '';
    for (;;) { const x = await Promise.race([rd.read(), new Promise((res) => setTimeout(() => res({ done: true }), 5))]); if (x.done) break; b += dec.decode(x.value); }
    await rd.cancel(); return [...b.matchAll(/event: (\w+)/g)].map((a) => a[1]);
  };
  // A request up to its plan card, waiting for approval (the card enabled).
  const toPlan = async (t, text) => { const n = count(t, 'view', 'planCard'); await t.live.submit(text); await waitFor(() => count(t, 'view', 'planCard') > n && t.card.enabled); };
  // The movie request run to its end card, its tweens (the blinds take 3 s) settled.
  const movie = async (t) => { const n = count(t, 'view', 'endCard'); await toPlan(t, MOVIE); await t.card.approve(); await waitFor(() => count(t, 'view', 'endCard') > n); await sleep(3100); };

  await check('run · plan → approve → state → done', async () => {
    const t = await harness({ entered: true }); await t.live.submit(MOVIE);
    await t.until('view', 'planCard'); await settle(); ok(t.has('view', 'planning', true) && t.has('panel', 'mark', 'soil', 'busy'), 'planning (sent before the POST answered) and the soil read');
    ok(t.has('view', 'user', MOVIE)); ok(t.has('view', 'reading', 'the soil sensor'), 'the planning bubble reads the soil sensor');
    ok(t.log.slice(0, t.order('view', 'planCard')).some((e) => e[0] === 'panel' && e[1] === 'reveal' && JSON.stringify(e[2]) === '["soil"]'), 'reading reveals the card (the planning-time read has no call)');
    eq(t.find('view', 'planCard')[0], { kind: 'plan', steps: [
      { id: 's1', text: 'Dim the floor lamp to 20%', devices: ['lamp'] }, { id: 's2', text: 'Close the blinds fully', devices: ['blinds'] },
      { id: 's3', text: 'Read the soil sensor; water only if under 30%', devices: ['soil', 'pump'] }] });
    eq(t.card.enabled, true); eq(t.live.phase, 'awaiting'); eq(t.find('ui', 'status')[0], LIVE_COPY.statusApproval); eq(lastInput(t), true, 'input on while the plan waits');
    await t.card.approve();
    await t.until('view', 'endCard'); await sleep(3100); // the blinds tween over 3 s
    eq(statusesFrom(t, t.order('card', 'toChecklist', 'plan'))[0], LIVE_COPY.checklistTitle, 'the status leaves "Waiting for your approval" once approved');
    eq(t.mock.calls.filter((c) => c.path.endsWith('/approve')).length, 1);
    eq(t.store.get('lamp.brightness'), 0.2); eq(t.store.get('blinds.closed'), 1);
    eq(t.checklist.steps, { s1: 'done', s2: 'done', s3: 'done' });
    eq(t.checklist.pills.c1, 'Floor lamp → 20% · confirmed'); eq(t.checklist.pills.c3, 'Soil sensor → reading · 34%');
    ok(t.order('panel', 'mark', 'lamp', 'busy') < t.order('panel', 'mark', 'lamp', 'just'), 'lamp WORKING, then JUST SET');
    const run = t.log.slice(t.order('view', 'planCard'));
    const soil = run.filter((e) => e[0] === 'panel' && e[1] === 'mark' && e[2] === 'soil').map((e) => e[3]);
    eq(soil.slice(0, 4), ['busy', null, 'busy', null], 'the running read: reading, then call (WORKING until its result)');
    ok(t.has('panel', 'reveal', ['soil']), 'a read changes no value, so only reveal brings its card into view');
    ok(!run.some((e) => e[0] === 'panel' && e[1] === 'mark' && e[2] === 'blinds' && e[3] === null), 'done clears busy marks only: the blinds\' JUST SET runs out by itself');
    eq(t.find('view', 'summary')[0], 'The lamp is at 20%, the blinds are closed, and the soil reads 34%, so the pump stayed off.', 'the summary event\'s text');
    eq(t.find('view', 'endCard')[0].remainingToday, 19);
    eq(t.find('view', 'endCard')[0], { remainingToday: 19, whatIfLabel: LIVE_COPY.whatIf, whatIf: true });
    eq(t.find('ui', 'beats')[0].current, 'end'); eq(t.find('ui', 'status')[0], LIVE_COPY.statusDone(19));
    ok(t.has('checklist', 'done')); ok(t.has('ui', 'track', true)); eq(t.find('ui', 'track')[0], false, 'track off at done');
    eq(t.live.phase, 'idle'); eq(lastInput(t), true); ok(!t.has('view', 'ncb', LIVE_COPY.lastOne));
    t.live.close();
  });

  await check('run · decline → nothing changed, declined copy, input back', async () => {
    const t = await harness({ entered: true }); await toPlan(t, MOVIE);
    const before = t.store.snapshot(); await t.card.decline(); await waitFor(() => t.live.phase === 'idle'); await settle();
    eq(t.store.snapshot(), before, 'room unchanged'); ok(t.has('view', 'ncb', LIVE_COPY.declined), 'declined copy'); ok(t.has('card', 'declined', 'plan'));
    eq(count(t, 'view', 'endCard'), 0, 'no end card'); eq(postsTo(t.mock, /\/decline$/).length, 1);
    eq(lastInput(t), true, 'view.input(true) last'); eq(t.find('ui', 'beats')[0].current, 'ask'); eq(t.find('ui', 'status')[0], LIVE_COPY.statusWaiting(6));
    t.live.close();
  });

  await check('run · re-plan card → approve → known id replaced, new id added, stepless pill on its own row', async () => {
    const t = await harness({ entered: true }); await toPlan(t, WATER); await t.card.approve();
    await waitFor(() => t.find('view', 'planCard')[0].kind === 'replan' && t.card.enabled);
    const spec = t.find('view', 'planCard')[0];
    eq(spec.reason, 'the soil reads 28%, under the 30% you asked for'); eq(LIVE_COPY.replanIntro(spec.reason), 'I need to change the plan: the soil reads 28%, under the 30% you asked for.');
    eq(spec.steps.map((s) => s.id), ['s2', 's3']); eq(t.live.phase, 'awaiting'); eq(t.find('ui', 'status')[0], LIVE_COPY.statusApproval);
    await t.card.approve(); await waitFor(() => count(t, 'view', 'endCard') === 1); await settle();
    eq(postsTo(t.mock, /\/approve$/).length, 2, 'a second /approve'); ok(t.has('card', 'close', 'replan'), 're-plan card closed');
    eq(Object.entries(t.checklist.texts), [['s1', 'Read the soil sensor'], ['s2', 'Water the plant for 6 seconds'], ['s3', 'Read the soil sensor again']]);
    eq(t.checklist.steps, { s1: 'done', s2: 'done', s3: 'done' });
    eq(t.checklist.loose, ['c3']); eq(t.checklist.pills.c3, 'Water pump → off · made safe');
    const r3 = t.order('checklist', 'result', 'c3');
    ok(r3 >= 0 && t.log.slice(r3).some((e) => e[0] === 'panel' && e[1] === 'mark' && e[2] === 'pump' && e[3] === 'just'), 'pump JUST SET after the made-safe result');
    eq(t.store.get('pump.running'), false); eq(count(t, 'card', 'toChecklist'), 1);
    // a `commanded` result (c2: sent, not confirmed) leaves the pump unmarked; JUST SET is for confirmed / made safe
    eq(t.checklist.pills.c2, 'Water pump → on for 6 s · commanded');
    const r2 = t.order('checklist', 'result', 'c2'), c3 = t.order('checklist', 'call', 'c3');
    eq(t.log.slice(r2, c3).filter((e) => e[0] === 'panel' && e[1] === 'mark' && e[2] === 'pump').map((e) => e[3]), [null], 'pump unmarked after commanded');
    t.live.close();
    // declining the re-plan instead: no event comes, the controller marks the card, the run goes on
    const u = await harness({ entered: true }); await toPlan(u, WATER); await u.card.approve();
    await waitFor(() => u.find('view', 'planCard')[0].kind === 'replan' && u.card.enabled);
    const phases = [], summary = u.view.summary; u.view.summary = (x) => { phases.push(u.live.phase); summary(x); };
    await u.card.decline(); await waitFor(() => count(u, 'view', 'endCard') === 1);
    eq(postsTo(u.mock, /\/decline$/).length, 1); ok(!(await streamKinds(u.mock, u.live.sessionId)).includes('declined'), 'no declined event in the stream');
    ok(!u.has('view', 'ncb', LIVE_COPY.declined), 'no declined copy'); ok(u.has('card', 'declined', 'replan'), 'the controller marks the card itself');
    eq(phases, ['running'], 'running until done'); ok(!u.log.some((e) => e[0] === 'checklist' && e[1] === 'call' && /pump/i.test(e[4])), 'no pump call');
    eq(u.find('view', 'endCard')[0].whatIf, true);
    u.live.close();
  });

  await check('run · what-if on the lamp replays, faults, recovers', async () => {
    const t = await harness({ entered: true }); await movie(t); const sid = t.live.sessionId;
    t.find('view', 'endCard')[1].onWhatIf();
    const [list, pick] = t.find('view', 'failures');
    eq(list.length, 6); eq(list[0], { key: 'lamp', icon: 'lamp', name: 'Floor lamp' }); eq(list.map((d) => d.key), ['lamp', 'blinds', 'soil', 'pump', 'camera', 'thermostat']);
    const notes = []; t.store.subscribe((s, path, v) => { if (path === 'lamp.status' && v === 'fault') notes.push(s.lamp.faultNote); });
    const from = t.log.length; pick('lamp');
    await waitFor(() => count(t, 'view', 'endCard') === 2); await sleep(3100);
    const run = t.log.slice(from);
    eq(run.find((e) => e[0] === 'view' && e[1] === 'user')?.[2], 'What if the floor lamp fails?');
    const w = postsTo(t.mock, /\/whatif$/); eq(w.length, 1); eq(w[0].path, `sessions/${sid}/requests/r1/whatif`); eq(w[0].body, { device: 'lamp' });
    ok(run.some((e) => e[0] === 'ui' && e[1] === 'rewind'), 'strip rewound'); eq(statusesFrom(t, from)[0], REPLAYING);
    ok(run.some((e) => e[0] === 'ui' && e[1] === 'resetRoom'), 'room event applied'); eq(t.store.get('lamp.brightness'), 0, 'the room before the movie request');
    eq(run.find((e) => e[0] === 'view' && e[1] === 'checklist')?.[3], { replay: true }); ok(!run.some((e) => e[0] === 'view' && e[1] === 'planCard'), 'no plan card');
    eq(t.store.get('lamp.status'), 'fault'); ok(t.has('ui', 'beats', { current: 'recover', recoverHidden: false, skippable: [] }), 'recover beat');
    eq(notes, ['not responding'], 'the server text is the fault note before the status turns fault');
    eq(t.checklist.steps, { s1: 'failed', s2: 'done', s3: 'pending' });
    const end = t.find('view', 'endCard'); eq(end[0], { remainingToday: 19, whatIfLabel: LIVE_COPY.anotherFailure, whatIf: true });
    eq(t.find('ui', 'beats')[0], { current: 'end', recoverHidden: false, skippable: [] });
    // "Try another failure": the movie request's rid again, not the what-if's
    end[1].onWhatIf(); t.find('view', 'failures')[1]('pump');
    await waitFor(() => count(t, 'view', 'endCard') === 3);
    const w2 = postsTo(t.mock, /\/whatif$/); eq(w2.length, 2); eq(w2[1].path, `sessions/${sid}/requests/r1/whatif`); eq(w2[1].body, { device: 'pump' });
    ok(t.has('view', 'user', 'What if the water pump fails?'));
    t.live.close();
  });

  await check('run · limit: 429 code_limit → guided; 429 budget / 503 live_off → guided; limit{calls} mid-run → limitRun + end card without what-if', async () => {
    { const t = await harness({ entered: true }); t.mock.set({ remaining: 0 }); await t.live.submit(MOVIE);
      eq(t.find('view', 'ncb')[0], LIVE_COPY.limitCode); ok(t.has('ui', 'offerGuided'), 'guided'); eq(t.live.active, false); ok(t.has('view', 'live', false)); eq(t.live.phase, 'off'); }
    for (const [off, line] of [['budget', LIVE_COPY.limitGlobal], ['live_off', LIVE_COPY.offline]]) {
      const t = await harness({ entered: true }); eq(t.live.available, true, `${off}: available before`); t.mock.set({ off }); await t.live.submit(MOVIE);
      eq(t.find('view', 'ncb')[0], line, off); ok(t.has('ui', 'offerGuided'), `${off}: guided`); eq(t.live.active, false, off); ok(t.has('view', 'live', false)); eq(t.live.available, false, `${off}: available after`);
    }
    // a run cut off by its limit: limitRun, then the end card without the what-if
    { const t = await harness({ entered: true }); await toPlan(t, 'push it to the limit'); await t.card.approve();
      await waitFor(() => count(t, 'view', 'endCard') === 1);
      ok(t.has('view', 'ncb', LIVE_COPY.limitRun)); eq(t.find('view', 'endCard')[0], { remainingToday: 19, whatIfLabel: LIVE_COPY.whatIf, whatIf: false });
      eq(t.live.active, true); eq(t.live.phase, 'idle'); t.find('view', 'endCard')[1].onWhatIf(); eq(count(t, 'view', 'failures'), 0, 'no what-if target after a limit'); t.live.close(); }
    // the kill switch mid-run: limitGlobal, then guided once done arrives
    { const t = await harness({ entered: true }); await toPlan(t, MOVIE); const sid = t.live.sessionId;
      t.mock.push(sid, 'limit', { kind: 'budget', rid: 'r1' }); await settle();
      ok(t.has('view', 'ncb', LIVE_COPY.limitGlobal)); eq(t.live.active, true, 'live until done');
      t.mock.push(sid, 'done', { outcome: 'limit', rid: 'r1' }); await waitFor(() => !t.live.active);
      ok(t.has('ui', 'offerGuided')); eq(count(t, 'view', 'endCard'), 0, 'no end card'); eq(t.live.available, false);
      eq(t.card.enabled, false, 'the plan card left waiting is closed'); ok(t.has('card', 'close', 'plan')); }
  });

  await check('run · server offline mid-run → lost card, reconnect resumes from lastId', async () => {
    const t = await harness({ entered: true }); await toPlan(t, MOVIE); const sid = t.live.sessionId;
    t.mock.set({ mode: 'down' }); t.mock.drop(sid);
    await waitFor(() => t.has('view', 'lost')); eq(t.live.phase, 'awaiting');
    const [reconnect] = t.find('view', 'lost'); t.mock.set({ mode: 'json' });
    const gets = eventGets(t.mock).length; reconnect();
    await waitFor(() => eventGets(t.mock).length > gets); eq(eventGets(t.mock).at(-1).query.after, '4', 'resumes after the last id seen');
    await settle(); await t.card.approve(); await waitFor(() => count(t, 'view', 'endCard') === 1);
    eq(t.checklist.steps, { s1: 'done', s2: 'done', s3: 'done' }); eq(t.live.phase, 'idle');
    t.live.close();
  });

  await check('run · cannot_do → reason + suggestion chips, no plan card', async () => {
    const t = await harness({ entered: true }), chips0 = count(t, 'view', 'chips');
    await t.live.submit('order a pizza'); await waitFor(() => t.live.phase === 'idle'); await settle();
    ok(t.has('view', 'ncb', 'I can’t order food from here, only control the devices in this home.'), 'the reason as sent');
    eq(count(t, 'view', 'chips'), chips0 + 1); const [texts, pick] = t.find('view', 'chips');
    eq(texts, ['Movie night, but keep an eye on the plant', "I'm away for the weekend"]);
    eq(count(t, 'view', 'planCard'), 0, 'no plan card'); ok(t.order('view', 'planning', true) < t.order('view', 'planning', false), 'planning bubble off');
    eq(count(t, 'view', 'endCard'), 0); eq(t.find('ui', 'beats')[0].current, 'ask'); eq(t.find('ui', 'status')[0], LIVE_COPY.statusWaiting(6)); eq(lastInput(t), true);
    pick(texts[0]); await waitFor(() => postsTo(t.mock, /\/requests$/).length === 2); eq(postsTo(t.mock, /\/requests$/)[1].body, { text: texts[0] }, 'a chip starts a request');
    t.live.close();
  });

  await check('run · weekend: clock tweens env.hour, status shows label, timeline rows incl. 📩 notify', async () => {
    const t = await harness({ entered: true }); await toPlan(t, "I'm away for the weekend");
    const tw = [], tween = t.store.tween; t.store.tween = (p, v, ms, e) => { if (p === 'env.hour') tw.push([v, ms]); return tween(p, v, ms, e); };
    await sleep(1000); const from = t.log.length;
    await t.card.approve(); await waitFor(() => count(t, 'view', 'endCard') === 1); await sleep(900);
    eq(t.store.get('env.hour'), 64.5, 'Sun 16:30');
    eq(tw[0], [18, 800], 'the first clock tweens over the gap, at most 800 ms'); eq(tw.slice(1), [[22.5, 0], [31.17, 0], [42, 0], [57, 0], [64.5, 0]], 'clocks in one burst jump');
    eq(statusesFrom(t, from).filter((s) => /^(Fri|Sat|Sun) \d\d:\d\d$/.test(s)), ['Fri 18:00', 'Fri 22:30', 'Sat 07:10', 'Sat 18:00', 'Sun 09:00', 'Sun 16:30']);
    const rows = t.log.filter((e) => e[0] === 'checklist' && e[1] === 'timeline').map((e) => e[2]);
    eq(rows.map((r) => r.kind), ['action', 'action', 'notify', 'action']); eq(rows[2], { at: 'Sat 19:20', text: 'Sent you: someone at the door', ok: true, kind: 'notify' });
    eq(t.find('ui', 'status')[0], LIVE_COPY.statusDone(19));
    t.live.close();
  });

  await check('approve twice → one POST', async () => {
    const t = await harness({ entered: true }); await toPlan(t, MOVIE);
    t.card.approve(); t.card.approve(); t.card.decline(); await waitFor(() => count(t, 'view', 'endCard') === 1);
    eq(postsTo(t.mock, /\/approve$/).length, 1); eq(postsTo(t.mock, /\/decline$/).length, 0); eq(count(t, 'card', 'toChecklist'), 1); eq(count(t, 'card', 'busy'), 1);
    t.live.close();
    const u = await harness({ entered: true }); await toPlan(u, MOVIE);
    u.card.decline(); u.card.decline(); await waitFor(() => u.live.phase === 'idle'); eq(postsTo(u.mock, /\/decline$/).length, 1, 'decline twice → one POST');
    u.live.close();
  });

  await check('typed change re-plans', async () => {
    const t = await harness({ entered: true }); await toPlan(t, MOVIE);
    await t.live.submit('make it 30% instead');
    await waitFor(() => postsTo(t.mock, /\/requests$/).length === 2);
    const decline = t.mock.calls.findIndex((c) => c.path.endsWith('/decline')), second = t.mock.calls.findLastIndex((c) => c.path.endsWith('/requests'));
    ok(decline >= 0 && decline < second, 'POST /decline, then POST /requests'); eq(postsTo(t.mock, /\/decline$/).length, 1);
    eq(t.mock.calls[second].body, { text: 'make it 30% instead' }); ok(t.has('card', 'declined', 'plan')); ok(!t.has('view', 'ncb', LIVE_COPY.declined), 'no declined copy');
    await waitFor(() => count(t, 'view', 'planCard') === 2 && t.card.enabled); ok(t.has('view', 'user', 'make it 30% instead'));
    eq(count(t, 'view', 'endCard'), 0); eq(t.live.phase, 'awaiting');
    t.live.close();
  });

  await check('one request at a time; over 400 after trim refused locally', async () => {
    const t = await harness({ entered: true }); await Promise.all([t.live.submit(MOVIE), t.live.submit(MOVIE)]);
    eq(postsTo(t.mock, /\/requests$/).length, 1); eq(count(t, 'view', 'user'), 1); t.live.close();
    const u = await harness({ entered: true }), reqs = () => postsTo(u.mock, /\/requests$/), tooLong = () => u.log.filter((e) => e[1] === 'ncb' && e[2] === LIVE_COPY.tooLong).length;
    await u.live.submit('x'.repeat(401)); eq(tooLong(), 1); eq(reqs().length, 0);
    eq('😀'.repeat(201).length, 402); await u.live.submit('😀'.repeat(201)); eq(tooLong(), 2); eq(reqs().length, 0, 'emoji count in UTF-16 units');
    await u.live.submit('   '); eq(reqs().length, 0, 'blank'); eq(count(u, 'view', 'user'), 0);
    await u.live.submit(`  ${'x'.repeat(400)}  `); eq(reqs().length, 1); eq(reqs()[0].body, { text: 'x'.repeat(400) }, 'the trimmed text is sent');
    u.live.close();
  });

  await check('close mid-run is silent', async () => {
    const rejections = [], onRejection = (e) => rejections.push(e); process.on('unhandledRejection', onRejection);
    try {
      const t = await harness({ entered: true }); await toPlan(t, MOVIE);
      let n = null, writes = 0;
      t.store.subscribe((s, path) => { if (n !== null) { writes++; return; } if (path === 'lamp.on') { t.live.close(); n = t.log.length; } });
      await t.card.approve(); await sleep(60000);
      ok(n !== null, 'closed after the first state event'); eq(t.log.length, n, 'no view / panel / ui call after close'); eq(writes, 0, 'no store write after close');
      ok(eventGets(t.mock).length > 0 && eventGets(t.mock).every((c) => c.signal?.aborted), 'the stream signal aborted'); eq(t.live.active, false);
    } finally { process.off('unhandledRejection', onRejection); }
    eq(rejections.length, 0, 'no unhandled rejection');
  });

  await check('reset → FRESH_START, room back from the HTTP answer, what-if gone until the next request', async () => {
    const t = await harness({ entered: true }); await movie(t); const sid = t.live.sessionId;
    t.store.set('env.hour', 20); const k0 = (await streamKinds(t.mock, sid)).length, [, end] = t.find('view', 'endCard'), from = t.log.length;
    end.onReset(); await waitFor(() => t.has('view', 'ncb', FRESH_START));
    eq(postsTo(t.mock, /\/reset$/).length, 1); eq((await streamKinds(t.mock, sid)).length, k0, 'reset sends no stream event');
    eq(t.store.get('lamp.brightness'), 0); eq(t.store.get('blinds.closed'), 0); eq(t.store.get('env.hour'), 16.5);
    eq(t.find('ui', 'beats')[0], { current: 'ask', recoverHidden: true, skippable: [] }); eq(t.find('ui', 'status')[0], LIVE_COPY.statusWaiting(6));
    eq(statusesFrom(t, from), [LIVE_COPY.statusWaiting(6)], 'the instant clock leaves the status line alone'); eq(t.live.phase, 'idle'); eq(lastInput(t), true);
    const f0 = count(t, 'view', 'failures'); end.onWhatIf(); await settle();
    eq(postsTo(t.mock, /\/whatif$/).length, 0, 'no POST /whatif'); eq(count(t, 'view', 'failures'), f0, 'no picker after the reset');
    await movie(t); eq(t.find('view', 'endCard')[0].whatIf, true, 'the next request offers it again');
    t.find('view', 'endCard')[1].onWhatIf(); t.find('view', 'failures')[1]('lamp');
    await waitFor(() => postsTo(t.mock, /\/whatif$/).length === 1); eq(postsTo(t.mock, /\/whatif$/)[0].path, `sessions/${sid}/requests/r2/whatif`);
    await waitFor(() => count(t, 'view', 'endCard') === 3);
    t.live.close();
  });

  // ---- Task 4 review guards ----
  await check('guard · two codes in flight → one session', async () => {
    const t = await harness(); await t.live.open();
    eq(await Promise.all([t.lastAccess.code(MOCK_CODE), t.lastAccess.code(MOCK_CODE)]), [null, null]);
    eq(posts(t.mock).length, 1, 'one POST sessions'); eq(count(t, 'view', 'live'), 1, 'entered once'); eq(t.live.phase, 'idle');
    t.live.close();
  });

  await check('guard · a stale Reconnect after a 401 opens no stream', async () => {
    const t = await harness({ entered: true }), sid = t.live.sessionId;
    t.mock.set({ mode: 'down' }); t.mock.drop(sid); await waitFor(() => t.has('view', 'lost'));
    const [reconnect] = t.find('view', 'lost'); t.mock.set({ mode: 'json', code: 'NCB-OTHR-CODE' });
    reconnect(); await waitFor(() => accessCount(t) === 2); eq(t.live.phase, 'access'); eq(t.live.sessionId, null, 'session forgotten');
    const gets = eventGets(t.mock).length; reconnect(); await sleep(60000);
    eq(eventGets(t.mock).length, gets, 'no GET from the stale button'); eq(accessCount(t), 2);
    t.live.close();
  });

  await check('guard · available follows POST sessions budget / live_off and health in open()', async () => {
    for (const off of ['budget', 'live_off']) {
      const t = await harness(); eq(await t.live.probe(), true); await t.live.open(); t.mock.set({ off });
      await t.lastAccess.code(MOCK_CODE); eq(t.live.available, false, off);
    }
    const t = await harness(); eq(await t.live.probe(), true); t.mock.set({ liveEnabled: false }); await t.live.open();
    eq(t.find('view', 'access')[0], { mode: 'offline' }); eq(t.live.available, false, 'health off in open()');
    const u = await harness({ mock: createMockLive({ liveEnabled: false }) }); eq(await u.live.probe(), false); u.mock.set({ liveEnabled: true });
    await u.live.open(); eq(u.live.available, true, 'health back on in open()'); u.live.close();
  });

  await check('guard · a room event without a state object is ignored; unsafe store paths are skipped', async () => {
    const t = await harness({ entered: true }), sid = t.live.sessionId, before = t.store.snapshot(), r0 = count(t, 'ui', 'resetRoom');
    for (const state of [null, 'lamp', [1, 2]]) t.mock.push(sid, 'room', { state, clock: { iso: 'x', label: 'x', hour: 3 } });
    await sleep(100); eq(t.store.snapshot(), before, 'room kept'); eq(count(t, 'ui', 'resetRoom'), r0, 'no reset');
    try {
      t.mock.push(sid, 'room', { state: JSON.parse('{"__proto__":{"polluted":1},"lamp":{"brightness":0.4},"nosuch":{"x":1}}'), clock: { iso: 'x', label: 'x', hour: 16.5 } });
      await waitFor(() => t.store.get('lamp.brightness') === 0.4); eq(({}).polluted, undefined, 'room: no prototype write'); eq(t.store.get('nosuch'), undefined, 'room: unknown slice');
      await toPlan(t, MOVIE);
      for (const path of ['__proto__.polluted', 'nosuch.x', 'lamp']) t.mock.push(sid, 'state', { path, value: 1, ms: 0, rid: 'r1' });
      t.mock.push(sid, 'state', { path: 'lamp.brightness', value: 0.6, ms: 0, rid: 'r1' });
      await waitFor(() => t.store.get('lamp.brightness') === 0.6);
      eq(({}).polluted, undefined, 'state: no prototype write'); eq(t.store.get('nosuch'), undefined); ok(typeof t.store.get('lamp') === 'object', 'a path needs a field');
    } finally { delete Object.prototype.polluted; }
    t.live.close();
  });

  await check('guard · close() ends active', async () => {
    const t = await harness({ entered: true }); eq(t.live.active, true); t.live.close(); eq(t.live.active, false);
    await t.live.submit(MOVIE); eq(postsTo(t.mock, /\/requests$/).length, 0, 'nothing after close');
  });

  await check('store · a 0 ms tween replaces a running tween on its path', async () => {
    const s = createStore({ a: { x: 0 } }); stores.add(s);
    s.tween('a.x', 10, 1000); await sleep(100); ok(s.get('a.x') > 0 && s.get('a.x') < 10, 'tweening');
    s.tween('a.x', 5, 0); eq(s.get('a.x'), 5, 'jumps at once'); await sleep(2000); eq(s.get('a.x'), 5, 'the old tween is gone');
  });

  // ---- Task 5 fix round 1 ----
  // A mock whose `movie` request (the default script) runs these segments instead.
  const movieMock = (...segments) => createMockLive({ scripts: { ...SCRIPTS, movie: segments } });
  const OPEN_RUN = [SCRIPTS.movie[0], { on: 'approve', events: [['step', { id: 's1', status: 'running' }]] }]; // approved, then no done
  // The same mock, except the first POST whose path matches `re` gets `answer()` instead.
  const failOnce = (m, re, answer) => { let left = 1; return { ...m, fetch: (url, init) => (left > 0 && re.test(String(url)) ? (left--, answer()) : m.fetch(url, init)) }; };
  const jsonAnswer = (status, body) => () => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

  await check('abandoned run · a 401 or exit mid-run releases WORKING, Planning… and tracking', async () => {
    // a 401 while planning, with the soil being read: no done will come
    const t = await harness({ mock: movieMock({ on: 'request', events: [['planning', {}], ['reading', { device: 'soil' }]] }), entered: true }), sid = t.live.sessionId;
    await t.live.submit(MOVIE); await waitFor(() => t.has('view', 'reading', 'the soil sensor')); eq(t.live.phase, 'planning');
    const from = t.log.length;
    t.mock.set({ mode: 'down' }); t.mock.drop(sid); t.mock.set({ code: 'NCB-OTHR-CODE' }); await sleep(100); t.mock.set({ mode: 'json' });
    await waitFor(() => accessCount(t) === 2);
    const after = t.log.slice(from);
    ok(after.some((e) => e[0] === 'panel' && e[1] === 'mark' && e[2] === 'soil' && e[3] === null), 'soil WORKING cleared');
    ok(after.some((e) => e[0] === 'view' && e[1] === 'planning' && e[2] === false), 'Planning… bubble off');
    ok(after.some((e) => e[0] === 'ui' && e[1] === 'track' && e[2] === false), 'tracking off');
    t.live.close();
    // exit while a plan card waits: the card is closed, tracking stops
    const u = await harness({ entered: true }); await toPlan(u, MOVIE); u.live.exit();
    eq(u.card.enabled, false); ok(u.has('card', 'close', 'plan'), 'waiting card closed'); eq(u.find('ui', 'track')[0], false);
    // the session expires while a plan waits: a fresh room, and the old card takes no answers
    const w = await harness({ entered: true }); await toPlan(w, MOVIE); const wsid = w.live.sessionId; w.mock.expire(wsid);
    await waitFor(() => w.live.sessionId !== wsid && w.live.phase === 'idle'); ok(w.has('card', 'close', 'plan'), 'old card closed'); eq(w.card.enabled, false); w.live.close();
    // close() stays silent
    const v = await harness({ entered: true }); await toPlan(v, MOVIE); const n0 = v.log.length; v.live.close(); eq(v.log.length, n0, 'close is silent');
  });

  await check('abandoned run · a fresh session, a 401 or exit mid-run closes the checklist (no step left running)', async () => {
    // Found in the browser check (Task 8): after a lost stream, Reconnect found the session gone and opened a fresh room,
    // but the old checklist stayed open, its running step still pulsing as if the run went on.
    const mid = async () => { const t = await harness({ mock: movieMock(...OPEN_RUN), entered: true }); await toPlan(t, MOVIE); await t.card.approve(); await waitFor(() => t.checklist?.steps.s1 === 'running'); return t; };
    const closed = (t) => t.log.some((e) => e[0] === 'checklist' && e[1] === 'done');
    const a = await mid(), asid = a.live.sessionId; a.mock.expire(asid);
    await waitFor(() => a.live.sessionId !== asid && a.live.phase === 'idle'); ok(closed(a), 'fresh session: checklist closed'); a.live.close();
    const b = await mid(), bsid = b.live.sessionId; b.mock.set({ code: 'NCB-OTHR-CODE' }); b.mock.drop(bsid);
    await waitFor(() => accessCount(b) === 2); ok(closed(b), '401: checklist closed'); b.live.close();
    const c = await mid(); c.live.exit(); ok(closed(c), 'exit: checklist closed');
    const d = await mid(), n0 = d.log.length; d.live.close(); eq(d.log.length, n0, 'close() stays silent');
  });

  await check('end card · closed when the next end card shows, by a 401 or a fresh room (no button left that does nothing)', async () => {
    // Found in the browser check (Task 8): after a 401 the access panel came back under a live end card whose buttons
    // still looked live but did nothing; the same after a fresh room (its what-if).
    const closes = (t) => count(t, 'end', 'close');
    const a = await harness({ entered: true }); await movie(a); eq(closes(a), 0, 'open after done');
    await toPlan(a, MOVIE); eq(closes(a), 0, 'still open while the next plan waits');
    await a.card.approve(); await waitFor(() => count(a, 'view', 'endCard') === 2);
    eq(closes(a), 1, 'closed when the next end card shows');
    ok(a.order('end', 'close') < a.log.findLastIndex((e) => e[0] === 'view' && e[1] === 'endCard'), 'closed before the new card mounts'); a.live.close();
    const b = await harness({ entered: true }); await movie(b); b.mock.set({ code: 'NCB-OTHR-CODE' }); b.mock.drop(b.live.sessionId);
    await waitFor(() => accessCount(b) === 2); eq(closes(b), 1, 'a 401 closes it'); b.live.close();
    const c = await harness({ entered: true }); await movie(c); const csid = c.live.sessionId; c.mock.expire(csid);
    await waitFor(() => c.live.sessionId !== csid && c.live.phase === 'idle'); eq(closes(c), 1, 'a fresh room closes it'); c.live.close();
  });

  await check('end card · a declined next plan leaves the last end card working (its Reset room still resets)', async () => {
    // A decline (or cannot_do, or a failed POST) shows no new end card: the last one keeps Reset room and the what-if.
    const t = await harness({ entered: true }); await movie(t); const [, acts] = t.find('view', 'endCard');
    await toPlan(t, MOVIE); await t.card.decline(); await waitFor(() => t.live.phase === 'idle'); await settle();
    ok(t.has('view', 'ncb', LIVE_COPY.declined)); eq(count(t, 'view', 'endCard'), 1, 'no new end card'); eq(count(t, 'end', 'close'), 0, 'not closed');
    acts.onReset(); await waitFor(() => postsTo(t.mock, /\/reset$/).length === 1 && t.has('view', 'ncb', FRESH_START));
    eq(postsTo(t.mock, /\/reset$/)[0].path, `sessions/${t.live.sessionId}/reset`);
    t.live.close();
  });

  await check('end card · done{failed} before any plan → no what-if; after a plan ran → what-if on that rid', async () => {
    const failed = ['done', { outcome: 'failed' }], err = ['error', { kind: 'model', message: 'The model stopped.' }];
    const t = await harness({ mock: movieMock({ on: 'request', events: [['planning', {}], err, failed] }), entered: true });
    await t.live.submit(MOVIE); await waitFor(() => count(t, 'view', 'endCard') === 1);
    ok(t.has('view', 'ncb', LIVE_COPY.error)); eq(t.find('view', 'endCard')[0].whatIf, false, 'nothing ran: no what-if');
    t.find('view', 'endCard')[1].onWhatIf(); eq(count(t, 'view', 'failures'), 0, 'no replay target'); t.live.close();
    const u = await harness({ mock: movieMock(SCRIPTS.movie[0], { on: 'approve', events: [['step', { id: 's1', status: 'running' }], err, failed] }), entered: true });
    await toPlan(u, MOVIE); await u.card.approve(); await waitFor(() => count(u, 'view', 'endCard') === 1);
    eq(u.find('view', 'endCard')[0].whatIf, true, 'the plan ran: what-if offered');
    u.find('view', 'endCard')[1].onWhatIf(); u.find('view', 'failures')[1]('lamp');
    await waitFor(() => postsTo(u.mock, /\/whatif$/).length === 1); eq(postsTo(u.mock, /\/whatif$/)[0].path, `sessions/${u.live.sessionId}/requests/r1/whatif`);
    u.live.close();
  });

  await check('run · expired closes the waiting card, with the copy once (plan and re-plan)', async () => {
    const t = await harness({ entered: true }); await toPlan(t, MOVIE); const sid = t.live.sessionId;
    t.mock.push(sid, 'expired', { rid: 'r1' }); t.mock.push(sid, 'done', { outcome: 'expired', rid: 'r1' }); await waitFor(() => t.live.phase === 'idle');
    eq(count(t, 'card', 'close'), 1); ok(t.has('card', 'close', 'plan')); eq(t.card.enabled, false);
    eq(t.log.filter((e) => e[1] === 'ncb' && e[2] === LIVE_COPY.expired).length, 1, 'expired copy once'); eq(count(t, 'view', 'endCard'), 0);
    eq(t.find('ui', 'beats')[0].current, 'ask'); eq(lastInput(t), true);
    t.card.approve(); await settle(); eq(postsTo(t.mock, /\/approve$/).length, 0, 'a closed card sends nothing'); t.live.close();
    // a re-plan left waiting: that card closes, not the plan (now the checklist)
    const u = await harness({ entered: true }); await toPlan(u, WATER); await u.card.approve();
    await waitFor(() => u.find('view', 'planCard')[0].kind === 'replan' && u.card.enabled);
    u.mock.push(u.live.sessionId, 'expired', { rid: 'r1' }); u.mock.push(u.live.sessionId, 'done', { outcome: 'expired', rid: 'r1' }); await waitFor(() => u.live.phase === 'idle');
    ok(u.has('card', 'close', 'replan')); ok(!u.has('card', 'close', 'plan'), 'the checklist stays');
    eq(u.log.filter((e) => e[1] === 'ncb' && e[2] === LIVE_COPY.expired).length, 1); ok(u.has('checklist', 'done'));
    u.live.close();
  });

  await check('approve · 409 not_waiting → card closed, expired copy once; another error → card enabled again', async () => {
    const m = createMockLive(), t = await harness({ mock: failOnce(m, /\/approve$/, jsonAnswer(409, { error: 'not_waiting', message: 'Nothing is waiting.' })), entered: true });
    await toPlan(t, MOVIE); await t.card.approve(); await settle();
    ok(t.has('card', 'close', 'plan')); eq(t.log.filter((e) => e[1] === 'ncb' && e[2] === LIVE_COPY.expired).length, 1, 'expired copy');
    // the server's own expired + done follow: no second copy, the request ends
    m.push(t.live.sessionId, 'expired', { rid: 'r1' }); m.push(t.live.sessionId, 'done', { outcome: 'expired', rid: 'r1' }); await waitFor(() => t.live.phase === 'idle');
    eq(t.log.filter((e) => e[1] === 'ncb' && e[2] === LIVE_COPY.expired).length, 1, 'still once'); eq(count(t, 'card', 'close'), 1); eq(count(t, 'view', 'endCard'), 0);
    t.live.close();
    // a 500: the error copy, the card enabled again, and a second Approve runs the plan
    const m2 = createMockLive(), u = await harness({ mock: failOnce(m2, /\/approve$/, jsonAnswer(500, { error: 'internal', message: 'Oops.' })), entered: true });
    await toPlan(u, MOVIE); await u.card.approve(); await settle();
    ok(u.has('view', 'ncb', LIVE_COPY.error)); eq(u.card.enabled, true, 'enabled again'); eq(u.live.phase, 'awaiting'); eq(lastInput(u), true);
    eq(count(u, 'card', 'toChecklist'), 0); eq(postsTo(m2, /\/approve$/).length, 0, 'the failed POST never reached the server');
    await u.card.approve(); await waitFor(() => count(u, 'view', 'endCard') === 1);
    eq(postsTo(m2, /\/approve$/).length, 1); eq(u.checklist.steps, { s1: 'done', s2: 'done', s3: 'done' });
    u.live.close();
  });

  await check('state · an instant numeric state beats a running tween; a missing ok is never success', async () => {
    const t = await harness({ mock: movieMock(...OPEN_RUN), entered: true }), sid = t.live.sessionId;
    await toPlan(t, MOVIE); await t.card.approve(); await waitFor(() => t.live.phase === 'running');
    const push = (kind, data) => t.mock.push(sid, kind, { ...data, rid: 'r1' });
    push('state', { path: 'lamp.brightness', value: 0.9, ms: 2000 }); await sleep(300); ok(t.store.get('lamp.brightness') > 0, 'tweening');
    push('state', { path: 'lamp.brightness', value: 0.1, ms: 0 }); await sleep(2500); eq(t.store.get('lamp.brightness'), 0.1, 'the instant value stays');
    push('call', { step: 's1', callId: 'k1', device: 'lamp', action: 'set', args: {}, label: 'Floor lamp → 10%' });
    push('result', { callId: 'k1', step: 's1', device: 'lamp', outcome: 'failed', text: 'no answer' });           // no ok, failed
    push('result', { callId: 'k2', step: 's1', device: 'lamp', outcome: 'confirmed', text: 'confirmed', ok: 'yes' }); // ok not a boolean
    push('result', { callId: 'k3', step: 's1', device: 'lamp', outcome: 'confirmed', text: 'confirmed' });          // no ok, not failed
    push('timeline', { at: 'Sat 18:00', text: 'Floor lamp → 35%', ok: 'nope', kind: 'action' });
    push('timeline', { at: 'Sat 19:00', text: 'Floor lamp → off', ok: false, kind: 'action' });
    await settle();
    eq(t.log.filter((e) => e[0] === 'checklist' && e[1] === 'result').map((e) => [e[2], e[4]]), [['k1', false], ['k2', false], ['k3', true]]);
    { // JUST SET follows ok: a confirmed result that is not ok (k2) marks nothing, a plain confirmed one (k3) does
      const at = (id) => t.log.findIndex((e) => e[0] === 'checklist' && e[1] === 'result' && e[2] === id);
      const just = (from, to) => t.log.slice(from, to).filter((e) => e[0] === 'panel' && e[1] === 'mark' && e[2] === 'lamp' && e[3] === 'just').length;
      eq(just(at('k1'), at('k3')), 0, 'no JUST SET for k1 / k2'); eq(just(at('k3')), 1, 'JUST SET for k3');
    }
    eq(t.log.filter((e) => e[0] === 'checklist' && e[1] === 'timeline').map((e) => e[2].ok), [false, false]);
    push('done', { outcome: 'ok' }); await waitFor(() => count(t, 'view', 'endCard') === 1);
    t.live.close();
  });

  await check('lastOne · after the code\'s last request, not again after a what-if', async () => {
    const t = await harness({ mock: createMockLive({ remaining: 1 }), entered: true }); await movie(t);
    const lastOnes = () => t.log.filter((e) => e[1] === 'ncb' && e[2] === LIVE_COPY.lastOne).length;
    eq(t.find('view', 'endCard')[0].remainingToday, 0); eq(lastOnes(), 1);
    t.find('view', 'endCard')[1].onWhatIf(); t.find('view', 'failures')[1]('lamp'); await waitFor(() => count(t, 'view', 'endCard') === 2);
    eq(t.find('view', 'endCard')[0].remainingToday, 0); eq(lastOnes(), 1, 'a what-if spends no request');
    t.live.close();
  });

  // ---- final review fixes ----
  const WI_SCRIPTS = (whatif) => ({ ...SCRIPTS, movie: Object.assign([...SCRIPTS.movie], { whatif }) });
  const CALL = (callId, device, label) => ['call', { step: 's1', callId, device, action: 'set', args: {}, label }];
  const RES = (callId, device, outcome, text, ok) => ['result', { callId, step: 's1', device, outcome, text, ok }];
  const statusLines = (t, from = 0) => t.log.slice(from).filter((e) => e[0] === 'ui' && e[1] === 'status').map((e) => [e[2], !!e[3]]);

  for (const how of ['declined', 'cannot_do', 'expired']) {
    await check(`what-if · an older end card still targets its request after a ${how} request`, async () => {
      const sts = [], m = createMockLive({ scripts: { ...SCRIPTS, limitCalls: [SCRIPTS.movie[0]] } });
      const mock = { ...m, fetch: async (u, i) => { const r = await m.fetch(u, i); if (/whatif$/.test(String(u))) sts.push(r.status); return r; } };
      const t = await harness({ mock, entered: true }), sid = t.live.sessionId; await movie(t);
      const endA = t.find('view', 'endCard'); eq(endA[0].whatIf, true);
      if (how === 'declined') { await toPlan(t, MOVIE); await t.card.decline(); }
      else if (how === 'cannot_do') await t.live.submit('order a pizza');
      else { await toPlan(t, 'limit please'); m.push(sid, 'expired', { rid: 'r2' }); m.push(sid, 'done', { outcome: 'expired', rid: 'r2' }); }
      await waitFor(() => t.live.phase === 'idle'); await settle();
      eq(count(t, 'view', 'endCard'), 1, 'B shows no end card');
      const from = t.log.length; endA[1].onWhatIf(); t.find('view', 'failures')[1]('lamp');
      await waitFor(() => count(t, 'view', 'endCard') === 2);
      const w = postsTo(t.mock, /\/whatif$/); eq(w.length, 1); eq(w[0].path, `sessions/${sid}/requests/r1/whatif`, 'A, not B'); eq(sts, [202]);
      const run = t.log.slice(from); ok(run.some((e) => e[0] === 'ui' && e[1] === 'resetRoom'), 'the replay starts with room');
      t.live.close();
    });
  }

  await check('status · a failed call and a commanded one keep their label on the status line (red only when not ok)', async () => {
    const wi = [['step', { id: 's1', status: 'running' }], CALL('c1', 'lamp', 'Floor lamp → 20%'), RES('c1', 'lamp', 'failed', 'not responding', false),
      CALL('c2', 'lamp', 'Floor lamp → 20% (retry)'), RES('c2', 'lamp', 'failed', 'still not responding', false),
      CALL('c3', 'pump', 'Water pump → on'), RES('c3', 'pump', 'commanded', 'sent, not confirmed', true), ['done', { outcome: 'ok' }]];
    const t = await harness({ mock: createMockLive({ scripts: WI_SCRIPTS(wi) }), entered: true }); await movie(t);
    const from = t.log.length; t.find('view', 'endCard')[1].onWhatIf(); t.find('view', 'failures')[1]('lamp');
    await waitFor(() => count(t, 'view', 'endCard') === 2); await sleep(100);
    const lines = statusLines(t, from);
    for (const want of [['Floor lamp → 20% · not responding', true], ['Floor lamp → 20% (retry) · still not responding', true], ['Water pump → on · sent, not confirmed', false]]) {
      ok(lines.some((l) => JSON.stringify(l) === JSON.stringify(want)), `status ${JSON.stringify(want)}`);
    }
    ok(!t.log.slice(from).some((e) => e[0] === 'panel' && e[1] === 'mark' && e[2] === 'pump' && e[3] === 'just'), 'a commanded result is no JUST SET');
    t.live.close();
  });

  await check('chips · closed when a request is submitted and on exit', async () => {
    const t = await harness({ entered: true }), c0 = count(t, 'view', 'closeChips');
    await t.live.submit(MOVIE); await waitFor(() => t.card?.enabled); ok(count(t, 'view', 'closeChips') > c0, 'closed on submit');
    t.live.close();
    const u = await harness({ entered: true }), d0 = count(u, 'view', 'closeChips'); u.live.exit(); eq(count(u, 'view', 'closeChips'), d0 + 1, 'closed on exit'); u.live.close();
  });

  await check('planning · on at submit, before the POST answers, once; off on a failed POST', async () => {
    let t = null, seen = null; const m = createMockLive();
    const mock = { ...m, fetch: (u, i) => { if (/\/requests$/.test(String(u)) && i?.method === 'POST') seen = t.log.filter((e) => e[0] === 'view' && e[1] === 'planning' && e[2] === true).length; return m.fetch(u, i); } };
    t = await harness({ mock, entered: true }); await toPlan(t, MOVIE);
    eq(seen, 1, 'Planning… shown before the POST left'); eq(t.log.filter((e) => e[0] === 'view' && e[1] === 'planning' && e[2] === true).length, 1, 'not turned on twice'); t.live.close();
    const m2 = createMockLive(), u = await harness({ mock: failOnce(m2, /\/requests$/, jsonAnswer(500, { error: 'internal', message: 'Oops.' })), entered: true });
    await u.live.submit(MOVIE); await settle();
    eq(u.log.filter((e) => e[0] === 'view' && e[1] === 'planning').map((e) => e[2]), [true, false], 'on, then off after the failure'); u.live.close();
  });
  // ---- Task 8: hand edits, edit events, clock state ----
  const lastClock = (t) => t.find('ui', 'clock')?.[0];
  const SOIL_EDIT = 'soil.moisture';
  const ncbCount = (t, text) => t.log.filter((e) => e[0] === 'view' && e[1] === 'ncb' && e[2] === text).length;
  await check('edit · a slider change posts set and moves the store at once', async () => {
    const t = await harness({ entered: true }); const before = t.store.get(SOIL_EDIT);
    ok(before !== 25, 'starts elsewhere');
    const p = t.live.edit(SOIL_EDIT, 25);
    eq(t.store.get(SOIL_EDIT), 25, 'moved before the POST answered');
    await p; await settle();
    const s = postsTo(t.mock, /\/set$/); eq(s.length, 1); eq(s[0].body, { path: SOIL_EDIT, value: 25 });
    eq(t.store.get(SOIL_EDIT), 25, 'stays'); t.live.close();
  });

  await check('edit · a rejected change rolls back with one message; a path outside the edit specs posts nothing', async () => {
    const t = await harness({ entered: true });
    await t.live.edit('lamp.status', 'fault'); await t.live.edit('nope.field', 1); await t.live.edit('lamp.on', true); await settle();
    eq(postsTo(t.mock, /\/set$/).length, 0, 'no POST for non-spec paths'); eq(t.store.get('lamp.status'), 'online');
    const prev = t.store.get('lamp.brightness'), n0 = ncbCount(t, LIVE_COPY.editRejected);
    await t.live.edit('lamp.brightness', 2); await settle();
    eq(postsTo(t.mock, /\/set$/).length, 1); eq(t.store.get('lamp.brightness'), prev, 'rolled back');
    eq(ncbCount(t, LIVE_COPY.editRejected), n0 + 1, 'one editRejected');
    t.live.close();
    const u = await harness({ entered: true }); u.live.exit(); await u.live.edit(SOIL_EDIT, 5); eq(postsTo(u.mock, /\/set$/).length, 0, 'no session, no POST'); u.live.close();
  });

  await check('edit · rate refusals roll back and say so at most once per 10 s', async () => {
    const t = await harness({ entered: true });
    await Promise.all(Array.from({ length: 12 }, (_, i) => t.live.edit(SOIL_EDIT, i + 1))); await settle();
    eq(postsTo(t.mock, /\/set$/).length, 12); eq(ncbCount(t, LIVE_COPY.editRate), 1, 'one message'); eq(t.store.get(SOIL_EDIT), 10, 'the last accepted value');
    await sleep(5100); await t.live.edit(SOIL_EDIT, 50); eq(t.store.get(SOIL_EDIT), 50, 'accepted after the window');
    await Promise.all(Array.from({ length: 11 }, (_, i) => t.live.edit(SOIL_EDIT, 60 + i))); eq(ncbCount(t, LIVE_COPY.editRate), 1, 'still within 10 s of the first message');
    await sleep(10100); await Promise.all(Array.from({ length: 12 }, (_, i) => t.live.edit(SOIL_EDIT, 20 + i))); eq(ncbCount(t, LIVE_COPY.editRate), 2, 'a second message after 10 s');
    t.live.close();
  });

  await check('edit · src edit events without rid apply (state, clock) and never wait in holding', async () => {
    const t = await harness({ entered: true }), sid = t.live.sessionId;
    t.mock.edit(sid, 'state', { path: 'lamp.brightness', value: 0.4, ms: 0 }); await settle();
    eq(t.store.get('lamp.brightness'), 0.4);
    t.mock.edit(sid, 'clock', { iso: '2026-11-08T22:30:00', label: 'Fri 22:30', hour: 22.5 }); await sleep(900);
    ok(t.find('ui', 'status')?.[0] !== 'Fri 22:30', 'a hand edit never takes the status line'); eq(lastClock(t).label, 'Fri 22:30'); eq(t.store.get('env.hour'), 22.5);
    t.live.close();
  });

  await check('edit · a src edit event applies even with a request id nobody holds', async () => {
    const t = await harness({ entered: true }), sid = t.live.sessionId;
    t.mock.push(sid, 'state', { path: 'soil.moisture', value: 31, ms: 0, src: 'edit', rid: 'r9' }); await settle();
    eq(t.store.get(SOIL_EDIT), 31, 'a stray rid with src edit still applies'); t.live.close();
  });

  const ruleRow = { at: 'Sat 07:00', text: 'Pump on', ok: true, kind: 'rule', origin: 'rule', device: 'pump' };
  const justs = (t) => t.log.filter((e) => e[0] === 'panel' && e[1] === 'mark' && e[3] === 'just').length;
  await check('edit · a rule fire outside a request is a chat line and marks JUST SET (rule and schedule, not held)', async () => {
    const t = await harness({ entered: true }), sid = t.live.sessionId;
    t.mock.edit(sid, 'timeline', ruleRow); await settle();
    eq(t.find('view', 'ruleLine'), [{ at: 'Sat 07:00', text: 'Pump on', ok: true, kind: 'rule', origin: 'rule' }]);
    ok(t.has('panel', 'mark', 'pump', 'just'), 'JUST SET');
    const m0 = justs(t);
    t.mock.edit(sid, 'timeline', { ...ruleRow, origin: 'held', ok: true }); t.mock.edit(sid, 'timeline', { ...ruleRow, ok: false });
    t.mock.edit(sid, 'timeline', { ...ruleRow, device: undefined }); await settle();
    eq(count(t, 'view', 'ruleLine'), 4, 'every row shows');
    eq(justs(t), m0, 'no JUST SET for held, failed or deviceless rows');
    t.mock.edit(sid, 'timeline', { ...ruleRow, origin: 'schedule', kind: 'action' }); await settle();
    eq(justs(t), m0 + 1, 'schedule marks');
    t.live.close();
  });

  await check('edit · a rule fire during a request goes to the checklist timeline', async () => {
    const t = await harness({ mock: movieMock(...OPEN_RUN), entered: true }), sid = t.live.sessionId;
    await toPlan(t, MOVIE); await t.card.approve(); await waitFor(() => t.live.phase === 'running');
    t.mock.push(sid, 'timeline', { ...ruleRow, src: 'edit', rid: 'r1' }); await settle();
    eq(t.find('checklist', 'timeline'), [{ at: 'Sat 07:00', text: 'Pump on', ok: true, kind: 'rule', origin: 'rule' }]); eq(count(t, 'view', 'ruleLine'), 0, 'no chat line');
    ok(t.has('panel', 'mark', 'pump', 'just'), 'JUST SET');
    t.live.close();
  });

  await check('clock · enabled only while idle', async () => {
    const t = await harness({ entered: true });
    eq(lastClock(t).enabled, true, 'after enter'); eq(lastClock(t).label, 'Fri 16:30');
    await toPlan(t, MOVIE); eq(lastClock(t).enabled, false, 'planning / awaiting'); eq(lastClock(t).reason, LIVE_COPY.clockBusy);
    await t.card.approve(); await waitFor(() => count(t, 'view', 'endCard') === 1);
    eq(lastClock(t).enabled, true, 'after done'); t.live.exit(); eq(lastClock(t).enabled, false, 'after exit'); t.live.close();
  });

  await check('clock · advance stays disabled until it answers', async () => {
    const t = await harness({ entered: true }), n0 = count(t, 'ui', 'clock');
    const p = t.live.advance(6); eq(lastClock(t).enabled, false, 'at once');
    await t.live.advance(1); eq(postsTo(t.mock, /\/advance$/).length, 1, 'a second advance while one runs is ignored');
    await p; eq(lastClock(t).enabled, true, 'after the answer'); eq(lastClock(t).label, 'Fri 22:30'); ok(count(t, 'ui', 'clock') > n0);
    eq(postsTo(t.mock, /\/advance$/)[0].body, { hours: 6 }); t.live.close();
  });

  await check('clock · advance refused (busy) says nothing extra and re-enables; rate says editRate; 401 asks for the code', async () => {
    const t = await harness({ mock: failOnce(createMockLive(), /\/advance$/, jsonAnswer(409, { error: 'busy', message: 'A request is already running.' })), entered: true });
    const n0 = count(t, 'view', 'ncb'); await t.live.advance(6); eq(count(t, 'view', 'ncb'), n0, 'no chat line'); eq(lastClock(t).enabled, true);
    const u = await harness({ mock: failOnce(createMockLive(), /\/advance$/, jsonAnswer(429, { error: 'rate', message: 'Too many.' })), entered: true });
    await u.live.advance(6); ok(u.has('view', 'ncb', LIVE_COPY.editRate), 'editRate'); eq(lastClock(u).enabled, true);
    const v = await harness({ mock: failOnce(createMockLive(), /\/advance$/, jsonAnswer(401, { error: 'unauthorized', message: 'No.' })), entered: true });
    await v.live.advance(6); await settle(); eq(accessCount(v), 2, '401 asks for the code again');
    t.live.close(); u.live.close(); v.live.close();
  });

  // ---- final review fixes ----
  // A mock whose advance answers only when released: what a visitor can do meanwhile.
  const slowAdvance = (m) => { let release; const gate = new Promise((r) => { release = r; }); return { mock: { ...m, fetch: (url, init) => (/\/advance$/.test(String(url)) ? gate.then(() => m.fetch(url, init)) : m.fetch(url, init)) }, release }; };
  const finished = async (t) => { await toPlan(t, MOVIE); await t.card.approve(); await waitFor(() => count(t, 'view', 'endCard') === 1); return t.find('view', 'endCard')[1]; };

  await check('advance · a typed request during an advance is held (input off, no POST, no error), then sent', async () => {
    const { mock, release } = slowAdvance(createMockLive()), t = await harness({ mock, entered: true });
    const p = t.live.advance(6); eq(lastInput(t), false, 'input off during the advance');
    await t.live.submit(MOVIE); await settle();
    eq(postsTo(t.mock, /\/requests$/).length, 0, 'no POST while advancing'); ok(!t.has('view', 'user', MOVIE), 'not shown as sent yet'); ok(!t.has('view', 'ncb', LIVE_COPY.error), 'no error line');
    release(); await p; await waitFor(() => count(t, 'view', 'planCard') === 1);
    eq(postsTo(t.mock, /\/requests$/).length, 1, 'sent once after the advance'); ok(!t.has('view', 'ncb', LIVE_COPY.error), 'still no error line'); eq(t.log.filter((e) => e[0] === 'view' && e[1] === 'input' && e[2] === true).length >= 2, true, 'input came back');
    t.live.close();
  });

  await check('advance · a what-if and a reset picked during an advance wait for it', async () => {
    const { mock, release } = slowAdvance(createMockLive()), t = await harness({ mock, entered: true });
    const acts = await finished(t);
    const p = t.live.advance(6); acts.onWhatIf(); t.find('view', 'failures')[1]('lamp'); await settle();
    eq(postsTo(t.mock, /\/whatif$/).length, 0, 'no what-if POST while advancing');
    release(); await p; await waitFor(() => postsTo(t.mock, /\/whatif$/).length === 1); ok(!t.has('view', 'ncb', LIVE_COPY.error), 'no error line');
    await waitFor(() => count(t, 'view', 'endCard') === 2);
    const b = slowAdvance(createMockLive()), u = await harness({ mock: b.mock, entered: true }), acts2 = await finished(u);
    const q = u.live.advance(6); acts2.onReset(); await settle(); eq(postsTo(u.mock, /\/reset$/).length, 0, 'no reset POST while advancing');
    b.release(); await q; await waitFor(() => postsTo(u.mock, /\/reset$/).length === 1); ok(!u.has('view', 'ncb', LIVE_COPY.error), 'reset: no error line');
    t.live.close(); u.live.close();
  });

  await check('advance · a refused advance gives the input back; an advance never takes the status line', async () => {
    const t = await harness({ mock: failOnce(createMockLive(), /\/advance$/, jsonAnswer(429, { error: 'rate', message: 'Too many.' })), entered: true });
    await t.live.advance(6); eq(lastInput(t), true, 'input back after an error');
    const u = await harness({ entered: true }), s0 = u.log.filter((e) => e[0] === 'ui' && e[1] === 'status').length;
    await u.live.advance(6); eq(u.log.filter((e) => e[0] === 'ui' && e[1] === 'status').length, s0, 'status line untouched'); eq(lastInput(u), true);
    t.live.close(); u.live.close();
  });

  await check('clock · the busy reason only while a request is under way (not for a reset)', async () => {
    const t = await harness({ entered: true }), acts = await finished(t);
    eq(lastClock(t).reason, null, 'idle: none');
    await t.live.submit(MOVIE); eq(lastClock(t).reason, LIVE_COPY.clockBusy, 'request: the reason');
    t.live.close();
    const u = await harness({ entered: true }), a2 = await finished(u);
    const reset = u.live.phase === 'idle'; ok(reset);
    const p = a2.onReset(); eq(lastClock(u).enabled, false, 'reset: disabled'); eq(lastClock(u).reason, null, 'reset: no request reason'); await p; await waitFor(() => lastClock(u).enabled === true);
    u.live.close();
  });

  await check('timeline · a held-back fire during a request keeps its origin for the checklist', async () => {
    const t = await harness({ mock: movieMock(...OPEN_RUN), entered: true }), sid = t.live.sessionId;
    await toPlan(t, MOVIE); await t.card.approve(); await waitFor(() => t.live.phase === 'running');
    t.mock.push(sid, 'timeline', { ...ruleRow, origin: 'held', kind: 'notify', text: 'It already ran 2 times today', src: 'edit', rid: 'r1' }); await settle();
    eq(t.find('checklist', 'timeline')?.[0].origin, 'held'); t.live.close();
  });

  await check('edit · a timeline row with a finished request\'s rid and src edit goes to the chat', async () => {
    const t = await harness({ entered: true }), sid = t.live.sessionId; await finished(t);
    t.mock.push(sid, 'timeline', { ...ruleRow, src: 'edit', rid: 'r1' }); await settle();
    eq(count(t, 'view', 'ruleLine'), 1, 'a chat line'); eq(count(t, 'checklist', 'timeline'), 0, 'not the closed checklist'); t.live.close();
  });

  await check('edit · a rejected change goes back to the room\'s value from the room event', async () => {
    const t = await harness({ entered: true }), room = t.store.get('lamp.brightness');
    t.store.set('lamp.brightness', 0.7); // drifted locally, never echoed
    await t.live.edit('lamp.brightness', 2); await settle();
    eq(t.store.get('lamp.brightness'), room, 'the room value, not the drifted one'); t.live.close();
  });

  await check('session · two no_session failures at once open one session and say timed-out once', async () => {
    const m = createMockLive(); let left = 2;
    const t = await harness({ mock: { ...m, fetch: (url, init) => (left > 0 && /\/set$/.test(String(url)) ? (left--, jsonAnswer(404, { error: 'no_session', message: 'That session has ended.' })()) : m.fetch(url, init)) }, entered: true });
    await Promise.all([t.live.edit(SOIL_EDIT, 11), t.live.edit(SOIL_EDIT, 12)]);
    await waitFor(() => t.live.phase === 'idle'); await settle();
    eq(postsTo(t.mock, /sessions$/).length, 2, 'the first session and one more'); eq(ncbCount(t, LIVE_COPY.timedOut), 1, 'one timed-out line'); t.live.close();
  });

  await check('edit · editing on in live mode, off after exit; the new copy is there', async () => {
    const t = await harness({ entered: true }); eq(t.find('ui', 'editing'), [true]);
    t.live.exit(); eq(t.find('ui', 'editing'), [false]); t.live.close();
    eq([LIVE_COPY.editRejected, LIVE_COPY.editRate, LIVE_COPY.clockBusy, LIVE_COPY.clockPlus1, LIVE_COPY.clockPlus6, LIVE_COPY.clockSet, LIVE_COPY.clockGo, LIVE_COPY.ruleFired, LIVE_COPY.ruleHeld, LIVE_COPY.scheduled],
      ["That change didn't go through, so the card is back to the room's value.", "That's a lot of changes at once. Slow down a little.", 'The clock moves again when this request is done.', '+1 h', '+6 h', 'Set time…', 'Go', 'Rule fired', 'Rule held back', 'Scheduled']);
  });

  // ---- automations and the direct Live AI entry (spec 2026-11-08-automations-design.md) ----
  const AUTO = 'When the soil is below 30%, run the pump, and every day at 19:00 dim the lamp';
  const R1 = automationsOf([RULE1])[0], S1 = automationsOf([SCHED1])[0];
  const autoLists = (t) => t.log.filter((e) => e[0] === 'ui' && e[1] === 'automations').map((e) => e[2]);
  const lastAutos = (t) => autoLists(t).at(-1);
  const enabledOf = (t, id) => lastAutos(t)?.find((a) => a.id === id)?.enabled;
  const flashes = (t) => t.log.filter((e) => e[0] === 'ui' && e[1] === 'automationFlash').map((e) => [e[2], e[3]]);
  const autoPosts = (m) => postsTo(m, /\/automations\/[^/]+$/);
  // A room with rule1 and sched1 in it, as their `automations` event (src edit, no rid) would leave it.
  const withAutos = async (t, items = [RULE1, SCHED1]) => { t.mock.edit(t.live.sessionId, 'automations', { items }); await settle(); };

  await check('rig · the automations route follows the contract (202 then an event; no_session, no_automation, bad_request, rate shared with set)', async () => {
    const { m, post, settle: s1, session } = rig(), sid = await session();
    const frames = async (after = 0) => { const r = await m.fetch(`${BASE}sessions/${sid}/events?after=${after}`, { headers: { authorization: `Bearer ${MOCK_CODE}` } }); const rd = r.body.getReader(), dec = new TextDecoder(); let b = ''; for (;;) { const x = await Promise.race([rd.read(), new Promise((res) => setTimeout(() => res({ done: true }), 5))]); if (x.done) break; b += dec.decode(x.value); } await rd.cancel(); return [...b.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map((a) => [a[1], JSON.parse(a[2])]); };
    const [st0, s0] = await post('sessions', { scene: 'home' }); eq([st0, s0.automations], [201, []], 'POST sessions answers an empty list');
    m.edit(sid, 'automations', { items: [RULE1] });
    eq(await post(`sessions/${sid}/automations/rule1`, { enabled: false }), [202, {}], 'a switch answers 202 {}');
    const last = (await frames()).at(-1);
    eq(last, ['automations', { items: [{ ...RULE1, enabled: false }], src: 'edit' }], 'then the whole list again, src edit, no rid while idle');
    eq((await post(`sessions/${sid}/automations/nope`, { enabled: true }))[1].error, 'no_automation', 'unknown id');
    eq((await post(`sessions/${sid}/automations/rule1`, {}))[1].error, 'bad_request', 'missing enabled');
    eq((await post(`sessions/${sid}/automations/rule1`, { enabled: 'yes' }))[1].error, 'bad_request', 'non-bool enabled');
    eq((await post('sessions/sess-99/automations/rule1', { enabled: true }))[1].error, 'no_session', 'unknown session');
    await new Promise((r) => setTimeout(r, 5001));
    for (let i = 0; i < 10; i++) await post(`sessions/${sid}/set`, { path: 'soil.moisture', value: i });
    eq((await post(`sessions/${sid}/automations/rule1`, { enabled: true }))[1].error, 'rate', 'shares the edit rate window');
    await new Promise((r) => setTimeout(r, 5001));
    const [, { requestId: rid }] = await post(`sessions/${sid}/requests`, { text: 'Movie night' }); await s1();
    eq((await post(`sessions/${sid}/automations/rule1`, { enabled: true }))[0], 202, 'allowed mid-request (never 409 busy)');
    eq((await frames()).filter((f) => f[0] === 'automations').at(-1)[1].rid, rid, 'mid-request, the event carries the request\'s rid');
    await post(`sessions/${sid}/requests/${rid}/decline`); await s1();
    const [rs, r] = await post(`sessions/${sid}/reset`); eq([rs, r.automations], [200, []], 'reset answers an empty list');
    eq((await post(`sessions/${sid}/automations/rule1`, { enabled: true }))[1].error, 'no_automation', 'and has cleared them');
  });

  await check('api · automation(sid, id, enabled) posts the contract route', async () => {
    const m = createMockLive(), api = createLiveApi({ base: 'http://mock', fetch: m.fetch, getCode: () => MOCK_CODE });
    const { sessionId } = await api.createSession('home'); m.edit(sessionId, 'automations', { items: [SCHED1] });
    eq(await api.automation(sessionId, 'sched1', false), {}, 'resolves {}');
    const c = m.calls.at(-1); eq([c.method, c.path, c.body], ['POST', `sessions/${sessionId}/automations/sched1`, { enabled: false }]);
    let err; try { await api.automation(sessionId, 'gone', true); } catch (e) { err = e; }
    ok(err instanceof LiveError && err.kind === 'no_automation' && err.status === 404, 'LiveError no_automation');
  });

  await check('automations · none in guided mode; an empty section once the session exists; gone when live mode ends', async () => {
    const t = await harness();
    eq(autoLists(t).length, 0, 'nothing before live mode');
    await t.live.open(); eq(autoLists(t).length, 0, 'nothing on the access card'); await t.lastAccess.code(MOCK_CODE);
    eq(autoLists(t), [[]], 'one empty list (the empty-state line)');
    ok(t.order('ui', 'editing', true) < t.log.findIndex((e) => e[1] === 'automations'), 'with the cards\' edit mode');
    t.live.exit(); eq(lastAutos(t), null, 'hidden after exit'); t.live.close();
    const u = await harness({ entered: true }); await withAutos(u); u.mock.set({ code: 'NCB-OTHR-CODE' }); u.mock.drop(u.live.sessionId);
    await waitFor(() => accessCount(u) === 2); eq(lastAutos(u), null, 'hidden when the code stops working'); u.live.close();
  });

  await check('automations · cards appear as the AI makes them (during the run), last list wins', async () => {
    const t = await harness({ entered: true }); await toPlan(t, AUTO); await t.card.approve();
    await waitFor(() => count(t, 'view', 'endCard') === 1);
    eq(autoLists(t).map((l) => l.map((a) => a.id)), [[], ['rule1'], ['rule1', 'sched1'], ['rule1', 'sched1']], 'one list per event, in creation order');
    const firstCard = t.log.findIndex((e) => e[1] === 'automations' && e[2]?.length === 1);
    ok(firstCard > 0 && firstCard < t.order('view', 'endCard') && firstCard < t.order('checklist', 'step', 's2', 'running'), 'the rule\'s card shows while step 1 runs, before done');
    eq(lastAutos(t), [R1, { ...S1, firedToday: 1 }], 'the last list: the schedule ran once today');
    eq(t.live.automations, lastAutos(t), 'live.automations is what shows');
    t.live.close();
  });

  await check('automations · applied whatever their rid or src, never held; malformed lists and items are dropped', async () => {
    const t = await harness({ entered: true }), sid = t.live.sessionId;
    t.mock.push(sid, 'automations', { items: [RULE1], rid: 'r9' }); await settle(); eq(lastAutos(t), [R1], 'a rid nobody asked for');
    t.mock.push(sid, 'automations', { items: [SCHED1, { kind: 'rule' }, SCHED1, { ...RULE1, enabled: 'no', firedToday: -2, kind: 'x', devices: 'pump' }], rid: 'r9' }); await settle();
    eq(lastAutos(t), [S1, { ...R1, devices: [] }], 'no id and repeated ids dropped; odd fields made safe');
    const n0 = autoLists(t).length; t.mock.push(sid, 'automations', { items: 'x', rid: 'r9' }); await settle(); eq(autoLists(t).length, n0, 'items not a list: ignored');
    // while a request's POST is in flight (its events are held until it answers), an automations event still applies at once
    let release; const gate = new Promise((r) => { release = r; });
    const m = createMockLive(), u = await harness({ mock: { ...m, fetch: (url, init) => (/\/requests$/.test(String(url)) ? gate.then(() => m.fetch(url, init)) : m.fetch(url, init)) }, entered: true });
    const p = u.live.submit(MOVIE); await settle();
    m.push(u.live.sessionId, 'automations', { items: [RULE1], rid: 'r1' }); await settle();
    eq(lastAutos(u), [R1], 'not held behind the request\'s POST');
    release(); await p; await waitFor(() => count(u, 'view', 'planCard') === 1);
    t.live.close(); u.live.close();
  });

  await check('automations · a switch shows at once, posts the route, and the server\'s list then agrees (off and on)', async () => {
    const t = await harness({ entered: true }), sid = t.live.sessionId; await withAutos(t);
    const p = t.live.setAutomation('rule1', false);
    eq(enabledOf(t, 'rule1'), false, 'off before the POST answers'); eq(enabledOf(t, 'sched1'), true, 'the other one untouched');
    await p; await settle();
    eq(autoPosts(t.mock).map((c) => [c.path, c.body]), [[`sessions/${sid}/automations/rule1`, { enabled: false }]], 'the route and body');
    eq(enabledOf(t, 'rule1'), false, 'the server\'s list agrees');
    await t.live.setAutomation('rule1', true); await settle(); eq(enabledOf(t, 'rule1'), true, 'on again');
    await t.live.setAutomation('nope', true); await t.live.setAutomation('rule1', 'yes'); await settle();
    eq(autoPosts(t.mock).length, 2, 'an unknown id or a non-bool value posts nothing');
    ok(!t.has('view', 'ncb', LIVE_COPY.autoRejected), 'no message when it went through');
    // mid-request, too (allowed any time): the switch goes, the request runs on
    await toPlan(t, MOVIE); await t.live.setAutomation('sched1', false); await settle();
    eq(enabledOf(t, 'sched1'), false, 'switched while the plan waits'); eq(t.live.phase, 'awaiting', 'the request is untouched');
    t.live.close(); const u = await harness({ entered: true }); u.live.exit(); await u.live.setAutomation('rule1', false); eq(autoPosts(u.mock).length, 0, 'no session, no POST'); u.live.close();
  });

  await check('automations · until the server applies a switch (a toggle queued mid-request), a stale list keeps the visitor\'s value', async () => {
    const m = createMockLive(); let held = 0;
    const t = await harness({ mock: { ...m, fetch: (url, init) => (/\/automations\//.test(String(url)) ? (held++, Promise.resolve(new Response('{}', { status: 202, headers: { 'content-type': 'application/json' } }))) : m.fetch(url, init)) }, entered: true });
    const sid = t.live.sessionId; await withAutos(t, [RULE1]);
    await t.live.setAutomation('rule1', false); await settle(); eq(held, 1, '202, no event yet');
    m.push(sid, 'automations', { items: [{ ...RULE1, firedToday: 1 }], rid: 'r9' }); await settle();
    eq([enabledOf(t, 'rule1'), lastAutos(t)[0].firedToday], [false, 1], 'a list from before the toggle: still off, the count updates');
    m.edit(sid, 'automations', { items: [{ ...RULE1, enabled: false, firedToday: 1 }] }); await settle(); eq(enabledOf(t, 'rule1'), false, 'the server agrees');
    m.edit(sid, 'automations', { items: [{ ...RULE1, enabled: true, firedToday: 1 }] }); await settle(); eq(enabledOf(t, 'rule1'), true, 'from here the server\'s list rules again');
    t.live.close();
  });

  await check('automations · a refused switch goes back with a short line: 404 no_automation, 429 rate (once per 10 s), other errors', async () => {
    for (const [st, kind, line] of [[404, 'no_automation', LIVE_COPY.autoGone], [400, 'bad_request', LIVE_COPY.autoRejected], [500, 'internal', LIVE_COPY.autoRejected], [429, 'rate', LIVE_COPY.editRate]]) {
      const t = await harness({ mock: failOnce(createMockLive(), /\/automations\//, jsonAnswer(st, { error: kind, message: 'No.' })), entered: true }); await withAutos(t);
      const p = t.live.setAutomation('rule1', false); eq(enabledOf(t, 'rule1'), false, `${kind}: off at once`);
      await p; await settle();
      eq(enabledOf(t, 'rule1'), true, `${kind}: back on`); eq(ncbCount(t, line), 1, `${kind}: one line`);
      t.live.close();
    }
    const n = await harness({ mock: failOnce(createMockLive(), /\/automations\//, () => Promise.reject(new TypeError('Failed to fetch'))), entered: true }); await withAutos(n);
    await n.live.setAutomation('sched1', false); await settle(); eq(enabledOf(n, 'sched1'), true, 'network: back on'); ok(n.has('view', 'ncb', LIVE_COPY.autoRejected)); n.live.close();
    // a later flip of the same switch has moved it on: the earlier one's refusal doesn't put it back
    const m = createMockLive(); let first = true, release; const gate = new Promise((r) => { release = r; });
    const t = await harness({ mock: { ...m, fetch: (url, init) => { if (/\/automations\//.test(String(url)) && first) { first = false; return gate.then(jsonAnswer(500, { error: 'internal', message: 'No.' })); } return m.fetch(url, init); } }, entered: true });
    await withAutos(t, [RULE1]);
    const p1 = t.live.setAutomation('rule1', false); await t.live.setAutomation('rule1', false); await settle();
    const p2 = t.live.setAutomation('rule1', true); eq(enabledOf(t, 'rule1'), true, 'the latest flip shows'); await p2; await settle();
    release(); await p1; await settle(); eq(enabledOf(t, 'rule1'), true, 'the older refusal leaves the newer value'); t.live.close();
    // the code stopped working, or the session expired
    const a = await harness({ mock: failOnce(createMockLive(), /\/automations\//, jsonAnswer(401, { error: 'bad_code', message: 'No.' })), entered: true }); await withAutos(a);
    await a.live.setAutomation('rule1', false); await settle(); eq(accessCount(a), 2, '401 asks for the code again'); eq(lastAutos(a), null, 'and the section goes'); a.live.close();
    const b = await harness({ mock: failOnce(createMockLive(), /\/automations\//, jsonAnswer(404, { error: 'no_session', message: 'Gone.' })), entered: true }); await withAutos(b);
    const sid = b.live.sessionId; await b.live.setAutomation('rule1', false); await waitFor(() => b.live.sessionId !== sid && b.live.phase === 'idle');
    eq(lastAutos(b), [], 'no_session: a fresh room, no automations yet'); b.live.close();
  });

  await check('automations · a timeline row with an automation id flashes its card (rule and schedule: JUST RAN, held: HELD), in a request and outside one', async () => {
    const t = await harness({ entered: true }), sid = t.live.sessionId; await toPlan(t, AUTO); await t.card.approve();
    await waitFor(() => count(t, 'view', 'endCard') === 1);
    eq(flashes(t), [['sched1', 'ran']], 'the schedule ran during the request\'s fast-forward');
    ok(t.has('checklist', 'timeline', { at: 'Fri 19:00', text: 'Floor lamp → 35%', ok: true, kind: 'action', origin: 'schedule' }), 'its row is in the checklist as before');
    const row = { at: 'Sat 07:00', text: 'Water pump → on for 10 s', ok: true, kind: 'action', device: 'pump' };
    t.mock.edit(sid, 'timeline', { ...row, origin: 'rule', automation: 'rule1' });
    t.mock.edit(sid, 'timeline', { ...row, origin: 'held', kind: 'notify', automation: 'rule1' });
    t.mock.edit(sid, 'timeline', { ...row, origin: 'schedule', ok: false, automation: 'sched1' });
    t.mock.edit(sid, 'timeline', { ...row, origin: 'rule', automation: 'rule9' });
    t.mock.edit(sid, 'timeline', { ...row, automation: 'rule1' });
    t.mock.edit(sid, 'timeline', { ...row, origin: 'rule' }); await settle();
    eq(flashes(t).slice(1), [['rule1', 'ran'], ['rule1', 'held'], ['sched1', 'ran']], 'outside a request; an unknown id, a row without origin or without an id flash nothing');
    eq(count(t, 'view', 'ruleLine'), 6, 'every row still has its chat line');
    t.live.close();
  });

  await check('automations · Reset room clears them; a what-if\'s room replaces them (and drops a switch not yet applied)', async () => {
    const t = await harness({ entered: true }), sid = t.live.sessionId; await toPlan(t, AUTO); await t.card.approve();
    await waitFor(() => count(t, 'view', 'endCard') === 1); eq(lastAutos(t).length, 2);
    const acts = t.find('view', 'endCard')[1], n0 = autoLists(t).length;
    acts.onWhatIf(); t.find('view', 'failures')[1]('lamp');
    await waitFor(() => count(t, 'view', 'endCard') === 2);
    const during = autoLists(t).slice(n0);
    eq(during[0], [], 'the what-if\'s room: the room before the request, which had none');
    eq(during.map((l) => l.length), [0, 0, 1, 2, 2], 'the same list again as an automations event, then the replay sets them up again');
    eq(flashes(t).at(-1), ['sched1', 'ran'], 'the failing schedule still flashes (it ran, the lamp did not respond)');
    t.mock.push(sid, 'room', { state: { lamp: { on: false, brightness: 0, status: 'online' } }, clock: { iso: '2026-11-13T16:30:00', label: 'Fri 16:30', hour: 16.5 }, automations: [{ ...SCHED1, enabled: false }], rid: 'r9' }); await settle();
    eq(lastAutos(t), [{ ...S1, enabled: false }], 'a room event replaces the list with its own, on/off state included');
    const n1 = autoLists(t).length; t.mock.push(sid, 'room', { state: { lamp: { on: false } }, clock: { iso: '2026-11-13T16:30:00', label: 'Fri 16:30', hour: 16.5 }, rid: 'r9' }); await settle();
    eq(autoLists(t).length, n1, 'a room without a list leaves it be');
    await t.find('view', 'endCard')[1].onReset(); await settle();
    eq(lastAutos(t), [], 'Reset room: none left'); ok(t.has('view', 'ncb', FRESH_START));
    // a switch flipped just before the room changes goes with it
    const m = createMockLive(); let left = 1;
    const u = await harness({ mock: { ...m, fetch: (url, init) => (/\/automations\//.test(String(url)) && left-- > 0 ? jsonAnswer(202, {})() : m.fetch(url, init)) }, entered: true });
    await withAutos(u, [RULE1]); await u.live.setAutomation('rule1', false); eq(enabledOf(u, 'rule1'), false);
    m.push(u.live.sessionId, 'room', { state: {}, clock: { iso: '2026-11-13T16:30:00', label: 'Fri 16:30', hour: 16.5 }, automations: [RULE1], rid: 'r9' }); await settle();
    eq(enabledOf(u, 'rule1'), true, 'the room\'s own state wins'); t.live.close(); u.live.close();
  });

  await check('live entry · announced availability: probe, open, exit, a budget stop', async () => {
    const avail = (t) => t.log.filter((e) => e[0] === 'ui' && e[1] === 'availability').map((e) => e[2]);
    const t = await harness(); await t.live.probe(); eq(avail(t), [{ available: true, active: false }], 'probe: available, not open');
    await t.live.probe(); eq(avail(t).length, 1, 'no repeat while nothing changed');
    await t.live.open(); eq(avail(t).at(-1), { available: true, active: true }, 'open: active at once');
    t.lastAccess.back(); eq(avail(t).at(-1), { available: true, active: false }, 'Back: not open again');
    ok(t.order('ui', 'offerGuided') < t.log.findLastIndex((e) => e[1] === 'availability'), 'after the guided requests are back');
    const u = await harness({ mock: createMockLive({ liveEnabled: false }) }); await u.live.probe(); eq(avail(u), [{ available: false, active: false }], 'live off: not available');
    const v = await harness({ entered: true }); await toPlan(v, MOVIE); v.mock.push(v.live.sessionId, 'limit', { kind: 'budget', rid: 'r1' }); v.mock.push(v.live.sessionId, 'done', { outcome: 'limit', rid: 'r1' });
    await waitFor(() => !v.live.active); eq(avail(v).at(-1), { available: false, active: false }, 'the kill switch: not available any more');
    const w = await harness({ entered: true }); w.live.close(); const n = w.log.length; await w.live.probe(); eq(w.log.length, n, 'silent after close');
    t.live.close(); u.live.close(); v.live.close();
  });

  // The header button over the real live client: a stub flow records stop(), show() records what the button does.
  const entryRig = async ({ live = 'make', mock } = {}) => {
    const t = await harness(mock ? { mock } : {}), shown = [], order = [];
    const flow = { stop: async () => { order.push('stop'); await settle(); order.push('stopped'); } };
    const lv = live === 'make' ? t.live : live;
    const realOpen = lv?.open; if (lv) lv.open = async (...a) => { order.push('open'); return realOpen.apply(lv, a); };
    const e = createLiveEntry({ live: lv, flow, show: (on) => shown.push(on) });
    t.ui.availability = () => e.sync();
    return { t, e, shown, order };
  };
  await check('live entry · the header button shows only with live mode available and not open; hidden without an API base', async () => {
    const none = await entryRig({ live: null }); none.e.sync(); eq(none.shown, [false], 'no API base (no live): hidden'); await none.e.open(); eq(none.order, [], 'and pressing it does nothing');
    const { t, e, shown } = await entryRig(); e.sync(); eq(shown, [false], 'before /health answers: hidden');
    await t.live.probe(); eq(shown.at(-1), true, 'live available: shown');
    const off = await entryRig({ mock: createMockLive({ scenes: ['lab'] }) }); await off.t.live.probe(); eq(off.shown.at(-1), false, '/health without this scene: hidden');
    await t.live.open(); eq(shown.at(-1), false, 'live open (the access card): hidden');
    await t.lastAccess.code(MOCK_CODE); eq(shown.at(-1), false, 'in live mode: hidden'); eq(t.live.phase, 'idle');
    t.live.exit(); eq(shown.at(-1), true, 'back to guided: shown again');
    t.live.close(); off.t.live.close();
  });

  await check('live entry · pressing it stops the guided flow first, then opens live mode (one at a time)', async () => {
    const { t, e, shown, order } = await entryRig(); await t.live.probe();
    const p = e.open(); eq(shown.at(-1), false, 'hidden at once'); const q = e.open();
    await p; await q;
    eq(order, ['stop', 'stopped', 'open'], 'stop() resolves before live.open(); a second press while opening does nothing');
    eq(t.find('view', 'access')[0], { mode: 'code' }, 'the access card, as the end card\'s live button gives');
    await t.lastAccess.code(MOCK_CODE); eq(t.live.active, true); await e.open(); eq(order.length, 3, 'pressing it in live mode does nothing'); t.live.close();
    const s = await entryRig(); s.t.codes.set(MOCK_CODE); await s.t.live.probe(); await s.e.open();
    eq([s.t.live.phase, s.shown.at(-1)], ['idle', false], 'a saved code: straight into live mode, the button hidden'); s.t.live.close();
  });

  await check('automations · Reset room: its answer\'s empty list and the one automations event it sends apply in either order', async () => {
    const t = await harness({ entered: true }), sid = t.live.sessionId; await toPlan(t, AUTO); await t.card.approve();
    await waitFor(() => count(t, 'view', 'endCard') === 1);
    const n0 = autoLists(t).length, k0 = (await streamKinds(t.mock, sid)).filter((k) => k === 'automations').length;
    await t.find('view', 'endCard')[1].onReset(); await settle();
    eq((await streamKinds(t.mock, sid)).filter((k) => k === 'automations').length - k0, 1, 'the server sent one automations event for the reset');
    const after = autoLists(t).slice(n0); ok(after.length >= 1 && after.every((l) => Array.isArray(l) && l.length === 0), `every list since the reset is empty: ${JSON.stringify(after)}`);
    t.mock.edit(sid, 'automations', { items: [] }); await settle(); eq(lastAutos(t), [], 'the event once more (a late copy): still empty');
    // the event first, then the answer (as when the stream is quicker than the HTTP answer): the same end
    const m = createMockLive(); let early = null;
    const u = await harness({ mock: { ...m, fetch: async (url, init) => { if (/\/reset$/.test(String(url))) { early = autoLists(u).length; m.edit(u.live.sessionId, 'automations', { items: [] }); await settle(); } return m.fetch(url, init); } }, entered: true });
    await withAutos(u, [RULE1]); await toPlan(u, MOVIE); await u.card.approve(); await waitFor(() => count(u, 'view', 'endCard') === 1);
    await u.find('view', 'endCard')[1].onReset(); await settle();
    eq(autoLists(u).slice(early).map((l) => l.length), [0, 0], 'the event\'s empty list, then the answer\'s'); eq(lastAutos(u), [], 'empty');
    // nothing to clear: no event
    const v = await harness({ entered: true }), k2 = (await streamKinds(v.mock, v.live.sessionId)).length;
    eq((await v.mock.fetch(`${BASE}sessions/${v.live.sessionId}/reset`, { method: 'POST', headers: { authorization: `Bearer ${MOCK_CODE}` }, body: '{}' })).status, 200);
    eq((await streamKinds(v.mock, v.live.sessionId)).length, k2, 'a reset with nothing to clear sends no event');
    t.live.close(); u.live.close(); v.live.close();
  });

  await check('automations · an advance past midnight sets the day\'s counts back to 0 (an automations event, src edit, no rid)', async () => {
    const t = await harness({ entered: true }); await withAutos(t, [{ ...SCHED1, firedToday: 2 }, RULE1]);
    eq(lastAutos(t)[0].firedToday, 2);
    await t.live.advance(6); await settle(); eq(lastAutos(t)[0].firedToday, 2, '16:30 → 22:30: the same day');
    await t.live.advance(6); await settle(); eq(lastAutos(t).map((a) => a.firedToday), [0, 0], 'past midnight: back to 0');
    t.live.close();
  });
}
