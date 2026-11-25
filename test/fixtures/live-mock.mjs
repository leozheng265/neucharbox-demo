// An in-memory server that speaks the live API contract (interface-only version of 2026-11-24: the NeuCharBox Live
// module's docs/live-api-contract.md), for the live-client checks (test/live.mjs, test/custom.mjs) and, over HTTP, for
// browser checks (test/mock-live.mjs).
// createMockLive(opts) → { fetch(url, init) → Promise<Response>, calls, push(sid, kind, data), edit(sid, kind, data),
//   drop(sid), openStreams(sid), expire(sid), set(opts), session(sid) }.
// Routes: health, access/check, apply, POST sessions (Home or a custom room from the catalog), GET sessions/{sid}/devices,
// POST sessions/{sid}/devices/{id}/actions/{verb}, POST sessions/{sid}/faults, POST sessions/{sid}/faults/clear, set,
// advance, reset, and the event stream. There are no requests, approvals, what-ifs or automations: those routes answer
// 404 bad_request. An action validates its args against the action's JSON schema (a small validator: required, types,
// enum, minimum / maximum, no extra keys), then streams call → (planted offline: fault + status fault, then a failed
// result) → state frames → world (if it changed) → result, all src "action" except world, and answers once they have
// played. opts.actionMs > 0 waits that long between call and result (timers, so the virtual clock of test/clock.mjs
// runs it too); meanwhile another action, an advance, a fault or a reset answers 409 busy.
// Node built-ins only.

import { typeOf, validId, nameOf } from '../../js/custom/catalog.js';

export const MOCK_CODE = 'NCB-TEST-CASE';

const norm = (c) => String(c ?? '').toUpperCase().replace(/\s+/g, '');
const CLOCK = { iso: '2026-11-13T16:30:00', label: 'Fri 16:30', hour: 16.5 };
const homeState = () => ({ // scene/home.json's initials (look flags included), online
  lamp: { on: false, brightness: 0, status: 'online' }, blinds: { closed: 0, flat: false, jammed: false, status: 'online' },
  soil: { moisture: 34, probeOut: false, status: 'online' }, pump: { running: false, blocked: false, status: 'online' },
  camera: { armed: false, motion: false, off: false, status: 'online' }, thermostat: { target: 21, current: 21.4, cold: false, status: 'online' },
  env: { hour: CLOCK.hour },
});
const homeWorld = () => ({ air: { temp: 21.0, humidity: 45, pm25: 12 }, light: { lux: 120 }, outdoor: { temp: 9.5, sun: 0.42 }, soil: { pot: 34.0 }, power: { watts: 61, kwhToday: 0.35 }, people: [], doors: {} });
const clone = (v) => JSON.parse(JSON.stringify(v));
const obj = (props, required = Object.keys(props)) => ({ type: 'object', properties: props, required, additionalProperties: false });
const NONE = obj({});

// Home's devices, as the server's GET devices gives them (scene/home.json): verb = the action's name.
const homeAction = (name, kind, description, parameters = NONE) => ({ verb: name, name, kind, description, parameters });
export const HOME_DEVICES = [
  { id: 'lamp', name: 'Floor lamp', edits: [{ field: 'brightness', kind: 'number', min: 0, max: 1 }], faultModes: ['offline', 'stuck'],
    actions: [homeAction('set_lamp', 'write', 'Set the floor lamp brightness from 0 (off) to 100.', obj({ brightness: { type: 'integer', minimum: 0, maximum: 100 } }))] },
  { id: 'blinds', name: 'Blinds', edits: [{ field: 'closed', kind: 'number', min: 0, max: 1 }], faultModes: ['offline', 'stuck'],
    actions: [homeAction('set_blinds', 'write', 'Set how far the blinds are closed, from 0 (open) to 100 (closed).', obj({ closed_percent: { type: 'integer', minimum: 0, maximum: 100 } }))] },
  { id: 'soil', name: 'Soil sensor', edits: [{ field: 'moisture', kind: 'number', min: 0, max: 100 }], faultModes: ['offline', 'sensorDetached', 'drift'],
    actions: [homeAction('read_soil', 'read', "Read the plant's current soil moisture percentage.")] },
  { id: 'pump', name: 'Water pump', edits: [{ field: 'running', kind: 'bool' }], faultModes: ['offline', 'blocked', 'stuck'],
    actions: [homeAction('run_pump', 'write', 'Run the water pump for a number of seconds.', obj({ seconds: { type: 'integer', minimum: 1, maximum: 30 } })),
      homeAction('stop_pump', 'safe', 'Stop the water pump right away.')] },
  { id: 'camera', name: 'Door camera', edits: [{ field: 'armed', kind: 'bool' }, { field: 'motion', kind: 'bool' }], faultModes: ['offline'],
    actions: [homeAction('set_door_camera', 'write', 'Arm or disarm the door camera.', obj({ armed: { type: 'boolean' } }))] },
  { id: 'thermostat', name: 'Thermostat', edits: [{ field: 'target', kind: 'number', min: 10, max: 28 }, { field: 'current', kind: 'number', min: 5, max: 35 }], faultModes: ['offline', 'stuck', 'drift'],
    actions: [homeAction('set_thermostat', 'write', 'Set the thermostat target temperature in degrees Celsius, from 10 to 28.', obj({ celsius: { type: 'number', minimum: 10, maximum: 28 } }))] },
];
// Home's look flags for a planted mode (state events src "edit"); cleared again by faults/clear and reset.
const LOOK = { 'pump:blocked': 'pump.blocked', 'soil:sensorDetached': 'soil.probeOut', 'blinds:stuck': 'blinds.jammed' };
const pct = (v) => (v === 0 ? 'off' : v === 100 ? 'full' : `${v}%`);

// What one Home action does: { frames: [[kind, data]], outcome, text, result }. `s` is the session.
function homeRun(s, id, verb, args) {
  const st = s.state;
  switch (verb) {
    case 'set_lamp': return { label: `Floor lamp → ${pct(args.brightness)}`, frames: [['state', { path: 'lamp.on', value: args.brightness > 0, ms: 0 }], ['state', { path: 'lamp.brightness', value: args.brightness / 100, ms: 1200 }]], outcome: 'confirmed', text: 'confirmed', result: { ok: true } };
    case 'set_blinds': return { label: `Blinds → ${args.closed_percent === 100 ? 'closed' : args.closed_percent === 0 ? 'open' : `${args.closed_percent}% closed`}`, frames: [['state', { path: 'blinds.closed', value: args.closed_percent / 100, ms: 3000 }]], outcome: 'confirmed', text: 'confirmed', result: { ok: true } };
    case 'read_soil': { const v = s.faults.get('soil') === 'sensorDetached' ? 0 : Math.round(st.soil.moisture); return { label: 'Soil sensor → reading', frames: [], outcome: 'reading', text: `${v}%`, result: { ok: true, reading: v } }; }
    case 'run_pump': {
      const blocked = s.faults.get('pump') === 'blocked', frames = [['state', { path: 'pump.running', value: true, ms: 0 }]];
      if (!blocked) { s.world.soil.pot = Math.round((s.world.soil.pot + args.seconds) * 10) / 10; frames.push(['world', clone(s.world)], ['state', { path: 'soil.moisture', value: Math.min(100, st.soil.moisture + args.seconds), ms: 800 }]); }
      frames.push(['state', { path: 'pump.running', value: false, ms: 0 }]);
      return { label: `Water pump → on for ${args.seconds} s`, frames, outcome: 'commanded', text: 'commanded', result: { ok: true } };
    }
    case 'stop_pump': return { label: 'Water pump → off', frames: [['state', { path: 'pump.running', value: false, ms: 0 }]], outcome: 'made_safe', text: 'made safe', result: { ok: true } };
    case 'set_door_camera': return { label: `Door camera → ${args.armed ? 'armed' : 'off'}`, frames: [['state', { path: 'camera.armed', value: args.armed, ms: 0 }]], outcome: 'confirmed', text: 'confirmed', result: { ok: true } };
    case 'set_thermostat': return { label: `Thermostat → ${args.celsius} °C`, frames: [['state', { path: 'thermostat.target', value: args.celsius, ms: 0 }]], outcome: 'confirmed', text: 'confirmed', result: { ok: true } };
    default: return null;
  }
}

// A custom room's devices from the catalog (types: id → type), as the server's CustomRoom.Build gives them: the action
// name is "<verb>_<id>", the description's {ref} is the device's ref.
function customDevices(list) {
  return list.map(({ id, type }) => {
    const t = typeOf(type), { name, ref } = nameOf(type, id);
    return { id, type, name, edits: clone(t.edit || []), faultModes: (t.actions || []).some((a) => a.kind === 'Read') ? ['offline', 'sensorDetached', 'drift'] : ['offline', 'stuck'],
      actions: (t.actions || []).map((a) => ({ verb: a.verb, name: `${a.verb}_${id}`, kind: String(a.kind).toLowerCase(), description: String(a.description || '').replaceAll('{ref}', ref), parameters: clone(a.parameters || NONE), _spec: a })) };
  });
}
// What one catalog action does: its `effects` (set from an arg × scale, set a value, add an arg; anything conditional is
// left out), its `reads` for a read.
function customRun(s, dev, a, args) {
  const spec = a._spec, frames = [], slice = s.state[dev.id];
  for (const e of spec.effects || []) {
    if (e.if) continue;
    const field = e.set ?? e.add; if (!field || !(field in slice) && e.add) continue;
    const v = e.add ? Number(slice[field] || 0) + Number(args[e.arg] || 0) : 'arg' in e ? (typeof args[e.arg] === 'number' ? Math.round(args[e.arg] * (e.scale ?? 1) * 1e6) / 1e6 : args[e.arg]) : e.value;
    if (v === undefined) continue;
    frames.push(['state', { path: `${dev.id}.${field}`, value: v, ms: Number(e.ms) || 0 }]);
  }
  const reads = (spec.reads || []).map((r) => `${Math.round(Number(slice[r.field] ?? 0))}${r.unit || ''}`);
  const read = a.kind === 'read';
  return { label: `${dev.name} → ${read ? 'read' : a.verb}`, frames, outcome: read ? 'reading' : spec.outcome || 'confirmed', text: read ? reads.join(', ') || 'read' : spec.outcome || 'confirmed', result: read ? { ok: true, reading: Number(slice[spec.reads?.[0]?.field] ?? 0) } : { ok: true } };
}

// The arg validator (the server's own covers more; this is enough for the page's controls): a sentence, or null.
function badArgs(schema, args) {
  const props = schema?.properties || {}, req = schema?.required || [];
  for (const k of req) if (!(k in args)) return `'${k}' is required`;
  for (const [k, v] of Object.entries(args)) {
    const p = props[k];
    if (!p) { if (schema?.additionalProperties === false) return `'${k}' is not a parameter of this action`; continue; }
    if (Array.isArray(p.enum) && !p.enum.includes(v)) return `'${k}' must be one of ${p.enum.join(', ')}`;
    if (p.type === 'boolean' && typeof v !== 'boolean') return `'${k}' must be true or false`;
    if (p.type === 'string' && typeof v !== 'string') return `'${k}' must be text`;
    if (p.type === 'integer' && !Number.isInteger(v)) return `'${k}' must be a whole number`;
    if (p.type === 'number' && !(typeof v === 'number' && Number.isFinite(v))) return `'${k}' must be a number`;
    if (typeof v === 'number' && Number.isFinite(p.minimum) && v < p.minimum) return `'${k}' must be at least ${p.minimum}`;
    if (typeof v === 'number' && Number.isFinite(p.maximum) && v > p.maximum) return `'${k}' must be at most ${p.maximum}`;
  }
  return null;
}

// ---------------- the server ----------------
const abortError = () => new DOMException('The operation was aborted.', 'AbortError');
// What a hand edit may change (the same table as the server): path → 'bool' or [min, max].
const EDITABLE = { 'lamp.brightness': [0, 1], 'blinds.closed': [0, 1], 'soil.moisture': [0, 100], 'pump.running': 'bool', 'camera.armed': 'bool', 'camera.motion': 'bool', 'thermostat.target': [10, 28], 'thermostat.current': [5, 35] };
const customEditable = (devs) => { const out = {}; for (const d of devs) for (const e of d.edits) out[`${d.id}.${e.field}`] = e.kind === 'bool' ? 'bool' : [e.min, e.max]; return out; };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n) => String(n).padStart(2, '0');
// The room clock `hours` later (the mock reads the ISO time as UTC, which is only arithmetic here).
const clockAfter = (c, hours) => {
  const d = new Date(Date.parse(`${c.iso}Z`) + Math.round(hours * 3600000));
  return { iso: d.toISOString().slice(0, 19), label: `${DAYS[d.getUTCDay()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`, hour: c.hour + hours };
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const statusOf = (slice) => (slice?.status === 'fault' ? 'fault' : slice?.status === 'busy' ? 'busy' : 'online');

export function createMockLive({ scene = 'home', scenes = [scene], code = MOCK_CODE, liveEnabled = true, off = null, mode = 'json', actionMs = 0 } = {}) {
  const cfg = { scene, scenes, code, liveEnabled, off, mode, actionMs };
  const calls = [], editTimes = new Map(), sessions = new Map(), enc = new TextEncoder();
  let nSession = 0;

  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fail = (status, error, message, extra = {}) => json(status, { error, message, ...extra });

  // Add an event to a session's list and to every open stream; keep the room (state, clock, world) in step.
  function emit(sess, kind, data) {
    if (kind === 'state' && typeof data.path === 'string') { const [d, ...f] = data.path.split('.'), k = f.join('.'); if (Object.hasOwn(sess.state, d) && k && !['__proto__', 'constructor', 'prototype'].includes(k)) sess.state[d][k] = data.value; }
    else if (kind === 'clock' && Number.isFinite(data.hour)) { sess.clock = { iso: data.iso, label: data.label, hour: data.hour }; sess.state.env.hour = data.hour; }
    else if (kind === 'world') sess.world = clone(data);
    const seq = sess.events.length + 1, ev = { seq, kind, data: { ...data } };
    sess.events.push(ev);
    const frame = frameOf(ev);
    for (const s of sess.streams) { try { s.controller.enqueue(frame); } catch { sess.streams.delete(s); } }
    return ev;
  }
  const frameOf = (ev) => enc.encode(`id: ${ev.seq}\nevent: ${ev.kind}\ndata: ${JSON.stringify(ev.data)}\n\n`);

  function auth(headers) {
    const m = /^Bearer\s+(.*)$/i.exec(headers.get('authorization') || '');
    return !!m && norm(m[1]) === norm(cfg.code);
  }
  // The rate window: 10 per 5 s per session, shared by set, advance, actions and faults.
  function limited(sid) {
    const now = performance.now(), recent = (editTimes.get(sid) || []).filter((t) => now - t < 5000);
    if (recent.length >= 10) { editTimes.set(sid, recent); return true; }
    recent.push(now); editTimes.set(sid, recent); return false;
  }
  const isBody = (b) => !!b && typeof b === 'object' && !Array.isArray(b);
  const devicesAnswer = (sess) => ({ devices: sess.devices.map(({ actions, ...d }) => ({ ...clone(d), type: d.type ?? null, status: statusOf(sess.state[d.id]), state: clone(sess.state[d.id] ?? {}),
    actions: actions.map(({ _spec, ...a }) => clone(a)) })), clock: { ...sess.clock } });
  const faultList = (sess) => [...sess.faults].map(([device, m]) => ({ device, mode: m }));
  const newSess = (id, state, devices, editable) => ({ id, events: [], streams: new Set(), state, initial: clone(state), clock: { ...CLOCK }, world: homeWorld(), devices, editable, faults: new Map(), failed: new Set(), acting: false, nCall: 0 });

  // One action, through the "simulator": events, then the answer.
  async function runAction(sess, dev, a, args) {
    const sid = sess.id, alive = () => sessions.get(sid) === sess;
    const plan = sess.devices === HOME_DEVICES ? homeRun(sess, dev.id, a.verb, args) : customRun(sess, dev, a, args);
    const callId = `a${++sess.nCall}`;
    sess.acting = true;
    try {
      emit(sess, 'call', { callId, device: dev.id, action: a.verb, args: clone(args), label: plan.label, src: 'action' });
      if (cfg.actionMs > 0) { await wait(cfg.actionMs); if (!alive()) return fail(404, 'no_session', 'That session has ended.'); }
      if (sess.faults.get(dev.id) === 'offline') {
        if (!sess.failed.has(dev.id)) { sess.failed.add(dev.id); emit(sess, 'fault', { device: dev.id, text: 'not responding', src: 'action' }); emit(sess, 'state', { path: `${dev.id}.status`, value: 'fault', ms: 0, src: 'action' }); }
        emit(sess, 'result', { callId, device: dev.id, ok: false, outcome: 'failed', text: 'not responding', src: 'action' });
        return json(200, { callId, device: dev.id, action: a.verb, ok: false, outcome: 'failed', text: 'not responding', result: { ok: false, error: 'not responding' } });
      }
      for (const [k, d] of plan.frames) emit(sess, k, k === 'world' ? d : { ...d, src: 'action' });
      emit(sess, 'result', { callId, device: dev.id, ok: true, outcome: plan.outcome, text: plan.text, src: 'action' });
      return json(200, { callId, device: dev.id, action: a.verb, ok: true, outcome: plan.outcome, text: plan.text, result: plan.result });
    } finally { sess.acting = false; }
  }

  function handle(method, parts, query, headers, body) {
    const [root, sid, sub, a3, a4, a5] = parts;
    if (root === 'health' && method === 'GET') return json(200, { ok: true, liveEnabled: cfg.liveEnabled, scenes: cfg.scenes });
    if (root === 'access' && sid === 'check' && method === 'POST') {
      if (cfg.checkRate) return fail(429, 'rate', 'Too many tries. Wait a minute.');
      return norm(body?.code) === norm(cfg.code) ? json(200, { ok: true, remainingToday: 20 }) : fail(401, 'bad_code', 'That code is not valid.');
    }
    if (root === 'apply' && method === 'POST') return json(202, {});
    if (root !== 'sessions') return fail(404, 'bad_request', 'No such route.');
    if (!auth(headers)) return fail(401, 'bad_code', 'That code is not valid.');
    if (!sid) {
      if (method !== 'POST') return fail(400, 'bad_request', 'Bad request.');
      if (cfg.off === 'live_off') return fail(503, 'live_off', 'Live mode is switched off right now.');
      if (cfg.sessionCap === 'global_limit') return fail(429, 'global_limit', 'The live server is at its session capacity right now.');
      if (cfg.sessionCap === 'code_limit') return fail(429, 'code_limit', 'All of the live sessions for this code are busy.');
      if (body?.scene === 'custom' && cfg.scenes.includes('custom')) { // the custom room: the visitor's own device list
        const list = body.devices, seen = new Set();
        const good = Array.isArray(list) && list.length >= 1 && list.length <= 20 && list.every((d) => d && typeof d.type === 'string' && typeOf(d.type) && validId(d.type, d.id) && !seen.has(d.id) && seen.add(d.id));
        if (!good) return fail(400, 'bad_room', "That room can't be set up. Check its devices and try again.");
        const state = { env: { hour: CLOCK.hour } };
        for (const d of list) state[d.id] = { ...clone(typeOf(d.type).initial), status: 'online' };
        const devs = customDevices(list), id = `sess-${++nSession}`, sess = newSess(id, state, devs, customEditable(devs));
        sessions.set(id, sess);
        return json(201, { sessionId: id, state: clone(state), clock: { ...CLOCK }, world: clone(sess.world) });
      }
      if (!body || body.scene !== cfg.scene) return fail(400, 'bad_request', 'That scene is not available.');
      const id = `sess-${++nSession}`, sess = newSess(id, homeState(), HOME_DEVICES, EDITABLE);
      sessions.set(id, sess);
      return json(201, { sessionId: id, state: clone(sess.state), clock: { ...sess.clock }, world: clone(sess.world) });
    }
    const sess = sessions.get(sid);
    if (!sess) return fail(404, 'no_session', 'That session has ended.');
    if (sub === 'events' && method === 'GET' && !a3) {
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
    if (sub === 'devices' && method === 'GET' && !a3) return json(200, devicesAnswer(sess));
    if (sub === 'devices' && method === 'POST' && a3 && a4 === 'actions' && a5 && parts.length === 6) {
      if (limited(sid)) return fail(429, 'rate', 'Too many changes at once. Wait a moment.');
      const args = body == null || body === '' ? {} : body;
      if (!isBody(args)) return fail(400, 'bad_request', 'Bad request.');
      const dev = sess.devices.find((d) => d.id === a3);
      if (!dev) return fail(404, 'no_device', 'There is no such device in this room.');
      const a = dev.actions.find((x) => x.verb === a5 || x.name === a5);
      if (!a) return fail(404, 'no_action', 'That device has no such action.');
      const why = badArgs(a.parameters, args);
      if (why) return fail(400, 'bad_value', "That value isn't allowed for this action.", { detail: why });
      if (sess.acting || sess.advancing) return fail(409, 'busy', 'Something is already playing in this room.');
      return runAction(sess, dev, a, args);
    }
    if (sub === 'faults' && method === 'POST' && (!a3 || (a3 === 'clear' && parts.length === 4))) {
      if (limited(sid)) return fail(429, 'rate', 'Too many changes at once. Wait a moment.');
      if (a3 === 'clear') {
        if (sess.acting || sess.advancing) return fail(409, 'busy', 'Something is already playing in this room.');
        for (const [device, m] of [...sess.faults]) {
          if (m === 'offline' && sess.state[device]?.status === 'fault') emit(sess, 'state', { path: `${device}.status`, value: 'online', ms: 0, src: 'edit' });
          const flag = LOOK[`${device}:${m}`]; if (flag && sess.devices === HOME_DEVICES) emit(sess, 'state', { path: flag, value: false, ms: 0, src: 'edit' });
        }
        sess.faults.clear(); sess.failed.clear();
        return json(200, { faults: [] });
      }
      if (!isBody(body) || typeof body.device !== 'string') return fail(400, 'bad_request', 'Say which device should fail.');
      const dev = sess.devices.find((d) => d.id === body.device);
      if (!dev) return fail(404, 'no_device', 'There is no such device in this room.');
      const m = body.mode ?? 'offline';
      if (typeof m !== 'string' || !dev.faultModes.includes(m)) return fail(400, 'bad_request', "That device can't fail that way.");
      if (sess.acting || sess.advancing) return fail(409, 'busy', 'Something is already playing in this room.');
      const was = sess.faults.get(dev.id), oldFlag = was && LOOK[`${dev.id}:${was}`], flag = LOOK[`${dev.id}:${m}`];
      if (oldFlag && oldFlag !== flag && sess.devices === HOME_DEVICES) emit(sess, 'state', { path: oldFlag, value: false, ms: 0, src: 'edit' });
      sess.faults.set(dev.id, m);
      if (flag && sess.devices === HOME_DEVICES) emit(sess, 'state', { path: flag, value: true, ms: 0, src: 'edit' });
      return json(200, { faults: faultList(sess) });
    }
    if (sub === 'reset' && method === 'POST' && !a3) {
      if (sess.acting || sess.advancing) return fail(409, 'busy', 'Something is already playing in this room.');
      sess.state = clone(sess.initial); sess.clock = { ...CLOCK }; sess.world = homeWorld(); sess.faults.clear(); sess.failed.clear();
      return json(200, { state: clone(sess.state), clock: { ...sess.clock }, world: clone(sess.world) });
    }
    if ((sub === 'set' || sub === 'advance') && method === 'POST' && !a3) {
      if (limited(sid)) return fail(429, 'rate', 'Too many changes at once. Wait a moment.');
      if (!isBody(body)) return fail(400, 'bad_request', 'Bad request.');
      if (sub === 'set') {
        const { path, value } = body, table = sess.editable, rule = typeof path === 'string' && Object.hasOwn(table, path) ? table[path] : null;
        const good = rule === 'bool' ? typeof value === 'boolean' : !!rule && typeof value === 'number' && Number.isFinite(value) && value >= rule[0] && value <= rule[1];
        if (!good) return fail(400, 'bad_value', "That value isn't allowed for this device.");
        const [dev] = path.split('.');
        if (sess.state[dev].status === 'fault' || sess.state[dev].status === 'busy') return fail(409, 'device_unavailable', "That device can't be changed right now.");
        emit(sess, 'state', { path, value, ms: 0, src: 'edit' });
        if (sess.devices === HOME_DEVICES && path === 'lamp.brightness') emit(sess, 'state', { path: 'lamp.on', value: value > 0, ms: 0, src: 'edit' }); // Home's lamp only
        return json(202, {});
      }
      const hours = body.hours;
      if (typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0 || hours > 168) return fail(400, 'bad_value', "That value isn't allowed.");
      if (sess.acting || sess.advancing) return fail(409, 'busy', 'Something is already playing in this room.');
      let left = hours;
      while (left > 0) { const step = Math.min(6, left); emit(sess, 'clock', { ...clockAfter(sess.clock, step), src: 'edit' }); left -= step; }
      return json(200, { clock: { ...sess.clock } });
    }
    return fail(404, 'bad_request', 'No such route.');
  }

  async function mockFetch(url, init = {}) {
    const signal = init.signal;
    if (signal?.aborted) throw abortError();
    if (cfg.mode === 'down') throw new TypeError('Failed to fetch');
    const u = new URL(url), method = String(init.method || 'GET').toUpperCase(), headers = new Headers(init.headers);
    const path = u.pathname.replace(/^.*\/live\/api\//, ''), parts = path.split('/').filter(Boolean).map(decodeURIComponent);
    let body = init.body ?? null;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { /* keep the raw text */ } }
    calls.push({ method, path, query: Object.fromEntries(u.searchParams), headers: Object.fromEntries(headers), body, signal });
    await Promise.resolve();
    if (signal?.aborted) throw abortError();
    if (cfg.mode === 'html') return new Response('<!doctype html><title>Tunnel</title><p>Visit site</p>', { status: 200, headers: { 'content-type': 'text/html' } });
    const res = await handle(method, parts, u.searchParams, headers, body);
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
    // An event as the server would stream it (any kind, data as given).
    push(sid, kind, data = {}) { const s = sessions.get(sid); if (!s) throw new Error(`no session ${sid}`); return emit(s, kind, data); },
    // An event as a hand edit would stream it: src 'edit'.
    edit(sid, kind, data = {}) { const s = sessions.get(sid); if (!s) throw new Error(`no session ${sid}`); return emit(s, kind, { ...data, src: 'edit' }); },
    drop(sid) { const s = sessions.get(sid); if (!s) return; for (const e of s.streams) { try { e.controller.close(); } catch { /* closed */ } } s.streams.clear(); },
    openStreams(sid) { return sessions.get(sid)?.streams.size ?? 0; }, // read-only: how many event streams are open on a session
    expire(sid) { const s = sessions.get(sid); if (!s) return; this.drop(sid); sessions.delete(sid); },
    // read-only: a session's room (state, faults) for the checks
    session(sid) { const s = sessions.get(sid); return s ? { state: clone(s.state), faults: faultList(s), world: clone(s.world) } : null; },
    set(opts) { for (const k of ['liveEnabled', 'off', 'mode', 'code', 'checkRate', 'sessionCap', 'actionMs']) if (k in opts) cfg[k] = opts[k]; },
  };
}
