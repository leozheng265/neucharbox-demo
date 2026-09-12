// Builds every scene's 3D room in Node (fake 2D canvas, stub renderer) and animates it through every prompt,
// so ReferenceErrors, bad state paths in update(), and throwing reset()/focus() are caught without a browser.
// Run via test/run.mjs (which registers test/loader.mjs so 'three' resolves to the vendored copy).
import { createStore } from '../js/engine/store.js';
import { createPlayer, setupSteps } from '../js/engine/player.js';

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

export async function buildChecks({ report, initialOf, stubChat }) {
  globalThis.document ??= { createElement: () => fakeCanvas() };
  globalThis.matchMedia ??= () => ({ matches: false });
  const THREE = await import('three');
  const partsMod = await import('../js/engine/parts.js');
  const { SCENES } = await import('../js/scenes/index.js');
  for (const meta of SCENES) {
    const { default: scene } = await meta.load();
    const problems = [];
    let t = 0; let room = null; let store = null;
    const makeR = () => {
      const scn = new THREE.Scene(); scn.background = new THREE.Color(0xCFDDE6);
      const hemi = new THREE.HemisphereLight(), sun = new THREE.DirectionalLight(), fill = new THREE.DirectionalLight(); scn.add(hemi, sun, fill);
      const camera = new THREE.PerspectiveCamera(scene.camera?.fov ?? 42, 1.5, 0.05, 80);
      const pickIds = new Set();
      return { THREE, scene: scn, camera, controls: { autoRotate: true, target: new THREE.Vector3(), update() {} }, lights: { hemi, sun, fill }, quality: 'high',
        addPickable: (obj, id) => { if (!obj || typeof obj.traverse !== 'function') throw new Error(`addPickable("${id}") got ${obj}`); pickIds.add(id); }, pickIds,
        onPick() {}, onFrame() {}, ping() {}, anchorOf: () => null, resetView() {}, step() {}, daylight(h) { if (!Number.isFinite(h)) throw new Error(`daylight(${h})`); } };
    };
    const update = () => { t += 1 / 30; try { room.update(store.state, t); } catch (e) { throw new Error(`update() threw: ${e.message}`); } };
    const build = () => {
      const init = initialOf(scene); store = createStore(init, { headless: true });
      const R = makeR(); const M = partsMod.materials(); const P = partsMod.parts(R.scene, M);
      room = scene.build({ R, P, M, THREE, store, parts: partsMod });
      if (!room || typeof room.update !== 'function') throw new Error('build() did not return { update }');
      store.subscribe(() => update());
      return R;
    };
    try {
      const R = build(); update();
      for (const id of Object.keys(scene.devices)) if (!R.pickIds.has(id)) problems.push(`device "${id}" has no tappable part (addPickable)`);
      for (const id of Object.keys(scene.devices)) room.focus?.(id);
      const setup = createPlayer({ store, chat: stubChat([]), headless: true }); await setup.play(setupSteps(scene)); const baseline = store.snapshot();
      for (const prompt of scene.prompts) {
        store.restore(baseline); room.reset?.(); update();
        const player = createPlayer({ store, chat: stubChat([]), headless: true });
        try { await player.play(prompt.steps); for (let i = 0; i < 20; i++) update(); }
        catch (e) { problems.push(`"${prompt.chip.slice(0, 32)}": ${e.message}`); }
      }
    } catch (e) { problems.push(`build: ${e.stack?.split('\n').slice(0, 2).join(' | ') || e.message}`); }
    report(`${scene.id} · room builds and animates through every prompt`, problems);
  }
}
