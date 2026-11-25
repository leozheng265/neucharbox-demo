// The Warehouse types' card UI and 3D models for the custom room (contract: devices/index.js). Their look follows the
// warehouse scene (js/scenes/warehouse.js), built as real industrial kit: a belt conveyor on a galvanised frame, a vision
// arch with yellow light curtains, a pneumatic diverter that swings to lane B, a small AMR that follows a taped loop, and
// a roller door over a dock leveller at a loading dock. Each is a compact, self-contained model with its own status LED,
// since here nothing else (a hub desk, the other belts) is there to carry it. Steel stays grey; safety yellow only where
// real kit has it (guards, curtains, the paddle, hazard edges).
import { HEX, num, clamp01, statusLed, mergeMeshes, canvasTex, ease, stepper, screenTex } from './kit.js';

const TAU = Math.PI * 2;
const SPEED_K = 2.2; // the warehouse scene runs its belts 2.2× faster than labelled; so does this belt on screen
const FONT = 'Inter, "Segoe UI", sans-serif';

// P.box rounds a corner with 4 segments (about 1k triangles a box); the parts here take 1 or 2 (about 100 or 300).
// The RoundedBoxGeometry class comes from P.box itself, since models import nothing from 'three'.
function rounder(P, M) {
  const probe = P.box(0.1, 0.1, 0.1, M.steel, 0, 0, 0, 0.01), RBox = probe.geometry.constructor;
  probe.removeFromParent(); probe.geometry.dispose();
  return (w, h, d, mat, x, y, z, r, seg = 2) => { const m = P.box(w, h, d, mat, x, y, z); m.geometry.dispose(); m.geometry = new RBox(w, h, d, seg, r); return m; };
}
const alongX = (m) => { m.rotation.z = Math.PI / 2; return m; }; // a P.cyl lying along x
const alongZ = (m) => { m.rotation.x = Math.PI / 2; return m; }; // … along z

// ---- finishes ----
// Powder-coated steel (enclosures, gearmotors, the safety-yellow parts): satin paint over metal.
const paint = (THREE, hex, rough = 0.5) => new THREE.MeshPhysicalMaterial({ color: hex, roughness: rough, metalness: 0.15, clearcoat: 0.35, clearcoatRoughness: 0.45 });
// Galvanised steel: frames, legs, brackets.
const galv = (THREE, map = null) => new THREE.MeshStandardMaterial({ color: map ? 0xFFFFFF : 0xB4BABF, map, metalness: 1, roughness: 0.38 });
const SAFETY = 0xF2B705;

// ---- canvas textures (detail drawn, not modelled) ----
// A dark PVC belt with a fine weave and a lighter splice stripe every 10 cm (u runs along the belt): offset.x scrolls it,
// and the stripe is what shows the speed.
const beltTex = (THREE, length) => {
  const t = canvasTex(THREE, (g, w, h) => {
    g.fillStyle = '#272B2F'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.05)'; for (let y = 0; y < h; y += 4) for (let x = (y / 2) % 4; x < w; x += 4) g.fillRect(x, y, 2, 1);
    g.fillStyle = '#3C434A'; g.fillRect(0, 0, 9, h); g.fillStyle = '#1B1E21'; g.fillRect(9, 0, 3, h);
  });
  t.repeat.set(length / 0.1, 1);
  return t;
};
// Yellow and black 45° hazard stripes, seamless both ways (each band shifts one tile width per tile height).
const hazardTex = (THREE, rx, ry) => {
  const t = canvasTex(THREE, (g, w, h) => {
    g.fillStyle = '#F2B705'; g.fillRect(0, 0, w, h); g.fillStyle = '#1C1C1C';
    for (let i = -2; i < 2; i++) { g.beginPath(); g.moveTo(i * w, h); g.lineTo(i * w + w / 2, h); g.lineTo(i * w + w * 1.5, 0); g.lineTo(i * w + w, 0); g.closePath(); g.fill(); }
  });
  t.repeat.set(rx, ry);
  return t;
};
// A T-slot aluminium extrusion face: a dark slot down the middle of every face (rotated for a horizontal beam).
const slotTex = (THREE, horizontal) => {
  const t = canvasTex(THREE, (g, w, h) => {
    g.fillStyle = '#C3C8CD'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#3E444A'; g.fillRect(w / 2 - 6, 0, 12, h); g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(w / 2 - 8, 0, 2, h); g.fillRect(w / 2 + 6, 0, 2, h);
  });
  if (horizontal) { t.center.set(0.5, 0.5); t.rotation = Math.PI / 2; }
  return t;
};
// A side channel's face: brushed galvanised steel with a roller-axle nut every repeat.
const boltRowTex = (THREE, rx) => {
  const t = canvasTex(THREE, (g, w, h) => {
    g.fillStyle = '#B9BFC4'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.06)'; for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
    g.fillStyle = '#7B8288'; g.beginPath(); g.arc(w / 2, h * 0.3, 6, 0, TAU); g.fill();
    g.fillStyle = '#D9DDE0'; g.beginPath(); g.arc(w / 2 - 1, h * 0.3 - 1, 3, 0, TAU); g.fill();
  });
  t.repeat.set(rx, 1);
  return t;
};
// Diamond tread plate: raised lozenges in two directions.
const treadTex = (THREE, rx, ry) => {
  const t = canvasTex(THREE, (g, w, h) => {
    g.fillStyle = '#8B9197'; g.fillRect(0, 0, w, h);
    const bar = (x, y, a) => { g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = '#5F656B'; g.beginPath(); g.ellipse(1, 1.5, 11, 3, 0, 0, TAU); g.fill(); g.fillStyle = '#C0C6CB'; g.beginPath(); g.ellipse(0, 0, 11, 3, 0, 0, TAU); g.fill(); g.restore(); };
    bar(16, 16, 0.75); bar(48, 48, 0.75); bar(48, 16, -0.75); bar(16, 48, -0.75);
  });
  t.repeat.set(rx, ry);
  return t;
};
// One roller-door slat per repeat: a rounded face lit from above, its middle rib, and the joint at its foot.
const slatTex = (THREE) => canvasTex(THREE, (g, w, h) => {
  const lg = g.createLinearGradient(0, 0, 0, h); lg.addColorStop(0, '#DADEE1'); lg.addColorStop(0.5, '#C4C9CD'); lg.addColorStop(0.85, '#AAB0B5'); lg.addColorStop(1, '#8E9499');
  g.fillStyle = lg; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(0,0,0,0.14)'; g.fillRect(0, h / 2, w, 2);
  g.fillStyle = '#5A6065'; g.fillRect(0, h - 6, w, 3); g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(0, h - 3, w, 2);
});
// Laminated rubber bumper: stacked pads, each a slightly different black.
const laminateTex = (THREE) => canvasTex(THREE, (g, w, h) => {
  for (let y = 0, i = 0; y < h; y += 8, i++) { g.fillStyle = i % 2 ? '#1E2022' : '#26292B'; g.fillRect(0, y, w, 8); g.fillStyle = '#101112'; g.fillRect(0, y + 7, w, 1); }
});
// A light curtain's lens: dark red glass with an emitter every 16 px (the same canvas lights them through emissiveMap).
const emitterTex = (THREE, ry) => {
  const t = canvasTex(THREE, (g, w, h) => {
    g.fillStyle = '#140A0B'; g.fillRect(0, 0, w, h);
    for (let y = 8; y < h; y += 16) { g.fillStyle = '#5A1A1A'; g.beginPath(); g.arc(w / 2, y, 5, 0, TAU); g.fill(); g.fillStyle = '#C23A30'; g.beginPath(); g.arc(w / 2, y, 2.2, 0, TAU); g.fill(); }
  }, 32, 64);
  t.repeat.set(1, ry);
  return t;
};
// A ribbed rubber deck mat (ribs across the AMR).
const ribTex = (THREE, rx) => {
  const t = canvasTex(THREE, (g, w, h) => { g.fillStyle = '#2A2D30'; g.fillRect(0, 0, w, h); g.fillStyle = '#3A3E42'; g.fillRect(0, 0, w / 2, h); g.fillStyle = '#1A1C1E'; g.fillRect(w / 2, 0, 3, h); });
  t.repeat.set(rx, 1);
  return t;
};
// A gearmotor's cooling fins, around the barrel.
const finTex = (THREE) => {
  const t = canvasTex(THREE, (g, w, h) => { g.fillStyle = '#4A5057'; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 8) { g.fillStyle = '#2A2E33'; g.fillRect(x, 0, 3, h); g.fillStyle = '#636A72'; g.fillRect(x + 3, 0, 1, h); } });
  t.repeat.set(3, 1);
  return t;
};

// A signal lens with its own material: dim coloured plastic while off; update() lights it through emissive.
const lens = (THREE, r, h, offHex) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20), new THREE.MeshPhysicalMaterial({ color: offHex, emissive: 0x000000, emissiveIntensity: 0, roughness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.2 }));
// A one-tier stack light on a short post (post = 0 for none) standing at y: a grey base, the lens, a grey cap.
// Returns { parts, lamp }: the lamp is the lens mesh, already added (P.add) so P.group can take it.
function stackLight(THREE, P, M, x, y, z, offHex, post = 0) {
  const parts = [];
  if (post) parts.push(P.cyl(0.008, 0.008, post, M.steel, x, y + post / 2, z, 10));
  const b = y + post, grey = M.black;
  parts.push(P.cyl(0.022, 0.025, 0.022, grey, x, b + 0.011, z, 20), P.cyl(0.023, 0.023, 0.01, grey, x, b + 0.077, z, 20));
  const lamp = P.add(lens(THREE, 0.021, 0.05, offHex)); lamp.position.set(x, b + 0.047, z);
  return { parts, lamp };
}
// Cardboard parcels with a strip of tape along the top (rounded with one segment: a few cm of bevel reads at this size).
function parcel(THREE, rb, M, tapeMat, w, h, d, x, y, z) {
  const p = rb(w, h, d, M.cardboard, x, y, z, 0.008, 1);
  const tape = new THREE.Mesh(new THREE.BoxGeometry(w * 0.28, 0.002, d + 0.002), tapeMat); tape.position.y = h / 2 + 0.0005; tape.castShadow = false; p.add(tape);
  return p;
}
const tapeMaterial = (THREE) => new THREE.MeshStandardMaterial({ color: 0xD8D5CB, roughness: 0.85 }); // off-white and matte, so it doesn't bloom

const CART_SPOT = { dock: Math.PI, aisle: -Math.PI / 2, charger: 0 }; // where each stop sits on the loop (x = r cos, z = r sin)
const wrapPi = (a) => { a = ((a + Math.PI) % TAU + TAU) % TAU - Math.PI; return a; };

export default {
  // A 1.5 m belt section on a galvanised frame. The belt's cross stripes scroll with the speed, and two parcels ride it while
  // it runs. The stack light on the end post is blue while the belt moves.
  conveyor: {
    icon: 'conveyor', size: 1.6,
    edit: [{ field: 'speed', kind: 'slider', step: 0.05, unit: ' m/s', label: 'speed' }],
    format: (s) => (num(s.speed) > 0.05 ? `running · ${num(s.speed).toFixed(1)} m/s` : 'stopped'),
    active: (s) => num(s.speed) > 0.05,
    control: { kind: 'bar', field: 'speed', min: 0, max: 0.5 },
    // A flat-belt conveyor: lipped side channels (an axle nut every 15 cm) carry the belt over a drive drum and a tail
    // drum, the return belt runs back underneath on three idlers, and two H-frame legs stand on levelling feet. Guide
    // rails with a white wear strip keep parcels on the belt; yellow nip guards cover the drum ends. The gearmotor hangs
    // off the drive end; a pushbutton box with an E-stop sits on the far leg.
    model({ THREE, P, M }) {
      const L = 1.44, W = 0.38, TOP = 0.7, ZS = W / 2 + 0.018, rb = rounder(P, M);
      const frameMat = galv(THREE), sideMat = galv(THREE, boltRowTex(THREE, 1.52 / 0.15)), yellow = paint(THREE, SAFETY, 0.45), graphite = paint(THREE, 0x3A3F45, 0.5), panel = paint(THREE, 0xD9DCDE, 0.55);
      const sides = mergeMeshes(THREE, [-1, 1].map((sz) => P.box(1.52, 0.11, 0.012, sideMat, 0, TOP - 0.045, sz * ZS)), sideMat, { consume: true });
      const frameParts = [];
      for (const sz of [-1, 1]) {
        frameParts.push(P.box(1.52, 0.006, 0.03, frameMat, 0, TOP + 0.007, sz * (ZS + 0.015)), P.box(1.52, 0.006, 0.03, frameMat, 0, TOP - 0.097, sz * (ZS + 0.015))); // the channel's lips
        frameParts.push(P.box(1.4, 0.04, 0.008, frameMat, 0, TOP + 0.055, sz * 0.188)); // guide rail
        for (const x of [-0.5, 0, 0.5]) frameParts.push(P.box(0.012, 0.09, 0.006, frameMat, x, TOP + 0.02, sz * (ZS + 0.009)), P.box(0.012, 0.008, 0.027, frameMat, x, TOP + 0.06, sz * 0.2045)); // its brackets
      }
      for (const x of [-0.6, 0.6]) {
        for (const sz of [-1, 1]) frameParts.push(P.box(0.04, TOP - 0.13, 0.04, frameMat, x, 0.03 + (TOP - 0.13) / 2, sz * 0.17));
        frameParts.push(P.box(0.04, 0.03, 0.44, frameMat, x, TOP - 0.115, 0), P.box(0.03, 0.03, 0.34, frameMat, x, 0.2, 0));
      }
      frameParts.push(P.box(1.16, 0.03, 0.03, frameMat, 0, 0.2, 0), P.box(0.04, 0.03, 0.03, frameMat, 0.6, 0.45, 0.2)); // the long brace; the pushbutton box's bracket
      const frame = mergeMeshes(THREE, frameParts, frameMat, { consume: true });
      const wear = mergeMeshes(THREE, [-1, 1].map((sz) => P.box(1.4, 0.025, 0.004, M.white, 0, TOP + 0.055, sz * 0.182)), M.white, { consume: true });
      const feet = mergeMeshes(THREE, [-0.6, 0.6].flatMap((x) => [-1, 1].map((sz) => P.cyl(0.022, 0.026, 0.012, M.rubber, x, 0.006, sz * 0.17, 14))), M.rubber, { consume: true });
      const steel = mergeMeshes(THREE, [
        ...[-0.6, 0.6].flatMap((x) => [-1, 1].map((sz) => P.cyl(0.007, 0.007, 0.024, M.steel, x, 0.022, sz * 0.17, 8))), // levelling studs
        ...[-0.45, 0, 0.45].map((x) => alongZ(P.cyl(0.02, 0.02, W + 0.02, M.steel, x, TOP - 0.09, 0, 16))), // return idlers
        ...[-L / 2, L / 2].map((x) => alongZ(P.cyl(0.01, 0.01, 2 * ZS + 0.04, M.steel, x, TOP - 0.035, 0, 10))), // drum shafts
      ], M.steel, { consume: true });
      const drums = mergeMeshes(THREE, [-L / 2, L / 2].map((x) => alongZ(P.cyl(0.035, 0.035, W, M.rubber, x, TOP - 0.035, 0, 24))), M.rubber, { consume: true });
      const tex = beltTex(THREE, L);
      const beltMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
      const belt = P.box(L, 0.006, W, beltMat, 0, TOP - 0.003, 0);
      const ret = P.box(L, 0.004, W, M.rubber, 0, TOP - 0.068, 0); ret.castShadow = false;
      const guards = mergeMeshes(THREE, [-L / 2, L / 2].flatMap((x) => [-1, 1].map((sz) => rb(0.11, 0.1, 0.008, yellow, x, TOP - 0.035, sz * (ZS + 0.01), 0.004, 1))), yellow, { consume: true });
      // gearmotor on the drive drum: gearbox, finned motor barrel, fan cowl, terminal box
      const motorBits = mergeMeshes(THREE, [
        rb(0.1, 0.11, 0.08, graphite, -0.7, TOP - 0.07, ZS + 0.05, 0.012, 2),
        alongX(P.cyl(0.047, 0.047, 0.03, graphite, -0.49, TOP - 0.085, ZS + 0.05, 20)),
        rb(0.05, 0.03, 0.05, graphite, -0.6, TOP - 0.03, ZS + 0.05, 0.005, 1),
      ], graphite, { consume: true });
      const fins = new THREE.MeshStandardMaterial({ map: finTex(THREE), metalness: 0.5, roughness: 0.5 });
      const barrel = alongX(P.cyl(0.045, 0.045, 0.15, fins, -0.58, TOP - 0.085, ZS + 0.05, 20));
      // pushbutton box: E-stop (red mushroom in a yellow collar), a green start button and the status LED
      const box = rb(0.1, 0.14, 0.06, panel, 0.6, 0.45, 0.24, 0.008, 2);
      const collar = alongZ(P.cyl(0.022, 0.022, 0.008, yellow, 0.6, 0.475, 0.274, 20));
      const estop = alongZ(P.cyl(0.016, 0.018, 0.016, paint(THREE, 0xC8261E, 0.35), 0.6, 0.475, 0.286, 20));
      const start = alongZ(P.cyl(0.009, 0.009, 0.008, paint(THREE, 0x2E9E58, 0.4), 0.575, 0.415, 0.274, 14));
      const cable = P.tube([[0.6, 0.38, 0.24], [0.6, 0.3, 0.225], [0.615, 0.1, 0.215], [0.64, 0.012, 0.25], [0.7, 0.008, 0.3]], 0.006);
      const stack = stackLight(THREE, P, M, 0.66, TOP + 0.01, ZS + 0.02, 0x1C3550, 0.12);
      const beacon = stack.lamp;
      const tapeMat = tapeMaterial(THREE);
      const parcels = [0, 1].map((i) => parcel(THREE, rb, M, tapeMat, 0.18, 0.11, 0.14 + 0.03 * i, 0, TOP + 0.055, (i ? 0.03 : -0.04)));
      const root = P.group(sides, frame, wear, feet, steel, drums, belt, ret, guards, motorBits, barrel, box, collar, estop, start, cable, ...stack.parts, beacon, ...parcels);
      const led = statusLed(THREE, root, { at: [0.625, 0.415, 0.273], r: 0.007 });
      const dt = stepper(); let phase = 0, scroll = 0, shown = -1;
      return {
        root,
        update(s, t) {
          const d = dt(t), sp = clamp01(num(s.speed) / 0.5) * 0.5, v = sp * SPEED_K, moving = sp > 0.05;
          scroll = (scroll - (v * d) / 0.1) % 1; tex.offset.x = scroll; // the pattern runs toward +x
          phase = (phase + v * d) % 1.3;
          parcels.forEach((p, i) => { p.visible = sp > 0.01; p.position.x = -0.65 + ((phase + i * 0.65) % 1.3); });
          if (moving !== shown) { shown = moving; beacon.material.emissive.setHex(moving ? 0x3AB7FF : 0x000000); beacon.material.emissiveIntensity = moving ? 2.4 : 0; }
          led.set(s, t, moving ? HEX.blue : HEX.green, 2);
        },
      };
    },
  },

  // A portal over a lane: two posts and a head with cameras. While armed a red scan line sweeps up and down between the
  // posts' light curtains and the beacon on top glows amber.
  scanner_arch: {
    icon: 'scanner', size: 1.2,
    edit: [{ field: 'armed', kind: 'switch' }, { field: 'scanned', kind: 'slider', step: 1, label: 'scanned' }],
    format: (s) => `${s.armed ? 'armed' : 'idle'} · ${Math.round(num(s.scanned))} scanned`,
    active: (s) => !!s.armed,
    control: { kind: 'switch', field: 'armed' },
    // A vision tunnel: T-slot aluminium posts and beam on hazard-striped base plates, a yellow light curtain on each
    // post's inner face (its emitters glow faintly while armed), two downward camera heads and an LED illumination bar
    // under the beam, and a control box on the left post whose screen shows the mode and the count.
    model({ THREE, P, M }) {
      const rb = rounder(P, M), X = 0.52, H = 1.86, CX = X - 0.0575; // posts' centres; the curtains' centres
      const postMat = new THREE.MeshStandardMaterial({ map: slotTex(THREE, false), metalness: 1, roughness: 0.34 });
      const beamMat = new THREE.MeshStandardMaterial({ map: slotTex(THREE, true), metalness: 1, roughness: 0.34 });
      const posts = mergeMeshes(THREE, [-X, X].map((x) => P.box(0.08, H, 0.08, postMat, x, 0.02 + H / 2, 0)), postMat, { consume: true });
      const beam = P.box(2 * X + 0.08, 0.08, 0.08, beamMat, 0, 0.02 + H + 0.04, 0);
      const gussets = mergeMeshes(THREE, [-1, 1].map((sx) => P.box(0.05, 0.05, 0.07, M.anodized, sx * (X - 0.065), H - 0.005, 0)), M.anodized, { consume: true });
      const hazMat = new THREE.MeshStandardMaterial({ map: hazardTex(THREE, 2, 5), roughness: 0.55 });
      const plates = mergeMeshes(THREE, [-X, X].map((x) => P.box(0.16, 0.02, 0.34, hazMat, x, 0.01, 0)), hazMat, { consume: true });
      const bolts = mergeMeshes(THREE, [-X, X].flatMap((x) => [[-0.055, -0.13], [0.055, -0.13], [-0.055, 0.13], [0.055, 0.13]].map(([dx, dz]) => P.cyl(0.012, 0.012, 0.008, M.steel, x + dx, 0.024, dz, 6))), M.steel, { consume: true });
      // light curtains: yellow housings with black end caps, a lens strip facing across the lane
      const yellow = paint(THREE, SAFETY, 0.45);
      const housings = mergeMeshes(THREE, [-CX, CX].map((x) => rb(0.035, 1.68, 0.045, yellow, x, 0.95, 0, 0.006, 1)), yellow, { consume: true });
      const caps = mergeMeshes(THREE, [-CX, CX].flatMap((x) => [0.095, 1.805].map((y) => rb(0.04, 0.03, 0.05, M.black, x, y, 0, 0.005, 1))), M.black, { consume: true });
      const emit = emitterTex(THREE, 1.62 / 0.06);
      const lensMat = new THREE.MeshPhysicalMaterial({ map: emit, emissive: 0xFF3A30, emissiveMap: emit, emissiveIntensity: 0, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 });
      const strips = [-1, 1].map((sx) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 1.62), lensMat); m.position.set(sx * (CX - 0.0178), 0.95, 0); m.rotation.y = -sx * Math.PI / 2; return P.add(m); }); // each faces the lane's centre
      const lineMat = new THREE.MeshBasicMaterial({ color: 0xFF3A3A, transparent: true, opacity: 0.9, depthWrite: false });
      const line = new THREE.Mesh(new THREE.BoxGeometry(2 * (CX - 0.0178), 0.012, 0.012), lineMat); line.position.y = 0.95; line.userData.noAO = true; line.raycast = () => {}; line.visible = false;
      // head: two camera housings looking down, an illumination bar between them
      const shell = paint(THREE, 0xDDE1E3, 0.5), glass = new THREE.MeshPhysicalMaterial({ color: 0x0A0E12, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02 });
      const cams = mergeMeshes(THREE, [-0.26, 0.26].map((x) => rb(0.13, 0.075, 0.1, shell, x, 1.8425, 0, 0.012, 2)), shell, { consume: true });
      const rings = mergeMeshes(THREE, [-0.26, 0.26].map((x) => P.cyl(0.029, 0.029, 0.006, M.black, x, 1.802, 0.01, 24)), M.black, { consume: true });
      const lenses = mergeMeshes(THREE, [-0.26, 0.26].map((x) => P.cyl(0.021, 0.021, 0.006, glass, x, 1.797, 0.01, 24)), glass, { consume: true });
      const bar = rb(0.3, 0.03, 0.06, M.anodized, 0, 1.865, 0, 0.006, 1);
      const illumMat = new THREE.MeshStandardMaterial({ color: 0xE8ECEE, emissive: 0xEFF7FF, emissiveIntensity: 0, roughness: 0.3 });
      const diffuser = P.box(0.28, 0.004, 0.045, illumMat, 0, 1.8495, 0); diffuser.castShadow = false;
      const stack = stackLight(THREE, P, M, 0, 0.02 + H + 0.08, 0, 0x5A3A0A);
      const beacon = stack.lamp;
      // control box: the screen, a green and a black button, the status LED; its cable runs down the post
      const panel = paint(THREE, 0xD9DCDE, 0.55);
      const box = rb(0.16, 0.2, 0.07, panel, -X, 1.35, 0.075, 0.01, 2);
      const hmi = screenTex(THREE, 256, 160);
      const screen = P.screenPlane(0.11, 0.069, hmi.tex); screen.position.set(-X, 1.385, 0.1105);
      const buttons = [[-X - 0.045, paint(THREE, 0x2E9E58, 0.4)], [-X, M.black]].map(([x, m]) => alongZ(P.cyl(0.009, 0.009, 0.008, m, x, 1.295, 0.112, 14)));
      const cable = P.tube([[-X, 1.255, 0.075], [-X, 1.15, 0.052], [-X, 0.5, 0.05], [-X, 0.06, 0.055], [-X + 0.04, 0.028, 0.15], [-X + 0.08, 0.008, 0.25]], 0.006);
      const root = P.group(posts, beam, gussets, plates, bolts, housings, caps, ...strips, cams, rings, lenses, bar, diffuser, ...stack.parts, beacon, box, screen, ...buttons, cable);
      root.add(line);
      const led = statusLed(THREE, root, { at: [-X + 0.055, 1.295, 0.111], r: 0.007 });
      const draw = (mode, n) => {
        const g = hmi.g;
        g.fillStyle = mode === 'fault' ? '#4A0F0B' : mode === 'off' ? '#05070A' : '#0A1218'; g.fillRect(0, 0, 256, 160);
        g.textAlign = 'left'; g.textBaseline = 'middle';
        if (mode === 'fault') { g.fillStyle = '#FF7A62'; g.font = `600 30px ${FONT}`; g.fillText('FAULT', 16, 56); g.fillStyle = '#FFC2B6'; g.font = `20px ${FONT}`; g.fillText('no reply', 16, 104); }
        else if (mode !== 'off') {
          const armed = mode === 'armed';
          g.fillStyle = armed ? '#FFB020' : '#24313A'; g.fillRect(0, 0, 256, 38);
          g.fillStyle = armed ? '#1A1206' : '#A9B8C2'; g.font = `600 22px ${FONT}`; g.fillText(armed ? 'ARMED' : 'IDLE', 14, 20);
          g.fillStyle = '#7FC9D6'; g.font = `18px ${FONT}`; g.fillText('scanned', 14, 62);
          g.fillStyle = '#E8FBFF'; g.font = `600 54px ${FONT}`; g.fillText(String(n), 14, 112);
        }
        hmi.tex.needsUpdate = true;
      };
      let shown = null, shownKey = null;
      return {
        root,
        update(s, t) {
          const armed = !!s.armed;
          line.visible = armed; if (armed) line.position.y = 0.95 + 0.85 * Math.sin(t * 2.2);
          if (armed !== shown) { shown = armed; beacon.material.emissive.setHex(armed ? 0xFFB020 : 0x000000); beacon.material.emissiveIntensity = armed ? 2.6 : 0; lensMat.emissiveIntensity = armed ? 0.8 : 0; illumMat.emissiveIntensity = armed ? 1.4 : 0; }
          const mode = s.status === 'offline' ? 'off' : s.status === 'fault' ? 'fault' : armed ? 'armed' : 'idle', n = Math.max(0, Math.round(num(s.scanned))), key = `${mode}:${n}`;
          if (key !== shownKey) { shownKey = key; draw(mode, n); }
          led.set(s, t, armed ? HEX.amber : HEX.green, 2);
        },
      };
    },
  },

  // A short belt with a diverter paddle at its end and a side belt leaving to lane B. Lane A leaves the paddle along the
  // edge; lane B swings it across the belt.
  sorter_gate: {
    icon: 'gate', size: 0.8,
    format: (s) => `→ lane ${s.lane === 'B' ? 'B' : 'A'}`,
    active: (s) => s.lane === 'B',
    control: false,
    // A pneumatic paddle diverter: a yellow paddle with a black wear face on a pivot shaft, pushed by a square-cap air
    // cylinder (its rod follows the paddle) on a bracket outside the frame, fed by a blue air line from a solenoid valve.
    // A photo-eye and its reflector look across the belt ahead of it; the -z side frame stops short to let lane B out.
    model({ THREE, P, M }) {
      const TOP = 0.4, rb = rounder(P, M), frameMat = galv(THREE), yellow = paint(THREE, SAFETY, 0.45), panel = paint(THREE, 0xD9DCDE, 0.55);
      const main = P.box(0.55, 0.006, 0.26, new THREE.MeshStandardMaterial({ map: beltTex(THREE, 0.55), roughness: 0.85 }), -0.125, TOP - 0.003, 0.1);
      const drums = mergeMeshes(THREE, [-0.378, 0.15].map((x) => alongZ(P.cyl(0.022, 0.022, 0.26, M.rubber, x, TOP - 0.022, 0.1, 18))), M.rubber, { consume: true });
      const frame = mergeMeshes(THREE, [
        P.box(0.55, 0.07, 0.012, frameMat, -0.125, TOP - 0.03, 0.236), P.box(0.4, 0.07, 0.012, frameMat, -0.2, TOP - 0.03, -0.036),
        ...[[-0.37, -0.01], [-0.37, 0.21], [0.12, 0.21], [0.2, -0.17]].map(([x, z]) => P.box(0.03, TOP - 0.03, 0.03, frameMat, x, (TOP - 0.03) / 2, z)),
        P.box(0.2, 0.01, 0.14, frameMat, 0.04, TOP + 0.012, 0.312), P.box(0.024, 0.013, 0.024, frameMat, 0.09, TOP + 0.0235, 0.372), // cylinder bracket and its pivot block
        P.box(0.008, 0.05, 0.008, frameMat, -0.2, TOP + 0.025, 0.25), P.box(0.008, 0.05, 0.008, frameMat, -0.2, TOP + 0.025, -0.05), // photo-eye posts
      ], frameMat, { consume: true });
      // lane B: its belt, side frames and tail drum, turned toward -z
      const bMat = new THREE.MeshStandardMaterial({ map: beltTex(THREE, 0.26), roughness: 0.85 });
      const branch = P.group(P.box(0.26, 0.006, 0.22, bMat, 0, 0, 0), mergeMeshes(THREE, [-1, 1].map((sz) => P.box(0.26, 0.05, 0.01, frameMat, 0, -0.02, sz * 0.115)), frameMat, { consume: true }), alongZ(P.cyl(0.02, 0.02, 0.22, M.rubber, 0.115, -0.019, 0, 16)));
      branch.position.set(0.22, TOP - 0.003, -0.1); branch.rotation.y = 0.55;
      // the paddle on its shaft (hinge at its -x end), a lug on its back for the cylinder's rod
      const paddle = [P.cyl(0.012, 0.012, 0.1, M.steel, 0, 0, 0, 14), P.cyl(0.02, 0.02, 0.03, M.anodized, 0, 0.0, 0, 16), rb(0.3, 0.07, 0.012, yellow, 0.16, 0, 0, 0.004, 1), P.box(0.28, 0.05, 0.004, M.rubber, 0.165, 0, -0.008), P.box(0.014, 0.02, 0.01, M.steel, 0.12, 0, 0.011)];
      const arm = P.group(...paddle); arm.position.set(-0.02, TOP + 0.04, 0.22);
      const LUG = [0.12, 0.012]; // the rod's end on the paddle, in the paddle's x, z
      // the air cylinder, built along +x from its pivot; turned toward the lug and its rod stretched to it every frame
      const BASE = [0.09, TOP + 0.04, 0.372];
      const alu = new THREE.MeshStandardMaterial({ color: 0xC9CED2, metalness: 1, roughness: 0.3 });
      const tubeGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.1, 16).rotateZ(-Math.PI / 2).translate(0.062, 0, 0);
      const rodGeo = new THREE.CylinderGeometry(0.005, 0.005, 1, 10).rotateZ(-Math.PI / 2).translate(0.5, 0, 0);
      const cylBody = new THREE.Mesh(tubeGeo, alu), rod = new THREE.Mesh(rodGeo, M.metal), clevis = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.016, 0.014), M.steel);
      const endCaps = [0.006, 0.018, 0.106].map((x, i) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.012, i ? 0.038 : 0.02, i ? 0.038 : 0.014), i ? M.anodized : M.steel); m.position.x = x; return m; });
      rod.position.x = 0.112;
      const cyl = new THREE.Group(); cyl.add(cylBody, rod, clevis, ...endCaps); cyl.position.set(...BASE);
      cyl.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
      const valve = rb(0.045, 0.022, 0.028, M.anodized, -0.01, TOP + 0.028, 0.33, 0.003, 1);
      const coil = rb(0.022, 0.028, 0.024, M.black, -0.045, TOP + 0.031, 0.33, 0.003, 1);
      const hose = P.tube([[0.012, TOP + 0.03, 0.33], [0.05, TOP + 0.05, 0.35], [0.09, TOP + 0.06, 0.372]], 0.0035, paint(THREE, 0x2E6FB0, 0.5));
      const eye = rb(0.02, 0.028, 0.024, M.black, -0.2, TOP + 0.064, 0.25, 0.003, 1);
      const reflector = alongZ(P.cyl(0.012, 0.012, 0.004, new THREE.MeshPhysicalMaterial({ color: 0xB0201A, roughness: 0.2, clearcoat: 1 }), -0.2, TOP + 0.064, -0.045, 16));
      const ctrl = rb(0.06, 0.05, 0.04, panel, -0.36, TOP + 0.02, 0.27, 0.005, 1);
      const gland = P.cyl(0.006, 0.006, 0.012, M.black, -0.36, TOP - 0.01, 0.27, 10);
      const root = P.group(main, drums, frame, branch, valve, coil, hose, eye, reflector, ctrl, gland);
      root.add(arm, cyl);
      const led = statusLed(THREE, root, { at: [-0.36, TOP + 0.0455, 0.27], r: 0.006 });
      const dt = stepper(); let ang = 0;
      return {
        root,
        update(s, t) {
          ang = ease(ang, s.lane === 'B' ? 0.62 : 0, dt(t), 6);
          arm.rotation.y = ang; // positive turns +x toward -z: across the belt, toward the lane B belt
          const c = Math.cos(ang), sn = Math.sin(ang);
          const lx = arm.position.x + LUG[0] * c + LUG[1] * sn - BASE[0], lz = arm.position.z - LUG[0] * sn + LUG[1] * c - BASE[2], d = Math.hypot(lx, lz);
          cyl.rotation.y = Math.atan2(-lz, lx); rod.scale.x = Math.max(0.001, d - 0.124); clevis.position.x = d - 0.006;
          led.set(s, t, s.lane === 'B' ? HEX.blue : HEX.green, 2);
        },
      };
    },
  },

  // A small driverless cart on a taped loop with three stops: the dock (orange), the aisle (grey) and the charger
  // (green). It circles the loop while `driving` is true and settles on its stop when it stops.
  cart: {
    icon: 'cart', size: 1.0,
    format: (s) => (s.driving ? 'driving' : `at the ${String(s.at || 'dock')}`),
    active: (s) => !!s.driving,
    control: false,
    // An autonomous mobile robot (it drives itself between stops and docks to charge), so it stays code-built rather
    // than a push cart: a low light-grey body on a rubber bumper skirt, a yellow safety scanner at the front, head and
    // tail lights, a ribbed deck mat, an E-stop on the rear corner, two drive wheels and four casters, and charging
    // contacts on its -z side that meet the charger's when it parks on the green pad (front = +x).
    model({ THREE, P, M }) {
      const R = 0.3, rb = rounder(P, M);
      const tape = new THREE.Mesh(new THREE.RingGeometry(R - 0.012, R + 0.012, 64), new THREE.MeshStandardMaterial({ color: 0xE3B21F, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -1 }));
      tape.rotation.x = -Math.PI / 2; tape.position.y = 0.002; tape.receiveShadow = true; tape.userData.noAO = true; tape.raycast = () => {};
      const padMat = (hex) => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.8 });
      const chargeMat = new THREE.MeshStandardMaterial({ color: 0x1F6B45, emissive: 0x2FBF71, emissiveIntensity: 0, roughness: 0.6 });
      const pads = Object.entries(CART_SPOT).map(([k, a]) => {
        const p = P.box(0.17, 0.004, 0.17, k === 'dock' ? padMat(0xE08A2E) : k === 'aisle' ? padMat(0x8E9499) : chargeMat, R * Math.cos(a), 0.002, R * Math.sin(a));
        p.castShadow = false; return p;
      });
      // the charger beside its pad: a graphite unit, two contact plates facing the loop, its light bar glowing while charging
      const graphite = paint(THREE, 0x33383D, 0.5), copper = new THREE.MeshStandardMaterial({ color: 0xC98B5A, metalness: 1, roughness: 0.3 });
      const charger = rb(0.06, 0.15, 0.2, graphite, 0.468, 0.075, 0, 0.012, 2);
      const chargerPlates = mergeMeshes(THREE, [0.066, 0.083].map((y) => P.box(0.004, 0.008, 0.12, copper, 0.437, y, 0)), copper, { consume: true });
      const chargeBar = P.box(0.03, 0.004, 0.14, chargeMat, 0.468, 0.151, 0); chargeBar.castShadow = false;
      const shell = paint(THREE, 0xE4E7E9, 0.45), yellow = paint(THREE, SAFETY, 0.45);
      const body = rb(0.34, 0.07, 0.22, shell, 0, 0.065, 0, 0.02, 2);
      const skirt = rb(0.35, 0.03, 0.23, M.rubber, 0, 0.035, 0, 0.012, 1);
      const deckMat = new THREE.MeshStandardMaterial({ map: ribTex(THREE, 0.3 / 0.012), roughness: 0.9 });
      const deck = P.box(0.3, 0.006, 0.19, deckMat, 0, 0.103, 0);
      const scanner = rb(0.024, 0.028, 0.07, yellow, 0.17, 0.064, 0, 0.004, 1);
      const scanWin = new THREE.MeshPhysicalMaterial({ color: 0x0A0C0E, roughness: 0.08, clearcoat: 1 });
      const windows = mergeMeshes(THREE, [P.box(0.004, 0.012, 0.06, scanWin, 0.183, 0.062, 0), P.box(0.004, 0.012, 0.1, scanWin, -0.171, 0.075, 0)], scanWin, { consume: true }); // front scanner window; rear sensor strip
      const headMat = new THREE.MeshStandardMaterial({ color: 0xF4F7F8, emissive: 0xEAF4FF, emissiveIntensity: 0.8, roughness: 0.3 });
      const tailMat = new THREE.MeshStandardMaterial({ color: 0x5A1412, emissive: 0xE0302A, emissiveIntensity: 0.8, roughness: 0.3 });
      const heads = mergeMeshes(THREE, [-1, 1].map((sz) => P.box(0.004, 0.008, 0.03, headMat, 0.171, 0.088, sz * 0.075)), headMat, { consume: true });
      const tails = mergeMeshes(THREE, [-1, 1].map((sz) => P.box(0.004, 0.008, 0.03, tailMat, -0.171, 0.088, sz * 0.075)), tailMat, { consume: true });
      const estop = [P.cyl(0.013, 0.013, 0.006, yellow, -0.148, 0.103, 0.083, 16), P.cyl(0.01, 0.011, 0.01, paint(THREE, 0xC8261E, 0.35), -0.148, 0.111, 0.083, 16)];
      const antenna = P.cyl(0.004, 0.005, 0.05, M.black, -0.15, 0.13, -0.085, 8);
      const contacts = mergeMeshes(THREE, [0.066, 0.083].map((y) => P.box(0.08, 0.006, 0.004, copper, 0, y, -0.111)), copper, { consume: true });
      const wheels = mergeMeshes(THREE, [
        ...[-1, 1].map((sz) => alongZ(P.cyl(0.028, 0.028, 0.022, M.rubber, 0, 0.028, sz * 0.095, 18))),
        ...[[-0.12, -0.075], [0.12, -0.075], [-0.12, 0.075], [0.12, 0.075]].map(([x, z]) => alongZ(P.cyl(0.014, 0.014, 0.012, M.rubber, x, 0.014, z, 12))),
      ], M.rubber, { consume: true });
      const hubs = mergeMeshes(THREE, [-1, 1].map((sz) => alongZ(P.cyl(0.016, 0.016, 0.024, M.steel, 0, 0.028, sz * 0.095, 14))), M.steel, { consume: true });
      const cart = P.group(body, skirt, deck, scanner, windows, heads, tails, ...estop, antenna, contacts, wheels, hubs);
      const root = P.group(tape, ...pads, charger, chargerPlates, chargeBar);
      root.add(cart);
      const led = statusLed(THREE, cart, { at: [-0.155, 0.11, 0], r: 0.007 });
      const dt = stepper(); let ang = CART_SPOT.dock, shown = null, lit = null;
      return {
        root,
        update(s, t) {
          const d = dt(t), goal = CART_SPOT[s.at] ?? CART_SPOT.dock;
          if (s.driving) ang = wrapPi(ang + 1.25 * d);
          else { const gap = wrapPi(goal - ang); ang = Math.abs(gap) < 0.01 ? goal : wrapPi(ang + gap * Math.min(1, d * 5)); }
          cart.position.set(R * Math.cos(ang), 0, R * Math.sin(ang)); cart.rotation.y = -ang - Math.PI / 2; // heading along the loop
          const charging = !s.driving && s.at === 'charger';
          if (charging !== shown) { shown = charging; chargeMat.emissiveIntensity = charging ? 1.6 : 0; }
          const on = s.status !== 'offline'; // an offline robot shows no head or tail lights
          if (on !== lit) { lit = on; headMat.emissiveIntensity = tailMat.emissiveIntensity = on ? 0.8 : 0; }
          led.set(s, t, s.driving ? HEX.amber : HEX.green, 2);
        },
      };
    },
  },

  // A roller door on the wall at a loading dock, with its guides, bumpers, a dock leveller and a signal light (green
  // open, red closed). The door rolls up into its coil box over 3 s; parcels pile up in the doorway as they arrive.
  loading_dock: {
    icon: 'dock', size: 1.6, mountY: 1.05,
    edit: [{ field: 'open', kind: 'switch' }, { field: 'parcels', kind: 'slider', step: 1, label: 'parcels' }],
    format: (s) => { const n = Math.round(num(s.parcels)); return `${s.open ? 'open' : 'closed'} · ${n} ${n === 1 ? 'parcel' : 'parcels'}`; },
    active: (s) => !!s.open,
    control: { kind: 'switch', field: 'open' },
    // A galvanised slatted roller shutter (slats drawn on a texture, so they keep their size as the curtain rolls up)
    // with an aluminium bottom bar and rubber seal, running in steel guides with hazard-striped impact guards at their
    // feet, under a rounded coil box. In front: a diamond-plate leveller with striped toe guards, two laminated rubber
    // bumpers, a two-lamp dock signal, and a pushbutton station (up, stop, down) on the left guide.
    model({ THREE, P, M }) {
      const H = 1.9, TOPY = 0.85, F = -1.05, rb = rounder(P, M); // the opening runs from the floor (F) to TOPY
      const frameMat = galv(THREE), panel = paint(THREE, 0xD9DCDE, 0.55);
      const guides = mergeMeshes(THREE, [-0.73, 0.73].map((x) => P.box(0.1, 2.0, 0.08, frameMat, x, F + 1.0, 0.04)), frameMat, { consume: true });
      const slots = mergeMeshes(THREE, [-0.68, 0.68].map((x) => P.box(0.02, 1.9, 0.03, M.anodized, x, F + 0.95, 0.04)), M.anodized, { consume: true }); // the channels the curtain runs in
      const hazMat = new THREE.MeshStandardMaterial({ map: hazardTex(THREE, 1.5, 7), roughness: 0.55 });
      const impact = mergeMeshes(THREE, [-0.73, 0.73].map((x) => P.box(0.11, 0.5, 0.09, hazMat, x, F + 0.25, 0.045)), hazMat, { consume: true });
      const coil = rb(1.5, 0.16, 0.16, frameMat, 0, 0.93, 0.08, 0.05, 2);
      const ends = mergeMeshes(THREE, [-0.756, 0.756].map((x) => P.box(0.012, 0.17, 0.158, M.steel, x, 0.93, 0.08)), M.steel, { consume: true });
      const dark = new THREE.MeshStandardMaterial({ color: 0x15181B, roughness: 1 });
      const recess = P.box(1.36, H, 0.01, dark, 0, F + H / 2, 0.005);
      const slatT = slatTex(THREE); slatT.repeat.set(1, 19);
      const slatMat = new THREE.MeshStandardMaterial({ map: slatT, bumpMap: slatT, bumpScale: 1.2, metalness: 0.55, roughness: 0.45 });
      const door = P.box(1.34, H, 0.02, slatMat, 0, -H / 2, 0);
      const doorPivot = P.group(door); doorPivot.position.set(0, TOPY, 0.04);
      const bottom = P.group(P.box(1.36, 0.05, 0.035, M.metal, 0, 0, 0), P.box(1.34, 0.012, 0.026, M.rubber, 0, -0.031, 0)); bottom.position.set(0, F + 0.037, 0.04);
      // leveller: tread plate, hinge, striped toe guards and front edge
      const plate = P.box(1.1, 0.025, 0.42, new THREE.MeshStandardMaterial({ map: treadTex(THREE, 1.1 / 0.05, 0.42 / 0.05), metalness: 0.9, roughness: 0.42 }), 0, F + 0.0125, 0.25); plate.castShadow = false;
      const hinge = alongX(P.cyl(0.012, 0.012, 1.1, M.steel, 0, F + 0.026, 0.078, 12)); hinge.castShadow = false;
      const toeMat = new THREE.MeshStandardMaterial({ map: hazardTex(THREE, 0.42 / 0.052, 0.5), roughness: 0.55 }), edgeMat = new THREE.MeshStandardMaterial({ map: hazardTex(THREE, 1.13 / 0.052, 0.5), roughness: 0.55 });
      const toes = mergeMeshes(THREE, [-1, 1].map((sx) => P.box(0.016, 0.027, 0.42, toeMat, sx * 0.558, F + 0.0135, 0.25)), toeMat, { consume: true }); toes.castShadow = false;
      const edge = P.box(1.13, 0.027, 0.016, edgeMat, 0, F + 0.0135, 0.468); edge.castShadow = false;
      // bumpers: rubber laminate between steel angles
      const lamMat = new THREE.MeshStandardMaterial({ map: laminateTex(THREE), roughness: 0.92 }); lamMat.map.repeat.set(1, 0.24 / 0.08);
      const bumpers = mergeMeshes(THREE, [-0.625, 0.625].map((x) => P.box(0.1, 0.22, 0.11, lamMat, x, F + 0.13, 0.115)), lamMat, { consume: true });
      const angles = mergeMeshes(THREE, [-0.625, 0.625].flatMap((x) => [F + 0.012, F + 0.248].map((y) => P.box(0.11, 0.012, 0.12, M.steel, x, y, 0.115))), M.steel, { consume: true });
      // dock signal: red over green in a black housing with visors
      const housing = rb(0.08, 0.16, 0.05, M.black, 0.62, 1.12, 0.025, 0.01, 2);
      const visors = mergeMeshes(THREE, [1.168, 1.098].map((y) => P.box(0.056, 0.005, 0.03, M.black, 0.62, y, 0.064)), M.black, { consume: true });
      const red = P.add(alongZ(lens(THREE, 0.021, 0.012, 0x3A0F0C))); red.position.set(0.62, 1.155, 0.054);
      const green = P.add(alongZ(lens(THREE, 0.021, 0.012, 0x0E2A18))); green.position.set(0.62, 1.085, 0.054);
      // pushbutton station on the left guide: up and down (black), stop (red), the status LED above them
      const station = rb(0.09, 0.15, 0.05, panel, -0.73, 0.0, 0.105, 0.008, 2);
      const btns = [[0.035, M.black], [0, paint(THREE, 0xC8261E, 0.35)], [-0.035, M.black]].map(([y, m]) => alongZ(P.cyl(0.011, 0.011, 0.008, m, -0.73, y - 0.01, 0.134, 16)));
      const tapeMat = tapeMaterial(THREE), base = F + 0.025; // parcels stand on the leveller
      // [x, height above the plate, z, w, h]: three on the plate, two on those, one on top
      const boxes = [[-0.4, 0, 0.27, 0.26, 0.3], [0, 0, 0.27, 0.32, 0.26], [0.42, 0, 0.27, 0.24, 0.3], [-0.2, 0.3, 0.27, 0.26, 0.22], [0.2, 0.26, 0.27, 0.26, 0.2], [0.02, 0.5, 0.27, 0.22, 0.2]]
        .map(([x, b, z, w, h]) => parcel(THREE, rb, M, tapeMat, w, h, 0.26, x, base + b + h / 2, z));
      const root = P.group(guides, slots, impact, coil, ends, recess, doorPivot, bottom, plate, hinge, toes, edge, bumpers, angles, housing, visors, red, green, station, ...btns, ...boxes);
      const led = statusLed(THREE, root, { at: [-0.73, 0.055, 0.131], r: 0.007 });
      const dt = stepper(); let up = 0, shown = null, shownN = -1, shownK = -1;
      return {
        root,
        update(s, t) {
          const open = !!s.open, d = dt(t);
          up = Math.abs((open ? 1 : 0) - up) < 0.001 ? (open ? 1 : 0) : up + Math.sign((open ? 1 : 0) - up) * Math.min(Math.abs((open ? 1 : 0) - up), d / 3); // 3 s
          const k = Math.max(0.02, 1 - 0.98 * up);
          if (k !== shownK) { shownK = k; doorPivot.scale.y = k; slatT.repeat.y = 19 * k; bottom.position.y = TOPY - H * k + 0.037; } // slats keep their 10 cm as the curtain shortens
          if (open !== shown) {
            shown = open;
            green.material.emissive.setHex(0x2FBF71); green.material.emissiveIntensity = open ? 2.4 : 0;
            red.material.emissive.setHex(0xE0563A); red.material.emissiveIntensity = open ? 0 : 2.4;
          }
          const n = Math.round(num(s.parcels)), vis = n <= 0 ? 0 : Math.min(boxes.length, 1 + Math.floor(n / 40));
          if (vis !== shownN) { shownN = vis; boxes.forEach((b, i) => { b.visible = i < vis; }); }
          led.set(s, t, open ? HEX.green : HEX.amber, 2);
        },
      };
    },
  },
};
