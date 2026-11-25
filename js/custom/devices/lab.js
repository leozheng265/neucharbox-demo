// The Laser lab types' card UI and 3D models for the custom room (contract: devices/index.js). Their look follows the lab
// scene (js/scenes/lab.js), as optomechanics off a catalogue: a finned laser head on two posts, a kinematic mirror mount,
// a stepper-driven linear stage and a thermal power sensor with its handheld console. Each sits on its own small optical
// breadboard, its parts on steel posts in post holders (here nothing shares the table, so there is no beam from one to
// the next): the laser shows its own beam into a dump, the mirror shows its tilt, and so on.
import { HEX, num, clamp01, statusLed, mergeMeshes, breadboard, BOARD_TOP, ease, stepper, canvasTex, screenTex } from './kit.js';

const Y0 = BOARD_TOP; // the breadboard's top
const deg = (v) => { const x = num(v); return Math.abs(x) < 0.05 ? '+0.0°' : `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}°`; }; // +0.1°, −2.5°: one decimal, as its slider reads

// P.box's rounded box has four corner segments (about 970 triangles each); one or two are plenty at this size.
function lite(m, seg = 2) {
  const g = m.geometry, p = g.parameters;
  if (g.type === 'RoundedBoxGeometry') { m.geometry = new g.constructor(p.width, p.height, p.depth, seg, p.radius); g.dispose(); }
  return m;
}

// What every lab model shares: the finishes, a lighter breadboard, posts in post holders, cables, turned parts.
function labKit(THREE, P, M) {
  // brushed aluminium: fine streaks along u in the colour (a bump would need tuning per light; the streaks read anyway)
  const brushed = canvasTex(THREE, (g, w, h) => { for (let y = 0; y < h; y++) { const v = 214 + ((y * 37) % 23); g.fillStyle = `rgb(${v},${v},${v + 2})`; g.fillRect(0, y, w, 1); } }, 8, 64);
  const mats = {
    anod: new THREE.MeshPhysicalMaterial({ color: 0x1D1F22, metalness: 1, roughness: 0.38, clearcoat: 0.25, clearcoatRoughness: 0.5 }), // black anodised
    alu: new THREE.MeshStandardMaterial({ color: 0xFFFFFF, map: brushed, metalness: 1, roughness: 0.3 }),
    post: new THREE.MeshStandardMaterial({ color: 0xC3C8CC, metalness: 1, roughness: 0.25 }), // ground stainless posts
    shell: new THREE.MeshPhysicalMaterial({ color: 0xE6E9EA, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.5 }), // light grey ABS
    graphite: new THREE.MeshStandardMaterial({ color: 0x2C3034, roughness: 0.6, metalness: 0.05 }),
    cable: new THREE.MeshStandardMaterial({ color: 0x23272B, roughness: 0.75 }),
  };
  // the kit's breadboard with a lighter plate and its four feet as one mesh
  const board = (w, d) => { const [plate, ...feet] = breadboard(THREE, P, M, w, d); lite(plate, 1); return [plate, mergeMeshes(THREE, feet, M.black, { consume: true })]; };
  // A Ø15 mm post in a post holder on a clamping fork, at (x, z) up to y = top. Pushes its parts into `bin` by material
  // (anod, post), so a model merges all of its posts into two meshes.
  const stand = (bin, x, z, top) => {
    const fork = lite(P.box(0.066, 0.008, 0.028, mats.anod, x, Y0 + 0.004, z, 0.003), 1);
    const holder = P.cyl(0.0135, 0.0135, 0.044, mats.anod, x, Y0 + 0.03, z, 16);
    const screw = P.cyl(0.0045, 0.0045, 0.014, mats.anod, x, Y0 + 0.042, z + 0.02, 8); screw.rotation.x = Math.PI / 2; // the holder's thumbscrew
    const post = P.cyl(0.0075, 0.0075, top - (Y0 + 0.05), mats.post, x, (top + Y0 + 0.05) / 2, z, 14);
    bin.anod.push(fork, holder, screw); bin.post.push(post);
  };
  const merge = (list, mat) => mergeMeshes(THREE, list, mat, { consume: true });
  // a cable along `pts`, thin enough that 6 sides read round
  const cable = (pts, r = 0.0032, mat = mats.cable) => {
    const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 28, r, 6), mat);
    m.castShadow = true; m.receiveShadow = true; return P.add(m);
  };
  // a turned part: [radius, height] pairs revolved about y
  const lathe = (pts, mat, seg = 28) => { const m = new THREE.Mesh(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg), mat); return P.add(m); };
  return { mats, board, stand, merge, cable, lathe };
}

export default {
  // A DPSS-style laser head: a black anodised body with heat-sink fins over its back two thirds, a brushed front housing
  // with the warning label and the emission LED, a steel nose with the aperture, on a base plate over two posts; a beam
  // dump on its own post across the board. A flip mount between them swings its paddle out of the beam: upright while the
  // shutter is closed (no beam), swung down and sideways once open, and the red beam brightens with the power setting.
  laser: {
    icon: 'laser', size: 0.6,
    edit: [{ field: 'open', kind: 'switch', label: 'shutter' }, { field: 'mW', kind: 'slider', step: 0.5, unit: ' mW', label: 'power' }],
    format: (s) => `shutter ${s.open ? 'open' : 'closed'} · ${num(s.mW).toFixed(1)} mW set`,
    active: (s) => !!s.open,
    control: { kind: 'switch', field: 'open' },
    model({ THREE, P, M }) {
      const { mats, board, stand, merge, cable, lathe } = labKit(THREE, P, M);
      const B = Y0 + 0.115, HW = 0.032; // the beam height; half the body's section
      const bin = { anod: [], post: [] };
      // body: the core, 15 fins wrapping its top and sides (flush with its floor), the base plate, two posts under it
      const core = lite(P.box(0.22, 2 * HW, 2 * HW, mats.anod, -0.16, B, 0, 0.006));
      const fins = [];
      for (let i = 0; i < 15; i++) fins.push(P.box(0.0035, 2 * HW + 0.014, 2 * HW + 0.024, mats.anod, -0.245 + i * 0.0093, B + 0.007, 0));
      const plate = lite(P.box(0.2, 0.01, 0.074, mats.anod, -0.16, B - HW - 0.005, 0, 0.003), 1);
      stand(bin, -0.22, 0, B - HW - 0.01); stand(bin, -0.1, 0, B - HW - 0.01);
      const front = lite(P.box(0.06, 2 * HW + 0.006, 2 * HW + 0.006, mats.alu, -0.08, B, 0, 0.008));
      const rear = lite(P.box(0.018, 2 * HW + 0.006, 2 * HW + 0.006, mats.alu, -0.261, B, 0, 0.006), 1);
      const nose = P.cyl(0.018, 0.018, 0.02, mats.alu, -0.04, B, 0, 24); nose.rotation.z = Math.PI / 2;
      const bezel = P.cyl(0.011, 0.013, 0.006, mats.anod, -0.027, B, 0, 20); bezel.rotation.z = Math.PI / 2;
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.0075, 20), new THREE.MeshPhysicalMaterial({ color: 0x0E1620, roughness: 0.05, metalness: 0.2, clearcoat: 1 }));
      lens.rotation.y = Math.PI / 2; lens.position.set(-0.0238, B, 0);
      // the laser warning label on the front housing's side: yellow, a black-edged triangle with the beam symbol, text lines
      const labelTex = canvasTex(THREE, (g, w, h) => {
        g.fillStyle = '#F2C230'; g.fillRect(0, 0, w, h); g.strokeStyle = '#15171A'; g.lineWidth = 4; g.strokeRect(3, 3, w - 6, h - 6);
        g.fillStyle = '#15171A'; g.beginPath(); g.moveTo(34, 12); g.lineTo(58, 54); g.lineTo(10, 54); g.closePath(); g.fill();
        g.fillStyle = '#F2C230'; g.beginPath(); g.moveTo(34, 21); g.lineTo(50, 49); g.lineTo(18, 49); g.closePath(); g.fill();
        g.fillStyle = '#15171A'; g.beginPath(); g.arc(30, 40, 4, 0, Math.PI * 2); g.fill(); g.fillRect(30, 39, 18, 2);
        for (let i = 0; i < 4; i++) g.fillRect(68, 16 + i * 10, i === 0 ? 50 : 38 + (i % 2) * 10, i === 0 ? 5 : 3);
      }, 128, 64);
      labelTex.wrapS = labelTex.wrapT = THREE.ClampToEdgeWrapping;
      const label = new THREE.Mesh(new THREE.PlaneGeometry(0.046, 0.023), new THREE.MeshStandardMaterial({ map: labelTex, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2 }));
      label.position.set(-0.08, B - 0.004, HW + 0.0032); label.castShadow = false;
      // the umbilical to its controller: a strain relief out of the rear cap, then down and along the board
      const relief = P.cyl(0.0055, 0.0075, 0.016, mats.graphite, -0.278, B - 0.01, 0, 12); relief.rotation.z = Math.PI / 2;
      const lead = cable([[-0.285, B - 0.01, 0], [-0.292, B - 0.035, -0.012], [-0.288, Y0 + 0.03, -0.07], [-0.26, Y0 + 0.006, -0.14], [-0.17, Y0 + 0.006, -0.175]], 0.0042);
      // the beam dump: a finned turned body with a cone cavity facing the laser, on its own post
      const fin = []; for (let i = 0; i < 6; i++) { const a = 0.008 + i * 0.007; fin.push([0.028, a], [0.028, a + 0.0035], [0.023, a + 0.0042], [0.023, a + 0.007]); }
      const dump = lathe([[0, 0.028], [0.016, 0.0], [0.023, 0.0], [0.023, 0.006], ...fin, [0.023, 0.052], [0.0, 0.052]], mats.anod, 28);
      dump.rotation.z = -Math.PI / 2; dump.position.set(0.2375, B, 0); // its axis along +x, the open face at x 0.2375
      stand(bin, 0.262, 0, B - 0.022);
      // the flip mount: a hinge block on a post, the paddle hinged along the beam's axis at its foot
      const HINGE = B - 0.035;
      const hingeBlock = lite(P.box(0.022, 0.014, 0.03, mats.anod, 0.03, HINGE - 0.002, -0.006, 0.003), 1);
      const pin = P.cyl(0.004, 0.004, 0.026, mats.post, 0.03, HINGE, 0, 10); pin.rotation.z = Math.PI / 2;
      stand(bin, 0.03, -0.006, HINGE - 0.009);
      const paddle = lite(P.box(0.006, 0.066, 0.05, mats.anod, 0, 0.037, 0, 0.003), 1); // hinged at its foot
      const flap = P.group(paddle); flap.position.set(0.03, HINGE, 0);
      const beamMat = new THREE.MeshBasicMaterial({ color: 0xFF2D2D, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.269, 8), beamMat);
      beam.rotation.z = Math.PI / 2; beam.position.set(0.1105, B, 0); beam.userData.noAO = true; beam.raycast = () => {}; beam.visible = false;
      const spotMat = new THREE.MeshBasicMaterial({ color: 0xFF5A4A, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      const spot = new THREE.Mesh(new THREE.CircleGeometry(0.013, 14), spotMat);
      spot.rotation.y = -Math.PI / 2; spot.position.set(0.2395, B, 0); spot.userData.noAO = true; spot.raycast = () => {}; spot.visible = false;
      const black = merge([core, ...fins, plate, ...bin.anod, bezel, hingeBlock], mats.anod), steel = merge([...bin.post, pin], mats.post);
      const brushedParts = merge([front, rear, nose], mats.alu);
      const root = P.group(...board(0.6, 0.4), black, steel, brushedParts, lens, label, relief, lead, dump, flap, beam, spot);
      const led = statusLed(THREE, root, { at: [-0.095, B + HW + 0.0035, 0.018], r: 0.005 }); // the emission light on top
      const dt = stepper(); let fold = 0;
      return {
        root,
        update(s, t) {
          const open = !!s.open, k = clamp01(num(s.mW) / 20);
          fold = ease(fold, open ? 1 : 0, dt(t), 9);
          flap.rotation.x = fold * (Math.PI / 2 - 0.02); // upright → swung down beside the beam, toward +z
          beam.visible = spot.visible = open && fold > 0.9;
          beamMat.opacity = 0.4 + 0.5 * k; spotMat.opacity = 0.4 + 0.55 * k;
          led.set(s, t, open ? HEX.red : HEX.green, open ? 4 : 1.5);
        },
      };
    },
  },

  // A motorised kinematic mirror mount on a post: a fixed black back plate with the two adjusters (knurled knobs on fine
  // screws, turning with their axis) and a pivot ball, and a front plate holding a round silvered mirror that tips with yaw
  // and pitch (drawn three times larger than the real fraction of a degree, so a change shows from across the room). Its
  // cable runs to a small controller that shows both angles.
  mirror: {
    icon: 'mirror', size: 0.4,
    edit: [{ field: 'yaw', kind: 'slider', step: 0.1, unit: '°', label: 'yaw' }, { field: 'pitch', kind: 'slider', step: 0.1, unit: '°', label: 'pitch' }],
    format: (s) => `yaw ${deg(s.yaw)} · pitch ${deg(s.pitch)}`,
    active: (s) => Math.abs(num(s.yaw)) > 0.005 || Math.abs(num(s.pitch)) > 0.005,
    control: false,
    model({ THREE, P, M }) {
      const { mats, board, stand, merge, cable } = labKit(THREE, P, M);
      const X = -0.04, C = Y0 + 0.15, S = 0.086, ZB = -0.032; // mount centre x, centre height, plate size, back plate z
      const bin = { anod: [], post: [] };
      stand(bin, X, ZB, C - S / 2);
      const back = lite(P.box(S, S, 0.012, mats.anod, X, C, ZB, 0.004));
      // the adjusters at two corners, the pivot ball at the third (the front plate rocks about it)
      const ADJ = [[S / 2 - 0.012, S / 2 - 0.012], [-(S / 2 - 0.012), -(S / 2 - 0.012)]];
      const knobs = ADJ.map(([dx, dy]) => {
        const k = P.cyl(0.0085, 0.0085, 0.012, new THREE.MeshStandardMaterial({ color: 0x24272B, metalness: 0.9, roughness: 0.4, flatShading: true }), X + dx, C + dy, ZB - 0.017, 14);
        k.rotation.x = Math.PI / 2; return k;
      });
      const screws = ADJ.map(([dx, dy]) => { const sc = P.cyl(0.0025, 0.0025, 0.03, mats.post, X + dx, C + dy, ZB + 0.004, 8); sc.rotation.x = Math.PI / 2; return sc; });
      const nuts = ADJ.map(([dx, dy]) => { const n = P.cyl(0.0048, 0.0048, 0.004, mats.post, X + dx, C + dy, ZB - 0.008, 6); n.rotation.x = Math.PI / 2; return n; });
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.006, 10, 8), mats.post); ball.position.set(X - (S / 2 - 0.012), C + S / 2 - 0.012, ZB + 0.012); P.add(ball); // between the plates
      // the motor actuators' wiring: a cable out of the back plate's foot to the controller
      const lead = cable([[X + 0.02, C - S / 2 + 0.006, ZB - 0.008], [X + 0.03, C - S / 2 - 0.02, ZB - 0.02], [X + 0.05, Y0 + 0.006, ZB - 0.02], [0.08, Y0 + 0.006, 0.0], [0.115, Y0 + 0.012, 0.04]]);
      // the moving front plate and its mirror (silvered face, a pale green glass edge)
      const plate = lite(P.box(S, S, 0.012, mats.anod, 0, 0, 0, 0.004));
      const glassEdge = new THREE.MeshPhysicalMaterial({ color: 0xA9CFC0, roughness: 0.1, clearcoat: 1, transparent: true, opacity: 0.85 });
      const silver = new THREE.MeshPhysicalMaterial({ color: 0xDCE5EC, metalness: 1, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.02 });
      const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.007, 36), [glassEdge, silver, silver]); glass.rotation.x = Math.PI / 2; glass.position.z = 0.0075;
      const retainer = P.cyl(0.0035, 0.0035, 0.012, mats.post, 0, -S / 2 + 0.002, 0, 8); // the nylon-tipped set screw under the optic
      const head = P.group(plate, glass, retainer); head.position.set(X, C, 0);
      // the controller: a light grey box with a small screen showing both angles
      const ctrl = lite(P.box(0.08, 0.032, 0.06, mats.shell, 0.12, Y0 + 0.016, 0.07, 0.006));
      const scr = screenTex(THREE, 256, 96);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.0225), new THREE.MeshStandardMaterial({ map: scr.tex, emissive: 0xffffff, emissiveMap: scr.tex, emissiveIntensity: 0.8, roughness: 0.25 }));
      screen.position.set(0.112, Y0 + 0.016, 0.1003); screen.castShadow = false;
      const draw = (key, s) => {
        const g = scr.g; g.fillStyle = key === 'off' ? '#07090B' : '#0A1218'; g.fillRect(0, 0, 256, 96);
        if (key === 'off') { scr.tex.needsUpdate = true; return; }
        g.textBaseline = 'middle'; g.font = '600 34px Inter, "Segoe UI", sans-serif';
        if (key === 'fault') { g.fillStyle = '#FF7A62'; g.textAlign = 'center'; g.fillText('no link', 128, 48); }
        else {
          g.textAlign = 'left'; g.fillStyle = '#7FC9D6'; g.font = '26px Inter, "Segoe UI", sans-serif'; g.fillText('X', 14, 28); g.fillText('Y', 14, 70);
          g.fillStyle = '#E8FBFF'; g.font = '600 34px Inter, "Segoe UI", sans-serif'; g.textAlign = 'right'; g.fillText(deg(s.yaw), 240, 28); g.fillText(deg(s.pitch), 240, 70);
        }
        scr.tex.needsUpdate = true;
      };
      const black = merge([...bin.anod, back], mats.anod), steel = merge([...bin.post, ...screws, ...nuts], mats.post);
      const root = P.group(...board(0.4, 0.3), black, steel, ball, ...knobs, lead, head, ctrl, screen);
      const led = statusLed(THREE, root, { at: [0.148, Y0 + 0.0325, 0.085], r: 0.005 });
      const dt = stepper(); let yaw = 0, pitch = 0, shown = null;
      const K = (Math.PI / 180) * 3; // 3× the real angle
      return {
        root,
        update(s, t) {
          const d = dt(t);
          yaw = ease(yaw, Math.max(-5, Math.min(5, num(s.yaw))), d, 6); pitch = ease(pitch, Math.max(-5, Math.min(5, num(s.pitch))), d, 6);
          head.rotation.y = yaw * K; head.rotation.x = -pitch * K;
          knobs[0].rotation.y = yaw * 1.6; knobs[1].rotation.y = pitch * 1.6; // each adjuster turns with its axis
          const key = s.status === 'offline' ? 'off' : s.status === 'fault' ? 'fault' : `${deg(s.yaw)} ${deg(s.pitch)}`;
          if (key !== shown) { shown = key; draw(key, s); }
          led.set(s, t);
        },
      };
    },
  },

  // A motorised linear stage: a black anodised base with two steel guide rails, a lead screw between end blocks, driven
  // through a coupler by a stepper motor (black end caps round a silver stack, its driver on the back) on a bracket at the
  // left end. The brushed carriage rides the screw, carrying a lens on a post; the screw turns as it travels and an aqua
  // pointer reads the 0–25 mm scale on the base.
  linear_stage: {
    icon: 'stage', size: 0.6,
    edit: [{ field: 'x', kind: 'slider', step: 0.5, unit: ' mm' }],
    format: (s) => `${num(s.x).toFixed(1)} mm`,
    active: (s) => num(s.x) > 0.05,
    control: { kind: 'bar', field: 'x', min: 0, max: 25 },
    model({ THREE, P, M }) {
      const { mats, board, merge, cable } = labKit(THREE, P, M);
      const SY = Y0 + 0.034, TRAVEL = 0.26; // the screw's axis height; the carriage's travel for 0–25 mm
      const base = lite(P.box(0.42, 0.022, 0.1, mats.anod, -0.005, Y0 + 0.011, 0, 0.004));
      const ends = [-0.2025, 0.1975].map((x) => lite(P.box(0.015, 0.04, 0.09, mats.anod, x, Y0 + 0.042, 0, 0.003), 1));
      const bracket = lite(P.box(0.008, 0.066, 0.07, mats.anod, -0.232, Y0 + 0.033, 0, 0.002), 1);
      const rails = [-0.032, 0.032].map((z) => P.box(0.38, 0.008, 0.012, mats.post, -0.0025, Y0 + 0.026, z));
      const bearings = [-0.2025, 0.1975].map((x) => { const b = P.cyl(0.009, 0.009, 0.017, mats.post, x, SY, 0, 16); b.rotation.z = Math.PI / 2; return b; });
      // the lead screw: its thread drawn as diagonal stripes, so turning it shows; the geometry lies along x, so it spins on rotation.x
      const thread = canvasTex(THREE, (g, w, h) => { g.fillStyle = '#B9BEC3'; g.fillRect(0, 0, w, h); g.fillStyle = '#5E646A'; for (let i = -h; i < w; i += 16) { g.beginPath(); g.moveTo(i, h); g.lineTo(i + 6, h); g.lineTo(i + 6 + h, 0); g.lineTo(i + h, 0); g.closePath(); g.fill(); } }, 32, 32);
      thread.repeat.set(1, 0.385 / 0.005);
      const screwGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.385, 14); screwGeo.rotateZ(Math.PI / 2);
      const screw = new THREE.Mesh(screwGeo, new THREE.MeshStandardMaterial({ map: thread, metalness: 1, roughness: 0.35 })); screw.position.set(-0.0025, SY, 0); P.add(screw);
      const coupler = P.cyl(0.01, 0.01, 0.018, mats.alu, -0.219, SY, 0, 16); coupler.rotation.z = Math.PI / 2;
      // the stepper: front cap, a slightly smaller silver stack, the rear cap, and the driver box behind it
      const capF = lite(P.box(0.014, 0.056, 0.056, mats.anod, -0.243, SY, 0, 0.004), 1);
      const stack = lite(P.box(0.024, 0.053, 0.053, mats.alu, -0.262, SY, 0, 0.003), 1);
      const capR = lite(P.box(0.012, 0.056, 0.056, mats.anod, -0.28, SY, 0, 0.004), 1);
      const driver = lite(P.box(0.012, 0.05, 0.05, mats.graphite, -0.292, SY, 0, 0.005), 1);
      const lead = cable([[-0.292, SY + 0.018, -0.022], [-0.292, SY + 0.03, -0.045], [-0.285, Y0 + 0.006, -0.09], [-0.22, Y0 + 0.006, -0.125]]);
      // the scale: 0–25 mm ticks and every fifth numbered, on the base's front face, under the pointer's travel
      const scale = screenTex(THREE, 512, 32), sg = scale.g, W = 0.3, toPx = (xw) => ((xw + W / 2) / W) * 512;
      sg.fillStyle = '#1D1F22'; sg.fillRect(0, 0, 512, 32); sg.fillStyle = '#D9DEE2'; sg.font = '600 13px Inter, "Segoe UI", sans-serif'; sg.textAlign = 'center'; sg.textBaseline = 'bottom';
      for (let mm = 0; mm <= 25; mm++) { const px = toPx(-TRAVEL / 2 + (mm / 25) * TRAVEL); sg.fillRect(px - 0.75, 0, 1.5, mm % 5 === 0 ? 14 : 8); if (mm % 5 === 0) sg.fillText(String(mm), px, 31); }
      scale.tex.needsUpdate = true;
      const ruler = new THREE.Mesh(new THREE.PlaneGeometry(W, 0.016), new THREE.MeshStandardMaterial({ map: scale.tex, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2 }));
      ruler.position.set(0, Y0 + 0.011, 0.0503); ruler.castShadow = false;
      // the carriage (local y 0 is the breadboard top): a brushed table with its tapped holes, the nut under it, the lens
      const holes = canvasTex(THREE, (g, w, h) => { g.fillStyle = '#D5D9DD'; g.fillRect(0, 0, w, h); g.fillStyle = '#3A3F44'; for (const x of [16, 48]) for (const y of [16, 48]) { g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill(); } }, 64, 64);
      holes.repeat.set(4, 3);
      const table = lite(P.box(0.1, 0.02, 0.09, new THREE.MeshStandardMaterial({ map: holes, metalness: 1, roughness: 0.33 }), 0, 0.047, 0, 0.003), 1);
      const nut = lite(P.box(0.03, 0.022, 0.03, mats.anod, 0, 0.034, 0, 0.003), 1);
      const tab = P.box(0.012, 0.003, 0.012, mats.anod, 0, 0.038, 0.05);
      const aqua = new THREE.MeshStandardMaterial({ color: 0x29EEE5, emissive: 0x1FA8A2, emissiveIntensity: 0.35, roughness: 0.4 });
      const needle = P.box(0.0022, 0.02, 0.0022, aqua, 0, 0.027, 0.0545); needle.castShadow = false;
      const optPost = P.cyl(0.006, 0.006, 0.04, mats.post, 0, 0.077, 0, 12);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.019, 0.0045, 8, 28), mats.anod); ring.rotation.y = Math.PI / 2; ring.position.y = 0.115; P.add(ring);
      const lensGlass = new THREE.Mesh(new THREE.CircleGeometry(0.0185, 24), new THREE.MeshPhysicalMaterial({ color: 0xCFE6F0, roughness: 0.05, transparent: true, opacity: 0.35, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false }));
      lensGlass.rotation.y = Math.PI / 2; lensGlass.position.y = 0.115; lensGlass.castShadow = false;
      const slide = P.group(table, nut, tab, needle, optPost, ring, lensGlass); slide.position.y = Y0;
      const black = merge([base, ...ends, bracket, capF, capR], mats.anod), steel = merge([...rails, ...bearings], mats.post), silver = merge([coupler, stack], mats.alu);
      const root = P.group(...board(0.6, 0.3), black, steel, silver, screw, driver, lead, ruler, slide);
      const led = statusLed(THREE, root, { at: [-0.292, SY + 0.0255, 0.012], r: 0.005 }); // on the driver's top
      const dt = stepper(); let pos = 0;
      return {
        root,
        update(s, t) {
          const target = (clamp01(num(s.x) / 25) - 0.5) * TRAVEL;
          pos = Math.abs(target - pos) < 0.0004 ? target : pos + (target - pos) * Math.min(1, dt(t) * 7);
          slide.position.x = pos;
          screw.rotation.x = (pos / 0.01) * Math.PI * 2; // a 10 mm lead (as drawn): one turn per 10 mm of travel
          led.set(s, t);
        },
      };
    },
  },

  // A thermal power sensor and its handheld console. The sensor head is a finned turned housing on a post, its black
  // absorber facing along the board; the absorber glows red with the power. Its cable runs to the console, a light grey
  // meter in a graphite rubber boot on a wire kickstand, whose screen shows the reading (0–20 mW) over a bar of eight
  // segments that follows it.
  power_meter: {
    icon: 'meter', size: 0.4,
    edit: [{ field: 'mW', kind: 'slider', step: 0.1, unit: ' mW' }],
    format: (s) => `${num(s.mW).toFixed(2)} mW`,
    active: (s) => num(s.mW) > 0.05,
    control: false,
    model({ THREE, P, M }) {
      const { mats, board, stand, merge, cable, lathe } = labKit(THREE, P, M);
      const H = Y0 + 0.12, HX = -0.105; // the sensor's axis height; its front face
      const bin = { anod: [], post: [] };
      stand(bin, -0.13, 0, H - 0.044);
      const fins = []; for (let i = 0; i < 5; i++) { const a = 0.009 + i * 0.0058; fins.push([0.047, a], [0.047, a + 0.0028], [0.041, a + 0.0034], [0.041, a + 0.0058]); }
      const housing = lathe([[0.032, 0.0035], [0.034, 0], [0.041, 0], [0.041, 0.008], ...fins, [0.041, 0.042], [0.036, 0.046], [0, 0.046]], mats.alu, 36);
      housing.rotation.z = Math.PI / 2; housing.position.set(HX, H, 0); // its axis along x, the front at HX
      const stub = P.cyl(0.0085, 0.0085, 0.01, mats.anod, -0.13, H - 0.044, 0, 12);
      const faceMat = new THREE.MeshStandardMaterial({ color: 0x1C1416, emissive: 0xFF3030, emissiveIntensity: 0, roughness: 0.85 });
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.032, 28), faceMat); face.rotation.y = Math.PI / 2; face.position.set(HX - 0.0034, H, 0);
      const relief = P.cyl(0.005, 0.007, 0.014, mats.graphite, HX - 0.052, H, 0, 10); relief.rotation.z = Math.PI / 2;
      const lead = cable([[HX - 0.058, H, 0], [-0.18, H - 0.02, 0], [-0.175, Y0 + 0.006, -0.06], [-0.05, Y0 + 0.006, -0.1], [0.07, Y0 + 0.006, -0.04], [0.085, Y0 + 0.022, 0.018]], 0.0035);
      // the console, built upright with its back face on z 0 and its foot on y 0, then leant back on its stand
      const CW = 0.122, CH = 0.176, CD = 0.034;
      const boot = lite(P.box(CW, CH, CD, mats.graphite, 0, CH / 2, CD / 2, 0.012));
      const bezel = lite(P.box(CW - 0.014, CH - 0.014, 0.004, mats.shell, 0, CH / 2, CD + 0.001, 0.003), 1);
      const scr = screenTex(THREE, 256, 160);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.094, 0.0588), new THREE.MeshStandardMaterial({ map: scr.tex, emissive: 0xffffff, emissiveMap: scr.tex, emissiveIntensity: 0.85, roughness: 0.2 }));
      screen.position.set(0, 0.122, CD + 0.0032); screen.castShadow = false;
      // the keypad under the screen: four soft keys, a round power key and arrows, printed on the bezel's lower half
      const keysTex = canvasTex(THREE, (g, w, h) => {
        g.fillStyle = '#E6E9EA'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#C4C9CC'; for (let i = 0; i < 4; i++) { g.beginPath(); g.roundRect(10 + i * 30, 8, 24, 14, 4); g.fill(); }
        g.fillStyle = '#A9B0B4'; for (const [x, y] of [[40, 52], [40, 84], [22, 68], [58, 68]]) { g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill(); }
        g.fillStyle = '#6FD3CB'; g.beginPath(); g.arc(40, 68, 6, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#3A3F44'; g.beginPath(); g.arc(18, 106, 8, 0, Math.PI * 2); g.fill();
      }, 128, 128);
      keysTex.wrapS = keysTex.wrapT = THREE.ClampToEdgeWrapping;
      const keys = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.06), new THREE.MeshStandardMaterial({ map: keysTex, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2 }));
      keys.position.set(-0.02, 0.05, CD + 0.0032); keys.castShadow = false;
      const knob = P.cyl(0.013, 0.013, 0.008, new THREE.MeshStandardMaterial({ color: 0x2C3034, roughness: 0.45, flatShading: true }), 0.03, 0.05, CD + 0.007, 18); knob.rotation.x = Math.PI / 2;
      // the wire kickstand, drawn in the console's frame: its foot lands on the board once the console leans back 0.34 rad
      const kick = cable([[-0.04, 0.09, -0.001], [-0.04, 0.05, -0.032], [-0.03, 0.022, -0.058], [0.03, 0.022, -0.058], [0.04, 0.05, -0.032], [0.04, 0.09, -0.001]], 0.0018, mats.post);
      const consoleG = P.group(boot, bezel, screen, keys, knob, kick); consoleG.position.set(0.085, Y0, 0.03); consoleG.rotation.x = -0.34;
      const led = statusLed(THREE, consoleG, { at: [0.042, CH - 0.017, CD + 0.0035], r: 0.0045 });
      const draw = (key, mw, lit) => {
        const g = scr.g; g.fillStyle = key === 'off' ? '#06080A' : '#0A1016'; g.fillRect(0, 0, 256, 160);
        if (key !== 'off') {
          g.textBaseline = 'middle';
          g.fillStyle = '#7FC9D6'; g.font = '20px Inter, "Segoe UI", sans-serif'; g.textAlign = 'left'; g.fillText('633 nm', 16, 22);
          g.textAlign = 'right'; g.fillText('thermal', 240, 22);
          if (key === 'fault') { g.fillStyle = '#FF7A62'; g.font = '600 46px Inter, "Segoe UI", sans-serif'; g.textAlign = 'center'; g.fillText('no reading', 128, 78); }
          else {
            g.fillStyle = '#E8FBFF'; g.font = '600 58px Inter, "Segoe UI", sans-serif'; g.textAlign = 'right'; g.fillText(mw.toFixed(2), 186, 76);
            g.fillStyle = '#29EEE5'; g.font = '600 26px Inter, "Segoe UI", sans-serif'; g.textAlign = 'left'; g.fillText('mW', 192, 84);
          }
          for (let i = 0; i < 8; i++) { g.fillStyle = key !== 'fault' && i < lit ? '#39E58B' : '#1A2A22'; g.fillRect(18 + i * 28.5, 122, 23, 20); }
        }
        scr.tex.needsUpdate = true;
      };
      const black = merge([...bin.anod, stub], mats.anod), steel = merge(bin.post, mats.post);
      const root = P.group(...board(0.4, 0.3), black, steel, housing, face, relief, lead, consoleG);
      let shown = null;
      return {
        root,
        update(s, t) {
          const mw = num(s.mW), lit = mw > 0.05 ? Math.max(1, Math.ceil(clamp01(mw / 20) * 8)) : 0;
          const key = s.status === 'offline' ? 'off' : s.status === 'fault' ? 'fault' : `${mw.toFixed(2)}|${lit}`;
          if (key !== shown) { shown = key; draw(key, mw, lit); faceMat.emissiveIntensity = clamp01(mw / 20) * 2.6; }
          led.set(s, t, lit ? HEX.green : HEX.amber, 2);
        },
      };
    },
  },
};
