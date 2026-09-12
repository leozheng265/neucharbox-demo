// Scene 4 — Warehouse (illustrative). Proves: coordination that re-routes when a unit drops out.

// Cart loop in front of the line, shared by the room and the scripts. u = 0 is alongside the end of C1 (pick-up),
// u = 1 alongside C3 (drop-off); 1 < u < 2 is the way back on the return lane, and u = 2 is u = 0 again.
// Carts only pass each other on different lanes, so they never drive through one another.
const X_PICK = -2.35, X_DROP = 2.6, Z_IN = 1.18, Z_OUT = 1.95;
const SHIFT = Z_OUT - Z_IN, RUN = X_DROP - X_PICK, BACK = RUN + 2 * SHIFT;
const uOut = (x) => (x - X_PICK) / RUN;                 // u of a spot on the belt-side lane
const uBack = (x) => 1 + (SHIFT + X_DROP - x) / BACK;   // u of a spot on the return lane
function cartAt(u, v) {
  if (u <= 1) return v.set(X_PICK + RUN * Math.max(0, u), 0, Z_IN);
  const s = (Math.min(u, 2) - 1) * BACK;
  if (s < SHIFT) return v.set(X_DROP, 0, Z_IN + s);
  if (s < SHIFT + RUN) return v.set(X_DROP - (s - SHIFT), 0, Z_OUT);
  return v.set(X_PICK, 0, Z_OUT - (s - SHIFT - RUN));
}
// The Divert prompt's end card depends on the Edit the visitor chose; the step before `end` fills it in.
const DIVERT_SAFE = { headline: 'It stopped trusting the sensor before you had to.', body: 'A rule you approved decided what happens when the scanner\'s word isn\'t good enough. NeuCharBox took the safe option, not the fast one, and told you what to check.' };
const DIVERT_HELD = { headline: 'It held the parcel instead of guessing.', body: 'You chose to stop on an unreadable label. NeuCharBox stopped C1 at the first one, let C2 and C3 finish, and told you exactly which parcel needs a person.' };
const DIVERT_END = { ...DIVERT_SAFE };
const ridingOf = new WeakMap(); // store → () => parcels still on their way down C3 (set by build(); none when headless)

export default {
  id: 'warehouse',
  title: 'Warehouse',
  startHour: 10,
  // Seen from outside the (cut-away) front wall, three-quarter from the left, so the whole line fits: hub desk,
  // receiving, scanner, gate and lane B, the carts, C3 and the dock door with its light.
  camera: { position: [-5.07, 3.8, 8.46], target: [-0.5, 0.8, 1.0], minDistance: 3, maxDistance: 12, azimuth: [-0.66, -0.45], fov: 50, fitAspect: 1.3 },
  setupIntro: 'A small outbound line — an illustrative setup, not a specific site. Three conveyor sections, a scanner arch, a sorter gate to lane B, two carts, and dock 2. The hub is on the desk. Plug it in to start.',
  askIntro: 'Give the line an instruction. Pick one, or type your own.',
  deviceOrder: ['c1', 'c2', 'c3', 'scanner', 'gate', 'agvA', 'agvB', 'dock'],
  devices: {
    c1:      { icon: 'conveyor', name: 'Conveyor C1', initial: { running: false, speed: 0 }, format: (s) => (s.running ? `running · ${s.speed.toFixed(1)} m/s` : 'stopped'), faultText: 'motor fault' },
    c2:      { icon: 'conveyor', name: 'Conveyor C2', initial: { running: false, speed: 0 }, format: (s) => (s.running ? `running · ${s.speed.toFixed(1)} m/s` : 'stopped'), faultText: 'motor fault' },
    c3:      { icon: 'conveyor', name: 'Conveyor C3', initial: { running: false, speed: 0 }, format: (s) => (s.running ? `running · ${s.speed.toFixed(1)} m/s` : 'stopped'), faultText: 'motor fault' },
    scanner: { icon: 'scanner', name: 'Scanner arch', initial: { armed: false, count: 0, misreads: 0 }, format: (s) => (s.armed ? `armed · ${Math.round(s.count)} scanned${s.misreads ? ` · ${Math.round(s.misreads)} unreadable` : ''}` : 'idle'), faultText: 'reads not trusted' },
    gate:    { icon: 'gate', name: 'Sorter gate', initial: { lane: 'A', pos: 0, all: false }, format: (s) => `→ lane ${s.lane}${s.lane === 'B' && s.all ? ' · every parcel' : ''}`, faultText: 'jammed' },
    agvA:    { icon: 'cart', name: 'Cart A', initial: { state: 'parked', u: 0, load: false }, format: (s) => (s.state === 'parked' ? 'parked' : s.state === 'moving' ? (s.load ? 'moving · loaded' : 'moving · empty') : s.state), faultText: 'no acknowledgement' },
    agvB:    { icon: 'cart', name: 'Cart B', initial: { state: 'parked', u: 0, load: false }, format: (s) => (s.state === 'parked' ? 'parked' : s.state === 'moving' ? (s.load ? 'moving · loaded' : 'moving · empty') : s.state), faultText: 'no acknowledgement' },
    dock:    { icon: 'dock', name: 'Dock 2', initial: { light: 'red', parcels: 0, target: 40 }, format: (s) => `${s.light === 'green' ? 'open' : 'closed'} · ${Math.round(s.parcels)}/${s.target} parcels`, faultText: 'door fault' },
  },

  build({ R, P, M, THREE, store, parts, speed = 1 }) {
    const concreteC = parts.concreteTex();
    const concrete = new THREE.MeshStandardMaterial({ map: parts.tex(concreteC, [4, 3]), roughness: 0.85 });
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xB9BDBB, roughness: 0.95 });
    P.roomShell({ w: 14, d: 10, h: 5, floorMat: concrete, wallMat, skirting: false });
    // yard around the building: the default view is from outside the cut-away front wall, so the ground never ends in view
    const yard = new THREE.Mesh(new THREE.PlaneGeometry(40, 34), new THREE.MeshStandardMaterial({ map: parts.tex(concreteC, [11, 10]), color: 0x9EA3A3, roughness: 0.95 })); yard.rotation.x = -Math.PI / 2; yard.position.set(0, -0.012, 6); yard.receiveShadow = true; R.scene.add(yard);
    R.lights.sun.intensity = 0; R.lights.sun.castShadow = false; R.lights.hemi.intensity = 0.45; R.lights.fill.intensity = 0.25; R.scene.background = new THREE.Color(0xA8B0B4);
    for (const x of [-4, 0, 4]) for (const z of [-3, 1]) { const l = new THREE.PointLight(0xF4F1E8, 9, 16, 1.5); l.position.set(x, 4.8, z); if (x === 0 && z === 1) { l.castShadow = true; l.shadow.mapSize.set(2048, 2048); l.shadow.bias = -0.001; } R.scene.add(l); P.box(1.2, 0.05, 0.3, M.white, x, 4.974, z).material = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.5 }); }
    // floor markings: line zone boundaries, and a dashed divider between the carts' belt-side lane and return lane
    const line = new THREE.MeshStandardMaterial({ color: 0xE4B53A, roughness: 0.9 }), dash = new THREE.MeshStandardMaterial({ color: 0xE9E7E0, roughness: 0.9 });
    const paint = (w, d, mat, x, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.004, z); m.receiveShadow = true; R.scene.add(m); };
    for (const z of [-2.9, 2.4]) paint(12, 0.08, line, 0, z);
    for (let x = X_PICK + 0.15; x < X_DROP - 0.1; x += 0.6) paint(0.3, 0.05, dash, x, (Z_IN + Z_OUT) / 2);
    // racks along the back wall with pallets; pallets rest on the floor or a shelf, cartons rest on their pallet
    for (let r = 0; r < 4; r++) { const x = -5.2 + r * 2.6; for (const dx of [-1.1, 1.1]) { P.box(0.08, 4.2, 0.08, M.steel, x + dx, 2.1, -4.7); P.box(0.08, 4.2, 0.08, M.steel, x + dx, 2.1, -3.7); } for (const y of [0.9, 2.2, 3.5]) { P.box(2.3, 0.06, 1.1, M.steel, x, y, -4.2); } for (const y of [0.0, 0.93, 2.23]) for (const dx of [-0.55, 0.55]) { if (Math.random() < 0.8) { const h = 0.45 + Math.random() * 0.3; P.box(0.9, 0.1, 0.9, M.woodLight, x + dx, y + 0.05, -4.2); P.box(0.8, h, 0.8, M.cardboard, x + dx, y + 0.1 + h / 2, -4.2, 0.01); } } }

    // dock 2 on the right wall: a roll-up door that opens while the dock light is green, drum housing with the light on top
    const door = P.box(0.06, 3.2, 3.0, new THREE.MeshStandardMaterial({ color: 0x6E7478, roughness: 0.7, metalness: 0.4 }), 6.96, 1.6, 0.6);
    const slats = []; for (let i = 0; i < 8; i++) slats.push(P.box(0.02, 0.02, 3.0, M.black, 6.92, 0.4 + i * 0.4, 0.6));
    P.box(0.01, 3.18, 2.98, new THREE.MeshStandardMaterial({ color: 0x15181B, roughness: 1 }), 6.98, 1.59, 0.6); // trailer interior behind the door
    const dockHousing = P.box(0.24, 0.26, 3.1, M.steel, 6.878, 3.33, 0.6);
    const dockLight = P.beacon(6.88, 3.47, 0.6);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.3), new THREE.MeshStandardMaterial({ map: parts.labelTex('DOCK 2', { bg: '#E4B53A', fg: '#1A1C1E', size: 56, w: 256, h: 96 }), roughness: 0.7 })); sign.rotation.y = -Math.PI / 2; sign.position.set(6.99, 3.95, 0.6); R.scene.add(sign);
    P.box(0.3, 0.3, 0.4, M.rubber, 6.848, 0.2, -1.1); P.box(0.3, 0.3, 0.4, M.rubber, 6.848, 0.2, 2.3);

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
    const SX = -2.7;
    for (const z of [LZ - 0.33, LZ + 0.33]) P.box(0.05, 0.75, 0.05, M.steel, SX, beltY + 0.425, z);
    P.box(0.05, 0.05, 0.71, M.steel, SX, 1.625, LZ); const scanHead = P.box(0.12, 0.1, 0.16, M.black, SX, 1.55, LZ, 0.01);
    const scanLine = new THREE.Mesh(new THREE.PlaneGeometry(0.012, 0.6), new THREE.MeshStandardMaterial({ color: 0xFF3030, emissive: 0xFF2020, emissiveIntensity: 5, transparent: true, opacity: 0.7, side: THREE.DoubleSide })); scanLine.rotation.z = Math.PI / 2; scanLine.rotation.y = Math.PI / 2; scanLine.position.set(SX, beltY + 0.04, LZ); R.scene.add(scanLine);
    // sorter gate: an arm hinged on the front rail at the C2 → C3 junction; it swings back across the belt to push parcels into lane B
    const gatePivot = new THREE.Group(); gatePivot.position.set(1.0, beltY + 0.12, LZ + 0.33); R.scene.add(gatePivot);
    const gateArm = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.03), M.yellow); gateArm.position.x = 0.35; gateArm.castShadow = true; gatePivot.add(gateArm);
    const hinge = P.cyl(0.03, 0.03, 0.2, M.steel, 1.0, beltY + 0.15, LZ + 0.33, 12);

    // Parcels flow along the whole line as one queue: each advances at its section's speed, keeps SPACING to the one
    // ahead, and waits at the end of its section when the next one is dead, the gate is swinging, or the dock is shut.
    // Delivered parcels re-enter from receiving. Diverted parcels slide along the gate arm, ride lane B and drop into the tote.
    const SEC = [C.c1, C.c2, C.c3], SPACING = 1.0, END_STOP = 0.22, ENTRY_X = -4.8, SPEED_K = 2.2, ON_LINE = 12;
    const secAt = (x) => (x < C.c1.x1 ? 0 : x < C.c2.x1 ? 1 : 2);
    const flow = []; for (let i = 0; i < 15; i++) { const mesh = P.parcel(0, beltY + 0.03, LZ, 0.26 + (i % 3) * 0.04); flow.push({ mesh, y0: mesh.position.y }); }
    const BPATH = [[0.962, LZ], [1.251, 0.136], [1.3, -0.25], [1.3, LB1], [1.3, -2.3]]; // x, z
    const BLEN = []; { let acc = 0; BLEN.push(0); for (let i = 1; i < BPATH.length; i++) { acc += Math.hypot(BPATH[i][0] - BPATH[i - 1][0], BPATH[i][1] - BPATH[i - 1][1]); BLEN.push(acc); } }
    // x, z and drop along lane B into `out`. Off the belt end the parcel falls into the tote and is below its fill
    // for the last quarter of the way, so it is out of sight before it is recycled.
    const bAt = (b, out) => { let i = 1; while (i < BPATH.length - 1 && b > BLEN[i]) i++; const k = Math.min(1, Math.max(0, (b - BLEN[i - 1]) / (BLEN[i] - BLEN[i - 1]))); out[0] = BPATH[i - 1][0] + (BPATH[i][0] - BPATH[i - 1][0]) * k; out[1] = BPATH[i - 1][1] + (BPATH[i][1] - BPATH[i - 1][1]) * k; out[2] = i === BPATH.length - 1 ? 0.62 * Math.min(1, k / 0.75) ** 2 : 0; return out; };
    function initFlow() { flow.forEach((p, i) => Object.assign(p, { lane: i < ON_LINE ? 'main' : 'wait', x: ENTRY_X + i * SPACING, b: 0, k: 0, cart: null })); }
    initFlow();
    ridingOf.set(store, () => flow.filter((p) => (p.lane === 'main' && p.x >= C.c3.x0) || p.lane === 'down' || (p.lane === 'cart' && p.cart.group.position.x > C.c3.x0)).length);

    // carts: lift AGVs whose deck sits at belt height, so a parcel moves belt → deck → belt on one level
    function cart(id, x, z) { const g = new THREE.Group(); g.position.set(x, 0, z); R.scene.add(g); const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.22, 0.6), M.steel); body.position.y = 0.2; body.castShadow = true; g.add(body); const colH = beltY - 0.35; const col = new THREE.Mesh(new THREE.BoxGeometry(0.5, colH, 0.4), M.black); col.position.y = 0.31 + colH / 2; col.castShadow = true; g.add(col); const deck = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.03, 0.56), M.steel); deck.position.y = beltY - 0.015; deck.castShadow = true; g.add(deck); for (const dz of [-0.29, 0.29]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.05, 0.02), M.yellow); r.position.set(0, beltY + 0.025, dz); g.add(r); } for (const [dx, dz] of [[-0.3, -0.25], [0.3, -0.25], [-0.3, 0.25], [0.3, 0.25]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 16), M.rubber); w.rotation.x = Math.PI / 2; w.position.set(dx, 0.08, dz); g.add(w); } const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.06, 12), new THREE.MeshStandardMaterial({ color: 0x2FBF71, emissive: 0x2FBF71, emissiveIntensity: 1.5 })); beacon.position.set(-0.4, beltY + 0.03, 0.24); g.add(beacon); return { id, group: g, body, beacon, home: new THREE.Vector3(x, 0, z), blend: 0, wasLoaded: false }; }
    const A = cart('agvA', -3.0, 2.85), B = cart('agvB', -1.4, 2.85);

    // desk with the hub, a phone and a screen on a stand
    const DX = -4.4, DZ = 2.9;
    P.table(DX, DZ, 1.2, 0.6, 0.75, M.woodLight, M.steel); const hub = P.hub(DX - 0.2, 0.77, DZ, { rotY: 0.4 }); R.addPickable(hub.group, 'hub'); P.phone(DX + 0.2, 0.775, DZ + 0.1, 0.3);
    P.cyl(0.08, 0.08, 0.01, M.black, DX + 0.1, 0.775, DZ - 0.2, 20); P.cyl(0.02, 0.025, 0.07, M.black, DX + 0.1, 0.805, DZ - 0.2, 12); P.box(0.5, 0.32, 0.03, M.black, DX + 0.1, 1.0, DZ - 0.2, 0.01);
    P.box(0.5, 0.5, 0.5, M.cardboard, -6.2, 0.25, 1.5, 0.01); P.box(0.5, 0.45, 0.5, M.cardboard, -6.2, 0.725, 1.5, 0.01);

    for (const k of ['c1', 'c2', 'c3']) { R.addPickable(C[k].beltMesh, k); R.addPickable(C[k].motor, k); }
    R.addPickable(scanHead, 'scanner'); R.addPickable(gatePivot, 'gate'); R.addPickable(hinge, 'gate'); R.addPickable(A.group, 'agvA'); R.addPickable(B.group, 'agvB'); R.addPickable(door, 'dock'); R.addPickable(dockHousing, 'dock'); R.addPickable(dockLight, 'dock');
    const hi = P.highlighter({ c1: [C.c1.beltMesh, C.c1.motor], c2: [C.c2.beltMesh, C.c2.motor], c3: [C.c3.beltMesh, C.c3.motor], scanner: [scanHead], gate: [gateArm], agvA: [A.body], agvB: [B.body], dock: [door, dockHousing] });

    const approach = (v, to, step) => v + Math.max(-step, Math.min(step, to - v));
    const smooth = (k) => k * k * (3 - 2 * k);
    const tmp = new THREE.Vector3(), KEYS = ['c1', 'c2', 'c3'], CARTS = [A, B], spd = [0, 0, 0], queue = [], bp = [0, 0, 0], byX = (a, b) => b.x - a.x; // reused every frame
    let lastT = null, gateVis = 0, doorVis = 0, sent = 0; // sent: parcels diverted since the gate was last told to go to B

    function load(c, onPath, cx) {
      // at the end of C1: the scanned parcel at the end stop; alongside C2: the most downstream parcel within reach
      const zone = cx < C.c1.x1 ? (p) => p.x > SX && p.x <= C.c1.x1 : (p) => p.x >= C.c2.x0 && p.x < C.c2.x1 && Math.abs(p.x - cx) <= 1.0;
      const q = onPath ? flow.filter((p) => p.lane === 'main' && zone(p)).sort((a, b) => b.x - a.x)[0] : null;
      if (q) Object.assign(q, { lane: 'up', k: 0, cart: c, fx: q.x });
      else { const w = flow.find((p) => p.lane === 'wait'); if (w) Object.assign(w, { lane: 'cart', cart: c }); } // already loaded when the scene starts mid-shift
    }
    function unload(c, onPath, cx) {
      const q = flow.find((p) => p.cart === c && (p.lane === 'cart' || p.lane === 'up')); if (!q) return;
      if (onPath && cx > C.c3.x0 + 0.2) Object.assign(q, { lane: 'down', k: 0, fx: q.mesh.position.x, fy: q.mesh.position.y, fz: q.mesh.position.z, tx: cx });
      else Object.assign(q, { lane: 'wait', cart: null });
    }

    return {
      focus: hi.focus,
      reset() { initFlow(); for (const c of [A, B]) { c.blend = 0; c.wasLoaded = false; c.group.position.copy(c.home); } gateVis = 0; doorVis = 0; sent = 0; lastT = null; },
      update(s, t) {
        hi.update();
        const dt = (lastT == null ? 0 : Math.min(0.05, Math.max(0, t - lastT))) * speed; lastT = t; // belts follow ?speed= like the script
        hub.ledMat.emissiveIntensity = s.hub.status === 'on' ? (2.5 + Math.sin(t * 2.2) * 1.5) * s.hub.led : 0;
        for (let i = 0; i < 3; i++) { const st = s[KEYS[i]]; spd[i] = st.status === 'fault' || !st.running ? 0 : st.speed * SPEED_K; }
        // conveyor beacons
        for (const k of KEYS) { const c = C[k], st = s[k]; const bad = st.status === 'fault'; c.led.material.color.set(bad ? 0xE0563A : st.running && st.speed > 0.05 ? 0x3AB7FF : 0x2FBF71); c.led.material.emissive.copy(c.led.material.color); c.led.material.emissiveIntensity = bad ? (Math.floor(t * 3) % 2 ? 6 : 0.6) : st.running ? 2.5 : 1.2; c.led.visible = st.status !== 'offline'; }
        // dock: the door rolls up while the light is green; parcels only go through a door that is open
        doorVis = approach(doorVis, s.dock.light === 'green' ? 1 : 0, dt / 1.2);
        const lift = 0.9 * smooth(doorVis); door.scale.y = 1 - lift; door.position.y = 3.2 - 1.6 * (1 - lift); for (const m of slats) m.visible = m.position.y > 3.2 * lift + 0.02;
        const dockOpen = s.dock.light === 'green' && doorVis > 0.6;
        dockLight.material.color.set(s.dock.light === 'green' ? 0x2FBF71 : 0xE0563A); dockLight.material.emissive.copy(dockLight.material.color);
        // gate: swings only through a gap (nothing at the start of C3), and holds C2's parcels while it moves
        const gTo = s.gate.pos;
        let zoneBusy = false; for (const p of flow) if (p.lane === 'main' && p.x >= C.c3.x0 - 0.02 && p.x < C.c3.x0 + 0.8) { zoneBusy = true; break; }
        if (!(gTo > gateVis && gateVis < 0.02 && zoneBusy)) gateVis = approach(gateVis, gTo, dt * 2.2);
        gatePivot.rotation.y = gateVis * 0.9;
        const settled = Math.abs(gateVis - gTo) < 0.03 && (gTo < 0.03 || gTo > 0.97), toB = settled && gTo > 0.5;
        if (s.gate.lane !== 'B') sent = 0;
        const oneDone = !s.gate.all && sent >= 1; // a per-parcel swing takes one parcel; the rest wait for the gate to come back
        // main-line queue, front to back
        let ahead = null;
        queue.length = 0; for (const p of flow) if (p.lane === 'main') queue.push(p); queue.sort(byX);
        for (const p of queue) {
          const si = secAt(p.x); let nx = p.x + spd[si] * dt;
          let blocked = si === 0 ? spd[1] === 0 : si === 1 ? spd[2] === 0 || !settled || (toB && oneDone) : !dockOpen;
          if (ahead && secAt(ahead.x) === si) nx = Math.min(nx, ahead.x - SPACING);
          else if (ahead) { nx = Math.min(nx, ahead.x - 0.4); if (ahead.x - nx < SPACING - 1e-6) blocked = true; } // cross into the next section only with a full gap
          if (blocked) nx = Math.min(nx, SEC[si].x1 - END_STOP);
          p.x = Math.max(p.x, nx);
          if (si === 1 && toB && !oneDone && p.x >= BPATH[0][0]) { p.lane = 'B'; p.b = 0; sent++; continue; }
          if (si === 2 && p.x > C.c3.x1 - 0.12) { p.lane = 'wait'; continue; } // into the trailer; re-enters from receiving
          ahead = p;
        }
        for (const p of flow) if (p.lane === 'B') { p.b += spd[2] * dt; if (p.b >= BLEN[BLEN.length - 1]) p.lane = 'wait'; }
        // every parcel counted in and the door shut: nothing is left past C1 (only matters when the visitor skipped ahead)
        if (s.dock.parcels >= s.dock.target && s.dock.light !== 'green') for (const p of flow) if (p.lane === 'main' && p.x >= C.c2.x0) p.lane = 'wait';
        let tail = Infinity; for (const p of flow) if (p.lane === 'main') tail = Math.min(tail, p.x);
        if (spd[0] > 0 && !s.plan.feedStop && tail - ENTRY_X >= SPACING) { const w = flow.find((p) => p.lane === 'wait'); if (w) Object.assign(w, { lane: 'main', x: tail === Infinity ? ENTRY_X : tail - SPACING }); } // exactly one gap behind, whatever the frame rate
        // carts: ease between the parking spot and the loop; hold position once told to stop
        for (const c of CARTS) {
          const st = s[c.id];
          c.blend = approach(c.blend, st.state === 'parked' ? 0 : 1, dt / 0.9);
          const px = cartAt(st.u, tmp).x;
          if (st.state !== 'stopped') c.group.position.lerpVectors(c.home, tmp, smooth(c.blend));
          const onPath = c.blend > 0.75; // near enough: the transfer follows the cart as it settles
          if (st.load && !c.wasLoaded) load(c, onPath, px);
          if (!st.load && c.wasLoaded) unload(c, onPath, px);
          c.wasLoaded = !!st.load;
          const bad = st.status === 'fault'; c.beacon.material.color.set(bad ? 0xE0563A : st.state === 'moving' ? 0xFFB020 : 0x2FBF71); c.beacon.material.emissive.copy(c.beacon.material.color); c.beacon.material.emissiveIntensity = st.state === 'moving' || bad ? (Math.floor(t * 4) % 2 ? 4 : 1) : 1.5;
        }
        // parcels: belt ↔ deck transfers, then place every mesh
        for (const p of flow) if (p.lane === 'up' || p.lane === 'down') { p.k = Math.min(1, p.k + dt / 0.35); if (p.k >= 1) { if (p.lane === 'up') p.lane = 'cart'; else Object.assign(p, { lane: 'main', x: p.tx, cart: null }); } }
        for (const p of flow) {
          const m = p.mesh; m.visible = p.lane !== 'wait';
          if (p.lane === 'main') m.position.set(p.x, p.y0, LZ);
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
      expect: { 'c2.status': 'fault', 'dock.parcels': 40, 'agvA.state': 'parked', 'agvB.state': 'parked' },
      steps: [
        { beat: 'plan' },
        { say: 'Three conveyors, a scanner, a gate, two carts and the dock. Here\'s the sequence — nothing moves until you approve it.' },
        { plan: { intro: 'Plan for 40 parcels:', steps: [
          { text: 'Arm the scanner first; every parcel is scanned on C1 or it doesn\'t leave C1' },
          { text: 'Start C1, C2, C3 at 0.5 m/s, in that order, about a second apart' },
          { text: 'Gate stays on lane A (straight through)' },
          { text: 'Dock 2 light green once the first parcel is on C3; red again when the count hits 40', alt: { text: 'Dock 2 light green now, before parcels arrive', apply: [{ set: 'plan.earlyGreen', to: true }] } },
          { text: 'Carts A and B stay parked unless a conveyor drops out' },
        ] } },
        { beat: 'run' },
        { fn: ({ store }) => { if (store.get('plan.earlyGreen')) store.set('dock.light', 'green'); } },
        { set: 'scanner.armed', to: true, label: 'Scanner armed' }, { wait: 400 },
        { set: 'c1.running', to: true }, { tween: 'c1.speed', to: 0.5, ms: 800, label: 'C1 → 0.5 m/s' }, { wait: 400 },
        { set: 'c2.running', to: true }, { tween: 'c2.speed', to: 0.5, ms: 800, label: 'C2 → 0.5 m/s' }, { wait: 400 },
        { set: 'c3.running', to: true }, { tween: 'c3.speed', to: 0.5, ms: 800, label: 'C3 → 0.5 m/s' },
        { say: 'Scanner armed. Line running.' },
        { parallel: [{ tween: 'scanner.count', to: 16, ms: 4000 }, { fn: async ({ store, tween, sleep }) => { if (!store.get('plan.earlyGreen')) { await sleep(800); store.set('dock.light', 'green'); } await tween('dock.parcels', 12, store.get('plan.earlyGreen') ? 4000 : 3200); } }] },
        { say: '16 scanned, 12 at the dock. On pace for 14 minutes.' },
        { beat: 'recover' },
        { set: 'c2.running', to: false }, { set: 'c2.speed', to: 0 },
        { fail: 'c2', say: 'C2 motor fault at parcel 17. C2 has stopped with 3 parcels on it. C1 and C3 are still running.' },
        { say: 'Re-planning around C2, not stopping the line:' },
        { replan: { intro: 'New routing:', changes: ['C1 keeps feeding to its end stop; scanner still on every parcel', 'Carts A and B shuttle parcels from the end of C1 to C3 — one parcel each, alternating: out along the belt, back on the return lane', 'C3 and the dock continue as before', 'Throughput drops about 40%; new finish estimate 21 minutes', 'C2\'s 3 stranded parcels get picked up by the carts last'], needsYou: 'C2\'s motor needs a look — overload trip or a jammed roller. I won\'t restart it on my own.' } },
        { set: 'agvA.u', to: 0 }, { set: 'agvB.u', to: uBack(-1.4) }, { set: 'agvA.state', to: 'moving' }, { set: 'agvB.state', to: 'moving', label: 'Carts A and B → the line' },
        // four shuttle legs; the 40th parcel through the scanner is on the last one, and C1 stops behind it
        { fn: async ({ store, tween, sleep }) => {
          await sleep(900);
          const legs = [['agvA', 'agvB', 24, 18], ['agvB', 'agvA', 32, 25], ['agvA', 'agvB', 40, 31], ['agvB', 'agvA', 40, 34]];
          for (const [i, [out, back, scanned, docked]] of legs.entries()) {
            store.set(`${out}.load`, true);
            if (i === 1) store.set('plan.feedStop', true); // the last of the 40 is on C1: nothing more comes in from receiving
            if (i === legs.length - 1) { store.set('c1.running', false); store.set('c1.speed', 0); }
            await Promise.all([tween(`${out}.u`, 1, 1400), tween(`${back}.u`, 2, 1400), tween('scanner.count', scanned, 1400), tween('dock.parcels', docked, 1400)]);
            store.set(`${out}.load`, false); store.set(`${back}.u`, 0);
          }
        } },
        // the three still on their way down C3 (legs 2–4) are counted one by one as they go through the door
        { fn: async (ctx) => {
          const riding = ridingOf.get(ctx.store) ?? (() => 0); let n = ctx.store.get('dock.parcels'), left = riding();
          for (let i = 0; i < 60 && !ctx.fast && left > 0; i++) { await ctx.sleep(150); const now = riding(); if (now < left) ctx.store.set('dock.parcels', (n = Math.min(37, n + left - now))); left = now; }
          await ctx.tween('dock.parcels', 37, 300);
        } },
        { say: 'All 40 scanned, 37 at the dock. C1 is done and stopped. Now the 3 on C2.' },
        // each trip: drive out to one of C2's parcels, take it, drop it on C3; the other cart comes back, then parks
        { fn: async ({ store, tween, sleep }) => {
          const trips = [['agvA', 'agvB', 0.5], ['agvB', 'agvA', -0.5], ['agvA', 'agvB', -1.5]]; // C2's three sit 1 m apart: one near each stop
          for (const [i, [out, back, x]] of trips.entries()) {
            const last = i === trips.length - 1;
            if (last) store.set(`${back}.state`, 'parked');
            const ret = last ? null : tween(`${back}.u`, 2, 2000);
            await tween(`${out}.u`, uOut(x), 800);
            store.set(`${out}.load`, true); await sleep(350);
            await tween(`${out}.u`, 1, 850);
            store.set(`${out}.load`, false);
            if (!last) await tween('dock.parcels', 38 + i, 300); // the last one counts when it goes through the door, then the dock closes
            if (ret) { await ret; store.set(`${back}.u`, 0); }
          }
          await tween('agvA.u', uBack(-2.15), 1100); store.set('agvA.state', 'parked');
        } },
        { status: 'C3 clearing to dock 2' }, { wait: 3300 }, { tween: 'dock.parcels', to: 40, ms: 400 },
        { set: 'dock.light', to: 'red', label: 'Dock 2 → closed' }, { set: 'c3.running', to: false }, { set: 'c3.speed', to: 0 }, { set: 'scanner.armed', to: false },
        { say: '40 of 40 at dock 2, all scanned. Line stopped, carts parked. C2 is still flagged.' },
        { end: { headline: 'One unit failed. The line didn\'t.', body: 'NeuCharBox re-routed around the fault using what was still working, kept every parcel scanned, and told you the new finish time and what to fix.' } },
      ],
    },
    {
      chip: 'Divert anything scanned as fragile to lane B.',
      keywords: ['divert', 'fragile', 'lane', 'b', 'sort', 'gate', 'route', 'separate', 'glass'],
      expect: { 'scanner.status': 'fault', 'gate.lane': 'B', 'gate.all': true, 'scanner.misreads': 2 },
      steps: [
        { beat: 'plan' },
        { say: 'The scanner reads the label; the gate does the diverting. The important part is what happens when the scanner can\'t read a label.' },
        { plan: { intro: 'Plan:', steps: [
          { text: 'Open dock 2, arm the scanner, start the line' },
          { text: 'Label says FRAGILE → gate to lane B for that parcel, back to A after it passes' },
          { text: 'Label unreadable → treat it as fragile: lane B for a human check', alt: { text: 'Label unreadable → stop C1 and wait for a person', apply: [{ set: 'plan.stopOnMisread', to: true }] } },
          { text: 'If more than 1 in 10 labels are unreadable, stop trusting the scanner and tell you' },
        ] } },
        { beat: 'run' },
        { set: 'dock.light', to: 'green' }, { set: 'scanner.armed', to: true }, { set: 'c1.running', to: true }, { set: 'c1.speed', to: 0.5 }, { set: 'c2.running', to: true }, { set: 'c2.speed', to: 0.5 }, { set: 'c3.running', to: true }, { set: 'c3.speed', to: 0.5, label: 'Dock 2 open, scanner armed, line running' },
        { fn: ({ tween }) => { tween('dock.parcels', 10, 12000); } }, // the dock count follows the parcels going through the open door
        { tween: 'scanner.count', to: 9, ms: 3000 },
        { set: 'gate.lane', to: 'B' }, { tween: 'gate.pos', to: 1, ms: 700, label: 'Gate → lane B' },
        { say: 'Parcel 10 — FRAGILE. Gate to lane B.' },
        { tween: 'scanner.count', to: 10, ms: 900 },
        { set: 'gate.lane', to: 'A' }, { tween: 'gate.pos', to: 0, ms: 700, label: 'Gate → lane A' },
        { tween: 'scanner.count', to: 14, ms: 2400 },
        { parallel: [{ tween: 'scanner.count', to: 15, ms: 600 }, { tween: 'scanner.misreads', to: 1, ms: 600 }] },
        // parcel 15 is unreadable: the approved rule decides what happens to it
        { fn: async ({ store, chat, tween, sleep }) => {
          if (store.get('plan.stopOnMisread')) return; // handled below: C1 holds it
          chat.ncb('Parcel 15 — label unreadable. Treating it as fragile: lane B.');
          store.set('gate.lane', 'B'); await tween('gate.pos', 1, 700);
          await tween('scanner.count', 16, 1800);
          store.set('gate.lane', 'A'); await tween('gate.pos', 0, 700);
          await Promise.all([tween('scanner.count', 17, 1200), tween('scanner.misreads', 2, 1200)]);
          await sleep(200);
        } },
        { beat: 'recover' },
        { fn: async ({ store, chat, tween, sleep }) => {
          if (store.get('plan.stopOnMisread')) {
            store.set('c1.running', false); store.set('c1.speed', 0);
            chat.alert('Parcel 15\'s label is unreadable. C1 is stopped, as you chose — parcel 15 stays on C1 until a person reads it.');
            await sleep(600); return;
          }
          store.set('scanner.status', 'fault');
          chat.alert('Parcels 15 and 17 were unreadable — 2 in the last 10. That\'s over the 1-in-10 line you set.');
          await sleep(600);
          chat.ncb('I\'ve stopped trusting the scanner as a sorter. Every parcel goes to lane B for a human check until it\'s fixed — that\'s the safe direction, not the fast one.');
          store.set('gate.all', true); store.set('gate.lane', 'B'); await tween('gate.pos', 1, 700);
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
      keywords: ['stop', 'everything', 'safely', 'now', 'halt', 'emergency', 'e-stop', 'freeze', 'pause', 'kill', 'shut', 'turn off', 'switch off', 'power', 'abort'],
      expect: { 'c1.running': false, 'c3.running': false, 'dock.light': 'red', 'agvB.state': 'stopped', 'plan.confirmed': true },
      steps: [
        { beat: 'plan' },
        // the request arrives mid-shift: belts running, counts under way, dock open, cart A at the end of C1, cart B on the return lane
        { set: 'c1.running', to: true }, { set: 'c1.speed', to: 0.5 }, { set: 'c2.running', to: true }, { set: 'c2.speed', to: 0.5 }, { set: 'c3.running', to: true }, { set: 'c3.speed', to: 0.5 }, { set: 'scanner.armed', to: true }, { set: 'scanner.count', to: 26 }, { set: 'dock.light', to: 'green' }, { set: 'dock.parcels', to: 19 },
        { set: 'agvA.u', to: 0 }, { set: 'agvB.u', to: uBack(0.1) }, { set: 'agvA.state', to: 'moving' }, { set: 'agvB.state', to: 'moving' },
        { status: 'Mid-shift: belts at 0.5 m/s, dock 2 open, both carts out' },
        // counts keep ticking; cart B heads back along the return lane and comes to rest beside C2 as the stop goes out;
        // cart A takes the next parcel off the end of C1 (one is there ~1.3–1.9 s in) and heads for C3
        { fn: (ctx) => {
          ctx.tween('scanner.count', 29, 3400); ctx.tween('dock.parcels', 21, 3400);
          (async () => { await ctx.sleep(1000); await ctx.tween('agvB.u', uBack(-0.65), 2400); })();
          (async () => { await ctx.sleep(1550); if (ctx.fast) return; ctx.store.set('agvA.load', true); await ctx.sleep(400); if (!ctx.fast) await ctx.tween('agvA.u', 0.6, 2400); })();
        } },
        { say: 'Stopping now. A stop doesn\'t wait for approval — but it does have an order, so nothing collides or drops:' },
        { beat: 'run' },
        { status: '1 · carts' }, { say: '1 — Carts: stop where they are, brakes on.' }, { set: 'agvA.state', to: 'stopped' }, { wait: 500 },
        { status: '2 · scanner' }, { say: '2 — Scanner disarmed.' }, { set: 'scanner.armed', to: false }, { wait: 400 },
        { status: '3 · conveyors' }, { say: '3 — Conveyors ramp down C1, C2, C3 together, 2 seconds, so nothing pushes into a stopped belt.' },
        { parallel: [{ tween: 'c1.speed', to: 0, ms: 2000 }, { tween: 'c2.speed', to: 0, ms: 2000 }, { tween: 'c3.speed', to: 0, ms: 2000 }] },
        { set: 'c1.running', to: false }, { set: 'c2.running', to: false }, { set: 'c3.running', to: false },
        { status: '4 · dock' }, { set: 'dock.light', to: 'red', label: 'Dock 2 → closed' }, { say: '4 — Dock 2 closed, light red.' },
        { beat: 'recover' },
        { fail: 'agvB', say: 'Everything acknowledged the stop except cart B. Its last reported position is on the return lane beside C2. It may be stopped; I can\'t confirm it.' },
        { say: 'I won\'t say "all stopped" when one thing hasn\'t said so. Here\'s the state, honestly:' },
        { replan: { intro: 'Stop status:', changes: ['C1, C2, C3: stopped and confirmed by their encoders', 'Cart A: stopped, brakes on, confirmed', 'Cart B: stop sent 3 times, no acknowledgement — treat it as moving until seen', 'Restart is locked until cart B is confirmed'], needsYou: 'Eyes on cart B, please — on the return lane beside C2. Then tell me it\'s stopped and I\'ll unlock.' } },
        { ask: { intro: 'When you\'ve seen it:', options: [
          { label: 'Cart B is stopped — confirmed by me', apply: [{ set: 'agvB.status', to: 'online' }, { set: 'agvB.state', to: 'stopped' }, { say: 'Logged: cart B confirmed stopped by you, on the return lane beside C2. Everything is stopped. Restart is unlocked, but nothing restarts until you say.' }, { set: 'plan.confirmed', to: true }] },
          { label: 'Keep everything locked', apply: [{ say: 'Locked. I\'ll keep trying cart B every 5 seconds and tell you the moment it answers.' }] },
        ] } },
        { end: { headline: 'A stop with an honest status.', body: 'NeuCharBox stopped the line in a safe order, and when one cart didn\'t confirm, it said so instead of declaring "all stopped". That distinction is the whole product.' } },
      ],
    },
  ],
};
