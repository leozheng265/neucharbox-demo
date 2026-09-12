// Scene 2 — Laser lab (illustrative). Proves: exact instructions, executed and verified step by step.
// Alignment model (pure, derived from the store so the panel and the room agree):
//   meter µW = PMAX · gauss(M1 error) · gauss(M2 error) · iris(stage x) · laser mW / 5
// M2 starts 0.12° off in yaw, so the beam lands low on the meter until someone walks it in.
// laser.stuck is the room's truth, not a device report: the shutter flag has dropped back into the beam
// while the driver still says "open". meter.bump < 1 means something is taking power out of the last leg.

const PMAX = 860;             // µW on the meter with perfect alignment at 5 mW
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

export default {
  id: 'lab',
  title: 'Laser lab',
  startHour: 14,
  camera: { position: [1.9, 1.75, 2.4], target: [-0.1, 0.95, -0.2], minDistance: 1.0, maxDistance: 5, azimuth: [-0.5, 1.2], fitAspect: 1.3 },
  setupIntro: 'An optical bench — an illustrative setup, not a specific lab. The hub is at the end of the table. Plug it in to start.',
  askIntro: 'This room takes exact instructions. Give one, or pick one below. Every step is executed and then verified against the meter and the camera before I call it done.',
  deviceOrder: ['laser', 'm1', 'm2', 'stage', 'meter', 'beamcam'],
  devices: {
    laser:  { icon: 'laser', name: 'Laser · shutter', initial: { on: true, shutter: 'closed', mW: 5, stuck: false }, format: (s) => `${s.shutter} · ${s.mW.toFixed(1)} mW set`, faultText: 'closed · inspect flag' },
    m1:     { icon: 'mirror', name: 'Mirror M1', initial: { yaw: 0.0, pitch: 0.0 }, format: (s) => `yaw ${s.yaw >= 0 ? '+' : ''}${s.yaw.toFixed(3)}° · pitch ${s.pitch >= 0 ? '+' : ''}${s.pitch.toFixed(3)}°`, faultText: 'no response' },
    m2:     { icon: 'mirror', name: 'Mirror M2', initial: { yaw: 0.12, pitch: -0.02 }, format: (s) => `yaw ${s.yaw >= 0 ? '+' : ''}${s.yaw.toFixed(3)}° · pitch ${s.pitch >= 0 ? '+' : ''}${s.pitch.toFixed(3)}°`, faultText: 'no response' },
    stage:  { icon: 'stage', name: 'Stage X', initial: { x: 10.0, limit: 12.0, moving: false }, format: (s) => `${s.x.toFixed(3)} mm · ${s.moving ? 'moving' : s.x >= s.limit - 0.0005 ? 'at limit' : `limit ${s.limit.toFixed(3)}`}`, faultText: 'no response' },
    meter:  { icon: 'meter', name: 'Power meter', initial: { bump: 1 }, format: (s, st) => fmtUW(shown(st)), faultText: 'no reading' },
    beamcam:{ icon: 'beamcam', name: 'Beam camera', initial: {}, format: (s, st) => (shown(st) > 1 ? `spot at (${(st.m2.yaw * 180).toFixed(0)}, ${(st.m2.pitch * 180).toFixed(0)}) px` : 'no beam'), faultText: 'no image' },
  },

  build({ R, P, M, THREE, store, parts }) {
    R.lights.sun.intensity = 0; R.lights.sun.castShadow = false; R.lights.hemi.intensity = 0.25; R.lights.fill.intensity = 0.15; R.scene.environmentIntensity = 0.25;
    R.scene.background = new THREE.Color(0x151A1E);
    const dark = new THREE.MeshStandardMaterial({ color: 0x6B7075, roughness: 0.95 });
    const floorMat = new THREE.MeshStandardMaterial({ map: parts.tex(parts.tileTex('#7C8286', '#6F7579'), [3, 3]), roughness: 0.6 });
    P.roomShell({ w: 6, d: 5, h: 3, floorMat, wallMat: dark, skirting: false });
    // overhead lights (dimmed, as in a laser lab)
    for (const x of [-1.2, 1.2]) { const l = new THREE.PointLight(0xE8F0FF, 6, 9, 1.6); l.position.set(x, 2.85, -0.4); l.castShadow = true; l.shadow.mapSize.set(512, 512); l.shadow.bias = -0.002; R.scene.add(l); P.box(0.6, 0.03, 0.2, M.white, x, 2.984, -0.4).material = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, emissive: 0xFFFFFF, emissiveIntensity: 0.6 }); }

    // optical table: black breadboard on pneumatic legs
    const plateMat = new THREE.MeshStandardMaterial({ map: parts.tex(parts.holeGridTex(), [3, 1.5]), roughness: 0.55, metalness: 0.3 });
    const tableY = 0.9;
    P.box(2.6, 0.2, 1.3, plateMat, 0, tableY - 0.1, -0.2);
    for (const [x, z] of [[-1.1, -0.7], [1.1, -0.7], [-1.1, 0.3], [1.1, 0.3]]) { P.cyl(0.08, 0.08, 0.72, M.steel, x, 0.36, z, 20); P.cyl(0.11, 0.11, 0.1, M.black, x, 0.05, z, 20); }
    const Y = tableY + 0.1; // beam height

    // laser head
    const laserBody = P.box(0.32, 0.09, 0.09, M.anodized, -1.0, Y, 0.3, 0.008); P.box(0.3, 0.036, 0.09, M.black, -1.0, Y - 0.0625, 0.3); P.box(0.26, 0.02, 0.03, M.steel, -1.0, tableY + 0.01, 0.3); // body, mount (rail → body), rail
    P.box(0.04, 0.03, 0.03, M.led(0xE0563A), -1.12, Y + 0.02, 0.35).material.emissiveIntensity = 0.8; // safety LED
    const shutter = P.box(0.01, 0.06, 0.06, M.steel, -0.83, Y, 0.3); // flag in front of the aperture; swings up toward +x (clear of the head, above the beam) when open
    const shutterPivot = new THREE.Group(); shutterPivot.position.set(-0.83, Y + 0.03, 0.3); R.scene.add(shutterPivot); R.scene.remove(shutter); shutter.position.set(0, -0.03, 0); shutterPivot.add(shutter);
    P.box(0.014, 0.01, 0.05, M.black, -0.835, Y + 0.033, 0.3); // hinge block: laser face → flag pivot (x −0.842..−0.828, y 1.028..1.038), above the beam

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
    const m1 = mirror(0.7, 0.3, -Math.PI / 4);          // beam +x arrives, leaves -z
    const m2 = mirror(0.7, -0.45, -3 * Math.PI / 4);    // beam -z arrives, leaves -x

    // translation stage with an iris on it, in the M2 → meter leg
    const stageBase = P.box(0.16, 0.03, 0.1, M.anodized, 0.0, tableY + 0.015, -0.45); const stageTop = P.box(0.12, 0.02, 0.09, M.steel, 0.0, tableY + 0.04, -0.45);
    P.cyl(0.006, 0.006, 0.1, M.steel, 0.1, tableY + 0.035, -0.45, 10).rotation.z = Math.PI / 2; // micrometer
    const irisPost = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.032, 12), M.steel); irisPost.position.set(0, tableY + 0.066, -0.45); R.scene.add(irisPost); // stage top → bottom of the ring, clear of the aperture
    const irisRing = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.005, 10, 30), M.anodized); irisRing.rotation.y = Math.PI / 2; irisRing.position.set(0, Y, -0.45); R.scene.add(irisRing);

    // power meter head + readout box, beam camera + monitor
    const head = P.box(0.05, 0.06, 0.06, M.black, -0.75, Y, -0.45, 0.005); P.cyl(0.01, 0.01, 0.1, M.steel, -0.75, tableY + 0.05, -0.45, 12);
    const meterBox = P.box(0.16, 0.08, 0.12, M.white, -1.0, tableY + 0.04, -0.15, 0.008);
    // the two screens each own one canvas + texture, redrawn in place (no new GPU texture per reading)
    const screenCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return { g: c.getContext('2d'), t, w, h }; };
    const mScr = screenCanvas(256, 96), pScr = screenCanvas(320, 200);
    const meterScreen = P.screenPlane(0.12, 0.045, mScr.t); meterScreen.position.set(-1.0, tableY + 0.05, -0.089); meterScreen.material.emissiveIntensity = 0.9;
    const beamcamBody = P.box(0.05, 0.05, 0.08, M.black, -0.75, Y, -0.62, 0.005); P.cyl(0.008, 0.008, 0.077, M.steel, -0.75, tableY + 0.0385, -0.62, 12);
    // monitor on a bench behind the table shows the beam profile
    P.box(1.6, 0.05, 0.6, M.woodLight, -1.4, 0.85, -2.1); P.box(0.05, 0.85, 0.55, M.steel, -2.1, 0.42, -2.1); P.box(0.05, 0.85, 0.55, M.steel, -0.7, 0.42, -2.1);
    P.box(0.55, 0.36, 0.03, M.black, -1.4, 1.12, -2.2, 0.01); P.box(0.12, 0.02, 0.16, M.black, -1.4, 0.885, -2.15); P.box(0.04, 0.065, 0.02, M.black, -1.4, 0.9275, -2.2); // panel, foot, neck
    const profile = P.screenPlane(0.5, 0.31, pScr.t); profile.position.set(-1.4, 1.12, -2.184);
    // hub, laptop, safety sign, shelf with boxes
    const hub = P.hub(1.05, tableY, 0.30, { rotY: -0.3 }); R.addPickable(hub.group, 'hub'); P.phone(1.18, tableY + 0.005, 0.06, 0.6);
    P.box(0.3, 0.012, 0.22, M.steel, -1.05, 0.88, -2.0); const lap = P.box(0.3, 0.2, 0.012, M.steel, -1.05, 0.98, -2.11); lap.rotation.x = -0.25;
    P.box(0.02, 0.35, 0.5, M.yellow, -2.988, 1.8, -0.5); P.box(0.005, 0.22, 0.36, M.black, -2.975, 1.8, -0.5); // laser warning sign, flat on the left wall
    P.box(1.4, 0.03, 0.3, M.steel, 1.9, 1.7, -2.348); for (let i = 0; i < 4; i++) P.box(0.25, 0.18, 0.2, [M.cardboard, M.white, M.black, M.cardboard][i], 1.4 + i * 0.32, 1.805, -2.348, 0.01);

    // beam segments (emissive cylinders), rebuilt each frame from the alignment state
    const beamMat = new THREE.MeshStandardMaterial({ color: 0xFF2A2A, emissive: 0xFF2020, emissiveIntensity: 4, transparent: true, opacity: 0.9 });
    const lastMat = beamMat.clone(); // M2 → meter leg dims with the power that actually reaches the meter
    const seg = (mat) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 1, 8), mat); R.scene.add(m); return m; };
    const segs = [seg(beamMat), seg(beamMat), seg(lastMat)];
    const spot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 12), new THREE.MeshStandardMaterial({ color: 0xFF6060, emissive: 0xFF3030, emissiveIntensity: 6 })); R.scene.add(spot);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), mid = new THREE.Vector3(), dir = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    function place(m, ax, ay, az, bx, by, bz) { a.set(ax, ay, az); b.set(bx, by, bz); mid.addVectors(a, b).multiplyScalar(0.5); dir.subVectors(b, a); const len = dir.length(); m.position.copy(mid); m.scale.set(1, len, 1); m.quaternion.setFromUnitVectors(up, dir.normalize()); }
    place(segs[0], -0.84, Y, 0.3, 0.7, Y, 0.3); // laser face → M1 never moves

    // Both screens redraw only when what they show changes (numeric keys, so no strings are built per frame).
    let shownMeter = NaN, spotX = NaN, spotY = NaN, spotP = NaN;
    function drawMeter(offline, p) { const key = offline ? -2 : p < 1 ? -1 : Math.round(p); if (shownMeter === key) return; shownMeter = key; const text = offline ? '----' : fmtUW(p); const g = mScr.g; g.fillStyle = '#0B0F14'; g.fillRect(0, 0, 256, 96); g.fillStyle = '#7CF0D8'; g.font = '44px "Segoe UI", Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 48); mScr.t.needsUpdate = true; }
    function drawProfile(cx, cy, p) { const kx = Math.round(cx), ky = Math.round(cy), kp = p > 1 ? 1 + Math.round(p / 50) : 0; if (kx === spotX && ky === spotY && kp === spotP) return; spotX = kx; spotY = ky; spotP = kp; const g = pScr.g; g.fillStyle = '#0A0D12'; g.fillRect(0, 0, 320, 200); g.strokeStyle = '#1F2A33'; for (let x = 0; x < 320; x += 20) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 200); g.stroke(); } for (let y = 0; y < 200; y += 20) { g.beginPath(); g.moveTo(0, y); g.lineTo(320, y); g.stroke(); } g.strokeStyle = '#3A4A56'; g.beginPath(); g.moveTo(160, 0); g.lineTo(160, 200); g.moveTo(0, 100); g.lineTo(320, 100); g.stroke(); if (p > 1) { const r = 10 + 22 * Math.min(1, p / PMAX); const gr = g.createRadialGradient(160 + cx, 100 + cy, 1, 160 + cx, 100 + cy, r); gr.addColorStop(0, '#FFFFFF'); gr.addColorStop(0.25, '#FF6A3D'); gr.addColorStop(1, 'rgba(120,20,20,0)'); g.fillStyle = gr; g.beginPath(); g.arc(160 + cx, 100 + cy, r, 0, Math.PI * 2); g.fill(); } g.fillStyle = '#7CF0D8'; g.font = '16px Inter, "Segoe UI", sans-serif'; g.fillText(p > 1 ? `centroid ${cx.toFixed(0)}, ${cy.toFixed(0)} px` : 'no beam', 10, 188); pScr.t.needsUpdate = true; }

    // The monitor is not registered for 'beamcam': pings anchor on the union of a device's pickables, and the
    // camera body (table) plus the monitor (back bench) would put the ring over the empty floor between them.
    R.addPickable(laserBody, 'laser'); R.addPickable(shutterPivot, 'laser'); R.addPickable(m1.group, 'm1'); R.addPickable(m2.group, 'm2'); R.addPickable(stageBase, 'stage'); R.addPickable(stageTop, 'stage'); R.addPickable(head, 'meter'); R.addPickable(meterBox, 'meter'); R.addPickable(beamcamBody, 'beamcam'); R.addPickable(profile, 'beamcam');
    const hi = P.highlighter({ laser: [laserBody], m1: [m1.plate], m2: [m2.plate], stage: [stageBase], meter: [meterBox], beamcam: [beamcamBody] });
    const EX = 22; // visual exaggeration of mirror angles so a 0.1° move is visible

    return {
      focus: hi.focus,
      update(s, t) {
        hi.update();
        hub.ledMat.emissiveIntensity = s.hub.status === 'on' ? (2.5 + Math.sin(t * 2.2) * 1.5) * s.hub.led : 0;
        const flagUp = s.laser.shutter === 'open' && !s.laser.stuck; // a stuck flag hangs in the beam whatever the driver says
        shutterPivot.rotation.z = flagUp ? 1.3 : 0;
        m1.tilt.rotation.y = m1.rotY + THREE.MathUtils.degToRad(s.m1.yaw * EX); m1.tilt.rotation.z = THREE.MathUtils.degToRad(s.m1.pitch * EX);
        m2.tilt.rotation.y = m2.rotY + THREE.MathUtils.degToRad(s.m2.yaw * EX); m2.tilt.rotation.z = THREE.MathUtils.degToRad(s.m2.pitch * EX);
        const sx = (s.stage.x - 10) * 0.012; stageTop.position.x = sx; irisPost.position.x = sx; irisRing.position.x = sx;
        const p = shown(s); const live = s.laser.on && flagUp;
        // beam: laser → M1 → M2 → meter head, with the M2 error steering the last leg. It ends on the head's +x face
        // (x −0.725): centred when aligned, on the edge at the start (+0.120°), just off it at +0.170°.
        const e2y = THREE.MathUtils.degToRad(s.m2.yaw * EX) * 2, e2p = THREE.MathUtils.degToRad(s.m2.pitch * EX) * 2, e1 = THREE.MathUtils.degToRad(s.m1.yaw * EX) * 2;
        const L3 = 1.45;
        const hx = 0.7 + Math.tan(e1) * 0.75; // where the beam meets M2 (z −0.45)
        const ex = -0.722, ey = Y + Math.tan(e2p) * L3 * 0.2, ez = -0.45 - Math.tan(e2y) * L3 * 0.2;
        place(segs[1], 0.7, Y, 0.3, hx, Y, -0.45); place(segs[2], hx, Y, -0.45, ex, ey, ez);
        segs[0].visible = segs[1].visible = segs[2].visible = spot.visible = live; spot.position.set(ex, ey, ez);
        const k = Math.max(0.35, Math.min(1, s.meter.bump)); // power reaching the meter
        beamMat.emissiveIntensity = 2 + 3 * Math.min(1, s.laser.mW / 5); lastMat.emissiveIntensity = beamMat.emissiveIntensity * k; spot.material.emissiveIntensity = 6 * k;
        drawMeter(s.meter.status === 'offline', p); drawProfile(s.m2.yaw * 180, s.m2.pitch * 180, s.beamcam.status === 'offline' ? 0 : p);
      },
    };
  },

  prompts: [
    {
      chip: 'Open the shutter at 5.0 mW and hold. Confirm beam on the meter.',
      keywords: ['open', 'shutter', 'mw', 'hold', 'confirm', 'beam', 'laser', 'on', 'power'],
      expect: { 'laser.shutter': 'closed', 'laser.status': 'fault' },
      steps: [
        { beat: 'plan' },
        { say: 'Exact instruction, so here it is back to you as steps. I\'ll verify each one against the meter and the beam camera, not just the device\'s own "ok".' },
        { plan: { intro: 'Procedure:', approve: 'Execute', steps: [
          { text: 'Set laser power to 5.0 mW (currently 5.0 mW — no change)' },
          { text: 'Open the shutter' },
          { text: 'Verify: meter reads > 100 µW within 2 s and the beam camera sees a spot. If not, close the shutter and stop.' },
          { text: 'Hold and report every 30 s', alt: { text: 'Hold and report only on change', apply: [{ set: 'plan.quiet', to: true }] } },
        ] } },
        { beat: 'run' },
        { status: 'Step 1 · power' }, { say: 'Step 1 — power is already 5.0 mW, so no change. That\'s the driver\'s number, not a measurement yet.' },
        { status: 'Step 2 · shutter' }, { set: 'laser.shutter', to: 'open', label: 'Shutter → open' }, { wait: 900 },
        { status: 'Step 3 · verify' },
        { fn: ({ chat, store }) => chat.ncb(`Step 2 — shutter open. Step 3 — meter ${fmtUW(shown(store.state))}, above the 100 µW check, and the camera sees a spot. Verified. Holding, and reporting ${store.get('plan.quiet') ? 'only on change' : 'every 30 s'}.`) },
        { status: 'Step 4 · hold' }, { wait: 1500 },
        { fn: ({ chat, store }) => { if (!store.get('plan.quiet')) chat.ncb(`00:30 — ${fmtUW(shown(store.state))}, spot steady.`); } }, { wait: 1200 },
        { beat: 'recover' },
        { set: 'laser.stuck', to: true }, // the flag drops back into the beam; the driver still says "open"
        { fn: ({ chat }) => chat.alert('01:00 — meter dropped to 0 µW and the camera lost the spot, but the shutter still reports "open".') }, { wait: 600 },
        { say: 'The device says one thing and the measurement says another. I trust the measurement. Closing the shutter and stopping — I won\'t hold a laser I can\'t see.' },
        { set: 'laser.shutter', to: 'closed', label: 'Shutter → closed (safe state)' },
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
        { plan: { intro: 'Procedure:', approve: 'Execute', steps: [
          { text: 'Open the shutter and take a baseline meter reading' },
          { text: 'Move M2 yaw from +0.120° to +0.170° in one 0.050° step', alt: { text: 'Move M2 yaw in five 0.010° steps, reading the meter after each', apply: [{ set: 'plan.stepped', to: true }] } },
          { text: 'Report the meter before and after. Do not touch M1 or the stage.' },
        ] } },
        { beat: 'run' },
        { set: 'laser.shutter', to: 'open', label: 'Shutter → open' }, { wait: 800 },
        { fn: ({ chat, store }) => { store.set('plan.base', shown(store.state)); chat.ncb(`Baseline: ${fmtUW(store.get('plan.base'))} at M2 yaw +0.120°.`); } },
        { status: 'M2 yaw → +0.170°' },
        { fn: async ({ store, chat, tween }) => { if (store.get('plan.stepped')) { for (let i = 1; i <= 5; i++) { await tween('m2.yaw', 0.12 + 0.01 * i, 500); chat.ncb(`Step ${i}/5 — yaw +${(0.12 + 0.01 * i).toFixed(3)}° · ${fmtUW(shown(store.state))}`); } } else { await tween('m2.yaw', 0.17, 1500); } } },
        { beat: 'recover' },
        { fn: ({ chat, store }) => chat.alert(`Done: M2 yaw +0.170°, encoder confirms. Meter ${fmtUW(shown(store.state))}, down from ${fmtUW(store.get('plan.base'))}. The move took the beam further off the meter, not closer.`) },
        { ask: { intro: 'I did exactly what you asked and the result is worse. I won\'t "fix" it without being told. What do you want?', options: [
          { label: 'Reverse it — back to +0.120°', apply: [{ tween: 'm2.yaw', to: 0.12, ms: 1200, label: 'M2 yaw → +0.120°' }, { fn: ({ chat, store }) => chat.ncb(`Reversed. M2 yaw +0.120°, meter ${fmtUW(shown(store.state))}. Same as baseline.`) }] },
          { label: 'Keep it there', apply: [{ say: 'Kept at +0.170°. Logged as an intentional move.' }, { set: 'plan.keep', to: true }] },
          { label: 'Try −0.050° instead', apply: [{ tween: 'm2.yaw', to: 0.07, ms: 1500, label: 'M2 yaw → +0.070°' }, { fn: ({ chat, store }) => chat.ncb(`M2 yaw +0.070°, meter ${fmtUW(shown(store.state))} — better than baseline. Stopping there; you didn't ask me to keep going.`) }, { set: 'plan.keep', to: true }] },
        ] } },
        { fn: ({ store }) => { if (store.get('plan.keep')) store.set('plan.expectYaw', store.get('m2.yaw')); } },
        { end: { headline: 'Exact moves, honest readouts.', body: 'In a lab, "do what I said" beats "do what you meant". NeuCharBox made the precise move, reported the measurement even though it was worse, and waited for you.' } },
      ],
    },
    {
      chip: 'Move stage X to 12.400 mm in 0.100 mm steps, logging the meter at each step.',
      keywords: ['move', 'stage', 'x', 'mm', '12.4', 'steps', 'step', 'logging', 'log', 'translation', 'position'],
      expect: { 'stage.x': 12.0, 'stage.moving': false },
      steps: [
        { beat: 'plan' },
        { say: 'Stage X is at 10.000 mm, soft limit 12.000 mm. 12.400 is past the limit — I\'ll go as far as the limit allows and stop there unless you raise it. I\'m not going to raise it myself.' },
        { plan: { intro: 'Procedure:', approve: 'Execute', steps: [
          { text: 'Open the shutter so the meter has a beam to log' },
          { text: 'Move X from 10.000 to 12.400 mm in 0.100 mm steps (24 steps), settling 200 ms per step' },
          { text: 'Log the meter after every step' },
          { text: 'Stop at the soft limit (12.000 mm) and ask before going further' },
        ] } },
        { beat: 'run' },
        { set: 'laser.shutter', to: 'open', label: 'Shutter → open' }, { wait: 600 },
        { set: 'stage.moving', to: true, label: 'Stage X → 12.000 mm in 0.100 mm steps' },
        { fn: async ({ store, chat, tween, sleep }) => { const lines = []; for (let i = 1; i <= 20; i++) { const x = Math.round((10 + i * 0.1) * 1000) / 1000; await tween('stage.x', x, 100); await sleep(200); lines.push(`${x.toFixed(3)} mm → ${fmtUW(shown(store.state))}`); if (i % 5 === 0) chat.ncb(lines.splice(0).join('\n')); } } },
        { set: 'stage.moving', to: false, label: 'Stage X stopped at the 12.000 mm limit' },
        { beat: 'recover' },
        { say: 'Stage is at 12.000 mm, the soft limit, so I stopped there as planned. 4 steps remain to reach 12.400.' },
        { ask: { intro: 'The limit exists for a reason I can\'t see from here. Your call:', options: [
          { label: 'Stop here at 12.000 mm', apply: [{ say: 'Stopped at 12.000 mm. Log has 20 entries. Limit unchanged.' }] },
          { label: 'Raise the limit to 13.000 mm and continue', apply: [{ set: 'stage.limit', to: 13, label: 'Soft limit → 13.000 mm (by you)' }, { wait: 600 }, { set: 'stage.moving', to: true, label: 'Stage X → 12.400 mm' }, { fn: async ({ store, chat, tween, sleep }) => { const lines = []; for (let i = 21; i <= 24; i++) { const x = Math.round((10 + i * 0.1) * 1000) / 1000; await tween('stage.x', x, 100); await sleep(200); lines.push(`${x.toFixed(3)} mm → ${fmtUW(shown(store.state))}`); } chat.ncb(lines.join('\n')); } }, { set: 'stage.moving', to: false }, { say: 'At 12.400 mm. Limit change is logged under your name, not mine.' }] },
          { label: 'Abort and return to 10.000 mm', apply: [{ set: 'stage.moving', to: true }, { tween: 'stage.x', to: 10, ms: 1500, label: 'Stage X → 10.000 mm' }, { set: 'stage.moving', to: false }, { say: 'Back at 10.000 mm. Log kept.' }] },
        ] } },
        { fn: ({ store }) => { if (store.get('stage.x') !== 12.0) store.set('plan.moved', true); } },
        { end: { headline: 'It stopped at the limit and asked.', body: 'A soft limit is a decision someone made. NeuCharBox executed to the edge of it, logged every step, and handed the decision back to a person instead of overriding it.' } },
      ],
    },
    {
      chip: 'Walk M2 to maximise power on the meter. Stop if any step drops it by more than 20%.',
      keywords: ['walk', 'maximise', 'maximize', 'optimise', 'optimize', 'power', 'meter', 'm2', 'align', 'alignment', 'peak', 'stop'],
      expect: { 'laser.shutter': 'open', 'm2.yaw': 0.02, 'meter.bump': 1 },
      steps: [
        { beat: 'plan' },
        { say: 'A closed loop, with a stop rule. I\'ll step M2 yaw, read the meter after each step, keep going while it rises, and halt the instant a step costs more than 20%.' },
        { plan: { intro: 'Procedure:', approve: 'Execute', steps: [
          { text: 'Open the shutter, baseline reading' },
          { text: 'Step M2 yaw by −0.020° at a time (it\'s currently +0.120° — the camera says the spot is right of centre)' },
          { text: 'After each step: read the meter. Continue while power rises. Stop on any drop > 20%, or when a step gains < 1%.' },
          { text: 'Do not touch M1 or the stage' },
        ] } },
        { beat: 'run' },
        { set: 'laser.shutter', to: 'open', label: 'Shutter → open' }, { wait: 600 },
        { status: 'M2 yaw · stepping −0.020° at a time' },
        { fn: async ({ store, chat, tween }) => { let last = shown(store.state); chat.ncb(`Baseline ${fmtUW(last)}.`); for (let i = 1; i <= 5; i++) { const y = 0.12 - 0.02 * i; await tween('m2.yaw', y, 450); const p = shown(store.state); chat.ncb(`Step ${i}: yaw ${y >= 0 ? '+' : ''}${y.toFixed(3)}° → ${fmtUW(p)} (${p >= last ? '+' : ''}${((p / last - 1) * 100).toFixed(0)}%)`); last = p; } } },
        { beat: 'recover' },
        // Step 6: something takes 45% out of the last leg during the move. The drop is computed, not quoted.
        { fn: async ({ store, chat, tween }) => { const before = shown(store.state); store.set('meter.bump', 0.55); await tween('m2.yaw', 0.0, 450); const p = shown(store.state); chat.alert(`Step 6: yaw +0.000° → ${fmtUW(p)}, a ${((1 - p / before) * 100).toFixed(0)}% drop in one step. The camera still sees the spot near centre. Halting, as instructed.`); } },
        { status: 'Halted at M2 yaw +0.000°' },
        { say: 'The spot is where the step put it, but the power fell, so the drop isn\'t from alignment. Something moved on the table, or something crossed the beam. I\'m not going to keep optimising against a reading I don\'t trust.' },
        { ask: { intro: 'Halted at +0.000°. Options:', options: [
          { label: 'Go back to the best step (+0.020°) and stop', apply: [{ tween: 'm2.yaw', to: 0.02, ms: 900, label: 'M2 yaw → +0.020°' }, { set: 'meter.bump', to: 1 }, { fn: ({ chat, store }) => chat.ncb(`At +0.020°, meter ${fmtUW(shown(store.state))}, the same as step 5. Whatever took the power has cleared, but I can't see what it was. Holding here until you've checked the table.`) }] },
          { label: 'Hold here and let me look', apply: [{ say: 'Holding at +0.000°. Shutter stays open, nothing moves until you say.' }] },
          { label: 'Close the shutter', apply: [{ set: 'laser.shutter', to: 'closed', label: 'Shutter → closed' }, { say: 'Shutter closed. Position kept at +0.000° so you can resume from here.' }, { set: 'plan.closed', to: true }] },
        ] } },
        { end: { headline: 'A loop with a brake.', body: 'Closed-loop optimisation is only safe with a stop rule. NeuCharBox followed yours to the letter, halted on the first bad step, and told you why it didn\'t trust the number.' } },
      ],
    },
  ],
};
