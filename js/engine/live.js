// Live AI demo: the controller (wire contract: docs/superpowers/specs/2026-11-07-live-api-contract.md).
// Part 1: access (invite code), session and room. Requests, plans and runs are added on top by later tasks.
// The invite code goes in storage and request headers only, never in a URL, a log or the page.
import { createLiveApi, LiveError } from './liveapi.js';
import { openEventStream } from './sse.js';
import { devicesOf } from './whatif.js';

const left = (n) => (n == null ? '' : n === 1 ? '1 live request left today' : `${n} live requests left today`);
export const LIVE_COPY = {
  button: '✨ Try your own request (live AI)',
  accessIntro: 'Live AI is invite-only. Enter your code, or apply.',
  offline: 'Live AI is offline right now. Try the guided requests, or follow NeuCharBox for updates.',
  badCode: "That code didn't work. Check it, or apply below.",
  savedCodeGone: 'Your saved code no longer works. Enter a new one, or apply below.',
  noneLeft: 'This code has no live requests left today. They reset at midnight US Eastern.',
  applyEmailUse: 'We use your email only to send your invite.',
  applied: 'Thanks. We read every application and send codes by email.',
  applyRate: 'Too many applications from this connection. Try again in an hour.',
  back: 'Back to guided requests',
  intro: (n) => `Live AI is on. Type what you want these ${n} devices to do. A real model plans it, and nothing runs until you approve.`,
  tryHeading: 'Try:',
  placeholder: (n) => `Type your own request for these ${n} devices…`,
  badge: 'LIVE AI',
  planning: 'Planning…',
  reading: (ref) => `Checking ${ref}…`,
  planIntro: "Here's the plan. Nothing runs until you approve.",
  replanIntro: (reason) => `I need to change the plan: ${String(reason ?? '').replace(/[\s.!?…]+$/, '')}.`,
  checklistTitle: 'Running your plan',
  replayTitle: 'Replaying your plan',
  declined: "OK, nothing ran. Everything is as it was. Type another request when you're ready.",
  expired: 'That plan waited too long, so I dropped it. Nothing ran.',
  limitCode: "That's all the live requests for this code today. They reset at midnight US Eastern. The guided requests still work.",
  limitGlobal: 'Live AI has reached its limit for today. The guided requests still work, or come back tomorrow.',
  limitRun: "I stopped there: this request reached the live demo's limit for one run. What I did so far is above.",
  tooLong: 'That request is over 400 characters. Try a shorter one.',
  error: 'Something went wrong on the live server, not with a device. Try again.',
  lost: 'I lost the connection to the live AI. The room shows the last thing I heard.',
  reconnect: 'Reconnect',
  timedOut: 'Your live session timed out, so I started a fresh room.',
  whatIfHeading: "Pick what goes wrong. I'll replay this request live, with that device failing.",
  another: 'Try another live request',
  whatIf: 'What if something fails?',
  anotherFailure: 'Try another failure',
  reset: 'Reset room',
  otherScene: 'Try another scene',
  left,
  lastOne: "That was this code's last live request for today.",
  statusWaiting: (n) => `Live AI · ${n} devices · waiting for your request`,
  statusApproval: 'Waiting for your approval',
  statusDone: (n) => (n == null ? 'Done' : `Done · ${left(n)}`),
  whatIfAsk: (ref, plural) => `What if ${ref} ${plural ? 'fail' : 'fails'}?`,
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

export function createLive({ scene, store, view, panel, ui, base, fetch: doFetch = globalThis.fetch, codes = codeStore(), now = () => performance.now() }) {
  let code = null;            // the code for this visit (kept here too, so a blocked store still works)
  const api = createLiveApi({ base, fetch: doFetch, getCode: () => code ?? codes.get() });
  let closed = false, active = false, available = false, phase = 'off';
  let sessionId = null, stream = null, accessHandle = null, suggestions = [], clockAt = 0, isWhatIf = false;
  const devices = devicesOf(scene), n = devices.length;

  const dead = () => closed || !ui.alive();
  const gone = () => dead() || !active;
  const beat = (current) => ui.beats({ current, recoverHidden: !isWhatIf, skippable: [] });
  const status = (e) => (e instanceof LiveError ? e.status : 0);

  async function probe() {
    try {
      const h = await api.health();
      available = !!(h.ok && h.liveEnabled && h.scenes.includes(scene.id));
    } catch { available = false; }
    return available;
  }

  // ---- room ----
  function setClock(clock, { instant = false } = {}) {
    if (!isObj(clock) || !finite(clock.hour)) return;
    if (instant) store.set('env.hour', clock.hour);
    else {
      store.tween('env.hour', clock.hour, Math.min(800, Math.max(0, now() - clockAt)));
      if (typeof clock.label === 'string') ui.status(clock.label);
    }
    clockAt = now();
  }

  // The server's whole room, merged per field onto the post-setup snapshot (room-only fields keep their values).
  function applyRoom(state, clock) {
    const base = ui.baseline();
    if (base) store.restore(base);
    ui.resetRoom();
    if (isObj(state)) for (const [id, slice] of Object.entries(state)) if (isObj(slice)) for (const [field, value] of Object.entries(slice)) store.set(`${id}.${field}`, value);
    setClock(clock, { instant: true });
    for (const id of devices) panel.mark(id, null);
  }

  // ---- the event stream ----
  function onEvent({ event, data }) {
    if (gone() || !isObj(data)) return;
    if (event === 'room') applyRoom(data.state, data.clock);
    else if (event === 'clock') setClock(data);
  }
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
    if (gone() || !sessionId) return;
    openStream(stream?.lastId);
  }

  // ---- sessions ----
  // Makes a session and its stream. false when it failed (already handled) or the visit moved on.
  async function newSession({ notice } = {}) {
    stream?.close(); stream = null;
    let s;
    try {
      s = await api.createSession(scene.id);
      if (!s || typeof s.sessionId !== 'string' || !isObj(s.state)) throw new LiveError(200, 'bad_response');
    } catch (e) { if (!gone()) failed(e); return false; }
    if (gone()) return false;
    sessionId = s.sessionId;
    suggestions = Array.isArray(s.suggestions) ? s.suggestions.filter((t) => typeof t === 'string') : [];
    applyRoom(s.state, s.clock);
    openStream(0);
    if (notice) view.ncb(notice);
    return true;
  }
  const idle = () => { ui.status(LIVE_COPY.statusWaiting(n)); beat('ask'); phase = 'idle'; };
  // The session expired under the stream: a fresh room, and the visitor can go on.
  async function regenerate() {
    phase = 'busy';
    if (await newSession({ notice: LIVE_COPY.timedOut })) { view.input(true); idle(); }
  }
  // A POST sessions that failed (or answered nonsense).
  function failed(e) {
    const k = e instanceof LiveError ? e.kind : null;
    if (status(e) === 401) return unauthorized();
    if (k === 'budget' || k === 'global_limit') view.ncb(LIVE_COPY.limitGlobal);
    else if (k === 'code_limit') view.ncb(LIVE_COPY.limitCode);
    else if (k === 'live_off') view.ncb(LIVE_COPY.offline);
    else view.ncb(LIVE_COPY.error);
    exit();
  }
  // The code stopped working: forget it and ask again.
  function unauthorized() {
    codes.clear(); code = null;
    stream?.close(); stream = null;
    view.input(false);
    showAccess({ mode: 'code', note: LIVE_COPY.savedCodeGone });
  }

  // ---- access ----
  function showAccess(spec) {
    phase = 'access';
    accessHandle?.close(); accessHandle = null;
    accessHandle = view.access(spec, { onCode, onApply, onBack: () => { if (!gone()) exit(); } }) ?? null;
  }
  // api.check, reduced to { left } or { err: 'bad'|'offline' }.
  async function checkCode(c) {
    try {
      const r = await api.check(c);
      return finite(r?.remainingToday) ? { left: r.remainingToday } : { err: 'offline' };
    } catch (e) { return { err: status(e) === 401 ? 'bad' : 'offline' }; }
  }
  async function onCode(raw) {
    if (gone()) return null;
    const c = normalizeCode(raw), r = await checkCode(c);
    if (gone()) return null;
    if (r.err) return r.err === 'bad' ? LIVE_COPY.badCode : LIVE_COPY.offline;
    if (r.left <= 0) return LIVE_COPY.noneLeft;
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
    phase = 'busy';
    if (!(await newSession()) || gone()) return;
    view.live(true); view.input(true);
    view.ncb(LIVE_COPY.intro(n));
    if (suggestions.length) view.chips(suggestions, (t) => { if (!gone()) return submit(t); }, LIVE_COPY.tryHeading);
    idle();
  }

  async function open() {
    if (active || closed) return;
    active = true; phase = 'access';
    const h = await api.health();
    if (gone()) return;
    if (!(h.ok && h.liveEnabled && h.scenes.includes(scene.id))) return showAccess({ mode: 'offline' });
    const stored = codes.get();
    if (!stored) return showAccess({ mode: 'code' });
    const r = await checkCode(stored);
    if (gone()) return;
    if (r.err === 'bad') { codes.clear(); return showAccess({ mode: 'code', note: LIVE_COPY.savedCodeGone }); }
    if (r.err) return showAccess({ mode: 'offline' });
    if (r.left <= 0) return showAccess({ mode: 'code', note: LIVE_COPY.noneLeft });
    code = stored;
    await enter();
  }

  async function submit() { /* Task 5 */ }

  function exit(heading) {
    if (!active) return;
    stream?.close(); stream = null;
    accessHandle?.close(); accessHandle = null;
    active = false; phase = 'off'; sessionId = null;
    if (dead()) return;
    ui.track(false); view.input(false); view.live(false);
    ui.offerGuided(heading);
  }
  function close() { closed = true; stream?.close(); stream = null; }

  return {
    probe, open, submit, exit, close,
    get available() { return available; },
    get active() { return active; },
    get phase() { return phase; },
    get sessionId() { return sessionId; },
  };
}
