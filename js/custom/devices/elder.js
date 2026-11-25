// The Elder care types' card UI and 3D models for the custom room (contract: devices/index.js). Their look follows the
// elder scene (js/scenes/elder.js): a bed with a sleep sensor strip, a panelled door with a contact sensor, a hallway
// PIR, a kettle on its smart power base, a plug-in night light and a flush hall light. Each is a compact,
// self-contained model of the real product with its own status LED.
import { HEX, num, clamp01, pct, statusLed, pointLight, mergeMeshes, canvasTex } from './kit.js';

const on3 = (s) => !!s.on;
const dimmer = (s) => { const r = pct(s.brightness); return r <= 0 ? 'off' : r >= 100 ? 'full' : `on · ${r}%`; };

// ---- shared helpers (local to this file) ----

// A mesh at (x, y, z), not yet in the scene (P.group gathers it). Tiny parts pass shadow = false.
function part(THREE, geo, mat, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true; return m;
}

// A rounded box as one smooth mesh, built like a rounded cube: each face's grid bends round the edges with radius r,
// `seg` samples per 45° of bend (1 is a chamfer that shades round) and `div` cuts across the flat part, for a model
// that deforms it (the pillow). UVs run 0–1 across each face (a canvas lands whole on a face), or in metres × uvScale
// (wood grain). Far fewer triangles than RoundedBoxGeometry's fixed nine-by-nine faces.
function rbox(THREE, w, h, d, r, { seg = 2, div = [1, 1, 1], uvScale = 0 } = {}) {
  const half = [w / 2, h / 2, d / 2];
  r = Math.max(1e-4, Math.min(r, ...half.map((x) => x - 1e-4)));
  const a = half.map((x) => x - r), bend = (k) => r * Math.tan((k / seg) * (Math.PI / 4));
  const axis = (i) => {
    const s = [];
    for (let k = seg; k >= 1; k--) s.push(-a[i] - bend(k));
    for (let j = 0; j <= div[i]; j++) s.push(-a[i] + (2 * a[i] * j) / div[i]);
    for (let k = 1; k <= seg; k++) s.push(a[i] + bend(k));
    return s;
  };
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
    for (let j = 0; j < V.length - 1; j++) for (let i = 0; i < U.length - 1; i++) {
      const A = base + j * U.length + i, B = A + 1, C = A + U.length + 1, D = A + U.length;
      idx.push(A, B, C, A, C, D);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
  return geo;
}

// A turned profile [[r, y], …] about y. Walk it with the solid on the left (r to the right, y up) so faces point out.
const lathe = (THREE, pts, n = 48) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), n);
// A cable through points (a TubeGeometry), too thin to need a shadow.
const cable = (THREE, pts, r, mat, n = 24) => part(THREE, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), n, r, 6), mat, 0, 0, 0, false);
// A cylinder lying along z (a rose, a screw head), for merging.
const disc = (THREE, r, h, mat, x, y, z, n = 24) => { const g = new THREE.CylinderGeometry(r, r, h, n); g.rotateX(Math.PI / 2); return part(THREE, g, mat, x, y, z, false); };
const smooth = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };

// Finishes: matte ABS, glossy ABS, brushed steel, cable sheath.
const absMat = (THREE, hex = 0xF1F2F0) => new THREE.MeshPhysicalMaterial({ color: hex, roughness: 0.58, clearcoat: 0.1, clearcoatRoughness: 0.5 });
const glossMat = (THREE, hex = 0xF4F5F2) => new THREE.MeshPhysicalMaterial({ color: hex, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.15 });
const steelMat = (THREE, hex = 0xC6CACE) => new THREE.MeshStandardMaterial({ color: hex, metalness: 1, roughness: 0.3 });
const cordMat = (THREE) => new THREE.MeshStandardMaterial({ color: 0xE9EBEA, roughness: 0.5 });

// A soft round falloff texture (centre bright, edge clear), for a glow or a diffuser's hot spot.
function radialTex(THREE, stops, size = 128) {
  const t = canvasTex(THREE, (g, w, h) => { const rg = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); for (const [k, c] of stops) rg.addColorStop(k, c); g.fillStyle = rg; g.fillRect(0, 0, w, h); }, size, size);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}

// ---- the bed's soft parts ----

// The duvet as one draped sheet: flat on the mattress, rolled over its sides and foot and hanging down, its head edge
// rolled down onto the sheet. Each axis maps a distance from the centre to a position and a drop (fold); the corners
// take the larger drop, so the side and foot drapes meet in a crease like a real box corner. With a sleeper, a body
// shape lifts it (torso, hips, legs, toes) and the head edge rests on the chest.
const BED = { top: 0.452, flatX: 0.447, rollX: 0.045, hangX: 0.15, headZ: -0.378, rollH: 0.022, hangH: 0.004, footZ: 0.917, rollF: 0.045, hangF: 0.15 };
function fold(t, flat, rr, hang) {
  if (t <= flat) return [t, 0];
  const s = t - flat, arc = (rr * Math.PI) / 2;
  if (s <= arc) return [flat + rr * Math.sin(s / rr), rr * (1 - Math.cos(s / rr))];
  return [flat + rr, rr + Math.min(s - arc, hang)];
}
const bump = (x, z, cx, cz, rx, rz, h) => { const d = Math.hypot((x - cx) / rx, (z - cz) / rz); return d >= 1 ? 0 : h * Math.cos((d * Math.PI) / 2) ** 2; };
const sleeperShape = (x, z) => Math.max(
  bump(x, z, 0, -0.25, 0.27, 0.42, 0.14), bump(x, z, 0, 0.15, 0.25, 0.3, 0.11), // chest and hips
  bump(x, z, -0.09, 0.5, 0.11, 0.42, 0.075), bump(x, z, 0.09, 0.5, 0.11, 0.42, 0.075), // legs
  bump(x, z, -0.085, 0.8, 0.07, 0.08, 0.1), bump(x, z, 0.085, 0.8, 0.07, 0.08, 0.1), // toes up
);
function duvetGeo(THREE, occupied) {
  const B = BED, arcX = (B.rollX * Math.PI) / 2, arcH = (B.rollH * Math.PI) / 2, arcF = (B.rollF * Math.PI) / 2;
  const HL = (B.footZ - B.headZ) / 2, ZC = (B.footZ + B.headZ) / 2, SX = B.flatX + arcX + B.hangX;
  // samples bunched into the rolls, where the sheet bends
  const axis = (start, pieces) => { const s = [start]; let at = start; for (const [len, n] of pieces) { for (let i = 1; i <= n; i++) s.push(at + (len * i) / n); at += len; } return s; };
  const xs = axis(-SX, [[B.hangX, 2], [arcX, 4], [2 * B.flatX, 18], [arcX, 4], [B.hangX, 2]]);
  const zs = axis(-(HL + arcH + B.hangH), [[B.hangH, 1], [arcH, 3], [2 * HL, 24], [arcF, 4], [B.hangF, 2]]);
  const z0 = zs[0], zSpan = zs[zs.length - 1] - z0, pos = [], uv = [], idx = [];
  for (const q of zs) for (const s of xs) {
    const [hx, dx] = fold(Math.abs(s), B.flatX, B.rollX, B.hangX);
    const [hz, dz] = q < 0 ? fold(-q, HL, B.rollH, B.hangH) : fold(q, HL, B.rollF, B.hangF);
    let x = Math.sign(s) * hx, z = q < 0 ? ZC - hz : ZC + hz;
    // loft: thin at the edges, fuller across the middle, in soft quilted channels, with a faint crumple
    const k = smooth((B.flatX - hx) / 0.14) * smooth((HL - hz) / 0.12);
    const loft = 0.012 + k * (0.02 + 0.007 * Math.cos((Math.PI * (z - B.headZ)) / 0.25) ** 2 + 0.003 * Math.sin(x * 9 + z * 4) * Math.sin(z * 7));
    const y = B.top + loft + (occupied ? sleeperShape(x, z) : 0) - Math.max(dx, dz);
    // the drapes hang in soft vertical folds
    if (dx > B.rollX) x += Math.sign(s) * 0.007 * Math.sin(z * 17) * ((dx - B.rollX) / B.hangX);
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

// Door architrave: a moulded profile [across, depth], thick at the opening and thin at its outer edge, run along an
// edge of the opening; m turns the profile's (across, depth, run) into the door's axes (always a rotation, so faces
// stay outward).
const CASING = [[0, 0], [0.065, 0], [0.065, 0.009], [0.056, 0.011], [0.042, 0.013], [0.028, 0.016], [0.016, 0.019], [0.008, 0.021], [0.003, 0.021], [0, 0.018]];
function casing(THREE, len, m) {
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(CASING.map(([a, d]) => new THREE.Vector2(a, d))), { depth: len, bevelEnabled: false });
  return g.applyMatrix4(m);
}

export default {
  // A single bed (1 × 2 m, head at the back): an oak frame with a boarded headboard, a mattress in a fitted sheet, a
  // pillow and a draped duvet. The sleep sensor is a strip under the mattress at chest height; its end clips over the
  // side rail into a small hub on the rail, whose light bar glows while someone is in bed (the strip's own colour, as
  // the old pressure mat's). Occupied, a sleeper lies under the duvet: the duvet takes their shape, the head on the pillow.
  bed_sensor: {
    icon: 'bed', size: 2,
    edit: [{ field: 'occupied', kind: 'switch', label: 'in bed' }],
    format: (s) => (s.occupied ? 'in bed' : 'out of bed'),
    active: (s) => !!s.occupied,
    control: false,
    model({ THREE, P, M }) {
      const W = { seg: 1, uvScale: 1.5 }, R = (w, h, d, r, x, y, z) => part(THREE, rbox(THREE, w, h, d, r, W), M.woodLight, x, y, z);
      const frame = mergeMeshes(THREE, [
        ...[-1, 1].map((sx) => R(0.065, 1.0, 0.065, 0.012, sx * 0.4675, 0.5, -0.9675)), // head posts (the legs too)
        R(1.0, 0.07, 0.065, 0.02, 0, 0.965, -0.9675), R(0.87, 0.07, 0.05, 0.01, 0, 0.3, -0.9675), // cap and lower rail
        ...[0, 1, 2, 3, 4].map((i) => R(0.174, 0.6, 0.024, 0.006, -0.348 + i * 0.174, 0.63, -0.968)), // boards: their rounded edges read as V-grooves
        ...[-1, 1].map((sx) => R(0.04, 0.13, 1.87, 0.008, sx * 0.48, 0.185, 0)), // side rails
        ...[-1, 1].map((sx) => R(0.065, 0.29, 0.065, 0.012, sx * 0.4675, 0.145, 0.9675)), R(0.87, 0.15, 0.04, 0.008, 0, 0.175, 0.97), // low foot end
      ], M.woodLight, { consume: true });
      // The fitted sheet: piping round each face of the mattress (a border on a face-wide canvas).
      const piping = canvasTex(THREE, (g, w, h) => { g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, w, h); g.strokeStyle = '#D9D7D1'; g.lineWidth = 3; g.strokeRect(7, 7, w - 14, h - 14); }, 128, 128);
      const mattress = part(THREE, rbox(THREE, 0.93, 0.2, 1.87, 0.045), new THREE.MeshPhysicalMaterial({ color: 0xF1F0EC, map: piping, roughness: 0.92, sheen: 0.6, sheenRoughness: 0.6, sheenColor: 0xFFFFFF }), 0, 0.352, 0);
      // Pillow: a soft box squeezed thin toward its edges.
      const pg = rbox(THREE, 0.6, 0.13, 0.38, 0.055, { seg: 2, div: [5, 1, 3] }), pp = pg.attributes.position;
      for (let i = 0; i < pp.count; i++) { const k = Math.max(Math.abs(pp.getX(i)) / 0.3, Math.abs(pp.getZ(i)) / 0.19); pp.setY(i, pp.getY(i) * (1 - 0.5 * Math.min(1, k) ** 3)); }
      pg.computeVertexNormals();
      const fabric = (hex, bump) => new THREE.MeshPhysicalMaterial({ color: hex, roughness: 0.92, sheen: 1, sheenRoughness: 0.45, sheenColor: 0xFFFFFF, bumpMap: M.cushion.bumpMap, bumpScale: bump });
      const pillow = part(THREE, pg, fabric(0xF7F5F1, 0.25), 0, 0.512, -0.75); pillow.rotation.y = 0.03;
      const duvetMat = fabric(0xD4E0DF, 0.35); duvetMat.side = THREE.DoubleSide; duvetMat.sheenColor.setHex(0xF4FAFA);
      const duvet = part(THREE, duvetGeo(THREE, false), duvetMat), duvetIn = part(THREE, duvetGeo(THREE, true), duvetMat);
      // The sleeper: a head with grey hair on the pillow and pyjama shoulders under the duvet's edge.
      const head = part(THREE, new THREE.SphereGeometry(0.08, 14, 10), new THREE.MeshStandardMaterial({ color: 0xE2BEA4, roughness: 0.62 }), 0, 0, 0);
      const hair = part(THREE, new THREE.SphereGeometry(0.084, 14, 8, Math.PI, Math.PI), new THREE.MeshStandardMaterial({ color: 0xCFCBC4, roughness: 0.85 }), 0, 0, 0, false); // the crown half, toward the headboard
      const skull = P.group(head, hair); skull.position.set(0, 0.585, -0.735); skull.scale.set(0.95, 0.88, 1.05);
      const shoulders = part(THREE, rbox(THREE, 0.42, 0.08, 0.22, 0.035, { seg: 1 }), fabric(0xAFC0CC, 0.3), 0, 0.488, -0.5);
      const sleeper = P.group(skull, shoulders);
      // The sensor: the strip (under the mattress, chest height) and the hub's light bar share the old mat's material.
      const matMat = new THREE.MeshStandardMaterial({ color: 0x2F3A3A, emissive: 0x2FBF71, emissiveIntensity: 0, roughness: 0.6 });
      const strip = mergeMeshes(THREE, [
        part(THREE, rbox(THREE, 0.8, 0.006, 0.19, 0.0029, { seg: 1 }), matMat, 0.105, 0.2525, -0.55),
        part(THREE, rbox(THREE, 0.003, 0.005, 0.05, 0.0014, { seg: 1 }), matMat, 0.5185, 0.153, -0.55),
      ], matMat, { consume: true });
      strip.castShadow = false;
      const plastic = absMat(THREE);
      const hub = mergeMeshes(THREE, [
        part(THREE, rbox(THREE, 0.02, 0.022, 0.05, 0.006, { seg: 1 }), plastic, 0.512, 0.244, -0.55), // the strip's end clip, over the rail edge
        part(THREE, rbox(THREE, 0.018, 0.05, 0.085, 0.006, { seg: 1 }), plastic, 0.509, 0.165, -0.55), // the hub on the rail's outer face
      ], plastic, { consume: true });
      hub.castShadow = false;
      const cord = cordMat(THREE);
      const cords = mergeMeshes(THREE, [
        cable(THREE, [[0.512, 0.234, -0.536], [0.52, 0.215, -0.533], [0.514, 0.191, -0.53]], 0.0022, cord, 12),
        cable(THREE, [[0.509, 0.141, -0.575], [0.515, 0.1, -0.6], [0.53, 0.02, -0.66], [0.535, 0.004, -0.75], [0.54, 0.004, -0.92], [0.6, 0.004, -0.985]], 0.0025, cord, 28), // the power lead, along the floor to the wall
      ], cord, { consume: true });
      cords.castShadow = false;
      const root = P.group(frame, mattress, pillow, duvet, duvetIn, sleeper, strip, hub, cords);
      const led = statusLed(THREE, root, { at: [0.5185, 0.178, -0.522], r: 0.005 });
      return {
        root,
        update(s, t) {
          const occ = !!s.occupied;
          sleeper.visible = occ; duvetIn.visible = occ; duvet.visible = !occ;
          matMat.emissiveIntensity = occ ? 0.5 + 0.15 * Math.sin(t * 2) : 0;
          matMat.color.setHex(occ ? 0x3FA89A : 0x2F3A3A);
          led.set(s, t, occ ? HEX.green : HEX.amber, 2);
        },
      };
    },
  },

  // An interior door: a moulded architrave and lining round a 78 cm opening (a dark hall beyond it), a painted
  // four-panel leaf on three hinges, a steel lever on a rose each side, and a contact sensor on the head casing with
  // its magnet on the leaf. The leaf swings into the room about its hinge pins when open.
  bedroom_door: {
    icon: 'door', size: 1, mountY: 1.02,
    edit: [{ field: 'open', kind: 'switch' }],
    format: (s) => (s.open ? 'open' : 'closed'),
    active: (s) => !!s.open,
    control: { kind: 'switch', field: 'open' },
    model({ THREE, P, M }) {
      const paint = new THREE.MeshPhysicalMaterial({ color: 0xF1EEE7, roughness: 0.45, clearcoat: 0.25, clearcoatRoughness: 0.5 }), steel = steelMat(THREE);
      const mx = (...e) => new THREE.Matrix4().set(...e, 0, 0, 0, 1);
      const frame = mergeMeshes(THREE, [
        part(THREE, casing(THREE, 2.0, mx(-1, 0, 0, -0.39, 0, 0, 1, -1.02, 0, 1, 0, 0)), paint), // left leg, rising from the floor
        part(THREE, casing(THREE, 2.0, mx(1, 0, 0, 0.39, 0, 0, -1, 0.98, 0, 1, 0, 0)), paint), // right leg, run down from the head
        part(THREE, casing(THREE, 0.91, mx(0, 0, 1, -0.455, 1, 0, 0, 0.98, 0, 1, 0, 0)), paint), // head, over both legs
        part(THREE, new THREE.BoxGeometry(0.016, 2.0, 0.05), paint, -0.382, -0.02, 0.025), part(THREE, new THREE.BoxGeometry(0.016, 2.0, 0.05), paint, 0.382, -0.02, 0.025),
        part(THREE, new THREE.BoxGeometry(0.78, 0.016, 0.05), paint, 0, 0.972, 0.025), // the lining the leaf closes into
      ], paint, { consume: true });
      const beyond = part(THREE, new THREE.PlaneGeometry(0.748, 1.99), new THREE.MeshStandardMaterial({ color: 0x3A3E42, roughness: 1 }), 0, -0.025, 0.003, false);
      // The leaf, in its pivot's frame: hinge edge at x = 0, front face at z = -0.002, 0.74 × 1.98 × 0.04 m.
      const L = (w, h, d, r, x, y) => part(THREE, rbox(THREE, w, h, d, r, { seg: 1 }), paint, x, y, -0.022);
      const leaf = mergeMeshes(THREE, [
        L(0.11, 1.98, 0.04, 0.004, 0.055, -0.02), L(0.11, 1.98, 0.04, 0.004, 0.685, -0.02), // stiles
        L(0.52, 0.11, 0.04, 0.004, 0.37, 0.915), L(0.52, 0.18, 0.04, 0.004, 0.37, -0.02), L(0.52, 0.22, 0.04, 0.004, 0.37, -0.9), // top, lock and bottom rails
        L(0.1, 0.79, 0.04, 0.004, 0.37, 0.465), L(0.1, 0.68, 0.04, 0.004, 0.37, -0.45), // muntins
        // raised fields: thinner, with a wide round edge, so each panel shows a shadow line inside its frame
        ...[0.215, 0.525].flatMap((x) => [L(0.204, 0.784, 0.026, 0.009, x, 0.465), L(0.204, 0.674, 0.026, 0.009, x, -0.45)]),
      ], paint, { consume: true });
      // The lever on a rose, and a key rose under it. The far side has its rose only: there is no wall depth behind the
      // closed leaf for a second lever to stand off into.
      const hardware = mergeMeshes(THREE, [
        disc(THREE, 0.026, 0.008, steel, 0.675, -0.02, 0.002, 28), disc(THREE, 0.009, 0.05, steel, 0.675, -0.02, 0.031, 14),
        part(THREE, rbox(THREE, 0.125, 0.017, 0.022, 0.0075), steel, 0.6225, -0.02, 0.056, false),
        disc(THREE, 0.016, 0.006, steel, 0.675, -0.17, 0.001, 20),
        disc(THREE, 0.026, 0.003, steel, 0.675, -0.02, -0.0435, 28),
      ], steel, { consume: true });
      const keyhole = part(THREE, new THREE.CircleGeometry(0.0045, 12), new THREE.MeshStandardMaterial({ color: 0x15181B, roughness: 0.4 }), 0.675, -0.17, 0.0042, false);
      const plastic = absMat(THREE);
      const magnet = part(THREE, rbox(THREE, 0.032, 0.012, 0.009, 0.003, { seg: 1 }), plastic, 0.662, 0.955, 0.0025, false);
      const pivot = P.group(leaf, hardware, keyhole, magnet); pivot.position.set(-0.372, 0, 0.047); // on the hinge pins
      const hinges = mergeMeshes(THREE, [0.78, 0.02, -0.82].map((y) => part(THREE, new THREE.CylinderGeometry(0.0075, 0.0075, 0.1, 12), steel, -0.372, y, 0.047, false)), steel, { consume: true });
      const sensor = part(THREE, rbox(THREE, 0.06, 0.022, 0.014, 0.005), plastic, 0.29, 0.998, 0.029, false);
      const root = P.group(frame, beyond, pivot, hinges, sensor);
      const led = statusLed(THREE, root, { at: [0.31, 0.998, 0.0362], r: 0.004 });
      let angle = 0, last = null;
      return {
        root,
        update(s, t) {
          const target = s.open ? 1.2 : 0, dt = last == null ? 1 : Math.min(0.2, Math.max(0, t - last)); last = t;
          angle = Math.abs(target - angle) < 0.002 ? target : angle + (target - angle) * Math.min(1, dt * 6);
          pivot.rotation.y = -angle;
          led.set(s, t, s.open ? HEX.amber : HEX.green, 2);
        },
      };
    },
  },

  // A wall PIR: a slim plate, a short swivel neck and a rounded head tilted down at the hall, its faceted fresnel
  // dome on the front. The dome glows amber with sensing rings spreading while it sees movement.
  hallway_motion: {
    icon: 'motion', size: 0.24, mountY: 2.3,
    edit: [{ field: 'motion', kind: 'switch' }],
    format: (s) => (s.motion ? 'movement now' : 'no movement'),
    active: (s) => !!s.motion,
    control: false,
    model({ THREE, P, M }) {
      const plastic = absMat(THREE);
      const mount = mergeMeshes(THREE, [
        part(THREE, rbox(THREE, 0.056, 0.08, 0.01, 0.005), plastic, 0, 0, 0.005),
        part(THREE, rbox(THREE, 0.03, 0.03, 0.02, 0.006), plastic, 0, 0.004, 0.018),
      ], plastic, { consume: true });
      const body = part(THREE, rbox(THREE, 0.066, 0.092, 0.042, 0.01), plastic, 0, 0, 0.021);
      // Fresnel lens: a low-poly dome flat-shaded, so each facet catches the light on its own like the real lenslets.
      const lensMat = new THREE.MeshPhysicalMaterial({ color: 0xF2F0E9, roughness: 0.4, clearcoat: 0.7, clearcoatRoughness: 0.2, emissive: 0xFFB020, emissiveIntensity: 0, flatShading: true });
      const dome = part(THREE, new THREE.SphereGeometry(0.022, 14, 5, 0, Math.PI * 2, 0, Math.PI / 2), lensMat, 0, -0.008, 0.0415, false);
      dome.rotation.x = Math.PI / 2; dome.scale.y = 0.85;
      const rings = [0, 1].map(() => {
        const r = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.036, 28), new THREE.MeshBasicMaterial({ color: 0xFFB020, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
        r.position.set(0, -0.008, 0.07); r.userData.noAO = true; r.raycast = () => {}; r.visible = false; return r;
      });
      const head = P.group(body, dome, ...rings); head.position.set(0, 0.004, 0.026); head.rotation.x = 0.3; // tilted down at the floor
      const root = P.group(mount, head);
      const led = statusLed(THREE, head, { at: [0.016, 0.03, 0.0425], r: 0.0035 });
      return {
        root,
        update(s, t) {
          const m = !!s.motion;
          lensMat.emissiveIntensity = m ? 2.2 : 0;
          rings.forEach((r, i) => {
            r.visible = m;
            if (!m) return;
            const k = (t * 0.9 + i * 0.5) % 1; r.scale.setScalar(1 + k * 0.9); r.material.opacity = (1 - k) * 0.7;
          });
          led.set(s, t, m ? HEX.amber : HEX.green, 2);
        },
      };
    },
  },

  // A kettle on its smart power base: a round white base that meters the power, with a button and LED at the front,
  // the kettle's own lead looped into its back socket and the mains lead out behind. With the room's assets the kettle
  // is Poly Haven's steel vintage_electric_kettle (30 cm, spout toward -x, cord inlet low at +x), else a turned steel
  // body of the same shape. Steam rises from the spout while it draws power; the LED is amber while on.
  kettle_plug: {
    icon: 'kettle', size: 0.5,
    edit: [{ field: 'on', kind: 'switch' }],
    format: (s) => (s.on ? `on · ${Math.round(num(s.watts)).toLocaleString('en-GB')} W` : 'off'),
    active: on3,
    control: { kind: 'switch', field: 'on' },
    model({ THREE, P, M, A }) {
      const TOP = 0.022, TURN = 1.1; // the base's top; the kettle turned so its spout points front-left, the inlet back
      const plastic = absMat(THREE);
      const rim = part(THREE, lathe(THREE, [[0.158, 0], [0.163, 0.003], [0.165, 0.01], [0.163, 0.017], [0.158, 0.021], [0.15, TOP]], 48), plastic);
      // The top: a seat groove for the kettle and a ring round the button, printed on a disc (canvas x, y = world x, z).
      const topTex = canvasTex(THREE, (g, w) => {
        const px = (m) => (w / 2) * (1 + m / 0.15);
        g.fillStyle = '#F1F2F0'; g.fillRect(0, 0, w, w);
        g.strokeStyle = '#D7DAD8'; g.lineWidth = 3; g.beginPath(); g.arc(w / 2, w / 2, (w / 2) * (0.127 / 0.15), 0, Math.PI * 2); g.stroke();
        g.strokeStyle = '#6FD3CB'; g.lineWidth = 2.5; g.beginPath(); g.arc(px(0.104), px(0.104), (w / 2) * (0.0145 / 0.15), 0, Math.PI * 2); g.stroke();
      }, 256, 256);
      topTex.wrapS = topTex.wrapT = THREE.ClampToEdgeWrapping;
      const top = part(THREE, new THREE.CircleGeometry(0.15, 48).rotateX(-Math.PI / 2), new THREE.MeshPhysicalMaterial({ map: topTex, roughness: 0.55, clearcoat: 0.1, clearcoatRoughness: 0.5 }), 0, TOP, 0);
      const button = part(THREE, new THREE.CylinderGeometry(0.011, 0.0115, 0.004, 24), glossMat(THREE), 0.104, TOP + 0.002, 0.104, false);
      let kettle = A?.copy?.('vintage_electric_kettle');
      if (!kettle) {
        // The fallback: the real kettle's turned profile (a wide foot, a tapering body, a domed lid), its spout, bail
        // handle, knob and cord inlet where the real one has them.
        const chrome = new THREE.MeshStandardMaterial({ color: 0xD6D9DC, metalness: 1, roughness: 0.18 });
        const bakelite = new THREE.MeshPhysicalMaterial({ color: 0x1E2023, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2 });
        const body = part(THREE, lathe(THREE, [[0.12, 0], [0.124, 0.006], [0.124, 0.05], [0.118, 0.068], [0.1, 0.082], [0.092, 0.1], [0.09, 0.13], [0.086, 0.16], [0.076, 0.185], [0.064, 0.2], [0.048, 0.212], [0.03, 0.22], [0.012, 0.226], [0, 0.227]], 36), chrome);
        const spout = cable(THREE, [[-0.075, 0.11, 0], [-0.115, 0.14, 0], [-0.145, 0.175, 0], [-0.165, 0.197, 0]], 0.011, chrome, 16); spout.castShadow = true;
        const black = mergeMeshes(THREE, [
          cable(THREE, [[-0.068, 0.19, 0], [-0.072, 0.255, 0], [-0.045, 0.295, 0], [0, 0.302, 0], [0.045, 0.295, 0], [0.072, 0.255, 0], [0.068, 0.19, 0]], 0.009, bakelite),
          part(THREE, new THREE.SphereGeometry(0.016, 12, 8), bakelite, 0, 0.238, 0), part(THREE, new THREE.CylinderGeometry(0.007, 0.007, 0.012, 10), bakelite, 0, 0.228, 0),
          part(THREE, rbox(THREE, 0.05, 0.05, 0.1, 0.012, { seg: 1 }), bakelite, 0.14, 0.03, 0),
        ], bakelite, { consume: true });
        kettle = P.group(body, spout, black);
      }
      const puffMat = new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0, depthWrite: false });
      const puffs = [0, 1, 2].map(() => { const p = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), puffMat.clone()); p.userData.noAO = true; p.raycast = () => {}; p.visible = false; p.position.set(-0.17, 0.205, 0); return p; });
      const seat = P.group(kettle, ...puffs); seat.position.y = TOP; seat.rotation.y = TURN; // the puffs ride with the spout
      // The kettle's lead from its inlet (+x, turned to the back) into the base's back socket; the mains lead out behind.
      const ix = 0.165 * Math.cos(TURN), iz = -0.165 * Math.sin(TURN), cord = cordMat(THREE);
      const leads = mergeMeshes(THREE, [
        cable(THREE, [[ix, TOP + 0.02, iz], [ix + 0.012, TOP + 0.014, iz - 0.03], [ix - 0.005, 0.016, iz - 0.045], [0.045, 0.011, -0.178], [0.036, 0.011, -0.168]], 0.0032, cord, 20),
        cable(THREE, [[-0.035, 0.009, -0.165], [-0.04, 0.006, -0.19], [-0.07, 0.0045, -0.215], [-0.12, 0.0045, -0.205]], 0.003, cord, 16),
        part(THREE, rbox(THREE, 0.022, 0.014, 0.016, 0.004, { seg: 1 }), cord, 0.034, 0.011, -0.169, false), // the kettle lead's plug
        disc(THREE, 0.0055, 0.012, cord, -0.035, 0.009, -0.166, 10), // the mains lead's strain relief
      ], cord, { consume: true });
      leads.castShadow = false;
      const root = P.group(rim, top, button, seat, leads);
      const led = statusLed(THREE, root, { at: [0.04, TOP + 0.0015, 0.14], r: 0.0045 });
      return {
        root,
        update(s, t) {
          const run = !!s.on && num(s.watts) > 0;
          puffs.forEach((p, i) => {
            p.visible = run;
            if (!run) return;
            const k = (t * 0.5 + i / 3) % 1; p.position.set(-0.17 - 0.03 * k + 0.02 * Math.sin(k * 6 + i), 0.205 + k * 0.3, 0.015 * Math.sin(k * 4 + i)); p.scale.setScalar(0.5 + k * 1.4); p.material.opacity = (1 - k) * 0.35;
          });
          led.set(s, t, s.on ? HEX.amber : HEX.green, s.on ? 4 : 2);
        },
      };
    },
  },

  // A plug-in night light low on the wall: a white socket faceplate with the light plugged into it, a frosted lens
  // that glows warm with the dimmer, a dark light-sensor window above it, and a soft warm wash on the wall round it.
  night_light: {
    icon: 'bulb', size: 0.12, mountY: 0.35,
    edit: [{ field: 'brightness', kind: 'slider', step: 0.01, scale: 100, unit: '%' }],
    format: dimmer,
    active: (s) => pct(s.brightness) > 0,
    control: { kind: 'bar', field: 'brightness', min: 0, max: 1 },
    model({ THREE, P, M }) {
      const faceplate = part(THREE, rbox(THREE, 0.086, 0.086, 0.009, 0.004), glossMat(THREE), 0, 0, 0.0045);
      const body = part(THREE, rbox(THREE, 0.058, 0.07, 0.024, 0.009), absMat(THREE), 0, 0.006, 0.021);
      // The lens brightest at its centre (an emissive falloff), like an LED behind frosted acrylic.
      const hot = radialTex(THREE, [[0, '#FFFFFF'], [0.55, '#E8DCCB'], [1, '#B9AE9F']], 64);
      const lensMat = new THREE.MeshPhysicalMaterial({ color: 0xF6EEDF, roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.3, emissive: 0xFFD9A0, emissiveMap: hot, emissiveIntensity: 0 });
      const lens = part(THREE, rbox(THREE, 0.044, 0.044, 0.008, 0.0038), lensMat, 0, 0, 0.033, false);
      const eye = part(THREE, new THREE.CircleGeometry(0.0032, 16), new THREE.MeshStandardMaterial({ color: 0x1A1E22, roughness: 0.2 }), 0, 0.029, 0.0334, false);
      const washMat = new THREE.MeshBasicMaterial({ map: radialTex(THREE, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,.45)'], [1, 'rgba(255,255,255,0)']]), color: 0xFFC98A, transparent: true, opacity: 0, depthWrite: false });
      const wash = part(THREE, new THREE.PlaneGeometry(0.12, 0.22), washMat, 0, 0.01, 0.003, false); // no wider than the footprint (it sits 6 cm from a side wall)
      wash.receiveShadow = false; wash.userData.noAO = true; wash.raycast = () => {}; wash.visible = false;
      const root = P.group(wash, faceplate, body, lens, eye);
      const led = statusLed(THREE, root, { at: [0, -0.035, 0.0095], r: 0.0035 });
      const light = pointLight(THREE, root, [0, 0, 0.08], { hex: 0xFFD9A0, distance: 3.5 }); // a night light: soft and short-reaching
      let shown = -1;
      return {
        root,
        update(s, t) {
          const b = clamp01(s.brightness);
          if (b !== shown) { shown = b; lensMat.emissiveIntensity = b * 3; light.intensity = b * 0.9; washMat.opacity = b * 0.6; wash.visible = b > 0; }
          led.set(s, t);
        },
      };
    },
  },

  // A flush ceiling light: a white steel pan with a rounded rim, a satin-nickel trim ring and a shallow opal diffuser
  // that glows with the dimmer, brightest at its centre.
  hall_light: {
    icon: 'bulb', size: 0.4,
    edit: [{ field: 'brightness', kind: 'slider', step: 0.01, scale: 100, unit: '%' }],
    format: dimmer,
    active: (s) => pct(s.brightness) > 0,
    control: { kind: 'bar', field: 'brightness', min: 0, max: 1 },
    model({ THREE, P, M }) {
      const base = part(THREE, lathe(THREE, [[0.156, -0.031], [0.165, -0.034], [0.174, -0.03], [0.178, -0.018], [0.177, -0.005], [0.17, 0], [0, 0]], 48), new THREE.MeshPhysicalMaterial({ color: 0xF3F4F2, roughness: 0.45, clearcoat: 0.2, clearcoatRoughness: 0.5 }));
      const trim = part(THREE, lathe(THREE, [[0.155, -0.0305], [0.158, -0.0345], [0.163, -0.0352], [0.166, -0.033]], 48), new THREE.MeshStandardMaterial({ color: 0xBFC3C6, metalness: 1, roughness: 0.35 }), 0, 0, 0, false);
      // Lathe v runs centre (0) to rim (1): a falloff along it is the diffuser's hot spot.
      const fall = canvasTex(THREE, (g, w, h) => { const gr = g.createLinearGradient(0, h, 0, 0); gr.addColorStop(0, '#FFFFFF'); gr.addColorStop(0.6, '#EDE6DA'); gr.addColorStop(1, '#ADA597'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, 4, 64);
      fall.wrapS = fall.wrapT = THREE.ClampToEdgeWrapping;
      const diffMat = new THREE.MeshPhysicalMaterial({ color: 0xF7F4EE, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.25, emissive: 0xFFE2B8, emissiveMap: fall, emissiveIntensity: 0 });
      const diff = part(THREE, lathe(THREE, [[0, -0.09], [0.06, -0.088], [0.1, -0.081], [0.13, -0.07], [0.15, -0.055], [0.157, -0.04], [0.158, -0.031]], 48), diffMat, 0, 0, 0, false);
      const root = P.group(base, trim, diff);
      const led = statusLed(THREE, root, { at: [0.171, -0.0335, 0], r: 0.005 });
      const light = pointLight(THREE, root, [0, -0.2, 0], { hex: 0xFFE2B8 });
      let shown = -1;
      return {
        root,
        update(s, t) {
          const b = clamp01(s.brightness);
          if (b !== shown) { shown = b; diffMat.emissiveIntensity = b * 3; light.intensity = b * 2.2; }
          led.set(s, t);
        },
      };
    },
  },
};
