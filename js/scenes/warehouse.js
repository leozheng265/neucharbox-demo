// Scene 4 — Warehouse (illustrative). Proves: coordination that re-routes when a unit drops out.

// Cart loop in front of the line, shared by the room and the scripts. u = 0 is alongside the end of C1 (pick-up),
// u = 1 alongside C3 (drop-off); 1 < u < 2 is the way back on the return lane, and u = 2 is u = 0 again.
// Carts only pass each other on different lanes, so they never drive through one another.
const X_PICK = -2.35, X_DROP = 2.6, Z_IN = 1.18, Z_OUT = 1.95;
const SHIFT = Z_OUT - Z_IN, RUN = X_DROP - X_PICK, BACK = RUN + 2 * SHIFT;
const uOut = (x) => (x - X_PICK) / RUN;                 // u of a spot on the belt-side lane
const uBack = (x) => 1 + (SHIFT + X_DROP - x) / BACK;   // u of a spot on the return lane
const HOME = { agvA: -3.0, agvB: -1.4 }, HOME_Z = 2.85;  // the carts' bays (x), off the loop beside the desk
// Cart legs are timed from their length. A leg eases in and out, so it peaks at twice its average speed: d metres take
// 2·d / V_CART seconds and never go faster than V_CART. The room runs its belts 2.2× faster than labelled (SPEED_K), so
// 3.5 m/s here is a cart at about 1.6 m/s beside belts at 0.5 m/s.
const V_CART = 3.5, legMs = (d) => Math.max(600, Math.round((2000 * d) / V_CART));
const backTo = (x) => SHIFT + X_DROP - x;              // metres from the drop-off back to x on the return lane
function cartAt(u, v) {
  if (u <= 1) return v.set(X_PICK + RUN * Math.max(0, u), 0, Z_IN);
  const s = (Math.min(u, 2) - 1) * BACK;
  if (s < SHIFT) return v.set(X_DROP, 0, Z_IN + s);
  if (s < SHIFT + RUN) return v.set(X_DROP - (s - SHIFT), 0, Z_OUT);
  return v.set(X_PICK, 0, Z_OUT - (s - SHIFT - RUN));
}
// A cart's state: 'moving' on the loop, 'parking' while it turns off the return lane into its bay (the tile says parked,
// and the beacon goes steady green, only once it is in), 'parked', or 'stopped' where the stop found it.
const driving = (s) => s.state === 'moving' || s.state === 'parking';
const cartText = (s) => (s.state === 'moving' ? (s.load ? 'moving · loaded' : 'moving · empty') : s.state);
// The Divert prompt's end card depends on the Edit the visitor chose; the step before `end` fills it in.
const DIVERT_SAFE = { headline: 'It stopped trusting the sensor before you had to.', body: 'A rule you approved decided what happens when the scanner\'s word isn\'t good enough. NeuCharBox took the safe option, not the fast one, and told you what to check.' };
const DIVERT_HELD = { headline: 'It held the parcel instead of guessing.', body: 'You chose to stop on an unreadable label. NeuCharBox stopped C1 at the first one, let C2 and C3 finish, and told you exactly which parcel needs a person.' };
const DIVERT_END = { ...DIVERT_SAFE };

// The parcels live in the room, and the scanner and dock tiles count what the room does: a parcel is scanned when it
// crosses the red beam while the arch is armed, and docked when it goes through the door. build() registers the
// room's line here; the tests run the scripts without a room, and then every step falls back to scripted numbers.
const lineOf = new WeakMap(); // store → line
const SX = -2.7;              // the scanner arch, over the end of C1
const GATE_CALL_X = -0.1;     // a parcel for lane B calls the gate about a metre before it gets there
function sync(store, line) {
  if (store.get('scanner.count') !== line.scanned) store.set('scanner.count', line.scanned);
  const d = Math.min(line.docked, store.get('dock.target')); if (store.get('dock.parcels') !== d) store.set('dock.parcels', d);
}
// Keeps the tiles on the room while the line moves: one loop per room, until the room is reset for another request
// or the visitor skips ahead (the script then sets the skipped-to state, and the next wait starts the loop again).
function watch(ctx, line = lineOf.get(ctx.store)) {
  if (!line || line.watching || ctx.fast) return;
  const gen = line.gen; line.watching = true;
  (async () => { while (!ctx.fast && line.gen === gen) { sync(ctx.store, line); await ctx.sleep(60); } if (line.gen === gen) line.watching = false; })();
}
// Waits on the script's clock (so ?speed= and skips apply) until the room says so. False when there is no room
// (tests) or the visitor skipped ahead: the caller then sets the scripted state itself.
async function until(ctx, test, maxMs = 40000) {
  const line = lineOf.get(ctx.store); if (!line) return false;
  const gen = line.gen; watch(ctx, line);
  for (let t = 0; t < maxMs; t += 50) { if (ctx.fast || line.gen !== gen) return false; if (test(line)) { sync(ctx.store, line); return true; } await ctx.sleep(50); }
  return false;
}
// A skip (or a headless run) jumps to n parcels scanned: the room lays the line out to match, the tiles follow it.
// `past`: how far the n-th is past the beam.
function jump(store, n, past) { const line = lineOf.get(store); if (line) { line.lay(n, past); sync(store, line); } else { store.set('scanner.count', n); store.set('dock.parcels', Math.max(0, n - 10)); } }
// Lane B for one parcel: the gate swings as that parcel comes up to it, and back once it is in lane B.
async function divert(ctx, n) {
  const { store, tween, status } = ctx; const at = (l) => l.find(n);
  await until(ctx, (l) => { const p = at(l); return !p || p.lane !== 'main' || p.x >= GATE_CALL_X; }, 15000);
  store.set('gate.lane', 'B'); status(`Gate → lane B · parcel ${n}`); await tween('gate.pos', 1, 700);
  await until(ctx, (l) => { const p = at(l); return !p || p.lane === 'wait' || (p.lane === 'B' && p.b > 0.6) || (p.lane === 'main' && p.x > 1.8); }, 15000);
  if (ctx.fast) lineOf.get(store)?.diverted(n); // skipped: parcel n is in the tote all the same, not left on the line
  store.set('gate.lane', 'A'); status('Gate → lane A'); await tween('gate.pos', 0, 700);
}

export default {
  id: 'warehouse',
  title: 'Warehouse',
  startHour: 10,
  // Seen from outside the (cut-away) front wall, three-quarter from the left, so the whole line fits: hub desk,
  // receiving, scanner, gate and lane B, the carts, C3 and the dock door with its light.
  camera: { position: [-5.07, 3.8, 8.46], target: [-0.5, 0.8, 1.0], minDistance: 3, maxDistance: 12, azimuth: [-0.66, -0.45], fov: 50, fitAspect: 1.3, panBounds: { x: [-6.5, 6.5], y: [0.3, 3], z: [-4.5, 4.5] } },
  setupIntro: 'A small outbound line — an illustrative setup, not a specific site. Three conveyor sections, a scanner arch, a sorter gate to lane B, two carts, and dock 2. The hub is on the desk. Plug it in to start.',
  askIntro: 'Give the line an instruction. Pick one, or type your own.',
  deviceOrder: ['c1', 'c2', 'c3', 'scanner', 'gate', 'agvA', 'agvB', 'dock'],
  devices: {
    c1:      { icon: 'conveyor', name: 'Conveyor C1', initial: { running: false, speed: 0 }, format: (s) => (s.running ? `running · ${s.speed.toFixed(1)} m/s` : 'stopped'), faultText: 'motor fault' },
    c2:      { icon: 'conveyor', name: 'Conveyor C2', initial: { running: false, speed: 0 }, format: (s) => (s.running ? `running · ${s.speed.toFixed(1)} m/s` : 'stopped'), faultText: 'motor fault' },
    c3:      { icon: 'conveyor', name: 'Conveyor C3', initial: { running: false, speed: 0 }, format: (s) => (s.running ? `running · ${s.speed.toFixed(1)} m/s` : 'stopped'), faultText: 'motor fault' },
    scanner: { icon: 'scanner', name: 'Scanner arch', initial: { armed: false, count: 0, misreads: 0 }, format: (s) => (!s.armed ? 'idle' : s.misreads ? `${Math.round(s.count)} scanned · ${Math.round(s.misreads)} unreadable` : `armed · ${Math.round(s.count)} scanned`), faultText: 'reads not trusted' },
    gate:    { icon: 'gate', name: 'Sorter gate', initial: { lane: 'A', pos: 0, all: false }, format: (s) => `→ lane ${s.lane}${s.lane === 'B' && s.all ? ' · every parcel' : ''}`, active: (s) => s.lane === 'B', faultText: 'jammed' },
    agvA:    { icon: 'cart', name: 'Cart A', initial: { state: 'parked', u: 0, load: false }, format: cartText, active: driving, faultText: 'no acknowledgement' },
    agvB:    { icon: 'cart', name: 'Cart B', initial: { state: 'parked', u: 0, load: false }, format: cartText, active: driving, faultText: 'no acknowledgement' },
    dock:    { icon: 'dock', name: 'Dock 2', initial: { light: 'red', parcels: 0, target: 40 }, format: (s) => `${s.light === 'green' ? 'open' : 'closed'} · ${Math.round(s.parcels)}/${s.target} parcels`, faultText: 'door fault' },
  },

  build({ R, P, M, THREE, store, parts, speed = 1 }) {
    const concreteC = parts.concreteTex();
    const concrete = new THREE.MeshStandardMaterial({ map: parts.tex(concreteC, [4, 3]), roughness: 0.85 });
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xB9BDBB, roughness: 0.95 });
    P.roomShell({ w: 14, d: 10, h: 5, floorMat: concrete, wallMat, skirting: false });
    // yard around the building: the default view is from outside the cut-away front wall, so the ground never ends in
    // view. It reaches past the camera's far plane (80 m) from anywhere the orbit goes (the camera stays within 19.2 m of
    // its target), so its edge never shows, even from behind at full zoom-out: the far plane cuts it along the horizon.
    const yard = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ map: parts.tex(concreteC, [57, 57]), color: 0x9EA3A3, roughness: 0.95 })); yard.rotation.x = -Math.PI / 2; yard.position.set(0, -0.012, 0); yard.receiveShadow = true; R.scene.add(yard);
    R.lights.sun.intensity = 0; R.lights.sun.castShadow = false; R.lights.hemi.intensity = 0.45; R.lights.fill.intensity = 0.25; R.scene.background = new THREE.Color(0xA8B0B4);
    // ceiling lights: the fixtures hang on the 5 m ceiling, so they hide with it when the camera is above it
    const fixMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.5 });
    for (const x of [-4, 0, 4]) for (const z of [-3, 1]) { const l = new THREE.PointLight(0xF4F1E8, 9, 16, 1.5); l.position.set(x, 4.8, z); if (x === 0 && z === 1) { l.castShadow = true; l.shadow.mapSize.set(2048, 2048); l.shadow.bias = -0.001; } R.scene.add(l); const fx = P.box(1.2, 0.05, 0.3, fixMat, x, 4.974, z); fx.userData.wall = { nx: 0, ny: -1, nz: 0, d: -5 }; }
    // floor markings: line zone boundaries, and a dashed divider between the carts' belt-side lane and return lane
    const line = new THREE.MeshStandardMaterial({ color: 0xE4B53A, roughness: 0.9 }), dash = new THREE.MeshStandardMaterial({ color: 0xE9E7E0, roughness: 0.9 });
    const paint = (w, d, mat, x, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.004, z); m.receiveShadow = true; R.scene.add(m); };
    for (const z of [-2.9, 2.4]) paint(12, 0.08, line, 0, z);
    for (let x = X_PICK + 0.15; x < X_DROP - 0.1; x += 0.6) paint(0.3, 0.05, dash, x, (Z_IN + Z_OUT) / 2);
    // racks along the back wall with pallets; pallets rest on the floor or a shelf, cartons rest on their pallet. The
    // shelves are matte galvanized decks: polished steel mirrored the ceiling lights into white hot spots from above.
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0x9AA1A7, roughness: 0.75, metalness: 0.35 });
    for (let r = 0; r < 4; r++) { const x = -5.2 + r * 2.6; for (const dx of [-1.1, 1.1]) { P.box(0.08, 4.2, 0.08, M.steel, x + dx, 2.1, -4.7); P.box(0.08, 4.2, 0.08, M.steel, x + dx, 2.1, -3.7); } for (const y of [0.9, 2.2, 3.5]) { P.box(2.3, 0.06, 1.1, shelfMat, x, y, -4.2); } for (const y of [0.0, 0.93, 2.23]) for (const dx of [-0.55, 0.55]) { if (Math.random() < 0.8) { const h = 0.45 + Math.random() * 0.3; P.box(0.9, 0.1, 0.9, M.woodLight, x + dx, y + 0.05, -4.2); P.box(0.8, h, 0.8, M.cardboard, x + dx, y + 0.1 + h / 2, -4.2, 0.01); } } }

    // Wall-hung parts hide with their wall when the camera is outside it (renderer.js); `hang` gathers everything built
    // since `from` into one tagged group, so the door's own animation (slats, lamps) stays the scene's. Hidden, the group
    // catches no taps (the picker skips wall-hidden parts).
    const hang = (from, nx, d) => {
      const g = new THREE.Group(); for (const o of R.scene.children.slice(from)) g.add(o); R.scene.add(P.onWall(g, nx, 0, d));
      return g;
    };
    // The two yellow wall signs, in bold and filtered for grazing angles: both are mostly read edge-on from across the
    // room, where regular-weight letters blurred into the yellow, and DOCK 2 (in the corner the ceiling lights make
    // brightest, whose glow veils it) turned into a blank pale panel.
    const signMat = (text, w, h, px) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
      g.fillStyle = '#E4B53A'; g.fillRect(0, 0, w, h); g.fillStyle = '#1A1C1E'; g.font = `bold ${px}px "Segoe UI", Inter, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      return new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 });
    };
    // Parcels never show past the receiving hatch or the trailer panel: they slide out of the one and into the other.
    const IN_X = -6.99, OUT_X = 6.975;
    // dock 2 on the right wall: a roll-up door that opens while the dock light is green, drum housing with the light on
    // top, bumpers, the sign and the signal. The sign sits just above the light, low enough that the phone view's hint
    // pill (top right of the room) doesn't cover it anywhere along the default view's sway.
    const dock0 = R.scene.children.length;
    const door = P.box(0.06, 3.2, 3.0, new THREE.MeshStandardMaterial({ color: 0x6E7478, roughness: 0.7, metalness: 0.4 }), 6.96, 1.6, 0.6);
    const slats = []; for (let i = 0; i < 8; i++) slats.push(P.box(0.02, 0.02, 3.0, M.black, 6.92, 0.4 + i * 0.4, 0.6));
    // the trailer's dark interior behind the open door: one panel facing the room, at OUT_X
    const trailer = new THREE.Mesh(new THREE.PlaneGeometry(2.98, 3.18), new THREE.MeshStandardMaterial({ color: 0x15181B, roughness: 1 })); trailer.rotation.y = -Math.PI / 2; trailer.position.set(OUT_X, 1.59, 0.6); trailer.receiveShadow = true; R.scene.add(trailer);
    const dockHousing = P.box(0.24, 0.26, 3.1, M.steel, 6.878, 3.33, 0.6);
    const dockLight = P.beacon(6.88, 3.47, 0.6); dockLight.scale.set(2, 1.6, 2);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.3), signMat('DOCK 2', 256, 96, 70)); sign.rotation.y = -Math.PI / 2; sign.position.set(6.99, 3.78, 0.6); R.scene.add(sign);
    P.box(0.3, 0.3, 0.4, M.rubber, 6.848, 0.2, -1.1); P.box(0.3, 0.3, 0.4, M.rubber, 6.848, 0.2, 2.3);
    // dock signal on the wall beside the door, at eye height: red over green, the lit one is the dock's state
    const sigHousing = P.box(0.08, 0.44, 0.22, M.black, 6.95, 2.25, -1.4, 0.02);
    const lamp = (hex, y) => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.075, 20, 14), new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 0 })); m.position.set(6.9, y, -1.4); m.userData.hex = hex; R.scene.add(m); return m; };
    const sigRed = lamp(0xE0563A, 2.36), sigGreen = lamp(0x2FBF71, 2.14), SIG = [sigRed, sigGreen];
    hang(dock0, -1, -7); // the right wall, x = 7

    // three conveyor sections along x at z = 0.5, belt top at 0.83. Drives and status beacons sit on the back rail,
    // so the front stays clear for the carts. The back rail is open where lane B leaves.
    const belt = new THREE.MeshStandardMaterial({ color: 0x22262A, roughness: 0.9 });
    const beltY = 0.8, LZ = 0.5, GAP = [0.945, 1.655];
    const rail = (x0, x1, z) => { if (x1 - x0 > 0.001) P.box(x1 - x0, 0.14, 0.05, M.steel, (x0 + x1) / 2, beltY - 0.02, z); };
    function conveyor(x0, x1) {
      const len = x1 - x0, cx = (x0 + x1) / 2;
      const beltMesh = P.box(len, 0.06, 0.62, belt, cx, beltY, LZ);
      rail(x0, x1, LZ + 0.33); rail(x0, Math.min(x1, Math.max(x0, GAP[0])), LZ - 0.33); rail(Math.max(x0, Math.min(x1, GAP[1])), x1, LZ - 0.33);
      for (const lx of [x0 + 0.25, x1 - 0.25]) for (const dz of [-0.28, 0.28]) P.box(0.05, beltY - 0.05, 0.05, M.steel, lx, (beltY - 0.05) / 2, LZ + dz);
      const motor = P.box(0.22, 0.18, 0.18, M.black, x1 - 0.3, 0.72, LZ - 0.33 - 0.025 - 0.09, 0.01);
      P.box(0.03, 0.25, 0.03, M.black, x1 - 0.3, beltY + 0.175, LZ - 0.33);
      const led = P.beacon(x1 - 0.3, beltY + 0.31, LZ - 0.33);
      return { x0, x1, beltMesh, motor, led };
    }
    const C = { c1: conveyor(-5.0, -2.0), c2: conveyor(-2.0, 1.0), c3: conveyor(1.0, 6.9) };
    // receiving: parcels come in through a hatch in the left wall (a dark panel at IN_X, framed, with its sign), onto a
    // short infeed that runs with C1 and ends at the wall
    P.box(2.0, 0.06, 0.62, belt, -6.0, beltY, LZ); rail(-7.0, -5.0, LZ + 0.33); rail(-7.0, -5.0, LZ - 0.33);
    for (const dz of [-0.28, 0.28]) P.box(0.05, beltY - 0.05, 0.05, M.steel, -6.3, (beltY - 0.05) / 2, LZ + dz);
    const recv0 = R.scene.children.length;
    const hatch = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.78), new THREE.MeshStandardMaterial({ color: 0x15181B, roughness: 1 })); hatch.rotation.y = Math.PI / 2; hatch.position.set(IN_X, beltY + 0.36, LZ); R.scene.add(hatch);
    P.box(0.06, 0.06, 1.02, M.steel, -6.97, beltY + 0.78, LZ); for (const dz of [-0.48, 0.48]) P.box(0.06, 0.84, 0.06, M.steel, -6.97, beltY + 0.36, LZ + dz);
    const rsign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.26), signMat('RECEIVING', 320, 92, 46)); rsign.rotation.y = Math.PI / 2; rsign.position.set(-6.99, beltY + 1.05, LZ); R.scene.add(rsign);
    hang(recv0, 1, -7); // the left wall, x = -7
    // lane B: a branch off the C2/C3 junction toward the back, ending over its tote
    const LB0 = LZ - 0.315, LB1 = -2.0;
    P.box(0.62, 0.06, LB0 - LB1, belt, 1.3, beltY, (LB0 + LB1) / 2);
    const LBR = LZ - 0.305, MOUTH = 0.3; // left rail starts MOUTH further back: the open side where parcels slide in off the gate
    P.box(0.05, 0.14, LBR - MOUTH - LB1, M.steel, 0.97, beltY - 0.02, (LBR - MOUTH + LB1) / 2); P.box(0.05, 0.14, LBR - LB1, M.steel, 1.63, beltY - 0.02, (LBR + LB1) / 2);
    for (const lz of [-0.3, -1.75]) for (const dx of [-0.28, 0.28]) P.box(0.05, beltY - 0.05, 0.05, M.steel, 1.3 + dx, (beltY - 0.05) / 2, lz);
    // lane B tote: an open bin under the belt end. A diverted parcel drops in and sinks below what's already there.
    const binFill = new THREE.MeshStandardMaterial({ color: 0x4A3A28, roughness: 1 });
    P.box(0.84, 0.03, 0.64, M.cardboard, 1.3, 0.015, -2.3); for (const dz of [-0.335, 0.335]) P.box(0.9, 0.6, 0.03, M.cardboard, 1.3, 0.3, -2.3 + dz); for (const dx of [-0.435, 0.435]) P.box(0.03, 0.6, 0.64, M.cardboard, 1.3 + dx, 0.3, -2.3);
    P.box(0.835, 0.01, 0.635, binFill, 1.3, 0.465, -2.3);
    // scanner arch over the end of C1, standing on the belt rails
    for (const z of [LZ - 0.33, LZ + 0.33]) P.box(0.05, 0.75, 0.05, M.steel, SX, beltY + 0.425, z);
    P.box(0.05, 0.05, 0.71, M.steel, SX, 1.625, LZ); const scanHead = P.box(0.12, 0.1, 0.16, M.black, SX, 1.55, LZ, 0.01);
    const scanLine = new THREE.Mesh(new THREE.PlaneGeometry(0.012, 0.6), new THREE.MeshStandardMaterial({ color: 0xFF3030, emissive: 0xFF2020, emissiveIntensity: 5, transparent: true, opacity: 0.7, side: THREE.DoubleSide })); scanLine.rotation.z = Math.PI / 2; scanLine.rotation.y = Math.PI / 2; scanLine.position.set(SX, beltY + 0.04, LZ); R.scene.add(scanLine);
    // sorter gate: a guide fence hinged on the front rail at the C2 → C3 junction; it swings back across the belt to
    // push parcels into lane B. From the default view it is nearly end-on at lane B, so the fence carries a wide top
    // cap that still reads end-on, and a lamp on a mast just upstream shows the lane too: green for A, amber for B.
    const gatePivot = new THREE.Group(); gatePivot.position.set(1.0, beltY + 0.12, LZ + 0.33); R.scene.add(gatePivot);
    const gateArm = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.24, 0.03), M.yellow); gateArm.position.set(0.35, 0.06, 0); gateArm.castShadow = true; gatePivot.add(gateArm);
    const gateCap = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.035, 0.11), M.yellow); gateCap.position.set(0.35, 0.195, 0); gateCap.castShadow = true; gatePivot.add(gateCap);
    const hinge = P.cyl(0.03, 0.03, 0.3, M.steel, 1.0, beltY + 0.18, LZ + 0.33, 12);
    const GLX = 0.8; P.box(0.03, 0.34, 0.03, M.black, GLX, beltY + 0.2, LZ + 0.33); P.cyl(0.036, 0.036, 0.02, M.black, GLX, beltY + 0.38, LZ + 0.33, 16);
    const gateLamp = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.08, 16), new THREE.MeshStandardMaterial({ color: 0x2FBF71, emissive: 0x2FBF71, emissiveIntensity: 2, transparent: true, opacity: 0.9 })); gateLamp.position.set(GLX, beltY + 0.43, LZ + 0.33); R.scene.add(gateLamp);

    // Parcels flow along the whole line as one queue: each advances at its section's speed, keeps SPACING to the one
    // ahead, and waits at the end of its section when the next one is dead, the gate is swinging, or the dock is shut.
    // They come in through the receiving hatch and leave through the dock door, out of sight on both ends; delivered
    // parcels re-enter from receiving. Diverted parcels slide along the gate arm, ride lane B and drop into the tote.
    const SEC = [C.c1, C.c2, C.c3], SPACING = 1.0, END_STOP = 0.22, ENTRY_X = -7.4, DOOR_X = 7.15, SPEED_K = 2.2, INTO = 0.5 * SPEED_K;
    const secAt = (x) => (x < C.c1.x1 ? 0 : x < C.c2.x1 ? 1 : 2);
    const flow = []; for (let i = 0; i < 24; i++) { const s = 0.26 + (i % 3) * 0.04; const mesh = P.parcel(0, beltY + 0.03, LZ, s); flow.push({ mesh, y0: mesh.position.y, hw: s / 2 }); }
    const BPATH = [[0.962, LZ], [1.251, 0.136], [1.3, -0.25], [1.3, LB1], [1.3, -2.3]]; // x, z
    const BLEN = []; { let acc = 0; BLEN.push(0); for (let i = 1; i < BPATH.length; i++) { acc += Math.hypot(BPATH[i][0] - BPATH[i - 1][0], BPATH[i][1] - BPATH[i - 1][1]); BLEN.push(acc); } }
    // x, z and drop along lane B into `out`. Off the belt end the parcel falls into the tote and is below its fill
    // for the last quarter of the way, so it is out of sight before it is recycled.
    const bAt = (b, out) => { let i = 1; while (i < BPATH.length - 1 && b > BLEN[i]) i++; const k = Math.min(1, Math.max(0, (b - BLEN[i - 1]) / (BLEN[i] - BLEN[i - 1]))); out[0] = BPATH[i - 1][0] + (BPATH[i][0] - BPATH[i - 1][0]) * k; out[1] = BPATH[i - 1][1] + (BPATH[i][1] - BPATH[i - 1][1]) * k; out[2] = i === BPATH.length - 1 ? 0.62 * Math.min(1, k / 0.75) ** 2 : 0; return out; };
    const free = () => flow.find((p) => p.lane === 'wait');
    const put = (x, sn = 0) => { const p = free(); if (p) Object.assign(p, { lane: 'main', x, sn, b: 0, k: 0, cart: null }); return p; };
    // The room's line, read and set by the scripts: counters (see sync), where a given scanned parcel is, and snaps
    // for skips, for the mid-shift start of the Stop request and for the Move request's time-lapse.
    const ln = {
      gen: 0, watching: false, scanned: 0, docked: 0, toB: new Set(), // toB: the scanned numbers sent down lane B
      find: (n) => flow.find((p) => p.sn === n && p.lane !== 'wait'),
      onC3: () => flow.some((p) => p.lane === 'main' && p.x >= C.c3.x0),
      c2: () => flow.filter((p) => p.lane === 'main' && p.x >= C.c2.x0 && p.x < C.c2.x1).map((p) => p.x).sort((a, b) => b - a), // most downstream first
      riding: () => flow.filter((p) => (p.lane === 'main' && p.x >= C.c3.x0) || p.lane === 'down' || (p.lane === 'cart' && p.cart.group.position.x > C.c3.x0)).length, // still on their way down C3
      // as if n had gone through the armed arch with every belt running and the door open: one per SPACING, the n-th
      // `past` the beam, the earliest already through the door. What's on a cart or in lane B stays there, and a parcel
      // already sent down lane B leaves its gap in the line (and isn't counted at the dock).
      lay(n, past = 0.05) {
        for (const p of flow) if (p.lane !== 'cart' && p.lane !== 'B') Object.assign(p, { lane: 'wait', sn: 0, cart: null });
        let docked = 0;
        for (let k = n; k >= 1; k--) { const x = SX + past + (n - k) * SPACING; if (x > DOOR_X) { docked = k; for (const b of ln.toB) if (b <= k) docked--; break; } if (!ln.toB.has(k)) put(x, k); }
        for (let x = SX + past - SPACING; x >= ENTRY_X; x -= SPACING) put(x);
        ln.scanned = n; ln.docked = docked;
      },
      // a skip: cart `id` where it would be by now at u (the room eases carts along, and holds a stopped one where it is)
      snap(id, u) { const c = CARTS.find((k) => k.id === id); c.group.position.lerpVectors(c.home, cartAt(u, tmp), smooth(c.blend)); },
      // cart `id` has finished turning into its bay
      inBay: (id) => CARTS.find((k) => k.id === id).blend < 0.001,
      // a skip passed parcel n's turn at the gate: it is in the tote, as if the gate had taken it
      diverted(n) { const p = ln.find(n); if (p && p.lane === 'main') Object.assign(p, { lane: 'wait', sn: 0 }); ln.toB.add(n); },
      // time-lapse: C1 keeps only the last `queue` parcels (the first at its end stop, already scanned); C2 and C3 stay
      // as they are; the counts jump so that `dockedAfter` is at the dock once C1's queue and C3 have gone through
      cut(queue, scanned, dockedAfter) {
        const onC1 = flow.filter((p) => p.lane === 'main' && p.x < C.c1.x1).sort(byX); // the front ones stay (as the last ones)
        onC1.forEach((p, i) => Object.assign(p, i < queue ? { x: C.c1.x1 - END_STOP - i * SPACING, sn: i === 0 ? scanned : 0 } : { lane: 'wait', sn: 0 }));
        for (let i = onC1.length; i < queue; i++) put(C.c1.x1 - END_STOP - i * SPACING, i === 0 ? scanned : 0);
        ln.scanned = scanned; ln.docked = dockedAfter - queue - ln.riding();
      },
      // the Stop request starts mid-shift: the line laid out as if n had been scanned, the door already up and the
      // carts already out on the loop (with a parcel on board if the store says loaded). Nothing starts up in view.
      midShift(n) {
        const s = store.state; ln.lay(n);
        doorVis = s.dock.light === 'green' ? 1 : 0; gateVis = s.gate.pos;
        for (const c of CARTS) {
          const st = s[c.id]; c.blend = st.state === 'parked' || st.state === 'parking' ? 0 : 1; c.group.position.lerpVectors(c.home, cartAt(st.u, tmp), smooth(c.blend)); c.wasLoaded = !!st.load;
          if (st.load && !flow.some((p) => p.cart === c)) { const p = free(); if (p) Object.assign(p, { lane: 'cart', cart: c, sn: 0 }); }
        }
      },
    };
    lineOf.set(store, ln);
    // the idle line: a queue on C1, all of it before the scanner, and the next one half out of the hatch (at x = -7.0:
    // any further in and only a few centimetres of it showed, a flat slab standing in the opening)
    function initFlow() {
      for (const p of flow) Object.assign(p, { lane: 'wait', x: 0, b: 0, k: 0, cart: null, sn: 0 });
      for (let x = SX - 0.3; x > ENTRY_X + 0.2; x -= SPACING) put(x);
      ln.scanned = 0; ln.docked = 0; ln.toB.clear();
    }

    // carts: lift AGVs whose deck sits at belt height, so a parcel moves belt → deck → belt on one level. The column
    // reaches 1 cm into the deck: a column that stopped short left a see-through slit under the deck at eye level.
    function cart(id, x, z) { const g = new THREE.Group(); g.position.set(x, 0, z); R.scene.add(g); const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.22, 0.6), M.steel); body.position.y = 0.2; body.castShadow = true; g.add(body); const colH = beltY - 0.33; const col = new THREE.Mesh(new THREE.BoxGeometry(0.5, colH, 0.4), M.black); col.position.y = 0.31 + colH / 2; col.castShadow = true; g.add(col); const deck = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.03, 0.56), M.steel); deck.position.y = beltY - 0.015; deck.castShadow = true; g.add(deck); for (const dz of [-0.29, 0.29]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.05, 0.02), M.yellow); r.position.set(0, beltY + 0.025, dz); g.add(r); } for (const [dx, dz] of [[-0.3, -0.25], [0.3, -0.25], [-0.3, 0.25], [0.3, 0.25]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 16), M.rubber); w.rotation.x = Math.PI / 2; w.position.set(dx, 0.08, dz); g.add(w); } const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.06, 12), new THREE.MeshStandardMaterial({ color: 0x2FBF71, emissive: 0x2FBF71, emissiveIntensity: 1.5 })); beacon.position.set(-0.4, beltY + 0.03, 0.24); g.add(beacon); return { id, group: g, body, beacon, home: new THREE.Vector3(x, 0, z), blend: 0, wasLoaded: false }; }
    const A = cart('agvA', HOME.agvA, HOME_Z), B = cart('agvB', HOME.agvB, HOME_Z);

    // desk with the hub, a phone and a screen on a stand
    const DX = -4.4, DZ = 2.9;
    P.table(DX, DZ, 1.2, 0.6, 0.75, M.woodLight, M.steel); const hub = P.hub(DX - 0.2, 0.77, DZ, { rotY: 0.4 }); R.addPickable(hub.group, 'hub'); P.phone(DX + 0.2, 0.775, DZ + 0.1, 0.3);
    P.cyl(0.08, 0.08, 0.01, M.black, DX + 0.1, 0.775, DZ - 0.2, 20); P.cyl(0.02, 0.025, 0.07, M.black, DX + 0.1, 0.805, DZ - 0.2, 12); P.box(0.5, 0.32, 0.03, M.black, DX + 0.1, 1.0, DZ - 0.2, 0.01);
    P.box(0.5, 0.5, 0.5, M.cardboard, -6.2, 0.25, 1.5, 0.01); P.box(0.5, 0.45, 0.5, M.cardboard, -6.2, 0.725, 1.5, 0.01);

    for (const k of ['c1', 'c2', 'c3']) { R.addPickable(C[k].beltMesh, k); R.addPickable(C[k].motor, k); }
    R.addPickable(scanHead, 'scanner'); R.addPickable(gatePivot, 'gate'); R.addPickable(hinge, 'gate'); R.addPickable(gateLamp, 'gate'); R.addPickable(A.group, 'agvA'); R.addPickable(B.group, 'agvB'); R.addPickable(door, 'dock'); R.addPickable(dockHousing, 'dock'); R.addPickable(dockLight, 'dock'); R.addPickable(sigHousing, 'dock'); R.addPickable(sigRed, 'dock'); R.addPickable(sigGreen, 'dock');
    const hi = P.highlighter({ c1: [C.c1.beltMesh, C.c1.motor], c2: [C.c2.beltMesh, C.c2.motor], c3: [C.c3.beltMesh, C.c3.motor], scanner: [scanHead], gate: [gateArm, gateCap], agvA: [A.body], agvB: [B.body], dock: [door, dockHousing, sigHousing] });

    // status lamps (belt beacons, gate lamp, cart beacons, dock light): unlit until their device is connected, then lit
    // in its colour at intensity k (a fault blinks)
    const RED = 0xE0563A, GREEN = 0x2FBF71, BLUE = 0x3AB7FF, AMBER = 0xFFB020, UNLIT = 0x2A2C2E;
    const setLamp = (mat, hex, k) => { if (hex == null) { mat.color.setHex(UNLIT); mat.emissive.setHex(0); mat.emissiveIntensity = 0; } else { mat.color.setHex(hex); mat.emissive.setHex(hex); mat.emissiveIntensity = k; } };
    const blink = (t, hz, on, off) => (Math.floor(t * hz) % 2 ? on : off);
    const approach = (v, to, step) => v + Math.max(-step, Math.min(step, to - v));
    const smooth = (k) => k * k * (3 - 2 * k);
    const tmp = new THREE.Vector3(), KEYS = ['c1', 'c2', 'c3'], CARTS = [A, B], spd = [0, 0, 0], queue = [], bp = [0, 0, 0], byX = (a, b) => b.x - a.x; // reused every frame
    let lastT = null, gateVis = 0, doorVis = 0, sent = 0; // sent: parcels diverted since the gate was last told to go to B
    initFlow();

    function load(c, onPath, cx) {
      // at the end of C1: the scanned parcel at the end stop; alongside C2: the most downstream parcel within reach
      const zone = cx < C.c1.x1 ? (p) => p.x > SX && p.x <= C.c1.x1 : (p) => p.x >= C.c2.x0 && p.x < C.c2.x1 && Math.abs(p.x - cx) <= 1.0;
      const q = onPath ? flow.filter((p) => p.lane === 'main' && zone(p)).sort((a, b) => b.x - a.x)[0] : null;
      if (q) Object.assign(q, { lane: 'up', k: 0, cart: c, fx: q.x });
      else { const w = free(); if (w) Object.assign(w, { lane: 'cart', cart: c, sn: 0 }); } // a skip left the cart short of the belt: it's simply loaded
    }
    function unload(c, onPath, cx) {
      const q = flow.find((p) => p.cart === c && (p.lane === 'cart' || p.lane === 'up')); if (!q) return;
      if (onPath && cx > C.c3.x0 + 0.2) Object.assign(q, { lane: 'down', k: 0, fx: q.mesh.position.x, fy: q.mesh.position.y, fz: q.mesh.position.z, tx: cx });
      else Object.assign(q, { lane: 'wait', cart: null });
    }

    return {
      focus: hi.focus,
      reset() { initFlow(); for (const c of [A, B]) { c.blend = 0; c.wasLoaded = false; c.group.position.copy(c.home); } gateVis = 0; doorVis = 0; sent = 0; lastT = null; ln.gen++; ln.watching = false; },
      update(s, t) {
        hi.update();
        const dt = (lastT == null ? 0 : Math.min(0.05, Math.max(0, t - lastT))) * speed; lastT = t; // belts follow ?speed= like the script
        hub.ledMat.emissiveIntensity = s.hub.status === 'on' ? (2.5 + Math.sin(t * 2.2) * 1.5) * s.hub.led : 0;
        for (let i = 0; i < 3; i++) { const st = s[KEYS[i]]; spd[i] = st.status === 'fault' || !st.running ? 0 : st.speed * SPEED_K; }
        // conveyor beacons
        for (const k of KEYS) { const c = C[k], st = s[k]; const bad = st.status === 'fault'; setLamp(c.led.material, st.status === 'offline' ? null : bad ? RED : st.running && st.speed > 0.05 ? BLUE : GREEN, bad ? blink(t, 3, 6, 0.6) : st.running ? 2.5 : 1.2); }
        // dock: the door rolls up while the light is green; parcels only go through a door that is open
        doorVis = approach(doorVis, s.dock.light === 'green' ? 1 : 0, dt / 1.2);
        const lift = 0.9 * smooth(doorVis); door.scale.y = 1 - lift; door.position.y = 3.2 - 1.6 * (1 - lift); for (const m of slats) m.visible = m.position.y > 3.2 * lift + 0.02;
        const dockOpen = s.dock.light === 'green' && doorVis > 0.6;
        const dockBad = s.dock.status === 'fault'; setLamp(dockLight.material, s.dock.status === 'offline' ? null : dockBad ? RED : s.dock.light === 'green' ? GREEN : RED, dockBad ? blink(t, 4, 4, 1) : 1.5);
        const live = s.dock.status !== 'offline', go = s.dock.light === 'green' && !dockBad; // a door fault shows red, blinking
        for (const m of SIG) { const on = live && (m === sigGreen) === go; setLamp(m.material, on ? m.userData.hex : null, dockBad ? blink(t, 4, 3, 0.6) : 3); }
        // gate: swings only through a gap (nothing between C2's end stop and a little way down C3), and holds C2's
        // parcels while it moves
        const gTo = s.gate.pos;
        let zoneBusy = false; for (const p of flow) if (p.lane === 'main' && p.x > C.c2.x1 - END_STOP + 0.001 && p.x < C.c3.x0 + 0.8) { zoneBusy = true; break; }
        if (!(gTo > gateVis && gateVis < 0.02 && zoneBusy)) gateVis = approach(gateVis, gTo, dt * 2.2);
        gatePivot.rotation.y = gateVis * 0.9;
        const settled = Math.abs(gateVis - gTo) < 0.03 && (gTo < 0.03 || gTo > 0.97), toB = settled && gTo > 0.5;
        if (s.gate.lane !== 'B') sent = 0;
        const oneDone = !s.gate.all && sent >= 1; // a per-parcel swing takes one parcel; the rest wait for the gate to come back
        const gB = s.gate.lane === 'B', gateBad = s.gate.status === 'fault'; setLamp(gateLamp.material, s.gate.status === 'offline' ? null : gateBad ? RED : gB ? AMBER : GREEN, gateBad || (gB && !settled) ? blink(t, 4, 4, 1) : 2.2);
        // main-line queue, front to back
        let ahead = null;
        queue.length = 0; for (const p of flow) if (p.lane === 'main') queue.push(p); queue.sort(byX);
        for (const p of queue) {
          const si = secAt(p.x), x0 = p.x, stop = SEC[si].x1 - END_STOP; let nx = p.x + spd[si] * dt;
          const blocked = si === 0 ? spd[1] === 0 : si === 1 ? spd[2] === 0 || !settled || (toB && oneDone) : !dockOpen;
          let crossing = false;
          if (ahead && secAt(ahead.x) === si) nx = Math.min(nx, ahead.x - SPACING);
          else if (ahead) { nx = Math.min(nx, ahead.x - 0.4); crossing = ahead.x - nx < SPACING - 1e-6; } // cross into the next section only with a full gap
          if (si === 2 && x0 > stop) nx = x0 + Math.max(spd[2], INTO) * dt; // past C3's end stop it is already going through the door
          else if ((blocked || crossing) && x0 <= stop) nx = Math.min(nx, stop); // past its end stop it is already on its way over
          p.x = Math.max(p.x, nx);
          if (x0 <= SX && p.x > SX && s.scanner.armed) p.sn = ++ln.scanned;
          if (si === 1 && toB && !oneDone && p.x >= BPATH[0][0]) { p.lane = 'B'; p.b = 0; sent++; if (p.sn) ln.toB.add(p.sn); continue; }
          if (si === 2 && p.x > DOOR_X) { p.lane = 'wait'; ln.docked++; continue; } // into the trailer, out of sight behind the door frame
          ahead = p;
        }
        for (const p of flow) if (p.lane === 'B') { p.b += spd[2] * dt; if (p.b >= BLEN[BLEN.length - 1]) p.lane = 'wait'; }
        // every parcel counted in and the door shut: nothing is left past C1 (only matters when the visitor skipped ahead)
        if (s.dock.parcels >= s.dock.target && s.dock.light !== 'green') for (const p of flow) if (p.lane === 'main' && p.x >= C.c2.x0) p.lane = 'wait';
        let tail = Infinity; for (const p of flow) if (p.lane === 'main') tail = Math.min(tail, p.x);
        if (spd[0] > 0 && !s.plan.feedStop && tail - ENTRY_X >= SPACING) put(tail === Infinity ? ENTRY_X : tail - SPACING); // exactly one gap behind, inside the hatch
        // carts: ease between the parking spot and the loop; hold position once told to stop
        for (const c of CARTS) {
          const st = s[c.id];
          c.blend = approach(c.blend, st.state === 'parked' || st.state === 'parking' ? 0 : 1, dt / 0.9);
          const px = cartAt(st.u, tmp).x;
          if (st.state !== 'stopped') c.group.position.lerpVectors(c.home, tmp, smooth(c.blend));
          const onPath = c.blend > 0.75; // near enough: the transfer follows the cart as it settles
          if (st.load && !c.wasLoaded) load(c, onPath, px);
          if (!st.load && c.wasLoaded) unload(c, onPath, px);
          c.wasLoaded = !!st.load;
          const bad = st.status === 'fault'; setLamp(c.beacon.material, st.status === 'offline' ? null : bad ? RED : driving(st) ? AMBER : GREEN, driving(st) || bad ? blink(t, 4, 4, 1) : 1.5);
        }
        // parcels: belt ↔ deck transfers, then place every mesh
        for (const p of flow) if (p.lane === 'up' || p.lane === 'down') { p.k = Math.min(1, p.k + dt / 0.35); if (p.k >= 1) { if (p.lane === 'up') p.lane = 'cart'; else Object.assign(p, { lane: 'main', x: p.tx, cart: null }); } }
        for (const p of flow) {
          const m = p.mesh; m.visible = p.lane !== 'wait'; m.scale.x = 1;
          if (p.lane === 'main') { // only the part inside the room shows, so a parcel slides out of the hatch and into the trailer
            const lo = Math.max(p.x - p.hw, IN_X), hi = Math.min(p.x + p.hw, OUT_X);
            if (hi - lo < 0.004) m.visible = false; else { m.scale.x = (hi - lo) / (2 * p.hw); m.position.set((lo + hi) / 2, p.y0, LZ); }
          }
          else if (p.lane === 'B') { bAt(p.b, bp); m.position.set(bp[0], p.y0 - bp[2], bp[1]); }
          else if (p.lane === 'cart') { const g = p.cart.group.position; m.position.set(g.x, p.y0 - 0.03, g.z); }
          else if (p.lane === 'up') { const g = p.cart.group.position, e = smooth(p.k); m.position.set(p.fx + (g.x - p.fx) * e, p.y0 - 0.03 * e + 0.07 * Math.sin(Math.PI * e), LZ + (g.z - LZ) * e); }
          else if (p.lane === 'down') { const e = smooth(p.k); m.position.set(p.fx + (p.tx - p.fx) * e, p.fy + (p.y0 - p.fy) * e + 0.07 * Math.sin(Math.PI * e), p.fz + (LZ - p.fz) * e); }
        }
        // scanner: the beam stays on while armed (it keeps logging); amber once its reads are no longer trusted
        const bad = s.scanner.status === 'fault'; scanLine.visible = !!s.scanner.armed;
        scanLine.material.color.set(bad ? 0xFFB020 : 0xFF3030); scanLine.material.emissive.set(bad ? 0xFFA010 : 0xFF2020); scanLine.material.opacity = bad ? 0.45 : 0.5 + 0.3 * Math.abs(Math.sin(t * 6));
      },
    };
  },

  prompts: [
    {
      chip: 'Move today\'s 40 outbound parcels from receiving to dock 2, scanning each one.',
      keywords: ['move', 'parcels', 'outbound', 'dock', 'scanning', 'scan', 'receiving', 'ship', 'boxes', 'orders', '40', 'start', 'restart'],
      avoid: ['close', 'closed', 'shut', 'lock', 'locked'], // routing (js/engine/match.js): "close the dock" never runs a plan that opens it
      rulesOut: ['gate', 'gates'], // "move the gate" is about the sorter gate, not these 40 parcels: it asks back
      expect: { 'c2.status': 'fault', 'dock.parcels': 40, 'agvA.state': 'parked', 'agvB.state': 'parked' },
      steps: [
        { beat: 'plan' },
        { status: 'Line idle · waiting for your approval' },
        { say: 'Three conveyors, a scanner, a gate, two carts and the dock. Here\'s the sequence — nothing moves until you approve it.' },
        { plan: { intro: 'Plan for 40 parcels:', steps: [
          { text: 'Arm the scanner first; every parcel is scanned on C1 or it doesn\'t leave C1' },
          { text: 'Start C1, C2, C3 at 0.5 m/s, in that order, about a second apart' },
          { text: 'Gate stays on lane A (straight through)' },
          // says "open": the room rolls the door up, and routing (match.js) reads it, so "…but keep the dock closed" asks back
          { text: 'Open dock 2 (light green) once the first parcel is on C3; close it (red) when the count hits 40', alt: { text: 'Open dock 2 (light green) now, before parcels arrive; close it (red) when the count hits 40', apply: [{ set: 'plan.earlyGreen', to: true }] } },
          { text: 'Carts A and B stay parked unless a conveyor drops out' },
        ] } },
        { beat: 'run' },
        { fn: ({ store }) => { if (store.get('plan.earlyGreen')) store.set('dock.light', 'green'); } },
        { set: 'scanner.armed', to: true, label: 'Scanner armed' }, { wait: 400 },
        { set: 'c1.running', to: true }, { tween: 'c1.speed', to: 0.5, ms: 800, label: 'C1 → 0.5 m/s' }, { wait: 400 },
        { set: 'c2.running', to: true }, { tween: 'c2.speed', to: 0.5, ms: 800, label: 'C2 → 0.5 m/s' }, { wait: 400 },
        { set: 'c3.running', to: true }, { tween: 'c3.speed', to: 0.5, ms: 800, label: 'C3 → 0.5 m/s' },
        { say: 'Scanner armed. Line running.' },
        // the tiles count what the room does; C2's motor trips as parcel 17 crosses the beam, with 14–16 on C2
        { fn: async (ctx) => {
          const { store, chat } = ctx;
          if (!store.get('plan.earlyGreen')) { await until(ctx, (l) => l.onC3()); store.set('dock.light', 'green'); ctx.status('Dock 2 → open'); }
          let said = false;
          if (await until(ctx, (l) => l.scanned >= 15)) {
            chat.typing(true);
            if (await until(ctx, (l) => l.scanned >= 16)) { chat.typing(false); chat.ncb(`16 scanned, ${store.get('dock.parcels')} at the dock. On pace for 14 minutes.`); said = true; }
            chat.typing(false);
          }
          if (!said) { jump(store, 16); chat.ncb(`16 scanned, ${store.get('dock.parcels')} at the dock. On pace for 14 minutes.`); }
          if (!await until(ctx, (l) => l.scanned >= 17)) jump(store, 17);
          store.set('c2.running', false); store.set('c2.speed', 0);
        } },
        { beat: 'recover' },
        { fn: (ctx) => watch(ctx) }, // after a skip, the tiles follow the room again
        { fail: 'c2', say: 'C2 motor fault at parcel 17. C2 has stopped with 3 parcels on it. C1 and C3 are still running.' },
        { say: 'Re-planning around C2, not stopping the line:' },
        { replan: { intro: 'New routing:', changes: ['C1 keeps feeding to its end stop; scanner still on every parcel', 'Carts A and B shuttle parcels from the end of C1 to C3 — one parcel each, alternating: out along the belt, back on the return lane', 'C3 and the dock continue as before', 'Throughput drops about 40%; new finish estimate 21 minutes', 'C2\'s 3 stranded parcels get picked up by the carts last'], needsYou: 'C2\'s motor needs a look — overload trip or a jammed roller. I won\'t restart it on my own.' } },
        { set: 'agvA.u', to: 0 }, { set: 'agvB.u', to: uBack(HOME.agvB) }, { set: 'agvA.state', to: 'moving' }, { set: 'agvB.state', to: 'moving', label: 'Carts A and B → the line' },
        // 24 cart runs, one parcel each: run 1 as it happens, a time-lapse over runs 2–21 (said so, counts jump to
        // match), then the last three off C1 — the 40th through the scanner is on the last one, and C1 stops behind it
        { fn: async (ctx) => {
          const { store, chat, tween, sleep, status } = ctx;
          const run = async (n, out, back) => {
            status(`Cart run ${n} of 24`);
            store.set(`${out}.load`, true);
            if (n === 24) { store.set('c1.running', false); store.set('c1.speed', 0); }
            const ms = legMs(BACK); // both legs take as long as the longer one, the way back
            await Promise.all([tween(`${out}.u`, 1, ms), tween(`${back}.u`, 2, ms)]);
            store.set(`${out}.load`, false); store.set(`${back}.u`, 0);
          };
          await sleep(900);
          await run(1, 'agvA', 'agvB');
          store.set('plan.feedStop', true); // the last of the 40 are on C1: nothing more comes in from receiving
          const line = lineOf.get(store); if (line) { line.cut(3, 38, 37); sync(store, line); } else { store.set('scanner.count', 38); store.set('dock.parcels', 33); }
          status('Time-lapse · runs 2–21 skipped'); chat.ncb('(Time-lapse: runs 2 to 21 skipped — same routine, one parcel per run.)');
          await sleep(900);
          await run(22, 'agvB', 'agvA'); await run(23, 'agvA', 'agvB'); await run(24, 'agvB', 'agvA');
        } },
        // the ones still on their way down C3 are counted as they go through the door (37 by then; set it if skipped)
        { status: 'C1 done · C3 taking its last parcels to dock 2' },
        { fn: async (ctx) => { await until(ctx, (l) => l.riding() === 0, 12000); const line = lineOf.get(ctx.store); if (line) { line.docked = 37; sync(ctx.store, line); } else ctx.store.set('dock.parcels', 37); } },
        { say: 'All 40 scanned, 37 at the dock. C1 is done and stopped. Now the 3 on C2.' },
        // each trip: drive out to one of C2's parcels, take it, drop it on C3, while the other cart comes back. After the
        // last trips the carts go home along the return lane and turn into their bays (cart A's is past the lane's end):
        // 'parking' while they turn in, 'parked' once the room has them in the bay (at once without a room, or skipped).
        { fn: async (ctx) => {
          const { store, tween, sleep, status } = ctx;
          const park = async (id) => { store.set(`${id}.state`, 'parking'); await until(ctx, (l) => l.inBay(id), 4000); store.set(`${id}.state`, 'parked'); };
          const xs = lineOf.get(store)?.c2() ?? [], at = [0.5, -0.5, -1.5].map((x, i) => xs[i] ?? x); // C2's three, 1 m apart
          const trips = [['agvA', 'agvB'], ['agvB', 'agvA'], ['agvA', 'agvB']];
          for (const [i, [out, back]] of trips.entries()) {
            const last = i === trips.length - 1;
            status(`C2 parcel ${i + 1} of 3 → C3`);
            const ret = last ? tween(`${back}.u`, uBack(HOME[back]), legMs(backTo(HOME[back]))).then(() => park(back))
              : tween(`${back}.u`, 2, legMs(BACK));
            await tween(`${out}.u`, uOut(at[i]), legMs(at[i] - X_PICK));
            store.set(`${out}.load`, true); await sleep(350);
            await tween(`${out}.u`, 1, legMs(X_DROP - at[i]));
            store.set(`${out}.load`, false);
            await ret; if (!last) store.set(`${back}.u`, 0);
          }
          await tween('agvA.u', uBack(X_PICK), legMs(backTo(X_PICK))); await park('agvA'); // from the lane's end, clear of B's bay
        } },
        { status: 'C3 clearing to dock 2' },
        { fn: async (ctx) => { if (!await until(ctx, (l) => l.docked >= 40, 12000)) { const line = lineOf.get(ctx.store); if (line) { line.docked = 40; sync(ctx.store, line); } else ctx.store.set('dock.parcels', 40); } } },
        { set: 'dock.light', to: 'red', label: 'Dock 2 → closed' }, { set: 'c3.running', to: false }, { set: 'c3.speed', to: 0 }, { set: 'scanner.armed', to: false },
        { say: '40 of 40 at dock 2, all scanned. Line stopped, carts parked. C2 is still flagged.' },
        { end: { headline: 'One unit failed. The line didn\'t.', body: 'NeuCharBox re-routed around the fault using what was still working, kept every parcel scanned, and told you the new finish time and what to fix.' } },
      ],
    },
    {
      chip: 'Divert anything scanned as fragile to lane B.',
      keywords: ['divert', 'fragile', 'lane', 'b', 'sort', 'route', 'separate', 'glass'], // not 'gate': "close the gate" or "check the gate" alone isn't this rule
      // routing (js/engine/match.js): other kinds of parcel than fragile ("divert anything heavy") are not this rule, and
      // neither is all of them ("divert everything to lane B", "send every box to lane B"): it diverts fragile ones only
      rulesOut: ['everything', 'every', 'all', 'whole', 'heavy', 'heavier', 'large', 'big', 'bigger', 'oversized', 'bulky', 'damaged', 'liquid', 'liquids', 'urgent', 'express', 'priority', 'perishable', 'frozen'],
      expect: { 'scanner.status': 'fault', 'gate.lane': 'B', 'gate.all': true, 'scanner.misreads': 2 },
      steps: [
        { beat: 'plan' },
        { status: 'Line idle · waiting for your approval' },
        { say: 'The scanner reads the label; the gate does the diverting. The important part is what happens when the scanner can\'t read a label.' },
        { plan: { intro: 'Plan:', steps: [
          { text: 'Open dock 2, arm the scanner, start the line' },
          { text: 'Label says FRAGILE → gate to lane B for that parcel, back to A after it passes' },
          { text: 'Label unreadable → treat it as fragile: lane B for a human check', alt: { text: 'Label unreadable → stop C1 and wait for a person', apply: [{ set: 'plan.stopOnMisread', to: true }] } },
          { text: 'If more than 1 in 10 labels are unreadable, stop trusting the scanner and tell you' },
        ] } },
        { beat: 'run' },
        { set: 'dock.light', to: 'green' }, { set: 'scanner.armed', to: true }, { set: 'c1.running', to: true }, { set: 'c1.speed', to: 0.5 }, { set: 'c2.running', to: true }, { set: 'c2.speed', to: 0.5 }, { set: 'c3.running', to: true }, { set: 'c3.speed', to: 0.5, label: 'Dock 2 open, scanner armed, line running' },
        { fn: (ctx) => watch(ctx) }, // the scanner and dock tiles count the parcels as they cross the beam and the door
        { say: 'Line running. Reading every label.' },
        // parcel 10's label says FRAGILE: the gate takes lane B as that parcel comes up to it, and goes back after it
        { fn: async (ctx) => {
          if (!await until(ctx, (l) => l.scanned >= 10)) jump(ctx.store, 10);
          ctx.chat.ncb('Parcel 10 — FRAGILE. Gate to lane B for it.');
          await divert(ctx, 10);
        } },
        // parcel 15 can't be read, and neither can 17: the rule you approved decides
        { fn: async (ctx) => {
          const { store, chat } = ctx;
          if (!await until(ctx, (l) => l.scanned >= 15)) jump(store, 15);
          store.set('scanner.misreads', 1);
          if (store.get('plan.stopOnMisread')) { store.set('c1.running', false); store.set('c1.speed', 0); return; } // handled below: parcel 15 stays on C1
          chat.ncb('Parcel 15 — label unreadable. Treating it as fragile: lane B.'); ctx.status('Parcel 15 unreadable · lane B at the gate');
          if (!await until(ctx, (l) => l.scanned >= 17)) jump(store, 17);
          store.set('scanner.misreads', 2);
        } },
        { beat: 'recover' },
        { fn: async (ctx) => {
          const { store, chat, tween, sleep, status } = ctx;
          watch(ctx);
          if (store.get('plan.stopOnMisread')) {
            chat.alert('Parcel 15\'s label is unreadable. C1 is stopped, as you chose — parcel 15 stays on C1 until a person reads it.');
            status('C1 held · parcel 15 needs a person');
            await sleep(600); return;
          }
          store.set('scanner.status', 'fault');
          chat.alert('Parcels 15 and 17 were unreadable — 2 in the last 10. That\'s over the 1-in-10 line you set.');
          await sleep(600);
          // the hold starts as parcel 15, the first unreadable one, comes up to the gate, so 15 is the first to go down lane
          // B and 14, already past C2's end stop, goes on to the dock however the frames fell (without a room: the counts)
          if (!await until(ctx, (l) => { const p = l.find(15); return !p || p.lane !== 'main' || p.x >= GATE_CALL_X; }, 15000)) jump(store, 17, 0.71);
          chat.ncb('I\'ve stopped trusting the scanner as a sorter. Every parcel goes to lane B for a human check until it\'s fixed — that\'s the safe direction, not the fast one.');
          store.set('gate.all', true); store.set('gate.lane', 'B'); status('Gate held on lane B · every parcel'); await tween('gate.pos', 1, 700);
        } },
        { fn: async ({ store, chat, sleep }) => {
          const held = store.get('plan.stopOnMisread');
          Object.assign(DIVERT_END, held ? DIVERT_HELD : DIVERT_SAFE);
          chat.replan(held
            ? { intro: 'Held until you look:', changes: ['C1 stopped with parcel 15 on it — nothing leaves C1 unread', 'C2 and C3 finish what\'s already on them; gate stays on lane A', 'Scanner still armed: 15 scanned, 1 unreadable'], needsYou: 'Read parcel 15\'s label by hand, then tell me to restart C1.' }
            : { intro: 'Until the scanner is checked:', changes: ['Gate held on lane B — nothing unverified goes to the dock', 'Scanner still logging, but its reads don\'t drive the gate', 'Line speed unchanged; lane B tote will fill in about 12 minutes'], needsYou: 'Two unreadable labels in ten usually means a dirty lens or a misprinted label batch. Check the arch; I\'ll go back to sorting when reads are clean for 20 parcels.' });
          await sleep(700);
        } },
        { end: DIVERT_END },
      ],
    },
    {
      chip: 'Stop everything, safely, now.',
      keywords: ['stop', 'everything', 'safely', 'now', 'halt', 'emergency', 'e-stop', 'estop', 'freeze', 'pause', 'kill', 'shut', 'turn off', 'switch off', 'power', 'abort'],
      // routing: asking for the opposite of a stop ("turn everything on", "unlock everything", "resume") never runs one
      avoid: ['turn on', 'switch on', 'power up', 'start', 'restart', 'resume', 'restore', 'unlock', 'unlocked', 'unfreeze', 'unpause', 'release'],
      // routing (js/engine/match.js): what the fn steps below do, as plan lines, so "stop everything except the carts"
      // or "…but not the scanner" asks back instead of braking the carts and disarming the scanner. NCB quotes the line
      // it conflicts with ('…its plan includes "Scanner disarmed"…'), so keep these worded like the stop's own steps.
      touches: ['Carts A and B stop where they are, brakes on', 'Conveyors and the line stop: C1, C2 and C3 ramp down together', 'Scanner disarmed', 'Dock 2 closed, light red'],
      expect: { 'c1.running': false, 'c2.running': false, 'c3.running': false, 'scanner.armed': false, 'dock.light': 'red', 'agvA.state': 'stopped', 'agvB.status': 'fault' }, // locked: cart B still flagged
      steps: [
        { beat: 'plan' },
        // the request arrives mid-shift: the room cuts straight to a running line (nothing starts up in view) and the
        // chat says so first. Cart A is carrying a parcel toward C3; cart B is heading back along the return lane.
        { fn: (ctx) => {
          const { store, chat, tween } = ctx;
          for (const k of ['c1', 'c2', 'c3']) { store.set(`${k}.running`, true); store.set(`${k}.speed`, 0.5); }
          store.set('scanner.armed', true); store.set('dock.light', 'green');
          store.set('agvA.u', 0.7); store.set('agvA.load', true); store.set('agvA.state', 'moving');
          store.set('agvB.u', uBack(-0.9)); store.set('agvB.state', 'moving');
          const line = lineOf.get(store); if (line) { line.midShift(26); sync(store, line); watch(ctx, line); } else { store.set('scanner.count', 26); store.set('dock.parcels', 16); }
          chat.ncb('(It\'s mid-shift: belts running at 0.5 m/s, dock 2 open, both carts out.)');
          ctx.status('Mid-shift · belts at 0.5 m/s, dock 2 open, both carts out');
          // until the stop reaches them: A goes on toward C3, B comes to rest on the return lane beside C2
          tween('agvA.u', 0.85, 1500); tween('agvB.u', uBack(-1.6), 1300);
        } },
        // the stop comes in 0.7 s into this; a skip past it lays the line out where 0.7 s of running leaves it
        // (parcel 26 another 0.77 m on), so the stop ends where it does when played: 28 scanned, 18 docked
        { fn: async (ctx) => { await ctx.sleep(700); if (ctx.fast) jump(ctx.store, 26, 0.82); } },
        { beat: 'run' },
        // a stop doesn't wait on typing: each action goes out as soon as the one before it is done, and the chat logs it
        { fn: async (ctx) => {
          const { store, chat, tween, sleep, status } = ctx;
          watch(ctx); // after a skip into this beat, the tiles follow the room again
          chat.ncb('Stopping now. A stop doesn\'t wait for approval — but it does go in a set order, meant to keep carts and parcels from colliding or dropping:');
          lineOf.get(store)?.snap('agvA', 0.765); // cart A stops where the stop finds it when played, after a skip too
          status('1 · carts'); store.set('agvA.state', 'stopped'); chat.ncb('1 — Carts: stop where they are, brakes on.');
          await sleep(300);
          status('2 · conveyors'); chat.ncb('2 — Conveyors ramp down C1, C2, C3 together, 2 seconds, so nothing pushes into a stopped belt.');
          await Promise.all(['c1', 'c2', 'c3'].map((k) => tween(`${k}.speed`, 0, 2000)));
          for (const k of ['c1', 'c2', 'c3']) store.set(`${k}.running`, false);
          if (ctx.fast) jump(store, 28, 0.25); // skipped: the line where the stop leaves it when played (28 scanned, 18 docked)
          status('3 · scanner'); store.set('scanner.armed', false); chat.ncb('3 — Scanner disarmed, now that nothing is moving through it.');
          await sleep(300);
          status('4 · dock'); store.set('dock.light', 'red'); chat.ncb('4 — Dock 2 closed, light red.');
          await sleep(900);
        } },
        { beat: 'recover' },
        { fn: (ctx) => watch(ctx) },
        { fail: 'agvB', say: 'Everything acknowledged the stop except cart B. Its last reported position is on the return lane beside C2. It may be stopped; I can\'t confirm it.' },
        { say: 'I won\'t say "all stopped" when one thing hasn\'t said so. Here\'s the state, honestly:' },
        { replan: { intro: 'Stop status:', changes: ['C1, C2, C3: stopped and confirmed by their encoders', 'Cart A: stopped, brakes on, confirmed', 'Cart B: stop sent, no acknowledgement — treat it as moving until seen', 'Restart is locked until cart B is confirmed'], needsYou: 'Eyes on cart B, please — on the return lane beside C2. Then tell me it\'s stopped and I\'ll unlock.' } },
        // the safe default comes first and is the only highlighted option: a beat skip would pick it, never the human
        // confirmation. The intro reads with either answer.
        { ask: { intro: 'Cart B still hasn\'t confirmed. Your call:', options: [
          { label: 'Keep everything locked', primary: true, apply: [{ status: 'Locked · cart B not confirmed' }, { say: 'Locked. Cart B stays flagged, and restart stays locked until cart B answers or you confirm it\'s stopped.' }] },
          { label: 'Cart B is stopped — confirmed by me', apply: [{ set: 'agvB.status', to: 'online' }, { set: 'agvB.state', to: 'stopped' }, { status: 'All stopped · cart B confirmed by you' }, { say: 'Logged: cart B confirmed stopped by you, on the return lane beside C2. Everything is stopped. Restart is unlocked, but nothing restarts until you say.' }, { set: 'plan.confirmed', to: true }] },
        ] } },
        { end: { headline: 'A stop with an honest status.', body: 'NeuCharBox stopped the line in a safe order, and when one cart didn\'t confirm, it said so instead of declaring "all stopped". That distinction is the whole product.' } },
      ],
    },
  ],
};
