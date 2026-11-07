// Check 18: the live client against the contract mock (test/fixtures/live-mock.mjs).
//   liveChecks({ report, initialOf, guardHits }) runs the checks below. Tasks 2-5 add the client's own; this file
//   also holds the harness they share (check / eq / ok / harness and the stub LiveView, panel and ui).
import { createStore } from '../js/engine/store.js';
import { virtualTime } from './clock.mjs';
import { createMockLive, MOCK_CODE } from './fixtures/live-mock.mjs';
import home from '../js/scenes/home.js';

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
}
