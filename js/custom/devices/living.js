// The Home and living types' card UI and 3D models for the custom room (contract: devices/index.js): a smart plug, a
// ceiling light, a colour bulb, a TV, a smart speaker, a robot vacuum, a ceiling fan, an air conditioner, a space heater,
// a humidifier and an air purifier. Each is modelled on the real product of its kind (real sizes, rounded edges,
// plastic, metal, fabric and glass finishes) and stands, hangs or mounts on its own with a status LED. What is on shows
// on the model: the TV's picture, the speaker's light ring, the vacuum on its round, the fan's blades, air lines from the
// air conditioner and purifier, mist from the humidifier, the heater's glowing grille. The three lights carry real point
// lights (kit.pointLight); room3d.js deals the few light slots to the lit ones.
import { HEX, LIGHT_HEX, num, clamp01, pct, oneDecimal, statusLed, mergeMeshes, pointLight, ease, stepper, glowMesh as glow, screenTex, glowMap, canvasTex } from './kit.js';

const whole = (v) => Math.round(num(v));
const dimmer = (s) => { const r = pct(s.brightness); return r <= 0 ? 'off' : r >= 100 ? 'full' : `on · ${r}%`; };
// A 0–100 reading as text: "saturated" at the top, never "100%".
const percent = (v, full = 'saturated') => { const r = whole(v); return r >= 100 ? full : `${Math.max(0, r)}%`; };

// A flat, see-through, unlit shape (air lines, heat haze): own material so each can fade alone. Hidden until its model
// shows it, but parked at `y` (where the effect starts) so it never sits under the floor.
function ghost(THREE, w, h, hex, y = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0, depthWrite: false }));
  m.position.y = y; m.userData.noAO = true; m.raycast = () => {}; m.visible = false;
  return m;
}
// 0 → 1 over `period` seconds, offset by `phase` (0–1): for looping effects.
const cycle = (t, period, phase = 0) => (((t / period + phase) % 1) + 1) % 1;

// ---- Rounded parts. P.box with a radius is a RoundedBox of ~970 triangles; these extrude or turn a profile instead,
// ~150–350 triangles a part, so a device with a dozen rounded parts stays near the budget.
// A rounded-rectangle outline w × h, corner radius r, centred on the origin.
function rrShape(THREE, w, h, r) {
  r = Math.max(1e-4, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4));
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
const shaded = (m) => { m.castShadow = m.receiveShadow = true; return m; };
// A slab w × h (x, y) and d deep, its back face on z = 0, every edge bevelled by b (seg steps round the bevel).
function slab(THREE, w, h, d, r, mat, { b = Math.min(0.004, d / 3), seg = 3, curve = 4 } = {}) {
  const geo = new THREE.ExtrudeGeometry(rrShape(THREE, w - 2 * b, h - 2 * b, Math.max(0.0005, r - b)), { depth: Math.max(1e-4, d - 2 * b), bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: seg, curveSegments: curve });
  geo.translate(0, 0, b);
  return shaded(new THREE.Mesh(geo, mat));
}
// The same slab lying flat: w along x, d along z, t thick, its underside on y = 0.
function flat(THREE, w, d, t, r, mat, opts) { const m = slab(THREE, w, d, t, r, mat, opts); m.geometry.rotateX(-Math.PI / 2); return m; }
// The same slab standing on its side, facing +x: d along z, h tall (centred on y = 0), t deep from x = 0.
function sideSlab(THREE, d, h, t, r, mat, opts) { const m = slab(THREE, d, h, t, r, mat, opts); m.geometry.rotateY(Math.PI / 2); return m; }
// A turned part: a profile of [radius, y] pairs, listed from the bottom up, spun round y.
function lathe(THREE, prof, mat, seg = 32, phi0 = 0, phiLen = Math.PI * 2) {
  return shaded(new THREE.Mesh(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), seg, phi0, phiLen), mat));
}
const at = (m, x, y, z) => { m.position.set(x, y, z); return m; };

export default {
  // A US duplex outlet low on the wall (a 7.5 × 12 cm plate) with a compact smart plug in its upper socket: a glossy
  // white body 5 × 6.6 cm and 3.4 cm deep whose power button is ringed by a light that glows blue while on. The lower
  // socket stays free, as the real plugs are shaped to leave it.
  smart_plug: {
    icon: 'plug', size: 0.2, mountY: 0.4,
    edit: [{ field: 'on', kind: 'switch' }],
    format: (s) => { const w = whole(s.watts); return s.on ? (w > 0 ? `on · ${w} W` : 'on') : 'off'; },
    active: (s) => !!s.on,
    control: { kind: 'switch', field: 'on' },
    model({ THREE, P, M }) {
      const matte = new THREE.MeshStandardMaterial({ color: 0xEDEEEB, roughness: 0.6 });
      const gloss = new THREE.MeshPhysicalMaterial({ color: 0xF5F6F5, roughness: 0.4, clearcoat: 0.8, clearcoatRoughness: 0.18 });
      // plate, the free socket's raised face and the plug's collar: one matte mesh
      const shell = mergeMeshes(THREE, [
        slab(THREE, 0.075, 0.12, 0.008, 0.005, matte, { b: 0.0025, seg: 2 }),
        at(slab(THREE, 0.036, 0.031, 0.004, 0.006, matte, { b: 0.0012, seg: 1 }), 0, -0.0195, 0.007),
        at(slab(THREE, 0.05, 0.066, 0.006, 0.012, matte, { b: 0.002, seg: 1 }), 0, 0.03, 0.007),
      ], matte, { consume: true });
      // the free socket's face: two blade slots (the neutral taller) over a round-topped ground hole
      const socketTex = canvasTex(THREE, (g, w, h) => {
        g.fillStyle = '#EDEEEB'; g.fillRect(0, 0, w, h); g.fillStyle = '#26292C';
        g.beginPath(); g.roundRect(15, 12, 7, 22, 2); g.roundRect(42, 12, 7, 26, 2); g.fill();
        g.beginPath(); g.arc(32, 46, 6, Math.PI, 0); g.lineTo(38, 54); g.lineTo(26, 54); g.closePath(); g.fill();
      }, 64, 64);
      const face = at(new THREE.Mesh(new THREE.PlaneGeometry(0.031, 0.028), new THREE.MeshStandardMaterial({ map: socketTex, roughness: 0.55 })), 0, -0.0195, 0.0111);
      const screw = at(P.cyl(0.0032, 0.0032, 0.0012, M.metal, 0, 0, 0, 12), 0, -0.048, 0.0085); // the plate's lower screw (the plug hides the upper) screw.rotation.x = Math.PI / 2; screw.castShadow = false;
      const body = at(slab(THREE, 0.05, 0.066, 0.028, 0.012, gloss, { b: 0.006 }), 0, 0.03, 0.013);
      // a slightly domed button, a thin light ring round it
      const button = at(lathe(THREE, [[0, 0], [0.0105, 0], [0.0105, 0.0012], [0.008, 0.0026], [0, 0.003]], gloss, 24), 0, 0.038, 0.0405); button.rotation.x = Math.PI / 2; button.castShadow = false;
      const ringMat = new THREE.MeshStandardMaterial({ color: 0x1B1D20, emissive: 0x3AB7FF, emissiveIntensity: 0, roughness: 0.4 });
      const ring = at(new THREE.Mesh(new THREE.TorusGeometry(0.0128, 0.0016, 6, 32), ringMat), 0, 0.038, 0.0412);
      const root = P.group(shell, face, screw, body, button, ring);
      const led = statusLed(THREE, root, { at: [0, 0.009, 0.0415], r: 0.003 });
      return {
        root,
        update(s, t) {
          ringMat.emissiveIntensity = s.on ? 2.6 : 0;
          led.set(s, t, s.on ? HEX.blue : HEX.green, s.on ? 4 : 1.5);
        },
      };
    },
  },

  // A pendant ceiling light: an opal glass globe under a painted metal cup, on a slim rod from a small canopy. The globe
  // glows with the dimmer. With the room's assets it is the real lamp (Poly Haven modern_ceiling_lamp_01), its 95 cm
  // drop scaled to 63 cm so it clears heads; without them, a primitive copy of the same lamp at the same size.
  ceiling_light: {
    icon: 'bulb', size: 0.6,
    edit: [{ field: 'brightness', kind: 'slider', step: 0.01, scale: 100, unit: '%' }],
    format: dimmer,
    active: (s) => pct(s.brightness) > 0,
    control: { kind: 'bar', field: 'brightness', min: 0, max: 1 },
    model({ THREE, P, M, A }) {
      const S = 0.66, TOP = 1.173, WARM = 0xFFE2B8; // the model's scale, and its canopy top (y in the model's metres)
      let lamp = A?.copy?.('modern_ceiling_lamp_01'), globeMat = null, bulbMat = null;
      if (lamp) {
        // The glass globe and the bulb inside it get their own materials (copies share the loaded ones), to glow alone.
        lamp.traverse((o) => {
          if (!o.isMesh || Array.isArray(o.material)) return;
          const name = o.material.name || '';
          if (name.endsWith('_glass')) { globeMat = o.material.clone(); o.material = globeMat; }
          else if (name.endsWith('_globe')) { bulbMat = o.material.clone(); o.material = bulbMat; }
        });
        if (!globeMat) lamp = null; // not the model we know: fall back to the primitive one
      }
      if (!lamp) {
        // The same lamp in the model's own metres: canopy, rod, a cup over the globe's open top, the globe, a bulb.
        const paint = new THREE.MeshStandardMaterial({ color: 0xCBC4B8, metalness: 0.5, roughness: 0.42 });
        const canopy = lathe(THREE, [[0, 1.13], [0.05, 1.13], [0.058, 1.135], [0.061, 1.145], [0.061, 1.173], [0, 1.173]], paint, 32);
        const rod = P.cyl(0.006, 0.006, 0.54, paint, 0, 0.86, 0, 10);
        const cup = lathe(THREE, [[0.026, 0.46], [0.03, 0.5], [0.037, 0.51], [0.149, 0.53], [0.128, 0.55], [0.106, 0.56], [0.081, 0.57], [0.055, 0.58], [0.029, 0.59], [0, 0.592]], paint, 40);
        globeMat = new THREE.MeshPhysicalMaterial({ color: 0xF6F4EF, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08, side: THREE.DoubleSide });
        const globe = at(shaded(new THREE.Mesh(new THREE.SphereGeometry(0.217, 40, 20, 0, Math.PI * 2, 0.789, 1.571), globeMat)), 0, 0.375, 0);
        const bulb = at(glow(THREE, new THREE.SphereGeometry(0.037, 14, 10), 0xF6F0E4, WARM), 0, 0.415, 0); bulbMat = bulb.material;
        lamp = P.group(canopy, rod, cup, globe, bulb);
      }
      globeMat.userData.shared = false; globeMat.emissive.setHex(WARM); globeMat.emissiveIntensity = 0;
      if (bulbMat) { bulbMat.userData.shared = false; bulbMat.emissive.setHex(WARM); bulbMat.emissiveIntensity = 0; }
      lamp.scale.setScalar(S); lamp.position.y = -TOP * S; // canopy on the ceiling (y = 0), the globe's foot 63 cm down
      const root = P.group(lamp);
      const led = statusLed(THREE, root, { at: [0.08, -0.404, 0], r: 0.005 }); // on the cup over the globe
      const light = pointLight(THREE, root, [0, (0.375 - TOP) * S, 0], { hex: WARM }); // the globe's centre
      let shown = -1;
      return {
        root,
        update(s, t) {
          const b = clamp01(s.brightness);
          if (b !== shown) { shown = b; globeMat.emissiveIntensity = b * 1.6; if (bulbMat) bulbMat.emissiveIntensity = b * 3; light.intensity = b * 2.2; }
          led.set(s, t);
        },
      };
    },
  },

  // A smart bulb on a small bare-bulb stand: an A19 bulb (frosted diffuser over an aluminium neck, drawn 1.25× life
  // size so its colour reads across the room) in a white socket on a brushed post and a weighted base. It shows its
  // colour, glows with the dimmer and lights the room in that colour.
  colour_bulb: {
    icon: 'bulb', size: 0.4,
    edit: [{ field: 'brightness', kind: 'slider', step: 0.01, scale: 100, unit: '%' }],
    format: (s) => { const r = pct(s.brightness); return r <= 0 ? 'off' : `${s.color} · ${r >= 100 ? 'full' : `${r}%`}`; },
    active: (s) => pct(s.brightness) > 0,
    control: { kind: 'bar', field: 'brightness', min: 0, max: 1 },
    model({ THREE, P, M }) {
      const white = new THREE.MeshPhysicalMaterial({ color: 0xF2F3F1, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.4 });
      const alu = new THREE.MeshStandardMaterial({ color: 0xCDD1D4, metalness: 1, roughness: 0.32 });
      const base = lathe(THREE, [[0, 0], [0.1, 0], [0.106, 0.004], [0.108, 0.012], [0.104, 0.02], [0.09, 0.025], [0.03, 0.028], [0, 0.028]], white, 48);
      const post = P.cyl(0.008, 0.008, 0.34, alu, 0, 0.195, 0, 16);
      const socket = lathe(THREE, [[0, 0.36], [0.012, 0.36], [0.02, 0.368], [0.021, 0.4], [0.019, 0.405], [0, 0.405]], white, 32);
      // The bulb in millimetres from the foot of its E26 thread (hidden in the socket), scaled up and set in the socket.
      const B = 0.00125, Y0 = 0.38, mm = (prof) => prof.map(([r, y]) => [r * B, Y0 + y * B]);
      const band = lathe(THREE, mm([[13.6, 19], [13.6, 24]]), M.steel, 24);
      const neck = lathe(THREE, mm([[14, 23], [15, 26], [17, 32], [20, 40], [23, 47], [25.5, 52], [26, 54], [25, 55]]), alu, 40);
      const bulb = glow(THREE, new THREE.LatheGeometry(mm([[25, 54], [28, 58], [30, 66], [30.2, 74], [29.5, 84], [27, 92], [22.5, 100], [16, 106], [8, 110], [0, 111.5]]).map(([r, y]) => new THREE.Vector2(r, y)), 40), 0xF3F0EA, 0xFFB46B, 0.45);
      bulb.castShadow = false; // it is the light
      // the cord out of the back of the base, with its strain relief
      const relief = at(P.cyl(0.0055, 0.0045, 0.016, M.rubber, 0, 0, 0, 10), 0, 0.01, -0.104); relief.rotation.x = Math.PI / 2;
      const cord = P.tube([[0, 0.01, -0.11], [0, 0.004, -0.13], [0.02, 0.003, -0.155], [0.05, 0.003, -0.17]], 0.0025, M.rubber);
      const root = P.group(base, post, socket, band, neck, bulb, relief, cord);
      const led = statusLed(THREE, root, { at: [0, 0.0265, 0.08], r: 0.005 });
      const light = pointLight(THREE, root, [0, Y0 + 80 * B, 0], { hex: LIGHT_HEX.warm });
      let shown = '';
      return {
        root,
        update(s, t) {
          const b = clamp01(s.brightness), key = `${b.toFixed(3)}|${s.color}`;
          if (key !== shown) {
            shown = key; const hex = LIGHT_HEX[s.color] ?? LIGHT_HEX.warm;
            bulb.material.emissive.setHex(hex); bulb.material.emissiveIntensity = b * 3.2; light.color.setHex(hex); light.intensity = b * 1.8;
            bulb.material.color.setHex(b > 0 ? 0xF3F0EA : 0xE4E2DD);
          }
          led.set(s, t);
        },
      };
    },
  },

  // A 50" flat-screen TV on the wall: a thin anodised frame round glass (7 mm bezels, a 15 mm chin with the LED), on a
  // matte back housing that holds it 3 cm off the wall. The screen shows a picture and a volume bar while on, and is dark
  // glass while off; a fault dims the picture under a red "no reply" pill, offline is a dead screen.
  tv: {
    icon: 'tv', size: 1.2, mountY: 1.3,
    edit: [{ field: 'on', kind: 'switch' }, { field: 'volume', kind: 'slider', step: 1, label: 'volume' }],
    format: (s) => (s.on ? `on · volume ${whole(s.volume)}` : 'off'),
    active: (s) => !!s.on,
    control: { kind: 'switch', field: 'on' },
    model({ THREE, P, M }) {
      const W = 1.1, H = 0.64;
      const frameMat = new THREE.MeshStandardMaterial({ color: 0x2A2D31, metalness: 0.8, roughness: 0.35 });
      const backMat = new THREE.MeshStandardMaterial({ color: 0x1E2023, roughness: 0.65 });
      const panel = at(slab(THREE, W, H, 0.012, 0.006, frameMat, { b: 0.003, seg: 2 }), 0, 0, 0.03);
      const back = at(slab(THREE, 0.8, 0.42, 0.031, 0.03, backMat, { b: 0.008 }), 0, -0.06, 0);
      const ir = at(slab(THREE, 0.04, 0.008, 0.01, 0.003, backMat, { b: 0.002, seg: 1 }), 0, -H / 2 - 0.003, 0.03); // the IR window under the chin
      const CW = 512, CH = 288, K = CW / 320; // drawn on a 320 × 180 grid, scaled up to the canvas
      const { tex, g } = screenTex(THREE, CW, CH);
      const screen = at(new THREE.Mesh(new THREE.PlaneGeometry(W - 0.014, H - 0.022), new THREE.MeshPhysicalMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.9, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 })), 0, 0.004, 0.0422);
      const root = P.group(panel, back, ir, screen);
      const led = statusLed(THREE, root, { at: [W / 2 - 0.05, -H / 2 + 0.0075, 0.0425], r: 0.003 });
      const draw = (on, vol, status) => {
        const dead = status === 'offline';
        g.setTransform(K, 0, 0, K, 0, 0);
        g.fillStyle = '#06080A'; g.fillRect(0, 0, 320, 180);
        if (!on || dead) { // dark glass with a faint reflection
          const gr = g.createLinearGradient(0, 0, 320, 180); gr.addColorStop(0, 'rgba(255,255,255,.07)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 320, 180);
        } else {
          // a lakeside at sunset: sky, sun and its halo, two ranges of hills, the lake with the sun's glints, the near shore
          const sky = g.createLinearGradient(0, 0, 0, 120); sky.addColorStop(0, '#2E6FA8'); sky.addColorStop(0.7, '#F0B27A'); sky.addColorStop(1, '#F6D9A8'); g.fillStyle = sky; g.fillRect(0, 0, 320, 120);
          const halo = g.createRadialGradient(236, 92, 0, 236, 92, 70); halo.addColorStop(0, 'rgba(255,240,200,.75)'); halo.addColorStop(1, 'rgba(255,240,200,0)'); g.fillStyle = halo; g.fillRect(150, 20, 172, 100);
          g.fillStyle = '#FFE9B0'; g.beginPath(); g.arc(236, 92, 18, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#5C7F8C'; g.beginPath(); g.moveTo(0, 120); g.lineTo(0, 100); g.quadraticCurveTo(60, 84, 120, 104); g.quadraticCurveTo(190, 88, 320, 106); g.lineTo(320, 120); g.fill();
          g.fillStyle = '#2F5E57'; g.beginPath(); g.moveTo(0, 122); g.lineTo(0, 108); g.quadraticCurveTo(80, 96, 150, 114); g.quadraticCurveTo(220, 102, 320, 116); g.lineTo(320, 122); g.fill();
          const lake = g.createLinearGradient(0, 120, 0, 160); lake.addColorStop(0, '#E9B98A'); lake.addColorStop(1, '#3E6C82'); g.fillStyle = lake; g.fillRect(0, 120, 320, 40);
          g.fillStyle = 'rgba(255,236,190,.8)'; for (let i = 0; i < 7; i++) g.fillRect(236 - (12 - i) * 1.6, 124 + i * 4.5, (12 - i) * 3.2, 1.6);
          g.fillStyle = '#1F3F3A'; g.beginPath(); g.moveTo(0, 180); g.lineTo(0, 154); g.quadraticCurveTo(110, 142, 210, 160); g.quadraticCurveTo(270, 152, 320, 158); g.lineTo(320, 180); g.fill();
          g.fillStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.roundRect(12, 144, 148, 24, 12); g.fill(); // volume bar
          g.fillStyle = 'rgba(255,255,255,.3)'; g.beginPath(); g.roundRect(48, 153, 100, 6, 3); g.fill();
          g.fillStyle = '#fff'; g.beginPath(); g.roundRect(48, 153, Math.max(6, 100 * clamp01(vol / 100)), 6, 3); g.fill();
          g.fillStyle = '#fff'; g.beginPath(); g.moveTo(22, 153); g.lineTo(28, 153); g.lineTo(34, 148); g.lineTo(34, 164); g.lineTo(28, 159); g.lineTo(22, 159); g.fill();
          if (status === 'fault') { g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(0, 0, 320, 180); g.fillStyle = '#E0563A'; g.beginPath(); g.roundRect(100, 8, 120, 26, 13); g.fill(); g.fillStyle = '#fff'; g.font = '600 16px Inter, "Segoe UI", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('no reply', 160, 21); }
        }
        tex.needsUpdate = true;
      };
      let shown = '';
      return {
        root,
        update(s, t) {
          const lit = !!s.on && s.status !== 'offline', key = `${lit}|${s.status}|${whole(s.volume)}`;
          if (key !== shown) { shown = key; draw(!!s.on, num(s.volume), s.status); screen.material.emissiveIntensity = lit ? 0.9 : 0.05; }
          led.set(s, t, s.on ? HEX.green : HEX.amber, s.on ? 2 : 0.7); // standby is a dim amber, never the fault red
        },
      };
    },
  },

  // A tall cylinder speaker wrapped in light grey woven fabric, on a rubber foot, with a white top: touch controls
  // printed in its centre and a ring of light round them, off while stopped, pulsing blue while playing, brighter and
  // faster with the volume.
  smart_speaker: {
    icon: 'speaker', size: 0.3,
    edit: [{ field: 'playing', kind: 'switch' }, { field: 'volume', kind: 'slider', step: 1, label: 'volume' }],
    format: (s) => (s.playing ? `playing · volume ${whole(s.volume)}` : 'stopped'),
    active: (s) => !!s.playing,
    control: { kind: 'switch', field: 'playing' },
    model({ THREE, P, M }) {
      // the weave as a fine thread grid in the colour and the bump, under a soft sheen
      const weave = canvasTex(THREE, (g, w, h) => {
        g.fillStyle = '#C6CACD'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(60,66,72,.28)';
        for (let i = 0; i < w; i += 4) { g.fillRect(i, 0, 1, h); g.fillRect(0, i + 2, w, 1); }
      }, 16, 16);
      weave.repeat.set(56, 36);
      const fabric = new THREE.MeshPhysicalMaterial({ map: weave, bumpMap: weave, bumpScale: 0.4, roughness: 0.95, sheen: 1, sheenRoughness: 0.6, sheenColor: 0xE6EBEE });
      const body = lathe(THREE, [[0.09, 0.01], [0.1, 0.018], [0.104, 0.035], [0.104, 0.452], [0.1, 0.464], [0.094, 0.469]], fabric, 48);
      const foot = P.cyl(0.09, 0.088, 0.01, M.rubber, 0, 0.005, 0, 32);
      const white = new THREE.MeshPhysicalMaterial({ color: 0xF2F3F1, roughness: 0.5, clearcoat: 0.4, clearcoatRoughness: 0.35 });
      const cap = lathe(THREE, [[0.093, 0.466], [0.097, 0.471], [0.096, 0.476], [0.09, 0.479], [0, 0.479]], white, 48);
      // volume down and up, the action button and the mic-off dot, printed in a pale grey
      const icons = canvasTex(THREE, (g, w) => {
        g.fillStyle = '#F2F3F1'; g.fillRect(0, 0, w, w); g.strokeStyle = '#A9AEB2'; g.fillStyle = '#A9AEB2'; g.lineWidth = 7; g.lineCap = 'round';
        g.beginPath(); g.moveTo(52, 128); g.lineTo(84, 128); g.moveTo(172, 128); g.lineTo(204, 128); g.moveTo(188, 112); g.lineTo(188, 144); g.stroke();
        g.beginPath(); g.arc(128, 60, 8, 0, Math.PI * 2); g.fill(); g.beginPath(); g.arc(128, 196, 13, 0, Math.PI * 2); g.stroke();
      }, 256, 256);
      const top = at(new THREE.Mesh(new THREE.CircleGeometry(0.064, 48), new THREE.MeshPhysicalMaterial({ map: icons, roughness: 0.5, clearcoat: 0.4, clearcoatRoughness: 0.35 })), 0, 0.4793, 0); top.rotation.x = -Math.PI / 2;
      const ringMat = new THREE.MeshStandardMaterial({ color: 0x1B1D20, emissive: 0x3AB7FF, emissiveIntensity: 0, roughness: 0.4 });
      const ring = at(new THREE.Mesh(new THREE.RingGeometry(0.066, 0.078, 64), ringMat), 0, 0.4796, 0); ring.rotation.x = -Math.PI / 2; // smoked acrylic, dark when idle
      const relief = at(P.cyl(0.006, 0.005, 0.014, M.rubber, 0, 0, 0, 10), 0, 0.028, -0.104); relief.rotation.x = Math.PI / 2;
      const cord = P.tube([[0, 0.026, -0.108], [0, 0.01, -0.116], [0.025, 0.004, -0.128], [0.06, 0.004, -0.13]], 0.003, M.rubber);
      const root = P.group(foot, body, cap, top, ring, relief, cord);
      const led = statusLed(THREE, root, { at: [0, 0.035, 0.105], r: 0.005 });
      return {
        root,
        update(s, t) {
          const v = clamp01(num(s.volume) / 100);
          ringMat.emissiveIntensity = s.playing ? (1.6 + 1.8 * v) * (0.75 + 0.25 * Math.sin(t * (4 + 6 * v))) : 0;
          led.set(s, t, s.playing ? HEX.blue : HEX.green, 2);
        },
      };
    },
  },

  // A round lidar robot vacuum (34 cm across, 9 cm tall at its turret) and its charging dock. A glossy white shell, a
  // graphite bumper round its front, the lidar turret with its dark window, buttons on top and a side brush that spins
  // under its front edge while it works. While cleaning it drives a small circle; stopped, it glides back to the dock.
  robot_vacuum: {
    icon: 'vacuum', size: 1.1,
    edit: [{ field: 'cleaning', kind: 'switch' }, { field: 'battery', kind: 'slider', step: 1, unit: '%', label: 'battery' }],
    format: (s) => { const b = whole(s.battery); return `${s.cleaning ? 'cleaning' : 'docked'} · battery ${b >= 100 ? 'full' : b <= 0 ? 'empty' : `${b}%`}`; },
    active: (s) => !!s.cleaning,
    control: { kind: 'switch', field: 'cleaning' },
    model({ THREE, P, M }) {
      const R = 0.28, DOCK = [-R, 0]; // the round's radius; the resting spot is the round's far-left point
      const graphite = new THREE.MeshPhysicalMaterial({ color: 0x2B2F33, roughness: 0.45, metalness: 0.1, clearcoat: 0.5, clearcoatRoughness: 0.3 });
      // The dock, facing +x: a rounded tower with a dark sensor window and a light strip, on a base plate with two
      // charging contacts that the robot backs onto.
      const tower = at(sideSlab(THREE, 0.2, 0.1, 0.06, 0.025, graphite, { b: 0.008 }), -0.535, 0.062, 0);
      const plate = at(flat(THREE, 0.075, 0.2, 0.012, 0.02, graphite, { b: 0.004, seg: 2 }), -0.4975, 0, 0);
      const dockBody = mergeMeshes(THREE, [tower, plate], graphite, { consume: true });
      const contacts = mergeMeshes(THREE, [-0.045, 0.045].map((z) => at(flat(THREE, 0.014, 0.028, 0.002, 0.005, M.metal, { b: 0.0006, seg: 1 }), -0.467, 0.012, z)), M.metal, { consume: true });
      const irWin = at(sideSlab(THREE, 0.09, 0.026, 0.002, 0.008, new THREE.MeshPhysicalMaterial({ color: 0x0C0E10, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05 }), { b: 0.0006, seg: 1 }), -0.475, 0.082, 0);
      const dockLed = at(sideSlab(THREE, 0.03, 0.004, 0.0015, 0.002, new THREE.MeshStandardMaterial({ color: 0xFFFFFF, emissive: 0xFFFFFF, emissiveIntensity: 0.6 }), { b: 0.0004, seg: 1 }), -0.475, 0.058, 0);
      // The robot: a dark underside (wheels and brushes) under a glossy shell whose top carries the seam and buttons.
      const shellMat = new THREE.MeshPhysicalMaterial({ color: 0xF1F3F2, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.15 });
      const under = P.cyl(0.155, 0.15, 0.012, M.rubber, 0, 0.008, 0, 40);
      const shell = lathe(THREE, [[0.155, 0.014], [0.165, 0.018], [0.17, 0.028], [0.17, 0.066], [0.167, 0.076], [0.16, 0.082], [0.15, 0.085]], shellMat, 64);
      const topTex = canvasTex(THREE, (g, w) => { // canvas top is the robot's back (-z), bottom its front
        g.fillStyle = '#F1F3F2'; g.fillRect(0, 0, w, w);
        g.strokeStyle = 'rgba(90,96,102,.55)'; g.lineWidth = 2; g.beginPath(); g.arc(128, 128, 112, 0, Math.PI * 2); g.stroke(); // the lid's seam
        g.fillStyle = '#D9DDDF'; g.beginPath(); g.roundRect(86, 196, 84, 30, 15); g.fill(); // the button pad
        g.strokeStyle = '#7A8187'; g.lineWidth = 3; g.beginPath(); g.arc(108, 211, 7, -1.1, 4.25); g.moveTo(108, 202); g.lineTo(108, 210); g.stroke(); // power
        g.beginPath(); g.moveTo(140, 214); g.lineTo(148, 206); g.lineTo(156, 214); g.moveTo(142, 213); g.lineTo(142, 219); g.lineTo(154, 219); g.lineTo(154, 213); g.stroke(); // home
      }, 256, 256);
      topTex.wrapS = topTex.wrapT = THREE.ClampToEdgeWrapping;
      const top = at(new THREE.Mesh(new THREE.CircleGeometry(0.15, 64), new THREE.MeshPhysicalMaterial({ map: topTex, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.15 })), 0, 0.0852, 0); top.rotation.x = -Math.PI / 2; top.receiveShadow = true;
      const bumper = lathe(THREE, [[0.1712, 0.022], [0.1735, 0.026], [0.1735, 0.066], [0.1712, 0.07]], new THREE.MeshStandardMaterial({ color: 0x3A3E42, roughness: 0.6, side: THREE.DoubleSide }), 32, -Math.PI / 2, Math.PI); // the front (+z) half
      const turret = lathe(THREE, [[0, 0.085], [0.041, 0.085], [0.041, 0.091], [0.038, 0.093], [0.038, 0.105], [0.04, 0.107], [0.04, 0.111], [0.036, 0.115], [0, 0.116]], graphite, 32);
      const lens = at(new THREE.Mesh(new THREE.CylinderGeometry(0.0386, 0.0386, 0.011, 32, 1, true), new THREE.MeshPhysicalMaterial({ color: 0x0A0C0E, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05 })), 0, 0.099, 0);
      const lidar = P.group(turret, lens); lidar.position.z = -0.03;
      // the side brush: a hub with three splayed bristle tufts, under the front-right edge
      const brushMat = new THREE.MeshStandardMaterial({ color: 0x3A3E42, roughness: 0.7 });
      const tufts = [0, 1, 2].map((i) => {
        const a = (i * 2 * Math.PI) / 3, m = new THREE.Mesh(new THREE.CylinderGeometry(0.0008, 0.0022, 0.05, 4), brushMat);
        m.rotation.set(0, a, -Math.PI / 2 - 0.15, 'YXZ'); m.position.set(0.026 * 0.989 * Math.cos(a), -0.003, -0.026 * 0.989 * Math.sin(a)); return m;
      });
      const brush = mergeMeshes(THREE, [new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.006, 14), brushMat), ...tufts], brushMat, { consume: true }); brush.castShadow = false;
      const brushHub = P.group(brush); brushHub.position.set(0.1, 0.009, 0.12);
      const bot = P.group(under, shell, top, bumper, lidar, brushHub);
      const root = P.group(dockBody, contacts, irWin, dockLed, bot);
      const led = statusLed(THREE, bot, { at: [0, 0.0865, 0.097], r: 0.0045 }); // between the two buttons
      const step = stepper();
      let k = 0, ang = Math.PI; // how far into its round (0 docked, 1 driving it), and where on it
      return {
        root,
        update(s, t) {
          const dt = step(t), want = s.cleaning && s.status !== 'offline' && s.status !== 'fault' ? 1 : 0;
          k = ease(k, want, dt, 2.5);
          if (k > 0) ang += dt * 1.3 * Math.max(k, 0.3); else ang = Math.PI;
          const cx = R * Math.cos(ang), cz = R * Math.sin(ang);
          bot.position.set(DOCK[0] + (cx - DOCK[0]) * k, 0, DOCK[1] + (cz - DOCK[1]) * k);
          bot.rotation.y = Math.atan2(-Math.sin(ang), Math.cos(ang));
          if (k > 0.05) brushHub.rotation.y += dt * 14;
          led.set(s, t, s.cleaning ? HEX.blue : HEX.green, 2);
        },
      };
    },
  },

  // A ceiling fan: a domed canopy, a brushed downrod, a satin white motor housing, four tapered walnut blades on
  // graphite irons and an opal light kit below, turning at a rate set by its speed (0–3) and easing up and down.
  ceiling_fan: {
    icon: 'fan', size: 1.1,
    edit: [{ field: 'speed', kind: 'slider', step: 1, label: 'speed' }],
    format: (s) => { const n = whole(s.speed); return n <= 0 ? 'off' : `speed ${n} of 3`; },
    active: (s) => whole(s.speed) > 0,
    control: { kind: 'bar', field: 'speed', min: 0, max: 3 },
    model({ THREE, P, M }) {
      const satin = new THREE.MeshPhysicalMaterial({ color: 0xF1F2F0, roughness: 0.45, clearcoat: 0.4, clearcoatRoughness: 0.35 });
      const alu = new THREE.MeshStandardMaterial({ color: 0xC9CDD1, metalness: 1, roughness: 0.32 });
      const canopy = lathe(THREE, [[0, -0.056], [0.02, -0.055], [0.05, -0.04], [0.068, -0.02], [0.075, -0.006], [0.075, 0], [0, 0]], satin, 32);
      const rod = P.cyl(0.011, 0.011, 0.16, alu, 0, -0.13, 0, 16);
      const housing = lathe(THREE, [[0, -0.32], [0.06, -0.32], [0.1, -0.312], [0.125, -0.298], [0.135, -0.285], [0.135, -0.262], [0.12, -0.245], [0.08, -0.226], [0.03, -0.212], [0.014, -0.205], [0, -0.205]], satin, 48);
      const fitter = P.cyl(0.098, 0.098, 0.012, satin, 0, -0.326, 0, 40);
      const opal = new THREE.MeshPhysicalMaterial({ color: 0xF4F2EC, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1 });
      const bowl = lathe(THREE, [[0, -0.4], [0.04, -0.397], [0.07, -0.385], [0.088, -0.365], [0.095, -0.345], [0.095, -0.332], [0, -0.332]], opal, 48);
      // A blade's planform: narrow at the root, wider and rounded at the tip (14–53.5 cm out), pitched 9° on its iron.
      const bs = new THREE.Shape(); bs.moveTo(0.15, -0.042); bs.lineTo(0.47, -0.06); bs.quadraticCurveTo(0.535, -0.06, 0.535, 0); bs.quadraticCurveTo(0.535, 0.06, 0.47, 0.06); bs.lineTo(0.15, 0.042); bs.quadraticCurveTo(0.138, 0, 0.15, -0.042);
      const bladeGeo = new THREE.ExtrudeGeometry(bs, { depth: 0.005, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 1, curveSegments: 6 }); bladeGeo.rotateX(-Math.PI / 2);
      const irons = [], blades = [];
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        const blade = new THREE.Mesh(bladeGeo, M.wood); blade.rotation.set(0.16, a, 0, 'YXZ'); blades.push(blade);
        const iron = flat(THREE, 0.17, 0.034, 0.008, 0.012, M.anodized, { b: 0.002, seg: 1 }); // from inside the housing to under the blade root
        iron.position.set(0.175 * Math.cos(a), -0.011, -0.175 * Math.sin(a)); iron.rotation.y = a; irons.push(iron);
      }
      // The blades stay four meshes (one shared geometry): merged, their one square bounding box swells by √2 as the rotor
      // turns, past the room's walls in a corner.
      const rotor = P.group(...blades.map(shaded), mergeMeshes(THREE, irons, M.anodized, { consume: true })); rotor.position.y = -0.275;
      const root = P.group(canopy, rod, housing, fitter, bowl, rotor);
      const led = statusLed(THREE, root, { at: [0.1, -0.326, 0], r: 0.006 }); // on the light kit's fitter, under the blades
      const step = stepper(); let w = 0; // rad/s now
      return {
        root,
        update(s, t) {
          const dt = step(t), want = s.status === 'offline' ? 0 : Math.max(0, Math.min(3, num(s.speed))) * 3.4;
          w = ease(w, want, dt, 1.6); rotor.rotation.y += w * dt;
          led.set(s, t, num(s.speed) > 0 ? HEX.blue : HEX.green, 2);
        },
      };
    },
  },

  // A wall-mounted split air conditioner, 90 × 27 cm and 20 cm deep: a glossy white body with a rounded top front, an
  // intake grille on top, a panel seam, a smoked display window showing the set point, and an outlet under its front
  // whose curved flap swings open, with pale air lines falling from it, while on.
  air_conditioner: {
    icon: 'ac', size: 1.0, mountY: 2.15,
    edit: [{ field: 'on', kind: 'switch' }, { field: 'room', kind: 'slider', step: 0.5, unit: '°C', label: 'now' }],
    format: (s) => (s.on ? `on · ${oneDecimal(s.target)}°C set · ${oneDecimal(s.room)}°C now` : `off · ${oneDecimal(s.room)}°C now`),
    active: (s) => !!s.on,
    control: { kind: 'switch', field: 'on' },
    model({ THREE, P, M }) {
      const W = 0.9, b = 0.006;
      const white = new THREE.MeshPhysicalMaterial({ color: 0xF5F6F5, roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.3 });
      // The body's side profile (z out from the wall, y up), drawn b inside its edge since the bevel adds b all round,
      // with the outlet cut out of its front underside; extruded along x.
      const sp = new THREE.Shape();
      sp.moveTo(b, -0.135 + b); sp.lineTo(0.105 - b, -0.135 + b); sp.lineTo(0.105 - b, -0.095 - b); sp.lineTo(0.2 - b, -0.095 - b);
      sp.lineTo(0.2 - b, 0.09); sp.quadraticCurveTo(0.2 - b, 0.135 - b, 0.155, 0.135 - b); sp.lineTo(b, 0.135 - b); sp.lineTo(b, -0.135 + b);
      const bodyGeo = new THREE.ExtrudeGeometry(sp, { depth: W - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 3, curveSegments: 8 });
      bodyGeo.rotateY(-Math.PI / 2); bodyGeo.translate((W - 2 * b) / 2, 0, 0); // profile x → z, extrusion → x, centred
      const body = shaded(new THREE.Mesh(bodyGeo, white));
      const ends = [-1, 1].map((sx) => at(slab(THREE, 0.03, 0.042, 0.095, 0.004, white, { b: 0.003, seg: 1 }), sx * (W / 2 - 0.015), -0.114, 0.105)); // close the outlet's ends
      const shell = mergeMeshes(THREE, [body, ...ends], white, { consume: true });
      // inside the outlet: dark, with vertical louvres
      const louvre = canvasTex(THREE, (g, w, h) => { g.fillStyle = '#1C2024'; g.fillRect(0, 0, w, h); g.fillStyle = '#4A5157'; g.fillRect(0, 0, 3, h); }, 32, 8);
      louvre.repeat.set(40, 1);
      const outlet = at(new THREE.Mesh(new THREE.BoxGeometry(W - 0.06, 0.032, 0.088), new THREE.MeshStandardMaterial({ map: louvre, roughness: 0.7 })), 0, -0.112, 0.148); outlet.castShadow = false;
      // the flap: a curved vane closing the outlet's underside and front, hinged at its back edge
      const fs = new THREE.Shape(); fs.moveTo(0, 0); fs.lineTo(0.07, 0); fs.quadraticCurveTo(0.095, 0, 0.095, 0.03); fs.lineTo(0.095, 0.04); fs.lineTo(0.089, 0.04); fs.lineTo(0.089, 0.03); fs.quadraticCurveTo(0.089, 0.006, 0.07, 0.006); fs.lineTo(0, 0.006); fs.lineTo(0, 0);
      const flapGeo = new THREE.ExtrudeGeometry(fs, { depth: W - 0.07, bevelEnabled: true, bevelThickness: 0.001, bevelSize: 0.001, bevelSegments: 1, curveSegments: 6 });
      flapGeo.rotateY(-Math.PI / 2); flapGeo.translate((W - 0.07) / 2, 0, 0);
      const flap = shaded(new THREE.Mesh(flapGeo, white));
      const hinge = P.group(flap); hinge.position.set(0, -0.135, 0.105);
      const seam = at(new THREE.Mesh(new THREE.BoxGeometry(W - 0.04, 0.0025, 0.002), new THREE.MeshStandardMaterial({ color: 0xA4AAAE, roughness: 0.6 })), 0, 0.072, 0.2); seam.castShadow = false;
      const grilleTex = canvasTex(THREE, (g, w, h) => { g.fillStyle = '#E9EBEA'; g.fillRect(0, 0, w, h); g.fillStyle = '#5E656B'; g.fillRect(0, 2, w, 4); }, 8, 8);
      grilleTex.repeat.set(1, 14);
      const grille = at(new THREE.Mesh(new THREE.PlaneGeometry(W - 0.08, 0.1), new THREE.MeshStandardMaterial({ map: grilleTex, roughness: 0.6 })), 0, 0.1352, 0.075); grille.rotation.x = -Math.PI / 2;
      const glass = at(slab(THREE, 0.11, 0.05, 0.002, 0.008, new THREE.MeshPhysicalMaterial({ color: 0x14181C, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 }), { b: 0.0006, seg: 1 }), 0.31, 0.03, 0.2);
      const { tex, g } = screenTex(THREE, 128, 52);
      const face = P.screenPlane(0.085, 0.035, tex); face.position.set(0.31, 0.03, 0.2025); face.material.emissiveIntensity = 0;
      const root = P.group(shell, outlet, hinge, seam, grille, glass, face);
      const led = statusLed(THREE, root, { at: [0.375, 0.03, 0.2005], r: 0.004 });
      const lines = [];
      for (let i = 0; i < 6; i++) { const m = ghost(THREE, 0.014, 0.2, 0xBFE6FF, -0.2); root.add(m); lines.push({ m, x: -0.33 + i * 0.132, ph: i / 6 }); }
      const draw = (txt, on) => { g.fillStyle = '#0B0F14'; g.fillRect(0, 0, 128, 52); g.fillStyle = on ? '#9FE3F0' : '#39424A'; g.font = '600 34px Inter, "Segoe UI", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, 64, 28); tex.needsUpdate = true; };
      const step = stepper(); let shown = '', open = 0;
      return {
        root,
        update(s, t) {
          const dt = step(t), on = !!s.on && s.status !== 'offline', key = `${on}|${s.status}|${Math.round(num(s.target) * 10)}`;
          if (key !== shown) { shown = key; draw(on ? `${oneDecimal(s.target)}°` : '--', on); face.material.emissiveIntensity = on ? 0.9 : 0; }
          open = ease(open, on ? 1 : 0, dt, 6); hinge.rotation.x = 0.62 * open;
          for (const l of lines) {
            l.m.visible = on;
            if (!on) continue;
            const u = cycle(t, 1.6, l.ph);
            l.m.position.set(l.x, -0.19 - 0.3 * u, 0.2 + 0.1 + 0.16 * u); l.m.material.opacity = 0.34 * Math.sin(Math.PI * u);
          }
          led.set(s, t, on ? HEX.blue : HEX.green, 2);
        },
      };
    },
  },

  // A ceramic tower heater, 60 cm tall: a white body with rounded corners on an oval graphite base, a graphite-framed
  // front grille whose slots glow orange while on, a control strip with a dial and a carry slot on top, and a little
  // heat haze rising.
  space_heater: {
    icon: 'heater', size: 0.5,
    edit: [{ field: 'on', kind: 'switch' }, { field: 'room', kind: 'slider', step: 0.5, unit: '°C', label: 'now' }],
    format: (s) => `${s.on ? 'on' : 'off'} · ${oneDecimal(s.room)}°C now`,
    active: (s) => !!s.on,
    control: { kind: 'switch', field: 'on' },
    model({ THREE, P, M }) {
      const white = new THREE.MeshPhysicalMaterial({ color: 0xF2F3F1, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.35 });
      const graphite = new THREE.MeshPhysicalMaterial({ color: 0x2B2F33, roughness: 0.45, metalness: 0.1, clearcoat: 0.5, clearcoatRoughness: 0.3 });
      const base = lathe(THREE, [[0, 0], [0.125, 0], [0.13, 0.006], [0.13, 0.016], [0.122, 0.024], [0, 0.024]], graphite, 48); base.scale.z = 0.75;
      const body = at(flat(THREE, 0.19, 0.15, 0.58, 0.05, white, { b: 0.008 }), 0, 0.024, 0);
      const frame = at(slab(THREE, 0.13, 0.42, 0.004, 0.02, graphite, { b: 0.0012, seg: 1 }), 0, 0.3, 0.0745);
      // The grille: slots over the ceramic element. The colour map darkens the slots; the glow map lights only them,
      // brightest in the middle of each, as the element glows.
      const slots = (g, w, h, glowing) => {
        g.fillStyle = glowing ? '#000' : '#30343A'; g.fillRect(0, 0, w, h);
        for (let y = 6; y < h - 4; y += 10) {
          if (glowing) { const gr = g.createLinearGradient(6, 0, w - 6, 0); gr.addColorStop(0, '#5A5A5A'); gr.addColorStop(0.5, '#FFFFFF'); gr.addColorStop(1, '#5A5A5A'); g.fillStyle = gr; } else g.fillStyle = '#3A2420';
          g.beginPath(); g.roundRect(6, y, w - 12, 5, 2.5); g.fill();
        }
      };
      const grilleMat = new THREE.MeshStandardMaterial({ map: canvasTex(THREE, (g, w, h) => slots(g, w, h, false), 64, 256), emissive: 0xFF6A2A, emissiveMap: canvasTex(THREE, (g, w, h) => slots(g, w, h, true), 64, 256), emissiveIntensity: 0, roughness: 0.6 });
      const grille = at(new THREE.Mesh(new THREE.PlaneGeometry(0.114, 0.4), grilleMat), 0, 0.3, 0.0786);
      const strip = at(flat(THREE, 0.12, 0.05, 0.003, 0.012, graphite, { b: 0.001, seg: 1 }), 0, 0.6035, 0.035);
      const dial = at(lathe(THREE, [[0, 0], [0.016, 0], [0.0165, 0.003], [0.016, 0.011], [0.013, 0.013], [0, 0.013]], M.steel, 24), 0.03, 0.606, 0.035);
      const handle = at(flat(THREE, 0.09, 0.022, 0.002, 0.011, new THREE.MeshStandardMaterial({ color: 0x111315, roughness: 0.8 }), { b: 0.0006, seg: 1 }), 0, 0.6035, -0.04);
      const root = P.group(base, body, frame, grille, strip, dial, handle);
      const led = statusLed(THREE, root, { at: [-0.035, 0.608, 0.035], r: 0.0045 });
      const waves = [];
      for (let i = 0; i < 3; i++) { const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap(THREE), color: 0xFFB070, transparent: true, depthWrite: false, opacity: 0 })); m.position.y = 0.65; m.visible = false; m.userData.noAO = true; m.raycast = () => {}; root.add(m); waves.push({ m, x: (i - 1) * 0.1, ph: i / 3 }); } // soft round glows, not flat planes
      return {
        root,
        update(s, t) {
          const on = !!s.on && s.status !== 'offline';
          grilleMat.emissiveIntensity = on ? 1.7 + 0.25 * Math.sin(t * 3) : 0;
          for (const w of waves) {
            w.m.visible = on; if (!on) continue;
            const u = cycle(t, 2.2, w.ph);
            w.m.position.set(w.x + 0.02 * Math.sin(t * 2 + w.ph * 6), 0.62 + 0.35 * u, 0.07); w.m.scale.setScalar(0.12 + 0.1 * u); w.m.material.opacity = 0.22 * Math.sin(Math.PI * u);
          }
          led.set(s, t, on ? HEX.amber : HEX.green, on ? 4 : 1.5);
        },
      };
    },
  },

  // A top-fill ultrasonic humidifier: a clear tank of water on a white base with a touch panel and a ring of light
  // round its top edge, under a white cap with a mist nozzle that puffs mist while on.
  humidifier: {
    icon: 'humidifier', size: 0.4,
    edit: [{ field: 'on', kind: 'switch' }, { field: 'humidity', kind: 'slider', step: 1, unit: '%', label: 'humidity', top: 'saturated' }],
    format: (s) => `${s.on ? 'on' : 'off'} · humidity ${percent(s.humidity)}`,
    active: (s) => !!s.on,
    control: { kind: 'switch', field: 'on' },
    model({ THREE, P, M }) {
      const white = new THREE.MeshPhysicalMaterial({ color: 0xF2F3F1, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.4 });
      const feet = P.cyl(0.13, 0.13, 0.006, M.rubber, 0, 0.003, 0, 32);
      const base = lathe(THREE, [[0, 0.006], [0.14, 0.006], [0.148, 0.01], [0.152, 0.02], [0.152, 0.082], [0.148, 0.094], [0.14, 0.1], [0, 0.1]], white, 48);
      const ringMat = new THREE.MeshStandardMaterial({ color: 0x1B1D20, emissive: 0x7FD8FF, emissiveIntensity: 0, roughness: 0.4 });
      const ring = at(new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.0035, 6, 48), ringMat), 0, 0.088, 0); ring.rotation.x = Math.PI / 2;
      // the touch panel on the front: power, mist down and up, printed on smoked glass
      const panelTex = canvasTex(THREE, (g, w, h) => {
        g.fillStyle = '#202428'; g.fillRect(0, 0, w, h); g.strokeStyle = '#9AA3AA'; g.lineWidth = 4; g.lineCap = 'round';
        g.beginPath(); g.arc(32, 32, 11, -1.1, 4.25); g.moveTo(32, 18); g.lineTo(32, 30); g.stroke();
        g.beginPath(); g.moveTo(66, 32); g.lineTo(86, 32); g.moveTo(108, 32); g.lineTo(128, 32); g.moveTo(118, 22); g.lineTo(118, 42); g.stroke();
      }, 160, 64);
      panelTex.wrapS = panelTex.wrapT = THREE.ClampToEdgeWrapping;
      const panel = at(slab(THREE, 0.075, 0.03, 0.006, 0.008, new THREE.MeshPhysicalMaterial({ color: 0x202428, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 }), { b: 0.0015, seg: 1 }), 0, 0.05, 0.147);
      const icons = at(new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.024), new THREE.MeshStandardMaterial({ map: panelTex, roughness: 0.3, emissive: 0xffffff, emissiveMap: panelTex, emissiveIntensity: 0.25 })), -0.004, 0.05, 0.1532);
      const tank = lathe(THREE, [[0.128, 0.1], [0.13, 0.11], [0.13, 0.38], [0.126, 0.405], [0.118, 0.42]], new THREE.MeshPhysicalMaterial({ color: 0xE6F2F6, roughness: 0.05, transparent: true, opacity: 0.26, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.05, side: THREE.DoubleSide }), 48);
      tank.castShadow = false; tank.userData.noAO = true; tank.renderOrder = 1; // drawn after the water inside it
      const water = P.cyl(0.123, 0.123, 0.2, new THREE.MeshStandardMaterial({ color: 0x4FA8CF, roughness: 0.2, transparent: true, opacity: 0.7 }), 0, 0.203, 0, 40);
      const cap = lathe(THREE, [[0, 0.418], [0.122, 0.418], [0.124, 0.43], [0.118, 0.445], [0.1, 0.455], [0.06, 0.46], [0, 0.46]], white, 48);
      const nozzle = lathe(THREE, [[0.036, 0.458], [0.034, 0.49], [0.03, 0.499], [0.022, 0.502], [0.016, 0.502]], white, 32);
      const mouth = at(new THREE.Mesh(new THREE.CircleGeometry(0.0165, 20), M.rubber), 0, 0.5005, 0); mouth.rotation.x = -Math.PI / 2;
      const root = P.group(feet, base, ring, panel, icons, tank, water, cap, nozzle, mouth);
      const led = statusLed(THREE, root, { at: [0.03, 0.05, 0.1535], r: 0.0035 });
      const puffs = [];
      for (let i = 0; i < 6; i++) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshBasicMaterial({ color: 0xEAF6FB, transparent: true, opacity: 0, depthWrite: false }));
        m.position.y = 0.55; m.userData.noAO = true; m.raycast = () => {}; m.visible = false; root.add(m); puffs.push({ m, ph: i / 6, a: i * 2.1 });
      }
      return {
        root,
        update(s, t) {
          const on = !!s.on && s.status !== 'offline';
          ringMat.emissiveIntensity = on ? 2.2 : 0;
          for (const p of puffs) {
            p.m.visible = on; if (!on) continue;
            const u = cycle(t, 2.4, p.ph);
            p.m.position.set(Math.cos(p.a) * 0.05 * u, 0.53 + 0.4 * u, Math.sin(p.a) * 0.05 * u); p.m.scale.setScalar(0.6 + 1.5 * u); p.m.material.opacity = 0.3 * Math.sin(Math.PI * u);
          }
          led.set(s, t, on ? HEX.blue : HEX.green, on ? 4 : 1.5);
        },
      };
    },
  },

  // A round tower air purifier, 60 cm tall: a white body perforated all round its lower two thirds (the intake), a
  // graphite vent grille on top, and round that grille the air-quality ring: green when the air is clean, amber then red
  // as the fine dust rises. Faint air lines rise from the vent while on.
  air_purifier: {
    icon: 'purifier', size: 0.4,
    edit: [{ field: 'on', kind: 'switch' }, { field: 'pm25', kind: 'slider', step: 1, unit: ' µg/m³', label: 'fine dust' }],
    format: (s) => `${s.on ? 'on' : 'off'} · fine dust ${whole(s.pm25)} µg/m³`,
    active: (s) => !!s.on,
    control: { kind: 'switch', field: 'on' },
    model({ THREE, P, M }) {
      const white = new THREE.MeshPhysicalMaterial({ color: 0xF2F3F1, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.4 });
      const plinth = P.cyl(0.118, 0.118, 0.012, M.rubber, 0, 0.006, 0, 40);
      const body = lathe(THREE, [[0, 0.012], [0.12, 0.012], [0.128, 0.02], [0.13, 0.035], [0.13, 0.57], [0.128, 0.588], [0.12, 0.597], [0.1, 0.6], [0, 0.6]], white, 64);
      // the intake: a sleeve of staggered holes, in the colour and the bump
      const holes = canvasTex(THREE, (g, w) => { g.fillStyle = '#F2F3F1'; g.fillRect(0, 0, w, w); g.fillStyle = '#5E6469'; for (const [x, y] of [[8, 8], [24, 24]]) { g.beginPath(); g.arc(x, y, 4.2, 0, Math.PI * 2); g.fill(); } }, 32, 32);
      holes.repeat.set(64, 32);
      const sleeve = at(shaded(new THREE.Mesh(new THREE.CylinderGeometry(0.1305, 0.1305, 0.42, 64, 1, true), new THREE.MeshPhysicalMaterial({ map: holes, bumpMap: holes, bumpScale: 0.5, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.4 }))), 0, 0.26, 0);
      const ventTex = canvasTex(THREE, (g, w) => { // concentric slots round a solid hub
        g.fillStyle = '#2B2F33'; g.fillRect(0, 0, w, w); g.strokeStyle = '#0D0F11'; g.lineWidth = 4;
        for (let r = 30; r < 124; r += 9) { g.beginPath(); g.arc(128, 128, r, 0, Math.PI * 2); g.stroke(); }
        g.fillStyle = '#353A3F'; g.beginPath(); g.arc(128, 128, 24, 0, Math.PI * 2); g.fill();
      }, 256, 256);
      ventTex.wrapS = ventTex.wrapT = THREE.ClampToEdgeWrapping;
      const vent = at(new THREE.Mesh(new THREE.CircleGeometry(0.094, 48), new THREE.MeshStandardMaterial({ map: ventTex, roughness: 0.55, metalness: 0.2 })), 0, 0.6006, 0); vent.rotation.x = -Math.PI / 2;
      const barMat = new THREE.MeshStandardMaterial({ color: 0x1B1D20, emissive: 0x2FBF71, emissiveIntensity: 0, roughness: 0.4 });
      const ring = at(new THREE.Mesh(new THREE.TorusGeometry(0.099, 0.0038, 6, 64), barMat), 0, 0.6015, 0); ring.rotation.x = Math.PI / 2;
      const root = P.group(plinth, body, sleeve, vent, ring);
      const led = statusLed(THREE, root, { at: [0, 0.6015, 0.112], r: 0.0045 }); // on the rim in front of the ring
      const lines = [];
      for (let i = 0; i < 5; i++) { const m = ghost(THREE, 0.012, 0.16, 0xBFE6FF, 0.75); root.add(m); lines.push({ m, a: i * 1.26, ph: i / 5 }); }
      const GOOD = new THREE.Color(0x2FBF71), FAIR = new THREE.Color(0xFFB020), POOR = new THREE.Color(0xE0563A), tmp = new THREE.Color();
      let shown = '';
      return {
        root,
        update(s, t) {
          const on = !!s.on && s.status !== 'offline', dust = num(s.pm25), key = `${on}|${Math.round(dust)}`;
          if (key !== shown) {
            shown = key; tmp.copy(dust <= 12 ? GOOD : dust <= 35 ? FAIR : POOR); barMat.emissive.copy(tmp); barMat.emissiveIntensity = on ? 2.2 : 0;
          }
          for (const l of lines) {
            l.m.visible = on; if (!on) continue;
            const u = cycle(t, 1.8, l.ph);
            l.m.position.set(Math.cos(l.a) * 0.07, 0.7 + 0.3 * u, Math.sin(l.a) * 0.07); l.m.material.opacity = 0.34 * Math.sin(Math.PI * u);
          }
          led.set(s, t, on ? HEX.blue : HEX.green, on ? 4 : 1.5);
        },
      };
    },
  },
};
