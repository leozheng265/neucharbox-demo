// Builds every scene's 3D room in Node (fake 2D canvas, stub renderer) and animates it through every prompt and, for a
// request with what-ifs, through every what-if (every pick, every option of the scenario's own asks), so
// ReferenceErrors, bad state paths in update() (state that only a failure story writes), and throwing
// reset()/focus() are caught without a browser. build() gets the host's quiet flag (A2), toggled as runWhatIf() does:
// a room that rings (R.ping) or pulses (a highlighter's focus) while a what-if replays quietly fails the check.
// Check 17 (realTimeProblems): the quiet replay puts the room where the request played in REAL time had it. The clean
// run plays on the virtual clock (test/clock.mjs) at normal speed, not fast, with the room updated every frame as the
// page does; it stops at a failure point, and the what-if's replay (fast, as on the page) must match it there. Device
// state (everything but plan.*) must be the same. plan.* holds the visitor's choices and the scene's own bookkeeping
// (a cue that pings the room, say): a difference there only counts if a scenario starting at that point says something
// else from the replayed room than from the room the visitor saw. A tween still moving when the played run reaches the
// failure point fails too: the replay lands it at its end value, so the scenario would start from a room nobody saw.
// Run via test/run.mjs (which registers test/loader.mjs so 'three' resolves to the vendored copy).
import { createStore } from '../js/engine/store.js';
import { createPlayer, setupSteps } from '../js/engine/player.js';
import { hasWhatIf, pickerOf, scenarioOf, runWhatIf, isFailPoint } from '../js/engine/whatif.js';
import { virtualTime } from './clock.mjs';

function fakeCanvas() {
  const ctxState = {};
  const ctx = new Proxy(ctxState, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'measureText') return (s) => ({ width: String(s).length * 22 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (k === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return { width: 300, height: 150, style: {}, getContext: () => ctx, addEventListener() {}, toDataURL: () => '' };
}
let THREE = null, partsMod = null;
async function env() {
  globalThis.document ??= { createElement: () => fakeCanvas() };
  globalThis.matchMedia ??= () => ({ matches: false });
  THREE ??= await import('three');
  partsMod ??= await import('../js/engine/parts.js');
}
// A stub renderer and the scene's room on `store`. noise(kind, id, text) is told of every ring and pulse.
function makeRoom(scene, store, quiet, noise, { speed } = {}) {
  const scn = new THREE.Scene(); scn.background = new THREE.Color(0xCFDDE6);
  const hemi = new THREE.HemisphereLight(), sun = new THREE.DirectionalLight(), fill = new THREE.DirectionalLight(); scn.add(hemi, sun, fill);
  const camera = new THREE.PerspectiveCamera(scene.camera?.fov ?? 42, 1.5, 0.05, 80);
  const pickIds = new Set(), picks = new Map(); // picks: id → the objects the room made tappable for it
  const R = { THREE, scene: scn, camera, controls: { autoRotate: true, target: new THREE.Vector3(), update() {} }, lights: { hemi, sun, fill }, quality: 'high',
    addPickable: (obj, id) => { if (!obj || typeof obj.traverse !== 'function') throw new Error(`addPickable("${id}") got ${obj}`); pickIds.add(id); if (!picks.has(id)) picks.set(id, []); picks.get(id).push(obj); }, pickIds, picks,
    onPick() {}, onFrame() {},
    ping(id, text) { noise('rang', id, text); },
    unping() {}, clearMarkers() {}, anchorOf: () => null, resetView() {}, step() {}, daylight(h) { if (!Number.isFinite(h)) throw new Error(`daylight(${h})`); } };
  const M = partsMod.materials(); const P = partsMod.parts(R.scene, M);
  const highlighter = P.highlighter; // a pulse on a device: parts.js's highlighter focus()
  P.highlighter = (map) => { const h = highlighter(map), focus = h.focus; h.focus = (id, hex) => { noise('pulsed', id); return focus(id, hex); }; return h; };
  const room = scene.build({ R, P, M, THREE, store, parts: partsMod, quiet, ...(speed ? { speed } : {}) });
  if (!room || typeof room.update !== 'function') throw new Error('build() did not return { update }');
  return { R, room };
}
const clone = (v) => JSON.parse(JSON.stringify(v));
// Every path where two states differ: [path, a, b].
function diff(a, b, path = '', out = []) {
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a)) { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], path ? `${path}.${k}` : k, out); }
  else if (JSON.stringify(a) !== JSON.stringify(b)) out.push([path, a, b]);
  return out;
}
// The Edit / ask-option combinations of a prompt's clean run (as test/run.mjs checks 2 and 11 use them).
function combosOf(prompt) {
  const out = [{ label: 'default plan', alts: {}, askIdx: 0 }];
  const plan = prompt.steps.find((s) => s.plan)?.plan;
  for (const [i, ps] of (plan?.steps || []).entries()) if (ps.alt) out.push({ label: `edit #${i + 1}`, alts: { [i]: true }, askIdx: 0 });
  let n = 0; const walk = (steps) => { for (const s of steps || []) { if (s.ask) { n = Math.max(n, s.ask.options.length); for (const o of s.ask.options) walk(o.apply); } if (s.parallel) walk(s.parallel); if (s.plan) for (const ps of s.plan.steps || []) walk(ps.alt?.apply); } };
  walk(prompt.steps); for (let k = 1; k < n; k++) out.push({ label: `ask option ${k + 1}`, alts: {}, askIdx: k });
  return out;
}

// 17. One prompt (with what-ifs) of a scene: every combination, every failure point a pick starts at.
export async function realTimeProblems(scene, prompt, { initialOf, stubChat }) {
  await env();
  const problems = [];
  const store = createStore(initialOf(scene)); let quiet = false, where = '';
  const { room } = makeRoom(scene, store, () => quiet, (kind, id, text) => { if (quiet) problems.push(`${where}: the room ${kind} ${id}${text ? ` "${text}"` : ''} during the quiet replay`); }, { speed: 1 });
  await createPlayer({ store, chat: stubChat([]), headless: true }).play(setupSteps(scene)); room.update(store.state, 0);
  const baseline = store.snapshot();
  const fresh = () => { store.restore(baseline); room.reset?.(); };
  const onFrame = (now) => { store.tick(now); room.update(store.state, now / 1000); };
  const answering = (c) => ({ ...stubChat([]), plan: () => Promise.resolve({ approved: true, alts: c.alts }), ask: () => Promise.resolve(c.askIdx) });
  const picks = [...pickerOf(scene, prompt).devices.map((d) => d.key), ...pickerOf(scene, prompt).specials.map((s) => s.key)].map((k) => scenarioOf(scene, prompt, k)).filter(Boolean);
  const ats = [...new Set(picks.map((sc) => sc.at))];
  // What a scenario says (and shows) when it starts from `state`: to tell a harmless plan.* difference from one that matters.
  const says = async (state, sc) => { const s = createStore(state, { headless: true }), log = []; try { await createPlayer({ store: s, chat: stubChat(log), headless: true }).play(sc.authored ? sc.steps : sc.head); } catch (e) { log.push(['threw', e.message]); } return JSON.stringify(log); };
  for (const c of combosOf(prompt)) for (const at of ats) {
    where = `${c.label} @ "${at}"`;
    const stop = (s) => isFailPoint(s) && s.failPoint === at; let ref = null, rep = null, choices = [], inflight = [];
    try {
      fresh();
      await virtualTime(async () => { const pl = createPlayer({ store, chat: answering(c), speed: 1 }); const r = await pl.play(prompt.steps, { until: stop }); choices = r.choices; if (!r.stopped) throw new Error(`the request played in real time never reached "${at}"`); const mid = clone(store.state); store.finishTweens(); inflight = diff(mid, store.state).filter(([p]) => !p.startsWith('plan.') && p !== 'plan'); }, { onFrame });
      if (inflight.length) problems.push(`${where}: ${inflight.slice(0, 3).map(([p, a, b]) => `${p} is still moving (${JSON.stringify(a)} on its way to ${JSON.stringify(b)})`).join('; ')} when the request played in real time reaches this failure point. The replay lands every tween at once, so a scenario starting here would start from somewhere the visitor never saw: end the tween before the failure point`);
      ref = clone(store.state);
      fresh();
      const key = picks.find((sc) => sc.at === at).key;
      await virtualTime(async () => { const pl = createPlayer({ store, chat: stubChat([]), speed: 1 }); await runWhatIf({ player: pl, scene, prompt, key, choices, host: { quiet: (on) => { quiet = on; }, freshRoom: fresh, clearMarkers: () => { rep = clone(store.state); pl.cancel(); } } }); }, { onFrame });
    } catch (e) { problems.push(`${where}: ${e.message}`); }
    quiet = false;
    if (!ref || !rep) { if (ref && !rep) problems.push(`${where}: the replay never reached the failure point`); continue; }
    const d = diff(ref, rep), dev = d.filter(([p]) => !p.startsWith('plan.') && p !== 'plan'), plan = d.filter(([p]) => p.startsWith('plan.') || p === 'plan');
    const show = ([p, a, b]) => `${p} = ${JSON.stringify(b)} after the replay, ${JSON.stringify(a)} in the request played in real time`;
    if (dev.length) problems.push(`${where}: the quiet replay leaves ${dev.slice(0, 3).map(show).join('; ')}${dev.length > 3 ? ` (+${dev.length - 3} more)` : ''}. A step that writes device state differently when fast (a skip) needs a fallback that lands where the played run does`);
    if (plan.length) for (const sc of picks.filter((x) => x.at === at)) {
      if (await says(ref, sc) !== await says(rep, sc)) { problems.push(`${where}: ${plan.slice(0, 2).map(show).join('; ')}, and the "${sc.key}" scenario says something else from the replayed room`); break; }
    }
  }
  return problems;
}

// Home: a soil probe knocked out of its pot (soil.probeOut, p0's soil what-if) lies outside the pot and on or above
// the floor: no corner of the probe's stake or sensor head inside the pot's tapered cylinder, or below y = 0. The probe
// is the group holding the sensor head the room made tappable for "soil"; the pot is the cylinder tapped for it.
function probeProblems(R, room, store) {
  const objs = R.picks.get('soil') || [], pot = objs.find((o) => o.geometry?.type === 'CylinderGeometry'), head = objs.find((o) => o.geometry?.type?.includes('Box'));
  const probe = head?.parent; if (!pot || !probe || probe === R.scene) return ['the soil probe or its pot was not found (the objects tappable for "soil")'];
  const was = store.get('soil.probeOut'); store.set('soil.probeOut', true); room.update(store.state, 0); R.scene.updateMatrixWorld(true);
  const sc = new THREE.Vector3(), c = new THREE.Vector3(); pot.getWorldScale(sc); pot.getWorldPosition(c);
  const { radiusTop, radiusBottom, height } = pot.geometry.parameters, rt = radiusTop * sc.x, rb = radiusBottom * sc.x, h = height * sc.y, y0 = c.y - h / 2;
  const bad = [];
  for (const m of probe.children.filter((x) => x.isMesh && x.geometry?.type?.includes('Box'))) {
    m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox;
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
      const p = new THREE.Vector3(x, y, z).applyMatrix4(m.matrixWorld), k = (p.y - y0) / h;
      if (p.y < -1e-3) bad.push(`a corner below the floor (y ${p.y.toFixed(3)})`);
      else if (k >= 0 && k <= 1 && Math.hypot(p.x - c.x, p.z - c.z) < rb + (rt - rb) * k) bad.push(`a corner inside the pot (${[p.x, p.y, p.z].map((v) => v.toFixed(3)).join(', ')})`);
    }
  }
  store.set('soil.probeOut', was); room.update(store.state, 0);
  return bad.length ? [`the knocked-out soil probe: ${[...new Set(bad)].slice(0, 3).join('; ')}`] : [];
}

// scenes: scene modules to build (default: every scene in js/scenes/index.js).
export async function buildChecks({ report, initialOf, stubChat, scenes = null }) {
  await env();
  if (!scenes) { const { SCENES } = await import('../js/scenes/index.js'); scenes = []; for (const meta of SCENES) scenes.push((await meta.load()).default); }
  for (const scene of scenes) {
    const problems = [];
    let t = 0; let room = null; let store = null; let quiet = false; let where = '';
    const update = () => { t += 1 / 30; try { room.update(store.state, t); } catch (e) { throw new Error(`update() threw: ${e.message}`); } };
    const build = () => {
      store = createStore(initialOf(scene), { headless: true });
      const built = makeRoom(scene, store, () => quiet, (kind, id, text) => { if (quiet) problems.push(`${where}: the room ${kind} ${id}${text ? ` "${text}"` : ''} during the quiet replay: return early in store hooks while build's quiet() is true`); });
      room = built.room;
      store.subscribe(() => update());
      return built.R;
    };
    try {
      const R = build(); update();
      for (const id of Object.keys(scene.devices)) if (!R.pickIds.has(id)) problems.push(`device "${id}" has no tappable part (addPickable)`);
      for (const id of Object.keys(scene.devices)) room.focus?.(id);
      const setup = createPlayer({ store, chat: stubChat([]), headless: true }); await setup.play(setupSteps(scene)); const baseline = store.snapshot();
      if (scene.id === 'home') problems.push(...probeProblems(R, room, store));
      const fresh = () => { store.restore(baseline); room.reset?.(); update(); };
      for (const prompt of scene.prompts) {
        fresh(); where = `"${prompt.chip.slice(0, 32)}"`;
        const player = createPlayer({ store, chat: stubChat([]), headless: true });
        let choices = [];
        try { choices = (await player.play(prompt.steps)).choices; for (let i = 0; i < 20; i++) update(); }
        catch (e) { problems.push(`${where}: ${e.message}`); continue; }
        if (!hasWhatIf(prompt)) continue;
        const picker = pickerOf(scene, prompt);
        for (const key of [...picker.devices.map((d) => d.key), ...picker.specials.map((s) => s.key)]) {
          const sc = scenarioOf(scene, prompt, key); const asks = [];
          const walk = (steps) => { for (const s of steps || []) { if (s.ask) { asks.push(s.ask); for (const o of s.ask.options) walk(o.apply); } if (s.parallel) walk(s.parallel); } };
          walk(sc?.authored ? sc.steps : []);
          for (let k = 0; k < Math.max(1, ...asks.map((a) => a.options.length)); k++) {
            fresh(); where = `"${prompt.chip.slice(0, 32)}" · what if ${key}${k ? ` (its ask option ${k + 1})` : ''}`;
            const wp = createPlayer({ store, chat: stubChat([]), headless: true, autoAsk: () => k });
            try { await runWhatIf({ player: wp, scene, prompt, key, choices, host: { quiet: (on) => { quiet = on; }, freshRoom: fresh } }); for (let i = 0; i < 20; i++) update(); }
            catch (e) { problems.push(`${where}: ${e.message}`); }
            quiet = false;
          }
        }
      }
    } catch (e) { problems.push(`build: ${e.stack?.split('\n').slice(0, 2).join(' | ') || e.message}`); }
    report(`${scene.id} · room builds and animates through every prompt${scene.prompts.some(hasWhatIf) ? ' and every what-if' : ''}`, problems);
    // 17. the replay against the request played in real time, with the room
    for (const prompt of scene.prompts.filter(hasWhatIf)) {
      let pr; try { pr = await realTimeProblems(scene, prompt, { initialOf, stubChat }); } catch (e) { pr = [`threw: ${e.stack?.split('\n').slice(0, 2).join(' | ') || e.message}`]; }
      report(`${scene.id} · "${prompt.chip.slice(0, 48)}" · the quiet replay puts the room where the request played in real time had it`, pr);
    }
  }
}
