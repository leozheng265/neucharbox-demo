import { createStore } from './engine/store.js';
import { createPlayer, setupSteps } from './engine/player.js';
import { createChat } from './engine/chat.js';
import { createPanel } from './engine/panel.js';
import { matchPrompt } from './engine/match.js';
import { SCENES } from './scenes/index.js';

const KS = 'https://www.kickstarter.com/projects/neucharbox/neucharbox-ai-operating-system-for-the-physical-world?ref=demo';
const BEATS = [['setup', 'Setup'], ['ask', 'Ask'], ['plan', 'Plan'], ['run', 'Run'], ['recover', 'Recover'], ['end', 'Done']];
const app = document.getElementById('app');
let current = null; // { scene, teardown }
let mountGen = 0;   // bumped on every route; an in-flight mount that sees a newer value abandons itself

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

function renderPicker() {
  app.classList.add('picker-mode');
  app.innerHTML = `
    <header class="top"><div class="logo"></div><div class="brand">NeuCharBox</div><div class="scene-name">Live demo</div><div class="spacer"></div><a class="btn primary small" href="${KS}" target="_blank" rel="noopener">Back on Kickstarter</a></header>
    <main class="picker">
      <h1>Try NeuCharBox before it ships.</h1>
      <p class="lede">Pick a place. Plug in the hub, connect what's there, say what you want — or give exact instructions — approve the plan, and watch it run. Then watch what happens when something breaks.</p>
      <div class="scene-grid">${SCENES.map((s, i) => `
        <a class="scene-card" href="#${s.id}" style="--thumb:${s.thumb}"><div class="thumb" data-n="0${i + 1}"></div><div class="body"><h3>${esc(s.title)}</h3><p>${esc(s.promise)}</p>${s.tag ? `<span class="tag">${esc(s.tag)}</span>` : ''}</div></a>`).join('')}
      </div>
      <p class="foot">Everything here is a simulation running in your browser. No account, no data leaves the page. Scenes marked illustrative are typical setups, not a specific customer's.</p>
    </main>`;
}

async function mountScene(meta, gen) {
  app.classList.remove('picker-mode');
  app.innerHTML = `
    <header class="top"><a class="logo" href="#" aria-label="All scenes"></a><a class="brand" href="#" style="text-decoration:none">NeuCharBox</a><div class="scene-name">${esc(meta.title)}</div><div class="spacer"></div><a class="btn small secondary" href="#">Scenes</a><a class="btn primary small" href="${KS}" target="_blank" rel="noopener">Back on Kickstarter</a></header>
    <nav class="beats" id="beats">${BEATS.map(([id, label]) => `<button data-beat="${id}" disabled>${label}</button>`).join('')}</nav>
    <div class="stage">
      <div class="room"><canvas id="room"></canvas><div class="hint">${coarse ? 'drag · pinch · tap a device' : 'drag to orbit · scroll to zoom · right-drag to pan · tap a device'}</div><button class="reset" id="resetView" type="button" title="Reset view">⟲ view</button></div>
      <div class="status" id="status">Loading the ${esc(meta.title.toLowerCase())}…</div>
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
  const R = createRenderer(document.getElementById('room'), { camera: scene.camera });
  const M = partsMod.materials(); const P = partsMod.parts(R.scene, M);
  const room = scene.build({ R, P, M, THREE, store, parts: partsMod });
  R.onFrame((t) => { store.tick(performance.now()); room.update(store.state, t); });
  R.start();

  const statusEl = document.getElementById('status');
  document.getElementById('resetView').onclick = () => R.resetView();
  const nameOf = (id) => (scene.devices[id] ? scene.devices[id].name : id === 'hub' ? 'NeuCharBox' : null);
  const pingDevice = (id) => { const n = nameOf(id); if (!n) return; room.focus?.(id); R.ping(id, n, { hold: 1200 }); };
  const panel = createPanel(document.getElementById('panel'), scene, store, { onSelect: pingDevice });
  R.onPick((id) => { if (scene.devices[id]) panel.select(id); pingDevice(id); });
  // Discovery and fault effects in the room: ring + label at the device, tile pop in the dashboard.
  store.subscribe((state, path, value) => {
    const [id, key] = path.split('.'); if (key !== 'status') return;
    if (id === 'hub' && value === 'on') { R.ping('hub', 'NeuCharBox · powered'); return; }
    if (!scene.devices[id]) return;
    if (value === 'online' && phase === 'setup') { room.focus?.(id); R.ping(id, `${scene.devices[id].name} · connected`); panel.pop(id); }
    if (value === 'fault') { room.focus?.(id); R.ping(id, `${scene.devices[id].name} · ${scene.devices[id].faultText || 'fault'}`, { color: '#E0563A', hex: 0xE0563A, hold: 3200 }); panel.pop(id); }
  });
  const beatsEl = document.getElementById('beats'); const beatBtns = [...beatsEl.querySelectorAll('button')];
  function setBeat(id) { const idx = BEATS.findIndex((b) => b[0] === id); beatBtns.forEach((b, i) => { b.classList.toggle('done', i < idx); b.classList.toggle('now', i === idx); b.disabled = !(i > idx && i < BEATS.length - 1 && phase === 'prompt'); }); }
  let phase = 'setup'; // 'setup' | 'chips' | 'prompt' | 'end'
  const chat = createChat(document.getElementById('chat'), { onPromptText: (text) => { if (phase !== 'chips') return; const { prompt, score } = matchPrompt(text, scene.prompts); runPrompt(prompt, text, score === 0); } });
  const used = new Set();
  const remaining = () => { const left = scene.prompts.filter((p) => !used.has(p)); return left.length ? left : scene.prompts; };
  const player = createPlayer({ store, chat, onBeat: setBeat, onStatus: (s) => { statusEl.textContent = s; }, endOptions: () => ({ onMore: () => offerChips() }) });
  beatBtns.forEach((b) => (b.onclick = () => player.skipTo(b.dataset.beat)));

  let baseline = null; // the room right after setup; every prompt starts from it
  function offerChips() {
    phase = 'chips'; setBeat('ask');
    chat.chips(remaining(), (p) => runPrompt(p, p.chip, false), { heading: used.size ? 'Pick another request for this room, or type your own.' : (scene.askIntro || 'What do you want this place to do? Pick one, or type your own.') });
  }
  async function runPrompt(prompt, typed, fallback) {
    const again = used.size > 0;
    phase = 'prompt'; used.add(prompt); chat.enableInput(false);
    document.querySelectorAll('.chips').forEach((n) => n.remove());
    chat.user(typed);
    if (again && baseline) { store.restore(baseline); room.reset?.(); statusEl.textContent = 'Room reset for a fresh run'; chat.ncb('Fresh start: the room is back the way it was right after setup.'); }
    if (fallback) chat.ncb(`I'll take that as: "${prompt.chip}". (This demo is scripted — a real hub would take your words as they are.)`);
    else if (typed !== prompt.chip) chat.ncb(`Understood — treating that as: "${prompt.chip}".`);
    try {
      await player.play(prompt.steps);
    } catch (e) {
      console.error(e);
      chat.alert('This demo hit a snag running that request. Pick another one, or try another scene.');
      chat.end({ headline: 'Something went wrong in the simulation.', body: 'That is a bug in this demo, not in NeuCharBox. The other requests still work.' }, { onMore: () => offerChips() });
    }
    if (current?.scene !== scene) return;
    phase = 'end'; setBeat('end');
  }

  current = { scene, teardown() { player.cancel(); R.dispose(); if (window.__ncb?.scene === scene) window.__ncb = null; } };
  window.__ncb = { store, player, scene, R };
  statusEl.textContent = 'Hub is off';
  await player.play(setupSteps(scene));
  if (current?.scene !== scene) return;
  baseline = store.snapshot();
  offerChips();
}

function route() {
  const gen = ++mountGen;
  current?.teardown?.(); current = null;
  const id = location.hash.replace('#', '');
  const meta = SCENES.find((s) => s.id === id);
  if (meta) mountScene(meta, gen).catch((e) => { console.error(e); if (gen !== mountGen) return; const st = document.getElementById('status'); if (st) st.textContent = 'Could not load this scene: ' + e.message; });
  else renderPicker();
  window.scrollTo(0, 0);
}
addEventListener('hashchange', route);
route();
