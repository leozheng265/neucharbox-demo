// Live demo: the controller (wire contract: the NeuCharBox Live module's docs/live-api-contract.md, interface-only
// version of 2026-11-24). Access (invite code), session and room; then the room's devices and their actions, hand
// edits, the clock, fault planting, reset, and the event stream (event → store / panel / event log). No model runs on
// the server any more: nothing here sends text anywhere. The chat's input bar is a disabled placeholder for a future NCB
// terminal (js/engine/livechat.js). The invite code goes in storage and request headers only, never in a URL, a log
// or the page.
import { createLiveApi, LiveError } from './liveapi.js';
import { openEventStream } from './sse.js';
import { devicesOf } from './whatif.js';
import { FRESH_START } from './flow.js';
import { editsFor } from './controls.js';

const FAULT_WORDS = { offline: 'offline', stuck: 'stuck', blocked: 'blocked', sensorDetached: 'sensor detached', drift: 'drift' };
export const LIVE_COPY = {
  button: 'Go live: run these devices yourself', // the guided end cards' live button
  accessIntro: 'Live mode is invite-only. Enter your code, or apply.',
  offline: 'Live mode is offline right now. Try the guided requests, or follow NeuCharBox for updates.',
  // why a live button could not open live mode (whyOff below)
  backendDown: (base) => `NCF backend not found at ${base}. Start your NCF site with the NeuCharBox Live module, then press Go live again.`,
  backendOff: 'Your NCF backend is running, but live mode is off there. Open NeuCharBox Live, Settings in its admin to see what is missing.',
  sceneOff: "Your NCF backend is running, but this scene isn't live there yet. Today live mode runs the Home scene and Build your own.",
  rate: 'Too many tries from here. Wait a minute and try again.',
  sessionsBusy: 'Live mode is busy right now. Try again in a few minutes.',
  badCode: "That code didn't work. Check it, or apply below.",
  savedCodeGone: 'Your saved code no longer works. Enter a new one, or apply below.',
  applyEmailUse: 'We use your email only to send your invite.',
  applied: 'Thanks. We read every application and send codes by email.',
  applyRate: 'Too many applications from this connection. Try again in an hour.',
  back: 'Back to guided requests',
  watching: 'Watching the room your NeuCharBox drives: what the box does to these devices shows here as it happens. You can still change values by hand, move the clock, or plant a fault.',
  nothingToWatch: 'No room to watch yet (start the virtual devices first), so this is a new room of your own.',
  intro: (n) => `Live mode is on: ${n === 1 ? 'this device runs' : `these ${n} devices run`} on the live server. Each card has its device's own actions. Change values by hand, move the clock, or plant a fault, and watch the event log.`,
  // the chat's input bar in live mode: where a future NCB terminal goes (disabled until one is connected)
  terminal: 'Connect an NCB to chat here',
  terminalLabel: 'NCB terminal, not connected yet',
  error: 'Something went wrong on the live server, not with a device. Try again.',
  badRoom: "This room couldn't be set up. Go back to building and try again.",
  devicesFailed: "The live server didn't send this room's actions. The cards still show its values; try Reset room.",
  lost: 'I lost the connection to the live server. The room shows the last thing I heard.',
  reconnect: 'Reconnect',
  timedOut: 'Your live session timed out, so I started a fresh room.',
  limitCode: 'All of the live sessions for this code are in use. Close one and try again.',
  statusIdle: (n) => `Live · ${n} ${n === 1 ? 'device' : 'devices'}`,
  editRejected: "That change didn't go through, so the card is back to the room's value.",
  editRate: "That's a lot of changes at once. Slow down a little.",
  // device actions
  actionBusy: 'Something else is still playing in the room. Try again when it is done.',
  actionGone: "That action isn't on this device any more.",
  actionBadValue: (detail) => (detail ? `Not sent: ${String(detail).replace(/[\s.]+$/, '')}.` : "Not sent: that value isn't allowed."),
  actionFailed: "That action didn't reach the device. Try again.",
  running: 'Running…',
  // faults
  faultsTitle: 'Faults',
  faultDevice: 'Device',
  faultMode: 'Fault',
  faultWord: (mode) => FAULT_WORDS[mode] ?? String(mode ?? ''),
  plant: 'Plant',
  clearFaults: 'Clear faults',
  noFaults: 'No faults planted.',
  faultRejected: "That fault couldn't be planted.",
  faultsClearRejected: "The faults couldn't be cleared. Try again.",
  reset: 'Reset room',
  // the event log
  logTitle: 'Event log',
  logEmpty: 'What happens in the room shows here.',
  toolsTitle: 'Faults and event log',
  toolsCount: (faults, events) => `${faults === 1 ? '1 fault' : `${faults} faults`} · ${events === 1 ? '1 event' : `${events} events`}`,
  // the clock
  clockBusy: 'The clock moves again when this action is done.',
  clockPlus1: '+1 h',
  clockPlus6: '+6 h',
  clockSet: 'Set time…',
  clockGo: 'Go',
  // the scene header's direct entry (js/engine/liveentry.js)
  headerButton: 'Go live',
  headerButtonTitle: "Run this room's devices on the live server",
};

export const normalizeCode = (text) => String(text ?? '').toUpperCase().replace(/\s+/g, '');

// The saved invite code. Every storage access is inside try/catch (Safari with site data blocked throws even on the
// property read), and a throwing store behaves as empty.
export function codeStore(storage) {
  const KEY = 'ncb.liveCode';
  const use = (f) => { try { return f(storage ?? globalThis.localStorage); } catch { return null; } };
  return {
    get: () => { const v = use((s) => s.getItem(KEY)); return typeof v === 'string' && v ? v : null; },
    set: (code) => { use((s) => s.setItem(KEY, String(code))); },
    clear: () => { use((s) => s.removeItem(KEY)); },
  };
}

const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');
const FIELD = /^[A-Za-z_$][\w$]*$/, NOT_FIELDS = new Set(['__proto__', 'constructor', 'prototype']);
const okOf = (d) => d.ok === true || (d.ok == null && d.outcome !== 'failed'); // a missing ok is never success when the outcome failed

// An action's button text: its name in words ("set_lamp" → "Set lamp", "read_soil_sensor_2" → "Read soil sensor 2").
export const actionLabel = (a) => { const t = str(a?.name || a?.verb).replace(/[_\s]+/g, ' ').trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; };

// GET devices' answer → the devices this scene has cards for, in the server's order. An action needs a verb; an
// action's parameters are a JSON Schema object (anything else reads as "no parameters").
export function liveDevicesOf(list, scene) {
  const known = new Set(devicesOf(scene)), seen = new Set();
  return (Array.isArray(list) ? list : []).filter((d) => isObj(d) && typeof d.id === 'string' && known.has(d.id) && !seen.has(d.id) && seen.add(d.id)).map((d) => ({
    id: d.id, type: typeof d.type === 'string' ? d.type : null, name: str(d.name) || scene.devices[d.id].name, status: str(d.status) || 'online',
    actions: (Array.isArray(d.actions) ? d.actions : []).filter((a) => isObj(a) && typeof a.verb === 'string' && a.verb).map((a) => ({
      verb: a.verb, name: str(a.name) || a.verb, kind: ['read', 'write', 'safe'].includes(String(a.kind).toLowerCase()) ? String(a.kind).toLowerCase() : 'write',
      description: str(a.description), parameters: isObj(a.parameters) ? a.parameters : { type: 'object', properties: {} } })),
    faultModes: (Array.isArray(d.faultModes) ? d.faultModes : []).filter((m) => typeof m === 'string' && m),
  }));
}

// One stream event as a short line for the event log: { kind, text, ok, src } or null (a kind the log doesn't show).
const short = (v) => (finite(v) ? String(Math.round(v * 100) / 100) : typeof v === 'boolean' ? (v ? 'on' : 'off') : v == null ? '–' : String(v));
export function eventLine(scene, kind, d) {
  if (!isObj(d)) return null;
  const name = (id) => scene.devices?.[id]?.name ?? str(id);
  const line = (text, ok = true) => ({ kind, text, ok, src: str(d.src) || null });
  switch (kind) {
    case 'state': {
      if (typeof d.path !== 'string') return null;
      const [id, ...f] = d.path.split('.');
      return line(`${name(id)} · ${f.join('.') || '?'} → ${short(d.value)}`, !(f.join('.') === 'status' && d.value === 'fault'));
    }
    case 'world': {
      const bits = [];
      if (finite(d.air?.temp)) bits.push(`${short(d.air.temp)} °C inside`);
      if (finite(d.light?.lux)) bits.push(`${short(d.light.lux)} lux`);
      if (finite(d.outdoor?.temp)) bits.push(`${short(d.outdoor.temp)} °C outside`);
      if (finite(d.soil?.pot)) bits.push(`soil ${short(d.soil.pot)}`);
      if (finite(d.power?.watts)) bits.push(`${short(d.power.watts)} W`);
      return line(`World · ${bits.length ? bits.join(' · ') : 'changed'}`);
    }
    case 'call': return line(`▶ ${str(d.label) || `${name(d.device)} · ${str(d.action)}`}`);
    case 'result': { const good = okOf(d); return line(`${good ? '✓' : '✕'} ${name(d.device)} · ${str(d.text) || str(d.outcome) || (good ? 'done' : 'failed')}`, good); }
    case 'fault': return line(`⚠ ${name(d.device)} · ${str(d.text) || 'not responding'}`, false);
    case 'clock': return typeof d.label === 'string' ? line(`🕓 ${d.label}`) : null;
    case 'timeline': { const good = okOf(d); return line(`${str(d.at) ? `${d.at} · ` : ''}${d.kind === 'notify' ? '📩 ' : ''}${str(d.text)}${good ? '' : ' ✕'}`, good); }
    default: return null;
  }
}

// What the offline card says after a /health that did not allow live mode for this scene: no NCF backend at the API
// base (nothing answered, or not the live API), a backend with live off, or one that does not list the scene.
export function whyOff(h, sceneId, base) {
  if (!h?.ok) return LIVE_COPY.backendDown(base);
  if (!h.liveEnabled) return LIVE_COPY.backendOff;
  return h.scenes?.includes(sceneId) ? LIVE_COPY.offline : LIVE_COPY.sceneOff;
}

// ui hooks the page gives (every one optional unless the code below calls it bare): alive(), status(text, bad),
// beats(spec), track(on), resetRoom(), baseline(), editing(on), clock({ label, enabled, reason }), offerGuided(heading),
// availability({ available, active }), and the live tools (js/engine/livetools.js): devices(list | null),
// controls({ enabled, acting }), actionResult(id, verb, { ok, text }), faults(list | null), log(line | null).
export function createLive({ scene, store, view, panel, ui, base, fetch: doFetch = globalThis.fetch, codes = codeStore(), now = () => performance.now(), sessionExtra = () => ({}), watch = watchRequest }) {
  let code = null;            // the code for this visit (kept here too, so a blocked store still works)
  const api = createLiveApi({ base, fetch: doFetch, getCode: () => code ?? codes.get() });
  let closed = false, active = false, available = false, phase = 'off', advancing = false, clockLabel = null, lastRateAt = -Infinity;
  let sessionId = null, stream = null, accessHandle = null, lastClockAt = 0, announced = null;
  let acting = null;          // the action playing: { id, verb } until its POST answers
  let liveDevices = [];       // the room's devices as GET devices sent them (liveDevicesOf)
  let faults = [];            // every planted fault, as the server last listed them: [{ device, mode }]
  const labels = new Map();   // callId → the call's label, for the status line when its result comes
  const known = new Map();    // path → the room's last value for it (what a refused edit goes back to)
  const busy = new Set();     // the ids marked 'busy' (WORKING): a result or a lost session clears only these
  const devices = devicesOf(scene), n = devices.length;

  const dead = () => closed || !ui.alive();
  const gone = () => dead() || !active;
  const status = (e) => (e instanceof LiveError ? e.status : 0);
  const kindOf = (e) => (e instanceof LiveError ? e.kind : null);
  const isDevice = (id) => typeof id === 'string' && devices.includes(id);
  const mark = (id, kind) => { if (kind === 'busy') busy.add(id); else busy.delete(id); panel.mark(id, kind); };
  // Actions, faults, reset and the clock: only with a session, between other actions and advances (the server answers
  // 409 busy meanwhile). Hand edits are always allowed (the server queues one made while an action plays).
  const free = () => phase === 'idle' && !advancing && !acting && !!sessionId;
  const controlsUi = () => {
    if (dead()) return;
    ui.clock?.({ label: clockLabel, enabled: free(), reason: acting && sessionId ? LIVE_COPY.clockBusy : null });
    ui.controls?.({ enabled: free(), acting: acting ? { ...acting } : null });
  };
  const setPhase = (p) => { phase = p; controlsUi(); };
  // A store path the server may write: <slice>.<field…> on a slice the store has, with no prototype keys.
  const writable = (path) => {
    if (typeof path !== 'string') return false;
    const ks = path.split('.');
    return ks.length > 1 && Object.prototype.hasOwnProperty.call(store.state, ks[0]) && ks.every((k) => FIELD.test(k) && !NOT_FIELDS.has(k));
  };
  // The scene header's Go live button follows this (js/engine/liveentry.js): live mode available here, and open or not.
  const announce = () => { if (dead()) return; const k = `${available}|${active}`; if (k === announced) return; announced = k; ui.availability?.({ available, active }); };
  const idleStatus = () => ui.status(LIVE_COPY.statusIdle(n));
  const showFaults = (list) => { faults = list; if (!dead()) ui.faults?.(list && list.map((f) => ({ ...f }))); };
  const faultsOf = (list) => (Array.isArray(list) ? list : []).filter((f) => isObj(f) && isDevice(f.device)).map((f) => ({ device: f.device, mode: str(f.mode) || 'offline' }));

  async function probe() {
    try {
      const h = await api.health();
      available = !!(h.ok && h.liveEnabled && h.scenes.includes(scene.id));
    } catch { available = false; }
    announce();
    return available;
  }

  // ---- room ----
  function setClock(c, { instant = false, status: line = true } = {}) {
    if (!isObj(c) || !finite(c.hour)) return;
    const cur = Number(store.get('env.hour')) || 0, t = now();
    const ms = instant || c.hour < cur ? 0 : Math.min(800, Math.max(0, t - lastClockAt));
    lastClockAt = t; store.tween('env.hour', c.hour, ms);
    if (typeof c.label === 'string') { clockLabel = c.label; controlsUi(); }
    if (!instant && line && typeof c.label === 'string') ui.status(c.label);
  }

  // The server's whole room, merged per field onto the post-setup snapshot (room-only fields keep their values).
  function applyRoom(state, clock) {
    const snap = ui.baseline();
    if (snap) store.restore(snap);
    ui.resetRoom(); known.clear();
    if (isObj(state)) {
      for (const [id, slice] of Object.entries(state)) {
        if (isObj(slice)) for (const [field, value] of Object.entries(slice)) { const p = `${id}.${field}`; if (writable(p)) { store.set(p, value); known.set(p, value); } }
      }
    }
    setClock(clock, { instant: true });
    for (const id of devices) mark(id, null);
  }

  // ---- the event stream ----
  // Every event: a line in the event log, then the store, the panel and the status line. No event carries a request id
  // any more; an action's events (src "action"), a hand edit's or an advance's (src "edit") and world updates all apply.
  function onEvent(ev) {
    const d = ev?.data;
    if (gone() || !isObj(d)) return;
    const line = eventLine(scene, ev.event, d);
    if (line) ui.log?.(line);
    switch (ev.event) {
      case 'state': applyState(d); break;
      case 'clock': setClock(d, { status: false }); break;
      case 'call':
        if (isDevice(d.device)) { mark(d.device, 'busy'); panel.reveal?.([d.device]); }
        if (typeof d.label === 'string') { ui.status(d.label); if (typeof d.callId === 'string') labels.set(d.callId, d.label); }
        break;
      case 'result': {
        const lab = labels.get(d.callId); labels.delete(d.callId);
        if (lab != null) ui.status(`${lab} · ${str(d.text)}`, !okOf(d)); // the call's label with its outcome (red when it failed)
        if (isDevice(d.device)) mark(d.device, okOf(d) && (d.outcome === 'confirmed' || d.outcome === 'made_safe') ? 'just' : null);
        break;
      }
      case 'fault': // the server's text first: the card reads it once the status turns 'fault'
        if (!isDevice(d.device)) break;
        store.set(`${d.device}.faultNote`, str(d.text)); mark(d.device, null);
        break;
      default: break; // world and timeline: the event log only
    }
  }

  function applyState(d) {
    if (!writable(d.path)) return;
    known.set(d.path, d.value);
    // a number always goes through tween (0 ms: a jump that also drops a running tween, which a plain set would lose to)
    if (finite(d.value)) store.tween(d.path, d.value, finite(d.ms) && d.ms > 0 ? d.ms : 0); else store.set(d.path, d.value);
  }

  // The rate message at most once per 10 s, on the clock the rest of this file uses.
  const sayRate = () => { const t = now(); if (t - lastRateAt >= 10000) { lastRateAt = t; view.ncb(LIVE_COPY.editRate); } };
  // A refusal every route shares: true when handled here (a lost code, an expired session, the rate limit).
  function common(e) {
    if (status(e) === 401) { unauthorized(); return true; }
    if (kindOf(e) === 'no_session') { regenerate(); return true; }
    if (kindOf(e) === 'rate') { sayRate(); return true; }
    return false;
  }

  // ---- device actions ----
  // POST …/devices/{id}/actions/{verb} with the action's args. One at a time: every action button, the fault tools, reset
  // and the clock wait until it answers (once its frames have played). Its card shows WORKING meanwhile (its `call`
  // event marks it too) and the answer's text under the action's button.
  async function run(id, verb, args = {}) {
    const dev = liveDevices.find((d) => d.id === id);
    if (gone() || !free() || !dev || !dev.actions.some((a) => a.verb === verb)) return;
    const sid = sessionId;
    acting = { id, verb }; controlsUi();
    mark(id, 'busy'); ui.track?.(true);
    let r = null, err = null;
    try { r = await api.action(sid, id, verb, isObj(args) ? args : {}); } catch (e) { err = e; }
    if (sid !== sessionId || gone()) return;
    acting = null;
    if (!err) {
      const good = okOf(r ?? {});
      if (busy.has(id)) mark(id, good && (r?.outcome === 'confirmed' || r?.outcome === 'made_safe') ? 'just' : null); // its result event may still be on its way
      ui.actionResult?.(id, verb, { ok: good, text: str(r?.text) || str(r?.outcome) || (good ? 'done' : 'failed'), outcome: str(r?.outcome) });
    } else {
      if (busy.has(id)) mark(id, null);
      if (!common(err)) {
        const k = kindOf(err);
        const text = k === 'busy' ? LIVE_COPY.actionBusy : k === 'bad_value' ? LIVE_COPY.actionBadValue(err.detail) : k === 'no_action' || k === 'no_device' ? LIVE_COPY.actionGone : LIVE_COPY.actionFailed;
        ui.actionResult?.(id, verb, { ok: false, text });
      }
    }
    ui.track?.(false); controlsUi();
  }

  // ---- faults ----
  async function plantFault(device, mode) {
    const dev = liveDevices.find((d) => d.id === device);
    if (gone() || !free() || !dev || (mode != null && !dev.faultModes.includes(mode))) return;
    const sid = sessionId;
    setPhase('busy');
    try {
      const r = await api.plantFault(sid, device, mode ?? undefined);
      if (sid === sessionId && !gone()) showFaults(faultsOf(r?.faults));
    } catch (e) { if (sid === sessionId && !gone() && !common(e)) view.ncb(LIVE_COPY.faultRejected); }
    if (sid === sessionId && !gone() && phase === 'busy') setPhase('idle');
  }
  async function clearFaults() {
    if (gone() || !free()) return;
    const sid = sessionId;
    setPhase('busy');
    try {
      const r = await api.clearFaults(sid);
      if (sid === sessionId && !gone()) showFaults(faultsOf(r?.faults));
    } catch (e) { if (sid === sessionId && !gone() && !common(e)) view.ncb(LIVE_COPY.faultsClearRejected); }
    if (sid === sessionId && !gone() && phase === 'busy') setPhase('idle');
  }

  // ---- reset: the room back to right after setup, every fault cleared. reset emits no event (contract), so its answer
  // is the only source of the room. ----
  async function resetRoom() {
    if (gone() || !free()) return;
    const sid = sessionId;
    setPhase('busy');
    let r;
    try {
      r = await api.reset(sid);
      if (!isObj(r) || !isObj(r.state)) throw new LiveError(200, 'bad_response');
    } catch (e) {
      if (sid !== sessionId || gone()) return;
      if (status(e) === 401) return unauthorized();
      if (kindOf(e) === 'no_session') return regenerate();
      if (kindOf(e) === 'rate') sayRate(); else view.ncb(LIVE_COPY.error);
      setPhase('idle');
      return;
    }
    if (sid !== sessionId || gone()) return;
    applyRoom(r.state, r.clock);
    showFaults([]);
    view.ncb(FRESH_START); idleStatus(); setPhase('idle');
  }

  // ---- hand edits and the clock ----
  const editable = (path) => devices.some((id) => editsFor(id, scene.devices[id], store.state[id]).some((e) => e.path === path));

  async function edit(path, value) {
    if (gone() || !sessionId || !writable(path) || !editable(path)) return;
    const sid = sessionId, prev = store.get(path);
    store.tween(path, value, 0); // at once, and a running tween on the path is dropped
    // Back to the room's value, unless a later edit of the card has moved it on meanwhile.
    const rollback = () => { if (store.get(path) === value) { const back = known.has(path) ? known.get(path) : prev; if (finite(back)) store.tween(path, back, 0); else store.set(path, back); } };
    try { await api.set(sid, path, value); } catch (e) {
      if (gone() || sid !== sessionId) return;
      if (status(e) === 401) return unauthorized();
      if (kindOf(e) === 'no_session') return regenerate();
      rollback();
      if (kindOf(e) === 'rate') sayRate(); else view.ncb(LIVE_COPY.editRejected);
    }
  }

  async function advance(hours) {
    if (gone() || !free()) return;
    const sid = sessionId;
    advancing = true; controlsUi();
    try {
      const r = await api.advance(sid, hours);
      if (!gone() && sid === sessionId) setClock(r?.clock, { status: false });
    } catch (e) {
      if (gone() || sid !== sessionId) return;
      common(e); // a 409 busy says nothing: the buttons come back
    } finally {
      advancing = false; controlsUi();
    }
  }

  // ---- the stream's status ----
  function onStatus(s) {
    if (gone()) return;
    if (s === 'gone') regenerate();
    else if (s === 'unauthorized') unauthorized();
    else if (s === 'lost') view.lost(reconnect);
  }
  function openStream(after) {
    stream?.close();
    stream = openEventStream({ api, sessionId, after: finite(after) ? after : 0, fetch: doFetch, onEvent, onStatus });
  }
  function reconnect() {
    if (gone() || !sessionId || phase === 'access') return; // a Reconnect left from before a lost code does nothing
    openStream(stream?.lastId);
  }

  // ---- sessions ----
  // Take down what a session left on screen (a lost code, exit, a fresh session): WORKING marks, the following strip.
  function release() {
    if (dead()) return;
    for (const id of [...busy]) mark(id, null);
    ui.track?.(false);
  }
  // Forget the session's own state: late answers and events find nothing.
  function forget() { acting = null; labels.clear(); busy.clear(); liveDevices = []; faults = []; }
  // The room's devices and their actions (once per session: they don't change). false when it failed.
  async function loadDevices(sid) {
    let r;
    try { r = await api.devices(sid); } catch (e) {
      if (sid !== sessionId || gone()) return false;
      if (status(e) === 401) { unauthorized(); return false; }
      if (kindOf(e) === 'no_session') { regenerate(); return false; }
      view.ncb(LIVE_COPY.devicesFailed); ui.devices?.([]);
      return false;
    }
    if (sid !== sessionId || gone()) return false;
    liveDevices = liveDevicesOf(r?.devices, scene);
    ui.devices?.(liveDevices.map((d) => ({ ...d })));
    if (isObj(r?.clock) && finite(r.clock.hour) && typeof r.clock.label === 'string') { clockLabel = r.clock.label; controlsUi(); }
    return true;
  }
  // Watch a room: attach to a session someone else drives (the virtual NCB edge devices) instead of making one. The
  // session is the one ?watch=<id> names, else this code's most recently active one for this scene. null: none to watch.
  async function attach(want) {
    let sid = typeof want === 'string' && /^[0-9a-f]{16,64}$/i.test(want) ? want : null;
    if (!sid) {
      const l = await api.listSessions(scene.id);
      sid = Array.isArray(l?.sessions) ? l.sessions.find((x) => x?.scene === scene.id)?.sessionId ?? null : null;
    }
    if (!sid) return null;
    const s = await api.session(sid);
    return s && typeof s.sessionId === 'string' && isObj(s.state) ? s : null;
  }
  // Makes a session (or, watching, attaches to one), its stream and its device list. false when it failed (already
  // handled) or the visit moved on.
  async function newSession({ notice } = {}) {
    stream?.close(); stream = null;
    const want = watch();
    if (want != null) {
      let w = null;
      try { w = await attach(want); } catch (e) { if (gone()) return false; if (status(e) === 401) { unauthorized(); return false; } }
      if (gone()) return false;
      if (w) {
        release(); forget();
        sessionId = w.sessionId;
        ui.devices?.(null); ui.log?.(null);
        applyRoom(w.state, w.clock);
        ui.editing?.(true);
        showFaults([]);
        openStream(finite(w.after) ? w.after : 0);
        view.ncb(LIVE_COPY.watching);
        await loadDevices(sessionId);
        return !gone() && !!sessionId;
      }
      view.ncb(LIVE_COPY.nothingToWatch);
    }
    let s;
    try {
      s = await api.createSession(scene.id, sessionExtra());
      if (!s || typeof s.sessionId !== 'string' || !isObj(s.state)) throw new LiveError(200, 'bad_response');
    } catch (e) { if (!gone()) failed(e); return false; }
    if (gone()) return false;
    release(); forget();
    sessionId = s.sessionId;
    ui.devices?.(null); ui.log?.(null); // a new room: no actions until its list comes, a fresh event log
    applyRoom(s.state, s.clock);
    ui.editing?.(true);
    showFaults([]);
    openStream(0);
    if (notice) view.ncb(notice);
    await loadDevices(sessionId);
    return !gone() && !!sessionId;
  }
  // The session expired under the stream (or under a POST): a fresh room, and the visitor can go on.
  // One at a time: a stream 'gone', a failed edit and a failed action can all find the session expired together.
  let opening = null, regenerating = null;
  const reopen = () => (opening ??= newSession({ notice: LIVE_COPY.timedOut }).finally(() => { opening = null; }));
  function regenerate() {
    if (regenerating) return regenerating;
    acting = null; setPhase('busy');
    return (regenerating = (async () => {
      if (await reopen()) { idleStatus(); setPhase('idle'); }
    })().finally(() => { regenerating = null; }));
  }
  // A POST sessions that failed (or answered nonsense).
  function failed(e) {
    const k = kindOf(e);
    if (status(e) === 401) return unauthorized();
    if (k === 'global_limit') view.ncb(LIVE_COPY.sessionsBusy); // the server's session cap
    else if (k === 'code_limit') view.ncb(LIVE_COPY.limitCode);
    else if (k === 'live_off') view.ncb(LIVE_COPY.offline);
    else if (k === 'bad_room') view.ncb(LIVE_COPY.badRoom); // the custom scene's room was refused
    else view.ncb(LIVE_COPY.error);
    if (k === 'live_off') available = false; // /health says off from here on too
    exit();
  }
  // Live mode's tools go (the cards are display-only again): a lost code, exit.
  const noTools = () => { if (dead()) return; ui.editing?.(false); ui.devices?.(null); ui.faults?.(null); ui.log?.(null); };
  // The code stopped working: forget it (and the session it opened) and ask again.
  function unauthorized() {
    release();
    codes.clear(); code = null;
    stream?.close(); stream = null; sessionId = null; forget();
    noTools(); controlsUi();
    showAccess({ mode: 'code', note: LIVE_COPY.savedCodeGone });
  }

  // ---- access ----
  function showAccess(spec) {
    setPhase('access');
    accessHandle?.close(); accessHandle = null;
    accessHandle = view.access(spec, { onCode, onApply, onBack: () => { if (!gone()) exit(); } }) ?? null;
  }
  // api.check, reduced to { ok: true } or { err: 'bad'|'rate'|'offline' }.
  async function checkCode(c) {
    try {
      const r = await api.check(c);
      return r?.ok ? { ok: true } : { err: 'bad' };
    } catch (e) { return { err: status(e) === 401 ? 'bad' : status(e) === 429 && kindOf(e) === 'rate' ? 'rate' : 'offline' }; }
  }
  async function onCode(raw) {
    if (gone()) return null;
    const c = normalizeCode(raw), r = await checkCode(c);
    if (gone() || phase !== 'access') return null; // a second code in flight: the first one already got in
    if (r.err) return r.err === 'bad' ? LIVE_COPY.badCode : r.err === 'rate' ? LIVE_COPY.rate : LIVE_COPY.offline;
    code = c; codes.set(c);
    const handle = accessHandle; accessHandle = null; handle?.close();
    await enter();
    return null;
  }
  async function onApply(form) {
    if (gone()) return null;
    try { await api.apply({ ...(isObj(form) ? form : {}), scene: scene.id }); } catch (e) {
      return status(e) === 429 ? LIVE_COPY.applyRate : LIVE_COPY.offline;
    }
    return LIVE_COPY.applied;
  }

  async function enter() {
    setPhase('busy');
    if (!(await newSession()) || gone()) return;
    view.live(true);
    if (watch() == null) view.ncb(LIVE_COPY.intro(n)); // watching: newSession already said so
    ui.beats?.({ current: 'ask', recoverHidden: true, skippable: [] });
    idleStatus(); setPhase('idle');
  }

  async function open() {
    if (active || closed) return;
    active = true; setPhase('access'); announce();
    const h = await api.health();
    if (gone()) return;
    available = !!(h.ok && h.liveEnabled && h.scenes.includes(scene.id)); announce();
    if (!available) return showAccess({ mode: 'offline', offlineText: whyOff(h, scene.id, base) });
    const stored = codes.get();
    if (!stored) return showAccess({ mode: 'code' });
    const r = await checkCode(stored);
    if (gone()) return;
    if (r.err === 'bad') { codes.clear(); return showAccess({ mode: 'code', note: LIVE_COPY.savedCodeGone }); }
    if (r.err) return showAccess({ mode: 'offline' });
    code = stored;
    await enter();
  }

  function exit(heading) {
    if (!active) return;
    release();
    stream?.close(); stream = null;
    accessHandle?.close(); accessHandle = null;
    active = false; setPhase('off'); sessionId = null; forget();
    if (dead()) return;
    noTools(); view.live(false);
    ui.offerGuided(heading);
    announce();
  }
  // Teardown (the visitor left the scene): abort and fall silent, with no view, panel, ui or store call after it.
  function close() { closed = true; active = false; phase = 'off'; stream?.close(); stream = null; forget(); }

  return {
    probe, open, exit, close, edit, advance, run, plantFault, clearFaults, reset: resetRoom,
    get devices() { return liveDevices.map((d) => ({ ...d })); },
    get faults() { return faults.map((f) => ({ ...f })); },
    get available() { return available; },
    get active() { return active; },
    get phase() { return phase; },
    get advancing() { return advancing; },
    get acting() { return acting ? { ...acting } : null; },
    get sessionId() { return sessionId; },
  };
}

// Watch mode, from the page URL: ?watch (attach to this code's newest room for the scene) or ?watch=<sessionId>.
// null when not watching. Read on every (re)connect, so a reload keeps it.
export function watchRequest() {
  try {
    const q = new URLSearchParams(globalThis.location?.search ?? '');
    return q.has('watch') ? q.get('watch') ?? '' : null;
  } catch { return null; }
}
