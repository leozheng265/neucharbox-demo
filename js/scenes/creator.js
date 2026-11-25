// Scene 5 — Creator desk. Proves: one command, whole setup, in the order that keeps a stream clean. Every request runs
// clean; "What if something fails?" on its end card replays it into a device failure (js/engine/whatif.js), where the
// rule is that the audience never sees or hears a broken feed, and NCB says honestly what it can't confirm.

// Step constants shared by the clean runs and the what-if scenarios, so a scenario that "carries on as planned" runs
// exactly the planned steps. The player never mutates steps, so one object can sit in several lists.
// The key light as planned (the warm Edit: 60% · 4000K).
const KEY_ON = { fn: async ({ store, tween, status }) => { const warm = store.get('plan.warm'); status(`Key light → ${warm ? '60% · 4000K' : '80% · 5600K'}`); store.set('keylight.on', true); store.set('keylight.kelvin', warm ? 4000 : 5600); await tween('keylight.brightness', warm ? 0.6 : 0.8, 1200); } };
// The switch to the live scene, then the mic: never open over "Starting soon".
const LIVE_AND_MIC = [{ set: 'overlay.scene', to: 'live', label: 'Overlay → LIVE' }, { wait: 600 }, { set: 'mic.muted', to: false }, { tween: 'mic.level', to: -18, ms: 600, label: 'Mic → live' }];
const STRIP_PURPLE = { parallel: [{ tween: 'strip.hue', to: 0.75, ms: 800, label: 'LED strip → purple' }, { tween: 'strip.brightness', to: 0.8, ms: 800 }] };
const SIGN_ON = { set: 'onair.on', to: true, label: 'On-air sign → ON' };
// Wrap up starts 48 minutes into a stream: NCB didn't do this, so no room marks for it (plan.preset).
const PRESET_LIVE = { fn: ({ store }) => { store.set('plan.preset', true); store.set('keylight.on', true); store.set('keylight.brightness', 0.8); store.set('cam.on', true); store.set('cam.signal', true); store.set('capture.signal', true); store.set('overlay.scene', 'live'); store.set('mic.muted', false); store.set('mic.level', -18); store.set('onair.on', true); store.set('strip.hue', 0.75); store.set('strip.brightness', 0.8); } };
const OUTRO = [{ set: 'overlay.scene', to: 'ending', label: 'Overlay → Thanks for watching' }, { wait: 1500 }, { set: 'overlay.scene', to: 'idle', label: 'Stream → off' }, { wait: 600 }];
const SIGN_OFF = { set: 'onair.on', to: false, label: 'On-air sign → off' };
// Camera off, and the plan's check that the card sees no picture. The wait sits after the check, so a camera that's
// off never shows next to a card that still has a signal in a clean run.
const CAM_OFF = [{ set: 'cam.on', to: false }, { set: 'cam.signal', to: false }];
const VERIFY = [{ set: 'capture.signal', to: false, label: 'Camera off · capture card: no signal, verified' }, { wait: 900 }];
// The plan's last line: key light warm 30% and strip dim, or both off under the dark Edit. Warmer as it dims, never
// orange at 80%; "off" stays 5600K.
const LIGHTS = [
  { status: (store) => (store.get('plan.dark') ? 'Key light and LED strip → off' : 'Key light → warm 30%, LED strip → dim') },
  { fn: async ({ store, tween }) => { const dark = store.get('plan.dark'); const t = [tween('keylight.brightness', dark ? 0 : 0.3, 1200), tween('strip.brightness', dark ? 0 : 0.25, 1200)]; if (!dark) t.push(tween('keylight.kelvin', 3200, 1200)); await Promise.all(t); if (dark) { store.set('keylight.on', false); store.set('strip.on', false); } } },
];
// The two halves of LIGHTS[1], for the stories where one of the two lights is the one that failed.
const KEY_ONLY = { fn: async ({ store, tween }) => { const dark = store.get('plan.dark'); await Promise.all(dark ? [tween('keylight.brightness', 0, 1200)] : [tween('keylight.brightness', 0.3, 1200), tween('keylight.kelvin', 3200, 1200)]); if (dark) store.set('keylight.on', false); } };
const STRIP_ONLY = { fn: async ({ store, tween }) => { const dark = store.get('plan.dark'); await tween('strip.brightness', dark ? 0 : 0.25, 1200); if (dark) store.set('strip.on', false); } };
// Before every scenario's end card: the room's final state, the closing status and the replan stay on screen.
const HOLD = { wait: 3000 };
// You, talking: the mic level moving around `db` for 2 s. It shows in the mic tile that sound is (still) flowing.
const talk = (db) => [{ tween: 'mic.level', to: db + 2, ms: 700 }, { tween: 'mic.level', to: db - 1, ms: 700 }, { tween: 'mic.level', to: db, ms: 600 }];

// Place a loaded model by its bounding box (js/engine/assets.js place()), inlined so the scene needs no extra import.
function placeModel(THREE, obj, { x = 0, y = 0, z = 0, rotY = 0, s = 1, centreY = false } = {}) {
  obj.rotation.y = rotY; obj.scale.setScalar(s); obj.position.set(0, 0, 0); obj.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(obj), c = b.getCenter(new THREE.Vector3());
  obj.position.set(x - c.x, centreY ? y - c.y : y - b.min.y, z - c.z); obj.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(obj);
}

// Shapes for the remodelled kit, after the custom-room versions (js/custom/devices/creator.js): rounded slabs, rods,
// cables, lathes and merged parts. None is added to the scene: the room adds or merges them.
function kit(THREE) {
  const V3 = (p) => (p.isVector3 ? p.clone() : new THREE.Vector3(...p));
  // A rounded rectangle's outline, as exact points (no zero-length edges for ExtrudeGeometry's bevel to trip on).
  const rrect = (w, h, r, n = 5) => {
    const pts = [], cx = w / 2 - r, cy = h / 2 - r;
    for (const [sx, sy, a0] of [[1, -1, -Math.PI / 2], [1, 1, 0], [-1, 1, Math.PI / 2], [-1, -1, Math.PI]])
      for (let i = 0; i <= n; i++) { const a = a0 + (i / n) * (Math.PI / 2); pts.push(new THREE.Vector2(sx * cx + r * Math.cos(a), sy * cy + r * Math.sin(a))); }
    return pts;
  };
  // ExtrudeGeometry shades faceted: each corner point takes the area-weighted normal of the faces meeting there, except
  // across edges sharper than `crease`.
  const smooth = (geo, crease = 1.1) => {
    const pos = geo.attributes.position, nrm = geo.attributes.normal, n = pos.count, fn = [], groups = new Map();
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), s = new THREE.Vector3(), u = new THREE.Vector3(), w = new THREE.Vector3();
    for (let i = 0; i < n; i += 3) { a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2); fn.push(c.sub(b).cross(a.sub(b)).clone()); }
    const key = (i) => `${Math.round(pos.getX(i) * 1e5)},${Math.round(pos.getY(i) * 1e5)},${Math.round(pos.getZ(i) * 1e5)}`;
    for (let i = 0; i < n; i++) { const k = key(i); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); }
    const cos = Math.cos(crease);
    for (const list of groups.values()) for (const i of list) {
      u.copy(fn[(i / 3) | 0]).normalize(); s.set(0, 0, 0);
      for (const j of list) { w.copy(fn[(j / 3) | 0]); if (w.lengthSq() > 0 && w.clone().normalize().dot(u) >= cos) s.add(w); }
      if (s.lengthSq() > 0) { s.normalize(); nrm.setXYZ(i, s.x, s.y, s.z); }
    }
    nrm.needsUpdate = true;
    return geo;
  };
  const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; return m; };
  // A slab w × h × d centred on its origin, its corners rounded in x–y and a soft bevel on every edge.
  const slab = (w, h, d, r, mat, x = 0, y = 0, z = 0, bevel = Math.min(0.002, d / 4)) => {
    const bs = bevel * 0.9;
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(rrect(w - 2 * bs, h - 2 * bs, Math.max(r - bs, 0.0005))), { depth: d - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bs, bevelSegments: 2, curveSegments: 1 });
    g.translate(0, 0, -d / 2 + bevel);
    return mesh(smooth(g), mat, x, y, z);
  };
  // The same lying flat (corners rounded as seen from above): a desk mat, a seat, a keyboard case.
  const flat = (w, h, d, r, mat, x, y, z, bevel) => { const m = slab(w, d, h, r, mat, x, y, z, bevel); m.rotation.x = -Math.PI / 2; return m; };
  // A flat rounded rectangle facing +z with 0–1 uvs (a sign face).
  const roundPlane = (w, h, r) => {
    const g = new THREE.ShapeGeometry(new THREE.Shape(rrect(w, h, r)), 1), uv = g.attributes.uv, p = g.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / w + 0.5, p.getY(i) / h + 0.5);
    return g;
  };
  const box = (w, h, d, mat, x, y, z) => mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z);
  const cyl = (rt, rb, h, mat, x, y, z, seg = 16) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z);
  const cylX = (r, len, mat, x, y, z, seg = 16) => { const m = cyl(r, r, len, mat, x, y, z, seg); m.rotation.z = Math.PI / 2; return m; };
  const cylZ = (r, len, mat, x, y, z, seg = 16) => { const m = cyl(r, r, len, mat, x, y, z, seg); m.rotation.x = Math.PI / 2; return m; };
  // A cylinder from a to b (radius r0 at a, r1 at b).
  const rod = (a, b, r0, r1, mat, seg = 10) => {
    const A = V3(a), d = V3(b).sub(A), len = d.length();
    const m = mesh(new THREE.CylinderGeometry(r1, r0, len, seg), mat);
    m.position.copy(A).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    return m;
  };
  const cable = (pts, r, mat, seg = 40, radial = 6) => mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(V3), false, 'centripetal'), seg, r, radial), mat); // centripetal: no overshoot through the floor
  const lathe = (prof, mat, seg = 40) => mesh(new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), seg), mat);
  // Meshes (not in the scene, each placed by its own position, rotation and scale) baked into one. userData.tint on a part
  // gives it a vertex colour: a hex, or (nx, ny, nz) → hex by its local face normal (a book's page edges).
  const merge = (meshes, mat) => {
    const pos = [], nrm = [], uvs = [], col = [], idx = [], v = new THREE.Vector3(), nm = new THREE.Matrix3(), c = new THREE.Color();
    const tinted = meshes.some((m) => m.userData.tint != null);
    for (const m of meshes) {
      m.updateMatrix(); nm.getNormalMatrix(m.matrix);
      const g = m.geometry, P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, base = pos.length / 3, t = m.userData.tint;
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(m.matrix); pos.push(v.x, v.y, v.z);
        v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nrm.push(v.x, v.y, v.z);
        uvs.push(U ? U.getX(i) : 0, U ? U.getY(i) : 0);
        if (tinted) { c.set(typeof t === 'function' ? t(N.getX(i), N.getY(i), N.getZ(i)) : (t ?? 0xFFFFFF)); col.push(c.r, c.g, c.b); }
      }
      if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
      else for (let i = 0; i < P.count; i++) idx.push(base + i);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    if (tinted) geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    return mesh(geo, mat);
  };
  const canvasTex = (draw, w = 64, h = 64, srgb = true) => {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  // Fine random speckle for a bump map: camera leatherette, foam.
  const speckle = (size = 128, dots = 900, r = 2) => canvasTex((g, w, h) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < dots; i++) { const k = Math.random() < 0.5 ? 40 : 210; g.fillStyle = `rgb(${k},${k},${k})`; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, r * (0.5 + Math.random()), 0, Math.PI * 2); g.fill(); }
  }, size, size, false);
  // Stripes across u (ribbed lens rings) or along v (a coil spring).
  const stripes = (along = 'u') => canvasTex((g, w, h) => { g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, w, h); g.fillStyle = '#5A5F64'; for (let i = 0; i < 4; i++) if (along === 'u') g.fillRect(i * 16 + 8, 0, 7, h); else g.fillRect(0, i * 16 + 8, w, 7); });
  // Vent slots, dark on white (multiplied by the material colour).
  const slots = (rows, w = 256, h = 128) => canvasTex((g, cw, ch) => {
    g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, cw, ch); g.fillStyle = '#2A2D30'; const p = ch / rows;
    for (let i = 0; i < rows; i++) { g.beginPath(); g.roundRect(cw * 0.04, i * p + p * 0.3, cw * 0.92, p * 0.4, p * 0.2); g.fill(); }
  }, w, h);
  return { rrect, slab, flat, roundPlane, mesh, box, cyl, cylX, cylZ, rod, cable, lathe, merge, canvasTex, speckle, stripes, slots };
}

export default {
  id: 'creator',
  title: 'Creator desk',
  startHour: 19.5,
  camera: { position: [2.4, 1.7, 2.9], target: [0.1, 1.0, -1.0], minDistance: 1.5, maxDistance: 5.5, azimuth: [-0.6, 1.1], fitAspect: 1.3 },
  setupIntro: 'A streaming desk. Key light, main camera on the arm, mic on the boom, capture card, the overlay on the monitor, the on-air sign on the wall and an LED strip behind the desk. A spare USB webcam sits on top of the monitor. The hub is on the desk, right of the monitor. Plug it in to start.',
  askIntro: 'What do you want to happen? Pick one, or type your own.',
  deviceOrder: ['keylight', 'cam', 'mic', 'capture', 'overlay', 'onair', 'strip'],
  extraNames: { webcam: 'USB webcam' }, // tap names for pickables that are not devices (main.js nameOf)
  devices: {
    keylight: { icon: 'keylight', name: 'Key light', ref: 'the key light', initial: { on: false, brightness: 0, kelvin: 5600 }, format: (s) => (s.brightness > 0.02 ? `${Math.round(s.brightness * 100)}% · ${Math.round(s.kelvin / 100) * 100}K` : 'off'), active: (s) => s.brightness > 0.02, faultText: 'not responding' }, // kelvin to 100 K: it fades in the wrap-up
    cam:      { icon: 'camera', name: 'Main camera', ref: 'the main camera', initial: { on: false, signal: false }, format: (s) => (s.on ? (s.signal ? 'on · signal' : 'on · no signal') : 'off'), faultText: 'on, but no picture' },
    mic:      { icon: 'mic', name: 'Mic', ref: 'the mic', initial: { muted: true, level: -90 }, format: (s) => (s.muted ? 'muted' : `live · ${Math.round(s.level)} dB`.replace('-', '−')), faultText: 'no input', control: (s) => ({ kind: 'switch', field: 'muted', on: !s.muted }) }, // on = live, so the switch reads opposite to the muted flag
    capture:  { icon: 'capture', name: 'Capture card', ref: 'the capture card', initial: { input: 'HDMI 1', signal: false }, format: (s) => `${s.input} · ${s.signal ? 'signal' : 'no signal'}`, active: (s) => s.signal, faultText: 'signal with camera off' },
    // tag: a note in the monitor's margin (never on the stream); caption: a bar ON the stream's picture
    overlay:  { icon: 'display', name: 'Overlay', ref: 'the overlay app', initial: { scene: 'idle', tag: '', caption: '' },
      format: (s, st) => {
        const b = st?.plan?.backup;
        // With a tag, the thanks screen goes by a shorter name: '"Thanks for watching" · mic cut' took two lines in the
        // desktop tile, and grew its row of the dashboard for the length of the outro.
        const base = s.scene === 'live' && b ? 'LIVE · USB webcam' : s.scene === 'recording' && b ? 'REC · USB webcam' : s.scene === 'recording' && st?.plan?.videoOnly ? 'REC · video only' : s.scene === 'ending' && s.tag ? 'Thanks screen' : { idle: 'idle', starting: '"Starting soon"', live: 'LIVE scene', ending: '"Thanks for watching"', recording: 'REC' }[s.scene] || s.scene;
        return s.caption ? `${base} · caption on` : s.tag ? `${base} · ${s.tag}` : base;
      },
      active: (s) => s.scene !== 'idle', faultText: 'unreachable' },
    onair:    { icon: 'sign', name: 'On-air sign', ref: 'the on-air sign', initial: { on: false }, format: (s) => (s.on ? 'ON AIR' : 'off'), faultText: 'no response' },
    // sat 0: white (its controller's power-on default). "off" at 0%, not "purple · 0%"; red from hue 0.95 (it tweens up to 1)
    strip:    { icon: 'strip', name: 'LED strip', ref: 'the LED strip', initial: { on: true, hue: 0.55, brightness: 0.5, sat: 0.7 },
      format: (s) => (s.on && s.brightness > 0.005 ? `${(s.sat ?? 0.7) < 0.2 ? 'white' : s.hue >= 0.95 ? 'red' : s.hue >= 0.65 ? 'purple' : 'blue'} · ${Math.round(s.brightness * 100)}%` : 'off'),
      active: (s) => s.on && s.brightness > 0.005, faultText: 'off the network' },
  },

  // Real-world assets (js/engine/assets.js, assets/CREDITS.md). Without them (Node tests, a failed download) the room
  // builds from primitives: the flat navy walls, the shared floor, a box desk and the wall shelf.
  assets: {
    models: ['wooden_table_02', 'steel_frame_shelves_02', 'potted_plant_04'],
    textures: ['wood_floor', 'painted_plaster_wall'],
  },

  build({ R, P, M, THREE, store, parts, quiet, speed = 1, assets = null }) {
    const isQuiet = typeof quiet === 'function' ? quiet : () => false; // true while a what-if replays the request quietly
    const A = assets?.models ? assets : null, MOD = (id) => A?.models[id] || null, TX = (id) => A?.textures?.[id] || null;
    const pbr = (id, rep, extra = {}) => { const set = TX(id); if (!set) return null; const m = {}; for (const k of ['map', 'normalMap', 'roughnessMap']) if (set[k]) { const t = set[k].clone(); t.repeat.set(...rep); t.needsUpdate = true; m[k] = t; } return new THREE.MeshStandardMaterial({ ...m, roughness: 1, ...extra }); };
    const K = kit(THREE), add = (o) => { R.scene.add(o); return o; };
    // Navy paint over the plaster's relief (its photo dropped, as in Home's white walls), on a real oak floor, a little
    // darker and matte: at 80% the key light's reflection in a glossy finish blew out a wide patch of floor in front of the
    // chair, seen from the front-left end of the view's sway. Without the textures, flat navy and the shared floor, matted.
    const wallPbr = pbr('painted_plaster_wall', [2.2, 1.2], { color: 0x2E3A48 }); if (wallPbr) { wallPbr.map = null; wallPbr.normalScale.set(0.6, 0.6); }
    const wallMat = wallPbr || new THREE.MeshStandardMaterial({ color: 0x2E3A48, roughness: 0.95 });
    let floorMat = pbr('wood_floor', [2.5, 2.25], { color: 0xCFC6BC, roughness: 0.9 });
    if (!floorMat) { floorMat = M.floor.clone(); Object.assign(floorMat, { roughness: 0.6, clearcoat: 0.12, clearcoatRoughness: 0.55 }); }
    P.roomShell({ w: 5, d: 4.5, h: 2.7, wallMat, floorMat });
    // Skirting and crown on the right wall (x = 2.5: the view's sway shows it about half the time) and the front wall
    // (z = 2.25, seen from behind the back wall), which the shell leaves bare. A few mm lower than the shell's, so no two
    // trims share a face in a corner; the front ones stop at the right wall's. They hide with their walls (renderer.js).
    for (const [hh, y] of [[0.098, 0.049], [0.057, 2.6705]]) { // skirting, crown
      P.onWall(P.flatNormals(P.box(0.02, hh, 4.5, M.trim, 2.49, y, 0), -1, 0, 0), -1, 0, -2.5);
      P.onWall(P.flatNormals(P.box(4.98, hh, 0.02, M.trim, -0.01, y, 2.24), 0, 0, -1), 0, -1, -2.25);
    }
    R.lights.sun.intensity = 0; R.lights.sun.castShadow = false; R.lights.hemi.intensity = 0.25; R.lights.fill.intensity = 0.2; R.scene.background = new THREE.Color(0x141A22); R.scene.environmentIntensity = 0.2;
    const ceilLight = new THREE.PointLight(0xFFF1DC, 3, 8, 1.6); ceilLight.position.set(0.5, 2.6, 0.6); R.scene.add(ceilLight);
    // Its fixture, flush on the ceiling (y = 2.7) just above the bulb, so the bright patch the bulb leaves on the ceiling
    // (seen from low or from behind the room) has a lamp in it. It hides with the ceiling once the camera is above it.
    const lamp = new THREE.Group(); lamp.position.set(0.5, 2.7, 0.6); lamp.userData.wall = { nx: 0, ny: -1, nz: 0, d: -2.7 }; R.scene.add(lamp);
    const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 40), new THREE.MeshStandardMaterial({ color: 0x5E646A, metalness: 0.6, roughness: 0.4 })); lampBase.position.y = -0.015; // a darker rim: it outlines the lamp in its own glow
    const lampDiffuser = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.16, 0.035, 40), new THREE.MeshStandardMaterial({ color: 0xFFFFFF, emissive: 0xFFF1DC, emissiveIntensity: 1.1, roughness: 0.6 })); lampDiffuser.position.y = -0.0375; lamp.add(lampBase, lampDiffuser);
    // Contact shadows: the soft dark where the desk legs, the chair's casters, the shelf and the stands meet the floor.
    R.addContactShadows?.({ w: 5, d: 4.5 });

    // Finishes. Matte black for the gear on and over the desk: the key light is only a metre from the camera rig, and
    // M.black's specular turned the camera, its arm, the keyboard and the monitor's side white whenever the light was on.
    // Everything near the light keeps a low specular for the same reason.
    const gear = new THREE.MeshPhysicalMaterial({ color: 0x141619, roughness: 0.8, metalness: 0, specularIntensity: 0.3 });
    const rub = new THREE.MeshStandardMaterial({ color: 0x17191B, roughness: 0.9 }); // cables, knobs, feet
    const powder = new THREE.MeshPhysicalMaterial({ color: 0x1E2124, roughness: 0.6, metalness: 0.25, specularIntensity: 0.5, clearcoat: 0.1, clearcoatRoughness: 0.6 }); // powder-coated stands and arms
    const cables = []; // every lead in the room, merged into one mesh at the end

    // ---------- desk ----------
    // A plain wooden table stretched to a 1.8 × 0.8 m desk with its top at 0.76: all its vertices sit near its ends and
    // corners, so moving each end out (and the top down) widens the top without fattening the legs. Its own copy of the
    // geometry: the loaded one is shared with every other copy of the model.
    const DESK_Z = -1.75, deskModel = MOD('wooden_table_02');
    if (deskModel) {
      deskModel.traverse((o) => {
        if (!o.isMesh) return;
        const g = o.geometry.clone(); g.userData.shared = false; g.computeBoundingBox();
        const b = g.boundingBox, p = g.attributes.position, cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
        const dx = Math.max(0, (1.8 - (b.max.x - b.min.x)) / 2), dz = Math.max(0, (0.8 - (b.max.z - b.min.z)) / 2), dy = b.max.y - b.min.y - 0.76, yCut = b.min.y + 0.6 * (b.max.y - b.min.y);
        for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); p.setXYZ(i, x + Math.sign(x - cx) * dx, y > yCut ? y - dy : y, z + Math.sign(z - cz) * dz); }
        p.needsUpdate = true; g.computeBoundingBox(); g.computeBoundingSphere(); o.geometry = g;
      });
      add(deskModel); placeModel(THREE, deskModel, { x: 0, z: DESK_Z });
    } else {
      const deskMat = M.wood.clone(); deskMat.roughness = 0.75; // satin rather than semi-gloss, so looking into the key light doesn't blow it out
      P.box(1.8, 0.04, 0.8, deskMat, 0, 0.74, DESK_Z, 0.01); [[-0.85, -0.35], [0.85, -0.35], [-0.85, 0.35], [0.85, 0.35]].forEach((p) => P.box(0.05, 0.72, 0.05, M.black, p[0], 0.36, DESK_Z + p[1]));
    }
    // A felt desk mat under a tenkeyless keyboard (graphite case, PBT caps, an aqua Esc) and a mouse.
    add(K.flat(1.0, 0.003, 0.28, 0.014, new THREE.MeshPhysicalMaterial({ color: 0x2A2D32, roughness: 1, sheen: 0.6, sheenRoughness: 0.8, sheenColor: 0x4A4F56, bumpMap: M.sofa.bumpMap, bumpScale: 0.3 }), 0.05, 0.7615, -1.53, 0.001));
    {
      const u = 0.019, Y0 = 0.763, KZ = -1.6, caseMat = new THREE.MeshPhysicalMaterial({ color: 0x2C3035, metalness: 0.5, roughness: 0.55, specularIntensity: 0.4 });
      add(K.flat(0.362, 0.02, 0.138, 0.008, caseMat, 0, Y0 + 0.01, KZ, 0.002));
      // Rows from the back: e = Esc, g = a gap, m = a modifier, plain numbers = letter keys (widths in key units).
      const rows = [['e1', 'g1', 1, 1, 1, 1, 'g.5', 1, 1, 1, 1, 'g.5', 1, 1, 1, 1], [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 'm2'], ['m1.5', 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 'm1.5'],
        ['m1.75', 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 'm2.25'], ['m2.25', 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 'm2.75'], ['m1.25', 'm1.25', 'm1.25', 6.25, 'm1.25', 'm1.25', 'm1.25', 'm1.25']];
      const nav = [[0, 1, 2], [0, 1, 2], [0, 1, 2], [], [1], [0, 1, 2]]; // the cluster right of the main block, per row
      const TONE = { k: [0x3B4047, 0x474D55], m: [0x272B30, 0x30353B], e: [0x249E9A, 0x33C2BC] }, caps = [];
      const x0 = -0.1734, z0 = KZ - 0.0595;
      const cap = (x, z, w, kind) => { const m = K.box(w * u - 0.0035, 0.008, u - 0.0035, null, x + (w * u) / 2, Y0 + 0.024, z); const [side, top] = TONE[kind]; m.userData.tint = (nx, ny) => (ny > 0.5 ? top : side); caps.push(m); };
      rows.forEach((row, r) => {
        const z = z0 + (r + (r > 0 ? 0.25 : 0)) * u + u / 2; let x = x0;
        for (const k of row) { const kind = typeof k === 'string' ? k[0] : 'k', w = typeof k === 'string' ? parseFloat(k.slice(1)) : k; if (kind !== 'g') cap(x, z, w, kind); x += w * u; }
        for (const c of nav[r]) cap(x0 + 15.25 * u + c * u, z, 1, 'm');
      });
      add(K.merge(caps, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.75, specularIntensity: 0.4 })));
      const mouseMat = new THREE.MeshPhysicalMaterial({ color: 0x1B1D21, roughness: 0.55, specularIntensity: 0.5, clearcoat: 0.2, clearcoatRoughness: 0.5 });
      const shell = K.mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mouseMat, 0.45, Y0, -1.6); shell.scale.set(0.031, 0.036, 0.059);
      add(K.merge([shell], mouseMat)); add(K.cylX(0.008, 0.007, rub, 0.45, Y0 + 0.03, -1.625, 16));
      cables.push(K.cable([[-0.1, Y0 + 0.012, KZ - 0.069], [-0.12, Y0 + 0.003, -1.72], [-0.16, Y0 + 0.003, -1.95], [-0.13, Y0 + 0.003, -2.12], [-0.11, 0.72, -2.168], [-0.06, 0.3, -2.185], [0.3, 0.01, -2.19], [0.56, 0.12, -2.09], [0.6, 0.27, -2.072]], 0.0028, rub, 64));
    }

    // ---------- monitor, with the overlay scene on it ----------
    // A 27-inch monitor: a slim dark shell with a rear housing, on a neck and a flat foot. The screen is matte: the key
    // light, grazing it, doesn't wash the picture out.
    const shellMat = new THREE.MeshPhysicalMaterial({ color: 0x17191D, roughness: 0.75, specularIntensity: 0.3 });
    const standMat = new THREE.MeshPhysicalMaterial({ color: 0x3A3E44, metalness: 0.3, roughness: 0.6, specularIntensity: 0.5 });
    const monitor = add(K.merge([K.slab(0.62, 0.38, 0.012, 0.006, shellMat, 0, 1.14, -1.991), K.slab(0.44, 0.24, 0.026, 0.03, shellMat, 0, 1.15, -2.01, 0.004)], shellMat));
    const monPost = add(K.merge([K.slab(0.05, 0.34, 0.018, 0.008, standMat, 0, 0.95, -2.042), K.slab(0.07, 0.05, 0.02, 0.008, standMat, 0, 1.12, -2.03)], standMat));
    const monBase = add(K.flat(0.24, 0.012, 0.17, 0.03, standMat, 0, 0.766, -1.985, 0.003));
    const screen = P.screenPlane(0.58, 0.34, null); screen.position.set(0, 1.14, -1.983); screen.material.roughness = 0.85;
    cables.push(K.cable([[0.04, 1.03, -2.025], [0.035, 0.95, -2.054], [0.035, 0.8, -2.056], [0.035, 0.764, -2.1], [0.04, 0.763, -2.142], [0.045, 0.72, -2.168], [0.09, 0.3, -2.182], [0.3, 0.02, -2.185], [0.55, 0.15, -2.09], [0.58, 0.29, -2.072]], 0.0035, rub, 64));
    // spare USB webcam clipped on top of the monitor (plugged into the PC, not the capture card)
    const WEB = [0.1, 1.33 + 0.018, -1.99]; // sits on the monitor's top edge (y = 1.33)
    const webMat = new THREE.MeshPhysicalMaterial({ color: 0x1A1C1F, roughness: 0.5, specularIntensity: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.4 });
    const webcam = add(K.mesh(new THREE.CapsuleGeometry(0.016, 0.058, 6, 16), webMat, ...WEB)); webcam.rotation.z = Math.PI / 2; webcam.scale.set(1, 1, 0.9);
    const webClip = add(K.merge([K.box(0.04, 0.004, 0.026, gear, WEB[0], 1.332, -1.99), K.box(0.036, 0.05, 0.004, gear, WEB[0], 1.307, -2.0), K.box(0.03, 0.012, 0.008, gear, WEB[0], 1.338, -1.99)], gear));
    const webLens = add(K.cylZ(0.0115, 0.003, M.anodized, WEB[0], WEB[1], WEB[2] + 0.0148, 24));
    const webGlass = new THREE.Mesh(new THREE.CircleGeometry(0.0085, 20), new THREE.MeshPhysicalMaterial({ color: 0x0A0F14, roughness: 0.08, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03 })); webGlass.position.set(WEB[0], WEB[1], WEB[2] + 0.0166); R.scene.add(webGlass);
    const webcamLed = P.ledDot(WEB[0] + 0.024, WEB[1] + 0.006, WEB[2] + 0.0134, 0x2FBF71, 0.003);
    cables.push(K.cable([[WEB[0], 1.285, -2.003], [0.09, 1.2, -2.027], [0.075, 0.95, -2.05], [0.07, 0.8, -2.055], [0.07, 0.764, -2.1], [0.075, 0.763, -2.142], [0.08, 0.72, -2.168], [0.12, 0.3, -2.18], [0.32, 0.02, -2.18], [0.57, 0.16, -2.09], [0.61, 0.3, -2.072]], 0.0025, rub, 64));

    // ---------- main camera on a desk-clamped arm above the monitor ----------
    // A mirrorless camera (leatherette body, grip, viewfinder hump, a coated zoom lens) on a ball head, turned a little
    // down and towards the chair. The arm clamps on the desk's back edge behind the monitor.
    const camPost = add(K.merge([
      K.slab(0.045, 0.012, 0.06, 0.003, gear, 0.35, 0.766, -2.125), K.slab(0.045, 0.09, 0.012, 0.003, gear, 0.35, 0.7275, -2.156), K.slab(0.045, 0.012, 0.05, 0.003, gear, 0.35, 0.689, -2.13),
      K.cyl(0.005, 0.005, 0.035, gear, 0.35, 0.668, -2.128, 10), K.cyl(0.016, 0.016, 0.01, gear, 0.35, 0.648, -2.128, 20), // clamp screw and its knob
      K.cyl(0.012, 0.012, 0.648, gear, 0.35, 1.096, -2.1, 14), K.cyl(0.017, 0.017, 0.03, gear, 0.35, 1.405, -2.1, 16)], gear));
    const camArm = add(K.merge([K.rod([0.35, 1.415, -2.1], [0.35, 1.432, -1.86], 0.009, 0.009, gear, 10), K.cylX(0.018, 0.032, gear, 0.35, 1.432, -1.86, 18), K.cylX(0.013, 0.012, gear, 0.372, 1.432, -1.86, 16),
      K.rod([0.35, 1.432, -1.86], [0.35, 1.425, -1.66], 0.009, 0.009, gear, 10), K.mesh(new THREE.SphereGeometry(0.014, 14, 10), gear, 0.35, 1.427, -1.645), K.cyl(0.012, 0.016, 0.012, gear, 0.35, 1.418, -1.645, 16)], gear));
    const camBody = add(new THREE.Group()); camBody.position.set(0.35, 1.441, -1.645); camBody.rotation.order = 'YXZ'; camBody.rotation.set(0.1, -0.3, 0);
    let camLed;
    {
      const leather = new THREE.MeshPhysicalMaterial({ color: 0x232629, roughness: 0.7, bumpMap: K.speckle(), bumpScale: 0.6, specularIntensity: 0.4 }); leather.bumpMap.repeat.set(40, 40);
      const topM = new THREE.MeshPhysicalMaterial({ color: 0x2C3034, metalness: 0.4, roughness: 0.5, specularIntensity: 0.5 });
      const ribbed = new THREE.MeshStandardMaterial({ color: 0x2A2D30, roughness: 0.85, map: K.stripes() }); ribbed.map.repeat.set(30, 1);
      const lensMat = new THREE.MeshPhysicalMaterial({ color: 0x1D2023, roughness: 0.55, specularIntensity: 0.4 });
      const coat = new THREE.MeshPhysicalMaterial({ color: 0x0A1016, roughness: 0.04, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.02, iridescence: 0.7, iridescenceIOR: 1.6 }); // multicoated front element
      const lens = new THREE.Group(); lens.add(
        K.lathe([[0.029, 0], [0.032, 0.002], [0.032, 0.012], [0.0335, 0.014], [0.0335, 0.086], [0.0345, 0.089], [0.032, 0.093], [0.0272, 0.093], [0.0262, 0.086]], lensMat, 40),
        K.cyl(0.0345, 0.0345, 0.026, ribbed, 0, 0.033, 0, 40), K.cyl(0.0345, 0.0345, 0.015, ribbed, 0, 0.068, 0, 40), K.cyl(0.0305, 0.0305, 0.004, M.metal, 0, 0, 0, 32));
      const glass = new THREE.Mesh(new THREE.SphereGeometry(0.06, 32, 4, 0, Math.PI * 2, 0, 0.45), coat); glass.position.y = 0.0285; lens.add(glass);
      lens.rotation.x = Math.PI / 2; lens.position.set(0.01, -0.002, 0.02);
      const rear = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.0465), new THREE.MeshPhysicalMaterial({ color: 0x07090B, roughness: 0.12, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.04 })); rear.rotation.y = Math.PI; rear.position.set(0.012, -0.004, -0.0232); rear.userData.noAO = true;
      // the body faces +z, its grip on the -x side (the operator's right); the plate under it sits on the ball head
      const body = new THREE.Group(); body.position.set(-0.01, 0.044, 0); camBody.add(body);
      body.add(
        K.merge([K.slab(0.128, 0.072, 0.04, 0.008, leather), K.slab(0.034, 0.07, 0.03, 0.012, leather, -0.047, -0.001, 0.03)], leather),
        K.merge([K.slab(0.054, 0.026, 0.05, 0.008, topM, 0.01, 0.045, -0.004), K.cyl(0.011, 0.011, 0.007, topM, -0.045, 0.0395, 0.008, 24), K.cyl(0.012, 0.012, 0.008, topM, 0.05, 0.04, 0, 24), K.slab(0.052, 0.008, 0.042, 0.004, topM, 0.01, -0.04, 0)], topM),
        K.merge([K.slab(0.04, 0.026, 0.012, 0.006, rub, 0.01, 0.045, -0.034), K.slab(0.078, 0.054, 0.003, 0.004, rub, 0.012, -0.004, -0.0215)], rub),
        K.merge([K.cyl(0.005, 0.005, 0.004, M.metal, -0.047, 0.0375, 0.03, 14), K.box(0.022, 0.003, 0.018, M.metal, 0.01, 0.0595, -0.006), K.cylX(0.0035, 0.006, M.metal, -0.066, 0.02, -0.005, 10), K.cylX(0.0035, 0.006, M.metal, 0.066, 0.02, -0.005, 10)], M.metal),
        rear, lens);
      camLed = P.ledDot(0, 0, 0, 0xE0563A, 0.005); body.add(camLed); camLed.position.set(0.01, 0.0585, 0.014); // tally lamp, on the front of the hump
    }

    // ---------- mic: a broadcast dynamic mic in a yoke, on a desk-clamped spring boom from the desk's left edge ----------
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const B = V(-0.86, 0.93, -1.55), E = V(-0.72, 1.46, -1.68), T = V(-0.3, 1.43, -1.5); // base pivot, elbow, tip
    const micPost = add(K.merge([
      K.slab(0.06, 0.012, 0.05, 0.003, powder, -0.865, 0.766, -1.55), K.slab(0.012, 0.09, 0.05, 0.003, powder, -0.906, 0.7275, -1.55), K.slab(0.05, 0.012, 0.05, 0.003, powder, -0.87, 0.689, -1.55),
      K.cyl(0.005, 0.005, 0.035, powder, -0.87, 0.668, -1.55, 10), K.cyl(0.016, 0.016, 0.01, powder, -0.87, 0.648, -1.55, 20),
      K.cyl(0.02, 0.02, 0.03, powder, -0.86, 0.787, -1.55, 18), K.cyl(0.014, 0.014, 0.16, powder, -0.86, 0.852, -1.55, 14)], powder));
    const boomParts = [], knobParts = [], springs = [], hubAxis = new THREE.Vector3().crossVectors(T.clone().sub(B), V(0, 1, 0)).normalize();
    for (const [a, b] of [[B, E], [E, T]]) { // each section: two parallel bars with a coil spring above them
      const d = b.clone().sub(a).normalize(), n = V(0, 1, 0).addScaledVector(d, -d.y).normalize(); // the arm's "up", in its own vertical plane
      for (const o of [-0.011, 0.011]) boomParts.push(K.rod(a.clone().addScaledVector(n, o), b.clone().addScaledVector(n, o), 0.0055, 0.0055, powder, 8));
      const springMat = new THREE.MeshStandardMaterial({ color: 0xB9BEC3, metalness: 1, roughness: 0.3, map: K.stripes('v') }); springMat.map.repeat.set(1, (a.distanceTo(b) * 0.65) / 0.004);
      springs.push(add(K.rod(a.clone().lerp(b, 0.18).addScaledVector(n, 0.027), b.clone().lerp(a, 0.18).addScaledVector(n, 0.027), 0.0045, 0.0045, springMat, 10)));
    }
    for (const p of [B, E, T]) { boomParts.push(K.rod(p.clone().addScaledVector(hubAxis, -0.016), p.clone().addScaledVector(hubAxis, 0.016), 0.016, 0.016, powder, 18)); knobParts.push(K.rod(p.clone().addScaledVector(hubAxis, 0.016), p.clone().addScaledVector(hubAxis, 0.026), 0.011, 0.011, rub, 16)); }
    boomParts.push(K.rod(T, V(T.x, T.y - 0.03, T.z), 0.006, 0.006, powder, 10)); // the threaded stud down into the yoke
    const boom = add(K.merge(boomParts, powder)), boomKnobs = add(K.merge(knobParts, rub));
    // The mic hangs in its yoke (turned to the chair) and tilts in it, front down at the streamer's mouth.
    const MIC = T.clone().add(V(0, -0.085, 0)), MOUTH = V(0, 1.17, -0.95);
    const micBody = add(new THREE.Group()); micBody.position.copy(MIC); micBody.rotation.y = Math.atan2(MOUTH.x - MIC.x, MOUTH.z - MIC.z);
    micBody.add(K.merge([K.box(0.084, 0.008, 0.016, powder, 0, 0.058, 0), K.box(0.006, 0.062, 0.016, powder, -0.039, 0.03, 0), K.box(0.006, 0.062, 0.016, powder, 0.039, 0.03, 0), K.cyl(0.006, 0.006, 0.03, powder, 0, 0.075, 0, 10)], powder),
      K.merge([K.cylX(0.012, 0.01, rub, -0.047, 0, 0, 18), K.cylX(0.012, 0.01, rub, 0.047, 0, 0, 18)], rub));
    const micTilt = new THREE.Group(); micTilt.rotation.x = Math.atan2(MIC.y - MOUTH.y, Math.hypot(MOUTH.x - MIC.x, MOUTH.z - MIC.z)); micBody.add(micTilt);
    const micAxis = new THREE.Group(); micAxis.rotation.x = Math.PI / 2; micTilt.add(micAxis); // built along +y, turned to face +z
    let micLed;
    {
      const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0x2B2F33, metalness: 0.4, roughness: 0.5, specularIntensity: 0.5, clearcoat: 0.2, clearcoatRoughness: 0.4 });
      const foamMat = new THREE.MeshPhysicalMaterial({ color: 0x2A2D31, roughness: 1, bumpMap: K.speckle(128, 1400, 1.5), bumpScale: 1.2, sheen: 1, sheenRoughness: 0.8, sheenColor: 0x5A5F64 }); foamMat.bumpMap.repeat.set(6, 4);
      const foam = K.mesh(new THREE.SphereGeometry(1, 22, 14), foamMat, 0, 0.056, 0); foam.scale.set(0.034, 0.05, 0.034);
      const band = K.mesh(new THREE.CylinderGeometry(0.0312, 0.0312, 0.008, 32, 1, true), M.steel, 0, -0.055, 0);
      micAxis.add(K.lathe([[0, -0.1], [0.013, -0.1], [0.02, -0.094], [0.027, -0.075], [0.03, -0.04], [0.031, 0], [0.0305, 0.04], [0.028, 0.055], [0, 0.055]], bodyMat, 32), foam, band, K.cyl(0.012, 0.012, 0.004, M.steel, 0, -0.102, 0, 20));
      micLed = P.ledDot(0, 0, 0, 0xE0563A, 0.005); micAxis.add(micLed); micLed.position.set(0, -0.07, -0.0275); // on top of the body, near its back
    }
    {
      micBody.updateMatrixWorld(true); const back = micAxis.localToWorld(V(0, -0.104, 0));
      cables.push(K.cable([back, back.clone().add(V(0, -0.035, 0.0)), V(T.x - 0.03, T.y - 0.06, T.z - 0.02), E.clone().lerp(T, 0.5).add(V(0, -0.035, 0)), E.clone().add(V(0, -0.035, 0.01)), B.clone().lerp(E, 0.5).add(V(0.01, 0, 0.03)),
        B.clone().add(V(0.02, -0.05, 0.03)), V(-0.82, 0.763, -1.62), V(-0.78, 0.763, -1.95), V(-0.75, 0.763, -2.13), V(-0.72, 0.71, -2.168), V(-0.66, 0.3, -2.19), V(-0.58, 0.05, -2.2), V(-0.45, 0.004, -2.2), V(-0.1, 0.004, -2.2), V(0.3, 0.004, -2.2), V(0.48, 0.03, -2.16), V(0.6, 0.15, -2.09), V(0.64, 0.28, -2.072)], 0.0032, rub, 120));
    }

    // ---------- capture card, the hub, the phone ----------
    // An aluminium capture box between black end caps, HDMI in and out towards the camera post, USB-C towards the PC; the
    // OLED window on top shows its input and whether a picture arrives.
    const capBox = add(new THREE.Group()); capBox.position.set(0.7, 0.76, -1.85); capBox.rotation.y = -Math.PI / 2; // its front (+z, the HDMI end) faces -x
    let capLed, oledTex;
    {
      const alu = new THREE.MeshStandardMaterial({ color: 0xBFC4C9, metalness: 1, roughness: 0.45 }), capMat = new THREE.MeshPhysicalMaterial({ color: 0x17191B, roughness: 0.55 }), Y = 0.017, FONT = 'Inter, "Segoe UI", sans-serif';
      const portTex = K.canvasTex((g) => {
        g.fillStyle = '#17191B'; g.fillRect(0, 0, 256, 37); g.fillStyle = '#7A8188'; g.font = `600 7px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        for (const [x, label] of [[58, 'IN'], [138, 'OUT']]) {
          g.fillText(label, x, 7);
          g.fillStyle = '#9AA0A6'; g.beginPath(); g.moveTo(x - 15, 15); g.lineTo(x + 15, 15); g.lineTo(x + 15, 22); g.lineTo(x + 12, 26); g.lineTo(x - 12, 26); g.lineTo(x - 15, 22); g.closePath(); g.fill();
          g.fillStyle = '#060708'; g.fillRect(x - 13, 17, 26, 6); g.fillStyle = '#7A8188';
        }
        g.fillText('AUDIO', 208, 7); g.fillStyle = '#9AA0A6'; g.beginPath(); g.arc(208, 21, 6, 0, Math.PI * 2); g.fill(); g.fillStyle = '#060708'; g.beginPath(); g.arc(208, 21, 4, 0, Math.PI * 2); g.fill();
      }, 256, 37);
      const usbTex = K.canvasTex((g) => { g.fillStyle = '#17191B'; g.fillRect(0, 0, 256, 37); g.fillStyle = '#9AA0A6'; g.beginPath(); g.roundRect(39, 16, 18, 6, 3); g.fill(); g.fillStyle = '#060708'; g.beginPath(); g.roundRect(41, 17.5, 14, 3, 1.5); g.fill(); }, 256, 37);
      const decal = (tex, z, back) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.128, 0.0185), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 })); m.position.set(0, Y, z); if (back) m.rotation.y = Math.PI; m.userData.noAO = true; return m; };
      const plugs = [K.slab(0.021, 0.0095, 0.03, 0.002, rub, -0.035, Y, 0.0635), K.rod([-0.035, Y, 0.078], [-0.035, Y, 0.095], 0.0042, 0.0034, rub, 10), K.slab(0.012, 0.006, 0.022, 0.002, rub, 0.04, Y, -0.0595), K.rod([0.04, Y, -0.0705], [0.04, Y, -0.082], 0.0032, 0.0026, rub, 10)];
      const feet = [[-0.055, -0.035], [0.055, -0.035], [-0.055, 0.035], [0.055, 0.035]].map(([x, z]) => K.cyl(0.006, 0.006, 0.004, rub, x, 0.002, z, 10));
      const window_ = new THREE.Mesh(K.roundPlane(0.092, 0.041, 0.004), new THREE.MeshPhysicalMaterial({ color: 0x07090B, roughness: 0.12, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.04 })); window_.rotation.x = -Math.PI / 2; window_.position.set(-0.014, 0.0302, 0.004); window_.userData.noAO = true;
      const oc = document.createElement('canvas'); oc.width = 192; oc.height = 80; oledTex = new THREE.CanvasTexture(oc); oledTex.colorSpace = THREE.SRGBColorSpace; oledTex.userData.g = oc.getContext('2d');
      const label = new THREE.Mesh(new THREE.PlaneGeometry(0.084, 0.035), new THREE.MeshStandardMaterial({ map: oledTex, emissive: 0xffffff, emissiveMap: oledTex, emissiveIntensity: 0.7, roughness: 0.3 })); label.rotation.x = -Math.PI / 2; label.position.set(-0.014, 0.0305, 0.004); label.userData.noAO = true;
      capBox.add(K.slab(0.14, 0.026, 0.09, 0.008, alu, 0, Y, 0, 0.0015), K.merge([K.slab(0.137, 0.0235, 0.003, 0.0068, capMat, 0, Y, 0.0465), K.slab(0.137, 0.0235, 0.003, 0.0068, capMat, 0, Y, -0.0465)], capMat),
        decal(portTex, 0.0481, false), decal(usbTex, -0.0481, true), K.merge([...plugs, ...feet], rub), window_, label);
      capLed = P.ledDot(0, 0, 0, 0x2FBF71, 0.005); capBox.add(capLed); capLed.position.set(0.05, 0.03, 0.03); // on top, by the HDMI end
      capBox.updateMatrixWorld(true); const W = (x, y, z) => capBox.localToWorld(V(x, y, z));
      // HDMI from the camera, down its post and across the desk; USB-C off the desk's right edge to the PC under it
      cables.push(K.cable([W(-0.035, Y, 0.094), W(-0.04, 0.005, 0.13), V(0.5, 0.763, -1.92), V(0.42, 0.763, -2.04), V(0.368, 0.775, -2.098), V(0.366, 1.0, -2.112), V(0.366, 1.35, -2.112), V(0.372, 1.43, -2.06), V(0.38, 1.452, -1.86), V(0.392, 1.462, -1.7), V(0.405, 1.472, -1.64)], 0.0032, rub, 80),
        K.cable([W(0.04, Y, -0.081), W(0.042, 0.004, -0.11), V(0.88, 0.763, -1.86), V(0.912, 0.74, -1.872), V(0.92, 0.6, -1.9), V(0.86, 0.35, -1.98), V(0.76, 0.3, -2.06), V(0.68, 0.32, -2.074)], 0.0026, rub, 48));
    }
    // The hub sits right of the monitor, clear of the camera post, the mouse and the capture card, and turned a little to the
    // default view: from there (on a phone too) it, its ring and its label stay clear of the chair back. The phone is by it.
    const hub = P.hub(0.5, 0.76, -1.78, { rotY: 0.3 }); R.addPickable(hub.group, 'hub'); P.phone(0.75, 0.765, -1.56, 0.35);
    // The PC under the desk, right side: a dark case with a perforated front and a smoked-glass side.
    {
      const caseMat = new THREE.MeshPhysicalMaterial({ color: 0x1A1C1F, roughness: 0.5, metalness: 0.3, clearcoat: 0.2, clearcoatRoughness: 0.5 });
      add(K.slab(0.21, 0.46, 0.43, 0.012, caseMat, 0.62, 0.238, -1.85, 0.003));
      const perf = K.canvasTex((g) => { g.fillStyle = '#26292D'; g.fillRect(0, 0, 32, 32); g.fillStyle = '#08090A'; for (const [x, y] of [[8, 8], [24, 24], [24, 8], [8, 24]]) { g.beginPath(); g.arc(x, y, 4.5, 0, Math.PI * 2); g.fill(); } }, 32, 32); perf.repeat.set(22, 56);
      const front = add(K.mesh(new THREE.PlaneGeometry(0.17, 0.42), new THREE.MeshStandardMaterial({ map: perf, roughness: 0.7, metalness: 0.3 }), 0.62, 0.238, -1.634)); front.userData.noAO = true; front.castShadow = false;
      const side = add(K.mesh(new THREE.PlaneGeometry(0.38, 0.4), new THREE.MeshPhysicalMaterial({ color: 0x07090B, roughness: 0.1, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 }), 0.5145, 0.238, -1.85)); side.rotation.y = -Math.PI / 2; side.userData.noAO = true; side.castShadow = false;
    }

    // ---------- key light ----------
    // An LED key panel (an edge-lit diffuser in an anodised frame) on a light stand right of the desk, in front of the
    // chair, aimed at where the streamer sits. lookAt turns the panel's +z face (the diffuser) to the chair, which also
    // faces it to the default view behind the chair. An arm from the stand's top meets its tilt bracket.
    const KEY = [1.35, 1.7, -1.95], KEY_AIM = [0, 1.15, -0.9], KEY_SPOT = [-0.1, 0.95, -1.25]; // spot centred between desk and chair
    const kAim = new THREE.Vector3(...KEY_AIM).sub(new THREE.Vector3(...KEY)).normalize(); const kBack = new THREE.Vector3(...KEY).addScaledVector(kAim, -0.039); // the bracket's back
    const kPole = new THREE.Vector3(-kAim.x, 0, -kAim.z).normalize().multiplyScalar(0.14).add(new THREE.Vector3(KEY[0], 1.58, KEY[2])); // stand top, behind the panel
    const softbox = add(new THREE.Group()); softbox.position.set(...KEY); softbox.lookAt(...KEY_AIM);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x3A3E43, metalness: 1, roughness: 0.38 });
    const panel = K.slab(0.434, 0.294, 0.004, 0.006, new THREE.MeshPhysicalMaterial({ color: 0x9A9EA2, emissive: 0xFFF6E8, emissiveIntensity: 0, roughness: 0.4, clearcoat: 0.3, clearcoatRoughness: 0.3 }), 0, 0, 0.0125);
    const vents = K.mesh(new THREE.PlaneGeometry(0.4, 0.25), new THREE.MeshStandardMaterial({ map: K.slots(14), color: 0x3A3E43, metalness: 0.8, roughness: 0.45 }), 0, 0, -0.0135); vents.rotation.y = Math.PI; vents.userData.noAO = true; vents.castShadow = false;
    softbox.add(K.merge([K.slab(0.46, 0.32, 0.026, 0.014, frameMat), K.slab(0.05, 0.04, 0.028, 0.006, frameMat, 0, 0, -0.025)], frameMat), panel, vents, K.cylX(0.011, 0.01, rub, 0.031, 0, -0.025, 18));
    // The stand: three legs hinged on a collar 42 cm up and braced from a lower one (one leg towards the room, none
    // towards the wall), rubber feet, a two-section pole with a T-knob lock at the joint.
    const PX = kPole.x, PZ = kPole.z, legs = [], feet = [];
    for (let i = 0; i < 3; i++) {
      const a = Math.PI / 2 + i * (Math.PI * 2 / 3), c = Math.cos(a), s = Math.sin(a), top = [PX + c * 0.022, 0.42, PZ + s * 0.022], foot = [PX + c * 0.22, 0.014, PZ + s * 0.22];
      legs.push(K.rod(top, foot, 0.009, 0.008, powder, 8), K.rod([PX + c * 0.018, 0.2, PZ + s * 0.018], top.map((v, k) => (v + foot[k]) / 2), 0.005, 0.005, powder, 6));
      feet.push(K.cyl(0.011, 0.013, 0.018, rub, PX + c * 0.22, 0.009, PZ + s * 0.22, 10));
    }
    legs.push(K.cyl(0.022, 0.022, 0.06, powder, PX, 0.42, PZ, 16), K.cyl(0.02, 0.02, 0.03, powder, PX, 0.2, PZ, 16));
    const kBase = add(K.merge(legs, powder)), kFeet = add(K.merge([...feet, K.cylX(0.011, 0.012, rub, PX + 0.05, 0.97, PZ, 16)], rub));
    const kStand = add(K.merge([K.cyl(0.016, 0.016, 0.82, powder, PX, 0.56, PZ, 14), K.cyl(0.021, 0.021, 0.045, powder, PX, 0.97, PZ, 16), K.cyl(0.012, 0.012, 0.61, powder, PX, 1.275, PZ, 12), K.cylX(0.004, 0.03, powder, PX + 0.033, 0.97, PZ, 8)], powder));
    const kArm = add(K.merge([K.rod(kPole, kBack, 0.01, 0.01, powder, 10), K.mesh(new THREE.SphereGeometry(0.017, 14, 10), powder, kPole.x, kPole.y, kPole.z)], powder));
    // A 40° half-angle with a wide soft edge: the chair, the streamer's head, the desk and the camera (12–18° off the axis)
    // stay in the full beam, while the floor past the chair falls in the soft edge. At 52° it lit that floor to a white pool.
    // Its reach is 5 m: the beam fades before the left wall, 4.4 m away along its axis past the chair, where at 6 m it left a
    // hot spot on the white skirting (phones, which have no AO, bloomed it). The chair and desk, 2 m away, lose about 2%.
    const keyLight = new THREE.SpotLight(0xFFF6E8, 0, 5, 0.7, 0.7, 1.2); keyLight.position.set(...KEY); keyLight.target.position.set(...KEY_SPOT); keyLight.castShadow = true; keyLight.shadow.mapSize.setScalar(R.quality === 'high' ? 2048 : 1024); keyLight.shadow.bias = -0.002; keyLight.shadow.normalBias = 0.02; R.scene.add(keyLight); R.scene.add(keyLight.target); // normalBias: the light grazes the back wall, which otherwise shows moiré rings (shadow acne)
    // A 50 cm panel a metre from the camera rig casts a faint, very soft shadow, not a hard black cut-out of the rig on the
    // left wall: partial (intensity) and blurred (radius, in shadow-map texels).
    keyLight.shadow.intensity = 0.55; keyLight.shadow.radius = 4;

    // ---------- on-air sign on the back wall above the monitor ----------
    // A lit box sign: a graphite housing with a red acrylic face, "ON AIR" glowing through it while on; its cord runs into
    // a wall outlet just below. Its back is just inside the wall plane at z = -2.25.
    const SIGN_Z = -2.25 + 0.002 + 0.025;
    const signBox = add(K.slab(0.46, 0.17, 0.05, 0.02, new THREE.MeshPhysicalMaterial({ color: 0x2A2E32, roughness: 0.6, metalness: 0.3, clearcoat: 0.15, clearcoatRoughness: 0.5 }), 0, 1.8, SIGN_Z, 0.004));
    const signTex = K.canvasTex((g) => {
      const gr = g.createLinearGradient(0, 0, 0, 160); gr.addColorStop(0, '#220808'); gr.addColorStop(0.5, '#2E0A0A'); gr.addColorStop(1, '#1A0606'); g.fillStyle = gr; g.fillRect(0, 0, 512, 160);
      g.strokeStyle = 'rgba(255,48,48,.5)'; g.lineWidth = 4; g.beginPath(); g.roundRect(14, 14, 484, 132, 12); g.stroke();
      g.fillStyle = '#FF3030'; g.shadowColor = '#FF3030'; g.shadowBlur = 16; g.font = '800 84px Inter, "Segoe UI", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ON AIR', 256, 84); g.shadowBlur = 0;
    }, 512, 160); signTex.wrapS = signTex.wrapT = THREE.ClampToEdgeWrapping; signTex.anisotropy = 8;
    // matte, like the screen: seen along the wall, the key light's glare turned it white
    const signFace = add(K.mesh(K.roundPlane(0.43, 0.14, 0.01), new THREE.MeshStandardMaterial({ map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0, roughness: 0.85 }), 0, 1.8, SIGN_Z + 0.0255)); signFace.castShadow = false;
    const signExtras = [
      add(K.merge([-0.222, 0.222].map((x) => K.cylZ(0.0035, 0.002, M.steel, x, 1.8, SIGN_Z + 0.0255, 12)), M.steel)),
      add(K.merge([K.rod([0.19, 1.717, SIGN_Z - 0.005], [0.19, 1.7, SIGN_Z - 0.005], 0.0045, 0.0035, rub, 10), K.cable([[0.19, 1.702, SIGN_Z - 0.005], [0.19, 1.67, SIGN_Z - 0.009], [0.19, 1.64, SIGN_Z - 0.013], [0.19, 1.63, SIGN_Z - 0.017]], 0.003, rub, 16)], rub)),
      add(K.slab(0.05, 0.05, 0.008, 0.006, new THREE.MeshPhysicalMaterial({ color: 0xD9DCDF, roughness: 0.55 }), 0.19, 1.615, -2.25 + 0.006)),
    ];

    // ---------- LED strip on the wall behind the desk ----------
    // A diffused LED channel: an aluminium profile with an opal cover (the part that glows), end caps and mounting clips,
    // just inside the wall plane (z = -2.25) and above the desk top, wired to a small controller at its right end.
    const SZ = -2.25 + 0.002, stripAlu = new THREE.MeshStandardMaterial({ color: 0xA9AEB3, metalness: 1, roughness: 0.4 });
    const clips = []; for (const x of [-0.7, 0, 0.7]) for (const y of [-0.0105, 0.0105]) clips.push(K.box(0.012, 0.003, 0.009, stripAlu, x, 0.86 + y, SZ + 0.0045));
    const stripChannel = add(K.merge([K.slab(1.8, 0.018, 0.007, 0.002, stripAlu, 0, 0.86, SZ + 0.0035, 0.001), K.slab(0.006, 0.02, 0.012, 0.002, stripAlu, -0.902, 0.86, SZ + 0.006), K.slab(0.006, 0.02, 0.012, 0.002, stripAlu, 0.902, 0.86, SZ + 0.006), ...clips], stripAlu));
    const strip = add(K.mesh(new THREE.CylinderGeometry(0.0072, 0.0072, 1.796, 18, 1, true, -Math.PI / 2, Math.PI), new THREE.MeshStandardMaterial({ color: 0xBFC3C8, emissive: 0x6B4FD8, emissiveIntensity: 2, roughness: 0.35 }), 0, 0.86, SZ + 0.0068));
    strip.rotation.z = Math.PI / 2; strip.scale.set(1, 1, 0.55); strip.castShadow = false; // a low opal dome over the channel
    // Never drawn: a tap target bigger than the strip. A plane facing the room, not a box: picking only takes its front
    // face, so from behind the back wall it doesn't catch taps meant for the hub or the capture card in front of it.
    const stripPick = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.1), new THREE.MeshBasicMaterial({ visible: false })); stripPick.position.set(0, 0.86, -2.17); R.scene.add(stripPick);
    const stripLights = [-0.5, 0.5].map((x) => { const l = new THREE.PointLight(0x6B4FD8, 1, 2.5, 1.5); l.position.set(x, 0.95, -2.17); R.scene.add(l); return l; }); // wall wash either side of the monitor
    const stripCtl = add(K.slab(0.06, 0.03, 0.016, 0.005, new THREE.MeshPhysicalMaterial({ color: 0x2B2F33, roughness: 0.55, clearcoat: 0.2, clearcoatRoughness: 0.5 }), 0.94, 0.86, -2.242)); // the strip's controller, at its right end, clear of the desk in the default view
    const stripExtras = [add(K.cylZ(0.005, 0.003, M.steel, 0.922, 0.86, -2.2325, 16)),
      add(K.merge([K.cable([[0.9, 0.86, SZ + 0.005], [0.905, 0.855, SZ + 0.006], [0.911, 0.86, SZ + 0.007]], 0.0022, rub, 8), K.cable([[0.955, 0.846, SZ + 0.006], [0.958, 0.8, SZ + 0.005], [0.965, 0.4, SZ + 0.004], [0.97, 0.012, SZ + 0.004]], 0.0025, rub, 24)], rub))];

    // ---------- status LEDs and fault glows ----------
    // Status LEDs for the three devices with no fault cue of their own (the key light's panel, the sign's lettering and
    // the strip show only what they were last set to): green and dim while connected, blinking red in fault like the
    // tally and the mic LED, hidden while not connected. update() sets their .visible, so none is wall-tagged itself: the
    // two on the back wall are children of wall-tagged parts and hide with them.
    // The key light's LED sits on its smart dimmer pod clamped to the stand, below the panel: on the panel's frame the
    // diffuser's glow swallowed it while the light was on.
    const keyCtl = add(K.merge([K.slab(0.044, 0.07, 0.03, 0.008, null, PX, 1.22, PZ + 0.028), K.box(0.02, 0.03, 0.014, null, PX, 1.22, PZ + 0.01)], new THREE.MeshPhysicalMaterial({ color: 0xE4E7E9, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.4 }))); // pod and its clamp
    const keyDial = add(K.cylZ(0.009, 0.004, M.steel, PX, 1.204, PZ + 0.045, 20));
    const keyLed = P.ledDot(0, 0, 0, 0x2FBF71, 0.007); keyCtl.add(keyLed); keyLed.position.set(PX, 1.24, PZ + 0.0445); // its front face
    cables.push(K.cable([[kBack.x, kBack.y - 0.02, kBack.z], [PX + 0.01, 1.45, PZ + 0.015], [PX, 1.3, PZ + 0.03], [PX, 1.257, PZ + 0.03]], 0.0035, rub, 24),
      K.cable([[PX, 1.185, PZ + 0.03], [PX + 0.004, 1.1, PZ + 0.022], [PX + 0.02, 0.6, PZ + 0.02], [PX + 0.024, 0.45, PZ + 0.03], [PX + 0.06, 0.12, PZ + 0.02], [PX + 0.1, 0.008, PZ - 0.06], [PX + 0.16, 0.006, -2.2], [PX + 0.3, 0.006, -2.236]], 0.0035, rub, 40));
    const signLed = P.ledDot(0, 0, 0, 0x2FBF71, 0.006); signBox.add(signLed); signLed.position.set(0.2, -0.0775, 0.0255); // the sign frame, bottom right
    const stripLed = P.ledDot(0, 0, 0, 0x2FBF71, 0.005); stripCtl.add(stripLed); stripLed.position.set(0.015, 0, 0.0095);
    for (const l of [keyLed, signLed, stripLed, camLed, micLed, capLed]) l.userData.noHighlight = true; // a tap pulses the device, not a halo round its LED
    // Every fault LED here is a dot of a few pixels (one or two on a phone), and its bright blink tone-maps to near white:
    // once the fault ring has gone, the room hardly showed which device was down. In fault, a soft red glow of constant
    // screen size blinks with the LED (as the home scene does). Normal blending, depth-tested, kept 12 cm towards the
    // camera so its own device never cuts it; the two on the back wall sit in holders tagged with it, so they hide with it.
    const glowMap = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32); rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.22, 'rgba(255,255,255,.85)'); rg.addColorStop(0.5, 'rgba(255,255,255,.3)'); rg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = rg; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
    const glow = (led, wall = false) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, color: 0xE8402A, transparent: true, depthWrite: false, sizeAttenuation: false, opacity: 0 }));
      sp.scale.setScalar(0.035); sp.visible = false; sp.userData.noAO = true; sp.raycast = () => {}; R.scene.add(sp); if (wall) P.onWall(P.group(sp), 0, 1, -2.25);
      led.updateWorldMatrix(true, false); const at = led.getWorldPosition(new THREE.Vector3()), v = new THREE.Vector3();
      return (k) => { sp.visible = k > 0.01; if (!sp.visible) return; sp.material.opacity = k; v.subVectors(R.camera.position, at); const d = v.length() || 1; sp.position.copy(at).addScaledVector(v, Math.min(0.12, d * 0.5) / d); };
    };
    const glows = { keylight: glow(keyLed), cam: glow(camLed), mic: glow(micLed), capture: glow(capLed), onair: glow(signLed, true), strip: glow(stripLed, true) };

    // ---------- acoustic foam, the shelf, the chair ----------
    // Wedge-cut acoustic foam tiles, laid in a checkerboard (every other one turned a quarter): two blocks of nine either
    // side of the sign on the back wall and six on the left wall. Charcoal, with a few in a deep petrol. Each wall's tiles
    // are one mesh, hung on (and hiding with) that wall.
    {
      const pts = [[-0.15, 0], [0.15, 0], [0.15, 0.012]]; for (let k = 5; k >= 0; k--) pts.push([-0.15 + (k + 0.5) * 0.05, 0.048], [-0.15 + k * 0.05, 0.012]);
      const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))), { depth: 0.296, bevelEnabled: false }); geo.translate(0, 0, -0.148); geo.rotateX(Math.PI / 2); // ridges along y, its back at z = 0
      const foamMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, bumpMap: K.speckle(128, 1400, 1.5), bumpScale: 0.8 }); foamMat.bumpMap.repeat.set(9, 9);
      const TONES = [0x2A2F36, 0x252A31, 0x2E333B], PETROL = 0x1D4148;
      const tile = (x, y, z, rotY, i, j, hex) => { const m = new THREE.Mesh(geo, foamMat); m.position.set(x, y, z); m.rotation.set(0, rotY, (i + j) % 2 ? Math.PI / 2 : 0); m.userData.tint = hex ?? TONES[(i * 7 + j * 5) % 3]; return m; };
      const back = [], left = [], accent = { '-1': ['0,0', '2,2'], 1: ['0,2', '2,0'] };
      for (const side of [-1, 1]) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) back.push(tile(side * 0.85 + (i - 1) * 0.31, 1.47 + j * 0.31, -2.248, 0, i, j, accent[side].includes(`${i},${j}`) ? PETROL : null));
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) left.push(tile(-2.498, 1.5 + j * 0.31, -0.8 + (i - 1) * 0.31, Math.PI / 2, i, j, i === 1 && j === 1 ? PETROL : null));
      const onBack = add(K.merge(back, foamMat)), onLeft = add(K.merge(left, foamMat)); onBack.castShadow = onLeft.castShadow = false;
      P.onWall(onBack, 0, 1, -2.25); P.onWall(onLeft, 1, 0, -2.5);
    }
    // A narrow steel-and-wood shelf in the back-left corner: the plant on the eye-level board, books below it and on top,
    // fabric bins and a box of kit lower down. Without the model, the wall shelf with its plant and three books.
    const shelfModel = MOD('steel_frame_shelves_02');
    if (shelfModel) {
      add(shelfModel); const sb = placeModel(THREE, shelfModel, { x: -1.9, z: -2.25 + 0.012 + 0.23, s: 0.92 });
      const lv = (y) => sb.min.y + (y / 2.141) * (sb.max.y - sb.min.y), SX = -1.9, SZc = (sb.min.z + sb.max.z) / 2, FRONT = SZc + 0.2; // board tops in the model's metres (it is 2.141 m tall)
      const plantModel = MOD('potted_plant_04');
      if (plantModel) { add(plantModel); placeModel(THREE, plantModel, { x: SX + 0.08, y: lv(1.651), z: SZc + 0.03, s: 1.35, rotY: 0.5 }); } else P.plant(SX + 0.08, SZc + 0.03, { scale: 0.32, y: lv(1.651) });
      // Books: covers in muted colours, their tops and fore-edges page-cream, a light band on each spine.
      let seed = 11; const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
      const COVERS = [0x2F4858, 0x8C3B2F, 0xC8B68E, 0x3E5641, 0x1F2A36, 0xA6623A, 0x5B4A6B, 0xD9D2C2, 0x264653, 0x7A2E3A, 0x4A5A6A, 0xB59A5B], PAGES = 0xE4DBC6, BANDS = [0xD8C79A, 0xEDE6D6, 0x16181B];
      const books = [];
      const upright = (x, y, t, h, d, lean = 0) => { // x: its left edge on the board
        const hex = COVERS[Math.floor(rnd() * COVERS.length)], z = FRONT - d / 2;
        const b = K.box(t, h, d, null, x + t / 2, y + h / 2, z); b.userData.tint = (nx, ny, nz) => (ny > 0.5 || nz < -0.5 ? PAGES : hex);
        const band = K.box(t + 0.0008, 0.012, 0.0012, null, x + t / 2, y + h * 0.72, FRONT + 0.0004); band.userData.tint = BANDS[Math.floor(rnd() * BANDS.length)];
        if (lean) for (const m of [b, band]) { const p = m.position.clone().sub(V(x, y, z)); m.position.copy(p.applyAxisAngle(V(0, 0, 1), lean).add(V(x, y, z))); m.rotation.z = lean; } // on its bottom-left edge
        books.push(b, band);
      };
      const lying = (x, y, w, t, d) => { const hex = COVERS[Math.floor(rnd() * COVERS.length)], b = K.box(w, t, d, null, x, y + t / 2, FRONT - d / 2); b.userData.tint = (nx, ny, nz) => (Math.abs(nx) > 0.5 || nz < -0.5 ? PAGES : hex); books.push(b); return y + t; };
      { // a row on the board below the plant, two leaning at its end, a small stack and a spare lens on it
        const y = lv(1.148); let x = SX - 0.24;
        while (x < SX - 0.03) { const t = 0.018 + rnd() * 0.022; upright(x, y, t, 0.18 + rnd() * 0.07, 0.13 + rnd() * 0.04); x += t + 0.001; }
        upright(x + 0.22 * Math.sin(0.28) + 0.002, y, 0.026, 0.22, 0.15, 0.28); // its top resting on the row
        let top = y; for (const [w, t] of [[0.13, 0.03], [0.12, 0.024], [0.11, 0.02]]) top = lying(SX + 0.175, top, w, t, 0.15 + w * 0.2);
        add(K.merge([K.cyl(0.032, 0.032, 0.07, null, SX + 0.175, top + 0.035, FRONT - 0.07, 28)], new THREE.MeshPhysicalMaterial({ color: 0x1D2023, roughness: 0.5, specularIntensity: 0.5 })));
      }
      { let top = lv(2.135); for (const [w, t] of [[0.24, 0.035], [0.21, 0.028], [0.22, 0.03]]) top = lying(SX - 0.06, top, w, t, 0.2); } // a stack on top
      { const y = lv(1.651); let top = y; for (const [w, t] of [[0.18, 0.025], [0.16, 0.022]]) top = lying(SX - 0.13, top, w, t, 0.13); } // by the plant
      { let top = lv(0.132); for (const [w, t] of [[0.22, 0.035], [0.2, 0.03]]) top = lying(SX + 0.12, top, w, t, 0.24); } // coffee-table books at the bottom
      add(K.merge(books, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 })));
      // two felt storage bins on the board below the books, and a carton of spare kit at the bottom
      const felt = M.sofa.clone(); felt.color.set(0x6E747C);
      for (const x of [SX - 0.118, SX + 0.118]) { add(K.slab(0.226, 0.2, 0.34, 0.012, felt, x, lv(0.641) + 0.1, SZc + 0.03, 0.006)); const hole = add(K.mesh(K.roundPlane(0.09, 0.03, 0.015), new THREE.MeshBasicMaterial({ color: 0x0A0B0D }), x, lv(0.641) + 0.16, SZc + 0.2005)); hole.castShadow = false; hole.userData.noAO = true; }
      P.parcel(SX - 0.115, lv(0.132), SZc - 0.02, 0.22);
    } else {
      P.onWall(P.box(1.2, 0.03, 0.22, M.wood, -1.3, 1.9, -2.13), 0, 1, -2.25); // shelf, top at y = 1.915
      const plant = P.plant(-1.7, -2.1, { scale: 0.45, y: 1.915, front: true }); P.onWall(plant.group, 0, 1, -2.25); // on the shelf
      for (let i = 0; i < 3; i++) P.onWall(P.box(0.05, 0.22, 0.16, [M.yellow, M.white, M.cardboard][i], -1.05 + i * 0.07, 2.025, -2.12), 0, 1, -2.25);
    }
    // The chair: a mesh-back task chair facing the desk on a five-star base with twin-wheel casters, a gas lift, a padded
    // seat and armrests. Low-back: the backrest's top is at 0.90, under the view line to the hub and capture card as the
    // view sways past it.
    {
      const CZ = -0.9, base = new THREE.MeshPhysicalMaterial({ color: 0x2E3236, metalness: 0.6, roughness: 0.45, clearcoat: 0.2, clearcoatRoughness: 0.5 });
      const nylon = new THREE.MeshStandardMaterial({ color: 0x16181B, roughness: 0.65 }), fabric = M.sofa.clone(); fabric.color.set(0x80868E); // the grey weave, darkened to charcoal, with its sheen
      const metal = [K.cyl(0.05, 0.055, 0.05, base, 0, 0.105, CZ, 24)], black = [];
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + Math.PI / 10, c = Math.cos(a), s = Math.sin(a);
        metal.push(K.rod([c * 0.04, 0.11, CZ + s * 0.04], [c * 0.3, 0.085, CZ + s * 0.3], 0.022, 0.013, base, 10));
        black.push(K.cyl(0.011, 0.013, 0.03, nylon, c * 0.3, 0.062, CZ + s * 0.3, 10));
        for (const o of [-0.011, 0.011]) { const w = K.cylX(0.024, 0.014, nylon, c * (0.32 + o), 0.024, CZ + s * (0.32 + o), 18); w.rotation.y = -a; black.push(w); } // twin wheels on one axle
      }
      black.push(K.cyl(0.028, 0.03, 0.2, nylon, 0, 0.23, CZ, 20), K.slab(0.2, 0.045, 0.22, 0.01, nylon, 0, 0.43, CZ, 0.003), K.rod([0.1, 0.43, CZ - 0.05], [0.2, 0.425, CZ - 0.09], 0.005, 0.005, nylon, 8),
        K.flat(0.48, 0.02, 0.46, 0.06, nylon, 0, 0.452, CZ, 0.004));
      for (const sx of [-1, 1]) black.push(K.cable([[sx * 0.09, 0.43, CZ + 0.02], [sx * 0.22, 0.435, CZ + 0.02], [sx * 0.266, 0.47, CZ + 0.02], [sx * 0.27, 0.6, CZ], [sx * 0.27, 0.642, CZ - 0.01]], 0.014, nylon, 24, 8), K.flat(0.075, 0.026, 0.24, 0.03, nylon, sx * 0.27, 0.655, CZ - 0.03, 0.008));
      add(K.merge(metal, base)); add(K.merge(black, nylon)); add(K.cyl(0.014, 0.014, 0.1, M.metal, 0, 0.375, CZ, 16)); // chrome piston
      add(K.flat(0.5, 0.06, 0.48, 0.07, fabric, 0, 0.49, CZ, 0.014)); // seat, top at 0.52
      add(K.cable([[0, 0.43, CZ + 0.1], [0, 0.445, CZ + 0.24], [0, 0.5, CZ + 0.28], [0, 0.6, CZ + 0.278], [0, 0.625, CZ + 0.27]], 0.018, base, 24, 10)); // the back's spine
      // the backrest: a curved mesh panel in a frame, reclined a little; its top at 0.90
      const back = add(new THREE.Group()); back.position.set(0, 0.57, CZ + 0.255); back.rotation.x = 0.12;
      const backMat = fabric.clone(); backMat.side = THREE.DoubleSide; backMat.color.set(0x6A7078);
      const R_ = 0.55, half = 0.23 / R_, pg = new THREE.CylinderGeometry(R_, R_, 0.3, 18, 1, true, -half, 2 * half); pg.translate(0, 0.15, -R_);
      const ring = K.rrect(0.46, 0.3, 0.045, 4).map((p) => { const th = p.x / R_; return new THREE.Vector3(R_ * Math.sin(th), p.y + 0.15, R_ * Math.cos(th) - R_); });
      back.add(K.mesh(pg, backMat), K.mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ring, true), 96, 0.012, 6, true), nylon));
    }
    add(K.merge(cables, rub));
    // Hung on the back wall (z = -2.25): hidden with it once the camera is behind it (renderer.js). Not the strip's lights
    // (the room's lighting must not change with the view) nor stripPick (never drawn).
    for (const o of [signBox, signFace, ...signExtras, strip, stripChannel, stripCtl, ...stripExtras]) P.onWall(o, 0, 1, -2.25);

    // The monitor: what the overlay app draws. tag: a note in the monitor's margin, never on the stream; caption: a bar ON
    // the stream's picture; dim: the key light is out (a darker figure); fault: the app is hung, so its last frame stays up,
    // dimmed, with a red pill. update() freezes the inputs while it is hung: the room changing under a frozen app (the
    // lights going off after it froze) doesn't redraw a frame the app never drew.
    let shown = '', frozen = null;
    function drawScene(name, { backup, video, linked, fault, tag, caption, dim }) { // linked: the overlay is connected (no NeuCharBox caption before discovery)
      const key = JSON.stringify([name, backup, video, linked, fault, tag, caption, dim]); if (key === shown) return; shown = key;
      const c = document.createElement('canvas'); c.width = 580; c.height = 340; const g = c.getContext('2d'); const grad = g.createLinearGradient(0, 0, 580, 340); grad.addColorStop(0, '#1B2430'); grad.addColorStop(1, '#3A2A6B'); g.fillStyle = grad; g.fillRect(0, 0, 580, 340);
      g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold 44px Inter, "Segoe UI", sans-serif'; const label = { starting: 'STARTING SOON', ending: 'THANKS FOR WATCHING' }[name]; if (label) g.fillText(label, 290, 150);
      if (name === 'live' || name === 'recording') { // program picture (500 x 250): the camera image as a head-and-shoulders placeholder, plus the LIVE / REC badge
        g.fillStyle = '#12161C'; g.fillRect(40, 30, 500, 250); g.fillStyle = dim ? '#2E3842' : backup ? '#3C4650' : '#5A6E80'; g.beginPath(); g.arc(290, 148, 52, 0, Math.PI * 2); g.fill(); g.beginPath(); g.ellipse(290, 280, 118, 78, 0, Math.PI, 0); g.fill(); // dim: about 40% as bright; the webcam's flatter picture is greyer
        g.fillStyle = '#FF3030'; g.beginPath(); g.arc(70, 55, 9, 0, Math.PI * 2); g.fill(); g.fillStyle = '#fff'; g.font = 'bold 22px Inter, "Segoe UI", sans-serif'; g.textAlign = 'left'; g.fillText(name === 'live' ? 'LIVE' : video ? 'REC · video only' : 'REC', 90, 56);
        if (caption) { g.fillStyle = 'rgba(0,0,0,0.72)'; g.fillRect(40, 238, 500, 42); g.fillStyle = '#fff'; g.font = 'bold 20px Inter, "Segoe UI", sans-serif'; g.textAlign = 'center'; g.fillText(caption, 290, 259); } // ON the stream: inside the program picture
      }
      if (linked) { g.fillStyle = '#9FE3F0'; g.font = '18px Inter, "Segoe UI", sans-serif'; g.textAlign = 'left'; g.fillText('NeuCharBox scene control', 20, 320); }
      const pill = backup && name === 'live' ? 'backup cam' : backup && name === 'recording' ? 'webcam' : tag; // monitor only: in the margin, not in the program
      if (pill) { g.font = 'bold 18px Inter, "Segoe UI", sans-serif'; const w = Math.ceil(g.measureText(pill).width) + 32; g.fillStyle = '#FFB020'; g.beginPath(); g.roundRect(540 - w, 302, w, 32, 16); g.fill(); g.fillStyle = '#231703'; g.textAlign = 'center'; g.fillText(pill, 540 - w / 2, 319); }
      if (fault) { // hung: the last frame, dimmed, and a red pill in the top margin
        g.fillStyle = 'rgba(12,16,22,0.5)'; g.fillRect(0, 0, 580, 340);
        g.font = 'bold 17px Inter, "Segoe UI", sans-serif'; const txt = 'Overlay app not responding', w = Math.ceil(g.measureText(txt).width) + 26;
        g.fillStyle = '#E0563A'; g.beginPath(); g.roundRect(290 - w / 2, 2, w, 26, 13); g.fill(); g.fillStyle = '#fff'; g.textAlign = 'center'; g.fillText(txt, 290, 15.5); // centred: the mic hides the screen's top-left corner from the default view
      }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; screen.material.map?.dispose(); screen.material.map = t; screen.material.emissiveMap = t; screen.material.needsUpdate = true;
    }

    R.addPickable(softbox, 'keylight'); R.addPickable(camBody, 'cam'); R.addPickable(webcam, 'webcam'); R.addPickable(micBody, 'mic'); R.addPickable(capBox, 'capture'); R.addPickable(screen, 'overlay'); R.addPickable(monitor, 'overlay'); R.addPickable(signBox, 'onair'); R.addPickable(signFace, 'onair'); R.addPickable(strip, 'strip'); R.addPickable(stripPick, 'strip');
    // The rest of each device (after the parts above, which stay where rings and labels appear): a tap on a stand, post or
    // boom selects its device instead of passing through to what is behind it (the monitor's stand picked the LED strip).
    for (const [o, id] of [[monPost, 'overlay'], [monBase, 'overlay'], [camArm, 'cam'], [camPost, 'cam'], [micPost, 'mic'], [boom, 'mic'], [boomKnobs, 'mic'], ...springs.map((sp) => [sp, 'mic']), [kStand, 'keylight'], [kArm, 'keylight'], [kBase, 'keylight'], [kFeet, 'keylight'], [keyCtl, 'keylight'], [keyDial, 'keylight'], [stripCtl, 'strip'], [stripChannel, 'strip'], [webClip, 'webcam']]) R.addPickable(o, id);
    // Hidden with the back wall, the sign and the strip must not catch taps either: picking doesn't check .visible.
    for (const o of [signBox, signFace, strip, stripChannel, stripCtl]) o.raycast = function (ray, hits) { if (this.visible) THREE.Mesh.prototype.raycast.call(this, ray, hits); };
    const hi = P.highlighter({ keylight: [softbox, keyCtl], cam: [camBody], mic: [micBody], capture: [capBox], overlay: [screen], onair: [signBox], strip: [strip, stripCtl], webcam: [webcam] });
    const col = new THREE.Color();
    // Point at the moments the story turns on in the room (main.js already pings discovery and faults). Not while a
    // what-if replays the request quietly: what NCB did before the failure isn't news, so no ring, label or pulse.
    // A mark made while another device's red fault ring still shows (main.js: 3.2 s, less under ?speed=) is calm: its
    // label and dot, no ring and no pulse, so the eye goes to what failed first (the caption NCB puts up as the mic drops).
    let faultId = null, faultAt = -Infinity;
    const mark = (id, text) => { const calm = !!faultId && faultId !== id && performance.now() - faultAt < Math.max(1200, 3200 / speed) + 600; if (!calm) hi.focus(id); R.ping(id, text, { hold: 2600, ring: !calm }); };
    store.subscribe((state, path, value) => {
      if (isQuiet()) return;
      if (value === 'fault' && path.endsWith('.status')) { faultId = path.slice(0, -7); faultAt = performance.now(); }
      if (path === 'onair.on' && value && !state.plan?.preset) mark('onair', 'On-air sign · ON'); // not when the wrap-up sets up "live for 48 minutes": NCB didn't do that
      else if (path === 'plan.backup' && value) mark('webcam', 'USB webcam · now the video source');
      else if (path === 'capture.input' && value === 'disabled') mark('capture', 'Capture card · input disabled'); // after the capture fault: replaces its marker
      else if (path === 'plan.webcamMic' && value) mark('webcam', 'USB webcam · now the mic');
      else if (path === 'overlay.caption' && value) mark('overlay', 'Stream caption · on');
      else if (path === 'overlay.tag' && value === 'mic cut') mark('overlay', 'Stream sound · mic cut'); // at the app that cut it: the mic's own red fault marker stays
      else if (path === 'overlay.tag' && /^marker/.test(value)) mark('overlay', `Recording ${value}`);
    });
    // The capture card's OLED: its input and a dot, green with a picture and grey without; "OFF" with its input disabled,
    // dark while the card is down (offline, or in fault: off the PC's USB, which powers it).
    let oledShown = '';
    const drawOled = (st) => {
      const up = st.status !== 'offline' && st.status !== 'fault', key = up ? `${st.input}|${!!st.signal}` : 'dark'; if (key === oledShown) return; oledShown = key;
      const g = oledTex.userData.g, off = st.input === 'disabled'; g.fillStyle = '#0B0E12'; g.fillRect(0, 0, 192, 80);
      if (up) { g.fillStyle = off ? '#3A4048' : st.signal ? '#2FBF71' : '#6B747C'; g.beginPath(); g.arc(24, 40, 9, 0, Math.PI * 2); g.fill(); g.fillStyle = off ? '#5E6670' : '#E8EEF2'; g.font = '600 30px Inter, "Segoe UI", sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(off ? 'OFF' : String(st.input), 46, 40); }
      oledTex.needsUpdate = true;
    };
    const statusLed = (led, st, t) => { const f = st.status === 'fault'; led.visible = st.status !== 'offline'; led.material.color.set(f ? 0xE0563A : 0x2FBF71); led.material.emissive.copy(led.material.color); led.material.emissiveIntensity = f ? (Math.floor(t * 3) % 2 ? 6 : 1) : 0.8; };

    return {
      focus: hi.focus,
      update(s, t) {
        hi.update();
        hub.ledMat.emissiveIntensity = s.hub.status === 'on' ? (2.5 + Math.sin(t * 2.2) * 1.5) * s.hub.led : 0;
        const kb = s.keylight.brightness; keyLight.intensity = kb * 40; panel.material.emissiveIntensity = kb > 0.005 ? 0.25 + 1.5 * kb : 0; const warm = (6500 - s.keylight.kelvin) / 3500; panel.material.emissive.setRGB(1, 1 - 0.42 * warm, 1 - 0.72 * warm); keyLight.color.copy(panel.material.emissive); // ~blackbody: 3200 K reads orange
        const camOnAir = s.cam.on && s.cam.signal && !s.plan?.backup && (s.overlay.scene === 'live' || s.overlay.scene === 'recording'); // tally: red only while its picture is live or recording
        camLed.material.color.set(s.cam.status === 'fault' || camOnAir ? 0xE0563A : 0x2FBF71); camLed.material.emissive.copy(camLed.material.color); camLed.material.emissiveIntensity = s.cam.status === 'fault' ? (Math.floor(t * 3) % 2 ? 6 : 1) : s.cam.on ? 4 : 1; camLed.visible = s.cam.status !== 'offline';
        webcamLed.material.emissiveIntensity = s.plan?.backup || s.plan?.webcamMic ? 5 : 0.8; // bright while it is a source (picture or sound)
        micLed.material.color.set(s.mic.muted || s.mic.status === 'fault' ? 0xE0563A : 0x2FBF71); micLed.material.emissive.copy(micLed.material.color); micLed.material.emissiveIntensity = s.mic.status === 'fault' ? (Math.floor(t * 3) % 2 ? 6 : 1) : 2; micLed.visible = s.mic.status !== 'offline';
        // capture LED: blue with a signal, amber without, dark with its input disabled; blinking red in fault, steady red in
        // fault with its input disabled (flagged, but held safe)
        const capBad = s.capture.status === 'fault', capOff = s.capture.input === 'disabled'; capLed.material.color.set(capBad ? 0xE0563A : capOff ? 0x1A1C1E : s.capture.signal ? 0x3AB7FF : 0xFFB020); capLed.material.emissive.copy(capLed.material.color); capLed.material.emissiveIntensity = capBad ? (capOff ? 2.5 : Math.floor(t * 3) % 2 ? 6 : 1) : capOff ? 0 : 2; capLed.visible = s.capture.status !== 'offline';
        drawOled(s.capture);
        statusLed(keyLed, s.keylight, t); statusLed(signLed, s.onair, t); statusLed(stripLed, s.strip, t);
        const blink = Math.floor(t * 3) % 2; // the LEDs' blink phase: glow full with the bright one, faint with the dim one
        for (const id of ['keylight', 'cam', 'mic', 'onair', 'strip']) glows[id](s[id].status === 'fault' ? (blink ? 1 : 0.25) : 0);
        glows.capture(capBad ? (capOff ? 0.6 : blink ? 1 : 0.25) : 0); // steady, like its LED, once its input is disabled
        const hung = s.overlay.status === 'fault';
        const now = { name: s.overlay.scene, backup: !!s.plan?.backup, video: !!s.plan?.videoOnly, tag: s.overlay.tag || '', caption: s.overlay.caption || '', dim: s.keylight.brightness < 0.05 };
        if (!hung) frozen = null; else if (!frozen) frozen = now; // the first frame after the fault is the one that stays
        const f = frozen || now; drawScene(f.name, { ...f, linked: s.overlay.status !== 'offline', fault: hung });
        signFace.material.emissiveIntensity = s.onair.on ? 2.5 + 0.3 * Math.sin(t * 3) : 0; signFace.material.color.setScalar(s.onair.on ? 1 : 0.12); // off: unlit lettering, not red text
        col.setHSL(s.strip.hue, s.strip.sat ?? 0.7, 0.55); strip.material.emissive.copy(col); strip.material.emissiveIntensity = s.strip.on ? 1 + 2 * s.strip.brightness : 0; for (const l of stripLights) { l.color.copy(col); l.intensity = s.strip.on ? 1.6 * s.strip.brightness : 0; }
      },
    };
  },

  prompts: [
    {
      chip: 'Go live.',
      keywords: ['go', 'live', 'stream', 'streaming', 'livestream', 'livestreaming', 'start', 'broadcast', 'broadcasting', 'online', 'begin', 'air', 'sign'],
      avoid: ['cut', 'dark', 'end', 'ending', 'ended', 'stop', 'stopped', 'finish', 'finished', 'close', 'closing', 'break', 'brb', 'silent', 'silently', 'silence', 'drop', 'dropped', 'dropping', 'ditch', 'scrap', 'exit', 'terminate', 'terminated', 'lose', 'losing'], // "cut the stream", "go dark", "stopped streaming", "close the stream", "go to break", "go silent", "drop / ditch / exit / lose the stream" (js/engine/match.js)
      rulesOut: ['record', 'recording', 'blue', 'green', 'pink', 'yellow', 'orange', 'teal', 'cyan', 'rainbow'], // it doesn't record ("record with the on-air sign on"); it turns the strip purple
      touches: ['Backup: USB webcam if the main camera fails'], // also the plan's last line; listed first, so "go live without the webcam" quotes it and not "Main camera on…"
      expect: { 'cam.status': 'online', 'cam.signal': true, 'capture.signal': true, 'overlay.scene': 'live', 'mic.muted': false, 'onair.on': true, 'strip.hue': 0.75 },
      steps: [
        { beat: 'plan' },
        { say: 'Two words, seven devices. Here\'s the order I\'d do them in — the on-air sign is last because it should mean what it says.' },
        { plan: { intro: 'Go-live sequence:', steps: [
          { text: 'Key light on, 80% at 5600K', alt: { text: 'Key light on, 60% at 4000K — warmer', apply: [{ set: 'plan.warm', to: true }] } }, // "on": "go live but keep the lights off" asks back
          { text: 'Main camera on; capture card on HDMI 1; verify the signal before it goes on screen' }, // the six lines fit a 390 x 844 phone, Approve included
          { text: 'Overlay: "Starting soon", then live' },
          { text: 'Audio: mic unmuted, sound on as you go live on the stream — not before' }, // "go live", "stream", "unmuted", "audio" and "sound" in one clause: "go live muted", "start the stream muted" and "go live without sound / audio" ask back
          { text: 'Once live: LED strip purple, on-air sign on' },
          { text: 'Backup: USB webcam if the main camera fails' }, // what the main camera and capture card what-ifs switch to
        ] } },
        { beat: 'run' },
        { failPoint: 'light' },
        KEY_ON,
        { set: 'cam.on', to: true, label: 'Main camera → on' }, { wait: 1200 },
        { set: 'overlay.scene', to: 'starting', label: 'Overlay → Starting soon' },
        { say: 'Overlay up: "Starting soon". Waiting on the camera signal before I switch to live…' },
        { wait: 1500 },
        { failPoint: 'signal' },
        { set: 'cam.signal', to: true }, { set: 'capture.signal', to: true, label: 'Main camera signal verified on HDMI 1' }, { wait: 600 },
        { say: 'Picture confirmed on HDMI 1. Switching to the live scene.' },
        { failPoint: 'goLive' },
        ...LIVE_AND_MIC,
        { failPoint: 'strip' },
        STRIP_PURPLE,
        { failPoint: 'sign' },
        SIGN_ON,
        { say: 'You\'re live on the main camera. Mic open, strip purple, sign on. The USB webcam stays on standby as the backup.' },
        { status: 'Live · main camera · mic open' },
        { failPoint: 'midStream' },
        { end: { headline: 'Live, in the right order.', body: 'Light and camera first, the live scene only once the picture was confirmed, the sign last. Seven devices, one request, in the order that keeps a stream clean.' } },
      ],
      whatIf: {
        keylight: { at: 'light', intro: 'Replaying this request. This time, the key light doesn\'t answer its first setting.', steps: [
          { fn: ({ store, status }) => status(`Key light → ${store.get('plan.warm') ? '60% · 4000K' : '80% · 5600K'}`) }, { wait: 1500 },
          { status: 'Key light: no reply · retrying' }, { wait: 1200 },
          { fail: 'keylight', title: '⚠ Key light not answering', faultText: 'not answering', say: 'The key light didn\'t answer its setting, or the retry. Last thing it told me: "off".' },
          { wait: 2000 },
          { say: 'Getting everything else ready without it, behind "Starting soon". Nothing goes live until you decide about the light.' },
          { set: 'cam.on', to: true, label: 'Main camera → on' }, { wait: 1200 },
          { set: 'overlay.scene', to: 'starting', label: 'Overlay → Starting soon' }, { wait: 1200 },
          { set: 'cam.signal', to: true }, { set: 'capture.signal', to: true, label: 'Main camera signal verified on HDMI 1' }, { wait: 900 },
          { say: 'Picture confirmed on HDMI 1, and it\'s underlit: only the ceiling light is on you. The LED strip lights the wall behind the monitor, not your face.' },
          { ask: { intro: 'Go live without the key light?', options: [
            { label: 'Hold on "Starting soon"', primary: true, apply: [
              { say: 'Holding. "Starting soon" stays up, the mic stays muted and the sign stays off.' },
              { replan: { intro: 'Holding before live:', changes: ['Key light: not answering; its last report was "off"', 'Camera on, picture confirmed on HDMI 1; "Starting soon" up', 'Mic muted; LED strip and on-air sign wait for the live scene'], needsYou: 'Power-cycle the key light at its plug. When it answers, I\'ll set it as planned and ask you before going live.' } },
              { status: 'Holding on "Starting soon" · key light flagged' },
            ] },
            { label: 'Go live without it', apply: [
              ...LIVE_AND_MIC, STRIP_PURPLE, SIGN_ON, { wait: 900 },
              { say: 'You\'re live, lit by the ceiling light only. Mic open, strip purple, sign on.' },
              { replan: { intro: 'Live, without the key light:', changes: ['Key light: not answering; its last report was "off"', 'Live on the main camera, picture confirmed; mic open, strip purple, sign on', 'If the key light answers mid-stream, I\'ll ask before switching it on: a sudden change of light shows on camera'], needsYou: 'After the stream: power-cycle the key light at its plug.' } },
              { status: 'Live · key light flagged' },
            ] },
          ] } },
          HOLD,
          { end: { headline: 'No key light, no surprise.', body: 'The key light never answered. NeuCharBox got everything else ready behind "Starting soon" and let you decide whether to go live underlit.' } },
        ] },
        cam: { at: 'signal', steps: [
          { status: 'Waiting for the camera signal on HDMI 1…' }, { wait: 1500 },
          { fail: 'cam', title: '⚠ No picture from the main camera', say: 'Main camera reports "on", but the capture card still sees no signal on HDMI 1. I go by the card: no picture.' },
          { wait: 2000 },
          { say: 'I won\'t switch to a live scene with no picture on it. There\'s a backup: the spare USB webcam on the monitor. Switching the scene to it, and telling you rather than hiding it.' },
          { set: 'plan.backup', to: true, label: 'Video source → USB webcam' }, { wait: 1200 },
          { replan: { intro: 'Going live on the backup:', changes: ['Scene video source switched from the capture card to the USB webcam on the PC — picture confirmed', 'Live scene next; a small "backup cam" tag goes on your monitor — not on the stream — so you know', 'Main camera: out of the scene for now; if its picture comes back I\'ll offer to switch back, not just switch'], needsYou: 'After the stream: check the HDMI cable on the main camera. It reported "on" but never sent a frame.' } },
          { wait: 1500 },
          ...LIVE_AND_MIC, STRIP_PURPLE, SIGN_ON, { wait: 900 },
          { say: 'You\'re live on the backup camera. Mic open, strip purple, sign on.' },
          { status: 'Live · USB webcam · main camera flagged' },
          HOLD,
          { end: { headline: 'Live on the backup, and it told you.', body: 'The main camera said "on" but sent nothing, and that was caught before the audience saw it. NeuCharBox switched to the backup and put the fact on your screen, not in a log.' } },
        ] },
        capture: { at: 'midStream', steps: [
          { status: 'Live · main camera · 0:37' }, { wait: 1000 }, ...talk(-18),
          { set: 'capture.signal', to: false },
          { fail: 'capture', title: '⚠ Capture card dropped out', faultText: 'disconnected from the PC', say: 'The capture card just disconnected from the PC, 40 seconds in. The main camera still reports "on", but its picture has no way into the stream.' },
          { set: 'plan.backup', to: true }, ...talk(-18),
          { say: 'Switched the scene to the USB webcam, the backup in your plan, and its picture is confirmed. Your mic doesn\'t go through the card: its level stayed around −18 dB the whole time.' },
          { say: 'Viewers may have seen the picture freeze or go black for under a second, then the angle change. The "backup cam" tag is on your monitor only.' },
          { say: 'Look at the webcam on top of the monitor for now: that\'s where your viewers are.' },
          { replan: { intro: 'Still live, on the backup:', changes: ['Capture card: disconnected from the PC at 0:40, so no picture from the main camera', 'Scene video: the USB webcam, picture confirmed', 'Mic, strip and sign unchanged: none of them go through the card', 'When the card is back and shows a picture, I\'ll offer to switch back between segments, not just switch'], needsYou: 'After the stream: reseat the capture card\'s USB cable, ideally in a port on the back of the PC.' } },
          { status: 'Live · USB webcam · capture card flagged' },
          HOLD,
          { end: { headline: 'It lost the card, not the stream.', body: 'The capture card dropped out early in the stream. NeuCharBox had the backup camera on air within a second and left your sound alone.' } },
        ] },
        mic: { at: 'midStream', steps: [
          { status: 'Live · main camera · 12:37' }, { wait: 1000 }, ...talk(-18),
          { tween: 'mic.level', to: -90, ms: 250 },
          { fail: 'mic', title: '⚠ Mic dropped out', faultText: 'disconnected', say: 'The mic went from about −18 dB to nothing mid-sentence, 12 minutes in, and the PC no longer lists it. Your viewers can see you but can\'t hear you.' },
          { set: 'overlay.caption', to: 'Audio problem · working on it' }, { wait: 1500 },
          { say: 'I\'ve put a caption on your stream: "Audio problem · working on it". It isn\'t in your plan, but silence loses viewers and a caption is quick to take down, so I didn\'t wait to ask.' },
          { status: 'Looking for the mic on the PC…' }, { wait: 2000 },
          { ask: { intro: 'Your mic hasn\'t come back. The USB webcam on the monitor has a built-in mic, but it isn\'t in your plan. Keep the caption up, or use the webcam\'s mic until yours is back?', options: [
            { label: 'Keep the caption up', primary: true, apply: [
              { say: 'Caption stays up and the picture stays live. When your mic shows level again, I\'ll take the caption down and tell you.' },
              { replan: { intro: 'Live, captioned, no sound:', changes: ['Mic: disconnected at 12:40; the PC no longer lists it', 'Stream caption: "Audio problem · working on it"', 'Webcam mic: not used, because it isn\'t in your plan', 'Picture, strip and sign unchanged'], needsYou: 'Replug the mic\'s USB cable. The caption comes down once I can see its level.' } },
              { status: 'Live · caption up · mic flagged' },
            ] },
            { label: 'Use the webcam mic', apply: [
              { set: 'plan.webcamMic', to: true }, { set: 'overlay.tag', to: 'webcam mic', label: 'Stream audio → webcam mic' }, { wait: 1200 },
              { set: 'overlay.caption', to: '', label: 'Stream caption → off' }, { wait: 600 },
              { say: 'Sound\'s back through the webcam\'s mic, reading about −24 dB. It picks up more of the room, so you\'ll sound thinner. Caption off.' },
              { replan: { intro: 'Live, on the webcam mic:', changes: ['Mic: disconnected at 12:40; the PC no longer lists it', 'Stream sound: the USB webcam\'s mic, level confirmed; caption off', 'Picture, strip and sign unchanged', 'When your mic is back and shows level, I\'ll offer to switch back, not just switch'], needsYou: 'Check the mic\'s USB cable at both ends. Switch back between segments, not mid-sentence.' } },
              { status: 'Live · webcam mic · mic flagged' },
            ] },
          ] } },
          HOLD,
          { end: { headline: 'Silence on air, caught in seconds.', body: 'The mic dropped out mid-stream. NeuCharBox captioned the stream so viewers knew, and gave you a way to get sound back.' } },
        ] },
        overlay: { at: 'goLive', steps: [
          { status: 'Overlay → LIVE' }, { wait: 1500 },
          { fail: 'overlay', title: '⚠ Overlay app not responding', faultText: 'not responding', say: 'I sent the switch to the live scene and the overlay app didn\'t answer. The last it reported was "Starting soon"; nothing since.' },
          { wait: 2000 },
          { say: 'So I can\'t tell what your stream is showing. If the switch landed before it froze, viewers may be seeing you, with no sound.' },
          { say: 'The mic stays muted and the sign stays off until I can see the stream. Act as if you\'re on camera.' },
          { status: 'Holding · mic muted · sign off · retrying overlay app' }, { wait: 2000 },
          { say: 'The overlay app still isn\'t answering.' },
          { replan: { intro: 'Holding before live:', changes: ['Overlay app: no answer to the switch to live; last report "Starting soon"', 'Stream: unknown. It may show "Starting soon" or your camera, silent', 'Mic: muted. On-air sign: off. LED strip: unchanged', 'Key light, camera and capture card: on, picture confirmed, ready'], needsYou: 'Restart the overlay app on the PC. That drops the stream; when it\'s back, I\'ll check what it shows before I open the mic.' } },
          { status: 'Holding · mic muted · overlay app flagged' },
          HOLD,
          { end: { headline: 'It won\'t go live blind.', body: 'The overlay app stopped answering at the switch to live. NeuCharBox kept the mic muted and the sign off, because it couldn\'t confirm what your viewers were seeing.' } },
        ] },
        strip: { at: 'strip', steps: [
          { status: 'LED strip → purple' }, { wait: 1500 },
          { fail: 'strip', title: '⚠ LED strip not answering', say: 'The LED strip didn\'t take the change to purple. Blue at 50% is the last it said, and it\'s been quiet since.' },
          { wait: 2000 },
          { say: 'The strip is the look of the room, not the stream: your picture and sound are live and confirmed. Carrying on with the sign and leaving the strip alone.' },
          SIGN_ON, { wait: 1200 },
          { say: 'Sign on. You\'re live on the main camera, mic open. The wall is likely still blue: that\'s the strip\'s last report.' },
          ...talk(-18),
          { replan: { intro: 'Live, one colour off:', changes: ['LED strip: off the network; last reported blue at 50%', 'Stream, camera, mic and sign: as planned', 'No more colour commands to the strip while you\'re live: it can wait'], needsYou: 'After the stream: power-cycle the LED strip at its plug. I\'ll set it purple the next time you go live.' } },
          { status: 'Live · LED strip flagged' },
          HOLD,
          { end: { headline: 'Wrong colour, right priorities.', body: 'The LED strip stopped answering before it turned purple. NeuCharBox didn\'t hold up a live stream for decoration: it went live and flagged the strip.' } },
        ] },
        onair: { at: 'sign', steps: [
          { status: 'On-air sign → ON' }, { wait: 1500 },
          { fail: 'onair', title: '⚠ On-air sign not answering', faultText: 'not answering', say: 'You\'re live, but the on-air sign didn\'t answer "on". It still reads "off" from its last check-in.' },
          { wait: 2000 },
          { say: 'The stream is fine: camera, mic and overlay all confirm. But a dark sign tells anyone walking in that it\'s fine to talk.' },
          { say: 'The LED strip is on the same wall, out of your shot. I could turn it red, but that isn\'t in your plan.' },
          { ask: { intro: 'Turn the LED strip red as a stand-in on-air light?', options: [
            { label: 'Leave the strip purple', primary: true, apply: [
              { say: 'The strip stays purple. You\'re live, and the sign is flagged on the dashboard.' },
              ...talk(-18),
              { replan: { intro: 'Live, sign dark:', changes: ['On-air sign: not answering; it still reads "off" from its last check-in', 'Stream, camera, mic and strip: as planned', 'Nothing on the wall says you\'re live: worth a word to anyone nearby'], needsYou: 'Check the sign\'s plug or cable after the stream.' } },
              { status: 'Live · on-air sign flagged' },
            ] },
            { label: 'Turn the strip red', apply: [
              { parallel: [{ tween: 'strip.hue', to: 1, ms: 700, label: 'LED strip → red, bright' }, { tween: 'strip.brightness', to: 0.95, ms: 700 }, { tween: 'strip.sat', to: 1, ms: 700 }] }, { wait: 1200 },
              { say: 'The strip is red and bright, under the sign. It isn\'t a sign, but it\'s hard to miss.' },
              { replan: { intro: 'Live, with a stand-in:', changes: ['On-air sign: not answering; it still reads "off" from its last check-in', 'LED strip: red and bright while you\'re live, in place of the sign', 'Stream, camera and mic: as planned'], needsYou: 'Check the sign\'s plug or cable after the stream. I\'ll put the strip back to purple once the sign answers or you\'re off air.' } },
              { status: 'Live · strip red · on-air sign flagged' },
            ] },
          ] } },
          HOLD,
          { end: { headline: 'A dark sign isn\'t an off-air sign.', body: 'The on-air sign didn\'t answer as you went live. NeuCharBox said so right away and offered a stand-in, so a dark sign didn\'t go unnoticed.' } },
        ] },
      },
    },
    {
      chip: 'I\'m done. Wrap up.',
      keywords: ['done', 'wrap', 'up', 'end', 'stop', 'finish', 'finished', 'offline', 'sign off', 'bye', 'over', 'shut', 'down', 'kill', 'stream', 'streaming', 'broadcast', 'go', 'live', 'air', 'mute', 'muted', 'thats', 'camera', 'ending', 'ended', 'stopped', 'livestream', 'livestreaming'], // no bare "turn off": "turn off the key light" is not a wrap-up (it ends with the light on); no "everything": "everything on"
      avoid: ['turn on', 'switch on', 'set up stream', 'set up streaming', 'fire up', 'power up', 'boot up', 'put up', 'hook up', 'up running', 'pause', 'paused', 'dark', 'check', 'test', 'fix', 'broken', 'repair', 'isnt', 'doesnt', 'working', 'voice', 'break', 'brb', 'silent', 'silently', 'silence',
        'mic down', 'turn down', 'light down', 'lights down', 'strip down', 'calm down', 'tone down', 'stream muted', 'streaming muted', 'broadcast muted', 'until', 'till'], // "turn everything on", "set up for streaming", "pause the stream", "check everything", "voice over", "go to break", "go silent": not an ending; "key light down", like "key light off", is not the whole wrap-up; "go dark": its plan leaves the lights on
      rulesOut: ['record', 'recording', 'film', 'filming', 'blue', 'green', 'pink', 'yellow', 'teal', 'cyan', 'rainbow'], // it ends a stream, not a recording ("finish recording", "done filming"); the strip stays purple, dimmed
      expect: { 'mic.muted': true, 'overlay.scene': 'idle', 'onair.on': false, 'cam.on': false, 'capture.signal': false, 'capture.input': 'HDMI 1', 'capture.status': 'online' },
      steps: [
        { beat: 'plan' },
        { say: 'Skipping ahead: you\'ve been live for 48 minutes on the main camera.' },
        PRESET_LIVE,
        { status: 'Live · 48 min' },
        { say: 'Wrapping up. Order matters: the mic goes first, because the thing you say after "I\'m done" is the thing you don\'t want on the stream.' },
        { plan: { intro: 'Wrap-up sequence:', steps: [
          { text: 'Mic muted immediately' },
          { text: 'Overlay to the "Thanks for watching" screen, then stream off and on-air sign off' },
          { text: 'Camera off; verify the capture card sees no signal' },
          { text: 'Key light to a warm 30%, LED strip dim', alt: { text: 'Key light and LED strip off', apply: [{ set: 'plan.dark', to: true }] } },
        ] } },
        { beat: 'run' },
        { failPoint: 'mute' },
        { set: 'mic.muted', to: true, label: 'Mic → muted' }, { set: 'mic.level', to: -90 }, { wait: 600 },
        { failPoint: 'thanks' },
        ...OUTRO,
        { failPoint: 'signOff' },
        SIGN_OFF, { wait: 600 },
        { failPoint: 'camOff' },
        ...CAM_OFF,
        { failPoint: 'verify' },
        ...VERIFY,
        { failPoint: 'lights' },
        ...LIGHTS,
        { say: 'All done. Mic muted, stream ended, sign off, camera off, and the capture card confirms no picture.' },
        { status: 'Off air · capture card: no signal' },
        { end: { headline: 'Mic first, then everything else.', body: 'The mic went first, the stream ended on "Thanks for watching", and the capture card confirmed no picture once the camera was off. Off air, checked rather than assumed.' } },
      ],
      whatIf: {
        mic: { at: 'mute', intro: 'Replaying this request. This time, the mic doesn\'t take "mute".', steps: [
          { status: 'Live · 48 min · mic → muted' },
          { tween: 'mic.level', to: -16, ms: 700 }, { tween: 'mic.level', to: -19, ms: 700 },
          { fail: 'mic', title: '⚠ Mic won\'t mute', faultText: 'won\'t mute · still live', say: 'The mic didn\'t take "mute", and its level is still moving around −18 dB. It\'s still sending sound, and the stream is still up.' },
          { set: 'overlay.tag', to: 'mic cut' }, { wait: 1500 },
          { say: 'I\'ve cut it at the stream instead: the overlay app confirms the mic is out of the stream\'s sound. About two seconds went out between "mute" and the cut.' },
          { say: 'The mic is still live on the desk, but nothing more from it goes out. Carrying on with the wrap-up.' },
          ...OUTRO,
          SIGN_OFF, { wait: 600 },
          ...CAM_OFF, ...VERIFY, ...LIGHTS,
          { replan: { intro: 'Wrapped up, mic cut at the stream:', changes: ['Mic: didn\'t answer "mute" and kept sending sound; cut from the stream in the overlay app about two seconds after "mute"', 'Stream off, sign off, camera off; capture card: no signal', 'Key light and strip as planned'], needsYou: 'The mic is still live on the desk: unplug it or use its own mute button. Nothing is streaming now, but other apps on the PC could still hear it.' } },
          { status: 'Off air · mic flagged: still live on the desk' },
          HOLD,
          { end: { headline: 'Muted at the stream, not the mic.', body: 'The mic ignored "mute" while you were still live. NeuCharBox cut it from the stream within seconds, said what had gone out in between, and flagged that it was still live on the desk.' } },
        ] },
        overlay: { at: 'thanks', steps: [
          { status: 'Overlay → Thanks for watching' }, { wait: 1500 },
          { fail: 'overlay', title: '⚠ Overlay app not responding', faultText: 'not responding', say: 'The overlay app didn\'t take "Thanks for watching", and it hasn\'t answered since. Its last report: the live scene, with your camera on it.' },
          { wait: 2000 },
          { say: 'I can\'t end the stream without it, so I\'m cutting what feeds it. The mic is already muted, confirmed at −90 dB. The camera goes off now.' },
          ...CAM_OFF, ...VERIFY,
          { say: 'The capture card confirms: no picture. Viewers may see a still or black frame until the stream ends, but nothing more of you.' },
          { say: 'The on-air sign stays on: I can\'t confirm you\'re off air.' },
          ...LIGHTS,
          { replan: { intro: 'Wrapped up, except the stream itself:', changes: ['Overlay app: no answer since "Thanks for watching"; last report was the live scene', 'Mic muted and camera off, both confirmed: nothing new from this desk reaches the stream', 'On-air sign left on until the stream is confirmed ended', 'Key light and strip as planned'], needsYou: 'Force-quit the overlay app on the PC (that ends the stream), or end it from your streaming platform\'s page. I\'ll switch the sign off once the stream is confirmed ended.' } },
          { status: 'Stream not confirmed ended · overlay app flagged' },
          HOLD,
          { end: { headline: 'Off air only when it can prove it.', body: 'The overlay app froze before the stream ended. NeuCharBox cut the camera, kept the mic muted, and left the sign on because it couldn\'t confirm you were off air.' } },
        ] },
        strip: { at: 'thanks', steps: [
          { status: 'Live · 48 min · mic muted' }, { wait: 1500 },
          { tween: 'strip.brightness', to: 0, ms: 150 }, { wait: 600 },
          { set: 'strip.sat', to: 0 }, { tween: 'strip.brightness', to: 0.95, ms: 300 },
          { fail: 'strip', title: '⚠ LED strip restarted', faultText: 'restarted · no control', say: 'The LED strip dropped off the network and came back reporting its power-on default: white, 95%. It isn\'t taking commands yet, which looks like its controller restarting.' },
          { wait: 2000 },
          { say: 'It\'s behind the camera, so it isn\'t in your shot, and the camera\'s picture shows no colour shift. Nothing to fix on the stream: carrying on with the wrap-up.' },
          ...OUTRO,
          SIGN_OFF, { wait: 600 },
          ...CAM_OFF, ...VERIFY,
          { status: (store) => (store.get('plan.dark') ? 'Key light → off' : 'Key light → warm 30%') },
          KEY_ONLY,
          { replan: { intro: 'Wrapped up, strip left white:', changes: ['Mic muted, stream off, sign off, camera off; capture card: no signal', 'Key light as planned', 'LED strip: white since it restarted; not taking commands, so left as it is'], needsYou: 'Switch the strip off at its plug if the white bothers you. If it restarts again, check its power supply.' } },
          { status: 'Off air · LED strip flagged' },
          HOLD,
          { end: { headline: 'Too bright, and nothing more.', body: 'The LED strip restarted into bright white while you were still live. The camera\'s picture didn\'t change, so NeuCharBox finished the wrap-up and flagged the strip instead of stopping.' } },
        ] },
        onair: { at: 'signOff', steps: [
          { status: 'On-air sign → off' }, { wait: 1200 },
          { status: 'On-air sign: no reply · retrying' }, { wait: 1200 },
          { fail: 'onair', title: '⚠ On-air sign ignored "off"', faultText: 'not answering · last: "on"', say: 'The stream is off, but the on-air sign didn\'t take "off", twice. The last it told me was "on".' },
          { wait: 2000 },
          { say: 'If it\'s still lit, it\'s wrong in the harmless direction: it says you\'re live when you aren\'t. The overlay app confirms the stream has ended, so I\'m carrying on with the wrap-up.' },
          ...CAM_OFF, ...VERIFY, ...LIGHTS,
          { say: 'All done, apart from the sign. Mic muted, stream ended, camera off, and the capture card confirms no picture.' },
          { replan: { intro: 'Wrapped up, except the sign:', changes: ['Stream: off, confirmed by the overlay app', 'Mic muted, camera off; capture card: no signal', 'On-air sign: not answering; its last report was "on"', 'Key light and strip as planned'], needsYou: 'Switch the sign off at its plug or cable. Until it answers, go by the dashboard, not the sign.' } },
          { status: 'Off air · on-air sign flagged' },
          HOLD,
          { end: { headline: 'The sign is wrong. The stream isn\'t.', body: 'The on-air sign ignored "off" after the stream ended. NeuCharBox checked the stream itself, finished the wrap-up and told you which one to trust.' } },
        ] },
        cam: { at: 'camOff', steps: [
          { status: 'Main camera → off' }, { wait: 2000 },
          { set: 'cam.signal', to: false }, { set: 'capture.signal', to: false },
          { fail: 'cam', title: '⚠ Camera not answering', faultText: 'not answering', say: 'The camera didn\'t confirm "off", and it hasn\'t answered anything since. Its final report before going quiet: "on".' },
          { wait: 2000 },
          { say: 'What matters is its picture, and the capture card sees none on HDMI 1. Either it switched off without saying so, or it lost power.' },
          { set: 'capture.input', to: 'disabled', label: 'Capture input → disabled' }, { wait: 1200 },
          { say: 'Right now nothing from it reaches the PC, and I\'ve disabled the card\'s input so it stays that way if the camera comes back on by itself.' },
          ...LIGHTS,
          { replan: { intro: 'Done, camera unconfirmed:', changes: ['Mic muted, stream off, sign off', 'Camera: not answering; last report "on"', 'Capture card: no picture on HDMI 1; input disabled until the camera answers', 'Key light and strip as planned'], needsYou: 'Check the camera and its power by hand. I\'ll re-enable the input once it answers.' } },
          { status: 'Off air · capture input disabled · camera flagged' },
          HOLD,
          { end: { headline: 'Dark at the card is what counts.', body: 'The camera stopped answering as it was switched off. NeuCharBox checked the capture card instead, found no picture, and disabled its input in case the camera comes back on by itself.' } },
        ] },
        capture: { at: 'verify', steps: [
          { status: 'Main camera off · checking the capture card…' }, { wait: 2000 },
          { fail: 'capture', title: '⚠ Signal after "off"', say: 'The camera reports "off", but the capture card still reports a signal on HDMI 1.' },
          { wait: 2000 },
          { say: 'A capture card with a signal after the camera is "off" is a privacy problem, not a technical one. Disabling the input at the card so nothing can leave the desk.' },
          { set: 'capture.input', to: 'disabled', label: 'Capture input → disabled' }, { set: 'capture.signal', to: false }, { set: 'capture.faultNote', to: 'disabled · signal after off' }, { wait: 1500 },
          ...LIGHTS,
          { say: 'All done. Mic muted, stream ended, sign off, and the card confirms no signal with its input disabled.' },
          { replan: { intro: 'Done, with one flag:', changes: ['Capture input disabled at the card — verified: no signal', 'Stream is off, sign is off, mic is muted', 'Key light and strip as planned'], needsYou: 'Check the capture card and the camera\'s standby or power settings: something kept HDMI alive after "off". I\'ll re-enable the input the next time you need the camera.' } },
          { status: 'Off air · capture input disabled · capture card flagged' },
          HOLD,
          { end: { headline: 'Off means off.', body: 'The camera said off; the capture card said otherwise. NeuCharBox disabled the input at the card and told you why, because "probably fine" isn\'t good enough for a live feed.' } },
        ] },
        keylight: { at: 'lights', steps: [
          { status: 'Stream off · camera off · capture card: no signal' }, { wait: 2000 },
          { status: (store) => (store.get('plan.dark') ? 'Key light and LED strip → off' : 'Key light → warm 30%, LED strip → dim') },
          STRIP_ONLY,
          { status: 'Key light: no reply · retrying' }, { wait: 1500 },
          { fail: 'keylight', title: '⚠ Key light not answering', faultText: 'not answering · last: 80%', say: 'The LED strip took its new setting. The key light didn\'t answer, even after a retry: 80% at 5600K is still its last report.' },
          { wait: 2000 },
          { say: 'If it\'s still on, that\'s the harmless kind of failure: a light can\'t put you on air.' },
          { say: 'All done apart from the key light. Mic muted, stream ended, sign off, camera off, and the capture card confirms no picture.' },
          { replan: { intro: 'Wrapped up, key light unconfirmed:', changes: ['Mic muted, stream off, sign off, camera off; capture card: no signal', 'LED strip as planned', 'Key light: not answering; its last report was 80% at 5600K'], needsYou: 'Switch the key light off at its power switch or plug. Before your next stream, I\'ll check it answers first.' } },
          { status: 'Off air · key light flagged' },
          HOLD,
          { end: { headline: 'Only the key light went quiet.', body: 'The key light stopped answering at the very end. Everything that could put you on air was already off and confirmed, so NeuCharBox finished the wrap-up and flagged the light.' } },
        ] },
      },
    },
    {
      chip: 'Recording only — camera and mic, no stream, no sign.',
      keywords: ['recording', 'record', 'rec', 'camera', 'mic', 'local', 'locally', 'video', 'start', 'begin', 'offline', 'cam', 'film', 'filming'],
      rulesOut: ['live', 'broadcast', 'online', 'livestream', 'webcam', 'backup', 'screen', 'purple', 'green', 'pink', 'yellow', 'orange', 'teal', 'cyan', 'rainbow'], // routing (js/engine/match.js): "go live without the sign" is never this; it records the main camera, strip untouched
      avoid: ['just video', 'video only', 'audio only', 'just audio', 'sound only', 'just sound', 'silent', 'silently', 'silence', 'dark', 'check', 'test', 'fix', 'broken', 'repair', 'isnt', 'doesnt', 'working',
        'finish', 'finished', 'done', 'end', 'ending', 'ended', 'stop', 'stopped', 'cut', 'drop', 'lose', 'hide', 'ditch', 'disconnect', 'lower mic', 'mic down', 'going offline', 'take offline', 'taking offline', 'get offline'], // its plan turns the camera and light on, opens the mic and starts a recording: never for "record in the dark", "done recording", "cut the camera", "turn the mic down"; "the camera isn't working" is no request to record
      expect: { 'mic.status': 'online', 'mic.muted': false, 'mic.level': -20, 'cam.signal': true, 'capture.signal': true, 'overlay.scene': 'recording', 'onair.on': false },
      steps: [
        { beat: 'plan' },
        { say: 'Local recording, nothing goes out. The stream stays off and so does the sign — that\'s the point of the request, so I\'ll treat both as "must not turn on".' },
        { plan: { intro: 'Recording setup:', steps: [
          { text: 'Key light on, 70% at 5000K' },
          { text: 'Video: camera on, capture on HDMI 1, verify signal' }, // "video", "audio", "sound": "record without video / audio / sound" asks back
          { text: 'Audio: mic open; recording starts only once it picks up sound — a silent recording is a wasted one' },
          { text: 'Stream: off. On-air sign: off. Both locked for this session.' },
        ] } },
        { beat: 'run' },
        { set: 'keylight.on', to: true }, { set: 'keylight.kelvin', to: 5000 }, { tween: 'keylight.brightness', to: 0.7, ms: 1000, label: 'Key light → 70% · 5000K' },
        { failPoint: 'camera' },
        { set: 'cam.on', to: true, label: 'Main camera → on' }, { wait: 800 }, { set: 'cam.signal', to: true }, { set: 'capture.signal', to: true, label: 'Main camera signal verified' }, { wait: 600 },
        { set: 'mic.level', to: -90 }, { set: 'mic.muted', to: false, label: 'Mic → live' },
        { say: 'Camera verified. Mic open. Waiting for audio level before I start the recording…' },
        { wait: 1600 },
        { failPoint: 'level' },
        { tween: 'mic.level', to: -20, ms: 800, label: 'Mic level −20 dB' }, { wait: 400 },
        { failPoint: 'start' },
        { set: 'overlay.scene', to: 'recording', label: 'Recording started' },
        { say: 'Level\'s steady around −20 dB. Recording started. Stream and sign stay off.' },
        { status: 'Recording · stream off · sign off' },
        { failPoint: 'rolling' },
        { end: { headline: 'Recording, and nothing going out.', body: 'NeuCharBox started the recording only after the camera\'s picture and the mic\'s level were confirmed. The stream and the on-air sign stayed off the whole time, as asked.' } },
      ],
      genericAt: 'start', // the LED strip (unused here) fails with the picture and the level confirmed, before the recording starts
      whatIf: {
        cam: { at: 'camera', steps: [
          { status: 'Main camera → on' }, { wait: 1500 },
          { status: 'Main camera: no reply · retrying' }, { wait: 1200 },
          { fail: 'cam', title: '⚠ Camera not answering', faultText: 'not answering · no picture', say: 'The camera didn\'t answer "on", and the capture card sees nothing on HDMI 1. All it has reported since setup is "off".' },
          { wait: 2000 },
          { say: 'No recording without the picture you asked for. The key light stays on, the mic stays closed, and nothing has started, so there\'s nothing to clean up.' },
          { ask: { intro: 'Your plan has no backup camera. The USB webcam on the monitor could record instead. Your call:', options: [
            { label: 'Wait, I\'ll check the camera', primary: true, apply: [
              { status: 'Waiting for a picture on HDMI 1…' }, { wait: 1200 },
              { say: 'Waiting. When the camera shows a picture on HDMI 1, I\'ll open the mic, check its level and start the recording, as planned.' },
              { replan: { intro: 'Holding the recording:', changes: ['Camera: not answering; no picture on HDMI 1', 'Recording not started, so nothing to clean up', 'Key light on; mic closed; stream and sign off and locked'], needsYou: 'Check the camera\'s power and its HDMI cable. If its screen stays dark, it isn\'t getting power.' } },
              { status: 'Waiting for the camera · camera flagged' },
            ] },
            { label: 'Record on the USB webcam', apply: [
              { set: 'plan.backup', to: true, label: 'Video source → USB webcam' }, { wait: 1200 },
              { set: 'mic.level', to: -90 }, { set: 'mic.muted', to: false, label: 'Mic → live' }, { wait: 800 },
              { tween: 'mic.level', to: -20, ms: 800, label: 'Mic level −20 dB' }, { wait: 400 },
              { set: 'overlay.scene', to: 'recording', label: 'Recording started · USB webcam' }, { wait: 600 },
              { say: 'Webcam picture confirmed, mic level steady at −20 dB. Recording on the webcam, logged as such. Stream and sign still off.' },
              { replan: { intro: 'Recording on the webcam:', changes: ['Camera: not answering; no picture on HDMI 1', 'Video: the USB webcam, picture confirmed', 'Audio: your mic, level −20 dB', 'Stream and sign: off and locked'], needsYou: 'Check the camera\'s power and HDMI cable before your next take. The webcam\'s wider, flatter picture won\'t match your other takes.' } },
              { status: 'Recording · USB webcam · camera flagged' },
            ] },
          ] } },
          HOLD,
          { end: { headline: 'It asked before swapping your camera.', body: 'The main camera never answered or sent a picture. NeuCharBox held the recording and asked before using the webcam, because your plan didn\'t include one.' } },
        ] },
        mic: { at: 'level', steps: [
          { status: 'Waiting for audio level…' }, { wait: 3000 },
          { fail: 'mic', title: '⚠ No input from the mic', say: 'Mic is unmuted but the level has stayed flat at −90 dB since I opened it. That\'s no input, not silence — a room is never that quiet.' },
          { wait: 2000 },
          { say: 'Not starting a recording I can already tell is broken. Camera and key light stay on, so you keep your light and framing.' },
          { ask: { intro: 'Your call: wait for the mic, or record video without sound?', options: [
            { label: 'Wait — I\'ll fix the mic', primary: true, apply: [
              { status: 'Waiting for mic level…' }, { wait: 1200 },
              { say: 'Waiting. Camera and light stay as they are, and the recording starts the moment the mic shows level. Stream and sign still off.' },
              { replan: { intro: 'Holding off on recording:', changes: ['Recording not started — nothing to clean up later', 'Camera, light and capture stay ready', 'Stream and sign remain off and locked', 'I\'ll start the recording the moment the mic shows level'], needsYou: 'Check the mic\'s USB or the boom arm cable — flat −90 dB usually means unplugged, not muted.' } },
              { status: 'Waiting for mic level · mic flagged' },
            ] },
            { label: 'Record video only, no audio', apply: [
              { set: 'plan.videoOnly', to: true }, { set: 'overlay.scene', to: 'recording', label: 'Recording started · video only' }, { wait: 1200 },
              { say: 'Recording video only — logged as such, so you\'re not surprised in the edit. Stream and sign still off.' },
              { replan: { intro: 'Recording video only:', changes: ['Mic: flat at −90 dB since it opened, so no input', 'Recording: started, video only, logged as such', 'Camera and key light as planned; stream and sign off and locked'], needsYou: 'Check the mic\'s USB or the boom arm cable. This take has no sound: record audio separately or retake it.' } },
              { status: 'Recording · video only · mic flagged' },
            ] },
          ] } },
          HOLD,
          { end: { headline: 'No sound, no take until you say.', body: 'A recording that\'s technically running and practically useless is the worst outcome. NeuCharBox checked the thing that mattered, held, and asked.' } },
        ] },
        overlay: { at: 'start', steps: [
          { status: 'Starting the recording…' }, { wait: 2000 },
          { fail: 'overlay', title: '⚠ Overlay app not responding', faultText: 'not responding', say: 'I sent "start recording" and the overlay app didn\'t answer. Not a word from it since, so I can\'t tell whether it\'s recording.' },
          { wait: 2000 },
          { say: 'So I won\'t tell you it is. Treat it as not recording and hold your take. Camera, key light and mic are on and confirmed, the mic at −20 dB.' },
          { status: 'Retrying the overlay app…' }, { wait: 2500 },
          { say: 'Still no answer from the overlay app. Hold the take until it\'s back: anything you say now may not be saved.' },
          { replan: { intro: 'Not recording, as far as I can tell:', changes: ['Overlay app: no answer to "start recording", nothing reported since', 'Camera, key light and mic: on and confirmed', 'Stream: off at the app\'s last report. On-air sign: off and locked'], needsYou: 'Restart the overlay app on the PC. Once it answers, I\'ll start the recording and confirm its recording timer is running before I say "recording".' } },
          { status: 'Not recording (unconfirmed) · overlay app flagged' },
          HOLD,
          { end: { headline: 'Unconfirmed means not recording.', body: 'The overlay app stopped answering at "start recording". NeuCharBox told you not to trust the take until it could confirm the recording was running.' } },
        ] },
        onair: { at: 'start', steps: [
          { status: 'Checking the locks: stream off, on-air sign off' }, { wait: 2000 },
          { fail: 'onair', title: '⚠ On-air sign not answering', faultText: 'not answering', say: 'Before I start, I check both locks. The stream is off: the overlay app confirms it. The on-air sign didn\'t answer; "off" was its last word.' },
          { wait: 2000 },
          { say: 'I can\'t lock a sign I can\'t reach. But nothing in this session turns it on, and "off" is what you asked for, so the recording doesn\'t depend on it. Starting.' },
          { set: 'overlay.scene', to: 'recording', label: 'Recording started' }, { wait: 1200 },
          { say: 'Recording, with the mic at −20 dB. The stream is still off. The sign I can only vouch for up to its last report.' },
          ...talk(-20),
          { replan: { intro: 'Recording, one lock unconfirmed:', changes: ['Recording: started, camera and mic confirmed', 'Stream: off, confirmed and locked', 'On-air sign: not answering; last report "off". I can\'t lock it until it answers'], needsYou: 'Glance at the sign: it should be dark. If it isn\'t, switch it off at its plug.' } },
          { status: 'Recording · on-air sign flagged' },
          HOLD,
          { end: { headline: 'One lock it couldn\'t check.', body: 'The on-air sign stopped answering before the recording started. NeuCharBox said what it could confirm and what it couldn\'t, and recorded anyway because nothing depended on the sign.' } },
        ] },
        keylight: { at: 'rolling', steps: [
          { status: 'Recording · 0:38' }, { wait: 1000 }, ...talk(-20),
          { tween: 'keylight.brightness', to: 0, ms: 200 },
          { fail: 'keylight', title: '⚠ Key light went out', faultText: 'went dark · not answering', say: 'The key light went out 41 seconds into the take, and it isn\'t answering. The camera\'s picture got much darker at the same moment, so the light really is out, not just offline.' },
          { set: 'overlay.tag', to: 'marker · 0:41' }, { wait: 2000 },
          { say: 'Recording keeps going: the camera and mic are fine, and stopping would cost you the take. I\'ve put a marker at 0:41, where the light went.' },
          ...talk(-20),
          { say: 'From 0:41 the picture is darker; the sound isn\'t affected.' },
          { replan: { intro: 'Still recording, marked:', changes: ['Key light: dark since 0:41 and not answering', 'Recording: running, camera and mic confirmed; marker at 0:41', 'Stream and sign: off and locked'], needsYou: 'Check the key light\'s power: it went dark, not dim, which usually means power rather than a setting. Anything after 0:41 is darker; retake it if it matters.' } },
          { status: 'Recording · marker at 0:41 · key light flagged' },
          HOLD,
          { end: { headline: 'The light went. The take didn\'t.', body: 'The key light died mid-recording. NeuCharBox saw it in the picture, kept the take running and marked the exact moment, so the fix is a retake, not a hunt.' } },
        ] },
        capture: { at: 'rolling', steps: [
          { status: 'Recording · 1:49' }, { wait: 1000 }, ...talk(-20),
          { fail: 'capture', title: '⚠ Capture card frozen', faultText: 'frozen · not answering', say: 'The capture card stopped answering at 1:52, and the picture it feeds the recording has frozen on one frame. The camera still reports "on"; the card has stopped passing its picture on.' },
          { set: 'overlay.tag', to: 'marker · 1:52' }, ...talk(-20),
          { say: 'Sound is still recording fine, and there\'s a marker at 1:52. From here on, the picture is a still frame.' },
          { ask: { intro: 'Keep recording with a frozen picture, or stop the take here?', options: [
            { label: 'Keep recording, sound is fine', primary: true, apply: [
              { say: 'Still recording. From 1:52 the picture is frozen and the sound is clean; the marker shows where.' },
              ...talk(-20),
              { replan: { intro: 'Still recording, picture frozen:', changes: ['Capture card: not answering since 1:52; picture frozen from there', 'Recording: running, mic at −20 dB; marker at 1:52', 'Stream and sign: off and locked'], needsYou: 'When you stop, unplug the capture card and plug it back in. Anything after 1:52 needs a retake for the picture.' } },
              { status: 'Recording · picture frozen · capture card flagged' },
            ] },
            { label: 'Stop the take here', apply: [
              { set: 'overlay.scene', to: 'idle' }, { set: 'overlay.tag', to: '', label: 'Recording stopped · saved up to 1:52' }, { wait: 1200 },
              { say: 'Stopped. The file ends just after 1:52; picture and sound were fine up to there. Camera, light and mic stay ready.' },
              { replan: { intro: 'Take stopped:', changes: ['Capture card: not answering since 1:52; picture froze there', 'Recording: stopped and saved, ending just after 1:52', 'Camera, key light and mic: on and ready; stream and sign off'], needsYou: 'Unplug the capture card and plug it back in. When it shows a moving picture again, I\'ll start a new take when you say.' } },
              { status: 'Take stopped at 1:52 · capture card flagged' },
            ] },
          ] } },
          HOLD,
          { end: { headline: 'A frozen picture, caught and marked.', body: 'The capture card froze mid-take. NeuCharBox spotted the repeated frame within seconds, marked the moment and let you choose between keeping the sound and stopping.' } },
        ] },
      },
    },
  ],
};
