// The Creator desk types' card UI and 3D models for the custom room (contract: devices/index.js). Their look follows the
// creator scene (js/scenes/creator.js), rebuilt as the real kit: an LED key panel on a light stand, a mirrorless camera on
// a tripod, a podcast mic in a shock mount on a boom arm, an aluminium capture box, the overlay app on a monitor on a floor
// stand, a lit ON AIR box and a diffused aluminium LED channel. Each stands, hangs or mounts on its own with a status LED.
import { HEX, num, clamp01, pct, statusLed, pointLight, screenTex, mergeMeshes, canvasTex } from './kit.js';

const STRIP = { white: 0xFFFFFF, warm: 0xFFB46B, blue: 0x3A8CFF, purple: 0x8A5CFF, red: 0xFF3A3A, green: 0x3AE07A };
const level = (s) => { const r = pct(s.brightness); return r <= 0 ? 'off' : r >= 100 ? 'full' : `${r}%`; };
const FONT = 'Inter, "Segoe UI", sans-serif';

// ---------- shared shapes ----------

// A rounded rectangle's outline, as exact points (no zero-length edges for ExtrudeGeometry's bevel to trip on).
function roundRect(THREE, w, h, r, n = 5) {
  const pts = [], cx = w / 2 - r, cy = h / 2 - r;
  for (const [sx, sy, a0] of [[1, -1, -Math.PI / 2], [1, 1, 0], [-1, 1, Math.PI / 2], [-1, -1, Math.PI]])
    for (let i = 0; i <= n; i++) { const a = a0 + (i / n) * (Math.PI / 2); pts.push(new THREE.Vector2(sx * cx + r * Math.cos(a), sy * cy + r * Math.sin(a))); }
  return pts;
}

// ExtrudeGeometry comes out unindexed with one normal per face, so its rounded corners and bevels would shade faceted:
// each corner point takes the area-weighted normal of the faces meeting there, except across edges sharper than `crease`.
function smooth(THREE, geo, crease = 1.1) {
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
}

// A rounded slab w × h × d centred on its origin (rounded corners in x–y, a soft bevel on every edge): a few hundred
// triangles where a RoundedBox costs about a thousand.
function slab(THREE, w, h, d, r, mat, x = 0, y = 0, z = 0, bevel = Math.min(0.002, d / 4)) {
  const bs = bevel * 0.9;
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(roundRect(THREE, w - 2 * bs, h - 2 * bs, Math.max(r - bs, 0.0005))), { depth: d - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bs, bevelSegments: 2, curveSegments: 1 });
  g.translate(0, 0, -d / 2 + bevel);
  const m = new THREE.Mesh(smooth(THREE, g), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true;
  return m;
}

// A flat rounded rectangle facing +z with 0–1 uvs (a screen, a sign face).
function roundPlane(THREE, w, h, r) {
  const g = new THREE.ShapeGeometry(new THREE.Shape(roundRect(THREE, w, h, r)), 1), uv = g.attributes.uv, p = g.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / w + 0.5, p.getY(i) / h + 0.5);
  return g;
}

// A cylinder from a to b (radius r0 at a, r1 at b).
function rod(THREE, a, b, r0, r1, mat, seg = 10) {
  const A = new THREE.Vector3(...a), d = new THREE.Vector3(...b).sub(A), len = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, seg), mat);
  m.position.copy(A).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

// A cylinder lying along x (a knob's shaft, a hinge pin).
function cylX(THREE, r, len, mat, x, y, z, seg = 16) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat); m.rotation.z = Math.PI / 2; m.position.set(x, y, z); return m; }
function cylZ(THREE, r, len, mat, x, y, z, seg = 16) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat); m.rotation.x = Math.PI / 2; m.position.set(x, y, z); return m; }

// A cable through points, finer than P.tube for long runs.
function cable(THREE, pts, r, mat, seg = 40) {
  const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), seg, r, 6), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

const lathe = (THREE, prof, mat, seg = 40) => { const m = new THREE.Mesh(new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), seg), mat); m.castShadow = m.receiveShadow = true; return m; };
const merge = (THREE, parts, mat) => mergeMeshes(THREE, parts, mat, { consume: true });

// ---------- shared finishes ----------
const metal = (THREE, color, roughness = 0.32) => new THREE.MeshStandardMaterial({ color, metalness: 1, roughness });
const plastic = (THREE, color, roughness = 0.6, extra = {}) => new THREE.MeshPhysicalMaterial({ color, roughness, metalness: 0, ...extra });
const powder = (THREE) => new THREE.MeshPhysicalMaterial({ color: 0x1E2124, roughness: 0.55, metalness: 0.5, clearcoat: 0.15, clearcoatRoughness: 0.6 }); // powder-coated steel stands
const rubber = (THREE) => new THREE.MeshStandardMaterial({ color: 0x17191B, roughness: 0.9 });
const screenMat = (THREE, tex, k = 0.8) => new THREE.MeshPhysicalMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: k, roughness: 0.22, clearcoat: 0.8, clearcoatRoughness: 0.05 });
const glassBlack = (THREE) => new THREE.MeshPhysicalMaterial({ color: 0x07090B, roughness: 0.12, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.04 });

// Vent slots (dark on white, multiplied by the material colour), for a back panel or a grille.
function slotTex(THREE, rows, w = 256, h = 128) {
  return canvasTex(THREE, (g, cw, ch) => {
    g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, cw, ch); g.fillStyle = '#2A2D30'; const p = ch / rows;
    for (let i = 0; i < rows; i++) { g.beginPath(); g.roundRect(cw * 0.04, i * p + p * 0.3, cw * 0.92, p * 0.4, p * 0.2); g.fill(); }
  }, w, h);
}
// Fine random speckle for a bump map: camera leatherette, mic foam.
function speckle(THREE, size = 128, dots = 900, r = 2) {
  const t = canvasTex(THREE, (g, w, h) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < dots; i++) { const v = Math.random() < 0.5 ? 40 : 210; g.fillStyle = `rgb(${v},${v},${v})`; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, r * (0.5 + Math.random()), 0, Math.PI * 2); g.fill(); }
  }, size, size);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
// Stripes across u (ribbed lens rings) or along v (a coil spring), white and grey for a map.
function stripes(THREE, along = 'u') {
  return canvasTex(THREE, (g, w, h) => { g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, w, h); g.fillStyle = '#5A5F64'; for (let i = 0; i < 4; i++) if (along === 'u') g.fillRect(i * 16 + 8, 0, 7, h); else g.fillRect(0, i * 16 + 8, w, 7); }, 64, 64);
}

export default {
  // An LED key panel (an edge-lit diffuser in an anodised frame) on a tilt bracket, on a light stand. The diffuser glows
  // with the brightness, warmer at 2700 K and cooler at 6500 K; a smart dimmer pod on the pole carries the status LED.
  key_light: {
    icon: 'keylight', size: 0.6,
    edit: [{ field: 'brightness', kind: 'slider', step: 0.01, scale: 100, unit: '%' }],
    format: (s) => { const r = pct(s.brightness); return r <= 0 ? 'off' : `${r >= 100 ? 'full' : `${r}%`} · ${Math.round(num(s.kelvin) / 100) * 100}K`; },
    active: (s) => pct(s.brightness) > 0,
    control: { kind: 'bar', field: 'brightness', min: 0, max: 1 },
    model({ THREE, P, M }) {
      const steel = powder(THREE), rub = rubber(THREE), frame = metal(THREE, 0x3A3E43, 0.36);
      // Stand: three legs hinged on a collar 34 cm up and braced from a lower collar, rubber feet, a two-section pole
      // with a T-knob lock at the joint and a spigot on top.
      const sp = [], rb = [];
      for (let i = 0; i < 3; i++) {
        const a = Math.PI / 2 + i * (Math.PI * 2 / 3), c = Math.cos(a), s = Math.sin(a), top = [c * 0.02, 0.34, s * 0.02], foot = [c * 0.25, 0.014, s * 0.25];
        const mid = top.map((v, k) => v + (foot[k] - v) * 0.5);
        sp.push(rod(THREE, top, foot, 0.009, 0.008, steel, 8), rod(THREE, [c * 0.018, 0.17, s * 0.018], mid, 0.005, 0.005, steel, 6));
        rb.push(P.cyl(0.011, 0.013, 0.018, rub, c * 0.25, 0.009, s * 0.25, 10));
      }
      sp.push(P.cyl(0.022, 0.022, 0.06, steel, 0, 0.34, 0, 16), P.cyl(0.02, 0.02, 0.03, steel, 0, 0.17, 0, 16), P.cyl(0.016, 0.016, 0.83, steel, 0, 0.545, 0, 14),
        P.cyl(0.021, 0.021, 0.045, steel, 0, 0.95, 0, 16), P.cyl(0.012, 0.012, 0.6, steel, 0, 1.25, 0, 12), P.cyl(0.008, 0.008, 0.04, steel, 0, 1.545, 0, 10),
        cylX(THREE, 0.004, 0.03, steel, 0.033, 0.95, 0, 8));
      rb.push(cylX(THREE, 0.011, 0.01, rub, 0.05, 0.95, 0, 16));
      // The head pivots on the spigot, tilted 0.2 rad down at the room: bracket, tilt knob, the frame and its diffuser.
      const panelMat = new THREE.MeshPhysicalMaterial({ color: 0xDADDE0, emissive: 0xFFF6E8, emissiveIntensity: 0, roughness: 0.4, clearcoat: 0.4, clearcoatRoughness: 0.3 });
      const vents = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.25), new THREE.MeshStandardMaterial({ map: slotTex(THREE, 14), color: 0x3A3E43, metalness: 0.8, roughness: 0.45 }));
      vents.rotation.y = Math.PI; vents.position.set(0, 0.035, 0.0175); vents.userData.noAO = true;
      const head = P.group(
        merge(THREE, [slab(THREE, 0.46, 0.32, 0.026, 0.014, frame, 0, 0.035, 0.031), slab(THREE, 0.05, 0.04, 0.028, 0.006, frame, 0, 0, 0.004)], frame),
        slab(THREE, 0.434, 0.294, 0.004, 0.006, panelMat, 0, 0.035, 0.0445), vents,
        cylX(THREE, 0.011, 0.01, rub, 0.031, 0, 0.004, 18), P.cyl(0.006, 0.006, 0.004, M.metal, 0.17, 0.197, 0.031, 14));
      head.position.set(0, 1.565, 0); head.rotation.x = 0.2;
      const podMat = plastic(THREE, 0xF2F4F3, 0.55, { clearcoat: 0.3, clearcoatRoughness: 0.4 });
      const pod = slab(THREE, 0.044, 0.07, 0.03, 0.008, podMat, 0, 1.1, 0.02), dial = cylZ(THREE, 0.009, 0.004, M.steel, 0, 1.086, 0.036, 20);
      const cords = merge(THREE, [
        cable(THREE, [[0.12, 1.483, -0.002], [0.08, 1.4, -0.03], [0.025, 1.25, -0.012], [0, 1.13, 0.02]], 0.0035, rub, 32),
        cable(THREE, [[0, 1.07, 0.02], [0.002, 1.0, 0.026], [0.024, 0.6, 0.02], [0.026, 0.36, 0.032], [0.05, 0.12, 0.08], [0.12, 0.012, 0.18], [0.2, 0.0055, 0.26]], 0.0035, rub, 48),
      ], rub);
      const root = P.group(merge(THREE, sp, steel), merge(THREE, rb, rub), head, pod, dial, cords);
      const led = statusLed(THREE, root, { at: [0, 1.122, 0.037], r: 0.006 });
      const light = pointLight(THREE, root, [0, 1.6, 0.4], { hex: 0xFFF6E8 }); // in front of the panel, so it lights the room it faces
      const WARM = new THREE.Color(0xFFB46B), COOL = new THREE.Color(0xDDEBFF), tmp = new THREE.Color();
      let shown = '';
      return {
        root,
        update(s, t) {
          const b = clamp01(s.brightness), k = clamp01((num(s.kelvin) - 2700) / 3800), key = `${b.toFixed(3)}|${k.toFixed(3)}`;
          if (key !== shown) { shown = key; tmp.lerpColors(WARM, COOL, k); panelMat.emissive.copy(tmp); panelMat.emissiveIntensity = b * 1.6; light.color.copy(tmp); light.intensity = b * 2.4; }
          led.set(s, t);
        },
      };
    },
  },

  // A mirrorless camera (leatherette body, grip, viewfinder hump, a coated zoom lens) on a ball head and a three-section
  // tripod. The tally lamp on the hump is red on air, the lens ring glows and the rear screen shows the shot while it is on.
  main_camera: {
    icon: 'camera', size: 0.6,
    edit: [{ field: 'on', kind: 'switch' }],
    format: (s) => (s.on ? 'on' : 'off'),
    active: (s) => !!s.on,
    control: { kind: 'switch', field: 'on' },
    model({ THREE, P, M }) {
      const legMat = new THREE.MeshPhysicalMaterial({ color: 0x1C1E21, roughness: 0.38, metalness: 0.2, clearcoat: 0.6, clearcoatRoughness: 0.3 }); // carbon legs
      const alu = metal(THREE, 0x2E3236, 0.36), rub = rubber(THREE);
      // Tripod: legs hinged on a spider casting, each in three sections with lock collars and a rubber foot.
      const legs = [], locks = [], feet = [], hingeY = 1.17;
      for (let i = 0; i < 3; i++) {
        const a = Math.PI / 2 + i * (Math.PI * 2 / 3), c = Math.cos(a), s = Math.sin(a);
        const top = new THREE.Vector3(c * 0.04, hingeY, s * 0.04), foot = new THREE.Vector3(c * 0.255, 0.003, s * 0.255), at = (f) => top.clone().lerp(foot, f).toArray();
        legs.push(rod(THREE, at(0), at(0.42), 0.0115, 0.0115, legMat, 10), rod(THREE, at(0.42), at(0.73), 0.0095, 0.0095, legMat, 10), rod(THREE, at(0.73), at(0.97), 0.0078, 0.0078, legMat, 8));
        locks.push(rod(THREE, at(0.41), at(0.44), 0.0145, 0.0145, alu, 12), rod(THREE, at(0.72), at(0.75), 0.0125, 0.0125, alu, 12), rod(THREE, at(0), at(0.05), 0.014, 0.013, alu, 10));
        feet.push(rod(THREE, at(0.965), at(1), 0.0095, 0.011, rub, 10));
      }
      legs.push(P.cyl(0.012, 0.012, 0.216, legMat, 0, 1.088, 0, 12));
      locks.push(P.cyl(0.042, 0.038, 0.034, alu, 0, 1.179, 0, 24), P.cyl(0.028, 0.028, 0.008, alu, 0, 1.2, 0, 24), P.cyl(0.024, 0.026, 0.022, alu, 0, 1.215, 0, 20),
        P.cyl(0.024, 0.024, 0.014, alu, 0, 1.254, 0, 20), cylX(THREE, 0.004, 0.02, alu, 0.032, 1.215, 0, 8), P.cyl(0.006, 0.004, 0.02, alu, 0, 0.972, 0, 8));
      feet.push(cylX(THREE, 0.009, 0.012, rub, 0.046, 1.215, 0, 16));
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.017, 16, 12), metal(THREE, 0x9EA4AA, 0.25)); ball.position.set(0, 1.234, 0);
      // Camera, its lens axis on the tripod's centre. Body faces +z; the grip is on the -x side (the operator's right).
      const leather = new THREE.MeshPhysicalMaterial({ color: 0x232629, roughness: 0.62, bumpMap: speckle(THREE), bumpScale: 0.6, clearcoat: 0.1 });
      leather.bumpMap.repeat.set(40, 40);
      const top = new THREE.MeshPhysicalMaterial({ color: 0x2C3034, metalness: 0.5, roughness: 0.4, clearcoat: 0.3, clearcoatRoughness: 0.4 });
      const lcdC = document.createElement('canvas'); lcdC.width = 256; lcdC.height = 170;
      const lg = lcdC.getContext('2d'), gr = lg.createLinearGradient(0, 0, 0, 170); gr.addColorStop(0, '#3D5468'); gr.addColorStop(1, '#6E5A62'); lg.fillStyle = gr; lg.fillRect(0, 0, 256, 170);
      lg.fillStyle = '#1E2730'; lg.beginPath(); lg.arc(128, 78, 26, 0, Math.PI * 2); lg.fill(); lg.beginPath(); lg.ellipse(128, 170, 70, 52, 0, Math.PI, 0); lg.fill(); // the creator in frame
      lg.strokeStyle = 'rgba(255,255,255,.3)'; lg.lineWidth = 1; for (const k of [1, 2]) { lg.beginPath(); lg.moveTo((256 * k) / 3, 0); lg.lineTo((256 * k) / 3, 170); lg.moveTo(0, (170 * k) / 3); lg.lineTo(256, (170 * k) / 3); lg.stroke(); }
      lg.fillStyle = 'rgba(0,0,0,.45)'; lg.fillRect(0, 0, 256, 20); lg.fillStyle = '#E0563A'; lg.beginPath(); lg.arc(14, 10, 5, 0, Math.PI * 2); lg.fill();
      lg.fillStyle = '#E8EEF2'; lg.font = `600 12px ${FONT}`; lg.textBaseline = 'middle'; lg.fillText('4K 30p', 26, 11); lg.strokeStyle = '#E8EEF2'; lg.strokeRect(222, 5, 22, 10); lg.fillRect(224, 7, 15, 6);
      const lcdTex = new THREE.CanvasTexture(lcdC); lcdTex.colorSpace = THREE.SRGBColorSpace;
      const lcdMat = screenMat(THREE, lcdTex, 0); lcdMat.color.setHex(0x000000);
      const lcd = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.0465), lcdMat); lcd.rotation.y = Math.PI; lcd.position.set(0.012, -0.004, -0.0232); lcd.userData.noAO = true;
      const ribbed = new THREE.MeshStandardMaterial({ color: 0x2A2D30, roughness: 0.85, map: stripes(THREE) }); ribbed.map.repeat.set(30, 1);
      const lensMat = plastic(THREE, 0x1D2023, 0.48, { clearcoat: 0.25, clearcoatRoughness: 0.5 });
      const coat = new THREE.MeshPhysicalMaterial({ color: 0x0A1016, roughness: 0.04, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.02, iridescence: 0.7, iridescenceIOR: 1.6 }); // multicoated front element
      const ringMat = new THREE.MeshStandardMaterial({ color: 0x1B1D20, emissive: 0x3AB7FF, emissiveIntensity: 0, roughness: 0.4 });
      const lens = P.group(
        lathe(THREE, [[0.029, 0], [0.032, 0.002], [0.032, 0.012], [0.0335, 0.014], [0.0335, 0.086], [0.0345, 0.089], [0.032, 0.093], [0.0272, 0.093], [0.0262, 0.086]], lensMat, 40),
        P.cyl(0.0345, 0.0345, 0.026, ribbed, 0, 0.033, 0, 40), P.cyl(0.0345, 0.0345, 0.015, ribbed, 0, 0.068, 0, 40), P.cyl(0.0305, 0.0305, 0.004, M.metal, 0, 0.0, 0, 32));
      const glass = new THREE.Mesh(new THREE.SphereGeometry(0.06, 32, 4, 0, Math.PI * 2, 0, 0.45), coat); glass.position.y = 0.0285; lens.add(glass);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0305, 0.0016, 6, 40), ringMat); ring.rotation.x = Math.PI / 2; ring.position.y = 0.0932; lens.add(ring);
      lens.rotation.x = Math.PI / 2; lens.position.set(0.01, -0.002, 0.02);
      const cam = P.group(
        merge(THREE, [slab(THREE, 0.128, 0.072, 0.04, 0.008, leather), slab(THREE, 0.034, 0.07, 0.03, 0.012, leather, -0.047, -0.001, 0.03)], leather),
        merge(THREE, [slab(THREE, 0.054, 0.026, 0.05, 0.008, top, 0.01, 0.045, -0.004), P.cyl(0.011, 0.011, 0.007, top, -0.045, 0.0395, 0.008, 24), P.cyl(0.012, 0.012, 0.008, top, 0.05, 0.04, 0, 24),
          slab(THREE, 0.052, 0.008, 0.042, 0.004, top, 0.01, -0.04, 0)], top), // body top: hump, dials and the quick-release plate under it
        merge(THREE, [slab(THREE, 0.04, 0.026, 0.012, 0.006, rub, 0.01, 0.045, -0.034), slab(THREE, 0.078, 0.054, 0.003, 0.004, rub, 0.012, -0.004, -0.0215)], rub),
        merge(THREE, [P.cyl(0.005, 0.005, 0.004, M.metal, -0.047, 0.0375, 0.03, 14), P.box(0.022, 0.003, 0.018, M.metal, 0.01, 0.0595, -0.006), cylX(THREE, 0.0035, 0.006, M.metal, -0.066, 0.02, -0.005, 10), cylX(THREE, 0.0035, 0.006, M.metal, 0.066, 0.02, -0.005, 10)], M.metal),
        lcd, lens);
      cam.position.set(-0.01, 1.305, 0);
      const root = P.group(merge(THREE, legs, legMat), merge(THREE, locks, alu), merge(THREE, feet, rub), ball, cam);
      const led = statusLed(THREE, cam, { at: [0.01, 0.0585, 0.014], r: 0.0045 });
      let lit = null;
      return {
        root,
        update(s, t) {
          ringMat.emissiveIntensity = s.on ? 2 : 0;
          if (!!s.on !== lit) { lit = !!s.on; lcdMat.color.setHex(lit ? 0xFFFFFF : 0x000000); lcdMat.emissiveIntensity = lit ? 0.85 : 0; }
          led.set(s, t, s.on ? HEX.red : HEX.green, s.on ? 5 : 1.5);
        },
      };
    },
  },

  // A dynamic podcast mic in a shock mount, foam windscreen on, hung from a spring boom arm on a weighted floor stand.
  // Its light ring is red while muted and green while live.
  mic: {
    icon: 'mic', size: 0.6, control: (s) => ({ kind: 'switch', field: 'muted', on: !s.muted }), // on = live, so the switch reads opposite to the muted flag
    edit: [{ field: 'muted', kind: 'switch' }],
    format: (s) => (s.muted ? 'muted' : 'live'),
    active: (s) => !s.muted,
    model({ THREE, P, M }) {
      const steel = powder(THREE), rub = rubber(THREE), V = (x, y, z) => new THREE.Vector3(x, y, z);
      const Z0 = -0.16, P0 = V(0, 1.02, Z0), P1 = V(0, 1.3, -0.02), P2 = V(0, 1.27, 0.15);
      // Stand: a turned cast base, the pole with its height clutch, and the arm's swivel on top.
      const base = lathe(THREE, [[0, 0], [0.125, 0], [0.13, 0.004], [0.13, 0.014], [0.12, 0.022], [0.03, 0.03], [0.02, 0.04], [0, 0.04]], new THREE.MeshPhysicalMaterial({ color: 0x1D1F22, metalness: 0.6, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.2 }), 40);
      base.position.z = Z0;
      const black = [P.cyl(0.011, 0.011, 0.97, steel, 0, 0.525, Z0, 12), P.cyl(0.017, 0.017, 0.045, steel, 0, 0.62, Z0, 16), P.cyl(0.018, 0.018, 0.04, steel, 0, 1.0, Z0, 16)], knobs = [cylX(THREE, 0.009, 0.012, rub, 0.024, 0.62, Z0, 14)];
      // Boom: each section a pair of parallel bars with a coil spring above them, on hinge hubs with tension knobs.
      const springs = [];
      for (const [a, b] of [[P0, P1], [P1, P2]]) {
        const d = b.clone().sub(a).normalize(), n = V(0, d.z, -d.y); if (n.y < 0) n.negate(); // the arm's "up", in its own plane
        for (const o of [-0.011, 0.011]) black.push(rod(THREE, a.clone().addScaledVector(n, o).toArray(), b.clone().addScaledVector(n, o).toArray(), 0.0055, 0.0055, steel, 8));
        const len = a.distanceTo(b), springMat = new THREE.MeshStandardMaterial({ color: 0xB9BEC3, metalness: 1, roughness: 0.3, map: stripes(THREE, 'v') });
        springMat.map.repeat.set(1, len * 0.65 / 0.004);
        springs.push(rod(THREE, a.clone().lerp(b, 0.18).addScaledVector(n, 0.027).toArray(), b.clone().lerp(a, 0.18).addScaledVector(n, 0.027).toArray(), 0.0045, 0.0045, springMat, 10));
      }
      for (const p of [P0, P1, P2]) { black.push(cylX(THREE, 0.016, 0.03, steel, p.x, p.y, p.z, 18)); knobs.push(cylX(THREE, 0.011, 0.008, rub, p.x + 0.019, p.y, p.z, 16)); }
      // The mic, built along +y and turned to point forward and a little down: body, light ring, foam, shock mount.
      const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0x2B2F33, metalness: 0.6, roughness: 0.4, clearcoat: 0.3, clearcoatRoughness: 0.4 });
      const foamMat = new THREE.MeshPhysicalMaterial({ color: 0x2A2D31, roughness: 1, bumpMap: speckle(THREE, 128, 1400, 1.5), bumpScale: 1.2, sheen: 1, sheenRoughness: 0.8, sheenColor: 0x5A5F64 });
      foamMat.bumpMap.repeat.set(6, 4);
      const bandMat = new THREE.MeshStandardMaterial({ color: 0x1B1D20, emissive: 0xE0563A, emissiveIntensity: 1.2, roughness: 0.5 });
      const foam = new THREE.Mesh(new THREE.SphereGeometry(1, 22, 14), foamMat); foam.scale.set(0.036, 0.056, 0.036); foam.position.y = 0.05; foam.castShadow = true;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0255, 0.0255, 0.008, 32, 1, true), bandMat); band.position.y = -0.035;
      const frameMat = plastic(THREE, 0x25282C, 0.5), cords = [];
      for (const y of [-0.055, 0]) {
        for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + k * (Math.PI / 2), b = a + 1.2; cords.push(rod(THREE, [Math.cos(a) * 0.041, y, Math.sin(a) * 0.041], [Math.cos(b) * 0.024, y + 0.004, Math.sin(b) * 0.024], 0.0012, 0.0012, rub, 4)); }
      }
      const rings = [-0.055, 0].map((y) => { const r = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.0035, 6, 28), frameMat); r.rotation.x = Math.PI / 2; r.position.y = y; return r; });
      const frameParts = [...rings, rod(THREE, [0.042, -0.055, 0], [0.042, 0, 0], 0.004, 0.004, frameMat, 8), rod(THREE, [-0.042, -0.055, 0], [-0.042, 0, 0], 0.004, 0.004, frameMat, 8),
        rod(THREE, [0, -0.0275, -0.044], [0, -0.0275, -0.062], 0.008, 0.008, frameMat, 14), rod(THREE, [0, -0.055, -0.042], [0, 0, -0.042], 0.005, 0.005, frameMat, 8)]; // mount block on top (-z is up once turned)
      const head = P.group(
        lathe(THREE, [[0, -0.081], [0.012, -0.081], [0.016, -0.076], [0.021, -0.062], [0.0235, -0.03], [0.0245, 0], [0.0255, 0.03], [0.026, 0.045], [0, 0.045]], bodyMat, 32),
        P.cyl(0.0125, 0.0125, 0.004, M.steel, 0, -0.082, 0, 20), foam, band, merge(THREE, frameParts, frameMat), merge(THREE, cords, rub));
      head.rotation.x = Math.PI / 2 + 0.25; head.updateMatrix();
      const mountTop = V(0, -0.0275, -0.062).applyEuler(head.rotation);
      head.position.copy(P2).add(V(0, -0.022, 0)).sub(mountTop); head.updateMatrix();
      black.push(rod(THREE, P2.toArray(), [P2.x, P2.y - 0.024, P2.z], 0.006, 0.006, steel, 10)); // the threaded stud into the mount
      const back = V(0, -0.084, 0).applyMatrix4(head.matrix);
      const xlr = cable(THREE, [back.toArray(), [0, back.y - 0.03, back.z - 0.03], [0, P2.y - 0.05, P2.z - 0.05], [0, P1.y - 0.035, P1.z], [0, P0.y + 0.03, P0.z + 0.06], [0.0, 0.95, Z0 + 0.03], [0.006, 0.6, Z0 + 0.016], [0.01, 0.25, Z0 + 0.016], [0.02, 0.045, Z0 + 0.05], [0.04, 0.025, Z0 + 0.12], [0.07, 0.004, Z0 + 0.2]], 0.0032, rub, 80);
      const root = P.group(base, merge(THREE, black, steel), merge(THREE, knobs, rub), ...springs, head, xlr);
      const led = statusLed(THREE, head, { at: [0, -0.068, -0.02], r: 0.0045 });
      let shown = null;
      return {
        root,
        update(s, t) {
          const m = !!s.muted;
          if (m !== shown) { shown = m; bandMat.emissive.setHex(m ? 0xE0563A : 0x2FBF71); bandMat.emissiveIntensity = m ? 1.2 : 2.4; }
          led.set(s, t, m ? HEX.amber : HEX.green, 2);
        },
      };
    },
  },

  // A capture box: an anodised aluminium sleeve between black end caps, HDMI in and out on the front (a camera lead
  // plugged in), USB-C on the back. The OLED window on top shows the chosen input and whether a signal arrives.
  capture_card: {
    icon: 'capture', size: 0.5,
    edit: [{ field: 'signal', kind: 'switch' }],
    format: (s) => `${s.input} · ${s.signal ? 'signal' : 'no signal'}`,
    active: (s) => !!s.signal,
    control: false,
    model({ THREE, P, M }) {
      const alu = metal(THREE, 0xBFC4C9, 0.34), capMat = plastic(THREE, 0x17191B, 0.55), rub = rubber(THREE), Y = 0.017;
      // The front cap's ports, drawn at 2 px per mm: HDMI in and out, a 3.5 mm jack, tiny labels.
      const portTex = canvasTex(THREE, (g) => {
        g.fillStyle = '#17191B'; g.fillRect(0, 0, 256, 37); g.fillStyle = '#7A8188'; g.font = `600 7px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        for (const [x, label] of [[58, 'IN'], [138, 'OUT']]) {
          g.fillText(label, x, 7);
          g.fillStyle = '#9AA0A6'; g.beginPath(); g.moveTo(x - 15, 15); g.lineTo(x + 15, 15); g.lineTo(x + 15, 22); g.lineTo(x + 12, 26); g.lineTo(x - 12, 26); g.lineTo(x - 15, 22); g.closePath(); g.fill();
          g.fillStyle = '#060708'; g.fillRect(x - 13, 17, 26, 6); g.fillStyle = '#2A2D30'; g.fillRect(x - 10, 19, 20, 2); g.fillStyle = '#7A8188';
        }
        g.fillText('AUDIO', 208, 7); g.fillStyle = '#9AA0A6'; g.beginPath(); g.arc(208, 21, 6, 0, Math.PI * 2); g.fill(); g.fillStyle = '#060708'; g.beginPath(); g.arc(208, 21, 4, 0, Math.PI * 2); g.fill();
      }, 256, 37);
      const usbTex = canvasTex(THREE, (g) => { g.fillStyle = '#17191B'; g.fillRect(0, 0, 256, 37); g.fillStyle = '#9AA0A6'; g.beginPath(); g.roundRect(39, 16, 18, 6, 3); g.fill(); g.fillStyle = '#060708'; g.beginPath(); g.roundRect(41, 17.5, 14, 3, 1.5); g.fill(); }, 256, 37);
      const decal = (tex, z, back) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.128, 0.0185), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 })); m.position.set(0, Y, z); if (back) m.rotation.y = Math.PI; m.userData.noAO = true; return m; };
      // A plug with a moulded strain relief, and its lead running off along the floor.
      const plugs = [
        slab(THREE, 0.021, 0.0095, 0.03, 0.002, rub, -0.035, Y, 0.0635), rod(THREE, [-0.035, Y, 0.078], [-0.035, Y, 0.095], 0.0042, 0.0034, rub, 10),
        cable(THREE, [[-0.035, Y, 0.094], [-0.037, 0.012, 0.125], [-0.03, 0.0038, 0.16], [0, 0.0036, 0.2], [0.06, 0.0036, 0.235]], 0.0032, rub, 32),
        slab(THREE, 0.012, 0.006, 0.022, 0.002, rub, 0.04, Y, -0.0595), rod(THREE, [0.04, Y, -0.0705], [0.04, Y, -0.082], 0.0032, 0.0026, rub, 10),
        cable(THREE, [[0.04, Y, -0.081], [0.042, 0.011, -0.11], [0.05, 0.0032, -0.15], [0.09, 0.003, -0.2], [0.15, 0.003, -0.23]], 0.0026, rub, 32),
      ];
      const feet = [[-0.055, -0.035], [0.055, -0.035], [-0.055, 0.035], [0.055, 0.035]].map(([x, z]) => P.cyl(0.006, 0.006, 0.004, rub, x, 0.002, z, 10));
      const { tex, g } = screenTex(THREE, 384, 160);
      const window_ = new THREE.Mesh(roundPlane(THREE, 0.092, 0.041, 0.004), glassBlack(THREE)); window_.rotation.x = -Math.PI / 2; window_.position.set(-0.014, 0.0302, 0.004); window_.userData.noAO = true;
      const label = new THREE.Mesh(new THREE.PlaneGeometry(0.084, 0.035), screenMat(THREE, tex, 0.7));
      label.rotation.x = -Math.PI / 2; label.position.set(-0.014, 0.0305, 0.004); label.userData.noAO = true;
      const root = P.group(slab(THREE, 0.14, 0.026, 0.09, 0.008, alu, 0, Y, 0, 0.0015),
        merge(THREE, [slab(THREE, 0.137, 0.0235, 0.003, 0.0068, capMat, 0, Y, 0.0465), slab(THREE, 0.137, 0.0235, 0.003, 0.0068, capMat, 0, Y, -0.0465)], capMat),
        decal(portTex, 0.0481, false), decal(usbTex, -0.0481, true), merge(THREE, [...plugs, ...feet], rub), window_, label);
      const led = statusLed(THREE, root, { at: [0.05, 0.0305, 0.03], r: 0.0035 });
      let shown = '';
      const draw = (input, sig) => {
        g.setTransform(2, 0, 0, 2, 0, 0);
        g.fillStyle = '#0F1317'; g.fillRect(0, 0, 192, 80);
        g.fillStyle = sig ? '#2FBF71' : '#6B747C'; g.beginPath(); g.arc(24, 40, 9, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#E8EEF2'; g.font = `600 30px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(String(input), 46, 40);
        tex.needsUpdate = true;
      };
      return {
        root,
        update(s, t) {
          const key = `${s.input}|${!!s.signal}`;
          if (key !== shown) { shown = key; draw(s.input ?? '', !!s.signal); }
          led.set(s, t, s.signal ? HEX.green : HEX.amber, 2);
        },
      };
    },
  },

  // The overlay app on a 27-inch monitor (thin black-glass bezel, a chin with the LED) on a floor stand: the screen shows
  // the stream scene it is on, laid out as a real overlay. A fault leaves the last picture dimmed under a red "no reply"
  // pill; offline is a blank screen.
  overlay: {
    icon: 'display', size: 0.7,
    format: (s) => ({ idle: 'idle', starting: '"Starting soon"', live: 'LIVE scene', ending: '"Thanks for watching"', recording: 'REC' }[s.scene] || String(s.scene ?? 'idle')),
    active: (s) => !!s.scene && s.scene !== 'idle',
    control: false,
    model({ THREE, P, M }) {
      const shell = plastic(THREE, 0x2A2E32, 0.55, { clearcoat: 0.2, clearcoatRoughness: 0.5 }), alu = metal(THREE, 0xB8BCC0, 0.3), rub = rubber(THREE), Y = 1.0;
      const base = lathe(THREE, [[0, 0], [0.2, 0], [0.205, 0.004], [0.205, 0.012], [0.19, 0.022], [0.045, 0.03], [0.034, 0.045], [0, 0.045]], new THREE.MeshPhysicalMaterial({ color: 0x2A2E32, metalness: 0.5, roughness: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.25 }), 48);
      base.position.z = -0.04;
      const pole = merge(THREE, [P.cyl(0.02, 0.02, 0.97, alu, 0, 0.5, -0.065, 20), P.cyl(0.026, 0.026, 0.04, alu, 0, 0.62, -0.065, 20)], alu);
      const vents = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.05), new THREE.MeshStandardMaterial({ map: slotTex(THREE, 4, 256, 64), color: 0x2A2E32, roughness: 0.55 }));
      vents.rotation.y = Math.PI; vents.position.set(0, Y + 0.09, -0.0342); vents.userData.noAO = true;
      const { tex, g } = screenTex(THREE, 512, 288);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.597, 0.336), screenMat(THREE, tex, 0.75)); screen.position.set(0, Y + 0.009, 0.0064); screen.userData.noAO = true;
      const bezel = new THREE.Mesh(roundPlane(THREE, 0.61, 0.349, 0.005), glassBlack(THREE)); bezel.position.set(0, Y + 0.0075, 0.0062); bezel.userData.noAO = true;
      const root = P.group(base, pole,
        merge(THREE, [slab(THREE, 0.62, 0.37, 0.012, 0.007, shell, 0, Y, 0), slab(THREE, 0.44, 0.24, 0.03, 0.03, shell, 0, Y + 0.01, -0.019, 0.004)], shell),
        merge(THREE, [slab(THREE, 0.1, 0.1, 0.008, 0.006, alu, 0, Y + 0.01, -0.038), slab(THREE, 0.05, 0.06, 0.03, 0.008, alu, 0, Y + 0.01, -0.055)], alu), // VESA plate and the tilt bracket on the pole
        cylX(THREE, 0.009, 0.07, rub, 0, Y + 0.01, -0.055, 16), vents, bezel, screen,
        cable(THREE, [[0.06, Y - 0.05, -0.035], [0.035, Y - 0.12, -0.09], [0.026, 0.6, -0.092], [0.03, 0.08, -0.095], [0.05, 0.034, -0.2], [0.06, 0.012, -0.25], [0.09, 0.004, -0.31]], 0.004, rub, 48));
      const led = statusLed(THREE, root, { at: [0.27, Y - 0.176, 0.0075], r: 0.0045 });
      let shown = '';
      // Drawn in a 320 × 180 frame, scaled to the canvas.
      const pill = (x, y, w, h, fill) => { g.fillStyle = fill; g.beginPath(); g.roundRect(x, y, w, h, h / 2); g.fill(); };
      const draw = (scene, status) => {
        const dead = status === 'offline', fault = status === 'fault';
        g.setTransform(1.6, 0, 0, 1.6, 0, 0);
        g.fillStyle = dead ? '#07090B' : '#10161C'; g.fillRect(0, 0, 320, 180);
        g.textAlign = 'center'; g.textBaseline = 'middle';
        if (!dead) {
          if (scene === 'live') {
            const gr = g.createLinearGradient(0, 0, 320, 180); gr.addColorStop(0, '#2B4A63'); gr.addColorStop(1, '#6C3F7A'); g.fillStyle = gr; g.fillRect(0, 0, 320, 180);
            g.fillStyle = 'rgba(10,14,20,.55)'; g.beginPath(); g.arc(112, 84, 24, 0, Math.PI * 2); g.fill(); g.beginPath(); g.ellipse(112, 180, 62, 50, 0, Math.PI, 0); g.fill(); // the creator on camera
            g.fillStyle = 'rgba(8,12,18,.45)'; g.beginPath(); g.roundRect(234, 12, 74, 128, 8); g.fill(); // chat column
            for (let i = 0; i < 6; i++) { pill(242, 22 + i * 19, 18 + ((i * 37) % 40), 6, 'rgba(255,255,255,.55)'); pill(242, 30 + i * 19, 48 - ((i * 23) % 20), 4, 'rgba(255,255,255,.25)'); }
            pill(14, 144, 160, 24, 'rgba(8,12,18,.7)'); g.fillStyle = '#29EEE5'; g.fillRect(14, 144, 4, 24); pill(26, 150, 90, 6, 'rgba(255,255,255,.8)'); pill(26, 160, 60, 4, 'rgba(255,255,255,.4)'); // lower third
            pill(14, 12, 74, 30, '#E0563A'); g.fillStyle = '#fff'; g.font = `700 20px ${FONT}`; g.fillText('LIVE', 51, 28);
          } else if (scene === 'recording') {
            g.fillStyle = '#E0563A'; g.beginPath(); g.arc(144, 84, 14, 0, Math.PI * 2); g.fill(); g.fillStyle = '#E8EEF2'; g.font = `700 34px ${FONT}`; g.textAlign = 'left'; g.fillText('REC', 168, 86);
            g.textAlign = 'center'; g.fillStyle = '#7F8A94'; g.font = `500 14px ${FONT}`; g.fillText('00:12:48', 160, 122);
            g.strokeStyle = 'rgba(232,238,242,.35)'; g.lineWidth = 2; for (const [x, y, dx, dy] of [[12, 12, 1, 1], [308, 12, -1, 1], [12, 168, 1, -1], [308, 168, -1, -1]]) { g.beginPath(); g.moveTo(x, y + dy * 16); g.lineTo(x, y); g.lineTo(x + dx * 16, y); g.stroke(); }
          } else if (scene === 'starting') {
            const gr = g.createLinearGradient(0, 0, 320, 180); gr.addColorStop(0, '#2C2F6B'); gr.addColorStop(1, '#1D4E63'); g.fillStyle = gr; g.fillRect(0, 0, 320, 180);
            g.fillStyle = '#E8EEF2'; g.font = `600 30px ${FONT}`; g.fillText('Starting soon', 160, 82);
            pill(100, 112, 120, 6, 'rgba(255,255,255,.2)'); pill(100, 112, 74, 6, '#29EEE5');
          } else if (scene === 'ending') {
            const gr = g.createLinearGradient(0, 0, 320, 180); gr.addColorStop(0, '#233B2E'); gr.addColorStop(1, '#1E3340'); g.fillStyle = gr; g.fillRect(0, 0, 320, 180);
            g.fillStyle = '#E8EEF2'; g.font = `600 26px ${FONT}`; g.fillText('Thanks for watching', 160, 82);
            for (let i = 0; i < 3; i++) { g.fillStyle = 'rgba(255,255,255,.5)'; g.beginPath(); g.arc(130 + i * 30, 120, 8, 0, Math.PI * 2); g.fill(); }
          } else { g.fillStyle = '#5E6A74'; g.font = `600 28px ${FONT}`; g.fillText('idle', 160, 90); }
        }
        if (fault) { g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, 0, 320, 180); pill(100, 8, 120, 26, '#E0563A'); g.fillStyle = '#fff'; g.font = `600 16px ${FONT}`; g.textAlign = 'center'; g.fillText('no reply', 160, 21); }
        tex.needsUpdate = true;
      };
      return {
        root,
        update(s, t) {
          const key = `${s.scene}|${s.status}`;
          if (key !== shown) { shown = key; draw(s.scene, s.status); }
          led.set(s, t, HEX.green, 2);
        },
      };
    },
  },

  // A lit box sign: a graphite housing with a red acrylic face, "ON AIR" glowing through it while on; its cord runs into
  // a wall outlet just below.
  on_air_sign: {
    icon: 'sign', size: 0.5, mountY: 2.0,
    edit: [{ field: 'on', kind: 'switch' }],
    format: (s) => (s.on ? 'ON AIR' : 'off'),
    active: (s) => !!s.on,
    control: { kind: 'switch', field: 'on' },
    model({ THREE, P, M }) {
      const housing = plastic(THREE, 0x2A2E32, 0.5, { metalness: 0.3, clearcoat: 0.3, clearcoatRoughness: 0.4 }), rub = rubber(THREE);
      const { tex, g } = screenTex(THREE, 512, 160);
      const gr = g.createLinearGradient(0, 0, 0, 160); gr.addColorStop(0, '#220808'); gr.addColorStop(0.5, '#2E0A0A'); gr.addColorStop(1, '#1A0606'); g.fillStyle = gr; g.fillRect(0, 0, 512, 160);
      g.strokeStyle = 'rgba(255,48,48,.55)'; g.lineWidth = 4; g.beginPath(); g.roundRect(14, 14, 484, 132, 12); g.stroke();
      g.fillStyle = '#FF3030'; g.shadowColor = '#FF3030'; g.shadowBlur = 16; g.font = `800 84px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ON AIR', 256, 84); g.shadowBlur = 0; tex.needsUpdate = true;
      const face = new THREE.Mesh(roundPlane(THREE, 0.43, 0.14, 0.01), new THREE.MeshPhysicalMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 }));
      face.position.set(0, 0, 0.0505); face.userData.noAO = true;
      const screws = merge(THREE, [-0.222, 0.222].map((x) => cylZ(THREE, 0.0035, 0.002, M.steel, x, 0, 0.0505, 12)), M.steel);
      const cord = merge(THREE, [rod(THREE, [0.19, -0.083, 0.02], [0.19, -0.1, 0.02], 0.0045, 0.0035, rub, 10), cable(THREE, [[0.19, -0.098, 0.02], [0.19, -0.13, 0.016], [0.19, -0.16, 0.012], [0.19, -0.17, 0.008]], 0.003, rub, 16)], rub);
      const outlet = slab(THREE, 0.05, 0.05, 0.008, 0.006, plastic(THREE, 0xF2F4F3, 0.55), 0.19, -0.185, 0.004);
      const root = P.group(slab(THREE, 0.46, 0.17, 0.05, 0.02, housing, 0, 0, 0.025, 0.004), face, screws, cord, outlet);
      const led = statusLed(THREE, root, { at: [0.2, -0.0775, 0.0505], r: 0.0045 });
      return {
        root,
        update(s, t) {
          face.material.emissiveIntensity = s.on ? 1.7 : 0;
          led.set(s, t, s.on ? HEX.red : HEX.green, s.on ? 3 : 1.5);
        },
      };
    },
  },

  // A diffused LED channel: an aluminium profile with an opal cover, end caps and mounting clips, wired to a small
  // controller, with a soft wash on the wall around it in the chosen colour.
  led_strip: {
    icon: 'strip', size: 1.2, mountY: 1.0,
    edit: [{ field: 'brightness', kind: 'slider', step: 0.01, scale: 100, unit: '%' }],
    format: (s) => { const r = pct(s.brightness); return r <= 0 ? 'off' : `${s.color} · ${r >= 100 ? 'full' : `${r}%`}`; },
    active: (s) => pct(s.brightness) > 0,
    control: { kind: 'bar', field: 'brightness', min: 0, max: 1 },
    model({ THREE, P, M }) {
      const alu = metal(THREE, 0xC4C8CC, 0.32), capMat = plastic(THREE, 0xC9CDD1, 0.55), rub = rubber(THREE), X0 = -0.54, X1 = 0.46, XC = (X0 + X1) / 2;
      const stripMat = new THREE.MeshStandardMaterial({ color: 0xE9ECEE, emissive: 0x3A8CFF, emissiveIntensity: 0, roughness: 0.35 });
      const cover = new THREE.Mesh(new THREE.CylinderGeometry(0.0072, 0.0072, X1 - X0 - 0.004, 18, 1, true, -Math.PI / 2, Math.PI), stripMat);
      cover.rotation.z = Math.PI / 2; cover.scale.set(1, 1, 0.55); cover.position.set(XC, 0, 0.007); // a low opal dome over the channel
      const clips = [];
      for (const x of [X0 + 0.12, XC, X1 - 0.12]) for (const y of [-0.0105, 0.0105]) clips.push(P.box(0.012, 0.003, 0.009, M.steel, x, y, 0.0045));
      const { tex, g } = screenTex(THREE, 128, 32);
      const gr = g.createLinearGradient(0, 0, 0, 32); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 32); tex.needsUpdate = true;
      const washMat = new THREE.MeshBasicMaterial({ map: tex, color: 0x3A8CFF, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      const wash = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.36), washMat); wash.position.z = 0.004; wash.userData.noAO = true; wash.raycast = () => {};
      const ctlMat = plastic(THREE, 0xF2F4F3, 0.55, { clearcoat: 0.3, clearcoatRoughness: 0.4 });
      const ctl = slab(THREE, 0.07, 0.035, 0.02, 0.006, ctlMat, 0.54, 0, 0.01), button = cylZ(THREE, 0.005, 0.003, M.steel, 0.522, 0, 0.0205, 16);
      const wires = merge(THREE, [
        cable(THREE, [[X1 + 0.002, 0, 0.005], [X1 + 0.02, -0.004, 0.006], [0.505, 0, 0.008]], 0.0022, rub, 12),
        cable(THREE, [[0.555, -0.016, 0.008], [0.558, -0.06, 0.006], [0.565, -0.4, 0.005], [0.57, -0.97, 0.005]], 0.0025, rub, 24),
      ], rub);
      const root = P.group(slab(THREE, X1 - X0, 0.018, 0.007, 0.002, alu, XC, 0, 0.0035, 0.001), cover,
        merge(THREE, [slab(THREE, 0.006, 0.02, 0.012, 0.002, capMat, X0 - 0.002, 0, 0.006), slab(THREE, 0.006, 0.02, 0.012, 0.002, capMat, X1 + 0.002, 0, 0.006)], capMat),
        merge(THREE, clips, M.steel), wash, ctl, button, wires);
      const led = statusLed(THREE, root, { at: [0.556, 0.004, 0.0205], r: 0.0045 });
      let shown = '';
      return {
        root,
        update(s, t) {
          const b = clamp01(s.brightness), key = `${b.toFixed(3)}|${s.color}`;
          if (key !== shown) {
            shown = key; const hex = STRIP[s.color] ?? STRIP.white;
            stripMat.emissive.setHex(hex); stripMat.emissiveIntensity = b * 3.2; washMat.color.setHex(hex); washMat.opacity = b * 0.35;
          }
          led.set(s, t);
        },
      };
    },
  },
};
