import { createStore } from './engine/store.js';
import { createChat } from './engine/chat.js';
import { createPanel } from './engine/panel.js';
import { interpret, asksWhatIfFails } from './engine/match.js';
import { icon } from './engine/icons.js';
import { createFlow, BEATS, quoted, WHATIF_HOW } from './engine/flow.js';
import { SCENES } from './scenes/index.js';

const KS = 'https://www.kickstarter.com/projects/neucharbox/neucharbox-ai-operating-system-for-the-physical-world?ref=demo';
// Picker thumbnails: the hub and a few of the devices each room connects (line icons, same as the dashboard tiles).
const THUMB_ICONS = { home: ['lamp', 'blinds', 'moisture', 'camera', 'thermostat'], lab: ['laser', 'mirror', 'stage', 'meter', 'beamcam'], elder: ['bed', 'door', 'motion', 'kettle', 'bulb'], warehouse: ['conveyor', 'scanner', 'gate', 'cart', 'dock'], creator: ['keylight', 'camera', 'mic', 'capture', 'sign'] };
const app = document.getElementById('app');
let current = null; // { scene, teardown }
let mountGen = 0;   // bumped on every route; an in-flight mount that sees a newer value abandons itself

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const ksButton = (cls = 'btn primary small') => `<a class="${cls}" href="${KS}" target="_blank" rel="noopener">Back <span class="ks-long">on Kickstarter</span><span class="ks-short">it</span></a>`;
// A thumbnail gradient is dark when its first colour is (lab, creator): the index number and icons then go light.
const darkThumb = (g) => { const m = /#([0-9a-f]{6})/i.exec(g || ''); if (!m) return false; const n = parseInt(m[1], 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) < 110; };

function renderPicker() {
  app.classList.remove('failed'); app.classList.add('picker-mode');
  app.innerHTML = `
    <header class="top"><div class="logo"></div><div class="brand">NeuCharBox</div><div class="scene-name">Live demo</div><div class="spacer"></div>${ksButton()}</header>
    <main class="picker">
      <h1>Try NeuCharBox before it ships.</h1>
      <p class="lede">Pick a place. Plug in the hub, connect what's there, say what you want — or give exact instructions — approve the plan, and watch it run. Then make something fail, and see what it does.</p>
      <div class="scene-grid">${SCENES.map((s, i) => `
        <a class="scene-card" href="#${s.id}" style="--thumb:${s.thumb}"><div class="thumb${darkThumb(s.thumb) ? ' dark' : ''}" data-n="0${i + 1}"><span class="icons" aria-hidden="true">${['hub', ...(THUMB_ICONS[s.id] || [])].map(icon).join('')}</span></div><div class="body"><h3>${esc(s.title)}</h3><p>${esc(s.promise)}</p>${s.tag ? `<span class="tag">${esc(s.tag)}</span>` : ''}</div></a>`).join('')}
      </div>
      <p class="foot">Everything here is a simulation running in your browser. No account, no data leaves the page. Scenes marked illustrative are typical setups, not a specific customer's.</p>
    </main>`;
}

async function mountScene(meta, gen) {
  app.classList.remove('picker-mode', 'failed');
  app.innerHTML = `
    <header class="top"><a class="logo" href="#" aria-label="All scenes"></a><a class="brand" href="#" style="text-decoration:none">NeuCharBox</a><div class="scene-name">${esc(meta.title)}</div><div class="spacer"></div><a class="btn small secondary" href="#"><span class="back" aria-hidden="true">‹ </span>Scenes</a>${ksButton()}</header>
    <nav class="beats" id="beats" aria-label="Demo steps">${BEATS.map(([id, label]) => `<button data-beat="${id}" disabled${id === 'recover' ? ' hidden' : ''}>${label}</button>`).join('')}</nav>
    <div class="stage">
      <div class="room"><canvas id="room"></canvas><div class="hint">${coarse ? 'drag · pinch · tap a device' : 'drag to orbit · scroll to zoom · right-drag to pan · tap a device'}</div><button class="reset" id="resetView" type="button" title="Reset view">⟲ view</button></div>
      <div class="status" id="status" role="status">Loading the ${esc(meta.title.toLowerCase())}…</div>
      <div class="side">
        <div class="panel" id="panel"></div>
        <div class="chat" id="chat"></div>
      </div>
    </div>`;

  const [{ default: scene }, { createRenderer, THREE }, partsMod] = await Promise.all([meta.load(), import('./engine/renderer.js'), import('./engine/parts.js')]);
  if (gen !== mountGen) return; // the visitor navigated away while this scene was loading

  const initial = { env: { hour: scene.startHour ?? 17 }, hub: { status: 'off', led: 0 }, plan: {} };
  for (const [id, d] of Object.entries(scene.devices)) initial[id] = { status: 'offline', ...d.initial };
  const store = createStore(initial);
  const qp = new URLSearchParams(location.search).get('q'); // ?q=high|low locks the render tier (QA screenshots); no watchdog
  const R = createRenderer(document.getElementById('room'), { camera: scene.camera, ...(qp === 'high' || qp === 'low' ? { quality: qp, lockQuality: true } : {}) });
  let flow = null;
  try {
  const M = partsMod.materials(); const P = partsMod.parts(R.scene, M);
  const sv = Number(new URLSearchParams(location.search).get('speed')); const speed = Number.isFinite(sv) && sv > 0 ? Math.min(sv, 6) : 1; // ?speed= review mode (≤ 6), also for room-side motion
  // A what-if replays the request quietly up to its failure point: no chat, status, pings or room marks while it does.
  // Scenes read the flag through build({ quiet }) (their store hooks return early while it is true, A2).
  const room = scene.build({ R, P, M, THREE, store, parts: partsMod, speed, quiet: () => !!flow?.quiet() });
  R.onFrame((t) => { store.tick(performance.now()); room.update(store.state, t); });
  R.start();

  const statusEl = document.getElementById('status');
  document.getElementById('resetView').onclick = () => R.resetView();
  // Tap names: devices, the hub, and anything else the scene lets you tap (scene.extraNames, e.g. { webcam: 'USB webcam' }).
  const nameOf = (id) => (scene.devices[id] ? scene.devices[id].name : id === 'hub' ? 'NeuCharBox' : scene.extraNames?.[id] || null);
  const pingDevice = (id) => { const n = nameOf(id); if (!n) return; room.focus?.(id); R.ping(id, n, { hold: 1200 }); };
  const panel = createPanel(document.getElementById('panel'), scene, store, { onSelect: pingDevice });
  R.onPick((id) => { panel.select(scene.devices[id] ? id : null); pingDevice(id); }); // the hub or a spare part (no tile) clears the last tile's highlight
  const beatBtns = [...document.getElementById('beats').querySelectorAll('button')];
  // Why a typed request didn't run, in NCB's words. `r` comes from interpret().
  const CLARIFY = {
    refuse: () => "That reads like something you don't want done. I won't guess at the opposite, and this demo can only run the requests below. Pick one, or say it another way.",
    opposite: (r) => `That's the opposite of ${quoted(r.prompt)}. This demo can only run the requests below, and I won't guess. Pick one, or say it another way.`,
    halt: () => "That asks me to stop or switch something off. None of the requests in this demo does just that, and I won't guess. Pick one below, or say it another way.",
    tie: (r) => `That could be ${quoted(r.prompt)} or ${quoted(r.also)}. I won't guess. Pick one below.`,
    values: (r) => `This demo can only run that one as written: ${quoted(r.prompt)}. I won't swap in other numbers on my own. Pick it below if that's what you want.`,
    partial: (r) => `The closest request in this demo is ${quoted(r.prompt)}. It doesn't do just what you asked, and I won't guess. Pick it below if that's what you want, or say it another way.`,
    conflict: (r) => `The closest request in this demo is ${quoted(r.prompt)}, but its plan includes "${String(r.line).replace(/[.!?]+$/, '').replace(/"([^"]*)"/g, '‘$1’')}", which goes against what you asked. I won't run it on a guess. Pick it below if that's fine, or say it another way.`, // quotes inside the plan line become ‘single’ ones
    question: (r) => `That's a question, not a request, so I won't act on it. The closest request in this demo is ${quoted(r.prompt)}. Pick it below if that's what you want.`,
    check: (r) => `That asks me to check something, and none of the requests in this demo just checks it. I won't turn it into an action. The closest is ${quoted(r.prompt)}. Pick it below if that's what you want.`,
    statement: (r) => `That tells me how things are; it doesn't ask for anything, so I won't act on it. The closest request in this demo is ${quoted(r.prompt)}. Pick it below if that's what you want.`,
    vague: () => "I'm not sure which request that is, and I won't guess. This demo runs a few scripted requests in this room: pick one below, or say it another way.",
  };
  const chat = createChat(document.getElementById('chat'), { onPromptText: (text) => {
    if (flow.phase !== 'chips') return;
    const r = interpret(text, scene.prompts);
    // "What if the hall light stops working?": a failure is picked from a request's end card, so say how, with the
    // closest request first, rather than run that request clean.
    if (asksWhatIfFails(text, scene.devices)) {
      const near = r.action === 'run' || (r.action === 'clarify' && r.via && r.via !== 'halt') ? [r.prompt] : [];
      chat.closeChips(); chat.user(text); chat.ncb(WHATIF_HOW);
      chat.chips([...near, ...flow.remaining().filter((p) => !near.includes(p))], (p) => flow.runPrompt(p, p.chip, false));
      return;
    }
    if (r.action === 'run') { flow.runPrompt(r.prompt, text, false); return; }
    chat.closeChips();
    chat.user(text);
    // The scene's own answer comes first: text asking for what is already so, or about a device's state (scene.already).
    let said = null; try { said = scene.already?.(r, text, store.state) || null; } catch (e) { console.error(e); }
    const kind = r.action === 'refuse' ? (r.via === 'opposite' ? 'opposite' : 'refuse') : r.via;
    chat.ncb(said || (CLARIFY[kind] || CLARIFY.vague)(r));
    // The requests NCB just named come first, even if they already ran once.
    const named = (r.action === 'clarify' && r.via && r.via !== 'halt') || kind === 'opposite' ? [r.prompt, r.also].filter(Boolean) : [];
    chat.chips([...named, ...flow.remaining().filter((p) => !named.includes(p))], (p) => flow.runPrompt(p, p.chip, false));
  } });

  // The request flow (js/engine/flow.js): phases, the beat bar's state, end cards, what-ifs. The page side of it here.
  flow = createFlow({ scene, store, chat, speed, ui: {
    alive: () => gen === mountGen,
    // The status dot turns red while the line reports a fault; the next status write clears it.
    status: (text, bad) => { statusEl.textContent = text; statusEl.classList.toggle('bad', !!bad); },
    beats({ current, recoverHidden, skippable }) {
      const idx = BEATS.findIndex((b) => b[0] === current);
      beatBtns.forEach((b, i) => {
        if (b.dataset.beat === 'recover') b.hidden = recoverHidden;
        b.classList.toggle('done', i < idx); b.classList.toggle('now', i === idx);
        if (i === idx) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
        b.disabled = !skippable.includes(b.dataset.beat);
      });
    },
    // Discovery and fault effects: the pulse on a faulted device is red, like its ring, and its fault label goes as soon
    // as it is back online (a visitor confirming a stopped cart).
    ping: (id, text, opts) => R.ping(id, text, opts),
    unping: (id, kind) => R.unping?.(id, kind),
    focus: (id, hex) => room.focus?.(id, hex),
    pop: (id) => panel.pop(id),
    track: (on) => panel.track(on),
    rewind: () => panel.rewind(),
    show: (ids) => panel.show(ids),
    resetRoom: () => { room.reset?.(); R.clearMarkers(); }, // markers (rings, fault labels) are not state: drop them too
    clearMarkers: () => R.clearMarkers(),
  } });
  beatBtns.forEach((b) => (b.onclick = () => flow.skipTo(b.dataset.beat)));

  current = { scene, teardown() { flow?.cancel(); R.dispose(); if (window.__ncb?.scene === scene) window.__ncb = null; } };
  // QA hooks (visual harness): the host's phase, the quiet-replay flag and the recorded choices.
  window.__ncb = { store, player: flow.player, scene, R, flow, host: { get phase() { return flow.phase; }, get quiet() { return flow.quiet(); }, get running() { return flow.running; }, lastChoices: flow.lastChoices } };
  await flow.start();
  } catch (e) {
    if (gen === mountGen) current = null;
    flow?.cancel(); R.dispose();
    throw e;
  }
}

// The scene could not start. Most often the browser can't run it (no WebGL 2, or too old for the 3D code); say so in
// plain words where the chat would be, with a way on. The raw error stays in the console.
function showLoadFailure(e) {
  const chatEl = document.getElementById('chat'), st = document.getElementById('status');
  let gl = false; try { gl = !!document.createElement('canvas').getContext('webgl2'); } catch {}
  const msg = String(e?.message || '');
  // A browser that has WebGL 2 and import maps can run the demo: a module that failed to download is the network.
  const modern = gl && typeof HTMLScriptElement !== 'undefined' && !!HTMLScriptElement.supports?.('importmap');
  const kind = modern && /failed to fetch|error loading dynamically imported|importing a module script failed|networkerror/i.test(msg) ? 'network'
    : !gl || /webgl|module specifier|bare specifier|does not resolve|dynamically imported|importing a module|import map/i.test(msg) || e instanceof SyntaxError ? 'browser' : 'bug';
  const T = {
    network: ['The scene didn\'t finish loading', 'The 3D room didn\'t finish loading.', 'Part of the demo didn\'t download, probably a network hiccup. Check your connection and try again.'],
    browser: ['3D view unavailable in this browser', 'Your browser can\'t show the 3D room.', 'This demo needs 3D graphics (WebGL 2) and a recent browser: Safari 16.4 or later, or a current Chrome, Edge or Firefox. If you\'re on one of those, 3D may be switched off or blocked on this device.'],
    bug: ['This scene could not load', 'This scene hit a bug and couldn\'t start.', 'That\'s a problem in this demo, not your device. Try again, or pick another scene.'],
  }[kind];
  if (st) { st.textContent = T[0]; st.classList.add('bad'); }
  app.classList.add('failed'); // no empty room, dashboard or step bar: just the explanation
  if (!chatEl) return;
  chatEl.innerHTML = `<div class="chat-log"><div class="card end fail" role="alert"><h3>${T[1]}</h3>
    <p>${T[2]}</p>
    <div class="row"><button class="btn retry" type="button">Try again</button>${kind === 'browser' ? '' : '<a class="btn" href="#">Other scenes</a>'}<a class="btn primary" href="${KS}" target="_blank" rel="noopener">Watch the video on Kickstarter</a></div></div></div>`;
  chatEl.querySelector('.retry').onclick = () => location.reload();
}

function route() {
  const gen = ++mountGen;
  current?.teardown?.(); current = null;
  const id = location.hash.replace('#', '');
  const meta = SCENES.find((s) => s.id === id);
  if (meta) mountScene(meta, gen).catch((e) => { console.error(e); if (gen === mountGen) showLoadFailure(e); });
  else renderPicker();
  window.scrollTo(0, 0);
}
addEventListener('hashchange', route);
route();
