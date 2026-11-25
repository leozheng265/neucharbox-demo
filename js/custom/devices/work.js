// The Work types' card UI and 3D models for the custom room (contract: devices/index.js): an open-frame 3D printer that
// builds a part while it prints, a desktop six-axis arm that poses at home, pick and place, and a desktop label printer
// that ejects a label on every print. Each has its own status LED; standby is green, never the fault red.
import { HEX, num, clamp01, statusLed, mergeMeshes, canvasTex, screenTex, ease, stepper } from './kit.js';

const whole = (v) => Math.round(num(v));

// P.box's rounded box has four corner segments (about 970 triangles each); one or two are plenty at this size.
function lite(m, seg = 2) {
  const g = m.geometry, p = g.parameters;
  if (g.type === 'RoundedBoxGeometry') { m.geometry = new g.constructor(p.width, p.height, p.depth, seg, p.radius); g.dispose(); }
  return m;
}
// a cable along `pts`, thin enough that 6 sides read round
function cable(THREE, P, pts, r, mat) {
  const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 32, r, 6), mat);
  return P.add(m);
}
// a cylinder lying along x
function xcyl(P, r, len, mat, x, y, z, seg = 16) { const m = P.cyl(r, r, len, mat, x, y, z, seg); m.rotation.z = Math.PI / 2; return m; }
const merge = (THREE, list, mat) => mergeMeshes(THREE, list, mat, { consume: true });

export default {
  // An open-frame bed-slinger in the Prusa mould: a graphite base with rubber feet and a tilted control screen at the
  // front, a heated bed with a textured sheet that slides front to back on two rods, a bevelled Π frame with a Z motor,
  // lead screw and smooth rod on each side, and an X gantry that climbs them as the part grows, carrying the extruder
  // (light grey, a fan grille, an aqua stripe, a brass nozzle). The spool sits on a holder on top. The part is an orange
  // vase that grows with the progress, its layer lines kept to a fixed pitch; the head and bed move only while printing;
  // the screen shows the job and a bar of ten cells that fills with the progress.
  printer_3d: {
    icon: 'printer3d', size: 0.5,
    edit: [{ field: 'printing', kind: 'switch' }, { field: 'progress', kind: 'slider', step: 1, unit: '%', label: 'progress', top: 'done' }],
    format: (s) => {
      const p = whole(s.progress);
      if (p >= 100) return 'print done';
      if (s.printing) return `printing · ${Math.max(0, p)}%`;
      return p > 0 ? `stopped at ${p}%` : 'idle';
    },
    active: (s) => !!s.printing,
    control: { kind: 'switch', field: 'printing' },
    model({ THREE, P, M }) {
      const BED_Y = 0.098, MAXH = 0.2, GZ = -0.026; // the bed carriage's height, the tallest part, the gantry's z (nozzle over z 0)
      const graphite = new THREE.MeshPhysicalMaterial({ color: 0x2B2F33, roughness: 0.55, metalness: 0.15, clearcoat: 0.2, clearcoatRoughness: 0.5 });
      const shell = new THREE.MeshPhysicalMaterial({ color: 0xE4E7E8, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.45 }); // light grey ABS
      const rod = new THREE.MeshStandardMaterial({ color: 0xC6CBD0, metalness: 1, roughness: 0.22 });
      const alu = new THREE.MeshStandardMaterial({ color: 0xB9BEC3, metalness: 1, roughness: 0.35 });
      const rubber = M.rubber;
      // base: the Y frame on four feet, two Y rods on end blocks
      const base = lite(P.box(0.38, 0.06, 0.4, graphite, 0, 0.04, 0, 0.012));
      const feet = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => P.cyl(0.014, 0.016, 0.01, rubber, sx * 0.16, 0.005, sz * 0.17, 12));
      const yRods = [-0.08, 0.08].map((x) => { const r = P.cyl(0.004, 0.004, 0.38, rod, x, 0.078, 0, 10); r.rotation.x = Math.PI / 2; return r; });
      const yEnds = [-0.08, 0.08].flatMap((x) => [-0.186, 0.186].map((z) => lite(P.box(0.022, 0.018, 0.014, graphite, x, 0.078, z, 0.003), 1)));
      // the Π frame: one bevelled extrusion, its uprights outside the bed's width so the bed slides between them
      const pi = new THREE.Shape([[-0.185, 0.07], [-0.185, 0.48], [0.185, 0.48], [0.185, 0.07], [0.155, 0.07], [0.155, 0.45], [-0.155, 0.45], [-0.155, 0.07]].map(([x, y]) => new THREE.Vector2(x, y)));
      const frameGeo = new THREE.ExtrudeGeometry(pi, { depth: 0.034, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2, curveSegments: 4 });
      const frame = P.add(new THREE.Mesh(frameGeo, graphite)); frame.position.z = -0.092; // spans z -0.095 … -0.055
      // Z axes: a motor at each foot, its lead screw (thread stripes) and a smooth rod up to a bracket under the top bar
      const zMotors = [-0.17, 0.17].flatMap((x) => [lite(P.box(0.04, 0.03, 0.04, graphite, x, 0.085, GZ, 0.004), 1), lite(P.box(0.038, 0.012, 0.038, alu, x, 0.106, GZ, 0.002), 1)]);
      const thread = canvasTex(THREE, (g, w, h) => { g.fillStyle = '#C3C8CC'; g.fillRect(0, 0, w, h); g.fillStyle = '#6A7076'; for (let i = -h; i < w; i += 16) { g.beginPath(); g.moveTo(i, h); g.lineTo(i + 6, h); g.lineTo(i + 6 + h, 0); g.lineTo(i + h, 0); g.closePath(); g.fill(); } }, 32, 32);
      thread.repeat.set(1, 0.33 / 0.004);
      const screwMat = new THREE.MeshStandardMaterial({ map: thread, metalness: 1, roughness: 0.35 });
      const zScrews = [-0.17, 0.17].map((x) => P.cyl(0.004, 0.004, 0.33, screwMat, x, 0.277, GZ, 10));
      const zRods = [-0.17, 0.17].map((x) => P.cyl(0.004, 0.004, 0.34, rod, x, 0.28, -0.042, 10));
      const tops = [-0.17, 0.17].map((x) => lite(P.box(0.04, 0.014, 0.05, graphite, x, 0.443, -0.035, 0.003), 1));
      // the control screen on the base's front, tilted back, with its knob
      const scr = screenTex(THREE, 256, 128);
      const pod = lite(P.box(0.13, 0.046, 0.024, graphite, 0, 0, 0, 0.006), 1);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.084, 0.042), new THREE.MeshStandardMaterial({ map: scr.tex, emissive: 0xffffff, emissiveMap: scr.tex, emissiveIntensity: 0.85, roughness: 0.2 }));
      screen.position.set(-0.016, 0, 0.0122); screen.castShadow = false;
      const knob = P.cyl(0.009, 0.009, 0.008, new THREE.MeshStandardMaterial({ color: 0xD9DDE0, metalness: 0.9, roughness: 0.3, flatShading: true }), 0.046, 0, 0.016, 16); knob.rotation.x = Math.PI / 2;
      const ui = P.group(pod, screen, knob); ui.position.set(-0.1, 0.042, 0.212); ui.rotation.x = -0.35;
      // the bed and the part on it slide together: the Y carriage, the heated bed, the textured sheet
      const sheetTex = canvasTex(THREE, (g, w, h) => {
        g.fillStyle = '#3B3A37'; g.fillRect(0, 0, w, h);
        for (let i = 0; i < 900; i++) { const v = 50 + ((i * 53) % 40); g.fillStyle = `rgb(${v + 6},${v + 2},${v - 4})`; g.fillRect((i * 97) % w, (i * 61) % h, 2, 2); }
        g.strokeStyle = 'rgba(210,200,180,.22)'; g.lineWidth = 1; for (let k = 32; k < w; k += 32) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k, h); g.moveTo(0, k); g.lineTo(w, k); g.stroke(); }
        g.strokeStyle = 'rgba(210,200,180,.35)'; g.strokeRect(6, 6, w - 12, h - 12);
      }, 256, 256);
      sheetTex.wrapS = sheetTex.wrapT = THREE.ClampToEdgeWrapping;
      const carriagePlate = lite(P.box(0.2, 0.006, 0.22, alu, 0, -0.012, 0, 0.002), 1);
      const heatbed = lite(P.box(0.26, 0.006, 0.26, new THREE.MeshStandardMaterial({ color: 0x15171A, roughness: 0.6 }), 0, -0.002, 0, 0.002), 1);
      const sheet = lite(P.box(0.26, 0.004, 0.26, new THREE.MeshStandardMaterial({ map: sheetTex, metalness: 0.3, roughness: 0.75 }), 0, 0.004, 0, 0.002), 1);
      const layers = canvasTex(THREE, (g, w, h) => { g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, w, h); g.fillStyle = '#C9C9C9'; g.fillRect(0, 0, w, 3); }, 8, 8);
      const filament = new THREE.MeshPhysicalMaterial({ color: 0xFF7A1C, roughness: 0.42, clearcoat: 0.3, clearcoatRoughness: 0.4 });
      const partMat = filament.clone(); partMat.map = layers;
      const part = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, MAXH, 28, 1, false), partMat);
      part.castShadow = part.receiveShadow = true; part.position.y = 0.006; part.scale.y = 0.001;
      const bed = P.group(carriagePlate, heatbed, sheet, part); bed.position.set(0, BED_Y, 0);
      // the X gantry: two X ends on the Z axes and two rods; the extruder rides them
      const xEnds = [-0.17, 0.17].map((x) => lite(P.box(0.044, 0.05, 0.04, graphite, x, 0, -0.008, 0.004), 1));
      const xRods = [-0.012, 0.012].map((y) => xcyl(P, 0.004, 0.3, rod, 0, y, 0, 10));
      const carriage = lite(P.box(0.05, 0.05, 0.016, graphite, 0, 0, -0.002, 0.004), 1);
      const body = lite(P.box(0.05, 0.062, 0.04, shell, 0, 0.009, 0.026, 0.008));
      const fanTex = canvasTex(THREE, (g, w, h) => {
        g.fillStyle = '#E4E7E8'; g.fillRect(0, 0, w, h); g.fillStyle = '#1E2124'; g.beginPath(); g.arc(32, 32, 26, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#E4E7E8'; g.lineWidth = 2.5; for (let r = 9; r <= 25; r += 5.5) { g.beginPath(); g.arc(32, 32, r, 0, Math.PI * 2); g.stroke(); }
        g.beginPath(); g.moveTo(6, 32); g.lineTo(58, 32); g.moveTo(32, 6); g.lineTo(32, 58); g.stroke(); g.fillStyle = '#E4E7E8'; g.beginPath(); g.arc(32, 32, 6, 0, Math.PI * 2); g.fill();
      }, 64, 64);
      fanTex.wrapS = fanTex.wrapT = THREE.ClampToEdgeWrapping;
      const fan = new THREE.Mesh(new THREE.PlaneGeometry(0.036, 0.036), new THREE.MeshStandardMaterial({ map: fanTex, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2 }));
      fan.position.set(0, 0.014, 0.0462); fan.castShadow = false;
      const stripe = P.box(0.03, 0.003, 0.002, new THREE.MeshStandardMaterial({ color: 0x29EEE5, emissive: 0x1FA8A2, emissiveIntensity: 0.35, roughness: 0.4 }), 0, -0.012, 0.0465); stripe.castShadow = false;
      const duct = lite(P.box(0.014, 0.014, 0.034, graphite, 0.022, -0.026, 0.026, 0.003), 1);
      const heater = P.box(0.018, 0.01, 0.016, alu, 0, -0.03, 0.026);
      const nozzle = P.cyl(0.0018, 0.0055, 0.01, new THREE.MeshStandardMaterial({ color: 0xC9A04A, metalness: 1, roughness: 0.3 }), 0, -0.04, 0.026, 12);
      const head = P.group(carriage, body, fan, stripe, duct, heater, nozzle);
      const gantry = P.group(merge(THREE, xEnds, graphite), merge(THREE, xRods, rod), head); gantry.position.set(0, 0.2, GZ);
      // the spool on its holder: two light grey flanges with windows (so its turn shows), the wound filament, a notch
      const flangeTex = canvasTex(THREE, (g, w, h) => {
        g.fillStyle = '#E9ECED'; g.fillRect(0, 0, w, h); g.fillStyle = '#9AA1A6';
        for (let i = 0; i < 6; i++) { g.save(); g.translate(64, 64); g.rotate((i * Math.PI) / 3); g.beginPath(); g.ellipse(0, -38, 8, 16, 0, 0, Math.PI * 2); g.fill(); g.restore(); }
        g.fillStyle = '#C8CDD0'; g.beginPath(); g.arc(64, 64, 18, 0, Math.PI * 2); g.fill();
      }, 128, 128);
      flangeTex.wrapS = flangeTex.wrapT = THREE.ClampToEdgeWrapping;
      const flangeMat = new THREE.MeshPhysicalMaterial({ map: flangeTex, roughness: 0.45, clearcoat: 0.4 }), flangeEdge = new THREE.MeshStandardMaterial({ color: 0xE9ECED, roughness: 0.5 });
      const flanges = [-0.027, 0.027].map((x) => { const f = new THREE.Mesh(new THREE.CylinderGeometry(0.064, 0.064, 0.004, 40), [flangeEdge, flangeMat, flangeMat]); f.rotation.z = Math.PI / 2; f.position.x = x; return P.add(f); });
      const wound = canvasTex(THREE, (g, w, h) => { g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, w, h); g.fillStyle = '#D8D8D8'; for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1); }, 8, 32);
      wound.repeat.set(8, 1);
      const coilMat = filament.clone(); coilMat.map = wound;
      const coil = xcyl(P, 0.055, 0.05, coilMat, 0, 0, 0, 32);
      const notch = P.box(0.002, 0.012, 0.005, graphite, 0.0296, 0.05, 0); notch.castShadow = false; // a mark, so the turning shows
      const spool = P.group(...flanges, coil, notch); spool.position.set(0, 0.552, -0.075);
      const axle = xcyl(P, 0.012, 0.07, alu, 0, 0.552, -0.075, 14);
      const arm = lite(P.box(0.016, 0.07, 0.02, graphite, 0.04, 0.517, -0.075, 0.004), 1);
      const black = merge(THREE, [base, ...yEnds, ...zMotors.filter((_, i) => i % 2 === 0), ...tops, arm], graphite);
      const steel = merge(THREE, [...yRods, ...zRods], rod), silver = merge(THREE, [...zMotors.filter((_, i) => i % 2 === 1), axle], alu);
      const root = P.group(black, merge(THREE, feet, rubber), frame, steel, silver, merge(THREE, zScrews, screwMat), ui, bed, gantry, spool);
      const led = statusLed(THREE, ui, { at: [0.046, 0.016, 0.0125], r: 0.0045, size: 0.035 });
      // the screen: offline dark; else the state, the progress (never "100%": "done") and ten cells filling with it
      const draw = (key, busy, p, lit) => {
        const g = scr.g; g.fillStyle = key === 'off' ? '#06080A' : '#0A1016'; g.fillRect(0, 0, 256, 128);
        if (key !== 'off') {
          const fault = key === 'fault', done = p >= 1;
          g.textBaseline = 'middle'; g.textAlign = 'left'; g.font = '600 24px Inter, "Segoe UI", sans-serif';
          g.fillStyle = fault ? '#FF7A62' : '#7FC9D6'; g.fillText(fault ? 'error' : done ? 'finished' : busy ? 'printing' : p > 0 ? 'stopped' : 'ready', 14, 24);
          g.textAlign = 'right'; g.fillStyle = '#E8FBFF'; g.font = '600 40px Inter, "Segoe UI", sans-serif'; g.fillText(done ? 'done' : `${Math.floor(p * 100)}%`, 242, 62);
          for (let i = 0; i < 10; i++) { g.fillStyle = i < lit ? '#39E58B' : '#1E2A26'; g.fillRect(14 + i * 23.2, 96, 19, 18); }
        }
        scr.tex.needsUpdate = true;
      };
      const dt = stepper(); let act = 0, shown = null, layerP = -1;
      return {
        root,
        update(s, t) {
          const d = dt(t), p = clamp01(num(s.progress) / 100);
          const busy = !!s.printing && p < 1 && s.status !== 'offline' && s.status !== 'fault';
          act = ease(act, busy ? 1 : 0, d, 4);
          part.scale.y = Math.max(0.001, p); part.position.y = 0.006 + MAXH * p / 2;
          if (p !== layerP) { layerP = p; layers.repeat.set(1, Math.max(1, (MAXH * p) / 0.0025)); } // a layer line every 2.5 mm, whatever the height
          // the nozzle tip rides 5 mm over the part's top; the head parks at the top once it is done
          gantry.position.y = BED_Y + 0.006 + MAXH * p + 0.05 + (p >= 1 ? 0.04 : 0);
          head.position.x = 0.05 * Math.sin(t * 5.1) * act;
          bed.position.z = 0.04 * Math.sin(t * 2.3) * act;
          if (busy) { spool.rotation.x += d * 1.5; }
          const lit = Math.round(p * 10);
          const key = s.status === 'offline' ? 'off' : s.status === 'fault' ? 'fault' : `${busy}|${Math.floor(p * 100)}|${p >= 1}|${lit}`;
          if (key !== shown) { shown = key; draw(key, busy, p, lit); }
          led.set(s, t, busy ? HEX.blue : HEX.green, busy ? 4 : 1.4);
        },
      };
    },
  },

  // A desktop six-axis arm in white glossy plastic: a turned pedestal on a graphite plate, a turret and shoulder housing
  // with graphite end caps (an aqua ring at the turret), rounded upper and fore arms with an elbow housing and a roll seam,
  // and a wrist carrying a parallel gripper with rubber-padded fingers. A pick fixture plate in front (a small cube on it)
  // and a grey tote at its side. It poses at home (folded up), pick (over the plate) and place (over the tote), turning the
  // base and bending two joints to get there. The cube rides in the gripper while it holds, and stays on the tote or the
  // plate where it was let go.
  robot_arm: {
    icon: 'arm', size: 0.8,
    edit: [{ field: 'holding', kind: 'switch' }],
    format: (s) => `${s.pose === 'pick' ? 'at the pick spot' : s.pose === 'place' ? 'at the place spot' : 'at home'} · ${s.holding ? 'holding a part' : 'gripper empty'}`,
    active: (s) => !!s.holding,
    control: { kind: 'switch', field: 'holding' },
    model({ THREE, P, M }) {
      const HS = 0.14, L1 = 0.22, L2 = 0.2, LG = 0.08, REACH = 0.28;
      // joint angles from the vertical, measured toward the arm's front: link 1 (t1), link 2 (t2). Reach poses are solved so
      // the wrist sits LG over the target with the gripper pointing straight down.
      const reach = (r, tipY) => {
        const dx = r, dy = tipY + LG - HS, dist = Math.hypot(dx, dy);
        const a = Math.acos(Math.min(1, Math.max(-1, (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist))));
        const t1 = Math.atan2(dx, dy) - a;
        return { t1, t2: Math.atan2(dx - L1 * Math.sin(t1), dy - L1 * Math.cos(t1)) };
      };
      const POSES = { home: { yaw: 0, t1: 0.35, t2: 1.9 }, pick: { yaw: 0, ...reach(REACH, 0.02) }, place: { yaw: Math.PI / 2, ...reach(REACH, 0.036) } };
      const white = new THREE.MeshPhysicalMaterial({ color: 0xF3F5F4, roughness: 0.35, clearcoat: 0.7, clearcoatRoughness: 0.2 });
      const cap = new THREE.MeshStandardMaterial({ color: 0x2A2E32, roughness: 0.5, metalness: 0.1 });
      const alu = new THREE.MeshStandardMaterial({ color: 0xC3C8CC, metalness: 1, roughness: 0.3 });
      const aqua = new THREE.MeshStandardMaterial({ color: 0x29EEE5, emissive: 0x1FA8A2, emissiveIntensity: 0.4, roughness: 0.4 });
      // fixed: the plate with its bolts, the turned pedestal, the pick fixture and the tote
      const plate = P.cyl(0.13, 0.14, 0.02, cap, 0, 0.01, 0, 40);
      const bolts = Array.from({ length: 6 }, (_, i) => { const a = (i * Math.PI) / 3 + Math.PI / 6; return P.cyl(0.006, 0.006, 0.004, alu, Math.cos(a) * 0.118, 0.022, Math.sin(a) * 0.118, 8); });
      const ped = new THREE.Mesh(new THREE.LatheGeometry([[0, 0.02], [0.098, 0.02], [0.1, 0.026], [0.096, 0.034], [0.088, 0.05], [0.084, 0.1], [0.082, 0.112], [0.078, 0.118], [0, 0.118]].map(([x, y]) => new THREE.Vector2(x, y)), 40), white);
      P.add(ped);
      const fixTex = canvasTex(THREE, (g, w, h) => {
        g.fillStyle = '#C9CED2'; g.fillRect(0, 0, w, h); g.fillStyle = '#4A5056';
        for (const x of [14, 50]) for (const y of [14, 50]) { g.beginPath(); g.arc(x, y, 3.5, 0, Math.PI * 2); g.fill(); }
        g.strokeStyle = '#6FD3CB'; g.lineWidth = 1.5; g.strokeRect(20, 20, 24, 24);
      }, 64, 64);
      fixTex.wrapS = fixTex.wrapT = THREE.ClampToEdgeWrapping;
      const pad = lite(P.box(0.12, 0.008, 0.12, new THREE.MeshStandardMaterial({ map: fixTex, metalness: 1, roughness: 0.35 }), 0, 0.004, REACH, 0.002), 1);
      const toteMat = new THREE.MeshStandardMaterial({ color: 0xCFD4D7, roughness: 0.6 });
      const tote = merge(THREE, [
        lite(P.box(0.124, 0.022, 0.124, toteMat, REACH, 0.011, 0, 0.004), 1),
        ...[[0, 0.059, 0.124, 0.006], [0, -0.059, 0.124, 0.006], [0.059, 0, 0.006, 0.112], [-0.059, 0, 0.006, 0.112]].map(([dx, dz, w, d]) => lite(P.box(w, 0.024, d, toteMat, REACH + dx, 0.034, dz, 0.002), 1)),
      ], toteMat);
      const lead = cable(THREE, P, [[0, 0.06, -0.085], [0, 0.04, -0.12], [0.02, 0.01, -0.16], [0.08, 0.0085, -0.22]], 0.006, cap); // kept off the floor where the curve overshoots
      // the swing (yaw) part: turret, aqua ring, shoulder housing and its end caps
      const turret = P.cyl(0.072, 0.076, 0.026, white, 0, -0.009, 0, 36);
      const ring = P.cyl(0.0775, 0.0775, 0.004, aqua, 0, -0.0075, 0, 36); // just over the pedestal's top ring.castShadow = false;
      const shoulder = xcyl(P, 0.046, 0.1, white, 0, 0.012, 0, 32);
      const sCaps = [-0.051, 0.051].map((x) => xcyl(P, 0.042, 0.004, cap, x, 0.012, 0, 28));
      // upper arm (shoulder joint at its origin), forearm (elbow at its origin), wrist (at the end of the forearm)
      const link1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, L1 - 0.06, 4, 16), white); link1.position.y = L1 / 2; P.add(link1);
      const elbow = xcyl(P, 0.038, 0.086, white, 0, 0, 0, 28);
      const eCaps = [-0.045, 0.045].map((x) => xcyl(P, 0.035, 0.004, cap, x, 0, 0, 24));
      const link2 = new THREE.Mesh(new THREE.CapsuleGeometry(0.023, L2 - 0.046, 4, 14), white); link2.position.y = L2 / 2; P.add(link2);
      const seam = P.cyl(0.0245, 0.0245, 0.005, cap, 0, L2 * 0.36, 0, 18); seam.castShadow = false; // the forearm's roll joint
      const wristCap = xcyl(P, 0.026, 0.058, white, 0, 0, 0, 24);
      const wCaps = [-0.031, 0.031].map((x) => xcyl(P, 0.023, 0.004, cap, x, 0, 0, 20));
      // the gripper: a tool flange, the gripper body on it, and two fingers (aluminium, a rubber pad facing in)
      const flange = P.cyl(0.02, 0.02, 0.01, alu, 0, 0.031, 0, 20);
      const palm = lite(P.box(0.11, 0.014, 0.03, cap, 0, 0.043, 0, 0.004), 1);
      const finger = (side) => {
        const f = lite(P.box(0.008, 0.045, 0.022, alu, 0, 0.0685, 0, 0.002), 1);
        const pd = P.box(0.002, 0.03, 0.018, M.rubber, -side * 0.005, 0.075, 0); pd.castShadow = false;
        return P.group(f, pd);
      };
      const fingerL = finger(-1), fingerR = finger(1);
      const gripper = P.group(flange, palm, fingerL, fingerR);
      const wrist = P.group(wristCap, merge(THREE, wCaps, cap), gripper);
      const forearm = P.group(elbow, merge(THREE, eCaps, cap), link2, seam, wrist); wrist.position.y = L2;
      const upper = P.group(link1, forearm); forearm.position.y = L1;
      const swing = P.group(turret, ring, shoulder, merge(THREE, sCaps, cap), upper); upper.position.y = 0.012; swing.position.set(0, HS - 0.012, 0);
      const cubeMat = new THREE.MeshPhysicalMaterial({ color: 0xFF7A1C, roughness: 0.45, clearcoat: 0.3 });
      const cube = lite(P.box(0.05, 0.05, 0.05, cubeMat, 0, 0, 0, 0.004), 1);
      cube.position.set(0, 0.033, REACH); // on the plate until the first update
      const root = P.group(plate, merge(THREE, bolts, alu), ped, pad, tote, lead, swing, cube);
      const led = statusLed(THREE, root, { at: [0, 0.075, 0.087], r: 0.0055, size: 0.035 }); // on the pedestal's front
      const dt = stepper();
      let yaw = null, t1 = 0, t2 = 0, grip = 0, holding = null, rest = 'pad';
      const place = (where) => { // let the cube rest on the plate or in the tote
        if (cube.parent !== root) root.add(cube);
        cube.rotation.set(0, 0, 0);
        if (where === 'tray') cube.position.set(REACH, 0.047, 0); else cube.position.set(0, 0.033, REACH);
      };
      return {
        root,
        update(s, t) {
          const d = dt(t), want = POSES[s.pose] || POSES.home;
          if (yaw === null) { yaw = want.yaw; t1 = want.t1; t2 = want.t2; } // start at the state's pose, not folded from home
          yaw = ease(yaw, want.yaw, d, 2.6); t1 = ease(t1, want.t1, d, 2.6); t2 = ease(t2, want.t2, d, 2.6);
          const hold = !!s.holding;
          grip = ease(grip, hold ? 1 : 0, d, 10);
          swing.rotation.y = yaw; upper.rotation.x = t1; forearm.rotation.x = t2 - t1; wrist.rotation.x = Math.PI - t2;
          const gap = 0.048 - 0.017 * grip; fingerL.position.x = -gap; fingerR.position.x = gap; // closed: the pads on the cube's faces
          if (hold !== holding) {
            if (holding === true && !hold) rest = yaw > Math.PI / 4 ? 'tray' : 'pad'; // let go where the arm is
            holding = hold;
            if (hold) { gripper.add(cube); cube.position.set(0, 0.067, 0); cube.rotation.set(0, 0, 0); } else place(rest);
          }
          led.set(s, t, HEX.green, 2);
        },
      };
    },
  },

  // A desktop thermal label printer on a small oak side table (spare rolls on its shelf): a white base with the label
  // slot, a serrated tear bar, the feed button and its light, under a smoked clamshell lid with the label roll showing
  // through. Each print (the count going up) slides a barcode label out of the slot, holds it a moment and lets it drop;
  // the light blinks amber while it prints.
  label_printer: {
    icon: 'labelprinter', size: 0.4,
    edit: [{ field: 'printed', kind: 'slider', step: 1, label: 'printed' }],
    format: (s) => { const n = Math.max(0, whole(s.printed)); return n === 0 ? 'no labels yet' : `${n} label${n === 1 ? '' : 's'} printed`; },
    control: false,
    model({ THREE, P, M }) {
      const TOP = 0.36; // the table top
      const white = new THREE.MeshPhysicalMaterial({ color: 0xF1F3F2, roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.3 });
      const graphite = new THREE.MeshStandardMaterial({ color: 0x2B2F33, roughness: 0.55 });
      const paper = new THREE.MeshStandardMaterial({ color: 0xF4F6F5, roughness: 0.8 });
      // the table: an oak top on four legs, a shelf low down with two spare rolls
      const table = merge(THREE, [
        lite(P.box(0.3, 0.024, 0.28, M.woodLight, 0, TOP - 0.012, 0, 0.004), 1),
        ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => P.box(0.024, TOP - 0.024, 0.024, M.woodLight, sx * 0.128, (TOP - 0.024) / 2, sz * 0.118)),
        lite(P.box(0.27, 0.016, 0.25, M.woodLight, 0, 0.09, 0, 0.003), 1),
      ], M.woodLight);
      const spares = merge(THREE, [xcyl(P, 0.04, 0.09, paper, -0.06, 0.138, 0.02, 24), xcyl(P, 0.04, 0.09, paper, 0.05, 0.138, -0.03, 24)], paper);
      // the printer: base, slot, tear bar, button
      const base = lite(P.box(0.2, 0.045, 0.19, white, 0, TOP + 0.0225, 0, 0.01));
      const slotMat = new THREE.MeshStandardMaterial({ color: 0x0E1012, roughness: 0.8 });
      const slot = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.008), slotMat); slot.position.set(0, 0.392, 0.0952); slot.castShadow = false;
      const tearTex = canvasTex(THREE, (g, w, h) => { g.fillStyle = '#9EA4A9'; g.fillRect(0, 0, w, h); g.fillStyle = '#5D6368'; for (let x = 0; x < w; x += 4) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 2, h - 5); g.lineTo(x + 4, h); g.fill(); } }, 128, 8);
      const tear = P.box(0.13, 0.005, 0.004, new THREE.MeshStandardMaterial({ map: tearTex, metalness: 1, roughness: 0.35 }), 0, 0.3985, 0.096); tear.castShadow = false;
      const button = lite(P.box(0.02, 0.011, 0.005, graphite, 0.078, 0.386, 0.095, 0.002), 1);
      // the clamshell lid: its side profile (z, y above the base) extruded across x, in smoked glossy plastic
      const prof = new THREE.Shape();
      prof.moveTo(-0.092, 0); prof.lineTo(0.088, 0); prof.lineTo(0.088, 0.018); prof.quadraticCurveTo(0.08, 0.07, 0.03, 0.079);
      prof.lineTo(-0.06, 0.082); prof.quadraticCurveTo(-0.092, 0.08, -0.092, 0.05); prof.closePath();
      const lidGeo = new THREE.ExtrudeGeometry(prof, { depth: 0.186, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 8 });
      lidGeo.rotateY(-Math.PI / 2); lidGeo.translate(0.093, 0, 0); // the profile's x is z; the extrusion runs from x 0.093 to −0.093
      const lid = P.add(new THREE.Mesh(lidGeo, new THREE.MeshPhysicalMaterial({ color: 0x30353A, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.6, clearcoat: 1, clearcoatRoughness: 0.05 })));
      lid.position.y = TOP + 0.045; lid.renderOrder = 1; // after the roll inside it
      const roll = xcyl(P, 0.034, 0.1, paper, 0, 0.443, -0.03, 28);
      const core = xcyl(P, 0.012, 0.106, graphite, 0, 0.443, -0.03, 12);
      const cord = cable(THREE, P, [[0.06, 0.375, -0.095], [0.06, 0.372, -0.13], [0.08, 0.35, -0.152], [0.1, 0.2, -0.156], [0.1, 0.012, -0.15], [0.13, 0.006, -0.1]], 0.0035, graphite);
      const stripTex = canvasTex(THREE, (g, w, h) => {
        g.fillStyle = '#F5F7F6'; g.fillRect(0, 0, w, h); g.fillStyle = '#1B1D20';
        for (let i = 0; i < 26; i++) g.fillRect(16 + i * 3.6 + (i % 3), 70, 1.5 + (i % 2) * 1.5 + (i % 5 === 0 ? 1 : 0), 34);
        g.fillRect(14, 18, 62, 9); g.fillRect(14, 34, 40, 6); g.fillRect(14, 46, 52, 6); g.fillRect(84, 14, 30, 30);
        g.fillStyle = '#F5F7F6'; g.fillRect(89, 19, 20, 20); g.fillStyle = '#1B1D20'; g.fillRect(94, 24, 10, 10);
      }, 128, 128);
      stripTex.wrapS = stripTex.wrapT = THREE.ClampToEdgeWrapping;
      const stripMat = new THREE.MeshStandardMaterial({ map: stripTex, roughness: 0.8, side: THREE.DoubleSide });
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.1), stripMat);
      strip.rotation.x = -Math.PI / 2; strip.castShadow = true; strip.userData.noAO = true; strip.raycast = () => {}; strip.visible = false;
      const root = P.group(table, spares, base, slot, tear, button, roll, core, lid, cord, strip);
      const led = statusLed(THREE, root, { at: [0.078, 0.3995, 0.0955], r: 0.0045, size: 0.03 }); // over the feed button
      const EJECT = 1.6; // seconds the strip is out
      let last = null, since = null;
      return {
        root,
        update(s, t) {
          const n = whole(s.printed);
          if (last !== null && n > last) since = t; // the count went up: print a label now
          last = n;
          const a = since == null ? EJECT : t - since, out = a < EJECT && s.status !== 'offline';
          strip.visible = out;
          if (out) {
            const slide = Math.min(1, a / 0.5), drop = Math.max(0, (a - 1.1) / 0.5);
            const len = 0.08 * slide;
            strip.scale.set(1, Math.max(0.01, len / 0.1), 1);
            strip.position.set(0, 0.392 - drop * 0.1, 0.098 + len / 2 + drop * 0.015);
            strip.rotation.x = -Math.PI / 2 + drop * 0.5;
            stripMat.opacity = 1;
          }
          led.set(s, t, out ? HEX.amber : HEX.green, out ? 4 : 1.5);
        },
      };
    },
  },
};
