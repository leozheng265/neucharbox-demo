// Scene 3 — Elder care. Proves: sensing without cameras. "Mum's up · 07:11". Failures are opt-in ("What if something
// fails?"): every request runs clean, and each connected device's failure is a what-if (js/engine/whatif.js).

// ── shared ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const HOLD = { wait: 3000 };                                                   // before every scenario's end card
const line = (f) => ({ fn: ({ store, say }) => say(f(store)) });              // an NCB line that depends on a plan Edit
const replanWith = (f) => ({ fn: async ({ chat, store, sleep }) => { chat.replan(f(store)); await sleep(700); } }); // a re-plan card that does
const pat = (st) => !!st.get('plan.neighbour');                                // p0 Edit: Pat also gets the 09:30 message
const hallPct = (st) => (st.get('plan.brighter') ? 50 : 30);                  // p1 Edit: the night-time limit, in %
// Routing (avoid phrases, js/engine/match.js): the kettle plug or a sensor that stops working is a what-if, not one of
// these requests. The words alone can't be ruled out: "fails" is "the auto-off fails" and "she fails to get up by 9:30",
// "breaks" and "broken" the kettle's auto-off, "stops" the kettle stopping after 10 minutes. As phrases, every request
// avoids them, so "let me know if the kettle plug breaks" gets the chips back instead of running the first request on
// "know" (with only the kettle request avoiding them, it did).
const PLUG_FAULT = ['plug stops', 'plug stopped', 'plug breaks', 'plug broke', 'plug broken', 'plug fails', 'plug failed'];
const SENSOR_FAULT = ['sensor fails', 'sensor failed'];
// A device that dies, goes dead or disconnects, as phrases: "dies" or "died" alone would ask back on "since dad died
// she lives alone", a natural thing to say here.
const DEVICE_DEAD = [...['plug', 'sensor', 'light', 'lamp', 'bulb', 'kettle'].flatMap((d) => ['dies', 'died', 'dead', 'disconnects', 'disconnected'].map((v) => `${d} ${v}`)), 'goes dead', 'gone dead'];
const KETTLE_STOPS = ['kettle stops', 'kettle stopped']; // the kettle stopping (working, or after 10 minutes): the first two requests never watch it

// ── p0: Mum's up ────────────────────────────────────────────────────────────────────────────────────────────────────
const P0_TO_0708 = [{ status: 'Tuesday 07:08' }, { tween: 'env.hour', to: 31.13, ms: 2000 }];
const P0_UP = [
  { set: 'mat.pressed', to: false, label: 'Bed sensor → out of bed' }, { wait: 900 },
  { tween: 'door.open', to: 1, ms: 1200, label: 'Bedroom door → open' },
  { set: 'motion.active', to: true, label: 'Hallway → movement' }, { set: 'motion.last', to: '07:11' }, { wait: 800 },
];
const P0_KETTLE_ON = [{ set: 'kettle.on', to: true }, { tween: 'kettle.watts', to: 1850, ms: 600, label: 'Kettle → on' }];
const P0_KETTLE_LINE = line((st) => (pat(st) ? '07:12 — and the kettle\'s on. Normal morning. Nothing goes to Pat: that was only for 09:30.' : '07:12 — and the kettle\'s on. Normal morning.'));
// the 3-minute boil takes the clock to 07:15
const P0_KETTLE_OFF = [{ parallel: [{ tween: 'kettle.minutes', to: 3, ms: 1500 }, { tween: 'env.hour', to: 31.25, ms: 1500 }] }, { set: 'kettle.on', to: false }, { set: 'kettle.watts', to: 0 }, { set: 'kettle.minutes', to: 0 }];

// ── p1: light the way ───────────────────────────────────────────────────────────────────────────────────────────────
const hallOn = (label) => ({ fn: ({ store, tween, status }) => { const b = store.get('plan.brighter') ? 0.5 : 0.3; if (label) status(`Hall light → ${Math.round(b * 100)}%`); return tween('hall.brightness', b, 900); } });
const P1_THROUGH = [{ tween: 'door.open', to: 1, ms: 1000, label: 'Bedroom door → open' }, { set: 'motion.active', to: true }, { set: 'motion.last', to: '02:41' }, { wait: 700 }, { set: 'motion.active', to: false }];
const P1_BACK = [{ status: 'Tuesday 02:49' }, { parallel: [{ tween: 'env.hour', to: 26.82, ms: 800 }, { tween: 'door.open', to: 0, ms: 800 }] }, { set: 'mat.pressed', to: true, label: 'Bed sensor → in bed' }];
const P1_OFF = [{ status: 'Tuesday 02:54' }, { tween: 'env.hour', to: 26.9, ms: 1200 }, { parallel: [{ tween: 'night.brightness', to: 0, ms: 1200 }, { tween: 'hall.brightness', to: 0, ms: 1200 }] }, { set: 'night.on', to: false }, { set: 'hall.on', to: false }];
// a door contact with a loose magnet: seven changes in about two seconds, no labels (the door itself opens once: door.leaf)
const FLICKER = { fn: async ({ store, sleep }) => { for (const v of [1, 0, 1, 0, 1, 0, 1]) { store.set('door.open', v); await sleep(280); } } };

// ── p2: the kettle ──────────────────────────────────────────────────────────────────────────────────────────────────
const P2_UP = [{ set: 'mat.pressed', to: false }, { set: 'motion.last', to: '07:10' }, { tween: 'door.open', to: 1, ms: 700 }]; // she's up: bed, hallway and door agree
const P2_BOIL_ON = [{ set: 'kettle.on', to: true }, { tween: 'kettle.watts', to: 1850, ms: 500, label: 'Kettle → on' }];
const P2_BOIL_OFF = [
  { parallel: [{ tween: 'kettle.minutes', to: 3, ms: 1500 }, { tween: 'env.hour', to: 31.25, ms: 1500 }] }, // the 3-minute boil takes the clock to 07:15
  { set: 'kettle.on', to: false }, { set: 'kettle.watts', to: 0 }, { set: 'kettle.minutes', to: 0 },
  { status: 'Tuesday 07:15' }, { say: '07:15 — the kettle was on for 3 minutes, then off. A normal boil, ignored as planned.' },
];
const P2_TENMIN = { parallel: [{ tween: 'kettle.minutes', to: 10, ms: 2600 }, { tween: 'env.hour', to: 42.2, ms: 2600 }] };
const P2_AT_TEN = { fn: ({ chat, store }) => chat.ncb(store.get('plan.warnFirst') ? '18:12 — the kettle has been drawing 1,850 W for 10 minutes. Messaging you first, as you chose. I\'ll switch it off at 18:17 if it\'s still on.' : '18:12 — the kettle has been drawing 1,850 W for 10 minutes. Switching it off at the plug.') };
const P2_WARN = { fn: async ({ store, chat, tween, sleep, status }) => {
  if (!store.get('plan.warnFirst')) return;
  await Promise.all([tween('kettle.minutes', 15, 1600), tween('env.hour', 42.28, 1600)]);
  status('Tuesday 18:17'); chat.ncb('18:17 — still on, still drawing 1,850 W. Switching it off at the plug.'); await sleep(1500);
} };
// "off" is confirmed by the meter falling to 0 W, not by the plug's word (plan line 2): the label comes after the fall
const P2_OFF = [{ status: 'Kettle plug: sending "off"…' }, { wait: 900 }, { tween: 'kettle.watts', to: 0, ms: 700 }, { set: 'kettle.on', to: false, label: 'Kettle plug → off · 0 W, confirmed' }, { set: 'kettle.minutes', to: 0 }, { wait: 800 }];
const offAt = (st) => (st.get('plan.warnFirst') ? '18:17' : '18:12');
// the message the plan promised: about the kettle, nothing else (no sensor readings ride along)
const P2_MESSAGE = line((st) => (st.get('plan.warnFirst')
  ? 'Off, and confirmed: the plug says off and the meter reads 0 W. Messaged you again: "It was still on at 18:17, so I switched it off at the plug."'
  : 'Off, and confirmed: the plug says off and the meter reads 0 W. Messaged you: "Mum\'s kettle was on for 10 minutes, so I switched it off at the plug at 18:12."'));

// ── room-building helpers (inlined, so the scene needs no extra import) ─────────────────────────────────────────────
// Place a loaded model by its bounding box (js/engine/assets.js place()), as home.js does.
function placeModel(THREE, obj, { x = 0, y = 0, z = 0, rotY = 0, s = 1, centreY = false } = {}) {
  obj.rotation.y = rotY; obj.scale.setScalar(s); obj.position.set(0, 0, 0); obj.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(obj), c = b.getCenter(new THREE.Vector3());
  obj.position.set(x - c.x, centreY ? y - c.y : y - b.min.y, z - c.z); obj.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(obj);
}
// A rounded box as one smooth mesh (as js/custom/devices/elder.js): radius r, `seg` samples per 45° of bend, `div` cuts
// across the flat part (for a shape that is deformed afterwards, the pillow). UVs run 0–1 across each face, or in
// metres × uvScale (wood grain). Far fewer triangles than RoundedBoxGeometry.
function rbox(THREE, w, h, d, r, { seg = 2, div = [1, 1, 1], uvScale = 0 } = {}) {
  const half = [w / 2, h / 2, d / 2];
  r = Math.max(1e-4, Math.min(r, ...half.map((x) => x - 1e-4)));
  const a = half.map((x) => x - r), bend = (k) => r * Math.tan((k / seg) * (Math.PI / 4));
  const axis = (i) => { const s = []; for (let k = seg; k >= 1; k--) s.push(-a[i] - bend(k)); for (let j = 0; j <= div[i]; j++) s.push(-a[i] + (2 * a[i] * j) / div[i]); for (let k = 1; k <= seg; k++) s.push(a[i] + bend(k)); return s; };
  const S = [0, 1, 2].map(axis), pos = [], nrm = [], uv = [], idx = [], p = [0, 0, 0], q = [0, 0, 0];
  for (let n = 0; n < 3; n++) for (const sg of [1, -1]) {
    const u = sg > 0 ? (n + 1) % 3 : (n + 2) % 3, v = sg > 0 ? (n + 2) % 3 : (n + 1) % 3, U = S[u], V = S[v], base = pos.length / 3;
    for (let j = 0; j < V.length; j++) for (let i = 0; i < U.length; i++) {
      p[n] = sg * half[n]; p[u] = U[i]; p[v] = V[j];
      for (let k = 0; k < 3; k++) q[k] = p[k] - Math.max(-a[k], Math.min(a[k], p[k]));
      const L = Math.hypot(q[0], q[1], q[2]);
      for (let k = 0; k < 3; k++) { nrm.push(q[k] / L); pos.push(p[k] - q[k] + (q[k] / L) * r); }
      uv.push(uvScale ? U[i] * uvScale : (U[i] + half[u]) / (2 * half[u]), uvScale ? V[j] * uvScale : (V[j] + half[v]) / (2 * half[v]));
    }
    for (let j = 0; j < V.length - 1; j++) for (let i = 0; i < U.length - 1; i++) { const A = base + j * U.length + i, B = A + 1, C = A + U.length + 1, D = A + U.length; idx.push(A, B, C, A, C, D); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
  return geo;
}
// A turned profile [[r, y], …] about y, walked with the solid on the left (r to the right, y up) so faces point out.
const lathe = (THREE, pts, n = 48) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), n);
// A loose piece for merge(): a mesh at (x, y, z), rotated, not in the scene.
const piece = (THREE, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); return m; };
// Static parts in one material as one mesh (one draw call); the pieces' geometries are freed.
function merge(THREE, pieces, material) {
  const pos = [], nrm = [], uvs = [], idx = [], v = new THREE.Vector3(), nm = new THREE.Matrix3();
  for (const m of pieces) {
    m.updateMatrix(); nm.getNormalMatrix(m.matrix);
    const g = m.geometry, Pa = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, base = pos.length / 3;
    for (let i = 0; i < Pa.count; i++) {
      v.fromBufferAttribute(Pa, i).applyMatrix4(m.matrix); pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nrm.push(v.x, v.y, v.z);
      uvs.push(U ? U.getX(i) : 0, U ? U.getY(i) : 0);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i)); else for (let i = 0; i < Pa.count; i++) idx.push(base + i);
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geo.setIndex(idx);
  const out = new THREE.Mesh(geo, material); out.castShadow = out.receiveShadow = true; return out;
}
const smooth = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
// The duvet as one draped sheet (js/custom/devices/elder.js duvetGeo), here turned down: it covers the bed from the
// sleep sensor's foot edge to the foot, rolled over the sides and the foot and hanging down, with a double layer along
// its turned-down head edge, so the sensor strip across the middle of the mattress stays in view. Bed-local metres.
function fold(t, flat, rr, hang) {
  if (t <= flat) return [t, 0];
  const s = t - flat, arc = (rr * Math.PI) / 2;
  if (s <= arc) return [flat + rr * Math.sin(s / rr), rr * (1 - Math.cos(s / rr))];
  return [flat + rr, rr + Math.min(s - arc, hang)];
}
function duvetGeo(THREE, B) {
  const arcX = (B.rollX * Math.PI) / 2, arcH = (B.rollH * Math.PI) / 2, arcF = (B.rollF * Math.PI) / 2;
  const HL = (B.footZ - B.headZ) / 2, ZC = (B.footZ + B.headZ) / 2, SX = B.flatX + arcX + B.hangX;
  const axis = (start, pieces) => { const s = [start]; let at = start; for (const [len, n] of pieces) { for (let i = 1; i <= n; i++) s.push(at + (len * i) / n); at += len; } return s; };
  const xs = axis(-SX, [[B.hangX, 2], [arcX, 4], [2 * B.flatX, 18], [arcX, 4], [B.hangX, 2]]);
  const zs = axis(-(HL + arcH + B.hangH), [[B.hangH, 1], [arcH, 4], [2 * HL, 16], [arcF, 4], [B.hangF, 2]]);
  const z0 = zs[0], zSpan = zs[zs.length - 1] - z0, pos = [], uv = [], idx = [];
  for (const q of zs) for (const s of xs) {
    const [hx, dx] = fold(Math.abs(s), B.flatX, B.rollX, B.hangX);
    const [hz, dz] = q < 0 ? fold(-q, HL, B.rollH, B.hangH) : fold(q, HL, B.rollF, B.hangF);
    let x = Math.sign(s) * hx, z = q < 0 ? ZC - hz : ZC + hz;
    const k = smooth((B.flatX - hx) / 0.14) * smooth((HL - hz) / 0.12);
    const turn = 0.02 * (1 - smooth((z - B.headZ - 0.15) / 0.06)); // the turned-down fold: two layers thick
    const loft = 0.012 + turn + k * (0.02 + 0.007 * Math.cos((Math.PI * (z - B.headZ)) / 0.25) ** 2 + 0.003 * Math.sin(x * 9 + z * 4) * Math.sin(z * 7));
    const y = B.top + loft - Math.max(dx, dz);
    if (dx > B.rollX) x += Math.sign(s) * 0.007 * Math.sin(z * 17) * ((dx - B.rollX) / B.hangX); // soft vertical folds in the drapes
    if (dz > B.rollF && q > 0) z += 0.007 * Math.sin(x * 17) * ((dz - B.rollF) / B.hangF);
    pos.push(x, y, z); uv.push((s + SX) / (2 * SX), (q - z0) / zSpan);
  }
  const nu = xs.length;
  for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < nu - 1; i++) { const A = j * nu + i, Bq = A + 1, C = A + nu + 1, D = A + nu; idx.push(A, D, C, A, C, Bq); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  return geo;
}
// A canvas texture drawn by draw(g, w, h).
function canvasTex(THREE, draw, w = 128, h = 128) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

export default {
  id: 'elder',
  title: 'Elder care',
  startHour: 21.5,
  // Looks down over the partition from the hall side, so the bed, night light, door, hallway sensor and kettle are all
  // in view; the sway stays on the hall side (the motion sensor faces the hall) and high enough to see over the partition.
  camera: { position: [0.57, 6.13, 3.87], target: [0.3, 0.9, -1.5], minDistance: 2.5, maxDistance: 8, azimuth: [0.0, 0.22], fov: 48, fitAspect: 1.3 },
  setupIntro: 'Your mum\'s flat: bedroom on the left, hallway, kitchen on the right. No cameras anywhere. The hub is on the kitchen counter. Plug it in to start.',
  askIntro: 'What do you want to know, or have happen, without putting a camera in her home? Pick one, or type your own.',
  deviceOrder: ['mat', 'door', 'motion', 'kettle', 'night', 'hall'],
  devices: {
    mat:    { icon: 'bed', name: 'Bed sensor', ref: 'the bed sensor', initial: { pressed: true }, format: (s) => (s.pressed ? 'in bed' : 'out of bed'), faultText: 'no signal' },
    door:   { icon: 'door', name: 'Bedroom door', ref: 'the bedroom door sensor', initial: { open: 0 }, format: (s) => (s.open > 0.5 ? 'open' : 'closed'), faultText: 'no signal', control: (s) => ({ kind: 'switch', field: 'open', on: s.open > 0.5 }) }, // a contact sensor reads open/closed, not a level; > 0.5 matches its format text (the declarative switch form would read 0.3 as open)
    motion: { icon: 'motion', name: 'Hallway motion', ref: 'the hallway motion sensor', initial: { active: false, last: '—' }, format: (s) => (s.active ? 'movement now' : `last ${s.last}`), faultText: 'offline' },
    kettle: { icon: 'kettle', name: 'Kettle plug', ref: 'the kettle plug', initial: { on: false, watts: 0, minutes: 0 }, format: (s) => (s.on ? `on · ${Math.round(s.watts).toLocaleString('en-GB')} W · ${s.minutes.toFixed(0)} min` : 'off'), faultText: 'off the network' },
    night:  { icon: 'bulb', name: 'Night light', ref: 'the night light', initial: { on: false, brightness: 0 }, active: (s) => s.brightness > 0.02, format: (s) => (s.brightness > 0.02 ? `on · ${Math.round(s.brightness * 100)}%` : 'off'), faultText: 'off the network' },
    hall:   { icon: 'bulb', name: 'Hall light', ref: 'the hall light', initial: { on: false, brightness: 0 }, active: (s) => s.brightness > 0.02, format: (s) => (s.brightness > 0.02 ? `on · ${Math.round(s.brightness * 100)}%` : 'off'), faultText: 'off the network' },
  },

  // Real-world assets (js/engine/assets.js, assets/CREDITS.md). Without them (Node tests, a failed download) the flat
  // builds from primitives and code-built furniture.
  assets: {
    models: ['painted_wooden_nightstand', 'ArmChair_01', 'vintage_electric_kettle', 'wooden_table_02', 'potted_plant_02', 'potted_plant_04', 'hanging_picture_frame_02'],
    textures: ['wood_floor', 'painted_plaster_wall', 'poly_wool_herringbone'],
    hdri: 'charolettenbrunn_park_2k.hdr',
  },

  build({ R, P, M, THREE, store, parts, quiet, assets = null }) {
    const isQuiet = typeof quiet === 'function' ? quiet : () => false; // true while a what-if replays the request quietly (A2)
    const A = assets?.models ? assets : null, MOD = (id) => A?.models[id] || null, TX = (id) => A?.textures?.[id] || null;
    const pbr = (id, rep, extra = {}) => { const set = TX(id); if (!set) return null; const m = {}; for (const k of ['map', 'normalMap', 'roughnessMap']) if (set[k]) { const t = set[k].clone(); t.repeat.set(...rep); t.needsUpdate = true; m[k] = t; } return new THREE.MeshStandardMaterial({ ...m, roughness: 1, ...extra }); };
    const put = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return P.add(m); }; // in the scene, casting and taking shadows
    const pc = (geo, x, y, z, rx, ry, rz) => piece(THREE, geo, x, y, z, rx, ry, rz);
    // The view out of the kitchen window: the photographed garden (HDRI), dimmed with the clock by R.daylight. Without it,
    // the flat keeps its plain background colour.
    if (A?.hdri && R.useHDRBackground) R.useHDRBackground(A.hdri, { rotation: Math.PI });
    // Oak boards (2 m per tile) and white paint over the plaster's relief only (the photo's grey wash dropped), as in Home.
    const floorMat = pbr('wood_floor', [3.5, 2.5], { roughness: 0.9 }), wallMat = pbr('painted_plaster_wall', [3, 1.3], { color: 0xF2EEE7 }); if (wallMat) { wallMat.map = null; wallMat.normalScale.set(0.6, 0.6); }
    // ceilShadows: the pendant's shade and the lamp shade darken the ceiling above them instead of leaving a hot spot
    const shell = P.roomShell({ w: 7, d: 5, h: 2.7, window: { x: 1.9, y: 1.6, ww: 1.4, wh: 1.1 }, ceilShadows: true, ...(floorMat ? { floorMat } : {}), ...(wallMat ? { wallMat } : {}) });
    // The photo has its own trees and lawn: the shell's go. Without it, the garden's trees stand 12–15 m back for eye-level
    // cameras; from up here their tops still showed at the top of the frame, over the back wall, so they go further back.
    if (A?.hdri) { for (const t of shell.trees) t.removeFromParent(); shell.ground?.removeFromParent(); } else for (const t of shell.trees) t.position.z -= 9;
    // partition between bedroom and hall with a doorway, in the shell's wall material: like the walls (and the door leaf,
    // below) it casts shadows from both faces. Cast from its far face only, a lamp on one side lit a thin line along the
    // partition's foot and up its corner with the back wall on the other side.
    const wallM = shell.walls.left.material;
    P.box(0.12, 2.7, 1.5, wallM, -0.5, 1.35, -1.75); P.box(0.12, 2.7, 2.5, wallM, -0.5, 1.35, 1.25); P.box(0.12, 0.6, 1.0, wallM, -0.5, 2.4, -0.5);
    // Its top (level with the ceiling, which is see-through from above) was the only wall face the sun lit straight on: in
    // daylight it blew out into a glowing bar with a star at the back wall. A matte cut-colour cap covers it and the crowns
    // either side, facing up only, so from inside the room (under the ceiling) it never shows.
    const cap = new THREE.Mesh(new THREE.PlaneGeometry(0.164, 5.0), new THREE.MeshStandardMaterial({ color: 0xB9B4AC, roughness: 1 })); cap.rotation.x = -Math.PI / 2; cap.position.set(-0.5, 2.702, 0); R.scene.add(cap);
    // Skirting and crown where the shell leaves the walls bare (it trims the back and left walls only): the right and
    // front walls, whose trims hide with them, and both faces of the partition, where the skirting is 1 cm deep (flush
    // with the door casing it stops at). A few mm lower than the shell's, so no two trims share a face in a corner.
    const trim = (w, h, d, x, y, z, nx, nz) => P.flatNormals(P.box(w, h, d, M.trim, x, y, z), nx, 0, nz);
    for (const [h, y, pd] of [[0.098, 0.049, 0.01], [0.057, 2.6705, 0.02]]) { // skirting, crown; pd: depth on the partition
      P.onWall(trim(0.02, h, 5, 3.49, y, 0, -1, 0), -1, 0, -3.5);
      for (const [x0, x1] of [[-3.5, -0.56 - pd], [-0.44 + pd, 3.48]]) P.onWall(trim(x1 - x0, h, 0.02, (x0 + x1) / 2, y, 2.49, 0, -1), 0, -1, -2.5);
      for (const sx of [-1, 1]) { // the partition's faces (x = -0.56, -0.44); the skirting stops at the door casing, the crown runs over the header
        const x = -0.5 + sx * (0.06 + pd / 2);
        for (const [z0, z1] of pd < 0.02 ? [[-2.5, -1.03], [0.03, 2.5]] : [[-2.5, 2.5]]) {
          const m = trim(pd, h, z1 - z0, x, y, (z0 + z1) / 2, sx, 0), n = m.geometry.attributes.normal;
          // a crown's top shows from above, beside the partition's own top: it shades as that top does (box vertices
          // 8–11 are the +y face), not as the dark strip its face's normal made of it
          if (pd === 0.02) for (let i = 8; i < 12; i++) n.setXYZ(i, 0, 1, 0);
          // the ends (16–19 +z, 20–23 −z) show where the partition meets the front and back walls, seen from outside:
          // they shade as the partition's own end does (with the bedroom face's normal, the crown's end was a dark block)
          for (let i = 16; i < 24; i++) n.setXYZ(i, 0, 0, i < 20 ? 1 : -1);
          n.needsUpdate = true;
        }
      }
    }
    // Door casing, as a bedroom half and a hall half that each shade as the face they show (P.flatNormals). One box across
    // the partition had 1 cm side strips that broke into dashes on phones, and the hall light lit the bedroom half's strip
    // with the door shut.
    for (const sx of [-1, 1]) { const cx = -0.5 + sx * 0.035; for (const [h, d, y, z] of [[2.12, 0.06, 1.06, -1.0], [2.12, 0.06, 1.06, 0.0], [0.06, 1.06, 2.11, -0.5]]) P.flatNormals(P.box(0.07, h, d, M.trim, cx, y, z), sx, 0, 0); }
    const doorPivot = new THREE.Group(); doorPivot.position.set(-0.5, 0, -0.97); R.scene.add(doorPivot);
    // the leaf fills the frame (up into the head trim, across to the latch jamb): with a gap, the hall light drew a thin
    // stripe across the bedroom walls through it while the door was shut
    const doorM = M.door.clone(); doorM.shadowSide = THREE.DoubleSide; doorM.color.set(0xF1EEE8); doorM.roughness = 0.45;
    const doorLeaf = new THREE.Mesh(new THREE.BoxGeometry(0.04, 2.09, 0.94), doorM); doorLeaf.position.set(0, 1.045, 0.47); doorLeaf.castShadow = doorLeaf.receiveShadow = true; doorPivot.add(doorLeaf);
    // A painted four-panel leaf (as the custom bedroom_door): raised fields 6 mm proud on both faces, a shade deeper than
    // the stiles and rails, which are the leaf itself; a satin-nickel lever on a rose each side (in the lock rail, where
    // the knobs were) and three hinges on the bedroom face's hinge edge (the leaf swings into the bedroom).
    const nickel = new THREE.MeshStandardMaterial({ color: 0xB9BDC1, metalness: 1, roughness: 0.28 });
    {
      const panelM = doorM.clone(); panelM.color.set(0xE6E2DA);
      const fields = []; for (const sx of [-1, 1]) for (const [z, y, h] of [[0.275, 1.535, 0.8], [0.665, 1.535, 0.8], [0.275, 0.57, 0.7], [0.665, 0.57, 0.7]]) fields.push(pc(rbox(THREE, 0.012, h, 0.27, 0.005, { seg: 1 }), sx * 0.02, y, z));
      doorPivot.add(merge(THREE, fields, panelM));
      const hw = [];
      for (const sx of [-1, 1]) {
        const cyl = (r, h, x) => pc(new THREE.CylinderGeometry(r, r, h, 24), x, 1.0, 0.86, 0, 0, Math.PI / 2); // along x
        hw.push(cyl(0.026, 0.008, sx * 0.024), cyl(0.009, 0.05, sx * 0.045), pc(rbox(THREE, 0.022, 0.017, 0.125, 0.0075), sx * 0.069, 1.0, 0.8075));
        hw.push(pc(new THREE.CylinderGeometry(0.016, 0.016, 0.006, 20), sx * 0.023, 0.85, 0.86, 0, 0, Math.PI / 2)); // key rose
      }
      for (const y of [0.25, 1.05, 1.85]) hw.push(pc(new THREE.CylinderGeometry(0.007, 0.007, 0.09, 12), -0.024, y, 0.004));
      const hardware = merge(THREE, hw, nickel); hardware.castShadow = false; doorPivot.add(hardware); // in the leaf's shadow: the hall light doesn't reach the bedroom lever
    }
    // door contact on the hall face of the latch jamb, glossy white, its magnet on the leaf beside it
    const sensorM = new THREE.MeshPhysicalMaterial({ color: 0xF4F5F2, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.15 });
    const contact = put(rbox(THREE, 0.016, 0.065, 0.024, 0.005), sensorM, -0.422, 1.98, 0.0);
    { const magnet = new THREE.Mesh(rbox(THREE, 0.01, 0.04, 0.014, 0.003, { seg: 1 }), sensorM); magnet.position.set(0.025, 1.98, 0.915); magnet.castShadow = false; magnet.receiveShadow = true; doorPivot.add(magnet); }
    // bedroom: bed, bedside table, night light, rug, picture, plant
    // The bed (as the custom bed_sensor): a single bed, 1 × 2 m, head against the back wall. An oak frame with a boarded
    // headboard, a mattress in a fitted sheet with piping, a pillow and a duvet with a soft sheen, turned down to the foot
    // so the sleep sensor across the middle of the mattress shows its state. Built in the bed's own frame (origin on the
    // floor at the bed's centre, head toward -z).
    const bed = new THREE.Group(); bed.position.set(-2.3, 0, -1.48); R.scene.add(bed);
    const inBed = (m, shadow = true) => { m.castShadow = shadow; m.receiveShadow = true; bed.add(m); return m; };
    {
      const W = { seg: 1, uvScale: 1.5 }, F = (w, h, d, r, x, y, z) => pc(rbox(THREE, w, h, d, r, W), x, y, z);
      inBed(merge(THREE, [
        ...[-1, 1].map((sx) => F(0.065, 1.0, 0.065, 0.012, sx * 0.4675, 0.5, -0.9675)), // head posts (the legs too)
        F(1.0, 0.07, 0.065, 0.02, 0, 0.965, -0.9675), F(0.87, 0.07, 0.05, 0.01, 0, 0.3, -0.9675), // cap and lower rail
        ...[0, 1, 2, 3, 4].map((i) => F(0.174, 0.6, 0.024, 0.006, -0.348 + i * 0.174, 0.63, -0.968)), // boards: their rounded edges read as V-grooves
        ...[-1, 1].map((sx) => F(0.04, 0.13, 1.87, 0.008, sx * 0.48, 0.185, 0)), // side rails
        ...[-1, 1].map((sx) => F(0.065, 0.29, 0.065, 0.012, sx * 0.4675, 0.145, 0.9675)), F(0.87, 0.15, 0.04, 0.008, 0, 0.175, 0.97), // low foot end
        F(0.9, 0.025, 1.8, 0.004, 0, 0.24, 0), // the slatted base the mattress lies on
      ], M.woodLight));
    }
    const piping = canvasTex(THREE, (g, w, h) => { g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, w, h); g.strokeStyle = '#D9D7D1'; g.lineWidth = 3; g.strokeRect(7, 7, w - 14, h - 14); });
    const mattress = inBed(new THREE.Mesh(rbox(THREE, 0.93, 0.2, 1.87, 0.045), new THREE.MeshPhysicalMaterial({ color: 0xF1F0EC, map: piping, roughness: 0.92, sheen: 0.6, sheenRoughness: 0.6, sheenColor: 0xFFFFFF })));
    mattress.position.set(0, 0.352, 0); // top at 0.452
    const fabric = (hex, bump) => new THREE.MeshPhysicalMaterial({ color: hex, roughness: 0.92, sheen: 1, sheenRoughness: 0.45, sheenColor: 0xFFFFFF, bumpMap: M.cushion.bumpMap, bumpScale: bump });
    {
      // the pillow: a soft box squeezed thin toward its edges
      const pg = rbox(THREE, 0.6, 0.13, 0.38, 0.055, { seg: 2, div: [5, 1, 3] }), pp = pg.attributes.position;
      for (let i = 0; i < pp.count; i++) { const k = Math.max(Math.abs(pp.getX(i)) / 0.3, Math.abs(pp.getZ(i)) / 0.19); pp.setY(i, pp.getY(i) * (1 - 0.5 * Math.min(1, k) ** 3)); }
      pg.computeVertexNormals();
      const pillow = inBed(new THREE.Mesh(pg, fabric(0xF7F5F1, 0.25))); pillow.position.set(0, 0.512, -0.75); pillow.rotation.y = 0.03;
      const duvetMat = fabric(0xD4E0DF, 0.35); duvetMat.side = THREE.DoubleSide; duvetMat.sheenColor.setHex(0xF4FAFA);
      inBed(new THREE.Mesh(duvetGeo(THREE, { top: 0.452, flatX: 0.447, rollX: 0.045, hangX: 0.15, headZ: 0.22, rollH: 0.03, hangH: 0.004, footZ: 0.917, rollF: 0.045, hangF: 0.15 }), duvetMat));
    }
    // the sleep sensor: a pressure strip across the middle of the mattress, left uncovered so its state shows, with its
    // lead down the hall side to the controller (below)
    const matMat = M.black.clone(); matMat.metalness = 0.1; matMat.roughness = 0.8;
    const mat = inBed(new THREE.Mesh(rbox(THREE, 0.9, 0.008, 0.5, 0.003, { seg: 1 }), matMat), false); mat.position.set(0, 0.457, -0.12);
    const cordM = new THREE.MeshStandardMaterial({ color: 0xE9EBEA, roughness: 0.5 });
    inBed(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([[0.44, 0.457, 0.0], [0.468, 0.445, 0.05], [0.472, 0.36, 0.2], [0.49, 0.262, 0.5], [0.506, 0.2, 0.7]].map((p) => new THREE.Vector3(...p))), 24, 0.0025, 6), cordM), false);
    // Bedside table: the painted wooden nightstand, back to the wall (else a small table); the night light stands on its top.
    const standModel = MOD('painted_wooden_nightstand'); let standTop = 0.57;
    if (standModel) { R.scene.add(standModel); standTop = placeModel(THREE, standModel, { x: -1.5, z: -2.235 }).max.y; } else P.table(-1.5, -2.2, 0.45, 0.4, 0.55, M.woodLight, M.woodLight);
    // night light: the floor-lamp parts cut down to a small table lamp on the bedside table (its origin 8 mm under the
    // top). A glazed ceramic base in a pale aqua, a brushed-brass stem and a linen drum shade with a weave you can see;
    // shaded: the shade blocks its bulb (P.floorLamp; on phones, see the spot lights below)
    const nl = P.floorLamp(-1.5, -2.2, { y: standTop - 0.008, height: 0.643, shadeScale: 0.5, base: false, shaded: true }); nl.bulb.distance = 4;
    nl.pole.material = new THREE.MeshPhysicalMaterial({ color: 0xC9A46A, metalness: 1, roughness: 0.32, clearcoat: 0.3, clearcoatRoughness: 0.3 });
    const nlBase = new THREE.Mesh(lathe(THREE, [[0, 0.008], [0.05, 0.008], [0.056, 0.014], [0.068, 0.045], [0.074, 0.09], [0.07, 0.13], [0.052, 0.17], [0.03, 0.2], [0.022, 0.215], [0.024, 0.225], [0, 0.226]], 40),
      new THREE.MeshPhysicalMaterial({ color: 0xDCEBE8, roughness: 0.22, clearcoat: 0.9, clearcoatRoughness: 0.08 })); // tapping it picks the lamp
    nlBase.castShadow = nlBase.receiveShadow = true; nl.group.add(nlBase);
    for (const sm of [nl.shadeMat, nl.skin?.material]) if (sm) { sm.bumpMap = M.cushion.bumpMap; sm.bumpScale = 0.6; sm.needsUpdate = true; }
    // The walls are single-sided (a cut-away): what hangs on a wall hides with it when the camera orbits behind that wall
    // (userData.wall, renderer.js). The shell tags its own window, trims and trees, P.picture its frame; the right and
    // front trims are tagged above, the picture frame, the upper cabinets and the kettle plug below.
    // The rug: its pattern drawn in code over a real wool weave's relief, above the floor's contact shadows.
    const rugMat = pbr('poly_wool_herringbone', [3.3, 2.5]); if (rugMat) { rugMat.map = M.rug.map; rugMat.normalScale.set(1.4, 1.4); }
    if (rugMat) { const rug = P.box(1.6, 0.012, 1.2, rugMat, -2.0, 0.006, -0.2); rug.castShadow = false; } else P.rug(-2.0, -0.2, 1.6, 1.2);
    R.addContactShadows?.({ w: 7, d: 5, y: rugMat ? 0.016 : 0.009 }); // the soft dark where furniture meets the floor (renderer.js)
    const frame = MOD('hanging_picture_frame_02');
    if (frame) {
      R.scene.add(frame);
      frame.traverse((o) => { if (o.isMesh && /glass/.test(o.material.name)) { o.material = new THREE.MeshPhysicalMaterial({ color: 0xFFFFFF, roughness: 0.04, transparent: true, opacity: 0.1 }); o.castShadow = false; o.userData.noAO = true; } });
      const fb = placeModel(THREE, frame, { x: 0, y: 1.6, z: -1.2, rotY: Math.PI / 2, s: 0.85, centreY: true }); frame.position.x += -3.499 - fb.min.x; P.onWall(frame, 1, 0, -3.5);
    } else P.picture(-3.48, 1.6, -1.2, 0.6, 0.45);
    const plant = MOD('potted_plant_02'); if (plant) { plant.position.set(-3.0, 0, 1.95); plant.rotation.y = 0.6; R.scene.add(plant); } // in the bedroom's front corner
    // hallway: motion sensor high on the partition's hall face, hall pendant
    // The PIR (as the custom hallway_motion): a slim wall plate with a short swivel neck, a rounded white head tilted down
    // at the hall and a faceted fresnel dome on its front, the status LED above the dome. Built facing +z in a frame
    // turned to face the hall (+x).
    const pirAt = new THREE.Group(); pirAt.position.set(-0.44, 2.24, 0.6); pirAt.rotation.y = Math.PI / 2; R.scene.add(pirAt);
    const absM = new THREE.MeshPhysicalMaterial({ color: 0xF1F2F0, roughness: 0.58, clearcoat: 0.1, clearcoatRoughness: 0.5 });
    const pirPlate = merge(THREE, [pc(rbox(THREE, 0.056, 0.08, 0.01, 0.005), 0, 0, 0.005), pc(rbox(THREE, 0.03, 0.03, 0.02, 0.006), 0, 0.004, 0.018)], absM); pirAt.add(pirPlate);
    const pirHead = new THREE.Group(); pirHead.position.set(0, 0.004, 0.026); pirHead.rotation.x = 0.3; pirAt.add(pirHead); // tilted down at the floor
    const pirBody = new THREE.Mesh(rbox(THREE, 0.066, 0.092, 0.042, 0.01), absM); pirBody.position.set(0, 0, 0.021); pirBody.castShadow = pirBody.receiveShadow = true; pirHead.add(pirBody);
    const pir = new THREE.Mesh(new THREE.SphereGeometry(0.024, 14, 5, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0xF2F0E9, roughness: 0.4, clearcoat: 0.7, clearcoatRoughness: 0.2, flatShading: true }));
    pir.rotation.x = Math.PI / 2; pir.scale.y = 0.85; pir.position.set(0, -0.01, 0.0415); pir.receiveShadow = true; pirHead.add(pir); // each facet catches the light, like the real lenslets
    const pirLed = P.ledDot(0, 0, 0, 0x2FBF71, 0.008); pirHead.add(pirLed); pirLed.position.set(0, 0.03, 0.04);
    // invisible tap target (the sensor itself is only a few pixels on a phone), stretched toward the camera rather than
    // up, so on screen it covers the sensor and the wall below it but not the doorway behind it
    const pirHit = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial()); pirHit.visible = false; pirHit.scale.set(0.1, 0.13, 0.18); pirHit.position.set(-0.41, 2.24, 0.72); R.scene.add(pirHit);
    // The hall pendant: a linen bell shade (open below, the same 32 cm mouth and 16 cm height as the cone it replaces, so
    // its light and shadows are as before) on a brass socket cap, hung on a fabric flex from a white ceiling canopy.
    P.cyl(0.004, 0.004, 0.5, M.black, 0.5, 2.45, 0.6, 8);
    { const brass = new THREE.MeshPhysicalMaterial({ color: 0xC9A46A, metalness: 1, roughness: 0.32, clearcoat: 0.3, clearcoatRoughness: 0.3 }); P.cyl(0.018, 0.022, 0.04, brass, 0.5, 2.245, 0.6, 24); P.cyl(0.05, 0.05, 0.022, M.trim, 0.5, 2.689, 0.6, 32); }
    const pendant = P.add(new THREE.Mesh(lathe(THREE, [[0.16, -0.08], [0.163, -0.077], [0.161, -0.07], [0.15, -0.045], [0.128, -0.012], [0.098, 0.022], [0.068, 0.05], [0.042, 0.07], [0.022, 0.079], [0, 0.081]], 48), M.shade.clone())); pendant.position.set(0.5, 2.15, 0.6);
    pendant.material.bumpMap = M.cushion.bumpMap; pendant.material.bumpScale = 0.6;
    const hallLight = new THREE.PointLight(0xFFE2B8, 0, 6, 1.6); hallLight.position.set(0.5, 2.05, 0.6); hallLight.castShadow = true; hallLight.shadow.mapSize.set(1024, 1024); R.scene.add(hallLight);
    // The pendant shade sits a few cm from its bulb, inside the default 0.5 m shadow near plane, so the light went straight
    // through it (a hot spot on the ceiling). A 5 cm near plane lets it cast; the smaller depth bias keeps the old offset
    // at room distances (point shadows store perspective depth) and the normal bias keeps surfaces close to the bulb free
    // of acne rings. The shade's inside doesn't receive shadows, so it stays lit (its outside is a skin, below). (The night
    // lamp does the same: shaded.)
    // A 3-texel filter: the shade's shadow line across the partition, a metre from the bulb, came out as stair steps.
    hallLight.shadow.camera.near = 0.05; hallLight.shadow.camera.updateProjectionMatrix(); Object.assign(hallLight.shadow, { bias: -0.0002, normalBias: 0.01, radius: 3 });
    pendant.receiveShadow = false;
    // Phones render without point-light shadows, and a light without a shadow shines straight through the partition and
    // the shut door: the night light lit the hall floor at 03:55 ("the hallway is dark"), the hall light the bedroom at
    // 02:50. There the two fittings light the flat with spot lights, which keep their shadows on every tier, aimed
    // through the openings of their shades (the lamp shade's bottom and top, the pendant's open bottom), plus a light no
    // bigger than the shade that keeps it glowing inside; each spot draws its shadow map only while it is on. (The
    // renderer's shadowless stand-ins, userData.shadeCones, would still light through the wall: the lamp's are dropped,
    // and shaded: true stays for its desktop shadow settings.)
    delete nl.bulb.userData.shadeCones; delete nl.bulb.userData.shadeReach;
    // A cone is [down -1 or up 1, half-angle, penumbra, shadow map size]; the pendant's is as wide as a spot's shadow
    // allows (160°, so a 1024 map), and a 5 cm normal bias keeps its grazing light on the partition free of acne stripes.
    const phoneLights = (parent, at, color, distance, decay, cones, reach) => {
      const ls = cones.map(([dy, angle, penumbra, size]) => {
        const sp = new THREE.SpotLight(color, 0, distance, angle, penumbra, decay); sp.target.position.set(0, dy, 0); sp.add(sp.target);
        sp.castShadow = true; sp.shadow.mapSize.set(size, size); sp.shadow.camera.near = 0.25; Object.assign(sp.shadow, { bias: -0.0005, normalBias: 0.05, needsUpdate: true });
        return sp;
      });
      ls.push(new THREE.PointLight(color, 0, reach, decay));
      for (const l of ls) { l.position.copy(at); parent.add(l); }
      return ls;
    };
    const nlPhone = phoneLights(nl.group, nl.bulb.position, 0xFFCF98, 4, 1.7, [[-1, 1.2, 0.12, 512], [1, 0.74, 0.15, 512]], 0.21);
    const hallPhone = phoneLights(R.scene, hallLight.position, 0xFFE2B8, 6, 1.6, [[-1, 1.4, 0.25, 1024]], 0.3);
    const setTier = () => { const phone = R.quality !== 'high'; nl.bulb.visible = hallLight.visible = !phone; for (const l of [...nlPhone, ...hallPhone]) l.visible = phone; };
    setTier(); // before the renderer's first compile; again each frame, for a drop to the phone tier while running
    // kitchen: counter along the back wall, cabinets, kettle + plug, hub
    // Base units 3 m long under an oak worktop (top at 0.925, where the hub, kettle and canister stand): a recessed
    // graphite plinth, four bays of satin-white fronts (a drawer over a door, 3 mm gaps, softened edges) with brushed-
    // steel bar handles, and a steel sink with a gooseneck tap under the window.
    const paint = new THREE.MeshPhysicalMaterial({ color: 0xECEDE9, roughness: 0.42, clearcoat: 0.2, clearcoatRoughness: 0.4 });
    const steelM = new THREE.MeshStandardMaterial({ color: 0xC6CACE, metalness: 1, roughness: 0.3 });
    const graphiteM = new THREE.MeshStandardMaterial({ color: 0x2B2F33, roughness: 0.6, metalness: 0.1 });
    const bar = (x, y, z) => [pc(rbox(THREE, 0.18, 0.012, 0.012, 0.005, { seg: 1 }), x, y, z), ...[-0.07, 0.07].map((dx) => pc(new THREE.CylinderGeometry(0.004, 0.004, 0.022, 8), x + dx, y, z - 0.011, Math.PI / 2))]; // a bar on two standoffs, off a front facing +z
    {
      P.box(3.0, 0.1, 0.5, graphiteM, 1.9, 0.05, -2.25); // plinth, 6 cm behind the fronts
      const fronts = [pc(new THREE.BoxGeometry(3.0, 0.785, 0.56), 1.9, 0.4925, -2.22)], handles = []; // carcass, z -2.5…-1.94
      for (let i = 0; i < 4; i++) {
        const x = 0.775 + i * 0.75;
        fronts.push(pc(rbox(THREE, 0.744, 0.17, 0.018, 0.003, { seg: 1 }), x, 0.797, -1.931), pc(rbox(THREE, 0.744, 0.6, 0.018, 0.003, { seg: 1 }), x, 0.405, -1.931));
        handles.push(...bar(x, 0.797, -1.9), ...bar(x, 0.66, -1.9));
      }
      P.add(merge(THREE, fronts, paint)); const h = P.add(merge(THREE, handles, steelM)); h.castShadow = false;
      put(rbox(THREE, 3.02, 0.04, 0.62, 0.006, { seg: 1, uvScale: 1 }), M.woodLight, 1.9, 0.905, -2.19); // worktop: y 0.885…0.925, z -2.5…-1.88
      // the sink: a brushed-steel rim round a darker basin (drawn), and a chrome gooseneck tap behind it, clear of the sill
      const basin = canvasTex(THREE, (g, w, h2) => {
        g.fillStyle = '#D9DCDF'; g.fillRect(0, 0, w, h2);
        const gr = g.createRadialGradient(w / 2, h2 / 2, 4, w / 2, h2 / 2, w * 0.55); gr.addColorStop(0, '#6E747A'); gr.addColorStop(1, '#9AA0A6');
        g.fillStyle = gr; g.beginPath(); g.roundRect?.(22, 16, w - 44, h2 - 32, 18); g.fill();
        g.fillStyle = '#2A2E32'; g.beginPath(); g.arc(w / 2, h2 / 2, 9, 0, Math.PI * 2); g.fill();
      }, 256, 256);
      const sink = put(rbox(THREE, 0.5, 0.006, 0.38, 0.0025, { seg: 1 }), new THREE.MeshStandardMaterial({ color: 0xFFFFFF, map: basin, metalness: 0.85, roughness: 0.35 }), 1.95, 0.9262, -2.1); sink.castShadow = false;
      const chrome = new THREE.MeshStandardMaterial({ color: 0xD6D9DC, metalness: 1, roughness: 0.15 });
      P.cyl(0.022, 0.024, 0.03, chrome, 1.95, 0.94, -2.3, 24);
      P.tube([[1.95, 0.95, -2.3], [1.95, 1.12, -2.3], [1.95, 1.2, -2.27], [1.95, 1.215, -2.2], [1.95, 1.18, -2.15], [1.95, 1.13, -2.145]], 0.011, chrome);
      put(rbox(THREE, 0.012, 0.012, 0.07, 0.005, { seg: 1 }), chrome, 1.967, 1.0, -2.29); // the mixer lever
    }
    // upper cabinets either side of the window, in the same fronts and handles (wall-hung: they hide with the back wall)
    for (const x of [0.775, 3.025]) {
      const box = merge(THREE, [pc(new THREE.BoxGeometry(0.75, 0.7, 0.33), x, 2.1, -2.335), pc(rbox(THREE, 0.744, 0.694, 0.018, 0.003, { seg: 1 }), x, 2.1, -2.161)], paint);
      const h = merge(THREE, bar(x, 1.8, -2.13), steelM); h.castShadow = false;
      P.onWall(P.group(P.add(box), P.add(h)), 0, 1, -2.5);
    }
    // a brushed-steel pedal bin with a black lid
    P.cyl(0.14, 0.13, 0.38, steelM, 2.9, 0.2, -1.0, 40); P.cyl(0.143, 0.143, 0.03, graphiteM, 2.9, 0.405, -1.0, 40); P.cyl(0.133, 0.133, 0.012, M.rubber, 2.9, 0.006, -1.0, 40); P.box(0.07, 0.014, 0.1, graphiteM, 2.735, 0.02, -1.0, 0.004);
    // The kettle (Poly Haven's steel vintage_electric_kettle, else a turned steel body of the same shape), spout turned
    // to the front-left, and its smart plug on the wall right of the window: a white socket faceplate with the plug in
    // it, a button and the status LED on its front. The plug, its LED and the lead up the wall hide with the back wall
    // (the scene toggles the LED itself, as a child of the tagged group).
    const glossM = new THREE.MeshPhysicalMaterial({ color: 0xF4F5F2, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.15 });
    const faceplate = put(rbox(THREE, 0.086, 0.086, 0.009, 0.004), glossM, 2.95, 1.15, -2.4955);
    const plug = put(rbox(THREE, 0.06, 0.075, 0.032, 0.008), absM, 2.95, 1.15, -2.475);
    const plugBtn = put(new THREE.CylinderGeometry(0.009, 0.009, 0.004, 20).rotateX(Math.PI / 2), glossM, 2.935, 1.168, -2.4585); plugBtn.castShadow = false;
    const plugLed = P.ledDot(2.97, 1.125, -2.4585, 0x2FBF71, 0.006);
    const chromeM = () => new THREE.MeshStandardMaterial({ color: 0xD6D9DC, metalness: 1, roughness: 0.18 });
    let kettleBody = MOD('vintage_electric_kettle');
    if (kettleBody) { R.scene.add(kettleBody); placeModel(THREE, kettleBody, { x: 2.8, y: 0.925, z: -2.15, rotY: 0.35 }); }
    else {
      const bakelite = new THREE.MeshPhysicalMaterial({ color: 0x1E2023, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2 });
      const tube = (pts, r, n = 16) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), n, r, 8);
      const body = new THREE.Mesh(lathe(THREE, [[0.12, 0], [0.124, 0.006], [0.124, 0.05], [0.118, 0.068], [0.1, 0.082], [0.092, 0.1], [0.09, 0.13], [0.086, 0.16], [0.076, 0.185], [0.064, 0.2], [0.048, 0.212], [0.03, 0.22], [0.012, 0.226], [0, 0.227]], 36), chromeM());
      const spout = new THREE.Mesh(tube([[-0.075, 0.11, 0], [-0.115, 0.14, 0], [-0.145, 0.175, 0], [-0.165, 0.197, 0]], 0.011), body.material);
      const black = merge(THREE, [
        pc(tube([[-0.068, 0.19, 0], [-0.072, 0.255, 0], [-0.045, 0.295, 0], [0, 0.302, 0], [0.045, 0.295, 0], [0.072, 0.255, 0], [0.068, 0.19, 0]], 0.009, 24)),
        pc(new THREE.SphereGeometry(0.016, 12, 8), 0, 0.238, 0), pc(new THREE.CylinderGeometry(0.007, 0.007, 0.012, 10), 0, 0.228, 0),
        pc(rbox(THREE, 0.05, 0.05, 0.1, 0.012, { seg: 1 }), 0.14, 0.03, 0),
      ], bakelite);
      for (const m of [body, spout]) m.castShadow = m.receiveShadow = true;
      kettleBody = P.group(body, spout, black); kettleBody.position.set(2.8, 0.925, -2.15); kettleBody.rotation.y = 0.35; kettleBody.updateMatrixWorld(true);
    }
    // Steam rises from the spout tip; the lead leaves the cord inlet low at the back (kettle frame: spout toward -x).
    const steamAt = kettleBody.localToWorld(new THREE.Vector3(-0.17, 0.205, 0)), inlet = kettleBody.localToWorld(new THREE.Vector3(0.15, 0.03, 0));
    const lead = P.tube([[inlet.x, 0.935, inlet.z], [inlet.x + 0.01, 0.931, inlet.z - 0.08], [2.94, 0.931, -2.38], [2.94, 0.95, -2.46], [2.95, 1.03, -2.473], [2.95, 1.118, -2.475]], 0.005, cordM); // kettle lead up into the plug
    lead.castShadow = false;
    P.onWall(P.group(faceplate, plug, plugBtn, plugLed, lead), 0, 1, -2.5);
    // steam while the kettle is on: soft puffs that rise from the spout (steamAt), swell and fade (one translucent ball read as a
    // glass bead). Sprites are unlit, so their grey follows the room's light (they don't glow in a dim kitchen).
    const puffC = document.createElement('canvas'); puffC.width = puffC.height = 64; const pg = puffC.getContext('2d');
    const pgr = pg.createRadialGradient(32, 32, 0, 32, 32, 32); pgr.addColorStop(0, 'rgba(255,255,255,.85)'); pgr.addColorStop(0.4, 'rgba(255,255,255,.4)'); pgr.addColorStop(1, 'rgba(255,255,255,0)'); pg.fillStyle = pgr; pg.fillRect(0, 0, 64, 64);
    const puffT = new THREE.CanvasTexture(puffC); puffT.colorSpace = THREE.SRGBColorSpace;
    const puffs = [0, 1, 2, 3].map(() => { const p = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffT, transparent: true, depthWrite: false, opacity: 0 })); p.visible = false; p.userData.noAO = true; p.raycast = () => {}; R.scene.add(p); return p; });
    const hub = P.hub(0.9, 0.925, -2.15, { rotY: 0.2 }); R.addPickable(hub.group, 'hub'); P.phone(1.25, 0.93, -2.05, 0.4);
    // a glazed canister with an oak lid (clear of the window sill), and a small succulent in the counter's right corner
    // (else a box)
    put(lathe(THREE, [[0, 0], [0.056, 0], [0.06, 0.006], [0.06, 0.17], [0.057, 0.176], [0, 0.176]], 32), new THREE.MeshPhysicalMaterial({ color: 0xF3F2EE, roughness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.1 }), 1.6, 0.925, -2.2);
    put(lathe(THREE, [[0, 0.172], [0.063, 0.172], [0.063, 0.19], [0.05, 0.196], [0.014, 0.198], [0.014, 0.214], [0, 0.216]], 32), M.woodLight, 1.6, 0.925, -2.2);
    const succulent = MOD('potted_plant_04'); if (succulent) { R.scene.add(succulent); placeModel(THREE, succulent, { x: 3.22, y: 0.925, z: -2.25 }); } else P.box(0.25, 0.3, 0.25, M.cardboard, 3.2, 1.075, -2.2);
    // Dining: the wooden table (else a square one) with an oak chair either side, and the grey armchair in the living
    // corner, turned to the room.
    const tableModel = MOD('wooden_table_02');
    if (tableModel) { R.scene.add(tableModel); placeModel(THREE, tableModel, { x: 1.8, z: 0.4, rotY: Math.PI / 2, s: 0.95 }); } else P.table(1.8, 0.4, 0.9, 0.9, 0.75, M.woodLight, M.woodLight);
    // A dining chair (seat top 0.48, facing its local +z): turned legs that run up into the back posts, aprons, a curved
    // top rail and a mid rail, as one oak mesh.
    const chair = (x, z, rotY) => {
      const ps = [pc(rbox(THREE, 0.42, 0.035, 0.42, 0.01, { seg: 1, uvScale: 1.5 }), 0, 0.4625, 0)];
      for (const sx of [-1, 1]) {
        ps.push(pc(new THREE.CylinderGeometry(0.013, 0.017, 0.445, 12), sx * 0.18, 0.2225, 0.18)); // front legs
        ps.push(pc(new THREE.CylinderGeometry(0.015, 0.017, 0.9, 12), sx * 0.18, 0.45, -0.18)); // rear legs into back posts
        ps.push(pc(rbox(THREE, 0.02, 0.06, 0.34, 0.006, { seg: 1, uvScale: 1.5 }), sx * 0.18, 0.415, 0)); // side aprons
      }
      for (const sz of [-1, 1]) ps.push(pc(rbox(THREE, 0.34, 0.06, 0.02, 0.006, { seg: 1, uvScale: 1.5 }), 0, 0.415, sz * 0.18)); // front and back aprons
      const top = rbox(THREE, 0.4, 0.075, 0.025, 0.01, { seg: 1, div: [6, 1, 1], uvScale: 1.5 }), tp = top.attributes.position;
      for (let i = 0; i < tp.count; i++) tp.setZ(i, tp.getZ(i) - 0.2 * tp.getX(i) ** 2); // bowed to the sitter's back
      top.computeVertexNormals();
      ps.push(pc(top, 0, 0.85, -0.185), pc(rbox(THREE, 0.34, 0.04, 0.02, 0.006, { seg: 1, uvScale: 1.5 }), 0, 0.68, -0.18));
      const m = P.add(merge(THREE, ps, M.woodLight)); m.position.set(x, 0, z); m.rotation.y = rotY; return m;
    };
    chair(1.1, 0.4, Math.PI / 2); chair(2.5, 0.4, -Math.PI / 2);
    const armchair = MOD('ArmChair_01'); if (armchair) { R.scene.add(armchair); placeModel(THREE, armchair, { x: 2.85, z: 1.85, rotY: -2.1 }); }

    R.addPickable(mat, 'mat'); R.addPickable(mattress, 'mat'); R.addPickable(doorPivot, 'door'); R.addPickable(contact, 'door'); R.addPickable(pir, 'motion'); R.addPickable(pirPlate, 'motion'); R.addPickable(pirBody, 'motion'); R.addPickable(pirLed, 'motion'); R.addPickable(pirHit, 'motion'); R.addPickable(plug, 'kettle', { anchor: true }); R.addPickable(faceplate, 'kettle'); R.addPickable(kettleBody, 'kettle'); R.addPickable(nl.shade, 'night'); R.addPickable(nl.pole, 'night'); R.addPickable(nlBase, 'night'); R.addPickable(nl.bulbMesh, 'night'); R.addPickable(pendant, 'hall');
    // bed sensor controller: the small box on the side of her bed that the family is sent to check (the bed sensor's
    // what-ifs). On the side rail's hall-side face (x −1.8, y 0.12…0.25), towards the foot, below the mattress and the
    // duvet's drape, where the strip's lead comes down. No LED: a controller that has gone silent (unplugged, flat
    // batteries) couldn't light one.
    const matCtl = inBed(new THREE.Mesh(rbox(THREE, 0.018, 0.05, 0.085, 0.006, { seg: 1 }), absM)); matCtl.position.set(0.509, 0.18, 0.73); R.addPickable(matCtl, 'mat');
    const rp = {}; // when each faulted device last got NCB's red pulse (update's t, in seconds)
    const hiMap = { mat: [mat, mattress, matCtl], door: [doorLeaf, contact], motion: [pir, pirPlate, pirBody], kettle: [plug, faceplate, kettleBody], night: [nl.shade], hall: [pendant] };
    const hi = P.highlighter(hiMap);
    // A reset (a what-if's fresh room, "Another request here") cuts off any pulse still running from before it, so the
    // last scenario's red mark never glows in the reset room. The highlighter can't cancel a pulse: update() hides its
    // shells (the outline meshes it adds to the targets, tagged isShell) until that device's next pulse.
    const shells = Object.fromEntries(Object.entries(hiMap).map(([id, ts]) => { const l = []; for (const o of ts) o.traverse((m) => { if (m.userData.isShell) l.push(m); }); return [id, l]; }));
    const pulsed = {}; let resetAt = -Infinity; // performance.now() of each device's last pulse, and of the last reset
    const focus = (id, hex) => { pulsed[id] = performance.now(); hi.focus(id, hex); };
    // The pendant doesn't take shadows (inside, its own bulb would shade it), so the morning sun lit it through the walls
    // and ceiling. It keeps only its inside and gets an outer skin that does take shadows (its bulb never lights the
    // outside); the shade itself still casts from both sides. Added after the highlighter, so a tap doesn't pulse two
    // shells on it. (The night lamp's shade has the same skin from P.floorLamp, shaded, glowing with nl.shadeMat.)
    const skins = [pendant].map((m) => {
      const out = new THREE.Mesh(m.geometry, m.material.clone()); out.material.side = THREE.FrontSide; out.receiveShadow = true; m.add(out);
      m.material.side = THREE.BackSide; m.material.shadowSide = THREE.DoubleSide; return out;
    });

    return {
      focus,
      // main.js resetRoom, once the store is back at the post-setup snapshot
      reset() { resetAt = performance.now(); for (const id of Object.keys(rp)) delete rp[id]; for (const l of Object.values(shells)) for (const o of l) o.visible = false; },
      update(s, t) {
        hi.update(); for (const id in shells) if (pulsed[id] < resetAt) for (const o of shells[id]) o.visible = false;
        R.daylight(s.env.hour);
        // A faulted device keeps NCB's red mark after the host's 3.2 s ring: the highlighter's pulse on its big shells
        // (mattress, door leaf, lamp shade, pendant, plug and kettle, sensor), again every 2.4 s, so it reads on a phone
        // too. It is NCB's mark, not a light on the device: right for a silent sensor or a bulb with no power. Not while a
        // what-if replays quietly (an instant stretch on the page; nothing may pulse then).
        if (!isQuiet()) for (const id of ['mat', 'door', 'motion', 'kettle', 'night', 'hall']) if (s[id].status === 'fault' && t - (rp[id] ?? -9) > 2.4) { focus(id, 0xE0563A); rp[id] = t; }
        // Deep night (from about 23:00 to 05:30) is darker than the evening the flat is set up in, so a 20–30% light,
        // or a hall light that didn't come on, shows in the room; on a phone the flat itself still reads (at ×0.3 the
        // hall table and the kitchen went black). No sun then: before 04:30 it sits below the garden, which casts no
        // shadow, and lit a faint window-shaped patch on the partition at 03:55. (The night sky's own dark navy comes
        // from R.daylight.)
        const hod = ((s.env.hour % 24) + 24) % 24, ramp = (x, a, b) => Math.min(1, Math.max(0, (x - a) / (b - a)));
        const deep = hod >= 12 ? ramp(hod, 22.5, 23.5) : 1 - ramp(hod, 5, 6);
        if (deep > 0) { R.lights.hemi.intensity *= 1 - 0.5 * deep; R.lights.fill.intensity *= 1 - 0.5 * deep; R.scene.environmentIntensity *= 1 - 0.45 * deep; R.lights.sun.intensity *= 1 - deep; }
        hub.ledMat.emissiveIntensity = s.hub.status === 'on' ? (2.5 + Math.sin(t * 2.2) * 1.5) * s.hub.led : 0;
        doorPivot.rotation.y = -(s.door.leaf ?? s.door.open) * 1.4; // leaf: where the door really is, when its sensor reads it wrong
        const mBad = s.motion.status === 'fault', mDead = mBad && /^(missed check-in|offline)/.test(s.motion.faultNote || ''); // silent: a flat battery lights nothing
        pirLed.material.color.set(mDead ? 0x3A3F44 : mBad ? 0xE0563A : s.motion.active ? 0xFFB020 : 0x2FBF71); pirLed.material.emissive.copy(pirLed.material.color);
        pirLed.material.emissiveIntensity = s.motion.status === 'offline' || mDead ? 0 : mBad ? (Math.floor(t * 3) % 2 ? 6 : 1) : s.motion.active ? 6 : 1;
        plugLed.material.color.set(s.kettle.status === 'fault' ? 0xE0563A : s.kettle.on ? 0xFFB020 : 0x2FBF71); plugLed.material.emissive.copy(plugLed.material.color); plugLed.material.emissiveIntensity = s.kettle.status === 'fault' ? (Math.floor(t * 3) % 2 ? 6 : 1) : 2; plugLed.visible = s.kettle.status !== 'offline';
        const grey = Math.min(1, 0.3 + R.lights.hemi.intensity * 1.4 + R.lights.sun.intensity * 0.12);
        puffs.forEach((p, i) => {
          const k = (t * 0.55 + i / puffs.length) % 1; p.visible = s.kettle.on || !!s.kettle.steam; if (!p.visible) return; // steam: a boil the plug can't report
          p.position.set(steamAt.x + 0.025 * Math.sin(t * 1.1 + i * 1.7) - k * 0.03, steamAt.y + k * 0.2, steamAt.z + 0.015 * Math.cos(t * 0.9 + i));
          p.scale.setScalar(0.035 + k * 0.09); p.material.opacity = 0.6 * Math.sin(k * Math.PI) * (1 - k * 0.4); p.material.color.setScalar(grey);
        });
        const nb = s.night.brightness; nl.bulb.intensity = nb * 3; nl.bulbMesh.material.emissiveIntensity = nb * 2; nl.shadeMat.emissiveIntensity = nb * 0.4;
        const hb = s.hall.brightness; hallLight.intensity = hb * 7; pendant.material.emissiveIntensity = skins[0].material.emissiveIntensity = hb * 0.5;
        setTier(); for (const [ls, i] of [[nlPhone, nb * 3], [hallPhone, hb * 7]]) for (const l of ls) { l.intensity = i; if (l.isSpotLight) l.shadow.autoUpdate = i > 0; }
        mat.material.color.set(s.mat.pressed ? 0x2C3035 : 0x8CC3B3); // dark under weight, pale when released
      },
    };
  },

  prompts: [
    {
      chip: 'Let me know when mum\'s up in the morning — without a camera in her room.',
      // 'know' ("let me know") is a kettle keyword too, so a bare "let me know if…" matches both and is asked about
      // rather than run; "tell" is a stop word (js/engine/match.js), so a bare "tell me if…" gets the plain clarify.
      // No 'mum': one hit is enough to run, and it sent "tell me if mum falls" to a light rule. 'more' and 'leave' are
      // filler from the kettle chip ("…for more than…") and its 'leave' stem: listed here too, "tell me more" and "tell
      // me if she leaves the flat" are asked about instead of running the kettle request.
      // 'bed' (the night light has it too, so "turn on the light when she gets out of bed" stays the night light's): with
      // 'know', it outweighs the kettle chip's "10" ("let me know if she's still in bed at 10" ran the kettle request).
      // 'stills' is a stem worth half a hit on "still": "tell me if she's still in bed" runs this, "let me know if the
      // kettle is still on" stays the kettle's. Not 'shes': half a hit on "she's" would make "tell me when she's up" this
      // request, but also "let me know when she's gone to bed" or "…in the bathroom", so that one asks back.
      keywords: ['up', 'morning', 'awake', 'camera', 'without', 'wake', 'woke', 'wakes', 'waking', 'get', 'gets', 'got', 'yet', 'routine', 'more', 'leave', 'bed', 'stills'],
      // routing (js/engine/match.js): a fall question never names this request, nor does "if something's wrong / happens"
      // (it ran the kettle request on "know" and the kettle's 'somethin' stem)
      // Nor does going to bed ("let me know when she's going to bed" asks back; 'going' alone isn't ruled out, so "let me
      // know when she's up and going" runs this), or making her bed ('makes' alone isn't ruled out either: "tell me when
      // mum's up and makes her tea" runs this). No request here watches her bed being made: all three avoid it, so it gets
      // the plain "not sure" answer rather than a tie of the other two. The kettle or its plug failing: see PLUG_FAULT.
      avoid: ['falls', 'fell', 'fallen', 'wrong', 'happens', 'happen', 'happened', 'going bed', 'makes bed', 'made bed', 'making bed', 'bed made', ...KETTLE_STOPS, ...PLUG_FAULT, ...SENSOR_FAULT, ...DEVICE_DEAD],
      // telling Pat is the Edit, not this plan ("message you once — no calls to anyone else"), and it has no microphone,
      // video or recording ("record her room" ran it): asked for, they're asked about (a close form counts too: plurals,
      // "recording", "listening"). It watches 05:00–10:00 only ("let me know if she wakes up at night" ran it), not her
      // going (back) to bed or getting into it, and not whether a sensor works ("…stops working", "let me know if the bed
      // sensor breaks / dies" ran it, as phrases for dies: DEVICE_DEAD; not 'working' itself, a close form of "work": "let me know when she's up, I'm at
      // work" runs this, nor 'fails': "tell me if she fails to get up by 9:30" does too): named, those are asked about.
      rulesOut: ['pat', 'neighbour', 'neighbor', 'record', 'microphone', 'mic', 'mics', 'listen', 'hear', 'video', 'audio', 'film',
        'night', 'midnight', 'gone', 'goes', 'went', 'back', 'into', 'stops', 'stopped', 'broken', 'breaks', 'broke',
        'battery', 'batteries', 'offline', 'faulty'], // a sensor that dies or disconnects: DEVICE_DEAD
      expect: { 'mat.pressed': false, 'door.open': 1, 'kettle.on': false, 'motion.last': '07:11', 'mat.status': 'online', 'door.status': 'online' },
      steps: [
        { beat: 'plan' }, { status: 'Checking connected devices' },
        { say: 'No camera, no microphone. I can answer "is she up?" from four things that don\'t look at anyone: the bed sensor, the bedroom door, the hallway motion sensor and the kettle plug.' },
        { status: 'Waiting for your approval' },
        { plan: { intro: 'Plan:', steps: [
          { text: 'Between 05:00 and 10:00, when the bed sensor releases AND the door opens or the hallway motion sensor sees movement → message you "Mum\'s up", with the time' },
          { text: 'Kettle switching on counts as a second confirmation, not a requirement' },
          { text: 'If nothing by 09:30, message you once — no alarms, no calls to anyone else', alt: { text: 'If nothing by 09:30, message you and her neighbour Pat', apply: [{ set: 'plan.neighbour', to: true }] } },
          { text: 'No video, no audio, nothing to play back. I keep a few timestamps (when she got up, the last hallway movement), not a record of where she goes.' },
        ] } },
        { beat: 'run' },
        { status: 'Tuesday 03:10' }, { say: 'Running. Fast-forwarding through the night.' },
        { tween: 'env.hour', to: 27.17, ms: 2000 },
        { failPoint: 'night' },
        { status: 'Tuesday 05:00' }, { tween: 'env.hour', to: 29, ms: 1500 },
        { say: '05:00 — the watch starts. All four sensors checked in: weight on the bed, her door closed, the hallway quiet, the kettle off.' },
        { failPoint: 'watch' },
        ...P0_TO_0708,
        { failPoint: 'waking' },
        ...P0_UP,
        { say: 'Mum\'s up · 07:11' },
        { set: 'motion.active', to: false },
        { failPoint: 'kettle' },
        ...P0_KETTLE_ON,
        P0_KETTLE_LINE,
        ...P0_KETTLE_OFF,
        { status: 'Tuesday 07:15 · Mum\'s up' },
        { end: { headline: 'Up at 07:11. Nobody had to watch.', body: 'The bed sensor, her door and the hallway sensor agreed at 07:11, and the kettle backed them up a minute later. You got one message, and no camera or microphone was involved.' } },
      ],
      genericAt: 'waking',
      genericTitle: '📝 Noted, not urgent',
      whatIf: {
        mat: { at: 'night', intro: 'Replaying this request. This time, the bed sensor goes quiet in the night.', steps: [
          { status: 'Tuesday 03:40' }, { tween: 'env.hour', to: 27.67, ms: 1200 },
          { status: 'Tuesday 04:10 · bed sensor check-in due' }, { tween: 'env.hour', to: 28.17, ms: 1200 },
          { fail: 'mat', title: '📝 Logged, not sent at 4 am', faultText: 'silent since 03:40', say: '04:10 — the bed sensor missed its check-in. The last thing it sent, at 03:40, was weight on the bed. Its silence doesn\'t tell me she\'s asleep, or that she isn\'t.' },
          { wait: 1500 },
          { say: 'Your rule starts with the bed sensor, so it can\'t run as approved. No 4 am message about a sensor: when she\'s up, I\'ll tell you what the others show.' },
          replanWith((st) => ({ intro: 'This morning, without the bed sensor:', changes: ['Bed sensor: silent since 03:40. Its last reading, weight on the bed, stays on screen, and I don\'t count it', 'Her door, the hallway sensor and the kettle plug still watch from 05:00', 'No "Mum\'s up" from me without the bed sensor: I\'ll send what the others show, and name the missing one', `The 09:30 check runs on the door and the hallway: if neither shows anything by then, I message ${pat(st) ? 'you and Pat' : 'you'}`], needsYou: 'Next time you visit, look at the small box on the side of her bed: it may be unplugged or need new batteries.' })),
          { status: 'Tuesday 07:08' }, { tween: 'env.hour', to: 31.13, ms: 1800 },
          { tween: 'door.open', to: 1, ms: 1200, label: 'Bedroom door → open' }, { set: 'motion.active', to: true, label: 'Hallway → movement' }, { set: 'motion.last', to: '07:11' }, { wait: 800 },
          { say: 'Messaged you: "Her bedroom door opened and the hallway sensor saw movement at 07:11. The bed sensor has been silent since 03:40, so this is from the door and the hallway only."' },
          { set: 'motion.active', to: false },
          ...P0_KETTLE_ON,
          { say: '07:12 — and the kettle\'s on: another sign, from a different sensor. I\'ve sent you that as well.' },
          ...P0_KETTLE_OFF,
          { status: 'Tuesday 07:15 · bed sensor flagged' },
          HOLD,
          { end: { headline: 'No bed sensor, and no guessing.', body: 'The bed sensor went silent at 03:40, and NeuCharBox read that as neither asleep nor awake. You got what her door, the hallway and the kettle showed, with the missing sensor named.' } },
        ] },
        door: { at: 'waking', intro: 'Replaying this request. This time, the bedroom door sensor gets its reading wrong.', steps: [
          { status: 'Tuesday 07:10' }, { tween: 'env.hour', to: 31.17, ms: 900 },
          { set: 'mat.pressed', to: false, label: 'Bed sensor → out of bed' }, { wait: 900 },
          { set: 'door.leaf', to: 0 }, { tween: 'door.leaf', to: 1, ms: 1200 },   // the door opens; its sensor still reports "closed"
          { set: 'motion.active', to: true, label: 'Hallway → movement' }, { set: 'motion.last', to: '07:11' }, { wait: 900 },
          { fail: 'door', title: '📝 Door sensor disagrees', faultText: 'stuck on "closed"', say: '07:11 — the bed released and the hallway sensor saw movement right outside her door, but the bedroom door sensor still says "closed". Two sensors agree and one doesn\'t.' },
          { set: 'motion.active', to: false }, { wait: 1500 },
          { say: 'I\'m going with the two that agree. Mum\'s up · 07:11. Your rule needs the bed sensor plus her door or the hallway, so the bed and the hallway are enough on their own.' },
          { say: 'A door sensor that says "closed" with the door open usually means its magnet has come off the door and is stuck to the part on the frame. I\'ve stopped counting it until it\'s fixed.' },
          ...P0_KETTLE_ON,
          { say: '07:12 — and the kettle\'s on. A third sign that agrees.' },
          ...P0_KETTLE_OFF,
          replanWith((st) => ({ intro: 'Mum\'s up, from the sensors that agree:', changes: ['Bed released at 07:10, hallway movement at 07:11, kettle on at 07:12', 'Bedroom door sensor: says "closed" while the other sensors say she\'s up. Not counted', `Until it's fixed, "Mum's up" needs the bed and the hallway; the 09:30 check${pat(st) ? ', to you and Pat,' : ''} runs on those two`], needsYou: 'The sensor on her door frame has two parts: a small magnet that belongs on the door, and the part on the frame. On your next visit, check the magnet is still on the door, not stuck to the frame part, and stick it back in line.' })),
          { status: 'Tuesday 07:15 · Mum\'s up · door sensor flagged' },
          HOLD,
          { end: { headline: 'Two sensors agreed. The door didn\'t.', body: 'The bedroom door sensor said "closed" while the hallway saw movement just outside it. NeuCharBox went with the two sensors that agreed, sent your "Mum\'s up" on time, and stopped counting the one that disagreed.' } },
        ] },
        motion: { at: 'watch', intro: 'Replaying this request. This time, the hallway motion sensor sends a tamper alert and goes quiet before she\'s up.', steps: [
          { status: 'Tuesday 06:40' }, { tween: 'env.hour', to: 30.67, ms: 1500 },
          { fail: 'motion', title: '📝 Hallway sensor down · logged', faultText: 'tamper alert · silent', say: '06:40 — the hallway motion sensor sent a tamper alert and has said nothing since. That usually means it has come off its mount. From now on it tells me nothing about the hallway: not movement, and not "no movement".' },
          { wait: 1500 },
          { say: 'Your rule needs the bed sensor and either her door or the hallway, so it still works on the bed and the door. Nothing here is worth waking you for.' },
          replanWith((st) => ({ intro: 'This morning, one sensor short:', changes: ['Hallway motion sensor: tamper alert at 06:40, silent since then', '"Mum\'s up" comes from the bed sensor and her door, which your rule already allows', `The 09:30 check runs on the bed and the door; if they show nothing by then, I message ${pat(st) ? 'you and Pat' : 'you'}`, 'No hallway times in my notes until it\'s back'], needsYou: 'When you visit, check the small white sensor high on the hallway wall is still on its bracket, and clip it back if not. It should rejoin on its own.' })),
          { status: 'Tuesday 07:08' }, { tween: 'env.hour', to: 31.13, ms: 1500 },
          { set: 'mat.pressed', to: false, label: 'Bed sensor → out of bed' }, { wait: 900 },
          { tween: 'door.open', to: 1, ms: 1200, label: 'Bedroom door → open' }, { wait: 600 },
          { say: 'Mum\'s up · 07:11. From the bed sensor and her door; the hallway sensor is still down.' },
          ...P0_KETTLE_ON,
          P0_KETTLE_LINE,
          ...P0_KETTLE_OFF,
          { status: 'Tuesday 07:15 · Mum\'s up · hallway sensor flagged' },
          HOLD,
          // not "Down to two sensors": the bed, her door and the kettle plug still report (the rule needs the bed and her
          // door or the hallway), and not "one sensor down", which the re-plan card's "one sensor short" just said
          { end: { headline: 'The door covered for the hallway.', body: 'The hallway sensor sent a tamper alert and went quiet before she woke. NeuCharBox ran your rule on the bed and the door, which it already allowed, and told you which sensor was missing.' } },
        ] },
        kettle: { at: 'kettle', intro: 'Replaying this request. This time, the kettle plug drops off the network just as she makes her tea.', steps: [
          { status: 'Tuesday 07:12 · Mum\'s up at 07:11' }, { tween: 'env.hour', to: 31.2, ms: 1000 },
          { set: 'kettle.steam', to: true },   // she's boiling the kettle; the plug can't report it
          { fail: 'kettle', title: '📝 Kettle plug offline', faultText: 'off the network', say: '07:12 — the kettle plug dropped off the network. Its last report, at 07:11, was "off, 0 W". From now on I can\'t see the kettle, on or off.' },
          { wait: 1500 },
          { say: '"Mum\'s up · 07:11" stands: it came from the bed sensor, her door and the hallway. The kettle was only ever the second confirmation, so I\'m not counting it either way.' },
          { tween: 'env.hour', to: 31.25, ms: 2500 }, { set: 'kettle.steam', to: false }, { wait: 1000 },
          replanWith((st) => ({ intro: 'This morning, without the kettle plug:', changes: ['"Mum\'s up · 07:11" sent, from the bed sensor, her door and the hallway', 'Kettle plug: off the network since 07:12; the kettle isn\'t counted as on or off', 'A plug that drops off the network normally keeps passing power, so her kettle should work as usual', pat(st) ? 'Nothing goes to Pat: that was only for 09:30' : 'Nothing else changes in her flat'], needsYou: 'No rush. When you\'re next there, unplug the kettle plug for ten seconds and plug it back in. If it doesn\'t show up here again, I\'ll walk you through reconnecting it.' })),
          { status: 'Tuesday 07:15 · Mum\'s up · kettle plug flagged' },
          HOLD,
          { end: { headline: 'The kettle went quiet. Nothing was assumed.', body: 'The kettle plug dropped off the network as she made her tea. NeuCharBox kept the "Mum\'s up" it had already confirmed, and didn\'t count a silent plug as a kettle on or off.' } },
        ] },
        sleepIn: { label: 'She isn\'t up by 09:30', ask: 'What if she isn\'t up by 09:30?', at: 'waking', intro: 'Replaying this request. This time, she sleeps in.', steps: [
          { status: 'Tuesday 08:20' }, { tween: 'env.hour', to: 32.33, ms: 1500 },
          { status: 'Tuesday 09:30' }, { tween: 'env.hour', to: 33.5, ms: 1500 },
          { fn: async ({ chat, sleep }) => { chat.alert('09:30 and she\'s not up yet. The bed sensor still shows weight, her door is closed, and the hallway sensor hasn\'t seen movement all night. All four sensors are checking in, so this isn\'t a sensor gone quiet.', '⏰ Not up yet'); await sleep(600); } },
          { wait: 3000 },   // the alert is read on its own before the re-plan card pushes it up (on a phone)
          replanWith((st) => ({ intro: pat(st) ? 'That\'s the message I said I\'d send, to you and to Pat.' : 'That\'s the one message I said I\'d send.', changes: ['No alarm, no siren, no lights flashing in her flat', pat(st) ? 'Pat has the same message, as you chose. No one else' : 'I haven\'t contacted anyone else', pat(st) ? 'I\'ll tell you and Pat the moment anything changes' : 'I\'ll tell you the moment anything changes'], needsYou: 'A late morning is usually just a late morning. A phone call from you is the right next step, not a device.' })),
          { wait: 1500 },
          { status: 'Tuesday 09:41' }, { tween: 'env.hour', to: 33.68, ms: 1200 },
          { set: 'mat.pressed', to: false, label: 'Bed sensor → out of bed' }, { wait: 900 }, { tween: 'door.open', to: 1, ms: 1000, label: 'Bedroom door → open' }, { set: 'motion.active', to: true }, { set: 'motion.last', to: '09:41' }, { wait: 600 },
          line((st) => (pat(st) ? 'Mum\'s up · 09:41. All clear. I\'ve told Pat too.' : 'Mum\'s up · 09:41. All clear.')), { set: 'motion.active', to: false },
          { status: 'Tuesday 09:41 · Mum\'s up' },
          HOLD,
          { end: { headline: 'She was never watched. You still knew.', body: 'Four small sensors, a rule you approved, and one message when she wasn\'t up by 09:30. NeuCharBox answered the question without a camera, and escalated by telling you, not by alarming her.' } },
        ] },
      },
    },
    {
      chip: 'If she gets up at night, light the way to the bathroom, softly.',
      // 'fall'/'trip' only as in "don't let her fall": "tell me if she falls" asks for fall detection, which this isn't.
      // 'more': see the first request ("she's up more than twice at night" isn't the kettle either). 'bed': see there.
      keywords: ['night', 'light', 'way', 'bathroom', 'softly', 'soft', 'gets up', 'got', 'dark', 'path', 'toilet', 'fall', 'trip', 'safe', 'safely', 'more', 'bed'],
      // routing (js/engine/match.js): fall detection or leaving the house is something else, and so is a TV left on all
      // night (it ran this on "night"); brighter, another room or telling the neighbour is not this plan ("light the way
      // to the kitchen" asks back; "tell Pat if she's not up" ran it). Making her bed: see the first request; the kettle or
      // its plug failing: see PLUG_FAULT.
      avoid: ['falls', 'fell', 'fallen', 'detect', 'detects', 'detection', 'leaves house', 'leaves flat', 'leaves home', 'goes out', 'outside', 'wander', 'wanders', 'wandering', 'tv', 'telly', 'television', 'wrong', 'happens', 'happen', 'happened', 'makes bed', 'made bed', 'making bed', 'bed made', ...KETTLE_STOPS, ...PLUG_FAULT, ...SENSOR_FAULT, ...DEVICE_DEAD],
      rulesOut: ['bright', 'kitchen', 'stairs', 'garden', 'lounge', 'garage', 'front', 'pat', 'neighbour', 'neighbor'],
      expect: { 'mat.pressed': true, 'door.open': 0, 'night.brightness': 0, 'hall.brightness': 0, 'night.status': 'online', 'hall.status': 'online' },
      steps: [
        { beat: 'plan' }, { status: 'Checking connected devices' },
        { say: 'Night light and hall light, triggered by the bed sensor — not by motion, because by the time motion sees her she\'s already walking in the dark.' },
        { status: 'Waiting for your approval' },
        { plan: { intro: 'Plan, 23:00 to 06:00:', steps: [
          { text: 'Bed sensor releases → night light on at 20% immediately, hall light two seconds later' },
          { text: 'Lights off 5 minutes after she\'s back in bed' },
          { text: 'Hall light at 30%. Nothing brighter than 30% at night', alt: { text: 'Hall light at 50%, because she\'s said 30% is too dim. Nothing brighter than 50% at night', apply: [{ set: 'plan.brighter', to: true }] } },
        ] } },
        { beat: 'run' },
        { status: 'Tuesday 02:40' }, { tween: 'env.hour', to: 26.67, ms: 2000 },
        { failPoint: 'up' },
        { set: 'mat.pressed', to: false, label: 'Bed sensor → out of bed' },
        { set: 'night.on', to: true }, { tween: 'night.brightness', to: 0.2, ms: 700, label: 'Night light → 20%' },
        { wait: 500 }, { set: 'hall.on', to: true }, hallOn(true),
        { failPoint: 'door' },
        ...P1_THROUGH,
        { say: '02:41 — she\'s up. Night light 20%, hall light on. Nothing else.' },
        ...P1_BACK, { wait: 500 },
        { say: '02:49 — back in bed. Lights off in five minutes.' },
        { failPoint: 'back' },
        ...P1_OFF,
        { failPoint: 'later' },
        { status: 'Tuesday 02:54 · back in bed · lights off' },
        { end: { headline: 'Lit before she reached the door.', body: 'The bed sensor felt her get up at 02:40, so both lights were on before she reached her door, never brighter than your limit. Five minutes after she was back in bed, the flat was dark again.' } },
      ],
      genericAt: 'back',
      genericTitle: '📝 Noted, not urgent',
      whatIf: {
        mat: { at: 'up', intro: 'Replaying this request. This time, the bed sensor has gone quiet before she gets up.', steps: [
          { status: 'Tuesday 02:40' }, { wait: 1200 },
          { tween: 'door.open', to: 1, ms: 1000, label: 'Bedroom door → open' }, { set: 'motion.active', to: true, label: 'Hallway → movement' }, { set: 'motion.last', to: '02:41' },
          // her door and the hallway are all that's left to go on: the lights come on at once, then NCB says why so late.
          // The fail is the last device change for a while, so on a phone the strip stays on the red Bed sensor tile.
          { set: 'night.on', to: true }, { set: 'hall.on', to: true },
          { fn: ({ store, tween }) => Promise.all([tween('night.brightness', 0.2, 700), tween('hall.brightness', store.get('plan.brighter') ? 0.5 : 0.3, 700)]) },
          { set: 'motion.active', to: false },
          { fail: 'mat', title: '📝 Bed sensor silent', faultText: 'silent since 02:20', say: '02:41 — her door opened and the hallway saw movement, but the bed sensor still says "in bed". It hasn\'t sent anything since 02:20, so it never told me she got up.' },
          { wait: 1500 },
          line((st) => `Both lights on now: night light 20%, hall light ${hallPct(st)}%. They came on at her door, not at her bed, so her first steps were in the dark.`),
          { say: 'Until the bed sensor is back, her door and the hallway sensor are the trigger. They\'re later than the bed, but they\'re what I have. Same lights, same limit, and it\'s 2 am, so I didn\'t wait to ask you.' },
          { status: 'Tuesday 02:49' }, { parallel: [{ tween: 'env.hour', to: 26.82, ms: 800 }, { tween: 'door.open', to: 0, ms: 800, label: 'Bedroom door → closed' }] }, { wait: 600 },
          { say: '02:49 — her door closed. Without the bed sensor I can\'t see her back in bed, so the night light stays on at 20% until 06:00.' },
          { status: 'Tuesday 02:54' }, { tween: 'env.hour', to: 26.9, ms: 1000 },
          { tween: 'hall.brightness', to: 0, ms: 1200, label: 'Hall light → off' }, { set: 'hall.on', to: false },
          replanWith((st) => ({ intro: 'Until the bed sensor is back:', changes: ['Bed sensor: silent since 02:20. It still shows its last reading, "in bed"', 'Trigger: her door or the hallway sensor. Later than the bed, so tonight her first steps from the bed were dark', 'Night light: on at 20% until 06:00, because I can\'t see her get back into bed', `Hall light: off 5 minutes after her door closes; nothing brighter than ${hallPct(st)}%`], needsYou: 'Look at the small box on the side of her bed when you\'re next there: it may be unplugged or need new batteries. Until it\'s fixed, the first time she gets up each night, her first steps are dark. If you like, I can leave the night light on at 20% from 23:00 until then.' })),
          { status: 'Tuesday 02:54 · night light 20% · bed sensor flagged' },
          HOLD,
          { end: { headline: 'Lights at her door, not her bed.', body: 'The bed sensor had gone silent, so the lights came on at her door instead of at her bed. NeuCharBox said so, and left a soft light on rather than guess she was back in bed.' } },
        ] },
        night: { at: 'up', intro: 'Replaying this request. This time, the night light doesn\'t answer when she gets up.', steps: [
          { status: 'Tuesday 02:40' }, { wait: 1000 },
          { set: 'mat.pressed', to: false, label: 'Bed sensor → out of bed' },
          { status: 'Night light: sending "on" at 20%…' }, { wait: 900 },
          { fail: 'night', title: '📝 Night light not answering', faultText: 'no answer to "on"', say: '02:40 — she\'s out of bed and the night light didn\'t answer. As far as I know, her bedroom is dark.' },
          { set: 'hall.on', to: true }, hallOn(false), { wait: 800 },
          line((st) => `Hall light on now: it\'s the only light I have. It\'s at ${hallPct(st)}%, your limit, and it only reaches her room once her door is open.`),
          ...P1_THROUGH,
          { status: 'Night light: sending "on" again…' }, { wait: 900 }, { fail: 'night' },
          { wait: 1500 },
          { say: 'Still nothing from the night light. If her lamp was switched off at its own switch, the bulb has no power and can\'t hear me. I can\'t tell that from here.' },
          ...P1_BACK, { wait: 500 },
          { say: '02:49 — back in bed. Hall light off in five minutes.' },
          { status: 'Tuesday 02:54' }, { tween: 'env.hour', to: 26.9, ms: 1200 },
          { tween: 'hall.brightness', to: 0, ms: 1200 }, { set: 'hall.on', to: false },
          replanWith((st) => ({ intro: 'Tonight, without the night light:', changes: ['Night light: no answer at 02:40, or to the retry', `Hall light: on as soon as she was up, at ${hallPct(st)}%, your limit`, 'Her first steps, from the bed to her door, had no light', 'Logged for your morning, not sent at 3 am'], needsYou: 'Check that her bedside lamp\'s own switch is on. If it is, the bulb itself may need replacing.' })),
          { status: 'Tuesday 02:54 · lights off · night light flagged' },
          HOLD,
          // short enough for one line on a phone (the old headline broke after "Only")
          { end: { headline: 'Only the hall light answered.', body: 'The night light didn\'t answer when she got up, so the hall light was the only light she had, at your limit. NeuCharBox said her first steps were dark instead of pretending the hall light covered them.' } },
        ] },
        door: { at: 'door', intro: 'Replaying this request. This time, the bedroom door sensor starts flickering as she goes through.', steps: [
          { status: 'Tuesday 02:41' }, { wait: 600 },
          { set: 'door.leaf', to: 0 }, { parallel: [{ tween: 'door.leaf', to: 1, ms: 1000 }, FLICKER] },   // the door opens once; its sensor chatters
          { set: 'motion.active', to: true }, { set: 'motion.last', to: '02:41' },
          { fail: 'door', title: '📝 Door sensor flickering', faultText: 'flickering open/closed', say: '02:41 — the bedroom door sensor kept flicking between open and closed, seven times in two seconds. A door doesn\'t do that; a loose magnet does.' },
          { set: 'motion.active', to: false }, { wait: 1500 },
          { say: 'Your lights don\'t use the door: they follow the bed sensor, and both are on as planned. I\'ve stopped listening to the door sensor, so its flicker can\'t be read as her coming and going.' },
          { status: 'Tuesday 02:49' }, { parallel: [{ tween: 'env.hour', to: 26.82, ms: 800 }, { tween: 'door.leaf', to: 0, ms: 800 }] }, { set: 'mat.pressed', to: true, label: 'Bed sensor → in bed' }, { wait: 500 },
          { say: '02:49 — back in bed. Lights off in five minutes.' },
          ...P1_OFF,
          { replan: { intro: 'Tonight:', changes: ['Bedroom door sensor: flickering open/closed since 02:41. Ignored until it\'s fixed', 'Lights: on and off with the bed sensor, exactly as planned', 'None of the door sensor\'s readings go into a message or note'], needsYou: 'The sensor on her door frame works with a small magnet on the door. Press the magnet back in line when you can; if its sticky pad has worn out, a new pad fixes it.' } },
          { status: 'Tuesday 02:54 · lights off · door sensor flagged' },
          HOLD,
          { end: { headline: 'A flickering door, calmly ignored.', body: 'The door sensor started flicking between open and closed as she went through. NeuCharBox recognised a loose magnet, kept the lights on the bed sensor as planned, and left the door out of everything.' } },
        ] },
        motion: { at: 'back', intro: 'Replaying this request. This time, the hallway motion sensor goes quiet once she\'s back in bed.', steps: [
          { status: 'Tuesday 02:50 · hallway sensor check-in due' }, { tween: 'env.hour', to: 26.83, ms: 1000 },
          { fail: 'motion', title: '📝 Hallway sensor quiet', faultText: 'missed check-in', say: '02:50 — the hallway motion sensor missed its check-in. It last checked in at 02:20 and saw her at 02:41. Most likely its battery is flat.' },
          { wait: 1500 },
          { say: 'This is why your lights follow the bed sensor, not the hallway: they came on at 02:40, before she reached her door, and they go off five minutes after she\'s back in bed. Nothing tonight needs the hallway sensor.' },
          { say: 'I won\'t read its silence as an empty hallway, either. Until it\'s back, it just isn\'t there.' },
          ...P1_OFF, { wait: 1000 },
          replanWith((st) => ({ intro: 'Tonight:', changes: ['Hallway motion sensor: missed its 02:50 check-in, most likely a flat battery', `Lights: on and off with the bed sensor, exactly as planned, never above ${hallPct(st)}%`, 'No hallway times in my notes until it\'s back'], needsYou: 'It most likely needs new batteries. Swap them when you visit; it should rejoin on its own.' })),
          { status: 'Tuesday 02:54 · lights off · hallway sensor flagged' },
          HOLD,
          { end: { headline: 'Built on the bed, not the hallway.', body: 'The hallway sensor went quiet after she went back to bed. The lights never depended on it, so NeuCharBox turned them off on time and flagged the sensor for the morning.' } },
        ] },
        hall: { at: 'later', intro: 'Replaying this request. This time, the hall light doesn\'t answer when she gets up again, an hour later.', steps: [
          { status: 'Tuesday 03:55' }, { tween: 'env.hour', to: 27.92, ms: 1500 },
          { set: 'mat.pressed', to: false, label: 'Bed sensor → out of bed' }, { set: 'night.on', to: true }, { tween: 'night.brightness', to: 0.2, ms: 700, label: 'Night light → 20%' },
          { wait: 500 }, { status: 'Hall light: sending "on"…' }, { wait: 900 },
          { fail: 'hall', title: '📝 Logged for your morning', faultText: 'no answer to "on"', say: '03:55 — the hall light didn\'t respond. She\'s up and the hallway is dark.' },
          { wait: 1500 },
          { say: 'The hall light is the one that matters here and it\'s not answering. I can\'t make it work, so I\'m using what I have:' },
          replanWith((st) => ({ intro: 'Right now:', changes: [`Night light up from 20% to ${hallPct(st)}%, the most your limit allows. It's by the bed, so it lights her way to the door, not the hall`, 'Retrying the hall light while she\'s up', 'Logging this so you see it in the morning, not at 4 am'], needsYou: 'It\'s most likely the bulb; I can\'t be sure from here. Check it tomorrow.' })),
          { fn: ({ store, tween, status }) => { const b = store.get('plan.brighter') ? 0.5 : 0.3; status(`Night light → ${Math.round(b * 100)}%`); return tween('night.brightness', b, 700); } },
          // she opens her door into the dark hallway, then the retry the new plan promises: sent again, and again no answer.
          // The retry is the last device change, so on a phone the dashboard strip ends on the red Hall light tile.
          { tween: 'door.open', to: 1, ms: 1000 }, { set: 'motion.active', to: true }, { set: 'motion.last', to: '03:56' }, { wait: 600 }, { set: 'motion.active', to: false },
          { status: 'Hall light: sending "on" again…' }, { wait: 900 }, { fail: 'hall' }, { wait: 1200 },
          { status: (st) => `Tuesday 03:56 · night light ${hallPct(st)}% · hall light flagged` },
          HOLD,
          { end: { headline: 'It did what it could, and said so.', body: 'When the important device failed, NeuCharBox didn\'t pretend. It used what still worked, retried, and left you a note for the morning instead of a 4 am alert.' } },
        ] },
      },
    },
    {
      chip: 'Tell me if the kettle\'s been on for more than 10 minutes.',
      // Appliance words run this. 'know' is shared with the first request's "let me know", so a bare "let me know if…"
      // is asked about (see there). 'leave' and 'somethin' are stems worth half a hit on
      // "leaves" / "something": "what if she leaves something on" runs this, "leaves the flat" alone doesn't.
      // 'dry': "the kettle might boil dry"; with it, "let the kettle boil dry" is refused as this chip's opposite.
      keywords: ['kettle', 'minutes', 'boil', 'plug', 'stove', 'cooker', 'oven', 'hob', 'appliance', 'appliances', 'switched on', 'safe', 'safely', 'leave', 'somethin', 'know', 'dry'],
      // routing (js/engine/match.js): a fall question never names this request, nor does "if something's wrong / happens"
      // (see the first request); "boil the kettle" (exact words, not negated: "don't let the kettle boil dry" still runs
      // it) asks for the opposite of a watch that switches it off; "let me know if she's still asleep at 10" is the first
      // request's, not this one's on the chip's "10", and so are "…asleep at 10", "…sleeps past 10" and "…in bed at 10".
      // Making her bed: see the first request. The kettle stopping is this plan ("make sure the kettle stops after 10
      // minutes", "tell me if the kettle hasn't stopped after 10 minutes" run it), the kettle or a device no longer working
      // isn't ("tell me if the kettle plug stops working / breaks"): as phrases here and in PLUG_FAULT, since 'stops' or
      // 'breaks' ruled out would ask back on both. A normal boil ending isn't this watch either ("…stops boiling").
      avoid: ['falls', 'fell', 'fallen', 'boil kettle', 'still asleep', 'wrong', 'happens', 'happen', 'happened', 'asleep 10', 'sleeps 10', 'sleep 10', 'sleeping 10', 'bed 10', 'makes bed', 'made bed', 'making bed', 'bed made',
        'stops working', 'stopped working', 'stop working', 'sensor stops', 'sensor stopped', 'stops boiling', 'stopped boiling', 'finishes boiling', 'finished boiling', ...PLUG_FAULT, ...SENSOR_FAULT, ...DEVICE_DEAD],
      // so do "switch on the kettle" and "put the kettle on"; "message me first" is the Edit; it tells no neighbour. It
      // watches the kettle, not whether the floor or the washing is dry ('dry' is a keyword for "…boil dry"), nor the
      // washing machine or the TV, nor whether the plug itself works ("…goes offline", "…goes dead"; not 'broken': "…if the
      // kettle's auto-off is broken" is this request), nor the flat's other devices ("tell me if the hall light is on
      // for more than 10 minutes", "…if the door is open for…" ran it on "10 minutes"): named, those are asked about.
      // Not 'telly': as a close form it rules out every "tell me…".
      rulesOut: ['turn on', 'switch on', 'put', 'first', 'pat', 'neighbour', 'neighbor', 'floor', 'floors', 'washing', 'laundry', 'clothes', 'towels', 'hair', 'paint', 'dishes',
        'offline', 'faulty', 'responding', 'battery', 'batteries', 'tv', 'television', // a plug that dies or goes dead: DEVICE_DEAD
        'light', 'lights', 'lamp', 'bulb', 'door', 'hall', 'hallway', 'motion', 'sensor', 'sensors'],
      expect: { 'kettle.on': false, 'kettle.watts': 0, 'kettle.status': 'online', 'mat.pressed': false, 'door.open': 1, 'motion.last': '17:58' },
      steps: [
        { beat: 'plan' }, { status: 'Checking connected devices' },
        { say: 'The kettle plug reports power draw, so I can see "on" without seeing the kitchen. Ten minutes at full draw means it\'s stuck on or the auto-off has failed.' },
        { status: 'Waiting for your approval' },
        { plan: { intro: 'Plan:', steps: [
          { text: 'Kettle drawing > 1,000 W for more than 10 minutes → switch it off at the plug and message you', alt: { text: 'Kettle drawing > 1,000 W for more than 10 minutes → message you first; switch it off at the plug only if it\'s still on at 15 minutes', apply: [{ set: 'plan.warnFirst', to: true }] } },
          { text: 'Confirm the switch-off by watching the power draw fall to zero — the plug saying "off" isn\'t enough' },
          { text: 'Normal boils (under 5 minutes) are ignored' },
        ] } },
        { beat: 'run' },
        { status: 'Tuesday 07:12' }, { tween: 'env.hour', to: 31.2, ms: 1800 },
        { failPoint: 'morning' },
        ...P2_UP,
        ...P2_BOIL_ON,
        ...P2_BOIL_OFF,
        { status: 'Tuesday 18:02' }, { tween: 'env.hour', to: 42.03, ms: 2000 }, { set: 'motion.last', to: '17:58' },
        { set: 'kettle.on', to: true }, { tween: 'kettle.watts', to: 1850, ms: 500, label: 'Kettle → on' },
        { failPoint: 'overrun' },
        P2_TENMIN, P2_AT_TEN, { wait: 1500 }, P2_WARN,
        { failPoint: 'switchOff' },
        ...P2_OFF,
        P2_MESSAGE,
        { status: (st) => `Tuesday ${offAt(st)} · kettle off, confirmed` },
        { end: { headline: 'On too long, off, and confirmed.', body: 'The morning boil was ignored, as planned. The evening one ran too long, so NeuCharBox switched it off at the plug when your plan said to, checked the meter read 0 W, and told you.' } },
      ],
      genericAt: 'overrun',
      genericTitle: '📝 Noted, not urgent',
      whatIf: {
        kettle: { at: 'switchOff', intro: 'Replaying this request. This time, the kettle plug says "off" but doesn\'t switch off.', steps: [
          { status: (st) => `Tuesday ${offAt(st)} · kettle on ${st.get('plan.warnFirst') ? 15 : 10} min` }, { wait: 800 },
          { status: 'Kettle plug: sending "off"…' }, { wait: 900 },
          { fn: ({ chat, store }) => chat.alert(`${offAt(store)} — the plug reports "off", but it\'s still drawing 1,850 W. The relay hasn\'t opened.`, '⚠ The kettle is NOT off') },
          { fail: 'kettle', faultText: 'says off · 1,850 W' },   // the same moment as the alert: the fn above doesn't wait
          { wait: 1500 },
          { say: 'I don\'t trust the plug\'s word over the meter. A kettle that\'s been on this long with a stuck plug isn\'t something I can fix from here.' },
          { replan: { intro: 'Escalating, by message, right now:', changes: ['Retrying the plug\'s off command', 'Telling you it\'s NOT off, in those words', 'Nothing else in the flat changes — no lights, no sounds'], needsYou: 'Call her now and ask her to switch the kettle off at its own switch or at the wall, and not to pick it up: it may be very hot. If you can\'t reach her, ask someone nearby to go round. Then that plug needs replacing.' } },
          { status: 'Kettle plug: sending "off" again…' }, { wait: 900 }, { fail: 'kettle' },
          { wait: 800 },
          { say: 'Messaged you: "Mum\'s kettle is NOT off. It has been drawing 1,850 W since 18:02 and the plug won\'t switch it off. Please call her and ask her to switch it off at its own switch or at the wall."' },
          { say: 'If she switches it off at the wall, the plug goes dark too, so I\'ll see it drop off rather than read 0 W. Tell me when it\'s done.' },
          HOLD,
          { end: { headline: '"Off" wasn\'t off. It said so.', body: 'The plug claimed success, but the power draw said otherwise. NeuCharBox reported the measurement, not the claim, and handed you a phone call instead of a false all-clear.' } },
        ] },
        mat: { at: 'morning', intro: 'Replaying this request. This time, the bed sensor disagrees with the others in the morning.', steps: [
          { status: 'Tuesday 07:12' }, { wait: 800 },
          { set: 'motion.last', to: '07:10' }, { tween: 'door.open', to: 1, ms: 700, label: 'Bedroom door → open' },
          ...P2_BOIL_ON,
          { wait: 900 },
          { fail: 'mat', title: '📝 Bed sensor disagrees', faultText: 'disagrees with others', say: '07:12 — her door is open, the hallway saw movement at 07:10 and the kettle is on, but the bed sensor still says "in bed", as it has since last night.' },
          { wait: 1500 },
          { say: 'Either someone else is with her this morning, or the bed sensor is stuck, or something heavy is on the bed. I can\'t tell which from here, so I won\'t use the bed sensor for anything today.' },
          { parallel: [{ tween: 'kettle.minutes', to: 3, ms: 1500 }, { tween: 'env.hour', to: 31.25, ms: 1500 }] }, { set: 'kettle.on', to: false }, { set: 'kettle.watts', to: 0 }, { set: 'kettle.minutes', to: 0 },
          { status: 'Tuesday 07:15' },
          { say: '07:15 — the kettle was on for 3 minutes, then off. A normal boil, ignored as planned. The kettle watch reads the plug\'s meter, so the bed sensor makes no difference to it.' },
          { wait: 1000 },
          { replan: { intro: 'The kettle watch, unchanged:', changes: ['Bed sensor: "in bed" since last night, while her door, the hallway and the kettle say someone is up', 'Until you\'ve checked, nothing I tell you today leans on the bed sensor', 'The kettle watch reads the plug\'s meter, as planned, all day'], needsYou: 'Was anyone with her this morning? If not, check nothing heavy is on her bed, then the strip under the mattress.' } },
          { status: 'Tuesday 07:15 · kettle watch on · bed sensor flagged' },
          HOLD,
          { end: { headline: 'The sensors disagreed. It didn\'t pick one.', body: 'The bed sensor said "in bed" while her door, the hallway and the kettle said someone was up. NeuCharBox flagged the disagreement, kept watching the kettle on its meter, and asked you what it couldn\'t know.' } },
        ] },
        door: { at: 'overrun', intro: 'Replaying this request. This time, the bedroom door sensor goes quiet while the kettle is on.', steps: [
          { status: 'Tuesday 18:04 · kettle on 2 min' }, { parallel: [{ tween: 'kettle.minutes', to: 2, ms: 1000 }, { tween: 'env.hour', to: 42.07, ms: 1000 }] },
          { fail: 'door', title: '📝 Door sensor · not urgent', faultText: 'missed check-in', say: '18:04 — the bedroom door sensor missed its check-in. Most likely its battery is flat.' },
          { wait: 1500 },
          { say: 'The kettle watch doesn\'t use the door, so it carries on. I\'ll tell you about the sensor once the kettle is dealt with, in its own message: a message about the kettle should be about the kettle.' },
          P2_TENMIN, P2_AT_TEN, { wait: 1500 }, P2_WARN,
          ...P2_OFF,
          P2_MESSAGE,
          { wait: 1200 },
          { say: 'Then, separately: "Not urgent: the bedroom door sensor in Mum\'s flat missed its 18:04 check-in, most likely a flat battery. Nothing else is affected."' },
          replanWith((st) => ({ intro: 'The kettle first, then the sensor:', changes: [`Kettle: switched off at the plug at ${offAt(st)}, confirmed at 0 W, and you were told`, 'Door sensor: missed its 18:04 check-in, most likely a flat battery. In its own message, marked not urgent', 'Nothing in the kettle watch used it'], needsYou: 'Swap the door sensor\'s battery when you\'re next round. It should rejoin on its own.' })),
          { status: (st) => `Tuesday ${offAt(st)} · kettle off · door sensor flagged` },
          HOLD,
          { end: { headline: 'One message, one subject.', body: 'The door sensor went quiet while the kettle was on. NeuCharBox kept every kettle message about the kettle, and sent the sensor news on its own, marked not urgent.' } },
        ] },
        motion: { at: 'overrun', intro: 'Replaying this request. This time, the hallway motion sensor goes quiet while the kettle is on.', steps: [
          { status: 'Tuesday 18:05 · kettle on 3 min' }, { parallel: [{ tween: 'kettle.minutes', to: 3, ms: 1200 }, { tween: 'env.hour', to: 42.08, ms: 1200 }] },
          { fail: 'motion', title: '📝 Lost the hallway sensor', faultText: 'offline since 18:05', say: '18:05 — the hallway motion sensor missed its check-in. The last thing it reported was movement at 17:58.' },
          { wait: 1500 },
          { say: 'The kettle watch reads the plug\'s meter, so it carries on. But if you ask me whether she has moved since then, the honest answer is: I can\'t tell.' },
          P2_TENMIN, P2_AT_TEN, { wait: 1500 }, P2_WARN,
          ...P2_OFF,
          P2_MESSAGE,
          replanWith((st) => ({ intro: 'Kettle off, one sensor short:', changes: [`Kettle: switched off at the plug at ${offAt(st)}, confirmed at 0 W`, 'Hallway motion sensor: offline since 18:05. Its silence isn\'t read as her not moving', 'Your message is about the kettle only, as planned'], needsYou: 'If you want to know how she is, call her: a sensor that has stopped can\'t tell you either way. Then the hallway sensor needs a look, batteries first.' })),
          { status: (st) => `Tuesday ${offAt(st)} · kettle off · hallway sensor flagged` },
          HOLD,
          // one line on a phone (the old one, "No reading isn't the same as no movement.", broke after "the")
          { end: { headline: 'Silence isn\'t stillness.', body: 'The hallway sensor went offline while the kettle was on. NeuCharBox switched the kettle off as planned, and told you the sensor had stopped instead of letting its silence read like hers.' } },
        ] },
      },
    },
  ],
};
