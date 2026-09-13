// Scene 2 — Laser lab (illustrative). Proves: exact instructions, executed and verified step by step.
// Alignment model (pure, derived from the store so the panel and the room agree):
//   meter µW = PMAX · gauss(M1 error) · gauss(M2 error) · iris(stage x) · laser mW / 5
// M2 starts 0.12° off in yaw, so the beam lands low on the meter until someone walks it in.
// laser.stuck is the room's truth, not a device report: the shutter flag has dropped back into the beam
// while the driver still says "open". meter.bump < 1 means something is taking power out of the last leg.

const PMAX = 860;             // µW on the meter with perfect alignment at 5 mW
const LAMP_I = 9;             // each ceiling downlight (candela)
const W = 0.15;               // degrees of mirror error at which power falls to 1/e
const gauss = (yaw, pitch) => Math.exp(-((yaw * yaw + pitch * pitch) / (W * W)));
const iris = (x) => Math.exp(-Math.pow((x - 12.4) / 2.2, 2) * 0.7);
export function meterReading(st) {
  if (!st.laser.on || st.laser.shutter !== 'open' || st.laser.stuck) return 0;
  return PMAX * gauss(st.m1.yaw, st.m1.pitch) * gauss(st.m2.yaw, st.m2.pitch) * iris(st.stage.x) * (st.laser.mW / 5);
}
// What the meter (tile, room readout, beam camera and every chat line) actually shows.
const shown = (st) => meterReading(st) * (st.meter?.bump ?? 1);
const fmtUW = (v) => (v < 1 ? '0 µW' : `${v.toFixed(0)} µW`);
const readUW = (st) => Math.round(shown(st)); // a reading as a whole µW, for arithmetic on the numbers the log shows
// A move the visitor should watch: the room pings the device with a label and pulses it (build() listens for
// plan.cue; `hold` is ms at normal speed). Skipped while fast-forwarding, so a skip doesn't flash stale labels.
// `text` and `hold` may be functions of the store, for a move whose shape depends on a plan Edit.
const cue = (id, text, hold = 1500) => ({ fn: ({ store, fast }) => { if (!fast) store.set('plan.cue', { id, text: typeof text === 'function' ? text(store) : text, hold: typeof hold === 'function' ? hold(store) : hold }); } });

export default {
  id: 'lab',
  title: 'Laser lab',
  startHour: 14,
  camera: { position: [1.9, 1.75, 2.4], target: [-0.1, 0.95, -0.2], minDistance: 1.0, maxDistance: 5, azimuth: [-0.5, 1.2], fitAspect: 1.3 },
  setupIntro: 'An optical bench — an illustrative setup, not a specific lab. The hub is at the end of the table. Plug it in to start.',
  askIntro: 'This room takes exact instructions. Give one, or pick one below. I execute each step, then check it against a measurement (the power meter, and the beam camera where it can see the beam) before I call it done.',
  // Order of the tiles (and of discovery). On a phone's strip the last tile a request reveals stays in view: the beam
  // camera next to the laser (both change when the shutter opens, and show together), the meter between M2 and Stage X,
  // so the tilt and walk results show M2 + meter, the stage log meter + Stage X, and the shutter fault the laser.
  deviceOrder: ['laser', 'beamcam', 'm1', 'm2', 'meter', 'stage'],
  devices: {
    laser:  { icon: 'laser', name: 'Laser & shutter', initial: { on: true, shutter: 'closed', mW: 5, stuck: false }, format: (s) => `${s.shutter} · ${s.mW.toFixed(1)} mW set`, faultText: 'closed · inspect flag', active: (s) => s.shutter === 'open' },
    m1:     { icon: 'mirror', name: 'Mirror M1', initial: { yaw: 0.0, pitch: 0.0 }, format: (s) => `yaw ${s.yaw >= 0 ? '+' : ''}${s.yaw.toFixed(3)}° · pitch ${s.pitch >= 0 ? '+' : ''}${s.pitch.toFixed(3)}°`, faultText: 'no response' },
    m2:     { icon: 'mirror', name: 'Mirror M2', initial: { yaw: 0.12, pitch: -0.02 }, format: (s) => `yaw ${s.yaw >= 0 ? '+' : ''}${s.yaw.toFixed(3)}° · pitch ${s.pitch >= 0 ? '+' : ''}${s.pitch.toFixed(3)}°`, faultText: 'no response' },
    stage:  { icon: 'stage', name: 'Stage X', initial: { x: 10.0, limit: 12.0, moving: false }, format: (s) => `${s.x.toFixed(3)} mm · ${s.moving ? 'moving' : s.x >= s.limit - 0.0005 ? 'at limit' : `limit ${s.limit.toFixed(1)} mm`}`, faultText: 'no response' },
    meter:  { icon: 'meter', name: 'Power meter', initial: { bump: 1 }, format: (s, st) => fmtUW(shown(st)), faultText: 'no reading', active: (s, st) => shown(st) > 1 }, // amber while it reads a beam
    beamcam:{ icon: 'beamcam', name: 'Beam camera', initial: {}, format: (s, st) => (shown(st) > 1 ? `spot at (${(st.m2.yaw * 180).toFixed(0)}, ${(st.m2.pitch * 180).toFixed(0)}) px` : 'no beam'), faultText: 'no image', active: (s, st) => shown(st) > 1 },
  },

  // A typed request that doesn't run but asks for what is already so, or asks what state the shutter or laser is in:
  // the honest reply is the room's state, not "I won't guess". main.js asks this first, with interpret()'s answer `r`,
  // for any typed text that doesn't run; null means no such case (its usual reply follows).
  already(r, text, st) {
    const t = String(text ?? '').trim().toLowerCase().replace(/’/g, "'"), closed = st.laser.shutter !== 'open' || st.laser.stuck, now = `the meter reads ${fmtUW(shown(st))}`;
    const q = /^(?:is|are)\s+(?:the\s+)?(?:laser'?s?\s+)?shutter\s+(?:still\s+|already\s+|now\s+)?(open|opened|closed|shut)\b[^,;.!]*\??$/.exec(t);
    if (q) return `${/^open/.test(q[1]) === !closed ? 'Yes' : 'No'}: the shutter is ${closed ? 'closed' : 'open'}, and ${now}.${closed ? ' Pick a request below when you want it open.' : ''}`;
    const l = /^is\s+(?:the\s+)?laser\s+(?:still\s+|already\s+|now\s+)?(on|off)\b[^,;.!]*\??$/.exec(t) || /^(?:the\s+)?laser\s+(?:is|was|seems)\s+(?:still\s+|already\s+|now\s+)?(on|off)\b[^,;!?]*\.?$/.exec(t);
    if (l) return `${/^is\b/.test(t) ? `${(l[1] === 'on') === !!st.laser.on ? 'Yes' : 'No'}: the` : 'The'} laser is ${st.laser.on ? 'on' : 'off'}${closed ? ', with its shutter closed, so no beam reaches the table' : ` and its shutter is open: ${now}`}.`;
    if (/^(?:the\s+)?(?:laser'?s?\s+)?shutter\s+(?:is|was|seems)\s+(?:still\s+|already\s+|now\s+)?(?:open|opened|closed|shut)\b[^,;!?]*\.?$|^(?:i|we|someone|somebody)\s+(?:already\s+|just\s+)?(?:opened|closed|shut)\s+(?:the\s+)?shutter\b[^,;!?]*\.?$/.test(t)) // a statement about it
      return `The shutter is ${closed ? 'closed' : 'open'} here, and ${now}.${closed ? ' Pick a request below when you want it open.' : ''}`;
    if (r?.action === 'refuse' && r.via === 'opposite' && closed) return /\b(?:off|kill)\b|\b(?:turn|switch|shut|power)\s+(?:[a-z']+\s+){0,2}?off\b/.test(t)
      ? 'The shutter is already closed, so no beam reaches the table. The laser itself stays powered: this demo doesn\'t switch it off. Pick a request below when you want the beam.'
      : 'The shutter is already closed, so the beam is blocked. Pick a request below when you want it open.';
    return null;
  },

  build({ R, P, M, THREE, store, parts, speed = 1 }) {
    R.lights.sun.intensity = 0; R.lights.sun.castShadow = false; R.lights.hemi.intensity = 0.25; R.lights.fill.intensity = 0.15; R.scene.environmentIntensity = 0.25;
    R.scene.background = new THREE.Color(0x151A1E);
    const dark = new THREE.MeshStandardMaterial({ color: 0x6B7075, roughness: 0.95 });
    const floorMat = new THREE.MeshStandardMaterial({ map: parts.tex(parts.tileTex('#7C8286', '#6F7579'), [3, 3]), roughness: 0.6 });
    P.roomShell({ w: 6, d: 5, h: 3, floorMat, wallMat: dark, skirting: false });
    // overhead lights (dimmed, as in a laser lab): a downlight under each panel. Point lights 15 cm under the ceiling,
    // which takes no shadows, blew it out white around the panels; a wide spot aimed straight down (86° half-angle,
    // soft edge) lights the bench, the floor and the walls, fading toward the top of the walls, and never the ceiling.
    // shadow.focus narrows the shadow frustum to 64° off the axis (bench, floor, shelf, sign and back bench) for sharper
    // shadows of the small optics; beyond it the light is unshadowed.
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, emissive: 0xFFFFFF, emissiveIntensity: 0.6 }); const lampBoxes = [];
    for (const x of [-1.2, 1.2]) {
      const l = new THREE.SpotLight(0xE8F0FF, LAMP_I, 9, 1.5, 0.35, 1.6); l.position.set(x, 2.95, -0.4); l.target.position.set(x, 0, -0.4); R.scene.add(l.target);
      l.castShadow = true; l.shadow.mapSize.setScalar(R.quality === 'high' ? 2048 : 1024); l.shadow.focus = 0.75; l.shadow.bias = -0.0005; l.shadow.normalBias = 0.01; R.scene.add(l);
      lampBoxes.push(P.box(0.6, 0.03, 0.2, lampMat, x, 2.984, -0.4));
    }
    const lamps = P.group(...lampBoxes);

    // optical table: black breadboard on pneumatic legs
    const plateMat = new THREE.MeshStandardMaterial({ map: parts.tex(parts.holeGridTex(), [3, 1.5]), roughness: 0.55, metalness: 0.3 });
    const tableY = 0.9;
    const plateSide = new THREE.MeshStandardMaterial({ color: 0x2B2E31, roughness: 0.55, metalness: 0.3 }); // the hole grid is on the top only: squeezed onto the 20 cm edges it read as stripes
    P.box(2.6, 0.2, 1.3, [plateSide, plateSide, plateMat, plateSide, plateSide, plateSide], 0, tableY - 0.1, -0.2);
    for (const [x, z] of [[-1.1, -0.7], [1.1, -0.7], [-1.1, 0.3], [1.1, 0.3]]) { P.cyl(0.08, 0.08, 0.72, M.steel, x, 0.36, z, 20); P.cyl(0.11, 0.11, 0.1, M.black, x, 0.05, z, 20); }
    const Y = tableY + 0.1; // beam height

    // laser head
    const laserBody = P.box(0.32, 0.09, 0.09, M.anodized, -1.0, Y, 0.3, 0.008), laserMount = P.box(0.3, 0.036, 0.09, M.black, -1.0, Y - 0.0625, 0.3), laserRail = P.box(0.26, 0.02, 0.03, M.steel, -1.0, tableY + 0.01, 0.3); // body, mount (rail → body), rail
    const laserLed = P.box(0.04, 0.03, 0.03, M.led(0xE0563A), -1.12, Y + 0.02, 0.35); laserLed.material.emissiveIntensity = 0.8; // safety LED
    const shutter = P.box(0.01, 0.06, 0.06, M.steel, -0.83, Y, 0.3); // flag in front of the aperture; swings up toward +x (clear of the head, above the beam) when open
    const shutterPivot = new THREE.Group(); shutterPivot.position.set(-0.83, Y + 0.03, 0.3); R.scene.add(shutterPivot); R.scene.remove(shutter); shutter.position.set(0, -0.03, 0); shutterPivot.add(shutter);
    const hinge = P.box(0.014, 0.01, 0.05, M.black, -0.835, Y + 0.033, 0.3); // hinge block: laser face → flag pivot (x −0.842..−0.828, y 1.028..1.038), above the beam

    // mirror mounts (post + plate + round mirror), M1 folds +x → -z, M2 folds -z → -x
    function mirror(x, z, rotY) {
      const g = new THREE.Group(); g.position.set(x, Y, z); R.scene.add(g);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 16), M.steel); post.position.y = -0.05; post.castShadow = true; g.add(post);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.01, 20), M.black); base.position.y = -0.1; g.add(base);
      const tilt = new THREE.Group(); tilt.rotation.y = rotY; g.add(tilt);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.075, 0.075), M.anodized); plate.castShadow = true; tilt.add(plate);
      const mir = new THREE.Mesh(new THREE.CylinderGeometry(0.0254, 0.0254, 0.006, 32), new THREE.MeshStandardMaterial({ color: 0xF0F4F8, roughness: 0.05, metalness: 1 })); mir.rotation.z = Math.PI / 2; mir.position.x = 0.011; tilt.add(mir);
      for (const [dy, dz] of [[0.028, 0.028], [0.028, -0.028], [-0.028, 0.028]]) { const k = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.02, 12), M.steel); k.rotation.z = Math.PI / 2; k.position.set(-0.015, dy, dz); tilt.add(k); }
      return { group: g, tilt, plate, mir, rotY };
    }
    const m1 = mirror(0.7, 0.3, 3 * Math.PI / 4);       // beam +x arrives, leaves -z (mirror face toward -x -z)
    const m2 = mirror(0.7, -0.45, -3 * Math.PI / 4);    // beam -z arrives, leaves -x

    // The drawn beam. EX exaggerates the mirror angles so a 0.1° move is visible. The last leg runs from M2 (x 0.7,
    // z −0.45) to the meter head's +x face (HEAD_X); an M2 error of e degrees swings its end SPREAD·tan(2·e·EX) sideways:
    // 16 mm at the start (+0.120°), 23 mm at +0.170°, so every yaw the prompts use lands on the head's 60 mm face.
    // beamZ(yaw) is where that leg crosses the stage's plane (x = 0) with M1 aligned.
    const EX = 22, SPREAD = 0.174, HEAD_X = -0.722, RB = 0.004; // RB: beam radius
    const beamZ = (yaw) => -0.45 - (0.7 / (0.7 - HEAD_X)) * Math.tan(THREE.MathUtils.degToRad(2 * yaw * EX)) * SPREAD;

    // translation stage with an iris on it, in the M2 → meter leg
    // Stage X travels ACROSS the M2 → meter leg (along z), carrying the iris; the micrometer at the +z end pushes the
    // carriage toward -z as x grows, drawn at 4 mm per mm. At 12.4 mm the aperture is centred on the drawn beam at M2's
    // starting yaw (+0.120°), where iris() peaks; at 10 mm it sits 9.6 mm off it, so the beam's edge grazes the aperture
    // (RA, the ring's inner edge) while iris() passes 43%. Whatever part of the beam falls outside the aperture stops on
    // the ring (update), so a yaw that walks the beam further out (+0.170°) shows a thinner, clipped beam past the iris.
    const IRIS_Z = (x) => beamZ(0.12) - (x - 12.4) * 0.004, RA = 0.013;
    const STAGE_Z = (IRIS_Z(10) + IRIS_Z(12.4)) / 2; // the base sits under the carriage's whole travel
    const stageBase = P.box(0.1, 0.03, 0.16, M.anodized, 0.0, tableY + 0.015, STAGE_Z); const stageTop = P.box(0.09, 0.02, 0.12, M.steel, 0.0, tableY + 0.04, IRIS_Z(10));
    const micro = new THREE.Group(); micro.position.set(0.0, tableY + 0.015, STAGE_Z + 0.08 + 0.04); // barrel seated 1 cm into the base end, below the carriage
    micro.rotation.x = Math.PI / 2; R.scene.add(micro); // barrel axis along +z, thimble at the outer end
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.1, 12), M.steel); micro.add(barrel);
    const thimble = new THREE.Group(); thimble.position.y = 0.035; micro.add(thimble);
    const thimbleBody = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.03, 16), M.steel); thimbleBody.castShadow = true; thimble.add(thimbleBody);
    const tick = new THREE.Mesh(new THREE.BoxGeometry(0.0025, 0.03, 0.002), M.black); tick.position.z = 0.0092; thimble.add(tick); // turns as the stage moves
    const irisPost = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.032, 12), M.steel); irisPost.position.set(0, tableY + 0.066, IRIS_Z(10)); R.scene.add(irisPost); // stage top → bottom of the ring, clear of the aperture
    const irisRing = new THREE.Mesh(new THREE.TorusGeometry(RA + 0.005, 0.005, 10, 30), M.anodized); irisRing.rotation.y = Math.PI / 2; irisRing.position.set(0, Y, IRIS_Z(10)); R.scene.add(irisRing);

    // power meter head + readout box, beam camera + monitor
    const head = P.box(0.05, 0.06, 0.06, M.black, -0.75, Y, -0.45, 0.005), headPost = P.cyl(0.01, 0.01, 0.1, M.steel, -0.75, tableY + 0.05, -0.45, 12);
    const lightGrey = new THREE.MeshStandardMaterial({ color: 0xC4C9CC, roughness: 0.7 }); // for "white" things under the lamps: pure white glared and bloomed
    const meterBox = P.box(0.16, 0.08, 0.12, lightGrey, -1.0, tableY + 0.04, -0.15, 0.008);
    // the two screens each own one canvas + texture, redrawn in place (no new GPU texture per reading)
    const screenCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return { g: c.getContext('2d'), t, w, h }; };
    const mScr = screenCanvas(256, 96), pScr = screenCanvas(320, 200);
    const meterScreen = P.screenPlane(0.12, 0.045, mScr.t); meterScreen.position.set(-1.0, tableY + 0.05, -0.089); meterScreen.material.emissiveIntensity = 0.9;
    // Beam camera: a bare sensor facing a glass pickoff in the M2 → meter leg (after the iris), so it images the same
    // beam the meter reads. The pickoff face normal is (1, 0, -1)/√2: it sends a faint copy toward -z onto the sensor.
    const PKX = -0.3, PKZ = -0.458, SENSOR_Z = -0.578; // pickoff centre (mid-range of the leg at this x, yaw 0 … +0.170°), sensor face
    const pickoff = P.box(0.003, 0.04, 0.05, new THREE.MeshStandardMaterial({ color: 0xCFE6EE, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.4 }), PKX, Y, PKZ); pickoff.rotation.y = Math.PI / 4; pickoff.castShadow = false;
    const pkClamp = P.box(0.01, 0.01, 0.05, M.black, PKX, Y - 0.025, PKZ), pkPost = P.cyl(0.006, 0.006, 0.07, M.steel, PKX, tableY + 0.035, PKZ, 12); pkClamp.rotation.y = Math.PI / 4; // clamp under the plate, post
    const beamcamBody = P.box(0.06, 0.05, 0.08, M.black, PKX, Y, -0.62, 0.005), camPost = P.cyl(0.008, 0.008, 0.077, M.steel, PKX, tableY + 0.0385, -0.62, 12);
    const sensorWin = P.box(0.05, 0.04, 0.002, new THREE.MeshStandardMaterial({ color: 0x1A2A3A, roughness: 0.15, metalness: 0.6 }), PKX, Y, SENSOR_Z - 0.0015); // sensor window on the front face
    // monitor on a bench behind the table shows the beam profile
    P.box(1.6, 0.05, 0.6, M.woodLight, -1.4, 0.85, -2.1); P.box(0.05, 0.85, 0.55, M.steel, -2.1, 0.42, -2.1); P.box(0.05, 0.85, 0.55, M.steel, -0.7, 0.42, -2.1);
    const monitor = [P.box(0.55, 0.36, 0.03, M.black, -1.4, 1.12, -2.2, 0.01), P.box(0.12, 0.02, 0.16, M.black, -1.4, 0.885, -2.15), P.box(0.04, 0.065, 0.02, M.black, -1.4, 0.9275, -2.2)]; // panel, foot, neck
    const profile = P.screenPlane(0.5, 0.31, pScr.t); profile.position.set(-1.4, 1.12, -2.184);
    // hub, laptop, safety sign, shelf with boxes
    const hub = P.hub(1.05, tableY, 0.30, { rotY: -0.3 }); R.addPickable(hub.group, 'hub'); P.phone(1.18, tableY + 0.005, 0.06, 0.6);
    P.box(0.3, 0.012, 0.22, M.steel, -1.05, 0.88, -2.0); const lap = P.box(0.3, 0.2, 0.012, M.steel, -1.05, 0.98, -2.11); lap.rotation.x = -0.25;
    const lapScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.165), new THREE.MeshStandardMaterial({ color: 0x0E1318, roughness: 0.25, metalness: 0.2 })); lapScreen.position.set(0, 0.007, 0.0068); lap.add(lapScreen); // the lid's inner face is a dark (idle) display
    // laser warning sign, flat on the left wall: hazard triangle with the laser starburst, and the label text
    const signFace = (() => {
      const c = document.createElement('canvas'); c.width = 512; c.height = 352; const g = c.getContext('2d'); const ink = '#15171A', yel = '#E4B53A';
      g.fillStyle = yel; g.fillRect(0, 0, 512, 352); g.strokeStyle = ink; g.lineWidth = 10; g.strokeRect(16, 16, 480, 320);
      const tri = (cx, cy, r) => { g.beginPath(); for (let i = 0; i < 3; i++) { const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3; g.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a)); } g.closePath(); g.fill(); };
      g.fillStyle = ink; tri(126, 196, 104); g.fillStyle = yel; tri(126, 196, 76);
      g.strokeStyle = ink; g.lineCap = 'round'; g.lineWidth = 5; for (let i = 0; i < 16; i++) { const a = (i * Math.PI) / 8, r2 = i % 2 ? 24 : 32; g.beginPath(); g.moveTo(138 + 14 * Math.cos(a), 206 + 14 * Math.sin(a)); g.lineTo(138 + r2 * Math.cos(a), 206 + r2 * Math.sin(a)); g.stroke(); }
      g.fillStyle = ink; g.beginPath(); g.arc(138, 206, 10, 0, Math.PI * 2); g.fill(); g.lineWidth = 6; g.beginPath(); g.moveTo(128, 206); g.lineTo(78, 206); g.stroke(); // starburst, beam to the left
      const line = (t, y, px, max) => { let s = px; do { g.font = `700 ${s}px "Segoe UI", Inter, Arial, sans-serif`; s -= 2; } while (g.measureText(t).width > max && s > 10); g.fillText(t, 250, y); };
      g.fillStyle = ink; g.textBaseline = 'alphabetic'; line('LASER', 158, 88, 230); line('RADIATION', 222, 50, 230); line('AVOID DIRECT', 272, 26, 230); line('EYE EXPOSURE', 304, 26, 230);
      return parts.tex(c);
    })();
    const signPlate = P.box(0.02, 0.35, 0.5, M.yellow, -2.988, 1.8, -0.5);
    const signPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.33), new THREE.MeshStandardMaterial({ map: signFace, roughness: 0.6 })); signPlane.rotation.y = Math.PI / 2; signPlane.position.set(-2.9765, 1.8, -0.5); signPlane.receiveShadow = true; R.scene.add(signPlane);
    const sign = P.group(signPlate, signPlane);
    const shelfParts = [P.box(1.4, 0.03, 0.3, M.steel, 1.9, 1.7, -2.348)]; for (let i = 0; i < 4; i++) shelfParts.push(P.box(0.25, 0.18, 0.2, [M.cardboard, lightGrey, M.black, M.cardboard][i], 1.4 + i * 0.32, 1.805, -2.348, 0.01));
    const shelf = P.group(...shelfParts);
    // Wall-hung decor hides with its wall when the camera orbits outside it (renderer.js owns .visible of tagged parts).
    P.onWall(sign, 1, 0, -3); P.onWall(shelf, 0, 1, -2.5); lamps.userData.wall = { nx: 0, ny: -1, nz: 0, d: -3 }; // ceiling fixtures: visible while the camera is below the 3 m ceiling

    // beam segments (emissive cylinders), rebuilt each frame from the alignment state. The core stays under the bloom
    // threshold: a 1–2 px line just over it bloomed only where it covered whole pixels, which read as a string of beads
    // (desktop) or dashes (phones, no MSAA). The glow is geometry instead: an additive sleeve around each segment that
    // fades from the beam's axis to its edge (brightest where the sleeve faces the camera), a child of the segment so
    // place() and the iris clip scale it too. It also fades out toward a mirror or the pickoff (fade: metres at the start,
    // end; none within the last 45% of that): the sleeve is wider than the mirror plate is thick, and at 45° its end
    // would poke out of the back of the mount.
    const beamMat = new THREE.MeshStandardMaterial({ color: 0xFF2A2A, emissive: 0xFF2020, emissiveIntensity: 1.5, transparent: true, opacity: 0.9 });
    const lastMat = beamMat.clone(); // M2 → iris: dims with meter.bump (something taking power out of the last leg)
    const passMat = beamMat.clone(); // iris → meter: also dims with what the iris passes, iris(stage x), so it brightens as the log climbs
    const pickMat = beamMat.clone(); pickMat.opacity = 0.7; // the pickoff's copy: a few percent of the last leg
    const glowMat = (op, fade) => new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(0xFF2A2A) }, opacity: { value: op }, len: { value: 1 }, fade: { value: new THREE.Vector2(...fade) } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec3 vN; varying vec3 vV; varying float vY; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalMatrix * normal; vV = -mv.xyz; vY = position.y; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform vec3 color; uniform float opacity; uniform float len; uniform vec2 fade; varying vec3 vN; varying vec3 vV; varying float vY; void main() { float f = abs(dot(normalize(vN), normalize(vV))); f *= f; float a = fade.x > 0.0 ? smoothstep(0.45 * fade.x, fade.x, (vY + 0.5) * len) : 1.0; float b = fade.y > 0.0 ? smoothstep(0.45 * fade.y, fade.y, (0.5 - vY) * len) : 1.0; gl_FragColor = vec4(color * (opacity * f * f * a * b), 1.0); }',
    });
    const GLOW_R = 4.5, GLOW_OP = 0.5; // sleeve radius (× the beam's) and its brightness on the axis
    const seg = (mat, fade, r = RB, glow = 1) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 8), mat); R.scene.add(m);
      const g = new THREE.Mesh(new THREE.CylinderGeometry(r * GLOW_R, r * GLOW_R, 1, 20, 1, true), glowMat(GLOW_OP * glow, fade)); g.userData.noAO = true; g.userData.op = GLOW_OP * glow; m.add(g); m.userData.glow = g;
      return m;
    };
    const segs = [seg(beamMat, [0.01, 0.025]), seg(beamMat, [0.025, 0.025]), seg(lastMat, [0.025, 0]), seg(passMat, [0, 0.01]), seg(pickMat, [0.02, 0.005], 0.0022, 0.6)]; // laser → M1, M1 → M2, M2 → iris, iris → meter, pickoff copy
    const glowAt = (i, k) => { const g = segs[i].userData.glow; g.material.uniforms.opacity.value = g.userData.op * k; };
    const spot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 12), new THREE.MeshStandardMaterial({ color: 0xFF6060, emissive: 0xFF3030, emissiveIntensity: 6 })); R.scene.add(spot);
    const camSpot = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 10, 10), spot.material.clone()); R.scene.add(camSpot); // where the copy lands on the sensor
    const a = new THREE.Vector3(), b = new THREE.Vector3(), mid = new THREE.Vector3(), dir = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    function place(m, ax, ay, az, bx, by, bz, r = 1) { a.set(ax, ay, az); b.set(bx, by, bz); mid.addVectors(a, b).multiplyScalar(0.5); dir.subVectors(b, a); const len = dir.length(); m.position.copy(mid); m.scale.set(r, len, r); m.quaternion.setFromUnitVectors(up, dir.normalize()); m.userData.glow.material.uniforms.len.value = len; }
    place(segs[0], -0.838, Y, 0.3, 0.7, Y, 0.3); // laser face (x −0.84) → M1 never moves; starts 2 mm out, so its end isn't coplanar with the face
    let flagRot = 0, lastT = null; // the shutter flag's drawn angle, easing toward open (1.3 rad) or closed (0)

    // Both screens redraw only when what they show changes (numeric keys, so no strings are built per frame).
    let shownMeter = NaN, spotX = NaN, spotY = NaN, spotP = NaN;
    function drawMeter(offline, p) { const key = offline ? -2 : p < 1 ? -1 : Math.round(p); if (shownMeter === key) return; shownMeter = key; const text = offline ? '----' : fmtUW(p); const g = mScr.g; g.fillStyle = '#0B0F14'; g.fillRect(0, 0, 256, 96); g.fillStyle = '#7CF0D8'; g.font = '44px "Segoe UI", Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 48); mScr.t.needsUpdate = true; }
    function drawProfile(cx, cy, p, noImage) { const kx = Math.round(cx), ky = Math.round(cy), kp = noImage ? -1 : p > 1 ? 1 + Math.round(p / 50) : 0; if (kx === spotX && ky === spotY && kp === spotP) return; spotX = kx; spotY = ky; spotP = kp; const g = pScr.g; g.fillStyle = '#0A0D12'; g.fillRect(0, 0, 320, 200); g.strokeStyle = '#1F2A33'; for (let x = 0; x < 320; x += 20) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 200); g.stroke(); } for (let y = 0; y < 200; y += 20) { g.beginPath(); g.moveTo(0, y); g.lineTo(320, y); g.stroke(); } g.strokeStyle = '#3A4A56'; g.beginPath(); g.moveTo(160, 0); g.lineTo(160, 200); g.moveTo(0, 100); g.lineTo(320, 100); g.stroke(); if (p > 1 && !noImage) { const r = 10 + 22 * Math.min(1, p / PMAX); const gr = g.createRadialGradient(160 + cx, 100 + cy, 1, 160 + cx, 100 + cy, r); gr.addColorStop(0, '#FFFFFF'); gr.addColorStop(0.25, '#FF6A3D'); gr.addColorStop(1, 'rgba(120,20,20,0)'); g.fillStyle = gr; g.beginPath(); g.arc(160 + cx, 100 + cy, r, 0, Math.PI * 2); g.fill(); } g.fillStyle = '#7CF0D8'; g.font = '16px Inter, "Segoe UI", sans-serif'; g.fillText(noImage ? 'no image' : p > 1 ? `centroid ${cx.toFixed(0)}, ${cy.toFixed(0)} px` : 'no beam', 10, 188); pScr.t.needsUpdate = true; }

    // Rings and labels anchor on the first part registered for a device: the beam camera's sit on the camera body on
    // the table, also when the visitor taps the monitor on the back bench that shows its image; the meter's on its head.
    R.addPickable(laserBody, 'laser'); R.addPickable(shutterPivot, 'laser'); R.addPickable(m1.group, 'm1'); R.addPickable(m2.group, 'm2'); R.addPickable(stageBase, 'stage'); R.addPickable(stageTop, 'stage'); R.addPickable(head, 'meter'); R.addPickable(meterBox, 'meter'); R.addPickable(beamcamBody, 'beamcam'); R.addPickable(profile, 'beamcam');
    R.addPickable(micro, 'stage');
    // Every other visible part of a device answers a tap too (after the anchors above, so rings and labels stay put).
    for (const o of [laserMount, laserRail, laserLed, hinge]) R.addPickable(o, 'laser');
    R.addPickable(irisPost, 'stage'); R.addPickable(irisRing, 'stage'); R.addPickable(headPost, 'meter');
    for (const o of [pickoff, pkClamp, pkPost, camPost, sensorWin, ...monitor]) R.addPickable(o, 'beamcam');
    const HL = { laser: [laserBody], m1: [m1.plate], m2: [m2.plate], stage: [stageBase, stageTop, barrel, thimbleBody, irisPost, irisRing], meter: [head, meterBox], beamcam: [beamcamBody] }; // the meter pulses where its ring is (head) and its readout; the stage with the iris it carries
    const hi = P.highlighter(HL);
    // The pulse is cyan, except right after a device faults: main.js focuses it then, under a red ring and label, and
    // the pulse goes red with them. (The shells are the highlighter's children of each mesh; one material per device.)
    const shellMat = {}; for (const [id, ts] of Object.entries(HL)) for (const t of ts) t.traverse((o) => { if (o.userData.isShell && !shellMat[id]) shellMat[id] = o.material; });
    let faulted = null;
    const focus = (id, hex) => { const red = hex === 0xE0563A || faulted === id; faulted = null; hi.focus(id, hex); shellMat[id]?.color.setHex(red ? 0xE0563A : 0x29EEE5); };
    // A move step names the device it's about to move (see cue()): pulse it and ping it with the move, so the eye goes
    // where the tiny motion is (a 0.05° tilt or a 2 mm stage move is only a few pixels from the default view).
    store.subscribe((st, path, v) => {
      if (path === 'plan.cue' && v) { focus(v.id); R.ping(v.id, v.text, { hold: Math.max(1200, v.hold / (speed || 1)) }); }
      if (v === 'fault' && path.endsWith('.status')) faulted = path.slice(0, -7); // main.js's fault handler focuses it next
    });

    return {
      focus,
      update(s, t) {
        hi.update();
        hub.ledMat.emissiveIntensity = s.hub.status === 'on' ? (2.5 + Math.sin(t * 2.2) * 1.5) * s.hub.led : 0;
        const flagUp = s.laser.shutter === 'open' && !s.laser.stuck; // a stuck flag hangs in the beam whatever the driver says
        // The flag swings (about 0.25 s) instead of jumping. The drawn beam follows the drawn flag: below about 1.05 rad
        // (60°) the 6 cm flag still crosses the beam, 3 cm under its hinge. The meter reads the store, not the drawing.
        const tgt = flagUp ? 1.3 : 0, dt = lastT === null ? 1 : Math.min(0.25, Math.max(0, t - lastT)); lastT = t;
        flagRot += (tgt - flagRot) * (1 - Math.exp(-dt * 14)); if (Math.abs(tgt - flagRot) < 0.002) flagRot = tgt;
        shutterPivot.rotation.z = flagRot;
        // +yaw turns a mount clockwise seen from above, which is the way the drawn beam moves (hx toward +x, ez toward -z)
        m1.tilt.rotation.y = m1.rotY - THREE.MathUtils.degToRad(s.m1.yaw * EX); m1.tilt.rotation.z = THREE.MathUtils.degToRad(s.m1.pitch * EX);
        m2.tilt.rotation.y = m2.rotY - THREE.MathUtils.degToRad(s.m2.yaw * EX); m2.tilt.rotation.z = THREE.MathUtils.degToRad(s.m2.pitch * EX);
        const sz = IRIS_Z(s.stage.x); stageTop.position.z = sz; irisPost.position.z = sz; irisRing.position.z = sz; thimble.rotation.y = Math.PI + (s.stage.x - 10) * Math.PI * 4; // 0.5 mm pitch; tick on top at 10 mm
        const p = shown(s); const live = s.laser.on && flagRot > 1.05;
        // beam: laser → M1 → M2 → iris → meter head, with the M2 error steering the last leg (SPREAD). It ends on the
        // head's +x face: centred when aligned, off centre at the start (+0.120°), near the edge at +0.170°.
        const e2y = THREE.MathUtils.degToRad(s.m2.yaw * EX) * 2, e2p = THREE.MathUtils.degToRad(s.m2.pitch * EX) * 2, e1 = THREE.MathUtils.degToRad(s.m1.yaw * EX) * 2;
        const hx = 0.7 + Math.tan(e1) * 0.75; // where the beam meets M2 (z −0.45)
        const ey = Y + Math.tan(e2p) * SPREAD, ez = -0.45 - Math.tan(e2y) * SPREAD, dx = HEAD_X - hx, dy = ey - Y, dz = ez + 0.45; // end on the head, leg direction
        // Iris (x = 0): the part of the beam outside the aperture stops on the ring; what gets through goes on as the
        // largest disc inside the overlap of beam and aperture (radius rr, pulled toward the axis by cut), so no beam is
        // ever drawn through the metal. With the beam well inside the aperture nothing changes.
        const ti = -hx / dx, iy = Y + ti * dy, iz = -0.45 + ti * dz, oy = iy - Y, oz = iz - sz, on = Math.hypot(oy, oz);
        const rr = on + RB <= RA ? RB : Math.max(0, (RA - on + RB) / 2), cut = rr === RB ? 0 : (RA + on - RB) / 2 - on; // cut ≤ 0
        const cy = on ? (oy / on) * cut : 0, cz = on ? (oz / on) * cut : 0, py = iy + cy, pz = iz + cz, k2 = rr / RB;
        place(segs[1], 0.7, Y, 0.3, hx, Y, -0.45); place(segs[2], hx, Y, -0.45, 0, iy, iz); place(segs[3], 0, py, pz, HEAD_X, ey + cy, ez + cz, k2);
        // pickoff: where the passing beam crosses the plate (x − z = PKX − PKZ), and its reflection about (1, 0, -1)/√2, (dx, dy, dz) → (dz, dy, dx)
        const tp = (PKX - PKZ + pz) / (dx - dz), qx = tp * dx, qy = py + tp * dy, qz = pz + tp * dz, sk = (SENSOR_Z - qz) / dx; // dx < 0 and so is the copy's z step
        place(segs[4], qx, qy, qz, qx + dz * sk, qy + dy * sk, SENSOR_Z, k2); camSpot.position.set(qx + dz * sk, qy + dy * sk, SENSOR_Z); camSpot.scale.setScalar(k2);
        spot.position.set(HEAD_X, ey + cy, ez + cz); spot.scale.setScalar(k2);
        const through = live && rr > 0.0002; // something gets past the iris
        segs[0].visible = segs[1].visible = segs[2].visible = live; segs[3].visible = segs[4].visible = spot.visible = camSpot.visible = through;
        // Brightness: the laser's power (f), what reaches the last leg (k, meter.bump) and what the iris passes (kp): the
        // beam past the iris and its spots track the logged rise as the stage opens the iris (43% at 10 mm, 98% at 12 mm).
        const f = 0.4 + 0.6 * Math.min(1, s.laser.mW / 5), k = Math.max(0.35, Math.min(1, s.meter.bump)), kp = k * iris(s.stage.x);
        beamMat.emissiveIntensity = 1.5 * f; lastMat.emissiveIntensity = 1.5 * f * k; passMat.emissiveIntensity = 1.5 * f * kp; pickMat.emissiveIntensity = passMat.emissiveIntensity * 0.45;
        glowAt(0, f); glowAt(1, f); glowAt(2, f * k); glowAt(3, f * kp); glowAt(4, f * kp);
        spot.material.emissiveIntensity = 6 * (0.5 + 0.5 * kp); camSpot.material.emissiveIntensity = 3 * kp; // the head's spot keeps enough to glow
        drawMeter(s.meter.status === 'offline' || s.meter.status === 'fault', p); drawProfile(s.m2.yaw * 180, s.m2.pitch * 180, s.beamcam.status === 'offline' ? 0 : p, s.beamcam.status === 'fault');
      },
    };
  },

  prompts: [
    {
      chip: 'Open the shutter at 5.0 mW and hold. Confirm beam on the meter.',
      keywords: ['open', 'shutter', 'mw', 'hold', 'confirm', 'beam', 'laser', 'on', 'power'],
      rulesOut: ['increase', 'raise', 'reduce', 'decrease', 'lower', 'boost'], // power stays at 5.0 mW: "increase the laser power" is not this
      expect: { 'laser.shutter': 'closed', 'laser.status': 'fault' },
      steps: [
        { beat: 'plan' },
        { say: 'Exact instruction, so here it is back to you as steps. I\'ll verify each one against the meter and the beam camera, not just the device\'s own "ok".' },
        { status: 'Procedure ready · waiting for Execute' },
        { plan: { intro: 'Procedure:', approve: 'Execute', steps: [
          { text: 'Set the laser to 5.0 mW (it is at 5.0 mW now — no change)' },
          { text: 'Open the shutter' },
          { text: 'Verify: meter reads > 100 µW within 2 s and the beam camera sees a spot. If not, close the shutter and stop.' },
          { text: 'Hold and report every 30 s', alt: { text: 'Hold and report only on change', apply: [{ set: 'plan.quiet', to: true }] } },
        ] } },
        { beat: 'run' },
        { status: 'Step 1 · power' }, { say: 'Step 1 — power is already 5.0 mW, so no change. That\'s the driver\'s number, not a measurement yet.' },
        { set: 'laser.shutter', to: 'open', label: 'Step 2 · shutter → open' }, { wait: 700 },
        { status: 'Step 3 · verify on the meter and camera' }, { wait: 600 }, // the status line shows each step while it runs
        { fn: ({ chat, store }) => chat.ncb(`Step 2 — shutter open. Step 3 — meter ${fmtUW(shown(store.state))}, above the 100 µW check, and the camera sees a spot. Verified. Holding, and reporting ${store.get('plan.quiet') ? 'only on change' : 'every 30 s'}.`) },
        { status: 'Step 4 · hold' }, { wait: 1500 },
        { fn: ({ chat, store }) => { if (!store.get('plan.quiet')) chat.ncb(`00:30 — ${fmtUW(shown(store.state))}, spot steady.`); } }, { wait: 1200 },
        { beat: 'recover' },
        { set: 'laser.stuck', to: true }, // the flag drops back into the beam; the driver still says "open"
        { status: '01:00 · meter 0 µW, shutter still reports open' },
        { fn: ({ chat }) => chat.alert('01:00 — meter dropped to 0 µW and the camera lost the spot, but the shutter still reports "open".') }, { wait: 600 },
        { say: 'The device says one thing and the measurement says another. I trust the measurement. Closing the shutter and stopping — I won\'t hold a laser I can\'t see.' },
        { set: 'laser.shutter', to: 'closed', label: 'Shutter → closed (safe state)' }, { wait: 700 }, // the fault line replaces this status: let it show first
        { fail: 'laser' },
        { replan: { intro: 'Stopped in a safe state:', changes: ['Shutter commanded closed; driver reports closed, meter stays at 0 µW', 'Laser stays powered but blocked', 'Nothing else on the table was touched'], needsYou: 'The shutter flag may be sticking. Inspect it before the next run; I won\'t reopen it on my own.' } },
        { end: { headline: 'It checked, and it stopped.', body: 'A device reporting "open" isn\'t the same as a beam on the meter. NeuCharBox verified against the measurement, disagreed with the device, and put the bench in a safe state instead of guessing.' } },
      ],
    },
    {
      chip: 'Tilt M2 by +0.050° in yaw, then report the power meter.',
      keywords: ['tilt', 'm2', 'yaw', 'degrees', '0.05', 'report', 'meter', 'mirror', 'rotate', 'adjust'],
      expect: { 'm2.yaw': 0.12, 'laser.shutter': 'open' },
      steps: [
        { beat: 'plan' },
        { say: 'M2 yaw is at +0.120°. You\'re asking for +0.170°. I\'ll open the shutter first so there\'s something to measure.' },
        { status: 'Procedure ready · waiting for Execute' },
        { plan: { intro: 'Procedure:', approve: 'Execute', steps: [
          { text: 'Open the shutter and take a baseline meter reading' },
          { text: 'Move M2 yaw from +0.120° to +0.170° in one 0.050° step', alt: { text: 'Move M2 yaw in five 0.010° steps, reading the meter after each', apply: [{ set: 'plan.stepped', to: true }] } },
          { text: 'Report the meter before and after. Do not touch M1 or the stage.' },
        ] } },
        { beat: 'run' },
        { set: 'laser.shutter', to: 'open', label: 'Shutter → open' }, { wait: 800 },
        { fn: ({ chat, store }) => { store.set('plan.base', shown(store.state)); chat.ncb(`Baseline: ${fmtUW(store.get('plan.base'))} at M2 yaw +0.120°.`); } },
        // the Edit ("five 0.010° steps") takes 2.5 s, not 1.5 s: the label and the status line say so and last as long
        cue('m2', (st) => `Mirror M2 · yaw +0.120° → +0.170°${st.get('plan.stepped') ? ' · 5 steps' : ''}`, (st) => (st.get('plan.stepped') ? 2600 : 1500)),
        { status: (st) => (st.get('plan.stepped') ? 'M2 yaw → +0.170° in 0.010° steps' : 'M2 yaw → +0.170°') },
        { fn: async ({ store, chat, tween }) => { if (store.get('plan.stepped')) { for (let i = 1; i <= 5; i++) { await tween('m2.yaw', 0.12 + 0.01 * i, 500); chat.ncb(`Step ${i}/5 — yaw +${(0.12 + 0.01 * i).toFixed(3)}° · ${fmtUW(shown(store.state))}`); } } else { await tween('m2.yaw', 0.17, 1500); } } },
        { status: 'M2 yaw at +0.170°' },
        { beat: 'recover' },
        { fn: ({ chat, store }) => chat.alert(`Done: M2 yaw +0.170°, encoder confirms. Meter ${fmtUW(shown(store.state))}, down from ${fmtUW(store.get('plan.base'))}. The move took the beam further off the meter, not closer.`, '⚠ Worse than before') },
        { ask: { intro: 'I did exactly what you asked and the result is worse. I won\'t "fix" it without being told. What do you want?', options: [
          { label: 'Reverse it — back to +0.120°', primary: true, apply: [cue('m2', 'Mirror M2 · yaw +0.170° → +0.120°', 1200), { tween: 'm2.yaw', to: 0.12, ms: 1200, label: 'M2 yaw → +0.120°' }, { status: 'M2 yaw at +0.120°' }, { fn: ({ chat, store }) => chat.ncb(`Reversed. M2 yaw +0.120°, meter ${fmtUW(shown(store.state))}. Same as baseline.`) }] },
          { label: 'Keep it there', apply: [{ say: 'Kept at +0.170°. Logged as an intentional move.' }, { set: 'plan.keep', to: true }] },
          { label: 'Try −0.050° instead', apply: [cue('m2', 'Mirror M2 · yaw +0.170° → +0.070°'), { tween: 'm2.yaw', to: 0.07, ms: 1500, label: 'M2 yaw → +0.070°' }, { status: 'M2 yaw at +0.070°' }, { fn: ({ chat, store }) => chat.ncb(`M2 yaw +0.070°, meter ${fmtUW(shown(store.state))} — better than baseline. Stopping there; you didn't ask me to keep going.`) }, { set: 'plan.keep', to: true }] },
        ] } },
        { fn: ({ store }) => { if (store.get('plan.keep')) store.set('plan.expectYaw', store.get('m2.yaw')); } },
        { end: { headline: 'Exact moves, honest readouts.', body: 'In a lab, "do what I said" beats "do what you meant". NeuCharBox made the precise move, reported the measurement even though it was worse, and waited for you.' } },
      ],
    },
    {
      chip: 'Move stage X to 12.400 mm in 0.100 mm steps, logging the meter at each step.',
      keywords: ['move', 'stage', 'x', 'mm', '12.4', 'steps', 'step', 'logging', 'log', 'translation', 'position'],
      rulesOut: ['raise', 'raising', 'override', 'overriding', 'lift', 'ignore', 'ignoring', 'extend', 'remove', 'removing', 'past', 'beyond'], // it stops at the soft limit and asks: "…and raise the limit" is not this
      expect: { 'stage.x': 12.0, 'stage.moving': false },
      steps: [
        { beat: 'plan' },
        { say: 'Stage X is at 10.000 mm, soft limit 12.000 mm. 12.400 is past the limit — I\'ll go as far as the limit allows and stop there unless you raise it. I\'m not going to raise it myself.' },
        { status: 'Procedure ready · waiting for Execute' },
        { plan: { intro: 'Procedure:', approve: 'Execute', steps: [
          { text: 'Open the shutter so the meter has a beam to log' },
          { text: 'Move X from 10.000 to 12.400 mm in 0.100 mm steps (24 steps), settling 200 ms per step' },
          { text: 'Log the meter after every step' },
          { text: 'Stop at 12.000 mm and ask before going further; I don\'t go past the soft limit on my own' },
        ] } },
        { beat: 'run' },
        { set: 'laser.shutter', to: 'open', label: 'Shutter → open' }, { wait: 600 },
        cue('stage', 'Stage X · 10.000 → 12.000 mm', 6000), { set: 'stage.moving', to: true, label: 'Stage X → 12.000 mm in 0.100 mm steps' },
        { fn: async ({ store, chat, tween, sleep }) => { const lines = []; for (let i = 1; i <= 20; i++) { const x = Math.round((10 + i * 0.1) * 1000) / 1000; await tween('stage.x', x, 100); await sleep(200); lines.push(`${x.toFixed(3)} mm → ${fmtUW(shown(store.state))}`); if (i % 5 === 0) chat.ncb(lines.splice(0).join('\n')); } } },
        { set: 'stage.moving', to: false, label: 'Stage X stopped at the 12.000 mm limit' },
        { beat: 'recover' },
        { say: 'Stage is at 12.000 mm, the soft limit, so I stopped there as planned. 4 steps remain to reach 12.400.' },
        { ask: { intro: 'The limit exists for a reason I can\'t see from here. Your call:', options: [
          { label: 'Stop here at 12.000 mm', primary: true, apply: [{ say: 'Stopped at 12.000 mm. Log has 20 entries. Limit unchanged.' }] },
          { label: 'Raise the limit to 13.000 mm and continue', apply: [{ set: 'stage.limit', to: 13, label: 'Soft limit → 13.000 mm (by you)' }, { wait: 600 }, cue('stage', 'Stage X · 12.000 → 12.400 mm', 1200), { set: 'stage.moving', to: true, label: 'Stage X → 12.400 mm' }, { fn: async ({ store, chat, tween, sleep }) => { const lines = []; for (let i = 21; i <= 24; i++) { const x = Math.round((10 + i * 0.1) * 1000) / 1000; await tween('stage.x', x, 100); await sleep(200); lines.push(`${x.toFixed(3)} mm → ${fmtUW(shown(store.state))}`); } chat.ncb(lines.join('\n')); } }, { set: 'stage.moving', to: false, label: 'Stage X at 12.400 mm' }, { say: 'At 12.400 mm. Limit change is logged under your name, not mine.' }] },
          { label: 'Abort and return to 10.000 mm', apply: [cue('stage', 'Stage X · 12.000 → 10.000 mm'), { set: 'stage.moving', to: true }, { tween: 'stage.x', to: 10, ms: 1500, label: 'Stage X → 10.000 mm' }, { set: 'stage.moving', to: false, label: 'Stage X at 10.000 mm' }, { say: 'Back at 10.000 mm. Log kept.' }] },
        ] } },
        { fn: ({ store }) => { if (store.get('stage.x') !== 12.0) store.set('plan.moved', true); } },
        { end: { headline: 'It stopped at the limit and asked.', body: 'A soft limit is a decision someone made. NeuCharBox executed to the edge of it, logged every step, and handed the decision back to a person instead of overriding it.' } },
      ],
    },
    {
      chip: 'Walk M2 to maximise power on the meter. Stop if any step drops it by more than 20%.',
      keywords: ['walk', 'maximise', 'maximize', 'optimise', 'optimize', 'power', 'meter', 'm2', 'align', 'alignment', 'peak', 'stop', 'beam', 'max'],
      expect: { 'laser.shutter': 'closed', 'm2.yaw': 0, 'plan.closed': true }, // the default path takes the first (safe) option
      steps: [
        { beat: 'plan' },
        { say: 'A closed loop, with a stop rule. I\'ll step M2 yaw, read the meter after each step, keep going while it rises, and halt the instant a step costs more than 20%.' },
        { status: 'Procedure ready · waiting for Execute' },
        { plan: { intro: 'Procedure:', approve: 'Execute', steps: [
          { text: 'Open the shutter, baseline reading' },
          { text: 'Step M2 yaw by −0.020° at a time (it\'s currently +0.120° — the camera says the spot is right of centre)' },
          { text: 'After each step: read the meter. Continue while power rises. Stop on any drop > 20%, or when a step gains < 1%.' },
          { text: 'Do not touch M1 or the stage' },
        ] } },
        { beat: 'run' },
        { set: 'laser.shutter', to: 'open', label: 'Shutter → open' }, { wait: 600 },
        cue('m2', 'Mirror M2 · yaw in −0.020° steps', 2700), { status: 'M2 yaw · stepping −0.020° at a time' },
        { fn: async ({ store, chat, tween }) => { let last = readUW(store.state); chat.ncb(`Baseline ${last} µW.`); for (let i = 1; i <= 5; i++) { const y = 0.12 - 0.02 * i; await tween('m2.yaw', y, 450); const p = readUW(store.state); chat.ncb(`Step ${i}: yaw ${y >= 0 ? '+' : ''}${y.toFixed(3)}° → ${p} µW (${p >= last ? '+' : ''}${((p / last - 1) * 100).toFixed(0)}%)`); last = p; } } },
        { beat: 'recover' },
        // Step 6: halfway through the move something takes 45% out of the last leg (not before it: the chat has just
        // quoted step 5's reading, and the tile must not contradict it). The drop is computed, not quoted.
        { fn: async ({ store, chat, tween, sleep }) => { const before = readUW(store.state); await Promise.all([tween('m2.yaw', 0.0, 450), sleep(225).then(() => store.set('meter.bump', 0.55))]); const p = readUW(store.state); chat.alert(`Step 6: yaw +0.000° → ${p} µW, a ${((1 - p / before) * 100).toFixed(0)}% drop in one step. The camera still sees the spot near centre. Halting, as instructed.`); } },
        { status: 'Halted at M2 yaw +0.000°' },
        { say: 'The spot is where the step put it, but the power fell, so the drop isn\'t from alignment. Something moved on the table, or something crossed the beam. I\'m not going to keep optimising against a reading I don\'t trust.' },
        { ask: { intro: 'Halted at +0.000°. Options:', options: [
          { label: 'Close the shutter', primary: true, apply: [{ set: 'laser.shutter', to: 'closed', label: 'Shutter closed · M2 yaw kept at +0.000°' }, { say: 'Shutter closed. Position kept at +0.000° so you can resume from here.' }, { set: 'plan.closed', to: true }] },
          { label: 'Go back to the best step (+0.020°) and stop', apply: [cue('m2', 'Mirror M2 · yaw +0.000° → +0.020°', 900), { tween: 'm2.yaw', to: 0.02, ms: 900, label: 'M2 yaw → +0.020°' }, { set: 'meter.bump', to: 1 }, { status: 'M2 yaw at +0.020°' }, { fn: ({ chat, store }) => chat.ncb(`At +0.020°, meter ${fmtUW(shown(store.state))}, the same as step 5. Whatever took the power has cleared, but I can't see what it was. Holding here until you've checked the table.`) }] },
          { label: 'Hold here and let me look', apply: [{ say: 'Holding at +0.000°. Shutter stays open, nothing moves until you say.' }] },
        ] } },
        { end: { headline: 'A loop with a brake.', body: 'Closed-loop optimisation is only safe with a stop rule. NeuCharBox followed yours to the letter, halted on the first bad step, and told you why it didn\'t trust the number.' } },
      ],
    },
  ],
};
