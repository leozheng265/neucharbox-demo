// The Sensors, Energy and Outdoor types' card UI and 3D models for the custom room (contract: devices/index.js): a
// square e-ink temperature and humidity sensor, a water-leak puck standing on its contacts, a ceiling mmWave presence
// sensor, a DIN-rail energy meter in a small consumer unit, an EV wall box with its connector holstered, and a brass
// valve with a smart actuator feeding a pop-up sprinkler that sprays while open. Each has its own status LED; standby
// is green or a dim blue, never the fault red.
import { HEX, num, clamp01, oneDecimal, statusLed, canvasTex, ease, stepper, glowMesh as glow, screenTex, mergeMeshes } from './kit.js';

const whole = (v) => Math.round(num(v));
// A 0–100 reading as text: "saturated" at the top, never "100%".
const percent = (v, full = 'saturated') => { const r = whole(v); return r >= 100 ? full : `${Math.max(0, r)}%`; };
const cycle = (t, period, phase = 0) => (((t / period + phase) % 1) + 1) % 1;
const quiet = (m) => { m.userData.noAO = true; m.raycast = () => {}; m.castShadow = false; return m; };

const watts = (v) => { const w = Math.max(0, num(v)); return w >= 1000 ? `${(w / 1000).toFixed(1)} kW` : `${Math.round(w)} W`; };

// The largest font up to px (4 px steps) at which text fits maxW: "saturated" or "10.0 kW" must not run off a screen.
const fit = (g, text, weight, px, maxW) => { do g.font = `${weight} ${px}px Inter, "Segoe UI", sans-serif`; while (g.measureText(text).width > maxW && (px -= 4) >= 20); };

// A rounded-rectangle outline w × h, centred, corner radius r.
function roundRect(THREE, w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2; r = Math.max(1e-4, Math.min(r, w / 2, h / 2));
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
// A slab w × h × d centred on the origin (its depth along z): rounded corners seen from the front and a small bevel
// on the front and back edges. A few hundred triangles, where a RoundedBox is nearly a thousand, so panels, DIN modules,
// light bars and brackets use it.
function slabGeo(THREE, w, h, d, r, { bev = Math.min(0.0015, d / 3), curve = 4 } = {}) {
  const geo = new THREE.ExtrudeGeometry(roundRect(THREE, w - 2 * bev, h - 2 * bev, r - bev), { depth: Math.max(1e-4, d - 2 * bev), bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev, bevelSegments: 2, curveSegments: curve });
  geo.translate(0, 0, bev - d / 2);
  return geo;
}
function slab(THREE, w, h, d, r, mat, x = 0, y = 0, z = 0, opts) {
  const m = new THREE.Mesh(slabGeo(THREE, w, h, d, r, opts), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true;
  return m;
}
// A turned part: profile [[radius, y], …] from the axis at the bottom, out, up and back to the axis (outward normals).
function lathe(THREE, prof, mat, seg = 48) {
  const m = new THREE.Mesh(new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), seg), mat); m.castShadow = m.receiveShadow = true;
  return m;
}
const mesh = (THREE, geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; return m; };

export default {
  // A small wall sensor with a screen: the temperature large, the humidity under it. A comfort bar under the number is
  // blue when cold and warm when hot; a fault turns the screen red and offline shows dashes.
  temp_humidity_sensor: {
    icon: 'thermohygro', size: 0.14, mountY: 1.5,
    edit: [{ field: 'temperature', kind: 'slider', step: 0.5, unit: '°C', label: 'temp' }, { field: 'humidity', kind: 'slider', step: 1, unit: '%', label: 'humidity', top: 'saturated' }],
    format: (s) => `${oneDecimal(s.temperature)}°C · humidity ${percent(s.humidity)}`,
    control: false,
    model({ THREE, P, M }) {
      // A square e-ink sensor 7.6 cm across and 1.8 cm deep on a smaller magnetic plate, so it floats off the wall on a
      // shadow gap: a matte white shell, a light-grey frame round the paper-white panel under a clear acrylic window,
      // and a pairing button on its top edge.
      const shell = new THREE.MeshPhysicalMaterial({ color: 0xF3F4F2, roughness: 0.55, clearcoat: 0.15, clearcoatRoughness: 0.5 });
      const plate = slab(THREE, 0.058, 0.058, 0.004, 0.006, new THREE.MeshStandardMaterial({ color: 0xC9CDCF, roughness: 0.6 }), 0, 0, 0.002, { bev: 0.001, curve: 3 });
      const body = P.box(0.076, 0.076, 0.018, shell, 0, 0, 0.013, 0.008);
      const frame = slab(THREE, 0.064, 0.056, 0.0012, 0.004, new THREE.MeshStandardMaterial({ color: 0xDADDDB, roughness: 0.5 }), 0, 0.004, 0.0222, { bev: 0.0004, curve: 3 }); frame.castShadow = false;
      const button = P.cyl(0.0042, 0.0042, 0.002, new THREE.MeshStandardMaterial({ color: 0xD6D9D8, roughness: 0.45 }), 0.022, 0.0385, 0.013, 14); button.castShadow = false;
      const { c, tex, g } = screenTex(THREE, 256, 220);
      // e-ink is lit by the room, not by itself: a matte panel with only a little glow so it still reads at night
      const screen = P.screenPlane(0.058, 0.05, tex); screen.position.set(0, 0.004, 0.0232); screen.material.emissiveIntensity = 0.12; screen.material.roughness = 0.75; // e-ink is lit by the room, not backlit: more glow washed the digits out
      const glass = quiet(new THREE.Mesh(new THREE.PlaneGeometry(0.062, 0.054), new THREE.MeshPhysicalMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.07, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, depthWrite: false })));
      glass.position.set(0, 0.004, 0.0238); glass.renderOrder = 1;
      const root = P.group(plate, body, frame, button, screen, glass);
      const led = statusLed(THREE, root, { at: [0, -0.0292, 0.0222], r: 0.0025, size: 0.03 });
      const INK = '#1E2226', PAPER = '#E5E6E0';
      // A water drop: the humidity row's glyph.
      const drop = (x, y, s) => { g.beginPath(); g.moveTo(x, y - s); g.bezierCurveTo(x + s * 0.2, y - s * 0.4, x + s * 0.75, y, x + s * 0.75, y + s * 0.35); g.arc(x, y + s * 0.35, s * 0.75, 0, Math.PI); g.bezierCurveTo(x - s * 0.75, y, x - s * 0.2, y - s * 0.4, x, y - s); g.fill(); };
      const draw = (big, small, tone, alarm = false) => {
        const W = c.width, H = c.height;
        g.fillStyle = alarm ? '#5A120D' : PAPER; g.fillRect(0, 0, W, H);
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillStyle = alarm ? '#FF7A62' : INK; fit(g, big, 600, 84, W - 28); g.fillText(big, W / 2, 74);
        if (tone) { g.fillStyle = tone; g.fillRect(40, 124, W - 80, 7); } // the comfort bar (a colour e-ink accent)
        g.fillStyle = alarm ? '#FFC2B6' : INK; fit(g, small, 600, 46, W - 96); g.fillText(small, W / 2 + 18, 176);
        if (!alarm && small !== '--') drop(W / 2 + 18 - g.measureText(small).width / 2 - 22, 172, 15);
        tex.needsUpdate = true;
      };
      let shown = null;
      return {
        root,
        update(s, t) {
          const tn = Math.round(num(s.temperature) * 10), hm = whole(s.humidity);
          const key = s.status === 'offline' ? 'off' : s.status === 'fault' ? 'fault' : `${tn}/${hm}`;
          if (key !== shown) {
            shown = key;
            if (key === 'off') draw('--', '--', null);
            else if (key === 'fault') draw('!!', 'no reply', null, true);
            else draw(`${oneDecimal(s.temperature)}°`, percent(s.humidity), tn < 180 ? '#2F7FC1' : tn > 270 ? '#E07B28' : '#1FA79E');
          }
          led.set(s, t, HEX.green, 2);
        },
      };
    },
  },

  // A flat puck standing on its probe contacts on the floor. A leak spreads a puddle round it and the puck's light ring
  // and LED turn amber; the puddle shrinks away again when it is dry.
  water_leak_sensor: {
    icon: 'leak', size: 0.3,
    edit: [{ field: 'leak', kind: 'switch' }],
    format: (s) => (s.leak ? 'leak detected' : 'dry'),
    active: (s) => !!s.leak,
    control: { kind: 'switch', field: 'leak' },
    model({ THREE, P, M }) {
      // An 8 cm puck 2.7 cm tall: a glossy white top shell over a matte base, a light ring in the groove between them,
      // a soft-touch button with a drop on it, and three gold-plated contacts it stands on (they sense the water).
      const shell = new THREE.MeshPhysicalMaterial({ color: 0xF4F5F3, roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.25 });
      const puck = lathe(THREE, [[0, 0.003], [0.036, 0.003], [0.039, 0.0045], [0.04, 0.007], [0.04, 0.0108], [0.0386, 0.0116], [0.0386, 0.0128], [0.04, 0.0138], [0.0398, 0.018], [0.037, 0.0225], [0.03, 0.0255], [0.02, 0.0266], [0, 0.0269]], shell, 48);
      const ring = glow(THREE, new THREE.TorusGeometry(0.0391, 0.0012, 6, 48), 0xDCE0DF, 0xFFB020, 0.35);
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.0122;
      const capTex = canvasTex(THREE, (g, w, h) => {
        g.fillStyle = '#E6E9E8'; g.fillRect(0, 0, w, h); g.strokeStyle = '#CDD2D1'; g.lineWidth = 5; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 6, 0, Math.PI * 2); g.stroke();
        const x = w / 2, y = h / 2 - 6, s = 26; g.fillStyle = '#9BA3A6'; g.beginPath(); g.moveTo(x, y - s); g.bezierCurveTo(x + s * 0.2, y - s * 0.4, x + s * 0.75, y, x + s * 0.75, y + s * 0.35); g.arc(x, y + s * 0.35, s * 0.75, 0, Math.PI); g.bezierCurveTo(x - s * 0.75, y, x - s * 0.2, y - s * 0.4, x, y - s); g.fill();
      }, 128, 128);
      const cap = quiet(new THREE.Mesh(new THREE.CircleGeometry(0.013, 32), new THREE.MeshStandardMaterial({ map: capTex, roughness: 0.7 })));
      cap.rotation.x = -Math.PI / 2; cap.position.y = 0.0271;
      const gold = new THREE.MeshStandardMaterial({ color: 0xD4AF6A, metalness: 1, roughness: 0.3 });
      const contacts = mergeMeshes(THREE, [0, 1, 2].map((i) => { const a = Math.PI / 2 + i * Math.PI * 2 / 3; return mesh(THREE, new THREE.CylinderGeometry(0.0032, 0.0034, 0.003, 12), gold, Math.cos(a) * 0.027, 0.0015, Math.sin(a) * 0.027); }), gold);
      contacts.castShadow = false;
      // the puddle: an uneven blob, not a disc
      const blob = new THREE.Shape();
      for (let i = 0; i < 36; i++) { const a = (i / 36) * Math.PI * 2, r = 0.1 * (1 + 0.1 * Math.sin(3 * a + 0.4) + 0.06 * Math.sin(5 * a + 1.3)); if (i) blob.lineTo(Math.cos(a) * r, Math.sin(a) * r); else blob.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
      const puddleMat = new THREE.MeshPhysicalMaterial({ color: 0x4FA8CF, roughness: 0.04, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: 0, depthWrite: false });
      const puddle = quiet(new THREE.Mesh(new THREE.ShapeGeometry(blob), puddleMat));
      puddle.rotation.x = -Math.PI / 2; puddle.position.y = 0.001; puddle.visible = false;
      const ripple = quiet(new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 32), new THREE.MeshBasicMaterial({ color: 0xBFE6F5, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })));
      ripple.rotation.x = -Math.PI / 2; ripple.position.y = 0.0016; ripple.scale.setScalar(0.045); ripple.visible = false;
      const root = P.group(puck, ring, cap, contacts, puddle, ripple);
      const led = statusLed(THREE, root, { at: [0, 0.0262, 0.022], r: 0.0026, size: 0.035 });
      const dt = stepper(); let k = 0;
      return {
        root,
        update(s, t) {
          const wet = !!s.leak && s.status !== 'offline';
          k = ease(k, wet ? 1 : 0, dt(t), 1.6);
          puddle.visible = k > 0.01;
          puddle.scale.setScalar(0.15 + 0.85 * k + 0.02 * Math.sin(t * 2));
          puddleMat.opacity = 0.62 * k;
          const u = cycle(t, 2.2); ripple.visible = wet && k > 0.5;
          if (ripple.visible) { ripple.scale.setScalar(0.045 + 0.06 * u); ripple.material.opacity = 0.6 * (1 - u); }
          ring.material.emissiveIntensity = wet ? 2.5 + 1.5 * Math.sin(t * 6) : 0;
          led.set(s, t, wet ? HEX.amber : HEX.green, wet ? 4 : 1.6);
        },
      };
    },
  },

  // A ceiling radar presence sensor. While it senses someone, rings spread down from it and its ring glows blue; the
  // LED is a quiet green otherwise.
  presence_sensor: {
    icon: 'presence', size: 0.2,
    edit: [{ field: 'present', kind: 'switch' }],
    format: (s) => (s.present ? 'someone is here' : 'room empty'),
    active: (s) => !!s.present,
    control: { kind: 'switch', field: 'present' },
    model({ THREE, P, M }) {
      // A flat mmWave puck 10 cm across and 2.4 cm deep on a twist-lock ceiling plate (the groove between them), its
      // radar behind a gloss-black radome in the face, ringed by a light ring. Thin and dark-eyed, so it never reads
      // as the thick, vented white smoke alarm.
      const shell = new THREE.MeshPhysicalMaterial({ color: 0xF4F5F3, roughness: 0.6, clearcoat: 0.1, clearcoatRoughness: 0.5 });
      const FACE = -0.024;
      const body = lathe(THREE, [[0, FACE], [0.04, FACE], [0.045, FACE + 0.0012], [0.0485, FACE + 0.0045], [0.05, FACE + 0.009], [0.05, -0.0075], [0.0485, -0.0062], [0.0485, -0.0046], [0.051, -0.0036], [0.051, 0], [0, 0]], shell, 48);
      // the radome: a shallow spherical cap 5.2 cm across, 4 mm proud of the face
      const R = 0.0865, cap = Math.asin(0.026 / R);
      const dome = mesh(THREE, new THREE.SphereGeometry(R, 32, 6, 0, Math.PI * 2, 0, cap), new THREE.MeshPhysicalMaterial({ color: 0x1B2126, roughness: 0.16, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05 }));
      dome.rotation.x = Math.PI; dome.position.y = FACE - 0.004 + R; dome.castShadow = false;
      const ring = glow(THREE, new THREE.TorusGeometry(0.031, 0.0017, 8, 48), 0xDCE0DF, 0x3AB7FF, 0.35);
      ring.rotation.x = Math.PI / 2; ring.position.y = FACE;
      const waves = [0, 1, 2].map(() => {
        const w = quiet(new THREE.Mesh(new THREE.RingGeometry(0.78, 1, 32), new THREE.MeshBasicMaterial({ color: 0x3AB7FF, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })));
        w.rotation.x = Math.PI / 2; w.position.y = -0.03; w.scale.setScalar(0.03); w.visible = false; return w;
      });
      const root = P.group(body, dome, ring, ...waves);
      const led = statusLed(THREE, root, { at: [0, FACE - 0.0004, 0.0375], r: 0.0026, size: 0.03 });
      return {
        root,
        update(s, t) {
          const on = !!s.present && s.status !== 'offline';
          ring.material.emissiveIntensity = on ? 2.4 + 0.8 * Math.sin(t * 5) : 0;
          waves.forEach((w, i) => {
            w.visible = on; if (!on) return;
            const u = cycle(t, 1.8, i / 3);
            w.position.y = -0.03 - 0.3 * u; w.scale.setScalar(0.03 + 0.065 * u); w.material.opacity = 0.6 * Math.sin(Math.PI * u);
          });
          led.set(s, t, on ? HEX.blue : HEX.green, on ? 3 : 0.9 + 0.5 * Math.sin(t * 1.5));
        },
      };
    },
  },

  // A wall energy meter: the power draw large on its screen and the energy used today under it, with a load bar beside
  // them. A pulse LED blinks faster the more power it reads.
  energy_meter: {
    icon: 'energy', size: 0.22, mountY: 1.4,
    edit: [{ field: 'watts', kind: 'slider', step: 10, unit: ' W', label: 'power' }],
    format: (s) => `${watts(s.watts)} · ${oneDecimal(s.kwh_today)} kWh today`,
    control: false,
    model({ THREE, P, M }) {
      // A small white consumer unit 21 cm square: through the cover's opening, a light-grey six-module DIN-rail meter
      // (the raised front with its backlit LCD, terminal screws above and below) and two breakers on a steel rail.
      const shell = new THREE.MeshPhysicalMaterial({ color: 0xF3F4F2, roughness: 0.55, clearcoat: 0.15, clearcoatRoughness: 0.5 });
      const enclosure = P.box(0.21, 0.21, 0.05, shell, 0, 0, 0.025, 0.014);
      const recess = slab(THREE, 0.18, 0.12, 0.003, 0.006, new THREE.MeshStandardMaterial({ color: 0x33383D, roughness: 0.7 }), 0, 0, 0.0505, { bev: 0.0008, curve: 3 });
      const rail = slab(THREE, 0.17, 0.035, 0.003, 0.001, new THREE.MeshStandardMaterial({ color: 0xB5BBC0, metalness: 1, roughness: 0.35 }), 0, 0, 0.0535, { bev: 0.0006, curve: 2 });
      const grey = new THREE.MeshStandardMaterial({ color: 0xE4E6E4, roughness: 0.55 }), white = new THREE.MeshStandardMaterial({ color: 0xF4F5F3, roughness: 0.55 });
      const MX = -0.03; // the meter's centre: x −0.084 to 0.024
      const modules = mergeMeshes(THREE, [
        slab(THREE, 0.108, 0.1, 0.02, 0.003, grey, MX, 0, 0.065), slab(THREE, 0.108, 0.05, 0.01, 0.004, grey, MX, 0, 0.079),
      ], grey);
      const breakers = mergeMeshes(THREE, [0.045, 0.065].flatMap((x) => [slab(THREE, 0.0175, 0.1, 0.02, 0.002, white, x, 0, 0.065, { curve: 2 }), slab(THREE, 0.0175, 0.05, 0.01, 0.002, white, x, 0, 0.079, { curve: 2 })]), white);
      const dark = new THREE.MeshStandardMaterial({ color: 0x24282C, roughness: 0.5 });
      // the breakers' levers, both up (on), and each terminal's wire hole with the slot of its screw
      const levers = mergeMeshes(THREE, [0.045, 0.065].map((x) => slab(THREE, 0.008, 0.016, 0.012, 0.002, dark, x, 0.008, 0.088, { curve: 2, bev: 0.001 })), dark);
      const term = [...[-0.068, -0.03, 0.008].map((x) => [x, 0.0105]), [0.045, 0.004], [0.065, 0.004]];
      const steel = new THREE.MeshStandardMaterial({ color: 0xC2C7CC, metalness: 1, roughness: 0.3 });
      const screwGeo = () => new THREE.CylinderGeometry(0.0034, 0.0034, 0.0016, 12).rotateX(Math.PI / 2);
      const screws = mergeMeshes(THREE, [
        ...term.flatMap(([x]) => [-0.038, 0.038].map((y) => mesh(THREE, screwGeo(), steel, x, y, 0.0758))),
        ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => mesh(THREE, screwGeo(), steel, sx * 0.088, sy * 0.088, 0.0506)), // the cover's screws
      ], steel);
      const holes = mergeMeshes(THREE, term.flatMap(([x, w]) => [-0.038, 0.038].flatMap((y) => [
        mesh(THREE, new THREE.BoxGeometry(w, 0.005, 0.002), dark, x, y + Math.sign(y) * 0.0065, 0.0753),
        mesh(THREE, new THREE.BoxGeometry(0.005, 0.0009, 0.0012), dark, x, y, 0.0766),
      ])), dark);
      screws.castShadow = holes.castShadow = levers.castShadow = false;
      const button = P.cyl(0.0035, 0.0035, 0.002, dark, 0.012, -0.012, 0.0845, 12); button.rotation.x = Math.PI / 2; button.castShadow = false;
      const { c, tex, g } = screenTex(THREE, 320, 160);
      const screen = P.screenPlane(0.076, 0.038, tex); screen.position.set(-0.04, 0, 0.0842); screen.material.emissiveIntensity = 0.6;
      const root = P.group(enclosure, recess, rail, modules, breakers, levers, screws, holes, button, screen);
      const led = statusLed(THREE, root, { at: [0.012, 0.011, 0.0842], r: 0.0025, size: 0.03 });
      // A backlit LCD: dark digits on pale aqua, the load in eight segments up its left edge (unlit ones faint, as an
      // LCD's are). Offline its backlight is out.
      const draw = (big, small, mode = 'on', bars = 0) => {
        const W = c.width, H = c.height, alarm = mode === 'fault', off = mode === 'off';
        g.fillStyle = alarm ? '#5A120D' : off ? '#4D5754' : '#BFE6DC'; g.fillRect(0, 0, W, H);
        const ink = alarm ? '#FF7A62' : off ? '#2B3331' : '#12201D';
        if (!alarm) for (let i = 0; i < 8; i++) { g.fillStyle = i < bars ? ink : 'rgba(18,32,29,0.1)'; g.fillRect(16, H - 30 - i * 15, 24, 10); }
        g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillStyle = ink;
        fit(g, big, 600, 72, W - 80); g.fillText(big, W - 16, 60);
        if (small) { g.fillStyle = alarm ? '#FFC2B6' : ink; fit(g, small, 500, 30, W - 80); g.fillText(small, W - 16, 122); }
        tex.needsUpdate = true;
      };
      let shown = null;
      return {
        root,
        update(s, t) {
          const w = Math.round(num(s.watts)), kwh = Math.round(num(s.kwh_today) * 10);
          const key = s.status === 'offline' ? 'off' : s.status === 'fault' ? 'fault' : `${w}/${kwh}`;
          if (key !== shown) {
            shown = key;
            if (key === 'off') draw('--', '', 'off');
            else if (key === 'fault') draw('!!', 'no reply', 'fault');
            else draw(watts(s.watts), `${oneDecimal(s.kwh_today)} kWh today`, 'on', Math.min(8, Math.ceil(Math.max(0, w) / 1250)));
          }
          const rate = Math.min(4, Math.max(0.3, num(s.watts) / 600)), on = cycle(t, 1 / rate) < 0.2;
          led.set(s, t, HEX.blue, on ? 5 : 0.5);
        },
      };
    },
  },

  // A wall charger with a light bar, a row of five battery lights and its connector holstered on the front, the cable
  // looping down under it. While it charges the cable and the light bar glow green and pulse and the battery lights
  // fill up with the charge.
  ev_charger: {
    icon: 'ev', size: 0.3, mountY: 1.2,
    edit: [{ field: 'charging', kind: 'switch' }, { field: 'battery', kind: 'slider', step: 1, unit: '%', label: 'battery' }],
    format: (s) => `${s.charging ? 'charging' : 'idle'} · battery ${percent(s.battery, 'full')}`,
    active: (s) => !!s.charging,
    control: { kind: 'switch', field: 'charging' },
    model({ THREE, P, M }) {
      // A soft white wall box 22 × 32 × 9 cm with a gloss graphite front, its connector parked in a holster in the
      // front, the cable leaving through a gland underneath and the mains conduit going into the wall beside it.
      const shell = new THREE.MeshPhysicalMaterial({ color: 0xF3F4F2, roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.35 });
      const body = P.box(0.22, 0.32, 0.09, shell, 0, 0.04, 0.045, 0.035);
      const face = slab(THREE, 0.17, 0.26, 0.006, 0.03, new THREE.MeshPhysicalMaterial({ color: 0x24282C, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.12 }), 0, 0.045, 0.089, { bev: 0.0015 });
      const bar = glow(THREE, slabGeo(THREE, 0.11, 0.008, 0.002, 0.004, { bev: 0.0006, curve: 3 }), 0xDCE0DF, 0x2FE08A); bar.position.set(0, 0.15, 0.0925);
      const litMat = new THREE.MeshStandardMaterial({ color: 0x1B3B2C, emissive: 0x39E58B, emissiveIntensity: 1.8 });
      const darkMat = new THREE.MeshStandardMaterial({ color: 0x3A4046, roughness: 0.6 });
      const cellGeo = slabGeo(THREE, 0.02, 0.007, 0.0016, 0.0035, { bev: 0.0004, curve: 3 });
      const cells = [];
      for (let i = 0; i < 5; i++) { const cl = new THREE.Mesh(cellGeo, darkMat); cl.position.set((i - 2) * 0.026, 0.108, 0.0923); cells.push(cl); }
      // a contactless card mark, printed on the glass
      const nfc = canvasTex(THREE, (g, w, h) => { g.clearRect(0, 0, w, h); g.strokeStyle = 'rgba(190,198,204,0.55)'; g.lineWidth = 7; g.lineCap = 'round'; for (const r of [14, 28, 42]) { g.beginPath(); g.arc(w * 0.3, h / 2, r, -0.8, 0.8); g.stroke(); } }, 128, 128);
      const mark = quiet(new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.04), new THREE.MeshStandardMaterial({ map: nfc, transparent: true, roughness: 0.4, depthWrite: false })));
      mark.position.set(0.004, 0.045, 0.0922);
      // the holster and the connector in it: a head pushed into the socket, a grip angled down and out, a rubber boot
      const graphite = new THREE.MeshStandardMaterial({ color: 0x2A2E33, roughness: 0.55, metalness: 0.1 });
      const HY = -0.05, d = new THREE.Vector3(0, -0.894, 0.447); // the grip's direction, out of the head
      const holster = mesh(THREE, new THREE.CylinderGeometry(0.031, 0.033, 0.018, 28).rotateX(Math.PI / 2), graphite, 0, HY, 0.099);
      const head = mesh(THREE, new THREE.CylinderGeometry(0.025, 0.025, 0.042, 24).rotateX(Math.PI / 2), graphite, 0, HY, 0.121);
      const latch = slab(THREE, 0.012, 0.026, 0.004, 0.003, graphite, 0, HY + 0.026, 0.125, { bev: 0.001, curve: 2 }); latch.rotation.x = Math.PI / 2;
      const grip = mesh(THREE, new THREE.CapsuleGeometry(0.016, 0.05, 6, 16), graphite, 0, HY - 0.03, 0.155); grip.rotation.x = -0.4636;
      const gripEnd = new THREE.Vector3(0, HY - 0.06, 0.17);
      const boot = mesh(THREE, new THREE.CylinderGeometry(0.013, 0.009, 0.03, 14), M.rubber, ...gripEnd.clone().addScaledVector(d, 0.015).toArray()); boot.rotation.x = -0.4636;
      const plug = mergeMeshes(THREE, [holster, head, latch, grip], graphite, { consume: false });
      const glands = mergeMeshes(THREE, [0.075, -0.07].map((x) => mesh(THREE, new THREE.CylinderGeometry(0.015, 0.016, 0.012, 18), graphite, x, -0.124, 0.045)), graphite);
      const cableMat = new THREE.MeshStandardMaterial({ color: 0x1F2A25, emissive: 0x2FE08A, emissiveIntensity: 0, roughness: 0.6 });
      const start = gripEnd.clone().addScaledVector(d, 0.028);
      const cablePath = new THREE.CatmullRomCurve3([start, [0.02, -0.2, 0.172], [0.07, -0.272, 0.13], [0.12, -0.25, 0.08], [0.125, -0.17, 0.055], [0.09, -0.128, 0.045], [0.075, -0.11, 0.045]].map((p) => (p.isVector3 ? p : new THREE.Vector3(...p))));
      const cable = mesh(THREE, new THREE.TubeGeometry(cablePath, 64, 0.011, 10), cableMat);
      const conduit = P.tube([[-0.07, -0.118, 0.045], [-0.07, -0.15, 0.04], [-0.07, -0.172, 0.024], [-0.07, -0.18, 0.009]], 0.009, new THREE.MeshStandardMaterial({ color: 0x9EA4A8, roughness: 0.6 }));
      const root = P.group(body, face, bar, ...cells, mark, plug, boot, glands, cable, conduit);
      const led = statusLed(THREE, root, { at: [0, 0.132, 0.0925], r: 0.0035, size: 0.035 });
      let shown = -1;
      return {
        root,
        update(s, t) {
          const on = !!s.charging && s.status !== 'offline';
          const lit = Math.round(clamp01(num(s.battery) / 100) * 5);
          if (lit !== shown) { shown = lit; cells.forEach((cl, i) => { cl.material = i < lit ? litMat : darkMat; }); }
          const pulse = on ? 0.75 + 0.25 * Math.sin(t * 4) : 0;
          cableMat.emissiveIntensity = on ? 1.2 + 1.8 * pulse : 0;
          bar.material.emissiveIntensity = on ? 2 + 2 * pulse : 0.25;
          bar.material.emissive.setHex(on ? 0x2FE08A : 0x6FB3C2);
          led.set(s, t, on ? HEX.green : HEX.blue, on ? 3 : 1);
        },
      };
    },
  },

  // A smart valve on a garden pipe feeding a pop-up sprinkler on a small lawn. Open: the actuator's dial turns along
  // the pipe, the head rises, water arcs out round it and the lawn darkens. Closed: the dial turns across, the head
  // sinks and the lawn dries.
  sprinkler_valve: {
    icon: 'sprinkler', size: 0.5,
    edit: [{ field: 'open', kind: 'switch' }],
    format: (s) => (s.open ? 'open · watering' : 'closed'),
    active: (s) => !!s.open,
    control: { kind: 'switch', field: 'open' },
    model({ THREE, P, M }) {
      const HX = 0.06, HZ = 0.05; // the sprinkler head
      const VX = -0.095, VZ = -0.12, PY = 0.055, XA = -0.17, XB = -0.02; // the valve's centre, the pipe's height and its two risers
      // a patch of turf on a soil edge
      const grass = canvasTex(THREE, (g, w, h) => {
        g.fillStyle = '#DCE6D2'; g.fillRect(0, 0, w, h);
        for (let i = 0; i < 700; i++) { g.fillStyle = Math.random() < 0.5 ? '#F6FAF0' : '#A3B593'; const x = Math.random() * w, y = Math.random() * h; g.fillRect(x, y, 1.2, 2 + Math.random() * 3); }
      }, 128, 128);
      grass.repeat.set(3, 3);
      const DRY = new THREE.Color(0x78A653), WET = new THREE.Color(0x3E6B33);
      const lawnMat = new THREE.MeshStandardMaterial({ color: DRY, map: grass, roughness: 1 });
      const soil = P.cyl(0.24, 0.242, 0.006, new THREE.MeshStandardMaterial({ color: 0x5A4330, roughness: 1 }), 0, 0.003, 0, 48); soil.castShadow = false;
      const lawn = P.cyl(0.232, 0.232, 0.012, lawnMat, 0, 0.007, 0, 48); lawn.castShadow = false;
      // galvanised pipe up out of the turf, along through the valve and back down, with a fitting at each riser
      const galv = new THREE.MeshStandardMaterial({ color: 0xA7ADB2, metalness: 1, roughness: 0.42 });
      const V = (x, y, z) => new THREE.Vector3(x, y, z), run = new THREE.CurvePath();
      run.add(new THREE.LineCurve3(V(XA, 0.004, VZ), V(XA, PY - 0.02, VZ)));
      run.add(new THREE.QuadraticBezierCurve3(V(XA, PY - 0.02, VZ), V(XA, PY, VZ), V(XA + 0.02, PY, VZ)));
      run.add(new THREE.LineCurve3(V(XA + 0.02, PY, VZ), V(XB - 0.02, PY, VZ)));
      run.add(new THREE.QuadraticBezierCurve3(V(XB - 0.02, PY, VZ), V(XB, PY, VZ), V(XB, PY - 0.02, VZ)));
      run.add(new THREE.LineCurve3(V(XB, PY - 0.02, VZ), V(XB, 0.004, VZ)));
      const pipe = mergeMeshes(THREE, [
        mesh(THREE, new THREE.TubeGeometry(run, 48, 0.0105, 10), galv),
        ...[XA, XB].map((x) => mesh(THREE, new THREE.CylinderGeometry(0.0135, 0.0135, 0.014, 16), galv, x, 0.02, VZ)),
      ], galv);
      // the brass ball valve: a turned body between two hex unions, its stem up into the actuator
      const brass = new THREE.MeshPhysicalMaterial({ color: 0xB8914F, metalness: 1, roughness: 0.36, clearcoat: 0.25, clearcoatRoughness: 0.35 });
      const vbody = lathe(THREE, [[0, -0.024], [0.014, -0.024], [0.016, -0.02], [0.019, -0.012], [0.02, 0], [0.019, 0.012], [0.016, 0.02], [0.014, 0.024], [0, 0.024]], brass, 32);
      vbody.rotation.z = Math.PI / 2; vbody.position.set(VX, PY, VZ);
      const nuts = [-0.03, 0.03].map((dx) => { const n = mesh(THREE, new THREE.CylinderGeometry(0.0175, 0.0175, 0.012, 6), brass, VX + dx, PY, VZ); n.rotation.z = Math.PI / 2; return n; });
      const stem = mesh(THREE, new THREE.CylinderGeometry(0.0065, 0.0065, 0.014, 14), brass, VX, PY + 0.024, VZ);
      const valve = mergeMeshes(THREE, [vbody, ...nuts, stem], brass);
      // a stainless bracket wrapped round the valve: a plate under the actuator, two legs and a clamp bar beneath
      const bracketMat = new THREE.MeshStandardMaterial({ color: 0xBFC4C8, metalness: 1, roughness: 0.38 });
      const flat = (w, d, y) => { const m = slab(THREE, w, d, 0.004, 0.003, bracketMat, VX, y, VZ, { bev: 0.0008, curve: 2 }); m.rotation.x = -Math.PI / 2; return m; };
      const bracket = mergeMeshes(THREE, [flat(0.07, 0.05, 0.088), flat(0.03, 0.05, 0.033), ...[-1, 1].map((sz) => slab(THREE, 0.03, 0.057, 0.003, 0.003, bracketMat, VX, 0.0605, VZ + sz * 0.0235, { bev: 0.0008, curve: 2 }))], bracketMat);
      // the actuator: a white housing with a graphite control panel (button, LED) and a position dial on top
      const shell = new THREE.MeshPhysicalMaterial({ color: 0xF3F4F2, roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.35 });
      const housing = P.box(0.075, 0.058, 0.062, shell, VX, 0.119, VZ, 0.014);
      const graphite = new THREE.MeshStandardMaterial({ color: 0x2A2E33, roughness: 0.5 });
      const panel = slab(THREE, 0.044, 0.026, 0.002, 0.004, graphite, VX, 0.119, VZ + 0.0315, { bev: 0.0005, curve: 3 }); panel.castShadow = false;
      const button = mesh(THREE, new THREE.CylinderGeometry(0.0055, 0.0055, 0.002, 16).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xD6D9D8, roughness: 0.45 }), VX - 0.01, 0.119, VZ + 0.0328); button.castShadow = false;
      const dialBase = mesh(THREE, new THREE.CylinderGeometry(0.015, 0.015, 0.003, 24), graphite, VX, 0.1495, VZ); dialBase.castShadow = false;
      const accent = new THREE.MeshStandardMaterial({ color: 0x6FD3CB, roughness: 0.4, emissive: 0x2FB5AC, emissiveIntensity: 0.4 });
      const trim = mesh(THREE, new THREE.TorusGeometry(0.015, 0.0011, 6, 32), accent, VX, 0.1495, VZ); trim.rotation.x = Math.PI / 2; trim.castShadow = false;
      const pointer = slab(THREE, 0.024, 0.005, 0.0025, 0.0022, accent, 0, 0, 0, { bev: 0.0006, curve: 2 }); pointer.rotation.x = -Math.PI / 2; pointer.castShadow = false;
      const dial = P.group(pointer); dial.position.set(VX, 0.1515, VZ);
      const lead = P.tube([[VX - 0.02, 0.105, VZ - 0.028], [VX - 0.024, 0.098, VZ - 0.043], [VX - 0.034, 0.06, VZ - 0.052], [VX - 0.045, 0.02, VZ - 0.055], [VX - 0.05, 0.004, VZ - 0.055]], 0.003, M.rubber);
      lead.castShadow = false;
      // the pop-up sprinkler: a flange flush on the turf, a stem that rises out of it and a turning nozzle turret
      const black = new THREE.MeshStandardMaterial({ color: 0x1F2225, roughness: 0.55 });
      const flange = P.cyl(0.024, 0.026, 0.005, black, HX, 0.0145, HZ, 28);
      const wiper = P.cyl(0.0165, 0.0165, 0.0012, M.rubber, HX, 0.0172, HZ, 24); wiper.castShadow = false;
      const head = mesh(THREE, new THREE.CylinderGeometry(0.012, 0.012, 1, 20).translate(0, 0.5, 0), M.steel, HX, 0.004, HZ);
      const nozzle = P.group(
        mesh(THREE, new THREE.CylinderGeometry(0.015, 0.015, 0.012, 20), black, 0, 0.006, 0),
        slab(THREE, 0.012, 0.007, 0.008, 0.002, black, 0.014, 0.007, 0, { bev: 0.001, curve: 2 }),
      );
      nozzle.position.set(HX, 0.021, HZ);
      // the spray: one Points object, 6 arms x 4 drops
      const N = 24, pos = new Float32Array(N * 3), geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const dot = canvasTex(THREE, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = '#fff'; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 1, 0, Math.PI * 2); g.fill(); }, 32, 32);
      const mist = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x9FD8F5, size: 0.016, map: dot, alphaTest: 0.3, transparent: true, opacity: 0.85, depthWrite: false }));
      mist.frustumCulled = false; mist.raycast = () => {}; mist.visible = false; mist.userData.noAO = true;
      const root = P.group(soil, lawn, pipe, valve, bracket, housing, panel, button, dialBase, trim, dial, lead, flange, wiper, head, nozzle, mist);
      const led = statusLed(THREE, root, { at: [VX + 0.012, 0.119, VZ + 0.0328], r: 0.003, size: 0.03 });
      const dt = stepper(); let up = 0, wet = 0, turn = 0;
      return {
        root,
        update(s, t) {
          const d = dt(t), open = !!s.open && s.status !== 'offline';
          up = ease(up, open ? 1 : 0, d, 7);
          wet = ease(wet, open ? 1 : 0, d, 1);
          turn = ease(turn, open ? 1 : 0, d, 4);
          dial.rotation.y = (1 - turn) * Math.PI / 2; // along the pipe when open, across it when closed, as a ball valve's handle
          const h = 0.017 + 0.07 * up; // the stem: 1.7 cm (sunk in the flange) to 8.7 cm out of the turf
          head.scale.y = h; nozzle.position.y = 0.004 + h; nozzle.rotation.y = t * 2.2;
          lawnMat.color.lerpColors(DRY, WET, wet);
          mist.visible = up > 0.9;
          if (mist.visible) {
            const hs = nozzle.position.y + 0.008, spin = t * 0.9;
            for (let i = 0; i < N; i++) {
              const p = cycle(t, 1.1, Math.floor(i / 6) / 4), a = (i % 6) / 6 * Math.PI * 2 + spin;
              const y = hs + 0.3 * p - (0.3 + hs - 0.02) * p * p, r = 0.17 * p;
              pos[i * 3] = HX + Math.cos(a) * r; pos[i * 3 + 1] = Math.max(0.014, y); pos[i * 3 + 2] = HZ + Math.sin(a) * r;
            }
            geo.attributes.position.needsUpdate = true;
          }
          led.set(s, t, open ? HEX.blue : HEX.green, 2);
        },
      };
    },
  },
};
