// Scene 4 — Warehouse (illustrative). Proves: coordination that re-routes when a unit drops out.

export default {
  id: 'warehouse',
  title: 'Warehouse',
  startHour: 10,
  camera: { position: [4.5, 3.2, 6.5], target: [0.2, 0.8, 0.2], minDistance: 3, maxDistance: 12, azimuth: [-0.4, 1.0], fov: 45 },
  setupIntro: 'A small outbound line — an illustrative setup, not a specific site. Three conveyor sections, a scanner arch, a sorter gate to lane B, two carts, and dock 2. The hub is on the desk. Plug it in to start.',
  askIntro: 'Give the line an instruction. Pick one, or type your own.',
  deviceOrder: ['c1', 'c2', 'c3', 'scanner', 'gate', 'agvA', 'agvB', 'dock'],
  devices: {
    c1:      { icon: 'conveyor', name: 'Conveyor C1', initial: { running: false, off: 0, speed: 0 }, format: (s) => (s.running ? `running · ${s.speed.toFixed(1)} m/s` : 'stopped'), faultText: 'motor fault' },
    c2:      { icon: 'conveyor', name: 'Conveyor C2', initial: { running: false, off: 0, speed: 0 }, format: (s) => (s.running ? `running · ${s.speed.toFixed(1)} m/s` : 'stopped'), faultText: 'motor fault' },
    c3:      { icon: 'conveyor', name: 'Conveyor C3', initial: { running: false, off: 0, speed: 0 }, format: (s) => (s.running ? `running · ${s.speed.toFixed(1)} m/s` : 'stopped'), faultText: 'motor fault' },
    scanner: { icon: 'scanner', name: 'Scanner arch', initial: { armed: false, count: 0, misreads: 0 }, format: (s) => (s.armed ? `armed · ${Math.round(s.count)} scanned${s.misreads ? ` · ${Math.round(s.misreads)} unreadable` : ''}` : 'idle'), faultText: 'lens blocked' },
    gate:    { icon: 'gate', name: 'Sorter gate', initial: { lane: 'A', pos: 0 }, format: (s) => `→ lane ${s.lane}`, faultText: 'jammed' },
    agvA:    { icon: 'cart', name: 'Cart A', initial: { state: 'parked', u: 0, load: false }, format: (s) => (s.state === 'parked' ? 'parked' : s.state === 'moving' ? (s.load ? 'moving · loaded' : 'moving · empty') : s.state), faultText: 'no acknowledgement' },
    agvB:    { icon: 'cart', name: 'Cart B', initial: { state: 'parked', u: 0, load: false }, format: (s) => (s.state === 'parked' ? 'parked' : s.state === 'moving' ? (s.load ? 'moving · loaded' : 'moving · empty') : s.state), faultText: 'no acknowledgement' },
    dock:    { icon: 'dock', name: 'Dock 2', initial: { light: 'red', parcels: 0, target: 40 }, format: (s) => `${s.light === 'green' ? 'open' : 'closed'} · ${Math.round(s.parcels)}/${s.target} parcels`, faultText: 'door fault' },
  },

  build({ R, P, M, THREE, store, parts }) {
    const concrete = new THREE.MeshStandardMaterial({ map: parts.tex(parts.concreteTex(), [4, 3]), roughness: 0.85 });
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xB9BDBB, roughness: 0.95 });
    P.roomShell({ w: 14, d: 10, h: 5, floorMat: concrete, wallMat, skirting: false });
    R.lights.sun.intensity = 0; R.lights.sun.castShadow = false; R.lights.hemi.intensity = 0.45; R.lights.fill.intensity = 0.25; R.scene.background = new THREE.Color(0xA8B0B4);
    for (const x of [-4, 0, 4]) for (const z of [-3, 1]) { const l = new THREE.PointLight(0xF4F1E8, 9, 16, 1.5); l.position.set(x, 4.8, z); if (x === 0 && z === 1) { l.castShadow = true; l.shadow.mapSize.set(2048, 2048); l.shadow.bias = -0.001; } R.scene.add(l); P.box(1.2, 0.05, 0.3, M.white, x, 4.95, z).material = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.5 }); }
    // floor markings
    const line = new THREE.MeshStandardMaterial({ color: 0xE4B53A, roughness: 0.9 });
    for (const z of [-1.0, 2.2]) { const l = new THREE.Mesh(new THREE.PlaneGeometry(12, 0.08), line); l.rotation.x = -Math.PI / 2; l.position.set(0, 0.004, z); R.scene.add(l); }
    // racks along the back wall with pallets
    for (let r = 0; r < 4; r++) { const x = -5.2 + r * 2.6; for (const dx of [-1.1, 1.1]) { P.box(0.08, 4.2, 0.08, M.steel, x + dx, 2.1, -4.7); P.box(0.08, 4.2, 0.08, M.steel, x + dx, 2.1, -3.7); } for (const y of [0.9, 2.2, 3.5]) { P.box(2.3, 0.06, 1.1, M.steel, x, y, -4.2); } for (const y of [0.0, 0.96, 2.26]) for (const dx of [-0.55, 0.55]) { if (Math.random() < 0.8) { P.box(0.9, 0.1, 0.9, M.woodLight, x + dx, y + 0.05, -4.2); P.box(0.8, 0.5 + Math.random() * 0.4, 0.8, M.cardboard, x + dx, y + 0.1 + 0.35, -4.2, 0.01); } } }
    // dock door on the right wall + dock light + bumpers
    P.box(0.06, 3.2, 3.0, new THREE.MeshStandardMaterial({ color: 0x6E7478, roughness: 0.7, metalness: 0.4 }), 6.96, 1.6, 0.6); for (let i = 0; i < 8; i++) P.box(0.02, 0.02, 3.0, M.black, 6.92, 0.4 + i * 0.4, 0.6);
    P.box(0.3, 0.3, 0.4, M.rubber, 6.85, 0.2, -1.0); P.box(0.3, 0.3, 0.4, M.rubber, 6.85, 0.2, 2.2);
    const dockLight = P.beacon(6.85, 3.4, 0.6); const dockPost = P.box(0.06, 0.4, 0.06, M.black, 6.9, 3.2, 0.6);
    P.box(0.5, 0.35, 0.02, M.yellow, 6.93, 3.9, 0.6).rotation.y = Math.PI / 2;
    // three conveyor sections along x at z = 0.5, belt height 0.8
    const belt = new THREE.MeshStandardMaterial({ color: 0x22262A, roughness: 0.9 });
    const beltY = 0.8;
    function conveyor(x0, x1, z) { const len = x1 - x0, cx = (x0 + x1) / 2; P.box(len, 0.06, 0.62, belt, cx, beltY, z); P.box(len, 0.14, 0.05, M.steel, cx, beltY - 0.02, z - 0.33); P.box(len, 0.14, 0.05, M.steel, cx, beltY - 0.02, z + 0.33); for (const lx of [x0 + 0.25, x1 - 0.25]) for (const dz of [-0.28, 0.28]) P.box(0.05, beltY - 0.05, 0.05, M.steel, lx, (beltY - 0.05) / 2, z + dz); const motor = P.box(0.22, 0.18, 0.18, M.black, x1 - 0.3, beltY - 0.2, z + 0.45, 0.01); const led = P.ledDot(x1 - 0.3, beltY - 0.08, z + 0.55, 0x2FBF71, 0.012); return { x0, x1, z, motor, led }; }
    const C = { c1: conveyor(-5.0, -2.0, 0.5), c2: conveyor(-2.0, 1.0, 0.5), c3: conveyor(1.0, 5.6, 0.5) };
    // lane B: short branch off the C2/C3 junction toward +z
    const laneB = conveyor(1.0, 1.0 + 0.001, 0.5); R.scene.remove(laneB.motor); R.scene.remove(laneB.led);
    const lb = P.box(0.62, 0.06, 2.2, belt, 1.3, beltY, 1.9); P.box(0.05, 0.14, 2.2, M.steel, 0.97, beltY - 0.02, 1.9); P.box(0.05, 0.14, 2.2, M.steel, 1.63, beltY - 0.02, 1.9); for (const lz of [1.1, 2.8]) for (const dx of [-0.28, 0.28]) P.box(0.05, beltY - 0.05, 0.05, M.steel, 1.3 + dx, (beltY - 0.05) / 2, lz);
    P.box(0.9, 0.6, 0.7, M.cardboard, 1.3, 0.3, 3.3, 0.02); // lane B tote
    // scanner arch over C1
    for (const dz of [-0.45, 0.45]) P.box(0.06, 1.2, 0.06, M.steel, -3.2, beltY + 0.6, 0.5 + dz); P.box(0.06, 0.06, 1.0, M.steel, -3.2, beltY + 1.2, 0.5); const scanHead = P.box(0.12, 0.1, 0.16, M.black, -3.2, beltY + 1.1, 0.5, 0.01);
    const scanLine = new THREE.Mesh(new THREE.PlaneGeometry(0.012, 0.9), new THREE.MeshStandardMaterial({ color: 0xFF3030, emissive: 0xFF2020, emissiveIntensity: 5, transparent: true, opacity: 0.7, side: THREE.DoubleSide })); scanLine.rotation.z = Math.PI / 2; scanLine.rotation.y = Math.PI / 2; scanLine.position.set(-3.2, beltY + 0.04, 0.5); R.scene.add(scanLine);
    // sorter gate: a pivoting arm at the C2 → C3 junction
    const gatePivot = new THREE.Group(); gatePivot.position.set(1.0, beltY + 0.12, 0.2); R.scene.add(gatePivot); const gateArm = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.03), M.yellow); gateArm.position.x = 0.35; gateArm.castShadow = true; gatePivot.add(gateArm); P.cyl(0.03, 0.03, 0.3, M.steel, 1.0, beltY + 0.1, 0.2, 12);
    // parcels: 6 per section, positions derived from each belt's offset
    const parcels = {}; for (const k of ['c1', 'c2', 'c3']) { parcels[k] = []; for (let i = 0; i < 6; i++) parcels[k].push(P.parcel(0, beltY + 0.03, 0.5, 0.26 + (i % 3) * 0.04)); }
    const laneParcels = [P.parcel(1.3, beltY + 0.03, 1.4, 0.26), P.parcel(1.3, beltY + 0.03, 2.3, 0.28)]; laneParcels.forEach((p) => (p.visible = false));
    // two carts (AGVs) that shuttle between the end of C1 and the start of C3 when C2 is out
    function cart(x, z) { const g = new THREE.Group(); g.position.set(x, 0, z); R.scene.add(g); const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.22, 0.6), M.steel); body.position.y = 0.2; body.castShadow = true; g.add(body); const top = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.03, 0.55), M.black); top.position.y = 0.32; g.add(top); for (const [dx, dz] of [[-0.3, -0.25], [0.3, -0.25], [-0.3, 0.25], [0.3, 0.25]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 16), M.rubber); w.rotation.x = Math.PI / 2; w.position.set(dx, 0.08, dz); g.add(w); } const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.06, 12), new THREE.MeshStandardMaterial({ color: 0x2FBF71, emissive: 0x2FBF71, emissiveIntensity: 1.5 })); beacon.position.set(-0.38, 0.36, 0.22); g.add(beacon); const load = P.parcel(0, 0.33, 0, 0.3); R.scene.remove(load); load.position.set(0, 0.33 + 0.105, 0); g.add(load); load.visible = false; return { group: g, body, beacon, load }; }
    const A = cart(-3.0, 3.2), B = cart(-1.4, 3.2);
    // desk with hub and a screen
    P.table(-5.5, 3.0, 1.2, 0.6, 0.75, M.woodLight, M.steel); const hub = P.hub(-5.7, 0.77, 3.0, { rotY: 0.4 }); R.addPickable(hub.group, 'hub'); P.phone(-5.3, 0.775, 3.1, 0.3); P.box(0.5, 0.32, 0.03, M.black, -5.4, 1.05, 2.75, 0.01);
    P.box(0.5, 0.5, 0.5, M.cardboard, -6.2, 0.25, 1.5, 0.01); P.box(0.5, 0.45, 0.5, M.cardboard, -6.2, 0.725, 1.5, 0.01);

    R.addPickable(C.c1.motor, 'c1'); R.addPickable(C.c2.motor, 'c2'); R.addPickable(C.c3.motor, 'c3'); R.addPickable(scanHead, 'scanner'); R.addPickable(gatePivot, 'gate'); R.addPickable(A.group, 'agvA'); R.addPickable(B.group, 'agvB'); R.addPickable(dockPost, 'dock'); R.addPickable(dockLight, 'dock');
    const hi = P.highlighter({ c1: [C.c1.motor], c2: [C.c2.motor], c3: [C.c3.motor], scanner: [scanHead], gate: [gateArm], agvA: [A.body], agvB: [B.body], dock: [dockPost] });
    const P1 = new THREE.Vector3(-2.3, 0, 1.6), P2 = new THREE.Vector3(1.6, 0, 1.6); // cart shuttle path (in front of C2)

    return {
      focus: hi.focus,
      update(s, t) {
        hi.update();
        hub.ledMat.emissiveIntensity = s.hub.status === 'on' ? (2.5 + Math.sin(t * 2.2) * 1.5) * s.hub.led : 0;
        for (const k of ['c1', 'c2', 'c3']) { const c = C[k], st = s[k]; const len = c.x1 - c.x0, sp = 0.5; parcels[k].forEach((p, i) => { const u = ((st.off * 0.5 + i * sp) % len + len) % len; p.position.x = c.x0 + u; p.visible = st.status !== 'offline' || true; }); const bad = st.status === 'fault'; c.led.material.color.set(bad ? 0xE0563A : st.running ? 0x3AB7FF : 0x2FBF71); c.led.material.emissive.copy(c.led.material.color); c.led.material.emissiveIntensity = bad ? (Math.floor(t * 3) % 2 ? 6 : 1) : 2; c.led.visible = st.status !== 'offline'; }
        const armed = s.scanner.armed && s.scanner.status !== 'fault'; scanLine.visible = armed; scanLine.material.opacity = armed ? 0.5 + 0.3 * Math.abs(Math.sin(t * 6)) : 0;
        gatePivot.rotation.y = -s.gate.pos * 0.9; laneParcels.forEach((p, i) => (p.visible = s.gate.lane === 'B' && s.gate.pos > 0.9)); if (s.gate.lane === 'B' && s.c3.running) laneParcels.forEach((p, i) => (p.position.z = 1.2 + ((s.c3.off * 0.5 + i * 0.9) % 1.8)));
        for (const [cart, st] of [[A, s.agvA], [B, s.agvB]]) { const home = cart === A ? new THREE.Vector3(-3.0, 0, 3.2) : new THREE.Vector3(-1.4, 0, 3.2); if (st.state === 'parked') cart.group.position.lerp(home, 0.1); else { cart.group.position.lerpVectors(P1, P2, st.u); cart.group.position.z = 1.6; } cart.load.visible = !!st.load; const bad = st.status === 'fault'; cart.beacon.material.color.set(bad ? 0xE0563A : st.state === 'moving' ? 0xFFB020 : 0x2FBF71); cart.beacon.material.emissive.copy(cart.beacon.material.color); cart.beacon.material.emissiveIntensity = st.state === 'moving' || bad ? (Math.floor(t * 4) % 2 ? 4 : 1) : 1.5; }
        dockLight.material.color.set(s.dock.light === 'green' ? 0x2FBF71 : 0xE0563A); dockLight.material.emissive.copy(dockLight.material.color);
      },
    };
  },

  prompts: [
    {
      chip: 'Move today\'s 40 outbound parcels from receiving to dock 2, scanning each one.',
      keywords: ['move', 'parcels', 'outbound', 'dock', 'scanning', 'scan', 'receiving', 'ship', 'boxes', 'orders', '40'],
      expect: { 'c2.status': 'fault', 'dock.parcels': 40, 'agvA.state': 'parked' },
      steps: [
        { beat: 'plan' },
        { say: 'Three conveyors, a scanner, a gate, two carts and the dock. Here\'s the sequence — nothing moves until you approve it.' },
        { plan: { intro: 'Plan for 40 parcels:', steps: [
          { text: 'Start C1, C2, C3 at 0.5 m/s, in that order, 2 s apart' },
          { text: 'Arm the scanner; every parcel is scanned on C1 or it doesn\'t leave C1' },
          { text: 'Gate stays on lane A (straight through)' },
          { text: 'Dock 2 light green once the first parcel is on C3; red again when the count hits 40', alt: { text: 'Dock 2 light green now, before parcels arrive', apply: [{ set: 'plan.earlyGreen', to: true }] } },
          { text: 'Carts A and B stay parked unless a conveyor drops out' },
        ] } },
        { beat: 'run' },
        { fn: async ({ store, fast }) => { if (store.get('plan.earlyGreen')) store.set('dock.light', 'green'); } },
        { set: 'c1.running', to: true }, { tween: 'c1.speed', to: 0.5, ms: 800, label: 'C1 → 0.5 m/s' }, { wait: 400 },
        { set: 'c2.running', to: true }, { tween: 'c2.speed', to: 0.5, ms: 800, label: 'C2 → 0.5 m/s' }, { wait: 400 },
        { set: 'c3.running', to: true }, { tween: 'c3.speed', to: 0.5, ms: 800, label: 'C3 → 0.5 m/s' },
        { set: 'scanner.armed', to: true, label: 'Scanner armed' },
        { say: 'Line running. Scanner armed.' },
        { parallel: [{ tween: 'c1.off', to: 8, ms: 4000 }, { tween: 'c2.off', to: 8, ms: 4000 }, { tween: 'c3.off', to: 8, ms: 4000 }, { tween: 'scanner.count', to: 16, ms: 4000 }, { tween: 'dock.parcels', to: 12, ms: 4000 }, { fn: async ({ store, fast }) => { await new Promise((r) => setTimeout(r, fast ? 0 : 800)); if (!store.get('plan.earlyGreen')) store.set('dock.light', 'green'); } }] },
        { say: '16 scanned, 12 at the dock. On pace for 14 minutes.' },
        { beat: 'recover' },
        { set: 'c2.running', to: false }, { set: 'c2.speed', to: 0 },
        { fail: 'c2', say: 'C2 motor fault at parcel 17. C2 has stopped with 3 parcels on it. C1 and C3 are still running.' },
        { say: 'Re-planning around C2, not stopping the line:' },
        { replan: { intro: 'New routing:', changes: ['C1 keeps feeding to its end stop; scanner still on every parcel', 'Carts A and B shuttle parcels from the end of C1 to the start of C3 — one parcel each, alternating', 'C3 and the dock continue as before', 'Throughput drops about 40%; new finish estimate 21 minutes', 'C2\'s 3 stranded parcels get picked up by the carts last'], needsYou: 'C2\'s motor needs a look — overload trip or a jammed roller. I won\'t restart it on my own.' } },
        { set: 'agvA.state', to: 'moving' }, { set: 'agvB.state', to: 'moving' },
        { fn: async ({ store, fast }) => { const T = fast ? 0 : 1200; for (let i = 0; i < 3; i++) { store.set('agvA.load', true); store.set('agvB.load', false); await Promise.all([store.tween('agvA.u', 1, T), store.tween('agvB.u', 0, T), store.tween('c1.off', 8 + (i + 1) * 2, T), store.tween('c3.off', 8 + (i + 1) * 2, T), store.tween('scanner.count', 16 + (i + 1) * 4, T), store.tween('dock.parcels', 12 + (i + 1) * 4.6, T)]); store.set('agvA.load', false); store.set('agvB.load', true); await Promise.all([store.tween('agvA.u', 0, T), store.tween('agvB.u', 1, T), store.tween('c1.off', 8 + (i + 1) * 2 + 1, T), store.tween('c3.off', 8 + (i + 1) * 2 + 1, T), store.tween('scanner.count', 16 + (i + 1) * 4 + 2, T), store.tween('dock.parcels', 12 + (i + 1) * 4.6 + 2.5, T)]); } } },
        { say: '32 at the dock, carts holding pace. 8 to go.' },
        { fn: async ({ store, fast }) => { const T = fast ? 0 : 1500; await Promise.all([store.tween('scanner.count', 40, T), store.tween('dock.parcels', 40, T), store.tween('c1.off', 20, T), store.tween('c3.off', 20, T), store.tween('agvA.u', 1, T), store.tween('agvB.u', 0, T)]); } },
        { set: 'agvA.load', to: false }, { set: 'agvB.load', to: false }, { set: 'agvA.state', to: 'parked' }, { set: 'agvB.state', to: 'parked' },
        { set: 'dock.light', to: 'red', label: 'Dock 2 → closed' }, { set: 'c1.running', to: false }, { set: 'c1.speed', to: 0 }, { set: 'c3.running', to: false }, { set: 'c3.speed', to: 0 }, { set: 'scanner.armed', to: false },
        { say: '40 of 40 at dock 2, all scanned. Line stopped, carts parked. C2 is still flagged.' },
        { end: { headline: 'One unit failed. The line didn\'t.', body: 'NeuCharBox re-routed around the fault using what was still working, kept every parcel scanned, and told you the new finish time and what to fix.' } },
      ],
    },
    {
      chip: 'Divert anything scanned as fragile to lane B.',
      keywords: ['divert', 'fragile', 'lane', 'b', 'sort', 'gate', 'route', 'separate', 'glass'],
      expect: { 'scanner.status': 'fault', 'gate.lane': 'B' },
      steps: [
        { beat: 'plan' },
        { say: 'The scanner reads the label; the gate does the diverting. The important part is what happens when the scanner can\'t read a label.' },
        { plan: { intro: 'Plan:', steps: [
          { text: 'Start the line, scanner armed' },
          { text: 'Label says FRAGILE → gate to lane B for that parcel, back to A after it passes' },
          { text: 'Label unreadable → treat as fragile and divert to lane B for a human check', alt: { text: 'Label unreadable → stop C1 and wait for a person', apply: [{ set: 'plan.stopOnMisread', to: true }] } },
          { text: 'If more than 1 in 10 labels are unreadable, stop trusting the scanner and tell you' },
        ] } },
        { beat: 'run' },
        { set: 'c1.running', to: true }, { set: 'c1.speed', to: 0.5 }, { set: 'c2.running', to: true }, { set: 'c2.speed', to: 0.5 }, { set: 'c3.running', to: true }, { set: 'c3.speed', to: 0.5 }, { set: 'scanner.armed', to: true, label: 'Line running, scanner armed' },
        { parallel: [{ tween: 'c1.off', to: 6, ms: 3000 }, { tween: 'c2.off', to: 6, ms: 3000 }, { tween: 'c3.off', to: 6, ms: 3000 }, { tween: 'scanner.count', to: 9, ms: 3000 }] },
        { set: 'gate.lane', to: 'B' }, { tween: 'gate.pos', to: 1, ms: 700, label: 'Gate → lane B' },
        { say: 'Parcel 10 — FRAGILE. Gate to lane B.' },
        { parallel: [{ tween: 'c2.off', to: 8, ms: 1600 }, { tween: 'c3.off', to: 8, ms: 1600 }, { tween: 'scanner.count', to: 10, ms: 1600 }] },
        { set: 'gate.lane', to: 'A' }, { tween: 'gate.pos', to: 0, ms: 700, label: 'Gate → lane A' },
        { parallel: [{ tween: 'c1.off', to: 10, ms: 2500 }, { tween: 'c2.off', to: 12, ms: 2500 }, { tween: 'c3.off', to: 12, ms: 2500 }, { tween: 'scanner.count', to: 18, ms: 2500 }, { tween: 'scanner.misreads', to: 3, ms: 2500 }] },
        { beat: 'recover' },
        { fail: 'scanner', say: 'Parcels 15, 17 and 18 were unreadable — 3 in the last 10. That\'s over the 1-in-10 line you set.' },
        { fn: ({ chat, store }) => chat.ncb(store.get('plan.stopOnMisread') ? 'You chose to stop on unreadable labels, so C1 is stopping now.' : 'I\'ve stopped trusting the scanner as a sorter. Every parcel goes to lane B for a human check until it\'s fixed — that\'s the safe direction, not the fast one.') },
        { fn: ({ store }) => { if (store.get('plan.stopOnMisread')) { store.set('c1.running', false); store.set('c1.speed', 0); } } },
        { set: 'gate.lane', to: 'B' }, { tween: 'gate.pos', to: 1, ms: 700, label: 'Gate → lane B for everything' },
        { replan: { intro: 'Until the scanner is checked:', changes: ['Gate held on lane B — nothing unverified goes to the dock', 'Scanner still logging, but its reads don\'t drive the gate', 'Line speed unchanged; lane B tote will fill in about 12 minutes'], needsYou: 'Three misreads in a row usually means a dirty lens or a misprinted label batch. Check the arch; I\'ll go back to sorting when reads are clean for 20 parcels.' } },
        { end: { headline: 'It stopped trusting the sensor before you had to.', body: 'A rule you approved decided when the scanner\'s word stopped being good enough. NeuCharBox chose the safe lane, kept the line moving, and told you what to check.' } },
      ],
    },
    {
      chip: 'Stop everything, safely, now.',
      keywords: ['stop', 'everything', 'safely', 'now', 'halt', 'emergency', 'e-stop', 'freeze', 'pause'],
      expect: { 'c1.running': false, 'c3.running': false, 'agvB.status': 'fault' },
      steps: [
        { beat: 'plan' },
        { say: 'Stopping now. A stop doesn\'t wait for approval — but it does have an order, so nothing collides or drops:' },
        { set: 'c1.running', to: true }, { set: 'c1.speed', to: 0.5 }, { set: 'c2.running', to: true }, { set: 'c2.speed', to: 0.5 }, { set: 'c3.running', to: true }, { set: 'c3.speed', to: 0.5 }, { set: 'scanner.armed', to: true }, { set: 'agvA.state', to: 'moving' }, { set: 'agvA.load', to: true }, { set: 'agvB.state', to: 'moving' },
        { parallel: [{ tween: 'c1.off', to: 3, ms: 1200 }, { tween: 'c2.off', to: 3, ms: 1200 }, { tween: 'c3.off', to: 3, ms: 1200 }, { tween: 'agvA.u', to: 0.5, ms: 1200 }, { tween: 'agvB.u', to: 0.7, ms: 1200 }] },
        { beat: 'run' },
        { status: '1 · carts' }, { say: '1 — Carts: stop where they are, brakes on.' }, { set: 'agvA.state', to: 'stopped' }, { wait: 500 },
        { status: '2 · scanner' }, { say: '2 — Scanner disarmed.' }, { set: 'scanner.armed', to: false }, { wait: 400 },
        { status: '3 · conveyors' }, { say: '3 — Conveyors ramp down C1, C2, C3 together, 2 seconds, so nothing pushes into a stopped belt.' },
        { parallel: [{ tween: 'c1.speed', to: 0, ms: 1600 }, { tween: 'c2.speed', to: 0, ms: 1600 }, { tween: 'c3.speed', to: 0, ms: 1600 }, { tween: 'c1.off', to: 4, ms: 1600 }, { tween: 'c2.off', to: 4, ms: 1600 }, { tween: 'c3.off', to: 4, ms: 1600 }] },
        { set: 'c1.running', to: false }, { set: 'c2.running', to: false }, { set: 'c3.running', to: false },
        { status: '4 · dock' }, { set: 'dock.light', to: 'red', label: 'Dock 2 → closed' }, { say: '4 — Dock 2 light red.' },
        { beat: 'recover' },
        { fail: 'agvB', say: 'Everything acknowledged the stop except cart B. Its last reported position is on the cross-aisle, halfway to C3. It may be stopped; I can\'t confirm it.' },
        { say: 'I won\'t say "all stopped" when one thing hasn\'t said so. Here\'s the state, honestly:' },
        { replan: { intro: 'Stop status:', changes: ['C1, C2, C3: stopped and confirmed by their encoders', 'Cart A: stopped, brakes on, confirmed', 'Cart B: stop sent 3 times, no acknowledgement — treat it as moving until seen', 'Restart is locked until cart B is confirmed'], needsYou: 'Eyes on cart B, please — cross-aisle near C3. Then tell me it\'s stopped and I\'ll unlock.' } },
        { ask: { intro: 'When you\'ve seen it:', options: [
          { label: 'Cart B is stopped — confirmed by me', apply: [{ set: 'agvB.status', to: 'online' }, { set: 'agvB.state', to: 'stopped' }, { say: 'Logged: cart B confirmed stopped by you at the cross-aisle. Everything is stopped. Restart is unlocked but nothing restarts until you say.' }, { set: 'agvB.status', to: 'fault' }, { set: 'plan.confirmed', to: true }] },
          { label: 'Keep everything locked', apply: [{ say: 'Locked. I\'ll keep trying cart B every 5 seconds and tell you the moment it answers.' }] },
        ] } },
        { end: { headline: 'A stop with an honest status.', body: 'NeuCharBox stopped the line in a safe order, and when one cart didn\'t confirm, it said so instead of declaring "all stopped". That distinction is the whole product.' } },
      ],
    },
  ],
};
