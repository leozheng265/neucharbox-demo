// An in-memory server that speaks the live API contract (docs/superpowers/specs/2026-11-07-live-api-contract.md),
// for the live-client checks (test/live.mjs) and, over HTTP, for browser checks (test/mock-live.mjs).
// createMockLive(opts) → { fetch(url, init) → Promise<Response>, calls, push(sid, kind, data), drop(sid), expire(sid), set(opts) }.
// Node built-ins only; no timers unless `pace` > 0 (so it runs on test/clock.mjs's virtual clock too).

export const MOCK_CODE = 'NCB-TEST-CASE';

const norm = (c) => String(c ?? '').toUpperCase().replace(/\s+/g, '');
const CLOCK = { iso: '2026-11-13T16:30:00', label: 'Fri 16:30', hour: 16.5 };
const homeState = () => ({
  lamp: { on: false, brightness: 0, status: 'online' }, blinds: { closed: 0, status: 'online' },
  soil: { moisture: 34, status: 'online' }, pump: { running: false, status: 'online' },
  camera: { armed: false, motion: false, status: 'online' }, thermostat: { target: 21, current: 21.4, status: 'online' },
  env: { hour: CLOCK.hour },
});
const SUGGESTIONS = ['Movie night, but keep an eye on the plant', "I'm away for the weekend", 'Water the plant if it is dry'];
const clone = (v) => JSON.parse(JSON.stringify(v));

// ---------------- scripted runs ----------------
// A script is a list of segments { on: 'request'|'approve'|'decline'|'whatif', kind?, events: [[kind, data], …] }.
// A `decline` segment with a `kind` answers only a card of that kind. `whatif` is the events after room + plan.
const st = (id, status) => ['step', { id, status }];
const state = (path, value, ms = 0) => ['state', { path, value, ms }];
const call = (step, callId, device, action, args, label) => ['call', { step, callId, device, action, args, label }];
const result = (callId, step, device, outcome, text, ok = true) => ['result', { callId, step, device, ok, outcome, text }];
const DONE_OK = ['done', { outcome: 'ok' }];
const MOVIE_STEPS = [
  { id: 's1', text: 'Dim the floor lamp to 20%', devices: ['lamp'] },
  { id: 's2', text: 'Close the blinds fully', devices: ['blinds'] },
  { id: 's3', text: 'Read the soil sensor; water only if under 30%', devices: ['soil', 'pump'] },
];
const movieRun = () => [
  st('s1', 'running'), call('s1', 'c1', 'lamp', 'set', { on: true, brightness: 0.2 }, 'Floor lamp → 20%'),
  state('lamp.on', true), state('lamp.brightness', 0.2, 1200), result('c1', 's1', 'lamp', 'confirmed', 'confirmed'), st('s1', 'done'),
  st('s2', 'running'), call('s2', 'c2', 'blinds', 'set', { closed: 1 }, 'Blinds → closed'),
  state('blinds.closed', 1, 3000), result('c2', 's2', 'blinds', 'confirmed', 'confirmed'), st('s2', 'done'),
];
const SOIL_READ = (id, callId, text) => [['reading', { device: 'soil' }], call(id, callId, 'soil', 'read', {}, 'Soil sensor → reading'), result(callId, id, 'soil', 'reading', text)];
export const SCRIPTS = {
  movie: [
    { on: 'request', events: [['planning', {}], ['reading', { device: 'soil' }], ['plan', { steps: MOVIE_STEPS, horizonHours: null }], ['awaiting_approval', { kind: 'plan' }]] },
    { on: 'approve', events: [...movieRun(),
      st('s3', 'running'), ...SOIL_READ('s3', 'c3', '34%'), st('s3', 'done'),
      ['say', { delta: 'The lamp is down to 20% and the blinds are closed. ' }], ['say', { delta: 'The soil reads 34%, so the pump stayed off.' }],
      ['summary', { text: 'The lamp is at 20%, the blinds are closed, and the soil reads 34%, so the pump stayed off.' }], DONE_OK] },
    { on: 'decline', events: [['declined', {}], ['done', { outcome: 'declined' }]] },
  ],
  replan: [
    { on: 'request', events: [['planning', {}], ['plan', { steps: [
      { id: 's1', text: 'Read the soil sensor', devices: ['soil'] },
      { id: 's2', text: 'Leave the pump off if the soil is over 30%', devices: ['pump'] }], horizonHours: null }], ['awaiting_approval', { kind: 'plan' }]] },
    { on: 'approve', events: [st('s1', 'running'), ...SOIL_READ('s1', 'c1', '28%'), st('s1', 'done'),
      ['replan', { steps: [
        { id: 's2', text: 'Water the plant for 6 seconds', devices: ['pump'] },
        { id: 's3', text: 'Read the soil sensor again', devices: ['soil'] }], reason: 'the soil reads 28%, under the 30% you asked for' }],
      ['awaiting_approval', { kind: 'replan' }]] },
    { on: 'approve', events: [st('s2', 'running'),
      call('s2', 'c2', 'pump', 'set', { running: true, seconds: 6 }, 'Water pump → on for 6 s'), state('pump.running', true),
      result('c2', 's2', 'pump', 'commanded', 'commanded'), st('s2', 'done'),
      call(null, 'c3', 'pump', 'set', { running: false }, 'Water pump → off'), state('pump.running', false),
      result('c3', null, 'pump', 'made_safe', 'made safe'),
      st('s3', 'running'), ...SOIL_READ('s3', 'c4', '35%'), st('s3', 'done'),
      ['summary', { text: 'The pump ran for 6 seconds and is off again. The soil now reads 35%.' }], DONE_OK] },
    { on: 'decline', kind: 'plan', events: [['declined', {}], ['done', { outcome: 'declined' }]] },
    { on: 'decline', kind: 'replan', events: [['summary', { text: 'I left the pump off, as you asked. The soil sensor read 28%.' }], DONE_OK] },
  ],
  weekend: [
    { on: 'request', events: [['planning', {}], ['plan', { steps: [
      { id: 's1', text: 'Turn the floor lamp on in the evenings', devices: ['lamp'] },
      { id: 's2', text: 'Arm the door camera and tell me about visitors', devices: ['camera'] }], horizonHours: 48 }], ['awaiting_approval', { kind: 'plan' }]] },
    { on: 'approve', events: [
      st('s1', 'running'), st('s1', 'done'), st('s2', 'running'),
      ['clock', { iso: '2026-11-13T18:00:00', label: 'Fri 18:00', hour: 18 }],
      ['timeline', { at: 'Fri 18:00', text: 'Floor lamp → 35%', ok: true, kind: 'action' }],
      ['clock', { iso: '2026-11-13T22:30:00', label: 'Fri 22:30', hour: 22.5 }],
      ['clock', { iso: '2026-11-14T07:10:00', label: 'Sat 07:10', hour: 31.17 }],
      ['timeline', { at: 'Sat 07:10', text: 'Floor lamp → off', ok: true, kind: 'action' }],
      ['clock', { iso: '2026-11-14T18:00:00', label: 'Sat 18:00', hour: 42 }],
      ['timeline', { at: 'Sat 19:20', text: 'Sent you: someone at the door', ok: true, kind: 'notify' }],
      ['clock', { iso: '2026-11-15T09:00:00', label: 'Sun 09:00', hour: 57 }],
      ['timeline', { at: 'Sun 09:00', text: 'Floor lamp → off', ok: true, kind: 'action' }],
      ['clock', { iso: '2026-11-15T16:30:00', label: 'Sun 16:30', hour: 64.5 }],
      st('s2', 'done'),
      ['summary', { text: 'The lamp followed your evenings and I told you about the visitor at the door.' }], DONE_OK] },
    { on: 'decline', events: [['declined', {}], ['done', { outcome: 'declined' }]] },
  ],
  cannot: [
    { on: 'request', events: [['planning', {}],
      ['cannot_do', { reason: 'I can’t order food from here, only control the devices in this home.', suggestions: ['Movie night, but keep an eye on the plant', "I'm away for the weekend"] }],
      ['done', { outcome: 'cannot_do' }]] },
  ],
  limitCalls: [
    { on: 'request', events: [['planning', {}], ['plan', { steps: [
      { id: 's1', text: 'Dim the floor lamp to 20%', devices: ['lamp'] },
      { id: 's2', text: 'Close the blinds fully', devices: ['blinds'] }], horizonHours: null }], ['awaiting_approval', { kind: 'plan' }]] },
    { on: 'approve', events: [st('s1', 'running'), call('s1', 'c1', 'lamp', 'set', { on: true, brightness: 0.2 }, 'Floor lamp → 20%'),
      state('lamp.on', true), state('lamp.brightness', 0.2, 1200), result('c1', 's1', 'lamp', 'confirmed', 'confirmed'),
      ['limit', { kind: 'calls' }], ['done', { outcome: 'limit' }]] },
    { on: 'decline', events: [['declined', {}], ['done', { outcome: 'declined' }]] },
  ],
};
// The what-if replay of `movie` (after `room` and `plan`): the lamp fails, the rest goes on.
SCRIPTS.movie.whatif = [
  st('s1', 'running'), call('s1', 'c1', 'lamp', 'set', { on: true, brightness: 0.2 }, 'Floor lamp → 20%'),
  ['fault', { device: 'lamp', text: 'not responding' }], state('lamp.status', 'fault'),
  result('c1', 's1', 'lamp', 'failed', 'not responding', false), st('s1', 'failed'),
  st('s2', 'running'), call('s2', 'c2', 'blinds', 'set', { closed: 1 }, 'Blinds → closed'),
  state('blinds.closed', 1, 3000), result('c2', 's2', 'blinds', 'confirmed', 'confirmed'), st('s2', 'done'),
  ['summary', { text: 'The floor lamp did not respond, so the room stayed lit as it was. The blinds are closed.' }], DONE_OK,
];
export const SCRIPT_PICK = [[/pizza/i, 'cannot'], [/movie/i, 'movie'], [/limit/i, 'limitCalls'], [/water|soil/i, 'replan'], [/weekend|week|away/i, 'weekend'], [/.*/, 'movie']];

// ---------------- the server ----------------
const abortError = () => new DOMException('The operation was aborted.', 'AbortError');
const mergeSteps = (steps, more) => { const out = steps.map((s) => ({ ...s })); for (const s of more) { const i = out.findIndex((x) => x.id === s.id); if (i >= 0) out[i] = { ...s }; else out.push({ ...s }); } return out; };
// What a hand edit may change (the same table as the server): path → 'bool' or [min, max].
const EDITABLE = { 'lamp.brightness': [0, 1], 'blinds.closed': [0, 1], 'soil.moisture': [0, 100], 'pump.running': 'bool', 'camera.armed': 'bool', 'camera.motion': 'bool', 'thermostat.target': [10, 28], 'thermostat.current': [5, 35] };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n) => String(n).padStart(2, '0');
// The room clock `hours` later (the mock reads the ISO time as UTC, which is only arithmetic here).
const clockAfter = (c, hours) => {
  const d = new Date(Date.parse(`${c.iso}Z`) + Math.round(hours * 3600000));
  return { iso: d.toISOString().slice(0, 19), label: `${DAYS[d.getUTCDay()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`, hour: c.hour + hours };
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function createMockLive({ scene = 'home', scenes = [scene], code = MOCK_CODE, liveEnabled = true, off = null, remaining = 20, mode = 'json', pace = 0, scripts = SCRIPTS } = {}) {
  const cfg = { scene, scenes, code, liveEnabled, off, remaining, mode, pace };
  const calls = [], editTimes = new Map(), sessions = new Map(), enc = new TextEncoder();
  let nSession = 0;

  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fail = (status, error, message) => json(status, { error, message });

  // Add an event to a session's list and to every open stream; keep the room (state, clock) and the run in step.
  // A null or undefined `rid` leaves the key out (an edit outside a request has none).
  function emit(sess, kind, data, rid) {
    const run = sess.run;
    if (kind === 'state') { const [d, ...f] = data.path.split('.'); if (sess.state[d]) sess.state[d][f.join('.')] = data.value; }
    else if (kind === 'clock') { sess.clock = { iso: data.iso, label: data.label, hour: data.hour }; sess.state.env.hour = data.hour; }
    else if (kind === 'room') { sess.state = clone(data.state); sess.clock = clone(data.clock); }
    else if (run && kind === 'plan') run.steps = clone(data.steps);
    else if (run && kind === 'replan') run.proposed = clone(data.steps);
    else if (run && kind === 'call') run.calls++;
    if (kind === 'awaiting_approval') sess.pending = data.kind;
    let out = data;
    if (kind === 'done') {
      out = { usage: { promptTokens: 1200, completionTokens: 180, calls: run?.calls ?? 0 }, remainingToday: cfg.remaining, ...data };
      sess.active = null; sess.pending = null;
      if (run && !run.whatif && (data.outcome === 'ok' || data.outcome === 'failed') && run.steps.length) sess.last = run; // the latest replayable request (contract): a declined, cannot_do, expired or limit one never replaces it
    }
    if (kind === 'cannot_do' || kind === 'declined') sess.pending = null;
    const seq = sess.events.length + 1, ev = { seq, kind, data: rid == null ? { ...out } : { ...out, rid } };
    sess.events.push(ev);
    const frame = enc.encode(`id: ${seq}\nevent: ${kind}\ndata: ${JSON.stringify(ev.data)}\n\n`);
    for (const s of sess.streams) { try { s.controller.enqueue(frame); } catch { sess.streams.delete(s); } }
    return ev;
  }
  const frameOf = (ev) => enc.encode(`id: ${ev.seq}\nevent: ${ev.kind}\ndata: ${JSON.stringify(ev.data)}\n\n`);

  // Push a segment's events: the first one now (before the POST answers), the rest at once (next microtask) or paced.
  function runEvents(sess, events, rid) {
    if (!events.length) return;
    emit(sess, ...events[0], rid);
    const rest = events.slice(1);
    if (!rest.length) return;
    if (!(cfg.pace > 0)) { Promise.resolve().then(() => { if (sessions.get(sess.id) === sess) for (const [k, d] of rest) emit(sess, k, d, rid); }); return; }
    (async () => {
      let prev = events[0][0];
      for (const [k, d] of rest) {
        await wait(k === 'plan' && prev === 'planning' ? 1200 : k === 'say' && prev === 'say' ? 120 : cfg.pace);
        if (sessions.get(sess.id) !== sess) return;
        emit(sess, k, d, rid); prev = k;
      }
    })();
  }
  const segmentFor = (run, on, kind) => {
    const segs = scripts[run.name] || [];
    const i = segs.findIndex((s, j) => s.on === on && !run.used.has(j) && (!s.kind || s.kind === kind));
    if (i < 0) return null;
    run.used.add(i); return segs[i];
  };

  function auth(headers) {
    const m = /^Bearer\s+(.*)$/i.exec(headers.get('authorization') || '');
    return !!m && norm(m[1]) === norm(cfg.code);
  }
  const offAnswer = () => (cfg.off === 'budget' ? fail(429, 'budget', 'Live AI has reached its limit for today.') : cfg.off === 'live_off' ? fail(503, 'live_off', 'Live AI is switched off right now.') : null);

  function handle(method, parts, query, headers, body) {
    const [root, sid, sub, rid, action] = parts;
    if (root === 'health' && method === 'GET') return json(200, { ok: true, liveEnabled: cfg.liveEnabled, scenes: cfg.scenes });
    if (root === 'access' && sid === 'check' && method === 'POST') {
      if (cfg.checkRate) return fail(429, 'rate', 'Too many tries. Wait a minute.');
      return norm(body?.code) === norm(cfg.code) ? json(200, { ok: true, remainingToday: cfg.remaining }) : fail(401, 'bad_code', 'That code is not valid.');
    }
    if (root === 'apply' && method === 'POST') return json(202, {});
    if (root !== 'sessions') return fail(404, 'bad_request', 'No such route.');
    if (!auth(headers)) return fail(401, 'bad_code', 'That code is not valid.');
    if (!sid) {
      if (method !== 'POST') return fail(400, 'bad_request', 'Bad request.');
      const o = offAnswer(); if (o) return o;
      if (cfg.sessionCap === 'global_limit') return fail(429, 'global_limit', 'Live AI is at its session capacity right now.');
      if (cfg.sessionCap === 'code_limit') return fail(429, 'code_limit', 'All of the live sessions for this code are busy.');
      if (!body || body.scene !== cfg.scene) return fail(400, 'bad_request', 'That scene is not available.');
      const id = `sess-${++nSession}`;
      const sess = { id, events: [], streams: new Set(), state: homeState(), clock: { ...CLOCK }, active: null, pending: null, run: null, last: null, curRid: null, nRid: 0, known: new Set() };
      sessions.set(id, sess);
      return json(201, { sessionId: id, state: clone(sess.state), clock: { ...sess.clock }, suggestions: [...SUGGESTIONS] });
    }
    const sess = sessions.get(sid);
    if (!sess) return fail(404, 'no_session', 'That session has ended.');
    if (sub === 'events' && method === 'GET') {
      const after = Number(query.get('after')) || 0;
      let entry;
      const stream = new ReadableStream({
        start(controller) {
          entry = { controller };
          for (const ev of sess.events) if (ev.seq > after) controller.enqueue(frameOf(ev));
          sess.streams.add(entry);
        },
        cancel() { sess.streams.delete(entry); },
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } });
    }
    if (sub === 'reset' && method === 'POST') {
      if (sess.active) return fail(409, 'busy', 'A request is still running.');
      sess.state = homeState(); sess.clock = { ...CLOCK }; sess.last = null;
      return json(200, { state: clone(sess.state), clock: { ...sess.clock } });
    }
    if ((sub === 'set' || sub === 'advance') && method === 'POST') {
      if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'bad_request', 'Bad request.');
      const now = performance.now(), recent = (editTimes.get(sid) || []).filter((t) => now - t < 5000);
      if (recent.length >= 10) { editTimes.set(sid, recent); return fail(429, 'rate', 'Too many changes at once. Wait a moment.'); }
      recent.push(now); editTimes.set(sid, recent);
      if (sub === 'set') {
        const { path, value } = body, rule = Object.hasOwn(EDITABLE, path) ? EDITABLE[path] : null;
        const good = rule === 'bool' ? typeof value === 'boolean' : !!rule && typeof value === 'number' && Number.isFinite(value) && value >= rule[0] && value <= rule[1];
        if (!good) return fail(400, 'bad_value', "That value isn't allowed for this device.");
        const [dev] = path.split('.');
        if (sess.state[dev].status === 'fault' || sess.state[dev].status === 'busy') return fail(409, 'device_unavailable', "That device can't be changed right now.");
        const rid = sess.active;
        emit(sess, 'state', { path, value, ms: 0, src: 'edit' }, rid);
        if (path === 'lamp.brightness') emit(sess, 'state', { path: 'lamp.on', value: value > 0, ms: 0, src: 'edit' }, rid);
        return json(202, {});
      }
      const hours = body.hours;
      if (typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0 || hours > 168) return fail(400, 'bad_value', "That value isn't allowed.");
      if (sess.active) return fail(409, 'busy', 'A request is already running.');
      let left = hours;
      while (left > 0) { const step = Math.min(6, left); emit(sess, 'clock', { ...clockAfter(sess.clock, step), src: 'edit' }); left -= step; }
      return json(200, { clock: { ...sess.clock } });
    }
    if (sub !== 'requests' || method !== 'POST') return fail(404, 'bad_request', 'No such route.');
    if (!rid) { // new request
      const text = body?.text;
      if (typeof text !== 'string') return fail(400, 'bad_request', 'Say what you want done.');
      if (text.trim().length > 400) return fail(400, 'too_long', 'That request is too long.');
      if (sess.active) return fail(409, 'busy', 'A request is already running.');
      const o = offAnswer(); if (o) return o;
      if (cfg.remaining <= 0) return fail(429, 'code_limit', 'This code has reached its limit for today.');
      cfg.remaining--;
      const requestId = `r${++sess.nRid}`; sess.known.add(requestId); const name = SCRIPT_PICK.find(([re]) => re.test(text))[1];
      sess.run = { rid: requestId, name, text, used: new Set(), steps: [], proposed: null, calls: 0, whatif: false, before: { state: clone(sess.state), clock: { ...sess.clock } } };
      sess.active = requestId; sess.curRid = requestId; sess.pending = null;
      const seg = segmentFor(sess.run, 'request');
      runEvents(sess, seg ? seg.events : [['planning', {}], ['cannot_do', { reason: 'Nothing to run.', suggestions: [] }], ['done', { outcome: 'cannot_do' }]], requestId);
      return json(202, { requestId });
    }
    if (action === 'whatif') {
      const last = sess.last;
      if (sess.active) return fail(409, 'busy', 'A request is already running.');
      if (!last && !sess.known.has(rid)) return fail(404, 'no_request', 'There is nothing to replay.');
      if (!last || rid !== last.rid || !last.steps.length) return fail(409, 'not_waiting', 'That request cannot be replayed.');
      const device = body?.device, extra = scripts[last.name]?.whatif;
      if (typeof device !== 'string' || !extra) return fail(400, 'bad_request', 'Pick a device that can fail.');
      const requestId = `r${++sess.nRid}`;
      sess.run = { rid: requestId, name: last.name, used: new Set(), steps: clone(last.steps), proposed: null, calls: 0, whatif: true, before: last.before };
      sess.active = requestId; sess.curRid = requestId; sess.pending = null;
      runEvents(sess, [['room', clone(last.before)], ['plan', { steps: clone(last.steps), horizonHours: null }], ...extra], requestId);
      return json(202, { requestId });
    }
    if (action === 'approve' || action === 'decline') {
      const run = sess.run;
      if (!run || run.rid !== rid) return fail(404, 'no_request', 'No such request.');
      if (!sess.active || !sess.pending) return fail(409, 'not_waiting', 'Nothing is waiting for an answer.');
      const kind = sess.pending; sess.pending = null;
      if (action === 'approve' && kind === 'replan' && run.proposed) { run.steps = mergeSteps(run.steps, run.proposed); }
      run.proposed = null;
      const seg = segmentFor(run, action, kind)
        || (action === 'decline' ? { events: [['declined', {}], ['done', { outcome: 'declined' }]] } : { events: [['summary', { text: 'Done.' }], DONE_OK] });
      runEvents(sess, seg.events, rid);
      return json(202, {});
    }
    return fail(404, 'bad_request', 'No such route.');
  }

  async function mockFetch(url, init = {}) {
    const signal = init.signal;
    if (signal?.aborted) throw abortError();
    if (cfg.mode === 'down') throw new TypeError('Failed to fetch');
    const u = new URL(url), method = String(init.method || 'GET').toUpperCase(), headers = new Headers(init.headers);
    const path = u.pathname.replace(/^.*\/live\/api\//, ''), parts = path.split('/').filter(Boolean);
    let body = init.body ?? null;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { /* keep the raw text */ } }
    calls.push({ method, path, query: Object.fromEntries(u.searchParams), headers: Object.fromEntries(headers), body, signal });
    await Promise.resolve();
    if (signal?.aborted) throw abortError();
    if (cfg.mode === 'html') return new Response('<!doctype html><title>Tunnel</title><p>Visit site</p>', { status: 200, headers: { 'content-type': 'text/html' } });
    const res = handle(method, parts, u.searchParams, headers, body);
    if (signal && res.body && res.headers.get('content-type') === 'text/event-stream') {
      return new Response(abortable(res.body, signal), { status: res.status, headers: res.headers });
    }
    return res;
  }

  // Wrap an event stream so aborting the signal errors the reader (and closes the stream on the server side).
  function abortable(body, signal) {
    const reader = body.getReader();
    return new ReadableStream({
      start(c) {
        signal.addEventListener('abort', () => { c.error(abortError()); reader.cancel().catch(() => {}); }, { once: true });
        (async () => { for (;;) { const r = await reader.read().catch(() => ({ done: true })); if (r.done) { try { c.close(); } catch { /* aborted */ } return; } try { c.enqueue(r.value); } catch { return; } } })();
      },
    });
  }

  return {
    fetch: mockFetch,
    calls,
    push(sid, kind, data = {}) { const s = sessions.get(sid); if (!s) throw new Error(`no session ${sid}`); return emit(s, kind, data, data.rid ?? s.curRid ?? 'r0'); },
    // An event as a hand edit would stream it: src 'edit' and no rid key.
    edit(sid, kind, data = {}) { const s = sessions.get(sid); if (!s) throw new Error(`no session ${sid}`); return emit(s, kind, { ...data, src: 'edit' }); },
    drop(sid) { const s = sessions.get(sid); if (!s) return; for (const e of s.streams) { try { e.controller.close(); } catch { /* closed */ } } s.streams.clear(); },
    expire(sid) { const s = sessions.get(sid); if (!s) return; this.drop(sid); sessions.delete(sid); },
    set(opts) { for (const k of ['remaining', 'liveEnabled', 'off', 'mode', 'code', 'checkRate', 'sessionCap']) if (k in opts) cfg[k] = opts[k]; },
  };
}
