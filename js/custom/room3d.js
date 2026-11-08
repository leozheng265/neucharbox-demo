// The custom room in 3D: an 8 × 6 × 2.8 m shell with one window, the hub on its stand, and one model per layout device
// (devices/index.js). createRoom3d({ R, P, M, THREE, store }) →
//   { sync(layout), update(state, t), focus(id, hex), reset(), objectFor(id), hubObject, pickIds() }
// sync() matches the room to a layout (js/custom/layout.js): it builds what is new, moves what moved and drops what
// left, with its tap target (R.removePickable). Where a device goes follows its type's mount:
//   floor    (x, 0, z), turned rot° about y · ceiling (x, 2.8, z), turned the same way
//   wall     (x, mountY ?? 1.4, z): rot 0 is the back wall (z = -3), facing +z; rot 90 the left wall (x = -4), facing +x
// A wall model hides with its wall when the camera goes round behind it (P.onWall: the renderer owns its .visible).
// Every model sits in a holder that only room3d places, and hides when the device leaves: the renderer keeps a shadow
// twin of each wall-hung mesh, shown while every untagged ancestor of that mesh is visible, so a removed wall device
// takes its shadow with it.
// update() runs every frame; a device with no slice in `state` yet (one just added while building) shows its catalog
// initial state. The page passes its `store` too; the room reads only the state update() is given.
import { typeOf } from './catalog.js';
import { ROOM } from './layout.js';
import { DEVICE_UI } from './devices/index.js';
import { mergeMeshes } from './devices/kit.js';
import { START_HOUR } from './scene.js';

const HX = ROOM.w / 2, HZ = ROOM.d / 2;
const WINDOW = { x: 2.2, y: 1.55, ww: 1.8, wh: 1.36 }; // right of the back wall: wall devices fill it from the left (freeSpot)
// Real point lights in the room at once, in layout order. A lamp past the budget still glows (shade and bulb) but
// lights nothing: twenty point lights in every lit fragment would not stay smooth on a phone.
export const LIGHT_BUDGET = 4;

export function createRoom3d({ R, P, M, THREE }) {
  R.scene.background = new THREE.Color(0xDCEBF3);
  // The floor's planks at Home's scale (its 5 m floor repeats the texture 1.6 times).
  const floorMat = M.floor.clone();
  for (const k of ['map', 'bumpMap']) if (M.floor[k]) { floorMat[k] = M.floor[k].clone(); floorMat[k].repeat.set(1.6 * ROOM.w / 5, 1.6 * ROOM.d / 5); }
  P.roomShell({ w: ROOM.w, d: ROOM.d, h: ROOM.h, floorMat, window: WINDOW });
  // Skirting and crown on the right and front walls too, as in Home: they hide with their walls, a few mm lower than
  // the shell's so no two trims share a face in a corner.
  for (const [th, ty] of [[0.098, 0.049], [0.057, ROOM.h - 0.0295]]) {
    P.onWall(P.flatNormals(P.box(0.02, th, ROOM.d, M.trim, HX - 0.01, ty, 0), -1, 0, 0), -1, 0, -HX);
    P.onWall(P.flatNormals(P.box(ROOM.w - 0.04, th, 0.02, M.trim, 0, ty, HZ - 0.01), 0, 0, -1), 0, -1, -HZ);
  }

  // The hub on a small stand, so a 14 cm box reads from across an 8 m room; the whole stand is its tap target.
  const hub = (() => {
    const top = P.box(0.42, 0.03, 0.42, M.woodLight, 0, 0.435, 0, 0.008);
    const legs = mergeMeshes(THREE, [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => P.box(0.03, 0.42, 0.03, M.black, sx * 0.18, 0.21, sz * 0.18)), M.black, { consume: true });
    const unit = P.hub(0, 0.45, 0);
    const root = P.group(top, legs, unit.group);
    R.addPickable(root, 'hub');
    return { root, ledMat: unit.ledMat, hi: null, shells: null, cut: false };
  })();

  const objs = new Map(); // id → { type, holder, root, model, lights, idle, hi, shells, cut }

  function add(d, ui) {
    const model = ui.model({ THREE, P, M });
    const holder = new THREE.Group(); holder.add(model.root); R.scene.add(holder);
    R.addPickable(model.pick || model.root, d.id);
    const o = { type: d.type, holder, root: model.root, model, lights: [], idle: null, hi: null, shells: null, cut: false };
    model.root.traverse((x) => { if (x.isLight) o.lights.push(x); });
    objs.set(d.id, o);
    return o;
  }
  function place(o, d, mount, ui) {
    const h = o.holder;
    if (mount === 'wall') {
      const left = d.rot === 90;
      h.position.set(d.x, ui.mountY ?? 1.4, d.z); h.rotation.set(0, left ? Math.PI / 2 : 0, 0);
      if (left) P.onWall(o.root, 1, 0, -HX); else P.onWall(o.root, 0, 1, -HZ);
    } else {
      h.position.set(d.x, mount === 'ceiling' ? ROOM.h : 0, d.z); h.rotation.set(0, (d.rot * Math.PI) / 180, 0);
    }
  }
  function drop(id) {
    const o = objs.get(id); if (!o) return;
    R.removePickable(id); R.unping?.(id);
    o.holder.visible = false; o.holder.removeFromParent();
    // its meshes' own geometry (never a sprite's: three shares one geometry across every sprite, labels and glows too)
    o.holder.traverse((x) => { if (x.isMesh && !x.userData.isShell) x.geometry.dispose(); });
    objs.delete(id);
  }

  function sync(layout) {
    hub.root.position.set(layout.hub.x, 0, layout.hub.z);
    const want = new Map(layout.devices.map((d) => [d.id, d]));
    for (const [id, o] of [...objs]) if (want.get(id)?.type !== o.type) drop(id);
    let lit = 0;
    for (const d of layout.devices) {
      const t = typeOf(d.type), ui = DEVICE_UI[d.type]; if (!t || !ui) continue;
      const o = objs.get(d.id) || add(d, ui);
      place(o, d, t.mount, ui);
      for (const L of o.lights) L.visible = lit++ < LIGHT_BUDGET;
    }
  }

  // A tapped device's highlight pulse (parts.js highlighter), made on its first focus: its shells are a second mesh per
  // part, so a room nobody taps carries none. reset() cuts the pulses still running; the next focus brings them back.
  const entry = (id) => (id === 'hub' ? hub : objs.get(id));
  function focus(id, hex) {
    const o = entry(id); if (!o) return;
    if (!o.hi) { o.hi = P.highlighter({ [id]: [o.root] }); o.shells = []; o.root.traverse((x) => { if (x.userData.isShell) o.shells.push(x); }); }
    o.cut = false; o.hi.focus(id, hex);
  }
  const pulse = (o) => { if (!o.hi) return; o.hi.update(); if (o.cut) for (const s of o.shells) s.visible = false; };

  return {
    sync, focus,
    update(state, t) {
      const h = state?.env?.hour; R.daylight(Number.isFinite(h) ? h : START_HOUR);
      const hs = state?.hub, on = hs && (hs.status === 'online' || hs.status === 'on');
      hub.ledMat.emissiveIntensity = on ? (2.5 + Math.sin(t * 2.2) * 1.5) * (Number.isFinite(hs.led) ? hs.led : 1) : 0;
      pulse(hub);
      for (const [id, o] of objs) {
        const s = state?.[id] || (o.idle ||= { ...typeOf(o.type).initial, status: 'online' });
        o.model.update(s, t); pulse(o);
      }
    },
    reset() { for (const o of [hub, ...objs.values()]) if (o.hi) { o.cut = true; for (const s of o.shells) s.visible = false; } },
    objectFor: (id) => (id === 'hub' ? hub.root : objs.get(id)?.holder ?? null),
    hubObject: hub.root,
    pickIds: () => ['hub', ...objs.keys()],
  };
}
