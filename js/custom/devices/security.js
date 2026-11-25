// The Security and access types' card UI and 3D models for the custom room (contract: devices/index.js), each built on
// the real product: a smart deadbolt on a cut of door, a pill-shaped video doorbell, a two-piece magnet contact, a round
// smoke/CO alarm, an indoor siren-strobe and a sectional garage door whose panels run up their tracks under a ceiling
// opener over 8 s. Each has its own status LED; standby is green, a dim amber or off, never the fault red.
import { HEX, mergeMeshes, statusLed, ease, stepper, canvasTex, glowMesh as kitGlow } from './kit.js';

// A glowing mesh with its own material (never a shared one).
const glowMesh = (THREE, geo, hex, emissive) => kitGlow(THREE, geo, hex, emissive, 0.4);
const quiet = (m) => { m.userData.noAO = true; m.raycast = () => {}; m.castShadow = false; return m; };

// P.box with a lighter bevel: P.box's 4 segments make 81 quads a face (~970 triangles a box), which a part a few
// centimetres across doesn't need; 1–3 segments read the same and keep each device near its triangle budget.
function rbox(P, w, h, d, mat, x, y, z, r, seg = 2) {
  const m = P.box(w, h, d, mat, x, y, z, r), G = m.geometry.constructor;
  m.geometry.dispose(); m.geometry = new G(w, h, d, seg, r);
  return m;
}
const tiny = (m) => { m.castShadow = false; return m; };

// Finishes, one set per model (room3d frees a removed device's own materials).
const matte = (THREE, color, roughness = 0.6) => new THREE.MeshStandardMaterial({ color, roughness });
const gloss = (THREE, color, roughness = 0.35) => new THREE.MeshPhysicalMaterial({ color, roughness, clearcoat: 0.8, clearcoatRoughness: 0.12 });
const metal = (THREE, color, roughness = 0.3) => new THREE.MeshStandardMaterial({ color, metalness: 1, roughness });
const graphiteMat = (THREE) => new THREE.MeshPhysicalMaterial({ color: 0x2B2F33, roughness: 0.5, metalness: 0.1, clearcoat: 0.25, clearcoatRoughness: 0.4 });

// A turned part from an (r, y) profile listed bottom-up and outward first, so the faces point out.
const lathe = (THREE, pts, mat, seg = 32) => {
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg), mat);
  m.castShadow = m.receiveShadow = true; return m;
};
// A flat decal (a face drawn on a canvas) laid a hair in front of a part: depth-offset, so it never flickers into it.
const decal = (THREE, geo, map, opts = {}) => {
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map, transparent: true, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, ...opts }));
  m.receiveShadow = true; m.castShadow = false; return m;
};
// A stadium (a pill), w across and h tall, centred on the origin.
function stadium(THREE, w, h) {
  const r = w / 2, s = new THREE.Shape();
  s.moveTo(-r, -h / 2 + r); s.lineTo(-r, h / 2 - r); s.absarc(0, h / 2 - r, r, Math.PI, 0, true);
  s.lineTo(r, -h / 2 + r); s.absarc(0, -h / 2 + r, r, 0, Math.PI, true);
  return s;
}
// ShapeGeometry's uvs are its x, y in metres: stretch them to 0–1 over w × h, so a canvas covers the shape once.
const fitUv = (geo, w, h) => {
  const p = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / w + 0.5, p.getY(i) / h + 0.5);
  uv.needsUpdate = true; return geo;
};
const circle = (g, x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
// A seeded random, so every build of a texture is the same.
const seeded = (s) => () => ((s = (s * 16807) % 2147483647) / 2147483647);

export default {
  // A smart deadbolt on a 15 cm cut of painted door and its jamb: a graphite escutcheon with a brushed-aluminium
  // thumb-turn, driving a rim bolt in a satin case that slides into the keeper on the jamb while locked (a mortise bolt
  // would be hidden in the door). The thumb-turn lies level with the bolt when locked and turns upright to unlock.
  smart_lock: {
    icon: 'lock', size: 0.2, mountY: 1.1,
    edit: [{ field: 'locked', kind: 'switch' }],
    format: (s) => (s.locked ? 'locked' : 'unlocked'),
    active: (s) => !!s.locked,
    control: { kind: 'switch', field: 'locked' },
    model({ THREE, P, M }) {
      const door = rbox(P, 0.15, 0.2, 0.018, matte(THREE, 0xE9E6DF, 0.45), -0.025, 0, 0.009, 0.003, 1); // door face z 0.018
      const jamb = rbox(P, 0.044, 0.2, 0.026, M.trim, 0.078, 0, 0.013, 0.004, 1); // a 6 mm gap to the door's edge
      const nickel = metal(THREE, 0xBFC3C6, 0.34), alu = metal(THREE, 0xD3D6D9, 0.26);
      const body = rbox(P, 0.066, 0.15, 0.03, graphiteMat(THREE), -0.05, 0, 0.033, 0.012, 3); // front at z 0.048
      // The face inside the bevel: the speaker holes under the LED, the battery cover's seam and the thumb-turn's seat.
      const faceTex = canvasTex(THREE, (g, w, h) => {
        g.clearRect(0, 0, w, h); g.fillStyle = 'rgba(0,0,0,0.6)';
        for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) circle(g, 40 + c * 12, 46 + r * 11, 2.6);
        g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(6, 178, w - 12, 2);
        g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(6, 181, w - 12, 1);
        g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 3; g.beginPath(); g.arc(64, 282, 62, 0, Math.PI * 2); g.stroke();
      }, 128, 384);
      const face = decal(THREE, new THREE.PlaneGeometry(0.042, 0.126), faceTex); face.position.set(-0.05, 0, 0.0482);
      // The thumb-turn: a turned rotor with a raised bar, pivoting about its centre.
      const knob = lathe(THREE, [[0, 0], [0.019, 0], [0.0195, 0.002], [0.019, 0.006], [0.0165, 0.0085], [0, 0.0085]], alu, 40);
      knob.rotation.x = Math.PI / 2;
      const bar = rbox(P, 0.03, 0.01, 0.011, alu, 0, 0, 0.014, 0.0045, 2);
      const turnPivot = P.group(knob, bar); turnPivot.position.set(-0.05, -0.03, 0.048);
      // The rim bolt's case runs from under the escutcheon to the door's edge; the bolt (polished steel) hides in it.
      const boltCase = rbox(P, 0.074, 0.03, 0.022, nickel, 0.007, 0.035, 0.029, 0.006, 2);
      const BX = 0.018, TRAVEL = 0.034; // retracted, the bolt's end is flush with the case; locked, 3.4 cm into the keeper
      const bolt = rbox(P, 0.05, 0.018, 0.012, M.metal, BX, 0.035, 0.029, 0.004, 2);
      const keeper = rbox(P, 0.032, 0.04, 0.022, nickel, 0.078, 0.035, 0.037, 0.005, 2);
      const mouth = tiny(P.box(0.0015, 0.022, 0.016, M.anodized, 0.0615, 0.035, 0.031));
      const screws = tiny(mergeMeshes(THREE, [0.024, 0.046].map((y) => { const s = P.cyl(0.0026, 0.0026, 0.0016, M.steel, 0.078, y, 0.0485, 10); s.rotation.x = Math.PI / 2; return s; }), M.steel, { consume: true }));
      const root = P.group(door, jamb, body, face, turnPivot, boltCase, bolt, keeper, mouth, screws);
      const led = statusLed(THREE, root, { at: [-0.05, 0.058, 0.0485], r: 0.0032 });
      const dt = stepper(); let k = 1;
      return {
        root,
        update(s, t) {
          const locked = !!s.locked;
          k = ease(k, locked ? 1 : 0, dt(t), 7);
          bolt.position.x = BX + k * TRAVEL; // in its case, or across the gap into the keeper
          turnPivot.rotation.z = (1 - k) * Math.PI / 2;
          led.set(s, t, locked ? HEX.green : HEX.amber, 2);
        },
      };
    },
  },

  // A slim pill-shaped doorbell, 4.8 × 13.4 cm: a white gloss body whose top half is black glass with the camera lens
  // and an IR window, over a round button with a light ring. The ring glows blue and pulses while it is rung; a ring
  // round the lens and the LED go amber while it sees movement.
  video_doorbell: {
    icon: 'doorbell', size: 0.12, mountY: 1.3,
    edit: [{ field: 'ringing', kind: 'switch', label: 'ringing' }, { field: 'motion', kind: 'switch', label: 'motion' }],
    format: (s) => (s.ringing ? 'ringing' : s.motion ? 'movement at the door' : 'quiet'),
    active: (s) => !!s.ringing || !!s.motion,
    control: false,
    model({ THREE, P, M }) {
      const W = 0.042, H = 0.128, D = 0.024, FZ = D + 0.0002; // the flat front (the bevel adds 3 mm all round)
      const body = new THREE.Mesh(new THREE.ExtrudeGeometry(stadium(THREE, W, H), { depth: D - 0.006, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 3, curveSegments: 12 }), gloss(THREE, 0xF3F4F2, 0.4));
      body.position.z = 0.003; body.castShadow = body.receiveShadow = true;
      // The face: black glass over the top 44% (a light sensor, the lens's seat and the IR window under it), white below
      // with the mic hole. Drawn once; the lens and the button are real parts on it.
      const faceTex = canvasTex(THREE, (g, w, h) => {
        const wh = g.createLinearGradient(0, h * 0.44, 0, h); wh.addColorStop(0, '#F6F7F5'); wh.addColorStop(1, '#E6E9E8');
        g.fillStyle = wh; g.fillRect(0, 0, w, h);
        const bk = g.createLinearGradient(0, 0, w, h * 0.44); bk.addColorStop(0, '#191D21'); bk.addColorStop(0.5, '#0A0D10'); bk.addColorStop(1, '#12161A');
        g.fillStyle = bk; g.fillRect(0, 0, w, h * 0.44);
        g.fillStyle = '#4A5056'; g.fillRect(0, h * 0.44 - 1, w, 2); // the glass's edge
        g.fillStyle = '#20262B'; circle(g, 64, 30, 4); // light sensor
        g.fillStyle = '#1C1013'; g.fillRect(36, 122, 56, 18); g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(36, 122, 56, 3); // IR window
        g.fillStyle = '#8E9498'; circle(g, 64, 352, 2.5); // mic
      }, 128, 384);
      const face = new THREE.Mesh(fitUv(new THREE.ShapeGeometry(stadium(THREE, W - 0.002, H - 0.002), 12), W - 0.002, H - 0.002), new THREE.MeshPhysicalMaterial({ map: faceTex, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 }));
      face.position.z = FZ; face.receiveShadow = true;
      // The camera: a dark bezel and a domed black lens.
      const bezel = lathe(THREE, [[0.0108, 0], [0.0108, 0.0015], [0.0096, 0.0034], [0.0072, 0.0036], [0.0068, 0.002], [0, 0.002]], new THREE.MeshPhysicalMaterial({ color: 0x15181B, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1 }), 32);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.0068, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0x08101A, roughness: 0.05, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02 }));
      dome.scale.set(1, 0.55, 1); dome.position.y = 0.002;
      const lens = P.group(bezel, dome); lens.rotation.x = Math.PI / 2; lens.position.set(0, 0.036, FZ);
      const lensRing = glowMesh(THREE, new THREE.TorusGeometry(0.0118, 0.0011, 6, 36), 0x2C3035, 0xFFB020);
      lensRing.position.set(0, 0.036, FZ + 0.0004);
      // The button: a domed gloss cap inside its light ring.
      const btn = glowMesh(THREE, new THREE.TorusGeometry(0.0128, 0.0017, 6, 36), 0xBFC4C8, 0x3AB7FF);
      btn.position.set(0, -0.036, FZ + 0.0006);
      const btnDot = lathe(THREE, [[0.0108, 0], [0.0106, 0.0014], [0.0092, 0.0026], [0.0055, 0.0034], [0, 0.0036]], gloss(THREE, 0xE6E9EA, 0.25), 32);
      btnDot.rotation.x = Math.PI / 2; btnDot.position.set(0, -0.036, FZ);
      const wave = new THREE.Mesh(new THREE.RingGeometry(0.02, 0.026, 28), new THREE.MeshBasicMaterial({ color: 0x3AB7FF, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      wave.position.set(0, -0.036, 0.04); quiet(wave); wave.visible = false;
      const root = P.group(body, face, lens, lensRing, btn, btnDot, wave);
      const led = statusLed(THREE, root, { at: [0, 0.056, FZ + 0.0004], r: 0.003, size: 0.03 });
      return {
        root,
        update(s, t) {
          const ring = !!s.ringing, mo = !!s.motion;
          btn.material.emissiveIntensity = ring ? 2 + 1.5 * Math.sin(t * 9) : 0.35;
          lensRing.material.emissiveIntensity = mo ? 2.4 : 0;
          wave.visible = ring;
          if (ring) { const k = (t * 1.6) % 1; wave.scale.setScalar(1 + k * 1.6); wave.material.opacity = (1 - k) * 0.7; }
          led.set(s, t, ring ? HEX.blue : mo ? HEX.amber : HEX.green, 2);
        },
      };
    },
  },

  // The classic two-piece contact: a gloss-white sensor (6.4 × 2.6 cm on its grey base, the LED at one end) on the
  // frame, and its slim magnet beside it on the door, their alignment marks facing. They sit together while closed and
  // the magnet parts by 6 cm when open.
  door_window_sensor: {
    icon: 'windowsensor', size: 0.2, mountY: 1.0,
    edit: [{ field: 'open', kind: 'switch' }],
    format: (s) => (s.open ? 'open' : 'closed'),
    active: (s) => !!s.open,
    control: { kind: 'switch', field: 'open' },
    model({ THREE, P, M }) {
      const base = matte(THREE, 0xD3D7D6, 0.7), cover = gloss(THREE, 0xF5F6F4, 0.4), mark = matte(THREE, 0xAEB4B7);
      // Each piece is a cover on a slightly smaller base, so the parting line shows as a thin grey edge.
      const sBase = rbox(P, 0.0628, 0.0248, 0.004, base, -0.035, 0, 0.002, 0.0016, 1);
      const sCover = rbox(P, 0.064, 0.026, 0.013, cover, -0.035, 0, 0.0105, 0.0055, 3); // front at z 0.017
      const sMark = tiny(P.box(0.0008, 0.012, 0.0004, mark, -0.0095, 0, 0.0171));
      const mBase = rbox(P, 0.0288, 0.0108, 0.004, base, 0, 0, 0.002, 0.0016, 1);
      const mCover = rbox(P, 0.03, 0.012, 0.011, cover, 0, 0, 0.0095, 0.0045, 2);
      const mMark = tiny(P.box(0.0008, 0.007, 0.0004, mark, -0.0098, 0, 0.0151));
      const magnet = P.group(mBase, mCover, mMark); magnet.position.x = 0.018; // a 6 mm gap to the sensor
      const root = P.group(sBase, sCover, sMark, magnet);
      const led = statusLed(THREE, root, { at: [-0.058, 0.0055, 0.0168], r: 0.0024, size: 0.03 });
      const dt = stepper(); let k = 0;
      return {
        root,
        update(s, t) {
          const open = !!s.open;
          k = ease(k, open ? 1 : 0, dt(t), 6);
          magnet.position.x = 0.018 + k * 0.06;
          led.set(s, t, open ? HEX.amber : HEX.green, 2);
        },
      };
    },
  },

  // A round ceiling alarm 15 cm across: a turned white body on its mounting ring, a band of smoke-chamber slots round
  // the side, a face with radial vents and the sounder's holes, and a domed test button in a light ring. The ring and a
  // halo flash orange while the alarm is on; the LED is a dim green heartbeat otherwise.
  smoke_co_alarm: {
    icon: 'smoke', size: 0.28,
    edit: [{ field: 'alarm', kind: 'switch' }],
    format: (s) => (s.alarm ? 'alarm sounding' : 'all clear'),
    active: (s) => !!s.alarm,
    control: false,
    model({ THREE, P, M }) {
      const abs = matte(THREE, 0xF1F2EF, 0.55), FY = -0.0402; // the face's height
      // From the face's edge up to the ceiling: the rounded lip, the slot band, the step to the mounting ring.
      const body = lathe(THREE, [[0.0625, -0.0401], [0.069, -0.0385], [0.0735, -0.0352], [0.0752, -0.0305], [0.0752, -0.0172], [0.0738, -0.0158], [0.0738, -0.0142], [0.0762, -0.0128], [0.0762, -0.005], [0.0745, -0.0015], [0.069, 0]], abs, 64);
      const slots = canvasTex(THREE, (g, w, h) => {
        g.fillStyle = '#F1F2EF'; g.fillRect(0, 0, w, h); g.fillStyle = '#3C4146';
        for (let i = 0; i < 64; i++) g.fillRect(i * 8 + 2, 5, 4, h - 10);
      }, 512, 32);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0754, 0.0754, 0.0115, 64, 1, true), new THREE.MeshStandardMaterial({ map: slots, roughness: 0.55 }));
      band.position.y = -0.0238; band.castShadow = false;
      const faceTex = canvasTex(THREE, (g, w) => {
        const c = w / 2;
        g.fillStyle = '#F1F2EF'; g.fillRect(0, 0, w, w);
        const sh = g.createRadialGradient(c, c, 0, c, c, c); sh.addColorStop(0, 'rgba(255,255,255,0.25)'); sh.addColorStop(1, 'rgba(0,0,0,0.07)');
        g.fillStyle = sh; g.fillRect(0, 0, w, w);
        g.strokeStyle = 'rgba(0,0,0,0.16)'; g.lineWidth = 2; g.beginPath(); g.arc(c, c, c * 0.93, 0, Math.PI * 2); g.stroke();
        g.beginPath(); g.arc(c, c, c * 0.37, 0, Math.PI * 2); g.stroke(); // the button's seat
        g.fillStyle = '#3E4348'; // the smoke chamber's vents, radial
        for (let i = 0; i < 36; i++) { g.save(); g.translate(c, c); g.rotate(i / 36 * Math.PI * 2); g.fillRect(-3.5, c * 0.64, 7, c * 0.2); g.restore(); }
        g.fillStyle = '#5A6066'; // the sounder's holes
        for (let i = 0; i < 20; i++) { const a = i / 20 * Math.PI * 2; circle(g, c + Math.cos(a) * c * 0.45, c + Math.sin(a) * c * 0.45, 4); }
      }, 512, 512);
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.0626, 64), new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.55 }));
      face.rotation.x = Math.PI / 2; face.position.y = FY; face.receiveShadow = true; // facing down
      const button = lathe(THREE, [[0.0205, 0], [0.0203, 0.0015], [0.017, 0.0032], [0.009, 0.0042], [0, 0.0045]], gloss(THREE, 0xF6F7F5, 0.3), 40);
      button.rotation.x = Math.PI; button.position.y = FY; button.castShadow = false; // domed downward
      const ring = glowMesh(THREE, new THREE.TorusGeometry(0.0235, 0.0015, 6, 40), 0xDCE0DF, 0xFF4A1C);
      ring.rotation.x = Math.PI / 2; ring.position.y = FY - 0.0002; ring.castShadow = false;
      const halo = new THREE.Mesh(new THREE.RingGeometry(0.08, 0.11, 48), new THREE.MeshBasicMaterial({ color: 0xFF4A1C, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      halo.rotation.x = Math.PI / 2; halo.position.y = FY - 0.0025; quiet(halo); halo.visible = false;
      const root = P.group(body, band, face, button, ring, halo);
      const led = statusLed(THREE, root, { at: [0, FY - 0.0003, 0.034], r: 0.003 });
      return {
        root,
        update(s, t) {
          const al = !!s.alarm, blink = Math.floor(t * 3) % 2 === 0;
          ring.material.emissiveIntensity = al ? (blink ? 4 : 0.6) : 0;
          halo.visible = al; if (al) halo.material.opacity = blink ? 0.7 : 0.15;
          led.set(s, t, al ? 0xFF4A1C : HEX.green, al ? (blink ? 5 : 1) : 0.8 + 0.5 * Math.sin(t * 1.5));
        },
      };
    },
  },

  // A compact indoor siren-strobe, 12 × 15 cm: a white body on a grey wall plate, a frosted Fresnel strobe dome above
  // a graphite perforated speaker grille. The strobe flashes red and sound arcs spread from the grille while it sounds.
  siren: {
    icon: 'siren', size: 0.3, mountY: 2.2,
    edit: [{ field: 'sounding', kind: 'switch' }],
    format: (s) => (s.sounding ? 'sounding' : 'silent'),
    active: (s) => !!s.sounding,
    control: { kind: 'switch', field: 'sounding' },
    model({ THREE, P, M }) {
      const plate = rbox(P, 0.13, 0.16, 0.006, matte(THREE, 0xD9DCDB, 0.7), 0, 0, 0.003, 0.0028, 1);
      const body = rbox(P, 0.12, 0.15, 0.034, matte(THREE, 0xF2F3F1, 0.5), 0, 0, 0.023, 0.012, 3); // front at z 0.04
      const FZ = 0.0402, GY = -0.034, BY = 0.028; // the front; the grille's and the strobe's centres
      const holes = canvasTex(THREE, (g, w) => {
        g.fillStyle = '#2B2F33'; g.fillRect(0, 0, w, w);
        for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) {
          const x = 14 + c * 16 + (r % 2) * 8, y = 14 + r * 16;
          g.fillStyle = '#0B0D0F'; circle(g, x, y, 4.6); g.fillStyle = 'rgba(255,255,255,0.12)'; circle(g, x - 1, y - 1.6, 1.4);
        }
      }, 256, 256);
      const grille = new THREE.Mesh(new THREE.CircleGeometry(0.024, 40), new THREE.MeshStandardMaterial({ map: holes, roughness: 0.55, metalness: 0.3 }));
      grille.position.set(0, GY, FZ); grille.receiveShadow = true;
      const graphite = graphiteMat(THREE), rim = gloss(THREE, 0xE4E7E6, 0.3);
      const grilleRim = tiny(new THREE.Mesh(new THREE.TorusGeometry(0.0248, 0.0018, 5, 36), graphite)); grilleRim.position.set(0, GY, FZ);
      // The strobe: a frosted dome with Fresnel rings (stripes along the sphere's v are rings round its axis).
      const fresnel = canvasTex(THREE, (g, w, h) => { for (let y = 0; y < h; y++) { const k = 0.5 + 0.5 * Math.sin(y / h * Math.PI * 2 * 12); g.fillStyle = `rgb(${232 + 23 * k | 0},${232 + 23 * k | 0},${232 + 23 * k | 0})`; g.fillRect(0, y, w, 1); } }, 8, 256);
      const beacon = glowMesh(THREE, new THREE.SphereGeometry(0.032, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0xE6E3DC, 0xFF2A1A);
      beacon.material.roughness = 0.25; beacon.material.map = fresnel;
      beacon.rotation.x = Math.PI / 2; beacon.scale.set(1, 0.62, 1); beacon.position.set(0, BY, 0.04); beacon.castShadow = true;
      const beaconRim = tiny(new THREE.Mesh(new THREE.TorusGeometry(0.0328, 0.0022, 6, 44), rim)); beaconRim.position.set(0, BY, FZ);
      const arcs = [0, 1, 2].map(() => {
        const a = new THREE.Mesh(new THREE.RingGeometry(0.026, 0.031, 36), new THREE.MeshBasicMaterial({ color: 0xFF5A3A, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
        a.position.set(0, GY, 0.06); quiet(a); a.visible = false; return a;
      });
      const root = P.group(plate, body, grille, grilleRim, beacon, beaconRim, ...arcs);
      const led = statusLed(THREE, root, { at: [0.04, -0.058, FZ], r: 0.0032 });
      return {
        root,
        update(s, t) {
          const on = !!s.sounding, blink = Math.floor(t * 4) % 2 === 0;
          beacon.material.emissiveIntensity = on ? (blink ? 5 : 0.8) : 0;
          beacon.material.color.setHex(!on ? 0xE6E3DC : blink ? 0xFF5A4A : 0xB8332A); // pale and clear until it sounds: red at rest would read as a fault
          arcs.forEach((a, i) => {
            a.visible = on;
            if (!on) return;
            const k = (t * 1.2 + i / 3) % 1; a.scale.setScalar(0.8 + k * 1.1); a.position.z = 0.06 + k * 0.01; a.material.opacity = (1 - k) * 0.7;
          });
          led.set(s, t, on ? HEX.amber : HEX.green, on ? 3 : 1);
        },
      };
    },
  },

  // A sectional garage door, 1.8 × 1.96 m in a cased opening, seen from inside: six pressed-steel sections (glazed at
  // the top) on hinges, riding galvanised tracks up the jambs, round a 20 cm curve and back under the ceiling, with a
  // torsion spring bar over the opening and a chain-rail opener whose trolley pulls the top section by its arm. The
  // tracks are high-lift (they rise 40 cm above the opening before they curve), so the open door and the opener's
  // motor stay inside the 1.9 m footprint and under the ceiling. The door runs end to end in 8 s (the time the server
  // takes), showing the dark bay behind; a lamp under the motor blinks while it moves.
  garage_door: {
    icon: 'garage', size: 1.9, mountY: 1.0,
    edit: [{ field: 'open', kind: 'switch' }],
    format: (s) => (s.open ? 'open' : 'closed'),
    active: (s) => !!s.open,
    control: { kind: 'switch', field: 'open' },
    model({ THREE, P, M }) {
      // The floor is y -1 and the ceiling y 1.8. The panels' path, by distance s from the closed door's bottom edge: up
      // the jamb at z ZP to YC, a quarter circle of radius R, then level into the room.
      const W = 1.8, NP = 6, PH = 1.96 / NP, T = 0.04, ZP = 0.05, Y0 = -0.98, YC = 1.38, R = 0.2, TX = 0.915;
      const LV = YC - Y0, LA = Math.PI * R / 2, OPEN = 1.98; // open, the bottom edge clears the header by 7 cm
      const at = (s) => (s <= LV ? [Y0 + s, ZP]
        : s <= LV + LA ? [YC + R * Math.sin((s - LV) / R), ZP + R * (1 - Math.cos((s - LV) / R))]
          : [YC + R, ZP + R + s - LV - LA]);
      // The casing is 3 cm deep, so it shades as its front face (P.flatNormals: no dotted edges on phones without MSAA).
      const casing = mergeMeshes(THREE, [P.box(0.1, 2.0, 0.03, M.trim, -0.9, 0, 0.015), P.box(0.1, 2.0, 0.03, M.trim, 0.9, 0, 0.015), P.box(1.9, 0.08, 0.03, M.trim, 0, 0.97, 0.015)].map((m) => P.flatNormals(m, 0, 0, 1)), M.trim, { consume: true });
      const bay = P.box(1.7, 1.93, 0.004, new THREE.MeshStandardMaterial({ color: 0x15181B, roughness: 1 }), 0, -0.035, 0.002);
      const sill = tiny(P.box(1.8, 0.012, 0.12, M.steel, 0, -0.994, 0.06));
      // A section's inside face: four pressed panels (or four windows on the top one), the joint lines, and the hinges
      // and end roller brackets along its bottom edge. The same canvas is the bump, so the pressing catches the light.
      const sectionTex = (glazed) => canvasTex(THREE, (g, w, h) => {
        const rnd = seeded(glazed ? 11 : 7);
        g.fillStyle = '#E2E4E2'; g.fillRect(0, 0, w, h);
        for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(0,0,0,${0.015 + rnd() * 0.03})`; g.fillRect(0, rnd() * h, w, 1); } // pressed grain
        const n = 4, mx = 16, gap = 14, pw = (w - 2 * mx - (n - 1) * gap) / n, py = 18, ph = h - 2 * py;
        for (let i = 0; i < n; i++) {
          const x = mx + i * (pw + gap);
          if (glazed) {
            g.fillStyle = '#C9CCCB'; g.fillRect(x, py, pw, ph);
            const gl = g.createLinearGradient(x, py, x + pw, py + ph); gl.addColorStop(0, '#3A444C'); gl.addColorStop(0.45, '#1C2328'); gl.addColorStop(1, '#2A3238');
            g.fillStyle = gl; g.fillRect(x + 5, py + 5, pw - 10, ph - 10);
          } else {
            g.fillStyle = 'rgba(255,255,255,0.6)'; g.fillRect(x, py, pw, 3); g.fillRect(x, py, 3, ph);
            g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(x, py + ph - 3, pw, 3); g.fillRect(x + pw - 3, py, 3, ph);
          }
        }
        g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, 0, w, 2); g.fillRect(0, h - 2, w, 2);
        g.fillStyle = '#9AA0A5'; for (const u of [0.014, 0.5, 0.986]) g.fillRect(u * w - 7, h - 15, 14, 13);
      }, 512, 96);
      const sectionMat = (glazed) => { const tx = sectionTex(glazed); return new THREE.MeshPhysicalMaterial({ map: tx, bumpMap: tx, bumpScale: 0.8, roughness: glazed ? 0.35 : 0.45, metalness: 0.15, clearcoat: glazed ? 0.6 : 0.25, clearcoatRoughness: 0.4 }); };
      const plain = sectionMat(false), glazed = sectionMat(true);
      const first = rbox(P, W, PH - 0.004, T, plain, 0, 0, 0, 0.008, 1); // the sections share one geometry
      const panels = [first];
      for (let i = 1; i < NP; i++) panels.push(P.add(new THREE.Mesh(first.geometry, i === NP - 1 ? glazed : plain)));
      first.add(tiny(P.box(W - 0.02, 0.012, 0.03, M.rubber, 0, -PH / 2 - 0.002, 0)), tiny(rbox(P, 0.14, 0.022, 0.016, M.black, 0.55, -0.05, T / 2 + 0.008, 0.006, 1))); // bottom seal, lift handle
      // Galvanised steel, one mesh: the tracks (straight runs as channels, the curve as a tube), their ceiling hangers,
      // the opener's rail and wall bracket, the torsion bar with its centre plate and cable drums, the motor's straps.
      const galv = new THREE.MeshStandardMaterial({ color: 0xB9BEC2, metalness: 0.85, roughness: 0.38 });
      const arcGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(Array.from({ length: 9 }, (_, i) => { const a = i / 8 * Math.PI / 2; return new THREE.Vector3(0, YC + R * Math.sin(a), ZP + R * (1 - Math.cos(a))); })), 10, 0.018, 6);
      const steel = [];
      for (const sx of [-1, 1]) {
        const arc = P.add(new THREE.Mesh(arcGeo, galv)); arc.position.x = sx * TX;
        const drum = P.cyl(0.04, 0.04, 0.035, galv, sx * 0.885, 1.645, 0.045, 20); drum.rotation.z = Math.PI / 2;
        steel.push(arc, drum,
          P.box(0.03, YC + 1, 0.05, galv, sx * TX, (YC - 1) / 2, ZP),
          P.box(0.03, 0.05, 1.32, galv, sx * TX, YC + R, ZP + R + 0.66),
          P.box(0.004, 1.798 - (YC + R + 0.025), 0.03, galv, sx * (TX + 0.017), (1.798 + YC + R + 0.025) / 2, 1.5),
          P.box(0.004, 0.11, 0.03, galv, sx * 0.154, 1.743, 1.73));
      }
      const torsion = P.cyl(0.016, 0.016, 1.84, galv, 0, 1.645, 0.045, 12); torsion.rotation.z = Math.PI / 2;
      steel.push(torsion, P.box(0.08, 0.12, 0.006, galv, 0, 1.645, 0.003), P.box(0.032, 0.03, 1.57, galv, 0, 1.7, 0.815), P.box(0.07, 0.06, 0.04, galv, 0, 1.7, 0.02));
      const steelMesh = mergeMeshes(THREE, steel, galv, { consume: true });
      arcGeo.dispose();
      // The torsion springs: oiled black coils (stripes along a cylinder's v are rings).
      const coil = canvasTex(THREE, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#1C1F22'); gr.addColorStop(0.5, '#60666C'); gr.addColorStop(1, '#1C1F22'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, 8, 32);
      coil.repeat.set(1, 30);
      const springMat = new THREE.MeshStandardMaterial({ map: coil, metalness: 0.6, roughness: 0.4 });
      const springs = mergeMeshes(THREE, [-0.22, 0.22].map((x) => { const c = P.cyl(0.03, 0.03, 0.36, springMat, x, 1.645, 0.045, 16); c.rotation.z = Math.PI / 2; return c; }), springMat, { consume: true });
      // The opener: a light-grey motor on a graphite tray, hung from the ceiling past the open door's end, with its
      // lamp lens underneath; the trolley rides the rail and its arm reaches the top section.
      const motor = rbox(P, 0.3, 0.1, 0.26, gloss(THREE, 0xE7E9E8, 0.45), 0, 1.735, 1.73, 0.02, 2);
      const tray = rbox(P, 0.304, 0.03, 0.264, graphiteMat(THREE), 0, 1.675, 1.73, 0.01, 1);
      const lampGlass = glowMesh(THREE, new THREE.BoxGeometry(0.2, 0.006, 0.15), 0xE7E0CF, 0xFFB020);
      lampGlass.position.set(0, 1.658, 1.73); lampGlass.castShadow = false;
      const trolley = rbox(P, 0.05, 0.035, 0.09, M.black, 0, 1.68, 0.4, 0.008, 1);
      const arm = P.box(0.012, 1, 0.006, galv, 0, 0, 0); // 1 m along y, stretched to reach
      const root = P.group(casing, bay, sill, ...panels, steelMesh, springs, motor, tray, lampGlass, trolley, arm);
      const led = statusLed(THREE, root, { at: [0.1, 1.735, 1.861], r: 0.008 });
      // Each section rides the path by its two hinge lines, so it tilts through the curve; the arm runs from the
      // trolley to a bracket on the top section's top edge.
      const place = (u) => {
        let by = 0, bz = 0;
        panels.forEach((p, i) => {
          const [y1, z1] = at(i * PH + u), [y2, z2] = at((i + 1) * PH + u), phi = Math.atan2(z2 - z1, y2 - y1);
          p.position.set(0, (y1 + y2) / 2, (z1 + z2) / 2); p.rotation.x = phi;
          if (i === NP - 1) { by = y2 - Math.sin(phi) * T / 2; bz = z2 + Math.cos(phi) * T / 2; }
        });
        const tz = Math.min(1.555, Math.max(0.3, bz + 0.32)), ay = 1.663, dy = ay - by, dz = tz - bz;
        trolley.position.z = tz;
        arm.position.set(0, (ay + by) / 2, (tz + bz) / 2); arm.rotation.x = Math.atan2(dz, dy); arm.scale.y = Math.hypot(dy, dz);
      };
      place(0); // closed until the first update
      const dt = stepper(); let up = null, placed = null; // null until the first state: a door that starts open shows open, not rising from closed
      return {
        root,
        update(s, t) {
          const target = s.open ? 1 : 0, d = dt(t); if (up === null) up = target;
          up = Math.abs(target - up) < 0.0005 ? target : up + Math.sign(target - up) * Math.min(Math.abs(target - up), d / 8); // 8 s end to end
          if (up !== placed) { placed = up; place(up * OPEN); }
          const moving = up > 0 && up < 1;
          lampGlass.material.emissiveIntensity = moving ? (Math.floor(t * 3) % 2 === 0 ? 4 : 0.3) : 0;
          led.set(s, t, moving ? HEX.amber : HEX.green, 2);
        },
      };
    },
  },
};
