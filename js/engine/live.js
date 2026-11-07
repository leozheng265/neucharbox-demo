// Live AI demo: the controller (wire contract: docs/superpowers/specs/2026-11-07-live-api-contract.md).
// Access (invite code), session and room; then requests, the event stream (event → view / panel / store), what-ifs,
// reset and limits. The invite code goes in storage and request headers only, never in a URL, a log or the page.
import { createLiveApi, LiveError } from './liveapi.js';
import { openEventStream } from './sse.js';
import { devicesOf, refOf, REPLAYING } from './whatif.js';
import { FRESH_START } from './flow.js';

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
const str = (v) => (typeof v === 'string' ? v : '');
const FIELD = /^[A-Za-z_$][\w$]*$/, NOT_FIELDS = new Set(['__proto__', 'constructor', 'prototype']);
const STEP_STATUS = ['running', 'done', 'failed', 'skipped'];
// Steps as the contract sends them ({ id, text, devices }); anything else is dropped.
const stepsOf = (list) => (Array.isArray(list) ? list : []).filter((s) => isObj(s) && typeof s.id === 'string')
  .map((s) => ({ id: s.id, text: str(s.text), devices: Array.isArray(s.devices) ? s.devices.filter((d) => typeof d === 'string') : [] }));

export function createLive({ scene, store, view, panel, ui, base, fetch: doFetch = globalThis.fetch, codes = codeStore(), now = () => performance.now() }) {
  let code = null;            // the code for this visit (kept here too, so a blocked store still works)
  const api = createLiveApi({ base, fetch: doFetch, getCode: () => code ?? codes.get() });
  let closed = false, active = false, available = false, phase = 'off';
  let sessionId = null, stream = null, accessHandle = null, suggestions = [], lastClockAt = 0, isWhatIf = false;
  // The request: its id (null while the POST that starts it is in flight), the latest finished one (what a what-if
  // replays), the events held for that POST, the cards and checklist on screen, the card waiting for an answer and the
  // answer in flight, and a typed change waiting for its decline's `done`.
  let rid = null, lastRid = null, holding = null, card = null, replanCard = null, replanSteps = [], checklist = null;
  let waiting = null, answer = null, pendingText = null, reading = null, planningOn = false, ranStep = false, exitOnDone = false;
  let remainingToday = null;
  const busy = new Set();     // the ids live.js marked 'busy': done clears only these, so a JUST SET runs its full 2 s
  const devices = devicesOf(scene), n = devices.length;

  const dead = () => closed || !ui.alive();
  const gone = () => dead() || !active;
  const beat = (current) => ui.beats({ current, recoverHidden: !isWhatIf, skippable: [] });
  const status = (e) => (e instanceof LiveError ? e.status : 0);
  const kindOf = (e) => (e instanceof LiveError ? e.kind : null);
  const isDevice = (id) => typeof id === 'string' && devices.includes(id);
  const mark = (id, kind) => { if (kind === 'busy') busy.add(id); else busy.delete(id); panel.mark(id, kind); };
  // A store path the server may write: <slice>.<field…> on a slice the store has, with no prototype keys.
  const writable = (path) => {
    if (typeof path !== 'string') return false;
    const ks = path.split('.');
    return ks.length > 1 && Object.prototype.hasOwnProperty.call(store.state, ks[0]) && ks.every((k) => FIELD.test(k) && !NOT_FIELDS.has(k));
  };

  async function probe() {
    try {
      const h = await api.health();
      available = !!(h.ok && h.liveEnabled && h.scenes.includes(scene.id));
    } catch { available = false; }
    return available;
  }

  // ---- room ----
  function setClock(c, { instant = false } = {}) {
    if (!isObj(c) || !finite(c.hour)) return;
    const cur = Number(store.get('env.hour')) || 0, t = now();
    const ms = instant || c.hour < cur ? 0 : Math.min(800, Math.max(0, t - lastClockAt));
    lastClockAt = t; store.tween('env.hour', c.hour, ms);
    if (!instant && typeof c.label === 'string') ui.status(c.label); // a room or a reset sets the clock without taking the status line
  }

  // The server's whole room, merged per field onto the post-setup snapshot (room-only fields keep their values).
  function applyRoom(state, clock) {
    const snap = ui.baseline();
    if (snap) store.restore(snap);
    ui.resetRoom();
    if (isObj(state)) {
      for (const [id, slice] of Object.entries(state)) {
        if (isObj(slice)) for (const [field, value] of Object.entries(slice)) { const p = `${id}.${field}`; if (writable(p)) store.set(p, value); }
      }
    }
    setClock(clock, { instant: true });
    reading = null;
    for (const id of devices) mark(id, null);
  }

  // ---- the event stream ----
  function onEvent(ev) {
    const d = ev?.data;
    if (gone() || !isObj(d)) return;
    if (ev.event === 'room') { if (isObj(d.state)) applyRoom(d.state, d.clock); return; } // any request's (a what-if's comes first)
    if (rid !== null && d.rid === rid) return handle(ev);
    if (holding && typeof d.rid === 'string') holding.push(ev); // maybe the request whose POST hasn't answered yet
  }

  // One event of the current request → the view, the panel and the store.
  function handle({ event: k, data: d }) {
    if (gone()) return;
    // An Approve / Not this in flight: the server acted on it if the run goes on, not if the card expired or was declined.
    if (k === 'expired' || k === 'declined') { if (answer) answer.over = true; answer = null; } else answer?.apply();
    if (reading) { const id = reading; reading = null; mark(id, null); } // a running read's `call` marks it WORKING again
    switch (k) {
      case 'planning': phase = 'planning'; planningOn = true; view.planning(true); beat('plan'); break;
      case 'reading':
        if (!isDevice(d.device)) break;
        mark(d.device, 'busy'); reading = d.device; panel.reveal([d.device]); // a read changes no value: reveal shows its card
        if (phase === 'planning') view.reading(refOf(scene, d.device));
        break;
      case 'plan': {
        const steps = stepsOf(d.steps);
        planningOn = false; view.planning(false);
        if (isWhatIf) { checklist = view.checklist(steps, { replay: true }); phase = 'running'; } // a replay asks nothing
        else card = planCard({ kind: 'plan', steps });
        break;
      }
      case 'awaiting_approval': {
        const c = d.kind === 'replan' ? replanCard : card;
        if (!c) break;
        waiting = c; phase = 'awaiting'; ui.status(LIVE_COPY.statusApproval); view.input(true); c.enable(); // a typed change re-plans
        break;
      }
      case 'cannot_do':
        planningOn = false; view.planning(false); view.ncb(str(d.reason));
        view.chips(Array.isArray(d.suggestions) ? d.suggestions.filter((t) => typeof t === 'string') : [], submit);
        break;
      case 'declined': card?.declined(); waiting = null; if (!pendingText) view.ncb(LIVE_COPY.declined); break; // plans only
      case 'expired': { const c = waiting; waiting = null; if (c) { c.close(); view.ncb(LIVE_COPY.expired); } break; }
      case 'step':
        if (typeof d.id !== 'string' || !STEP_STATUS.includes(d.status)) break;
        checklist?.step(d.id, d.status);
        if (d.status === 'running' && !ranStep) { ranStep = true; beat('run'); }
        break;
      case 'call':
        checklist?.call({ callId: d.callId, step: d.step ?? null, label: str(d.label) }); // a null step: a row of its own (view)
        if (isDevice(d.device)) { mark(d.device, 'busy'); panel.reveal([d.device]); }
        if (typeof d.label === 'string') ui.status(d.label);
        break;
      case 'state':
        if (!writable(d.path)) break;
        if (finite(d.value) && finite(d.ms) && d.ms > 0) store.tween(d.path, d.value, d.ms); else store.set(d.path, d.value);
        break;
      case 'result':
        checklist?.result({ callId: d.callId, outcome: d.outcome, text: str(d.text), ok: d.ok !== false });
        if (isDevice(d.device)) mark(d.device, d.outcome === 'confirmed' || d.outcome === 'made_safe' ? 'just' : null);
        break;
      case 'fault': // the server's text first: the card and flow.js's status line read it once the status turns 'fault'
        if (!isDevice(d.device)) break;
        store.set(`${d.device}.faultNote`, str(d.text)); mark(d.device, null);
        if (isWhatIf) beat('recover');
        break;
      case 'clock': setClock(d); break;
      case 'timeline': checklist?.timeline({ at: str(d.at), text: str(d.text), ok: d.ok !== false, kind: d.kind }); break;
      case 'replan': // its ids are final (contract): approving merges them into the checklist
        replanSteps = stepsOf(d.steps);
        replanCard = planCard({ kind: 'replan', steps: replanSteps, reason: str(d.reason) });
        break;
      case 'say': if (typeof d.delta === 'string') view.sayDelta(d.delta); break;
      case 'summary': if (typeof d.text === 'string') view.summary(d.text); break;
      case 'limit':
        if (d.kind === 'budget') { available = false; exitOnDone = true; view.ncb(LIVE_COPY.limitGlobal); } else view.ncb(LIVE_COPY.limitRun);
        break;
      case 'error': view.ncb(LIVE_COPY.error); break;
      case 'done': done(d); break;
      default: break;
    }
  }

  function done(d) {
    for (const id of [...busy]) mark(id, null); // never every device: that would cut a JUST SET short
    ui.track(false); checklist?.done();
    if (planningOn) { planningOn = false; view.planning(false); }
    if (finite(d.remainingToday)) remainingToday = d.remainingToday;
    card = replanCard = checklist = waiting = null;
    if (exitOnDone) { exitOnDone = false; return exit(); } // the kill switch tripped mid-run
    const out = d.outcome;
    if (out === 'ok' || out === 'failed' || out === 'limit') {
      if (out !== 'limit' && !isWhatIf) lastRid = rid; // a what-if never becomes the latest finished request (contract)
      view.endCard({ remainingToday, whatIfLabel: isWhatIf ? LIVE_COPY.anotherFailure : LIVE_COPY.whatIf, whatIf: out !== 'limit' }, endActions());
      beat('end'); ui.status(LIVE_COPY.statusDone(remainingToday));
    } else { beat('ask'); ui.status(LIVE_COPY.statusWaiting(n)); }
    if (remainingToday === 0) view.ncb(LIVE_COPY.lastOne);
    phase = 'idle'; view.input(true);
    if (pendingText) { const t = pendingText; pendingText = null; submit(t); }
  }

  // The end card's buttons (the view disables them all when one is pressed). Each acts only between requests.
  const endActions = () => ({
    onAnother: () => { if (gone() || phase !== 'idle') return; isWhatIf = false; beat('ask'); ui.status(LIVE_COPY.statusWaiting(n)); view.input(true); },
    onWhatIf: () => {
      if (gone() || phase !== 'idle' || !lastRid) return;
      view.failures(devices.map((id) => ({ key: id, icon: scene.devices[id].icon, name: scene.devices[id].name })), whatIf);
    },
    onReset: () => resetRoom(),
  });

  // ---- plan and re-plan cards ----
  function planCard(spec) {
    let h = null;
    h = view.planCard(spec, { onApprove: () => respond(h, 'approve'), onDecline: () => respond(h, 'decline') });
    return h;
  }
  // Approve / Not this on the card waiting, or a typed change (a decline that keeps `typed` for when the request ends).
  // One POST at a time per card. Its effects run once: on the 202, or on the first event that shows the server acted on
  // it, whichever comes first (the server runs on before its answer reaches the page).
  async function respond(c, action, typed = null) {
    if (gone() || !c || c !== waiting || phase !== 'awaiting') return;
    const replan = c === replanCard, steps = replanSteps, a = { over: false };
    a.apply = () => {
      if (a.over) return;
      a.over = true; if (answer === a) answer = null; waiting = null;
      if (action === 'approve') {
        if (replan) { c.close(); checklist?.mergeSteps(steps); } else checklist = c.toChecklist();
      } else if (replan) c.declined(); // no event comes for it (contract): the demo marks the card, the run carries on
      else return;                     // a plan's decline: its `declined` and `done` follow
      phase = 'running'; view.input(false);
    };
    answer = a; if (typed != null) pendingText = typed;
    phase = 'busy'; view.input(false); c.busy();
    try { await (action === 'approve' ? api.approve(sessionId, rid) : api.decline(sessionId, rid)); } catch (e) {
      if (a.over || gone()) return;
      a.over = true; answer = null;
      if (status(e) === 401) return unauthorized();
      if (kindOf(e) === 'not_waiting') { c.close(); if (waiting === c) waiting = null; view.ncb(LIVE_COPY.expired); return; } // its `done` follows
      pendingText = null; view.ncb(LIVE_COPY.error); phase = 'awaiting'; view.input(true); c.enable();
      return;
    }
    if (!gone()) a.apply();
  }

  // ---- requests ----
  // A new request or what-if: nothing of the last one stays live.
  function begin() { card = replanCard = checklist = waiting = null; replanSteps = []; reading = null; ranStep = false; exitOnDone = false; planningOn = false; }
  // The POST that starts a request (requests, …/whatif). Until it answers, events with an unknown rid are held (the server
  // starts before it answers); then those of its requestId run in order and the rest are dropped, or all of them when it
  // fails. Resolves false when the visit moved on meanwhile.
  async function start(post) {
    rid = null; const held = holding = [];
    let r;
    try {
      r = await post();
      if (!isObj(r) || typeof r.requestId !== 'string') throw new LiveError(200, 'bad_response');
    } catch (e) { if (holding === held) holding = null; throw e; }
    if (holding !== held) return false;
    holding = null;
    if (gone()) return false;
    rid = r.requestId;
    for (const ev of held) if (ev.data.rid === rid && !gone()) handle(ev);
    return true;
  }
  const backToIdle = () => { phase = 'idle'; ui.track(false); view.input(true); ui.status(LIVE_COPY.statusWaiting(n)); };
  const limited = (line, off = false) => { if (off) available = false; view.ncb(line); exit(); };

  async function submit(text) {
    const t = String(text ?? '').trim();
    if (gone() || !t) return;
    if (t.length > 400) { view.ncb(LIVE_COPY.tooLong); return; } // UTF-16 units, as the server counts
    if (phase === 'awaiting') return respond(waiting, 'decline', t); // a typed change: decline quietly, then plan this
    if (phase !== 'idle') return;                                   // one request at a time
    begin(); phase = 'busy'; isWhatIf = false;
    view.input(false); view.user(t); ui.status(LIVE_COPY.planning); ui.track(true);
    for (let retried = false; ; retried = true) {
      try { await start(() => api.request(sessionId, t)); return; } catch (e) {
        if (gone()) return;
        const k = kindOf(e);
        if (status(e) === 401) return unauthorized();
        if (k === 'code_limit') return limited(LIVE_COPY.limitCode);
        if (k === 'global_limit' || k === 'budget') return limited(LIVE_COPY.limitGlobal, k === 'budget');
        if (k === 'live_off') return limited(LIVE_COPY.offline, true); // switched off, or no NeuChar key: not a limit
        if (k === 'no_session' && !retried) { if ((await newSession({ notice: LIVE_COPY.timedOut })) && !gone()) continue; return; }
        view.ncb(k === 'too_long' ? LIVE_COPY.tooLong : LIVE_COPY.error);
        return backToIdle();
      }
    }
  }

  // "What if something fails?" on an end card: the latest finished request, replayed with `id` failing.
  async function whatIf(id) {
    if (gone() || phase !== 'idle' || !lastRid || !isDevice(id)) return;
    view.user(LIVE_COPY.whatIfAsk(refOf(scene, id), !!scene.devices[id].plural));
    begin(); isWhatIf = true; phase = 'busy'; ranStep = true; // its Run beat is now
    view.input(false); ui.rewind(); ui.status(REPLAYING); ui.track(true); beat('run');
    try { await start(() => api.whatIf(sessionId, lastRid, id)); } catch (e) {
      if (gone()) return;
      const k = kindOf(e);
      if (status(e) === 401) return unauthorized();
      if (k === 'budget') return limited(LIVE_COPY.limitGlobal, true);
      if (k === 'live_off') return limited(LIVE_COPY.offline, true);
      isWhatIf = false;
      if (k === 'no_session') return regenerate();
      view.ncb(LIVE_COPY.error); beat('ask'); backToIdle();
    }
  }

  // "Reset room" on an end card. reset emits no event (contract), so its answer is the only source of the room.
  async function resetRoom() {
    if (gone() || phase !== 'idle') return;
    phase = 'busy'; view.input(false);
    let r;
    try {
      r = await api.reset(sessionId);
      if (!isObj(r) || !isObj(r.state)) throw new LiveError(200, 'bad_response');
    } catch (e) {
      if (gone()) return;
      if (status(e) === 401) return unauthorized();
      if (kindOf(e) === 'no_session') return regenerate();
      view.ncb(LIVE_COPY.error); phase = 'idle'; view.input(true);
      return;
    }
    if (gone()) return;
    applyRoom(r.state, r.clock);
    lastRid = null; isWhatIf = false; // nothing to replay until the next request
    view.ncb(FRESH_START); beat('ask'); ui.status(LIVE_COPY.statusWaiting(n)); phase = 'idle'; view.input(true);
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
  // Forget the request on screen (a new session, a lost code, exit, close): late events and answers find nothing.
  function forget() {
    if (answer) answer.over = true;
    rid = null; lastRid = null; holding = null; answer = null; pendingText = null; isWhatIf = false;
    busy.clear(); begin();
  }
  // Makes a session and its stream. false when it failed (already handled) or the visit moved on.
  async function newSession({ notice } = {}) {
    stream?.close(); stream = null;
    let s;
    try {
      s = await api.createSession(scene.id);
      if (!s || typeof s.sessionId !== 'string' || !isObj(s.state)) throw new LiveError(200, 'bad_response');
    } catch (e) { if (!gone()) failed(e); return false; }
    if (gone()) return false;
    if (planningOn) view.planning(false);
    forget();
    sessionId = s.sessionId;
    suggestions = Array.isArray(s.suggestions) ? s.suggestions.filter((t) => typeof t === 'string') : [];
    applyRoom(s.state, s.clock);
    openStream(0);
    if (notice) view.ncb(notice);
    return true;
  }
  const idle = () => { ui.status(LIVE_COPY.statusWaiting(n)); beat('ask'); phase = 'idle'; };
  // The session expired under the stream (or under a POST): a fresh room, and the visitor can go on.
  async function regenerate() {
    phase = 'busy';
    if (await newSession({ notice: LIVE_COPY.timedOut })) { ui.track(false); view.input(true); idle(); }
  }
  // A POST sessions that failed (or answered nonsense).
  function failed(e) {
    const k = kindOf(e);
    if (status(e) === 401) return unauthorized();
    if (k === 'budget' || k === 'global_limit') view.ncb(LIVE_COPY.limitGlobal);
    else if (k === 'code_limit') view.ncb(LIVE_COPY.limitCode);
    else if (k === 'live_off') view.ncb(LIVE_COPY.offline);
    else view.ncb(LIVE_COPY.error);
    if (k === 'budget' || k === 'live_off') available = false; // /health says off from here on too
    exit();
  }
  // The code stopped working: forget it (and the session it opened) and ask again.
  function unauthorized() {
    codes.clear(); code = null;
    stream?.close(); stream = null; sessionId = null; forget();
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
    if (gone() || phase !== 'access') return null; // a second code in flight: the first one already got in
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
    available = !!(h.ok && h.liveEnabled && h.scenes.includes(scene.id));
    if (!available) return showAccess({ mode: 'offline' });
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

  function exit(heading) {
    if (!active) return;
    stream?.close(); stream = null;
    accessHandle?.close(); accessHandle = null;
    active = false; phase = 'off'; sessionId = null; forget();
    if (dead()) return;
    ui.track(false); view.input(false); view.live(false);
    ui.offerGuided(heading);
  }
  // Teardown (the visitor left the scene): abort and fall silent, with no view, panel, ui or store call after it.
  function close() { closed = true; active = false; phase = 'off'; stream?.close(); stream = null; forget(); }

  return {
    probe, open, submit, exit, close,
    get available() { return available; },
    get active() { return active; },
    get phase() { return phase; },
    get sessionId() { return sessionId; },
  };
}
