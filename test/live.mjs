// Check 18: the live client against the contract mock (test/fixtures/live-mock.mjs), interface-only API (2026-11-24):
// device actions, fault planting, hand edits, the clock, reset and the event stream; no model, no requests.
//   liveChecks({ report, initialOf, guardHits }) runs the checks below (test/run.mjs, in the `live` group). This file
//   also holds the harness they share (check / eq / ok / harness and the stub LiveView, panel and ui), and a small
//   stand-in document for the live tools (js/engine/livetools.js), which is built with createElement only.
import { readFileSync, existsSync } from 'node:fs';
import { createStore } from '../js/engine/store.js';
import { virtualTime } from './clock.mjs';
import { createMockLive, HOME_DEVICES } from './fixtures/live-mock.mjs';
import home from '../js/scenes/home.js';
import { LIVE_CONFIG, liveApiBase } from '../js/live-config.js';
import { createLiveApi, LiveError } from '../js/engine/liveapi.js';
import { createSseParser, openEventStream } from '../js/engine/sse.js';
import { createLive, LIVE_COPY, eventLine, liveDevicesOf, actionLabel, liveHere } from '../js/engine/live.js';
import { createLiveView } from '../js/engine/livechat.js';
import { createLiveTools } from '../js/engine/livetools.js';
import { createLiveEntry } from '../js/engine/liveentry.js';
import { FRESH_START } from '../js/engine/flow.js';

const BASE = 'http://mock/live/api/';

// Just what the live tools use: createElement, children, attributes, classList, dataset, textContent, hidden, value
// (a select's is its picked option's, the first one by default), onclick. innerHTML throws: the server's text must never
// be parsed as HTML.
export function fakeDoc() {
  const doc = { activeElement: null };
  class El {
    constructor(tag) {
      Object.assign(this, { tagName: tag.toUpperCase(), children: [], parentNode: null, attrs: new Map(), dataset: {}, _text: '', hidden: false, id: '', type: '', onclick: null, onchange: null, oninput: null, disabled: false, title: '', _cls: new Set(), _value: '' });
      const cls = this._cls;
      this.classList = {
        add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)), contains: (c) => cls.has(c),
        toggle: (c, on) => { const v = on === undefined ? !cls.has(c) : !!on; if (v) cls.add(c); else cls.delete(c); return v; },
      };
      this.style = { props: {}, setProperty(k, v) { this.props[k] = v; } };
    }
    get className() { return [...this._cls].join(' '); }
    set className(v) { this._cls.clear(); for (const c of String(v).split(/\s+/).filter(Boolean)) this._cls.add(c); }
    get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join('') : this._text; }
    set textContent(v) { for (const c of [...this.children]) this._drop(c); this._text = String(v); }
    get innerHTML() { throw new Error('innerHTML read'); }
    set innerHTML(v) { throw new Error('innerHTML written'); }
    get value() {
      if (this.tagName !== 'SELECT') return this._value;
      const vals = this.children.map((o) => o._value);
      return vals.includes(this._value) ? this._value : vals[0] ?? '';
    }
    set value(v) { this._value = String(v); }
    setAttribute(k, v) { this.attrs.set(k, String(v)); }
    getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
    hasAttribute(k) { return this.attrs.has(k); }
    removeAttribute(k) { this.attrs.delete(k); }
    append(...ns) { for (const n of ns) this.insertBefore(n, null); }
    appendChild(n) { return this.insertBefore(n, null); }
    insertBefore(n, ref) {
      if (n.parentNode) n.parentNode._drop(n);
      const i = ref ? this.children.indexOf(ref) : -1;
      if (i >= 0) this.children.splice(i, 0, n); else this.children.push(n);
      n.parentNode = this; this._text = ''; return n;
    }
    _drop(n) { const i = this.children.indexOf(n); if (i >= 0) this.children.splice(i, 1); n.parentNode = null; }
    remove() { this.parentNode?._drop(this); }
    contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
    focus() { doc.activeElement = this; }
    click() { this.onclick?.({ currentTarget: this, detail: 1 }); }
    // every descendant with this class, in order
    all(cls) { const out = []; const walk = (e) => { for (const c of e.children) { if (c._cls.has(cls)) out.push(c); walk(c); } }; walk(this); return out; }
    one(cls) { return this.all(cls)[0] ?? null; }
    tags(tag) { const out = []; const walk = (e) => { for (const c of e.children) { if (c.tagName === tag.toUpperCase()) out.push(c); walk(c); } }; walk(this); return out; }
  }
  doc.createElement = (t) => new El(t);
  return doc;
}

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
  async function harness({ mock = createMockLive(), entered = false, watch = () => null } = {}) {
    const log = [], store = createStore(postSetup(home)); stores.add(store);
    const rec = (source) => (method, ...args) => { log.push([source, method, ...args]); };
    const h = { mock, store, log, lastOffline: null, live: null };
    h.view = {
      ...Object.fromEntries(['ncb', 'lost', 'live'].map((m) => [m, rec('view').bind(null, m)])),
      offline(spec, { onBack }) {
        log.push(['view', 'offline', spec]);
        const a = { back: () => onBack(), close: rec('offline').bind(null, 'close') };
        h.lastOffline = a; return a;
      },
    };
    h.panel = { mark: rec('panel').bind(null, 'mark'), reveal: rec('panel').bind(null, 'reveal') };
    let alive = true;
    h.ui = { alive: () => alive, ...Object.fromEntries(['status', 'beats', 'resetRoom', 'offerGuided', 'track', 'editing', 'clock', 'availability', 'devices', 'controls', 'actionResult', 'faults', 'log'].map((m) => [m, rec('ui').bind(null, m)])), baseline: () => null };
    h.ui.kill = () => { alive = false; };
    h.find = (source, method) => log.filter((e) => e[0] === source && e[1] === method).at(-1)?.slice(2);
    h.all = (source, method) => log.filter((e) => e[0] === source && e[1] === method).map((e) => e.slice(2));
    h.has = (source, method, ...args) => log.some((e) => e[0] === source && e[1] === method && args.every((a, i) => JSON.stringify(e[2 + i]) === JSON.stringify(a)));
    h.order = (source, method, ...args) => log.findIndex((e) => e[0] === source && e[1] === method && args.every((a, i) => JSON.stringify(e[2 + i]) === JSON.stringify(a)));
    h.live = createLive({ scene: home, store, view: h.view, panel: h.panel, ui: h.ui, base: 'http://mock', fetch: mock.fetch, watch });
    if (entered) await h.live.open();
    return h;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const settle = () => sleep(1); // every event already on its way lands first
  const waitFor = async (f) => { for (let i = 0; i < 4000 && !f(); i++) await sleep(25); ok(f(), 'timed out waiting'); };
  // The events the mock holds for a session, as [kind, data]: a fresh GET from `after`, read until it goes quiet.
  const framesOf = async (m, sid, after = 0) => {
    const r = await m.fetch(`${BASE}sessions/${sid}/events?after=${after}`, {});
    const rd = r.body.getReader(), dec = new TextDecoder(); let b = '';
    for (;;) { const x = await Promise.race([rd.read(), new Promise((res) => setTimeout(() => res({ done: true }), 5))]); if (x.done) break; b += dec.decode(x.value); }
    await rd.cancel(); return [...b.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map((a) => [a[1], JSON.parse(a[2])]);
  };
  const readFrames = async (res, n) => { // the first n frames of an event stream, as text
    const reader = res.body.getReader(), dec = new TextDecoder(); let buf = '';
    while ((buf.match(/\n\n/g) || []).length < n) { const r = await reader.read(); if (r.done) break; buf += dec.decode(r.value); }
    await reader.cancel();
    return buf.split('\n\n').filter(Boolean).slice(0, n).map((f) => `${f}\n\n`);
  };
  // A small client over the mock for the contract checks below.
  const rig = (opts) => {
    const m = createMockLive(opts);
    const req = async (method, path, body) => { const r = await m.fetch(`${BASE}${path}`, { method, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) }); return [r.status, await r.json()]; };
    const post = (path, body) => req('POST', path, body ?? {});
    return { m, post, get: (path) => req('GET', path), session: async (extra = { scene: 'home' }) => (await post('sessions', extra))[1].sessionId };
  };
  const wait5 = () => sleep(5001); // past the rate window (10 per 5 s, shared by set, advance, actions and faults)

  await check('mock · health, session body (no suggestions, no automations); no route needs an Authorization header', async () => {
    const m = createMockLive(), j = async (r) => [r.status, await r.json()];
    eq(await j(await m.fetch(`${BASE}health`)), [200, { ok: true, liveEnabled: true, scenes: ['home'] }]);
    eq((await m.fetch(`${BASE}sessions`, { method: 'POST', headers: { authorization: 'Bearer anything' }, body: '{"scene":"home"}' })).status, 201, 'one sent is ignored');
    const r = await m.fetch(`${BASE}sessions`, { method: 'POST', body: '{"scene":"home"}' });
    const s = await r.json(); eq(r.status, 201);
    eq(Object.keys(s).sort(), ['clock', 'sessionId', 'state', 'world'], 'sessionId, state, clock, world');
    ok(s.state.lamp.status === 'online' && s.clock.label === 'Fri 16:30' && s.world.air.temp === 21, 'session body');
  });

  await check('mock · SSE framing and resume', async () => {
    const { m, post, session } = rig(), sid = await session();
    const stream = await m.fetch(`${BASE}sessions/${sid}/events`, {});
    eq(stream.headers.get('content-type'), 'text/event-stream');
    eq((await post(`sessions/${sid}/set`, { path: 'soil.moisture', value: 20 }))[0], 202);
    eq((await post(`sessions/${sid}/set`, { path: 'lamp.brightness', value: 0.5 }))[0], 202);
    eq(await readFrames(stream, 2), [
      `id: 1\nevent: state\ndata: {"path":"soil.moisture","value":20,"ms":0,"src":"edit"}\n\n`,
      `id: 2\nevent: state\ndata: {"path":"lamp.brightness","value":0.5,"ms":0,"src":"edit"}\n\n`]);
    const again = await m.fetch(`${BASE}sessions/${sid}/events?after=2`, {});
    const [f] = await readFrames(again, 1);
    eq(f, `id: 3\nevent: state\ndata: {"path":"lamp.on","value":true,"ms":0,"src":"edit"}\n\n`, 'resume frame');
  });

  await check('mock · the removed routes answer 404 (apply, requests, approve, what-if, automations)', async () => {
    const { post, session } = rig(), sid = await session();
    eq(await post('apply', { email: 'a@b.c' }), [404, { error: 'bad_request', message: 'No such route.' }], 'apply');
    for (const path of ['requests', 'requests/r1/approve', 'requests/r1/decline', 'requests/r1/whatif', 'automations/rule1', 'automations/rule1/remove', 'automations/clear']) {
      eq(await post(`sessions/${sid}/${path}`, { text: 'Movie night' }), [404, { error: 'bad_request', message: 'No such route.' }], path);
    }
  });

  await check('mock · GET devices: scene order, actions with JSON-schema parameters, edits, fault modes, status', async () => {
    const { get, post, session } = rig(), sid = await session();
    const [st, body] = await get(`sessions/${sid}/devices`);
    eq(st, 200); eq(body.devices.map((d) => d.id), ['lamp', 'blinds', 'soil', 'pump', 'camera', 'thermostat'], 'scene order');
    const lamp = body.devices[0];
    eq([lamp.type, lamp.name, lamp.status, lamp.state.brightness], [null, 'Floor lamp', 'online', 0], 'lamp');
    eq(lamp.actions, [{ verb: 'set_lamp', name: 'set_lamp', kind: 'write', description: 'Set the floor lamp brightness from 0 (off) to 100.', parameters: { type: 'object', properties: { brightness: { type: 'integer', minimum: 0, maximum: 100 } }, required: ['brightness'], additionalProperties: false } }], 'set_lamp');
    eq(body.devices.find((d) => d.id === 'pump').actions.map((a) => [a.verb, a.kind]), [['run_pump', 'write'], ['stop_pump', 'safe']], 'the pump');
    eq(body.devices.find((d) => d.id === 'pump').faultModes, ['offline', 'blocked', 'stuck'], 'pump fault modes');
    eq(body.devices.find((d) => d.id === 'camera').edits, [{ field: 'armed', kind: 'bool' }, { field: 'motion', kind: 'bool' }], 'camera edits');
    eq(body.clock.label, 'Fri 16:30', 'the clock');
    eq((await get('sessions/nope/devices'))[1].error, 'no_session', 'no session');
    const c = rig({ scenes: ['custom'] }), csid = await c.session({ scene: 'custom', devices: [{ type: 'floor_lamp', id: 'floor_lamp' }, { type: 'soil_sensor', id: 'soil_sensor' }] });
    const cd = (await c.get(`sessions/${csid}/devices`))[1].devices;
    eq(cd.map((d) => [d.id, d.type, d.actions.map((a) => [a.verb, a.name])]), [['floor_lamp', 'floor_lamp', [['set', 'set_floor_lamp']]], ['soil_sensor', 'soil_sensor', [['read', 'read_soil_sensor']]]], 'a custom room: catalog verbs, "<verb>_<id>" names');
  });

  await check('mock · an action: checks in order, events call → state → result (src action), the answer once they played', async () => {
    const { m, post, session } = rig(), sid = await session(), act = (dev, verb, body) => post(`sessions/${sid}/devices/${dev}/actions/${verb}`, body);
    eq((await act('lamp', 'set_lamp', [1]))[1].error, 'bad_request', 'an array body');
    eq((await act('nope', 'set_lamp', {}))[0], 404); eq((await act('nope', 'set_lamp', {}))[1].error, 'no_device', 'no device');
    eq((await act('lamp', 'fly', {}))[1].error, 'no_action', 'no action');
    const [bs, bad] = await act('lamp', 'set_lamp', { brightness: 101 });
    eq([bs, bad.error, bad.detail], [400, 'bad_value', "'brightness' must be at most 100"], 'out of range, with the validator\'s sentence');
    eq((await act('lamp', 'set_lamp', {}))[1].detail, "'brightness' is required", 'missing');
    eq((await act('lamp', 'set_lamp', { brightness: 2.5 }))[1].detail, "'brightness' must be a whole number", 'an integer');
    eq((await act('lamp', 'set_lamp', { brightness: 20, x: 1 }))[1].detail, "'x' is not a parameter of this action", 'no extra keys');
    await wait5();
    const n = (await framesOf(m, sid)).length;
    const [st, r] = await act('lamp', 'set_lamp', { brightness: 40 });
    eq([st, r], [200, { callId: 'a1', device: 'lamp', action: 'set_lamp', ok: true, outcome: 'confirmed', text: 'confirmed', result: { ok: true } }], 'the answer');
    const fr = (await framesOf(m, sid)).slice(n);
    eq(fr.map((f) => f[0]), ['call', 'state', 'state', 'result'], 'call, state frames, result');
    eq(fr[0][1], { callId: 'a1', device: 'lamp', action: 'set_lamp', args: { brightness: 40 }, label: 'Floor lamp → 40%', src: 'action' }, 'the call');
    eq(fr[2][1], { path: 'lamp.brightness', value: 0.4, ms: 1200, src: 'action' }, 'a tweened state frame');
    ok(fr.every((f) => f[1].src === 'action' && !('rid' in f[1])), 'all src action, no rid');
    const bare = await m.fetch(`${BASE}sessions/${sid}/devices/pump/actions/stop_pump`, { method: 'POST' });
    eq([bare.status, (await bare.json()).outcome], [200, 'made_safe'], 'no params: no body at all works');
    const [, read] = await act('soil', 'read_soil', {}); eq([read.outcome, read.text, read.result], ['reading', '34%', { ok: true, reading: 34 }], 'a read');
    const k0 = (await framesOf(m, sid)).length; await act('pump', 'run_pump', { seconds: 5 });
    eq((await framesOf(m, sid)).slice(k0).map((f) => f[0]), ['call', 'state', 'world', 'state', 'state', 'result'], 'watering changes the world: a world event before the result');
    // an action playing: another action, an advance, a fault or a reset answers 409 busy
    const b = rig({ actionMs: 1000 }), bsid = await b.session();
    const first = b.post(`sessions/${bsid}/devices/lamp/actions/set_lamp`, { brightness: 10 }); await settle();
    for (const [path, body] of [['devices/blinds/actions/set_blinds', { closed_percent: 50 }], ['advance', { hours: 1 }], ['faults', { device: 'lamp' }], ['faults/clear', undefined], ['reset', {}]]) eq((await b.post(`sessions/${bsid}/${path}`, body))[1].error, 'busy', `${path} while an action plays`);
    eq((await b.post(`sessions/${bsid}/set`, { path: 'soil.moisture', value: 9 }))[0], 202, 'a hand edit is still taken');
    eq((await first)[1].ok, true, 'the first one answers'); await wait5();
    eq((await b.post(`sessions/${bsid}/advance`, { hours: 1 }))[0], 200, 'then the room is free');
    // the rate window is shared with set
    for (let i = 0; i < 10; i++) await post(`sessions/${sid}/set`, { path: 'soil.moisture', value: i });
    eq((await act('lamp', 'set_lamp', { brightness: 1 }))[1].error, 'rate', 'rate, shared with set');
  });

  await check('mock · faults: plant (offline by default, one mode per device, listed modes only), offline shows on the next action, clear, reset', async () => {
    const { m, post, get, session } = rig(), sid = await session();
    eq(await post(`sessions/${sid}/faults`, { device: 'lamp' }), [200, { faults: [{ device: 'lamp', mode: 'offline' }] }], 'default offline');
    eq((await post(`sessions/${sid}/faults`, { device: 'camera', mode: 'stuck' }))[1].error, 'bad_request', 'a mode the device does not list');
    eq((await post(`sessions/${sid}/faults`, { mode: 'offline' }))[1].error, 'bad_request', 'no device');
    eq((await post(`sessions/${sid}/faults`, { device: 'nope' }))[1].error, 'no_device', 'unknown device');
    const n = (await framesOf(m, sid)).length;
    eq((await post(`sessions/${sid}/faults`, { device: 'pump', mode: 'blocked' }))[1].faults, [{ device: 'lamp', mode: 'offline' }, { device: 'pump', mode: 'blocked' }], 'every planted fault');
    eq((await framesOf(m, sid)).slice(n), [['state', { path: 'pump.blocked', value: true, ms: 0, src: 'edit' }]], 'a look flag, src edit');
    eq((await get(`sessions/${sid}/devices`))[1].devices[0].status, 'online', 'offline is not announced');
    eq((await post(`sessions/${sid}/faults`, { device: 'pump', mode: 'stuck' }))[1].faults.map((f) => f.mode), ['offline', 'stuck'], 'planting replaces that device\'s mode');
    await wait5();
    const k = (await framesOf(m, sid)).length;
    eq((await post(`sessions/${sid}/devices/lamp/actions/set_lamp`, { brightness: 50 }))[1], { callId: 'a1', device: 'lamp', action: 'set_lamp', ok: false, outcome: 'failed', text: 'not responding', result: { ok: false, error: 'not responding' } }, 'the action fails');
    eq((await framesOf(m, sid)).slice(k).map((f) => f[0]), ['call', 'fault', 'state', 'result'], 'call, fault, status fault, failed result');
    eq(m.session(sid).state.lamp.status, 'fault', 'the card turns red');
    await post(`sessions/${sid}/devices/lamp/actions/set_lamp`, { brightness: 50 });
    eq((await framesOf(m, sid)).slice(k + 4).map((f) => f[0]), ['call', 'result'], 'the fault only the first time');
    const c = (await framesOf(m, sid)).length;
    eq(await post(`sessions/${sid}/faults/clear`), [200, { faults: [] }], 'clear');
    eq((await framesOf(m, sid)).slice(c).map((f) => f[1].path + '=' + f[1].value), ['lamp.status=online'], 'back online (the stuck pump had no flag left)');
    await post(`sessions/${sid}/faults`, { device: 'soil', mode: 'sensorDetached' }); eq(m.session(sid).state.soil.probeOut, true, 'probe out');
    eq((await post(`sessions/${sid}/reset`))[1].world.soil.pot, 34, 'reset answers the world');
    eq([m.session(sid).faults, m.session(sid).state.soil.probeOut], [[], false], 'reset clears the faults and their flags');
  });

  await check('rig · set and advance follow the contract', async () => {
    const { m, post, session } = rig(), sid = await session();
    eq(await post(`sessions/${sid}/set`, { path: 'soil.moisture', value: 20 }), [202, {}], 'set ok');
    const fr = await framesOf(m, sid);
    eq(fr, [['state', { path: 'soil.moisture', value: 20, ms: 0, src: 'edit' }]], 'an edit frame has src and no rid');
    eq((await post(`sessions/${sid}/set`, { path: 'lamp.on', value: true }))[1].error, 'bad_value', 'path not editable');
    eq((await post(`sessions/${sid}/set`, { path: 'lamp.brightness', value: 2 }))[0], 400, 'out of range');
    eq((await post(`sessions/${sid}/set`, { path: 'pump.running', value: 1 }))[0], 400, 'wrong type');
    eq((await post(`sessions/${sid}/set`, { path: 'lamp.status', value: 'fault' }))[0], 400, 'status not editable');
    eq((await post(`sessions/${sid}/set`, { path: 'lamp.brightness', value: 0.5 }))[0], 202); eq((await framesOf(m, sid, 1)).map((f) => f[0]), ['state', 'state'], 'lamp.on follows brightness');
    await wait5();
    for (const h of [0, -1, 169, '2']) eq((await post(`sessions/${sid}/advance`, { hours: h }))[1].error, 'bad_value', `hours ${h}`);
    const n = (await framesOf(m, sid)).length;
    const [st, body] = await post(`sessions/${sid}/advance`, { hours: 3 });
    eq(st, 200); eq(body.clock.hour, 19.5, 'end clock'); eq(body.clock.label, 'Fri 19:30');
    const cf = (await framesOf(m, sid, n)).filter((f) => f[0] === 'clock');
    ok(cf.length >= 1 && cf.every((f) => f[1].src === 'edit' && !('rid' in f[1])), 'clock frames src edit, no rid');
    eq(cf.at(-1)[1].hour, 19.5);
  });

  await check('rig · edit rate limit and an unavailable device', async () => {
    const { m, post, session } = rig(), sid = await session();
    for (let i = 0; i < 10; i++) eq((await post(`sessions/${sid}/set`, { path: 'soil.moisture', value: i }))[0], 202, `set ${i}`);
    eq((await post(`sessions/${sid}/set`, { path: 'soil.moisture', value: 1 }))[1].error, 'rate', '11th is rate');
    eq((await post(`sessions/${sid}/advance`, { hours: 1 }))[1].error, 'rate', 'shared with advance');
    eq((await post(`sessions/${sid}/faults`, { device: 'lamp' }))[1].error, 'rate', 'shared with faults');
    await wait5();
    eq((await post(`sessions/${sid}/set`, { path: 'soil.moisture', value: 5 }))[0], 202, 'window passed');
    m.push(sid, 'state', { path: 'pump.status', value: 'fault', ms: 0 });
    eq((await post(`sessions/${sid}/set`, { path: 'pump.running', value: true }))[1].error, 'device_unavailable', 'fault');
    eq((await post(`sessions/${sid}/set`, 'x'))[1].error, 'bad_request', 'malformed body');
  });

  await check('api · set, advance, devices, actions and faults post to the contract routes', async () => {
    const m = createMockLive(), api = createLiveApi({ base: 'http://mock', fetch: m.fetch }), last = () => m.calls.at(-1);
    const { sessionId } = await api.createSession('home');
    eq(await api.set(sessionId, 'soil.moisture', 12), {}, 'set resolves');
    eq([last().method, last().path, last().body], ['POST', `sessions/${sessionId}/set`, { path: 'soil.moisture', value: 12 }]);
    const a = await api.advance(sessionId, 2); eq(a.clock.hour, 18.5); eq(last().body, { hours: 2 });
    const d = await api.devices(sessionId); eq([last().method, last().path, d.devices.length], ['GET', `sessions/${sessionId}/devices`, 6], 'devices');
    const r = await api.action(sessionId, 'lamp', 'set_lamp', { brightness: 30 });
    eq([last().method, last().path, last().body, last().headers['content-type']], ['POST', `sessions/${sessionId}/devices/lamp/actions/set_lamp`, { brightness: 30 }, 'application/json'], 'an action: its args as the body');
    eq([r.ok, r.outcome], [true, 'confirmed']);
    await api.action(sessionId, 'pump', 'stop_pump'); eq(last().body, {}, 'no args: {}');
    eq(await api.plantFault(sessionId, 'pump', 'blocked'), { faults: [{ device: 'pump', mode: 'blocked' }] }); eq(last().body, { device: 'pump', mode: 'blocked' }, 'plant body');
    await api.plantFault(sessionId, 'lamp'); eq(last().body, { device: 'lamp' }, 'no mode: the server\'s default');
    eq(await api.clearFaults(sessionId), { faults: [] }); eq([last().path, last().body], [`sessions/${sessionId}/faults/clear`, null], 'clear: no body');
    let err; try { await api.action(sessionId, 'lamp', 'set_lamp', { brightness: -1 }); } catch (e) { err = e; }
    ok(err instanceof LiveError && err.kind === 'bad_value' && err.status === 400 && err.detail === "'brightness' must be at least 0", 'LiveError bad_value with its detail');
    try { await api.set(sessionId, 'lamp.on', true); } catch (e) { err = e; }
    ok(err.kind === 'bad_value' && !('detail' in err), 'no detail when the body has none');
    for (const k of ['check', 'apply', 'request', 'approve', 'decline', 'whatIf', 'automation', 'removeAutomation', 'clearAutomations']) ok(!(k in api), `no api.${k}`);
  });

  // ---- config and API client ----
  await check('config · ?liveApi= only for localhost', () => {
    const at = (q) => liveApiBase({ search: q });
    eq(at('?liveApi=http://localhost:8787/'), 'http://localhost:8787');
    eq(at('?liveApi=http://127.0.0.1:8787'), 'http://127.0.0.1:8787');
    eq(at('?liveApi=https://evil.example'), LIVE_CONFIG.apiBase);
    eq(at('?liveApi=http://localhost.evil.example'), LIVE_CONFIG.apiBase);
    eq(at('?liveApi=javascript:alert(1)'), LIVE_CONFIG.apiBase);
  });

  const apiOf = (mock, extra = {}) => createLiveApi({ base: 'http://mock', fetch: mock.fetch, ...extra });
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
    ok(!('authorization' in last().headers), 'POST sessions sends no Authorization header');
    await api.action(sid, 'lamp', 'set_lamp', { brightness: 20 });
    ok(!('authorization' in last().headers), 'an action sends none either');
    eq(last().headers['ngrok-skip-browser-warning'], '1', 'ngrok header');
    eq(last().headers['content-type'], 'application/json', 'content-type');
    const m2 = createMockLive(), a2 = apiOf(m2);
    m2.set({ off: 'live_off' }); eq(await fails(a2.createSession('home')), { status: 503, kind: 'live_off' }, 'live_off');
    const e = await a2.createSession('home').catch((x) => x); ok(typeof e.message === 'string' && e.message.length > 0, 'message from the body');
    m2.set({ off: null, mode: 'html' }); eq(await fails(a2.createSession('home')), { status: 200, kind: 'bad_response' }, 'html');
    m2.set({ mode: 'down' }); eq(await fails(a2.createSession('home')), { status: 0, kind: 'network' }, 'down');
    const slow = createLiveApi({ base: 'http://mock', fetch: () => new Promise(() => {}), timeoutMs: 500 });
    eq(await fails(slow.reset('s')), { status: 0, kind: 'network' }, 'timeout');
    const t0 = performance.now(); eq(await fails(slow.action('s', 'lamp', 'set_lamp', {})), { status: 0, kind: 'network' }, 'an action times out too');
    eq(Math.round(performance.now() - t0), 40000, 'but only after 40 s (it answers once its frames played)');
    const m3 = createMockLive(), a3 = apiOf(m3), { sessionId: s3 } = await a3.createSession('home');
    ok(a3.eventsUrl(s3, 4).endsWith(`/live/api/sessions/${s3}/events?after=4`) && !a3.eventsUrl(s3).includes('after'), 'eventsUrl');
    eq(a3.headers(), { 'ngrok-skip-browser-warning': '1', Accept: 'text/event-stream' }, 'sse headers: no Authorization');
  });

  // ---- Task 3: the event stream ----
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
    eq(gets[0].headers.accept, 'text/event-stream'); ok(!('authorization' in gets[0].headers), 'no Authorization header');
    es.close();
  });

  await check('sse · 404 → gone, backoff used up → lost, HTML 200 → lost, a 401 is retried like a 5xx, close() is silent', async () => {
    // 404: the session expired under the stream
    { const mock = createMockLive(), api = apiOf(mock), { sessionId: sid } = await api.createSession('home'), f = counting(mock.fetch), w = watch();
      const es = openEventStream({ api, sessionId: sid, fetch: f, onEvent: w.onEvent, onStatus: w.onStatus });
      await w.until(() => w.statuses.includes('open')); mock.expire(sid);
      await w.until(() => w.statuses.includes('gone')); await sleep(30000);
      eq(w.statuses, ['open', 'retrying', 'gone'], '404 statuses'); eq(f.log.length, 2, 'no GET after gone'); es.close(); }
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
    // a 401 is no special case any more (no route needs a code): retried, then lost
    { const w = watch(), f = counting(() => Promise.resolve(new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } })));
      const es = openEventStream({ api: apiOf(createMockLive()), sessionId: 's', fetch: f, onEvent: w.onEvent, onStatus: w.onStatus, backoff: [10, 10] });
      await w.until(() => w.statuses.includes('lost')); eq(w.statuses, ['retrying', 'retrying', 'lost'], '401'); eq(f.log.length, 3); es.close(); }
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

  // ---- the controller: open, session, room ----
  const posts = (m) => m.calls.filter((c) => c.method === 'POST' && c.path === 'sessions');
  const postsTo = (m, re) => m.calls.filter((c) => c.method === 'POST' && re.test(c.path));
  const eventGets = (m) => m.calls.filter((c) => c.path.endsWith('/events'));
  const offlineCount = (t) => t.log.filter((e) => e[0] === 'view' && e[1] === 'offline').length;
  const count = (t, source, method) => t.log.filter((e) => e[0] === source && e[1] === method).length;
  const ncbCount = (t, text) => t.log.filter((e) => e[0] === 'view' && e[1] === 'ncb' && e[2] === text).length;
  const lastClock = (t) => t.find('ui', 'clock')?.[0];
  const lastControls = (t) => t.find('ui', 'controls')?.[0];
  const statusesFrom = (t, i) => t.log.slice(i).filter((e) => e[0] === 'ui' && e[1] === 'status').map((e) => e[2]);
  const logLines = (t) => t.all('ui', 'log').map((e) => e[0]).filter(Boolean); // null: a fresh log
  // The same mock, except the first request whose path matches `re` gets `answer()` instead.
  const failOnce = (m, re, answer) => { let left = 1; return { ...m, fetch: (url, init) => (left > 0 && re.test(String(url)) ? (left--, answer()) : m.fetch(url, init)) }; };
  const jsonAnswer = (status, body) => () => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  const SOIL_EDIT = 'soil.moisture';

  await check('copy · LIVE_COPY passes the guardrails and says nothing about requests, plans or the AI', () => {
    const hits = [];
    for (const [k, v] of Object.entries(LIVE_COPY)) {
      const outs = typeof v === 'function' ? [6, 'the soil sensor', 'x', null, 1, 0, 'offline', 'sensorDetached'].flatMap((a) => [v(a), v(a, 3)]) : [v];
      for (const o of outs) {
        ok(typeof o === 'string', `${k} is text`);
        for (const g of guardHits(o)) hits.push(`${k}: ${g}`);
        if (/\b(AI|plan|approve|request for|what if)\b/i.test(o) && k !== 'back') hits.push(`${k} still talks about the AI: "${o}"`);
      }
    }
    eq(hits, []);
    eq([LIVE_COPY.terminal, LIVE_COPY.faultWord('sensorDetached'), LIVE_COPY.toolsCount(1, 2), LIVE_COPY.statusIdle(1), LIVE_COPY.statusIdle(6)],
      ['Connect an NCB to chat here', 'sensor detached', '1 fault · 2 events', 'Live · 1 device', 'Live · 6 devices']);
    eq(LIVE_COPY.actionBadValue("'brightness' must be at most 100."), "Not sent: 'brightness' must be at most 100.", 'the validator\'s sentence, one full stop');
    for (const k of ['placeholder', 'planning', 'planIntro', 'whatIf', 'autosTitle', 'noneLeft', 'left', 'limitGlobal']) ok(!(k in LIVE_COPY), `no LIVE_COPY.${k}`);
    // the code gate is gone: no copy for a code card, the application form, saved codes or per-code limits
    for (const k of ['accessIntro', 'badCode', 'savedCodeGone', 'applyEmailUse', 'applied', 'applyRate', 'limitCode', 'rate']) ok(!(k in LIVE_COPY), `no LIVE_COPY.${k}`);
    for (const [k, v] of Object.entries(LIVE_COPY)) for (const o of typeof v === 'function' ? [v(2), v('x')] : [v]) ok(!/\b(invite|code|apply|application)/i.test(o), `${k} says nothing about codes or applying: "${o}"`);
  });

  await check('open · straight into the room, asking for no code: session, room, device list and intro', async () => {
    const t = await harness(); const p = t.live.open();
    eq([t.live.phase, t.live.active], ['opening', true], 'asking /health');
    await p;
    eq(offlineCount(t), 0, 'no card'); eq(t.live.phase, 'idle'); eq(t.live.active, true); ok(t.has('view', 'live', true));
    eq(t.mock.calls.map((c) => `${c.method} ${c.path.replace(t.live.sessionId, '{sid}')}`), ['GET health', 'POST sessions', 'GET sessions/{sid}/events', 'GET sessions/{sid}/devices'], 'health, then the session: nothing else is asked');
    ok(t.mock.calls.every((c) => !('authorization' in c.headers)), 'no Authorization header on any call');
    eq(t.find('view', 'ncb')[0], LIVE_COPY.intro(6)); ok(LIVE_COPY.intro(6).startsWith('Live mode is on: these 6 devices run'), 'intro');
    eq(t.store.get('lamp.status'), 'online'); eq(t.find('ui', 'beats')[0], { current: 'ask', recoverHidden: true, skippable: [] });
    eq(t.find('ui', 'status')[0], 'Live · 6 devices'); eq(t.find('ui', 'editing'), [true]);
    const devs = t.find('ui', 'devices')[0];
    eq(devs.map((d) => [d.id, d.actions.map((a) => a.verb)]), [['lamp', ['set_lamp']], ['blinds', ['set_blinds']], ['soil', ['read_soil']], ['pump', ['run_pump', 'stop_pump']], ['camera', ['set_door_camera']], ['thermostat', ['set_thermostat']]], 'the room\'s actions, in scene order');
    eq(devs[3].faultModes, ['offline', 'blocked', 'stuck'], 'with their fault modes');
    eq(t.find('ui', 'faults')[0], [], 'no fault planted'); eq(lastControls(t), { enabled: true, acting: null }, 'controls enabled');
    ok(t.order('ui', 'devices', null) < t.order('ui', 'devices', devs) && t.order('ui', 'log', null) >= 0, 'a fresh session clears the tools first');
    eq(postsTo(t.mock, /./).map((c) => c.path), ['sessions'], 'nothing is posted but the session');
    ok(!t.mock.calls.some((c) => /requests|automations|whatif/.test(c.path)), 'no request, automation or what-if route');
    t.live.close();
  });

  await check('offline · (health html / down / liveEnabled false / scene missing) → offline card that says why, live stays inactive', async () => {
    const down = LIVE_COPY.backendDown('http://mock');
    ok(down.includes('NCF backend not found at http://mock'), 'the card names the address it looked at');
    for (const [opts, why] of [[{ mode: 'html' }, down], [{ mode: 'down' }, down], [{ liveEnabled: false }, LIVE_COPY.backendOff], [{ scenes: ['lab'] }, LIVE_COPY.sceneOff]]) {
      const t = await harness({ mock: createMockLive(opts) });
      eq(await t.live.probe(), false, JSON.stringify(opts)); eq(t.live.available, false);
      await t.live.open(); eq(t.find('view', 'offline')[0], { text: why }, JSON.stringify(opts)); eq(t.live.phase, 'offline'); eq(posts(t.mock).length, 0);
      t.lastOffline.back(); ok(t.has('ui', 'offerGuided'), 'offered guided'); eq(t.live.active, false); eq(t.live.phase, 'off'); ok(t.has('offline', 'close'));
    }
    const ok1 = await harness(); eq(await ok1.live.probe(), true); eq(ok1.live.available, true);
    eq([liveHere({ ok: true, liveEnabled: true, scenes: ['home'] }, 'home'), liveHere({ ok: true, liveEnabled: true, scenes: ['home'] }, 'custom'), liveHere(null, 'home'), liveHere({ ok: true, liveEnabled: true }, 'home')], [true, false, false, false], 'liveHere');
  });

  await check('room · applyRoom merges onto the baseline, keeps room-only fields; stream clock events apply', async () => {
    const t = await harness({ entered: true }), base = t.store.snapshot(), sid = t.live.sessionId;
    eq(base.soil.probeOut, false); t.ui.baseline = () => base;
    t.store.set('soil.probeOut', true); t.store.set('lamp.brightness', 0.9);
    const marks = () => t.log.filter((e) => e[0] === 'panel' && e[1] === 'mark' && e[3] === null).length, r0 = count(t, 'ui', 'resetRoom');
    const m0 = marks(); await t.live.reset();
    eq(t.store.get('soil.probeOut'), false, 'room-only field back to baseline'); eq(t.store.get('lamp.brightness'), 0, 'the server\'s value');
    eq(marks() - m0, 6, 'panel.mark(id, null) for all six'); eq(count(t, 'ui', 'resetRoom') - r0, 1, 'ui.resetRoom once');
    t.mock.push(sid, 'clock', { iso: '2026-11-13T21:00:00', label: 'Fri 21:00', hour: 21 });
    await sleep(900); eq(t.store.get('env.hour'), 21, 'a clock event applies (no request filter any more)'); eq(lastClock(t).label, 'Fri 21:00');
    t.live.close();
  });

  await check('session · 404 on the stream → fresh session with timedOut notice and its own device list', async () => {
    const t = await harness({ entered: true }), sid = t.live.sessionId;
    t.mock.expire(sid);
    await waitFor(() => t.live.sessionId !== sid && t.live.phase === 'idle');
    eq(posts(t.mock).length, 2); eq(t.find('view', 'ncb')[0], LIVE_COPY.timedOut);
    eq(t.mock.calls.filter((c) => c.method === 'GET' && c.path.endsWith('/devices')).map((c) => c.path), [`sessions/${sid}/devices`, `sessions/${t.live.sessionId}/devices`], 'devices asked again for the new room');
    eq(t.live.active, true); eq(lastControls(t).enabled, true);
    await waitFor(() => eventGets(t.mock).at(-1).path.includes(t.live.sessionId));
    ok([null, '0'].includes(eventGets(t.mock).at(-1).query.after ?? null), 'the new stream starts from the beginning');
    t.live.close();
  });

  await check('session · POST sessions 503 live_off → offline; 429 global_limit (the server is full) → busy copy; both back to guided', async () => {
    for (const [set, line] of [[{ off: 'live_off' }, LIVE_COPY.offline], [{ sessionCap: 'global_limit' }, LIVE_COPY.sessionsBusy]]) {
      const t = await harness(); t.mock.set(set); await t.live.open();
      eq(t.find('view', 'ncb')[0], line, JSON.stringify(set)); ok(t.has('ui', 'offerGuided'), 'guided'); eq(t.live.active, false); eq(t.live.phase, 'off');
      eq(eventGets(t.mock).length, 0, 'no stream opened');
    }
  });

  await check('session · GET devices fails → a line, an empty list; the cards still edit', async () => {
    const t = await harness({ mock: failOnce(createMockLive(), /\/devices$/, jsonAnswer(500, { error: 'internal', message: 'Oops.' })), entered: true });
    eq(t.find('ui', 'devices')[0], [], 'no actions'); ok(t.has('view', 'ncb', LIVE_COPY.devicesFailed), 'says so'); eq(t.live.phase, 'idle');
    await t.live.edit(SOIL_EDIT, 25); eq(postsTo(t.mock, /\/set$/).length, 1, 'hand edits still work');
    await t.live.run('lamp', 'set_lamp', { brightness: 10 }); eq(postsTo(t.mock, /\/actions\//).length, 0, 'no action without the device list');
    t.live.close();
  });

  await check('close · silent after close(); exit() and ui death too', async () => {
    const t = await harness({ entered: true }), sid = t.live.sessionId, n0 = t.log.length;
    t.live.close(); t.mock.push(sid, 'state', { path: 'lamp.brightness', value: 0.7, ms: 0 }); await sleep(2000);
    eq(t.log.length, n0, 'nothing logged after close'); ok(t.store.get('lamp.brightness') !== 0.7);
    const u = await harness({ entered: true }); u.ui.kill(); const m = u.log.length; u.mock.push(u.live.sessionId, 'state', { path: 'lamp.brightness', value: 0.7, ms: 0 }); await sleep(2000);
    eq(u.log.length, m, 'nothing after ui.alive() false'); ok(u.store.get('lamp.brightness') !== 0.7, 'room untouched after ui death'); u.live.close();
    const e = await harness({ entered: true }), esid = e.live.sessionId; e.live.exit('Back'); eq(e.find('ui', 'offerGuided')[0], 'Back'); eq(e.live.active, false); ok(e.has('view', 'live', false)); ok(e.has('ui', 'track', false));
    eq([e.find('ui', 'editing'), e.find('ui', 'devices'), e.find('ui', 'faults')], [[false], [null], [null]], 'exit takes the tools away');
    const m2 = e.log.length; e.mock.push(esid, 'state', { path: 'lamp.brightness', value: 0.7, ms: 0 }); await sleep(2000); eq(e.log.length, m2, 'silent after exit'); ok(e.store.get('lamp.brightness') !== 0.7, 'room untouched after exit');
  });

  // ---- device actions ----
  await check('action · a run posts its args, its events move the room, mark the card and fill the status line; the answer shows under its button', async () => {
    const t = await harness({ entered: true }), i0 = t.log.length;
    await t.live.run('lamp', 'set_lamp', { brightness: 40 });
    const p = postsTo(t.mock, /\/actions\//); eq(p.map((c) => [c.path, c.body]), [[`sessions/${t.live.sessionId}/devices/lamp/actions/set_lamp`, { brightness: 40 }]], 'one POST with its args');
    await sleep(1300); eq(t.store.get('lamp.brightness'), 0.4, 'the tween played'); eq(t.store.get('lamp.on'), true);
    eq(statusesFrom(t, i0), ['Floor lamp → 40%', 'Floor lamp → 40% · confirmed'], 'the call\'s label, then with its outcome');
    const marks = t.log.slice(i0).filter((e) => e[0] === 'panel' && e[1] === 'mark' && e[2] === 'lamp').map((e) => e[3]);
    eq([marks[0], marks.at(-1)], ['busy', 'just'], 'WORKING while it plays, JUST SET when confirmed');
    ok(t.has('panel', 'reveal', ['lamp']), 'its card comes into view');
    eq(t.find('ui', 'actionResult'), ['lamp', 'set_lamp', { ok: true, text: 'confirmed', outcome: 'confirmed' }], 'the answer under the button');
    ok(t.log.slice(i0).some((e) => e[0] === 'ui' && e[1] === 'track' && e[2] === true) && t.find('ui', 'track')[0] === false, 'the strip follows it, then stops');
    await t.live.run('soil', 'read_soil', {}); eq(t.find('ui', 'actionResult'), ['soil', 'read_soil', { ok: true, text: '34%', outcome: 'reading' }], 'a read answers its reading');
    await t.live.run('pump', 'stop_pump'); eq(postsTo(t.mock, /stop_pump$/)[0].body, {}, 'no params: an empty object');
    await t.live.run('lamp', 'fly', {}); await t.live.run('nosuch', 'set_lamp', {}); eq(postsTo(t.mock, /\/actions\//).length, 3, 'an action or device the list does not have posts nothing');
    t.live.close();
  });

  await check('action · busy while one plays: every action, fault, reset and the clock wait; a hand edit still goes', async () => {
    const t = await harness({ mock: createMockLive({ actionMs: 2000 }), entered: true });
    const p = t.live.run('blinds', 'set_blinds', { closed_percent: 100 }); await settle();
    eq(t.live.acting, { id: 'blinds', verb: 'set_blinds' }); eq(lastControls(t), { enabled: false, acting: { id: 'blinds', verb: 'set_blinds' } }, 'controls disabled, the running one named');
    eq([lastClock(t).enabled, lastClock(t).reason], [false, LIVE_COPY.clockBusy], 'the clock says why it waits');
    await t.live.run('lamp', 'set_lamp', { brightness: 10 }); await t.live.plantFault('lamp', 'offline'); await t.live.clearFaults(); await t.live.reset(); await t.live.advance(1);
    eq(postsTo(t.mock, /actions|faults|reset|advance/).length, 1, 'nothing else posted meanwhile');
    await t.live.edit(SOIL_EDIT, 22); eq(postsTo(t.mock, /\/set$/).length, 1, 'a hand edit is posted (the server queues it)');
    await p; eq(t.live.acting, null); eq(lastControls(t), { enabled: true, acting: null }, 'enabled again'); eq([lastClock(t).enabled, lastClock(t).reason], [true, null]);
    t.live.close();
  });

  await check('action · refusals: bad_value says the validator\'s sentence, no_action, 409 busy, a 401 like any failure, rate (once per 10 s), no_session', async () => {
    const t = await harness({ entered: true });
    await t.live.run('lamp', 'set_lamp', { brightness: 500 });
    eq(t.find('ui', 'actionResult'), ['lamp', 'set_lamp', { ok: false, text: "Not sent: 'brightness' must be at most 100." }], 'bad_value');
    eq(t.find('panel', 'mark'), ['lamp', null], 'WORKING goes'); eq(lastControls(t).enabled, true);
    t.live.close();
    for (const [answer, text] of [[jsonAnswer(404, { error: 'no_action', message: 'No.' }), LIVE_COPY.actionGone], [jsonAnswer(409, { error: 'busy', message: 'Busy.' }), LIVE_COPY.actionBusy], [jsonAnswer(500, { error: 'internal', message: 'Oops.' }), LIVE_COPY.actionFailed], [jsonAnswer(401, { error: 'unauthorized', message: 'No.' }), LIVE_COPY.actionFailed]]) {
      const u = await harness({ mock: failOnce(createMockLive(), /\/actions\//, answer), entered: true });
      await u.live.run('lamp', 'set_lamp', { brightness: 5 }); eq(u.find('ui', 'actionResult'), ['lamp', 'set_lamp', { ok: false, text }], text); eq(offlineCount(u), 0, 'no card'); eq(u.live.phase, 'idle'); u.live.close();
    }
    const r = await harness({ mock: failOnce(createMockLive(), /\/actions\//, jsonAnswer(429, { error: 'rate', message: 'Too many.' })), entered: true });
    await r.live.run('lamp', 'set_lamp', { brightness: 5 }); eq(ncbCount(r, LIVE_COPY.editRate), 1, 'rate: the edit-rate line'); eq(count(r, 'ui', 'actionResult'), 0, 'no result line'); r.live.close();
    const w = await harness({ mock: failOnce(createMockLive(), /\/actions\//, jsonAnswer(404, { error: 'no_session', message: 'Gone.' })), entered: true }), sid = w.live.sessionId;
    await w.live.run('lamp', 'set_lamp', { brightness: 5 }); await waitFor(() => w.live.sessionId !== sid && w.live.phase === 'idle');
    eq(ncbCount(w, LIVE_COPY.timedOut), 1, 'no_session: a fresh room'); w.live.close();
  });

  // ---- faults ----
  await check('faults · plant posts the device and mode and lists what the server holds; an offline device fails on its next action; clear', async () => {
    const t = await harness({ entered: true }), i0 = t.log.length;
    await t.live.plantFault('pump', 'blocked');
    eq(postsTo(t.mock, /\/faults$/).map((c) => c.body), [{ device: 'pump', mode: 'blocked' }], 'the POST');
    eq(t.find('ui', 'faults')[0], [{ device: 'pump', mode: 'blocked' }], 'the planted list'); eq(t.live.faults, [{ device: 'pump', mode: 'blocked' }]);
    await settle(); eq(t.store.get('pump.blocked'), true, 'its look flag (a state event)');
    await t.live.plantFault('camera', 'stuck'); await t.live.plantFault('nosuch', 'offline'); eq(postsTo(t.mock, /\/faults$/).length, 1, 'a mode the device does not list, or a device the room lacks: nothing posted');
    await t.live.plantFault('lamp', 'offline'); eq(t.find('ui', 'faults')[0], [{ device: 'pump', mode: 'blocked' }, { device: 'lamp', mode: 'offline' }], 'both');
    ok(statusesFrom(t, i0).length === 0, 'planting takes no status line'); eq(t.store.get('lamp.status'), 'online', 'offline is not announced');
    await t.live.run('lamp', 'set_lamp', { brightness: 60 }); await settle();
    eq([t.store.get('lamp.status'), t.store.get('lamp.faultNote')], ['fault', 'not responding'], 'the card turns red with the server\'s text');
    eq(t.find('ui', 'actionResult'), ['lamp', 'set_lamp', { ok: false, text: 'not responding', outcome: 'failed' }], 'the failed answer');
    eq(t.find('panel', 'mark'), ['lamp', null], 'no JUST SET'); ok(t.find('ui', 'status')[1] === true, 'the status line is red');
    await t.live.clearFaults(); await settle();
    eq([t.find('ui', 'faults')[0], t.store.get('lamp.status'), t.store.get('pump.blocked')], [[], 'online', false], 'cleared: back online, flags off');
    eq(postsTo(t.mock, /\/faults\/clear$/).length, 1);
    t.live.close();
  });

  await check('faults · refusals say so; reset clears the list', async () => {
    const t = await harness({ mock: failOnce(createMockLive(), /\/faults$/, jsonAnswer(400, { error: 'bad_request', message: 'No.' })), entered: true });
    await t.live.plantFault('lamp', 'offline'); ok(t.has('view', 'ncb', LIVE_COPY.faultRejected), 'plant refused'); eq(t.live.phase, 'idle');
    await t.live.plantFault('lamp', 'stuck'); eq(t.find('ui', 'faults')[0], [{ device: 'lamp', mode: 'stuck' }]);
    await t.live.reset(); eq(t.find('ui', 'faults')[0], [], 'reset clears them'); eq(t.find('view', 'ncb')[0], FRESH_START);
    eq(t.mock.session(t.live.sessionId).faults, [], 'on the server too');
    t.live.close();
    const u = await harness({ mock: failOnce(createMockLive(), /\/faults\/clear$/, jsonAnswer(500, { error: 'internal', message: 'No.' })), entered: true });
    await u.live.plantFault('lamp', 'offline'); await u.live.clearFaults(); ok(u.has('view', 'ncb', LIVE_COPY.faultsClearRejected), 'clear refused'); eq(u.find('ui', 'faults')[0], [{ device: 'lamp', mode: 'offline' }], 'the list stays');
    u.live.close();
  });

  // ---- the event log ----
  await check('event log · state, world, call, result, fault, clock and timeline events become short lines; a new session starts a fresh log', async () => {
    const t = await harness({ entered: true }), sid = t.live.sessionId, n0 = logLines(t).length;
    await t.live.plantFault('lamp', 'offline'); await t.live.run('lamp', 'set_lamp', { brightness: 20 }); await t.live.run('pump', 'run_pump', { seconds: 4 }); await t.live.advance(1);
    t.mock.push(sid, 'timeline', { at: 'Fri 18:00', text: 'Floor lamp → 35%', ok: true, kind: 'action' });
    t.mock.push(sid, 'timeline', { at: 'Fri 18:05', text: 'Sent you: someone at the door', ok: true, kind: 'notify' });
    await settle();
    const lines = logLines(t).slice(n0);
    eq(lines.map((l) => l.text), ['▶ Floor lamp → 20%', '⚠ Floor lamp · not responding', 'Floor lamp · status → fault', '✕ Floor lamp · not responding',
      '▶ Water pump → on for 4 s', 'Water pump · running → on', 'World · 21 °C inside · 120 lux · 9.5 °C outside · soil 38 · 61 W', 'Soil sensor · moisture → 38', 'Water pump · running → off', '✓ Water pump · commanded',
      '🕓 Fri 17:30', 'Fri 18:00 · Floor lamp → 35%', 'Fri 18:05 · 📩 Sent you: someone at the door'], 'the lines');
    eq(lines.map((l) => l.kind), ['call', 'fault', 'state', 'result', 'call', 'state', 'world', 'state', 'state', 'result', 'clock', 'timeline', 'timeline']);
    eq(lines.map((l) => l.ok), [true, false, false, false, true, true, true, true, true, true, true, true, true], 'what failed is marked');
    eq([lines[0].src, lines[6].src, lines[10].src], ['action', null, 'edit'], 'src kept for styling');
    t.mock.expire(sid); await waitFor(() => t.live.sessionId !== sid && t.live.phase === 'idle');
    ok(t.log.findLastIndex((e) => e[0] === 'ui' && e[1] === 'log' && e[2] === null) > t.log.findLastIndex((e) => e[0] === 'ui' && e[1] === 'log' && e[2]?.kind === 'timeline'), 'a fresh room: a fresh log');
    t.live.close();
  });

  await check('event log · eventLine: odd data gives no line or a safe one', () => {
    eq(eventLine(home, 'state', { value: 1 }), null, 'no path'); eq(eventLine(home, 'say', { delta: 'x' }), null, 'a removed kind');
    eq(eventLine(home, 'plan', { steps: [] }), null); eq(eventLine(home, 'clock', { hour: 3 }), null, 'a clock with no label');
    eq(eventLine(home, 'state', null), null); eq(eventLine(home, 'world', {}).text, 'World · changed');
    eq(eventLine(home, 'state', { path: 'nosuch.x', value: 0.123456 }).text, 'nosuch · x → 0.12', 'an unknown device by its id, numbers rounded');
    eq(eventLine(home, 'result', { device: 'soil', outcome: 'failed' }), { kind: 'result', text: '✕ Soil sensor · failed', ok: false, src: null }, 'a missing ok is never success when it failed');
    eq(eventLine(home, 'call', { device: 'pump', action: 'stop_pump' }).text, '▶ Water pump · stop_pump', 'a call without a label');
  });

  // ---- hand edits and the clock ----
  await check('edit · a slider change posts set and moves the store at once', async () => {
    const t = await harness({ entered: true }); ok(t.store.get(SOIL_EDIT) !== 25, 'starts elsewhere');
    const p = t.live.edit(SOIL_EDIT, 25); eq(t.store.get(SOIL_EDIT), 25, 'moved before the POST answered');
    await p; await settle();
    const s = postsTo(t.mock, /\/set$/); eq(s.length, 1); eq(s[0].body, { path: SOIL_EDIT, value: 25 });
    eq(t.store.get(SOIL_EDIT), 25, 'stays'); ok(logLines(t).some((l) => l.text === 'Soil sensor · moisture → 25' && l.src === 'edit'), 'its echo is in the event log'); t.live.close();
  });

  await check('edit · a rejected change rolls back (to the room\'s value) with one message; a path outside the edit specs posts nothing', async () => {
    const t = await harness({ entered: true });
    await t.live.edit('lamp.status', 'fault'); await t.live.edit('nope.field', 1); await t.live.edit('lamp.on', true); await settle();
    eq(postsTo(t.mock, /\/set$/).length, 0, 'no POST for non-spec paths'); eq(t.store.get('lamp.status'), 'online');
    const room = t.store.get('lamp.brightness'); t.store.set('lamp.brightness', 0.7); // drifted locally, never echoed
    await t.live.edit('lamp.brightness', 2); await settle();
    eq(postsTo(t.mock, /\/set$/).length, 1); eq(t.store.get('lamp.brightness'), room, 'back to the room\'s value');
    eq(ncbCount(t, LIVE_COPY.editRejected), 1, 'one editRejected');
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

  await check('edit · src edit events apply (state, clock) and never take the status line', async () => {
    const t = await harness({ entered: true }), sid = t.live.sessionId;
    t.mock.edit(sid, 'state', { path: 'lamp.brightness', value: 0.4, ms: 0 }); await settle();
    eq(t.store.get('lamp.brightness'), 0.4);
    t.mock.edit(sid, 'clock', { iso: '2026-11-08T22:30:00', label: 'Fri 22:30', hour: 22.5 }); await sleep(900);
    ok(t.find('ui', 'status')?.[0] !== 'Fri 22:30', 'a hand edit never takes the status line'); eq(lastClock(t).label, 'Fri 22:30'); eq(t.store.get('env.hour'), 22.5);
    t.live.close();
  });

  await check('session · two no_session failures at once open one session and say timed-out once', async () => {
    const m = createMockLive(); let left = 2;
    const t = await harness({ mock: { ...m, fetch: (url, init) => (left > 0 && /\/set$/.test(String(url)) ? (left--, jsonAnswer(404, { error: 'no_session', message: 'That session has ended.' })()) : m.fetch(url, init)) }, entered: true });
    await Promise.all([t.live.edit(SOIL_EDIT, 11), t.live.edit(SOIL_EDIT, 12)]);
    await waitFor(() => t.live.phase === 'idle'); await settle();
    eq(postsTo(t.mock, /sessions$/).length, 2, 'the first session and one more'); eq(ncbCount(t, LIVE_COPY.timedOut), 1, 'one timed-out line'); t.live.close();
  });

  await check('clock · enabled while the room is free; an advance keeps it disabled until it answers', async () => {
    const t = await harness({ entered: true });
    eq(lastClock(t).enabled, true, 'after enter'); eq(lastClock(t).label, 'Fri 16:30');
    const p = t.live.advance(6); eq(lastClock(t).enabled, false, 'at once'); eq(lastClock(t).reason, null, 'no reason for an advance'); eq(lastControls(t).enabled, false, 'the action buttons too');
    await t.live.advance(1); eq(postsTo(t.mock, /\/advance$/).length, 1, 'a second advance while one runs is ignored');
    await p; eq(lastClock(t).enabled, true, 'after the answer'); eq(lastClock(t).label, 'Fri 22:30');
    eq(postsTo(t.mock, /\/advance$/)[0].body, { hours: 6 });
    const s0 = count(t, 'ui', 'status'); await t.live.advance(1); eq(count(t, 'ui', 'status'), s0, 'an advance never takes the status line');
    t.live.exit(); eq(lastClock(t).enabled, false, 'after exit'); t.live.close();
  });

  await check('clock · advance refused (busy, or a 401) says nothing extra and re-enables; rate says editRate', async () => {
    const t = await harness({ mock: failOnce(createMockLive(), /\/advance$/, jsonAnswer(409, { error: 'busy', message: 'Busy.' })), entered: true });
    const n0 = count(t, 'view', 'ncb'); await t.live.advance(6); eq(count(t, 'view', 'ncb'), n0, 'no chat line'); eq(lastClock(t).enabled, true);
    const u = await harness({ mock: failOnce(createMockLive(), /\/advance$/, jsonAnswer(429, { error: 'rate', message: 'Too many.' })), entered: true });
    await u.live.advance(6); ok(u.has('view', 'ncb', LIVE_COPY.editRate), 'editRate'); eq(lastClock(u).enabled, true);
    const v = await harness({ mock: failOnce(createMockLive(), /\/advance$/, jsonAnswer(401, { error: 'unauthorized', message: 'No.' })), entered: true });
    const n1 = count(v, 'view', 'ncb'); await v.live.advance(6); await settle(); eq([count(v, 'view', 'ncb') - n1, offlineCount(v), lastClock(v).enabled, v.live.sessionId !== null], [0, 0, true, true], 'a 401: nothing said, no card, the session stays');
    t.live.close(); u.live.close(); v.live.close();
  });

  await check('reset · FRESH_START, the room from the answer, disabled while it is out', async () => {
    const t = await harness({ entered: true });
    await t.live.edit(SOIL_EDIT, 12); await settle();
    const p = t.live.reset(); eq(lastControls(t).enabled, false, 'disabled at once'); eq(lastClock(t).reason, null, 'no action reason for a reset');
    await p; eq(t.store.get(SOIL_EDIT), 34, 'the post-setup room'); eq(t.find('view', 'ncb')[0], FRESH_START); eq(lastControls(t).enabled, true); eq(t.find('ui', 'status')[0], 'Live · 6 devices');
    t.live.close();
  });

  // ---- the chat: no request box, a disabled NCB terminal placeholder ----
  await check('terminal · live mode sends no text anywhere; the input bar is a disabled "Connect an NCB to chat here" placeholder', () => {
    const calls = [], chat = { esc: (s) => String(s), mount() {}, ncb: (t) => calls.push(['ncb', t]), button: () => new Promise(() => {}),
      live: (on, o) => calls.push(['live', on, o]), enableInput: (on) => calls.push(['enableInput', on]) };
    const view = createLiveView({ chat, scene: home });
    view.live(true);
    eq(calls, [['live', true, { placeholder: 'Connect an NCB to chat here', label: LIVE_COPY.terminalLabel }], ['enableInput', false]], 'the placeholder, and the input off');
    for (const k of ['planCard', 'checklist', 'endCard', 'failures', 'chips', 'planning', 'reading', 'sayDelta', 'summary', 'ruleLine', 'user', 'input']) ok(!(k in view), `no view.${k}`);
    for (const k of ['submit', 'setAutomation', 'removeAutomation', 'clearAutomations', 'automations']) ok(!(k in createLive({ scene: home, store: createStore(postSetup(home)), view, panel: {}, ui: { alive: () => true }, base: 'http://mock', fetch: () => Promise.reject(new Error('no')) })), `no live.${k}`);
    const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
    const chatSrc = read('../js/engine/chat.js'), main = read('../js/main.js'), mount = read('../js/custom/mount.js'), css = read('../css/app.css');
    ok(/enableInput\(on\) \{ setInput\(on && !form\.classList\.contains\('live'\)\); \}/.test(chatSrc), 'chat.js: the input never turns on while live');
    ok(/live\(on, \{ placeholder, label \} = \{\}\) \{\s*form\.classList\.toggle\('live', !!on\);\s*if \(on\) \{ setInput\(false\);/.test(chatSrc), 'chat.js: live(true) turns the input off');
    ok(/if \(live\?\.active\) return;/.test(main) && !/live\.submit|live\?\.submit/.test(main + mount), 'main.js and the custom page send no typed text to live');
    ok(/\.chat-input\.live::before \{ content: 'NCB';/.test(css) && /\.chat-input\.live\.off \{ display: flex; \}/.test(css), 'css: an NCB badge, and the placeholder stays on phones');
    for (const src of [main, mount]) ok(!/automations|whatif|planCard/.test(src), 'no automations, what-if or plan card on the live pages');
  });

  // ---- the live tools on a stand-in document ----
  const toolsRig = (opts = {}) => {
    const doc = fakeDoc(), root = doc.createElement('div'), slots = {}, runs = [], plants = [], other = [];
    for (const id of ['lamp', 'blinds', 'soil', 'pump', 'camera', 'thermostat', 'x']) slots[id] = doc.createElement('span');
    const tools = createLiveTools(root, { doc, slotFor: (id) => slots[id] ?? null, onRun: (...a) => runs.push(a), onPlant: (...a) => plants.push(a), onClearFaults: () => other.push('clear'), onReset: () => other.push('reset'), ...opts });
    return { doc, root, slots, tools, runs, plants, other };
  };
  const homeDevs = () => liveDevicesOf(HOME_DEVICES.map((d) => ({ ...d, status: 'online' })), home);
  const extra = { id: 'x', name: 'Test rig', status: 'online', faultModes: [], actions: [{ verb: 'go', name: 'go_x', kind: 'write', description: '<b>bold</b>', parameters: { type: 'object', properties: {
    mode: { type: 'string', enum: ['eco', 'boost'], default: 'boost' }, count: { type: 'integer' }, label: { type: 'string' }, ratio: { type: 'number', minimum: 0, maximum: 1 }, odd: { type: 'array' } }, required: ['mode'] } }] };

  await check('tools · action controls from the JSON schema: slider, switch, select, number and text fields, a bare button; a press runs with the args', () => {
    const r = toolsRig(), devs = homeDevs();
    r.tools.devices([...devs, extra]); r.tools.controls({ enabled: true, acting: null });
    const row = (id, verb) => r.slots[id].all('act').find((a) => a.dataset.verb === verb);
    const lamp = row('lamp', 'set_lamp'), range = lamp.one('ap-range');
    eq([range.type, range.min, range.max, range.step, range.value, lamp.one('ap-val').textContent], ['range', '0', '100', '1', '0', '0'], 'an integer with bounds: a slider from its minimum');
    eq(lamp.one('act-go').textContent, 'Set lamp'); eq(lamp.one('act-go').title, 'Set the floor lamp brightness from 0 (off) to 100.', 'its description as the title');
    range.value = '65'; range.oninput(); eq(lamp.one('ap-val').textContent, '65', 'the readout follows');
    lamp.one('act-go').click(); eq(r.runs.at(-1), ['lamp', 'set_lamp', { brightness: 65 }], 'a press runs with its args');
    const thermo = row('thermostat', 'set_thermostat').one('ap-range'); eq([thermo.min, thermo.max, thermo.step, thermo.value], ['10', '28', '0.5', '10'], 'a number: a finer step');
    const cam = row('camera', 'set_door_camera'), sw = cam.one('ap-sw');
    eq(sw.getAttribute('aria-checked'), 'false'); cam.one('act-go').click(); eq(r.runs.at(-1), ['camera', 'set_door_camera', { armed: false }], 'a boolean: a switch, off at first');
    sw.click(); eq(sw.getAttribute('aria-checked'), 'true'); cam.one('act-go').click(); eq(r.runs.at(-1), ['camera', 'set_door_camera', { armed: true }], 'switched on');
    eq(r.slots.pump.all('act').map((a) => [a.dataset.verb, a.one('act-go').textContent, !!a.one('act-params')]), [['run_pump', 'Run pump', true], ['stop_pump', 'Stop pump', false]], 'no params: just the button');
    row('pump', 'stop_pump').one('act-go').click(); eq(r.runs.at(-1), ['pump', 'stop_pump', {}]);
    const x = row('x', 'go'), sel = x.one('ap-sel');
    eq([sel.tags('option').map((o) => o.textContent), sel.value], [['eco', 'boost'], '1'], 'an enum: a select, at its default');
    eq([x.one('ap-num').type, x.one('ap-text').type, x.all('ap').length], ['number', 'text', 4], 'unbounded number, text, and no control for an array');
    sel.value = '0'; x.one('ap-num').value = '3'; x.one('ap-text').value = 'hi'; x.one('act-go').click();
    eq(r.runs.at(-1), ['x', 'go', { mode: 'eco', count: 3, label: 'hi', ratio: 0 }], 'every control\'s value');
    eq(x.one('act-go').title, '<b>bold</b>', 'server text as text');
    eq(actionLabel({ name: 'read_soil_sensor_2' }), 'Read soil sensor 2');
  });

  await check('tools · busy: every button disabled while one plays, its own says Running…; the result shows under it, red when it failed', () => {
    const r = toolsRig(); r.tools.devices(homeDevs());
    const gos = () => r.root.all('act-go').concat(...Object.values(r.slots).map((s) => s.all('act-go')));
    r.tools.controls({ enabled: false, acting: { id: 'lamp', verb: 'set_lamp' } });
    ok(gos().length === 7 && gos().every((b) => b.disabled), 'all seven action buttons disabled');
    const go = r.slots.lamp.one('act-go'); eq([go.textContent, go.getAttribute('aria-busy'), go.classList.contains('running')], [LIVE_COPY.running, 'true', true], 'the running one');
    go.click(); eq(r.runs, [], 'a disabled button runs nothing');
    ok(r.root.one('lt-go').disabled && r.root.one('lt-reset').disabled && r.root.one('lt-clear').disabled, 'Plant, Reset room and Clear faults too');
    r.tools.controls({ enabled: true, acting: null }); eq([go.textContent, go.disabled, go.hasAttribute('aria-busy')], ['Set lamp', false, false], 'back');
    const res = r.slots.lamp.one('act-res'); eq(res.hidden, true, 'no result yet');
    r.tools.result('lamp', 'set_lamp', { ok: true, text: 'confirmed' }); eq([res.textContent, res.hidden, res.classList.contains('bad')], ['confirmed', false, false]);
    r.tools.result('lamp', 'set_lamp', { ok: false, text: 'not responding' }); eq([res.textContent, res.classList.contains('bad')], ['not responding', true]);
    r.tools.devices(null); eq(r.slots.lamp.children.length, 0, 'null: the cards lose their controls');
  });

  await check('tools · faults: devices that can fail, their own modes; Plant; the planted list; Clear only with something planted; Reset', () => {
    const r = toolsRig(); r.tools.devices(homeDevs()); r.tools.controls({ enabled: true, acting: null }); r.tools.faults([]);
    const dev = r.root.one('lt-dev'), mode = r.root.one('lt-mode');
    eq(dev.tags('option').map((o) => [o.value, o.textContent]), [['lamp', 'Floor lamp'], ['blinds', 'Blinds'], ['soil', 'Soil sensor'], ['pump', 'Water pump'], ['camera', 'Door camera'], ['thermostat', 'Thermostat']]);
    eq(mode.tags('option').map((o) => o.value), ['offline', 'stuck'], 'the lamp\'s modes');
    dev.value = 'soil'; dev.onchange(); eq(mode.tags('option').map((o) => o.textContent), ['offline', 'sensor detached', 'drift'], 'the soil sensor\'s, in words');
    mode.value = 'drift'; r.root.one('lt-go').click(); eq(r.plants, [['soil', 'drift']], 'Plant');
    eq([r.root.one('lt-clear').disabled, r.root.one('lt-none').hidden], [true, false], 'nothing planted: Clear off, the empty line');
    r.tools.faults([{ device: 'soil', mode: 'drift' }, { device: 'pump', mode: 'blocked' }]);
    eq(r.root.all('lt-fault').map((li) => li.textContent), ['Soil sensor · drift', 'Water pump · blocked'], 'the planted list');
    eq([r.root.one('lt-clear').disabled, r.root.one('lt-none').hidden, r.root.one('lt-count').textContent], [false, true, '2 faults · 0 events']);
    r.root.one('lt-clear').click(); r.root.one('lt-reset').click(); eq(r.other, ['clear', 'reset']);
    dev.value = 'camera'; dev.onchange(); eq(mode.tags('option').map((o) => o.value), ['offline'], 'the camera can only go offline');
    r.tools.show(true); eq(r.root.hidden, false); r.tools.show(false); eq(r.root.hidden, true);
  });

  await check('tools · the event log: newest last, capped, cleared by null; the head counts; folded on phones', () => {
    const r = toolsRig({ maxLines: 5 });
    for (let i = 1; i <= 7; i++) r.tools.log({ kind: i % 2 ? 'state' : 'result', text: `line ${i}`, ok: i !== 4, src: 'action' });
    eq(r.tools.lines, ['line 3', 'line 4', 'line 5', 'line 6', 'line 7'], 'the last five');
    const li = r.root.all('lt-line')[1]; eq([li.dataset.kind, li.dataset.ok, li.dataset.src], ['result', 'false', 'action']);
    eq([r.root.one('lt-empty').hidden, r.root.one('lt-count').textContent], [true, '0 faults · 7 events']);
    r.tools.log({ kind: 'call', text: '<img src=x onerror=1>' }); eq(r.tools.lines.at(-1), '<img src=x onerror=1>', 'text, never HTML');
    r.tools.log(null); eq([r.tools.lines, r.root.one('lt-empty').hidden, r.root.one('lt-count').textContent], [[], false, '0 faults · 0 events'], 'a fresh log');
    eq([r.tools.isOpen, r.root.one('lt-body').hidden], [true, false], 'open by default');
    const f = toolsRig({ folded: true }); eq([f.tools.isOpen, f.root.one('lt-body').hidden, f.root.one('lt-head').getAttribute('aria-expanded')], [false, true, 'false'], 'folded');
    f.root.one('lt-head').click(); eq([f.tools.isOpen, f.root.one('lt-body').hidden], [true, false], 'the head opens it');
  });

  // ---- watch a room (?watch) ----
  await check('watch · ?watch attaches to the newest live session of this scene in the server\'s list of all sessions; none → a room of its own', async () => {
    const mock = createMockLive({ scenes: ['home', 'custom'] }), api = apiOf(mock);
    const a = (await api.createSession('home')).sessionId, b = (await api.createSession('home')).sessionId;
    await api.set(a, SOIL_EDIT, 40); // a: now the most recently active Home session
    await api.createSession('custom', { devices: [{ type: 'floor_lamp', id: 'floor_lamp' }] }); // newer still, another scene
    // GET sessions as a server that ignores ?scene= gives it: every live session, most recently active first
    const urls = [], all = { ...mock, fetch: (url, init) => { urls.push(String(url)); return mock.fetch(String(url).replace(/\/sessions\?scene=[^&]*$/, '/sessions'), init); } };
    const listed = (await (await all.fetch(`${BASE}sessions?scene=home`)).json()).sessions;
    eq(listed.map((x) => [x.sessionId === a ? 'a' : x.sessionId === b ? 'b' : 'custom', x.scene]), [['custom', 'custom'], ['a', 'home'], ['b', 'home']], 'every session, newest first');
    ok(listed.every((x) => typeof x.lastActivity === 'string'), 'each with its lastActivity');
    const t = await harness({ mock: all, watch: () => '' }), n0 = posts(mock).length;
    await t.live.open();
    eq([t.live.sessionId === a, posts(mock).length - n0, t.live.phase, offlineCount(t)], [true, 0, 'idle', 0], 'attached to a (no new session, no card)');
    ok(urls.some((u) => u.endsWith('/live/api/sessions?scene=home')), 'asked GET sessions?scene=home');
    eq(t.store.get(SOIL_EDIT), 40, 'its room'); ok(t.has('view', 'ncb', LIVE_COPY.watching), 'says so'); ok(!t.has('view', 'ncb', LIVE_COPY.intro(6)), 'not the intro');
    await waitFor(() => eventGets(mock).some((c) => c.path === `sessions/${a}/events`));
    eq(eventGets(mock).filter((c) => c.path === `sessions/${a}/events`).at(-1).query.after, '1', 'streams from the event after its room');
    ok(mock.calls.every((c) => !('authorization' in c.headers)), 'no Authorization header');
    t.live.close();
    const m2 = createMockLive(), u = await harness({ mock: m2, watch: () => '' }); await u.live.open();
    ok(u.has('view', 'ncb', LIVE_COPY.nothingToWatch), 'nothing to watch: says so'); eq([posts(m2).length, u.live.phase], [1, 'idle'], 'and opens a room of its own'); u.live.close();
    const v = await harness({ mock: failOnce(createMockLive(), /\/sessions\?scene=/, jsonAnswer(500, { error: 'internal', message: 'Oops.' })), watch: () => '' }); await v.live.open();
    ok(v.has('view', 'ncb', LIVE_COPY.nothingToWatch), 'the list failed: the same'); eq(v.live.phase, 'idle'); v.live.close();
  });

  // ---- guards ----
  await check('guard · open() twice at once → one session', async () => {
    const t = await harness(); await Promise.all([t.live.open(), t.live.open()]);
    eq(posts(t.mock).length, 1, 'one POST sessions'); eq(count(t, 'view', 'live'), 1, 'entered once'); eq(t.live.phase, 'idle');
    t.live.close();
  });

  await check('guard · server down mid-session → lost card; reconnect resumes from lastId; a stale Reconnect after exit opens no stream', async () => {
    const t = await harness({ entered: true }), sid = t.live.sessionId;
    await t.live.edit(SOIL_EDIT, 20); await settle();
    t.mock.set({ mode: 'down' }); t.mock.drop(sid);
    await waitFor(() => t.has('view', 'lost')); eq(t.live.phase, 'idle');
    const [reconnect] = t.find('view', 'lost'); t.mock.set({ mode: 'json' });
    const gets = eventGets(t.mock).length; reconnect();
    await waitFor(() => eventGets(t.mock).length > gets); eq(eventGets(t.mock).at(-1).query.after, '1', 'resumes after the last id seen');
    t.live.close();
    const u = await harness({ entered: true }), usid = u.live.sessionId;
    u.mock.set({ mode: 'down' }); u.mock.drop(usid); await waitFor(() => u.has('view', 'lost'));
    const [again] = u.find('view', 'lost'); u.mock.set({ mode: 'json' });
    u.live.exit(); eq([u.live.phase, u.live.sessionId], ['off', null], 'session forgotten');
    const g = eventGets(u.mock).length; again(); await sleep(60000);
    eq(eventGets(u.mock).length, g, 'no GET from the stale button'); eq(offlineCount(u), 0);
    u.live.close();
  });

  await check('guard · available follows POST sessions live_off and health in open()', async () => {
    const t = await harness(); eq(await t.live.probe(), true); t.mock.set({ off: 'live_off' }); await t.live.open();
    eq(t.live.available, false, 'live_off');
    const v = await harness(); eq(await v.live.probe(), true); v.mock.set({ liveEnabled: false }); await v.live.open();
    eq(v.find('view', 'offline')[0], { text: LIVE_COPY.backendOff }); eq(v.live.available, false, 'health off in open()');
    const u = await harness({ mock: createMockLive({ liveEnabled: false }) }); eq(await u.live.probe(), false); u.mock.set({ liveEnabled: true });
    await u.live.open(); eq(u.live.available, true, 'health back on in open()'); u.live.close();
  });

  await check('guard · unsafe store paths are skipped; a device list for another room is filtered', async () => {
    const t = await harness({ entered: true }), sid = t.live.sessionId;
    try {
      for (const path of ['__proto__.polluted', 'nosuch.x', 'lamp', 'constructor.prototype.x']) t.mock.push(sid, 'state', { path, value: 1, ms: 0 });
      t.mock.push(sid, 'state', { path: 'lamp.brightness', value: 0.6, ms: 0 });
      await waitFor(() => t.store.get('lamp.brightness') === 0.6);
      eq(({}).polluted, undefined, 'state: no prototype write'); eq(t.store.get('nosuch'), undefined); ok(typeof t.store.get('lamp') === 'object', 'a path needs a field');
    } finally { delete Object.prototype.polluted; }
    eq(liveDevicesOf([{ id: 'lamp', actions: [{ verb: 'set_lamp', parameters: 'nope' }, { name: 'no verb' }] }, { id: 'lamp' }, { id: 'kettle', actions: [] }, null, 'x'], home),
      [{ id: 'lamp', type: null, name: 'Floor lamp', status: 'online', actions: [{ verb: 'set_lamp', name: 'set_lamp', kind: 'write', description: '', parameters: { type: 'object', properties: {} } }], faultModes: [] }],
      'only this scene\'s devices, once each; an action needs a verb; bad parameters read as none');
    t.live.close();
  });

  await check('guard · close() ends active; nothing posts after it', async () => {
    const t = await harness({ entered: true }); eq(t.live.active, true); t.live.close(); eq(t.live.active, false);
    const n = t.mock.calls.length;
    await t.live.run('lamp', 'set_lamp', { brightness: 1 }); await t.live.plantFault('lamp', 'offline'); await t.live.reset(); await t.live.edit(SOIL_EDIT, 3); await t.live.advance(1);
    eq(t.mock.calls.length, n, 'nothing after close');
  });

  await check('store · a 0 ms tween replaces a running tween on its path', async () => {
    const s = createStore({ a: { x: 0 } }); stores.add(s);
    s.tween('a.x', 10, 1000); await sleep(100); ok(s.get('a.x') > 0 && s.get('a.x') < 10, 'tweening');
    s.tween('a.x', 5, 0); eq(s.get('a.x'), 5, 'jumps at once'); await sleep(2000); eq(s.get('a.x'), 5, 'the old tween is gone');
  });

  // ---- the direct Go live entry ----
  await check('live entry · announced availability: probe, open, exit, live_off', async () => {
    const avail = (t) => t.log.filter((e) => e[0] === 'ui' && e[1] === 'availability').map((e) => e[2]);
    const t = await harness(); await t.live.probe(); eq(avail(t), [{ available: true, active: false }], 'probe: available, not open');
    await t.live.probe(); eq(avail(t).length, 1, 'no repeat while nothing changed');
    const opening = t.live.open(); eq(avail(t).at(-1), { available: true, active: true }, 'open: active at once'); await opening;
    t.live.exit(); eq(avail(t).at(-1), { available: true, active: false }, 'exit: not open again');
    ok(t.order('ui', 'offerGuided') < t.log.findLastIndex((e) => e[1] === 'availability'), 'after the guided requests are back');
    const u = await harness({ mock: createMockLive({ liveEnabled: false }) }); await u.live.probe(); eq(avail(u), [{ available: false, active: false }], 'live off: not available');
    const v = await harness(); await v.live.probe(); v.mock.set({ off: 'live_off' }); await v.live.open();
    eq(avail(v).at(-1), { available: false, active: false }, 'switched off: not available any more');
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
  await check('live entry · the header button shows in every scene while live mode is not open, asking nothing first; hidden without an API base', async () => {
    const none = await entryRig({ live: null }); none.e.sync(); eq(none.shown, [false], 'no API base (no live): hidden'); await none.e.open(); eq(none.order, [], 'and pressing it does nothing');
    const { t, e, shown } = await entryRig(); e.sync(); eq(shown, [true], 'shown at once'); eq(t.mock.calls.length, 0, 'and no request was made for it');
    const off = await entryRig({ mock: createMockLive({ scenes: ['lab'] }) }); off.e.sync(); eq(off.shown.at(-1), true, 'a scene the server does not run: shown too');
    await off.e.open(); eq(off.t.find('view', 'offline')[0], { text: LIVE_COPY.sceneOff }, 'pressing it there says why'); eq(off.shown.at(-1), false, 'hidden under its card');
    off.t.lastOffline.back(); eq(off.shown.at(-1), true, 'Back: shown again');
    const opening = t.live.open(); eq(shown.at(-1), false, 'live opening: hidden');
    await opening; eq(shown.at(-1), false, 'in live mode: hidden'); eq(t.live.phase, 'idle');
    t.live.exit(); eq(shown.at(-1), true, 'back to guided: shown again');
    t.live.close(); off.t.live.close();
  });

  await check('live entry · pressing it stops the guided flow first, then opens live mode (one at a time)', async () => {
    const { t, e, shown, order } = await entryRig(); await t.live.probe();
    const p = e.open(); eq(shown.at(-1), false, 'hidden at once'); const q = e.open();
    await p; await q;
    eq(order, ['stop', 'stopped', 'open'], 'stop() resolves before live.open(); a second press while opening does nothing');
    eq([t.live.phase, t.live.active, shown.at(-1), offlineCount(t)], ['idle', true, false, 0], 'straight into live mode (no code asked), the button hidden');
    await e.open(); eq(order.length, 3, 'pressing it in live mode does nothing'); t.live.close();
  });

  await check('pages · main.js and the custom page wire the live tools into the side column and the ui hooks; nothing asks for a code', () => {
    const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
    const main = read('../js/main.js'), mount = read('../js/custom/mount.js'), liveui = read('../js/custom/liveui.js'), ccss = read('../css/custom.css');
    ok(/<div class="panel" id="panel"><\/div>\s*<div class="ltools" id="ltools" hidden><\/div>\s*<div class="chat" id="chat"><\/div>/.test(main), 'main.js: #ltools between #panel and #chat, hidden');
    ok(/<div class="panel" id="panel" hidden><\/div>\s*<div class="ltools" id="ltools" hidden><\/div>\s*<div class="chat" id="chat"><\/div>/.test(mount), 'custom page: the same');
    ok(/tools = base \? createLiveTools\(/.test(main) && /slotFor: \(id\) => panel\.slot\(id\)/.test(main), 'main.js: no tools without an API base; card slots from the panel');
    for (const hook of ['devices: (list) => tools?.devices(list)', 'controls: (c) => tools?.controls(c)', 'actionResult: (id, verb, r) => tools?.result(id, verb, r)', 'faults: (list) => tools?.faults(list)', 'log: (line) => tools?.log(line)']) {
      ok(main.includes(hook), `main.js: ${hook}`); ok(liveui.includes(hook), `liveui.js: ${hook}`);
    }
    ok(/tools\?\.show\(on\); if \(!on\) panel\.clearSlots\(\);/.test(main), 'main.js: the tools show with editing, the card controls go with it');
    ok(/slotFor: \(id\) => wiring\.panel\?\.slot\(id\) \?\? null/.test(mount), 'custom page: slots from the current session\'s panel');
    ok(/\.stage\.custom:not\(\[data-mode="run"\]\) \.ltools \{ display: none; \}/.test(ccss), 'custom.css: run mode only');
    ok(/<button class="btn small primary live-top" id="liveTop" type="button"[^>]* hidden>/.test(main), 'main.js: the Go live header button is still there, hidden at first');
    // Live mode opens the room straight away: no code card, no application form, nothing stored or sent for a code.
    const chatSrc = read('../js/engine/livechat.js'), liveSrc = read('../js/engine/live.js'), apiSrc = read('../js/engine/liveapi.js'), sseSrc = read('../js/engine/sse.js');
    ok(!/<form|<input|<select|<textarea/.test(chatSrc), 'livechat.js: no form or field (the offline card has the follow links and Back only)');
    for (const [name, src] of [['main.js', main], ['mount.js', mount], ['live.js', liveSrc], ['liveapi.js', apiSrc], ['livechat.js', chatSrc], ['sse.js', sseSrc]]) {
      ok(!/headers\.Authorization|Authorization:|Bearer |access\/check|liveCode|getCode|codeStore|sessionStorage|invite/i.test(src), `${name}: nothing of the code gate left`);
    }
    ok(!/localStorage/.test(liveSrc + apiSrc + chatSrc + sseSrc), 'the live client keeps nothing in storage');
    ok(!existsSync(new URL('../js/custom/gate.js', import.meta.url)), 'js/custom/gate.js is gone');
    ok(/controller\.ready\(\)/.test(mount) && !/passGate|gate\.js/.test(mount), 'custom page: build mode opens once /health allows it, no gate');
  });
}
