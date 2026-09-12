// Scene 2 — Laser lab (illustrative). Proves: exact instructions, executed and verified step by step.
// Alignment model (pure, derived from the store so the panel and the room agree):
//   meter µW = PMAX · gauss(M1 error) · gauss(M2 error) · iris(stage x) · laser mW / 5
// M2 starts 0.12° off in yaw, so the beam lands low on the meter until someone walks it in.

const PMAX = 860;             // µW on the meter with perfect alignment at 5 mW
const W = 0.15;               // degrees of mirror error at which power falls to 1/e
const gauss = (yaw, pitch) => Math.exp(-((yaw * yaw + pitch * pitch) / (W * W)));
const iris = (x) => Math.exp(-Math.pow((x - 12.4) / 2.2, 2) * 0.7);
export function meterReading(st) {
  if (!st.laser.on || st.laser.shutter !== 'open') return 0;
  return PMAX * gauss(st.m1.yaw, st.m1.pitch) * gauss(st.m2.yaw, st.m2.pitch) * iris(st.stage.x) * (st.laser.mW / 5);
}
const fmtUW = (v) => (v < 1 ? '0 µW' : `${v.toFixed(0)} µW`);

export default {
  id: 'lab',
  title: 'Laser lab',
  startHour: 14,
  camera: { position: [1.9, 1.75, 2.4], target: [-0.1, 0.95, -0.2], minDistance: 1.0, maxDistance: 5, azimuth: [-0.5, 1.2] },
  setupIntro: 'An optical bench — an illustrative setup, not a specific lab. The hub is at the end of the table. Plug it in to start.',
  askIntro: 'This room takes exact instructions. Give one, or pick one below. Every step is executed and then verified against the meter and the camera before I call it done.',
  deviceOrder: ['laser', 'm1', 'm2', 'stage', 'meter', 'beamcam'],
  devices: {
    laser:  { icon: 'laser', name: 'Laser · shutter', initial: { on: true, shutter: 'closed', mW: 5 }, format: (s) => `${s.shutter} · ${s.mW.toFixed(1)} mW set`, faultText: 'shutter fault' },
    m1:     { icon: 'mirror', name: 'Mirror M1', initial: { yaw: 0.0, pitch: 0.0 }, format: (s) => `yaw ${s.yaw >= 0 ? '+' : ''}${s.yaw.toFixed(3)}° · pitch ${s.pitch >= 0 ? '+' : ''}${s.pitch.toFixed(3)}°`, faultText: 'no response' },
    m2:     { icon: 'mirror', name: 'Mirror M2', initial: { yaw: 0.12, pitch: -0.02 }, format: (s) => `yaw ${s.yaw >= 0 ? '+' : ''}${s.yaw.toFixed(3)}° · pitch ${s.pitch >= 0 ? '+' : ''}${s.pitch.toFixed(3)}°`, faultText: 'no response' },
    stage:  { icon: 'stage', name: 'Stage X', initial: { x: 10.0, limit: 12.0, moving: false }, format: (s) => `${s.x.toFixed(3)} mm${s.moving ? ' · moving' : ''} · limit ${s.limit.toFixed(1)}`, faultText: 'at limit' },
    meter:  { icon: 'meter', name: 'Power meter', initial: { bump: 1 }, format: (s, st) => fmtUW(meterReading(st) * s.bump), faultText: 'no reading' },
    beamcam:{ icon: 'beamcam', name: 'Beam camera', initial: {}, format: (s, st) => (meterReading(st) > 1 ? `spot at (${(st.m2.yaw * 180).toFixed(0)}, ${(st.m2.pitch * 180).toFixed(0)}) px` : 'no beam'), faultText: 'no image' },
  },

  build({ R, P, M, THREE, store, parts }) {
    R.lights.sun.intensity = 0; R.lights.sun.castShadow = false; R.lights.hemi.intensity = 0.25; R.lights.fill.intensity = 0.15; R.scene.environmentIntensity = 0.25;
    R.scene.background = new THREE.Color(0x151A1E);
    const dark = new THREE.MeshStandardMaterial({ color: 0x6B7075, roughness: 0.95 });
    const floorMat = new THREE.MeshStandardMaterial({ map: parts.tex(parts.tileTex('#7C8286', '#6F7579'), [3, 3]), roughness: 0.6 });
    P.roomShell({ w: 6, d: 5, h: 3, floorMat, wallMat: dark, skirting: false });
    // overhead lights (dimmed, as in a laser lab)
    for (const x of [-1.2, 1.2]) { const l = new THREE.PointLight(0xE8F0FF, 6, 9, 1.6); l.position.set(x, 2.85, -0.4); l.castShadow = true; l.shadow.mapSize.set(1024, 1024); l.shadow.bias = -0.002; R.scene.add(l); P.box(0.6, 0.03, 0.2, M.white, x, 2.97, -0.4).material = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, emissive: 0xFFFFFF, emissiveIntensity: 0.6 }); }

    // optical table: black breadboard on pneumatic legs
    const plateMat = new THREE.MeshStandardMaterial({ map: parts.tex(parts.holeGridTex(), [3, 1.5]), roughness: 0.55, metalness: 0.3 });
    const tableY = 0.9;
    P.box(2.6, 0.2, 1.3, plateMat, 0, tableY - 0.1, -0.2);
    for (const [x, z] of [[-1.1, -0.7], [1.1, -0.7], [-1.1, 0.3], [1.1, 0.3]]) { P.cyl(0.08, 0.08, 0.6, M.steel, x, 0.3, z, 20); P.cyl(0.11, 0.11, 0.1, M.black, x, 0.05, z, 20); }
    const Y = tableY + 0.1; // beam height

    // laser head
    const laserBody = P.box(0.32, 0.09, 0.09, M.anodized, -1.0, Y, 0.3, 0.008); P.box(0.3, 0.02, 0.09, M.black, -1.0, Y - 0.06, 0.3); P.box(0.26, 0.02, 0.03, M.steel, -1.0, tableY + 0.01, 0.3);
    P.box(0.04, 0.03, 0.03, M.led(0xE0563A), -1.12, Y + 0.02, 0.35).material.emissiveIntensity = 0.8; // safety LED
    const shutter = P.box(0.01, 0.06, 0.06, M.steel, -0.83, Y, 0.3); // flag in front of the aperture; rotates up when open
    const shutterPivot = new THREE.Group(); shutterPivot.position.set(-0.83, Y + 0.03, 0.3); R.scene.add(shutterPivot); R.scene.remove(shutter); shutter.position.set(0, -0.03, 0); shutterPivot.add(shutter);

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
    const irisPost = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.05, 12), M.steel); irisPost.position.set(0, tableY + 0.075, -0.45); R.scene.add(irisPost);
    const irisRing = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.005, 10, 30), M.anodized); irisRing.rotation.y = Math.PI / 2; irisRing.position.set(0, Y, -0.45); R.scene.add(irisRing);

    // power meter head + readout box, beam camera + monitor
    const head = P.box(0.05, 0.06, 0.06, M.black, -0.75, Y, -0.45, 0.005); P.cyl(0.01, 0.01, 0.1, M.steel, -0.75, tableY + 0.05, -0.45, 12);
    const meterBox = P.box(0.16, 0.08, 0.12, M.white, -1.0, tableY + 0.04, -0.15, 0.008);
    const meterScreen = P.screenPlane(0.12, 0.045, null); meterScreen.position.set(-1.0, tableY + 0.05, -0.089); meterScreen.material.emissiveIntensity = 0.9;
    const beamcamBody = P.box(0.05, 0.05, 0.08, M.black, -0.75, Y, -0.62, 0.005); P.cyl(0.008, 0.008, 0.06, M.steel, -0.75, tableY + 0.03, -0.62, 12);
    // monitor on a bench behind the table shows the beam profile
    P.box(1.6, 0.05, 0.6, M.woodLight, -1.4, 0.85, -2.1); P.box(0.05, 0.85, 0.55, M.steel, -2.1, 0.42, -2.1); P.box(0.05, 0.85, 0.55, M.steel, -0.7, 0.42, -2.1);
    P.box(0.55, 0.36, 0.03, M.black, -1.4, 1.12, -2.2, 0.01); P.box(0.12, 0.02, 0.16, M.black, -1.4, 0.885, -2.15);
    const profile = P.screenPlane(0.5, 0.31, null); profile.position.set(-1.4, 1.12, -2.184);
    // hub, laptop, safety sign, shelf with boxes
    const hub = P.hub(1.05, tableY, 0.42, { rotY: -0.3 }); R.addPickable(hub.group, 'hub'); P.phone(1.15, tableY + 0.005, 0.2, 0.6);
    P.box(0.3, 0.012, 0.22, M.steel, -1.05, 0.88, -2.0); const lap = P.box(0.3, 0.2, 0.012, M.steel, -1.05, 0.98, -2.11); lap.rotation.x = -0.25;
    P.box(0.5, 0.35, 0.02, M.yellow, -2.99, 1.8, -0.5); P.box(0.36, 0.22, 0.005, M.black, -2.98, 1.8, -0.5);
    P.box(1.4, 0.03, 0.3, M.steel, 1.9, 1.7, -2.35); for (let i = 0; i < 4; i++) P.box(0.25, 0.18, 0.2, [M.cardboard, M.white, M.black, M.cardboard][i], 1.4 + i * 0.32, 1.81, -2.35, 0.01);

    // beam segments (emissive cylinders), rebuilt each frame from the alignment state
    const beamMat = new THREE.MeshStandardMaterial({ color: 0xFF2A2A, emissive: 0xFF2020, emissiveIntensity: 4, transparent: true, opacity: 0.9 });
    const seg = () => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 1, 8), beamMat); R.scene.add(m); return m; };
    const segs = [seg(), seg(), seg()];
    const spot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 12), new THREE.MeshStandardMaterial({ color: 0xFF6060, emissive: 0xFF3030, emissiveIntensity: 6 })); R.scene.add(spot);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), mid = new THREE.Vector3(), dir = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    function place(m, from, to) { a.set(...from); b.set(...to); mid.addVectors(a, b).multiplyScalar(0.5); dir.subVectors(b, a); const len = dir.length(); m.position.copy(mid); m.scale.set(1, len, 1); m.quaternion.setFromUnitVectors(up, dir.normalize()); }

    let shownMeter = null, shownSpot = null;
    function drawMeter(text) { if (shownMeter === text) return; shownMeter = text; const t = parts.labelTex(text, { bg: '#0B0F14', fg: '#7CF0D8', size: 44, w: 256, h: 96 }); meterScreen.material.map = t; meterScreen.material.emissiveMap = t; meterScreen.material.needsUpdate = true; }
    function drawProfile(cx, cy, p) { const key = `${cx.toFixed(0)},${cy.toFixed(0)},${(p / 50).toFixed(0)}`; if (shownSpot === key) return; shownSpot = key; const c = document.createElement('canvas'); c.width = 320; c.height = 200; const g = c.getContext('2d'); g.fillStyle = '#0A0D12'; g.fillRect(0, 0, 320, 200); g.strokeStyle = '#1F2A33'; for (let x = 0; x < 320; x += 20) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 200); g.stroke(); } for (let y = 0; y < 200; y += 20) { g.beginPath(); g.moveTo(0, y); g.lineTo(320, y); g.stroke(); } g.strokeStyle = '#3A4A56'; g.beginPath(); g.moveTo(160, 0); g.lineTo(160, 200); g.moveTo(0, 100); g.lineTo(320, 100); g.stroke(); if (p > 1) { const r = 10 + 22 * Math.min(1, p / PMAX); const gr = g.createRadialGradient(160 + cx, 100 + cy, 1, 160 + cx, 100 + cy, r); gr.addColorStop(0, '#FFFFFF'); gr.addColorStop(0.25, '#FF6A3D'); gr.addColorStop(1, 'rgba(120,20,20,0)'); g.fillStyle = gr; g.beginPath(); g.arc(160 + cx, 100 + cy, r, 0, Math.PI * 2); g.fill(); } g.fillStyle = '#7CF0D8'; g.font = '16px Inter, "Segoe UI", sans-serif'; g.fillText(p > 1 ? `centroid ${cx.toFixed(0)}, ${cy.toFixed(0)} px` : 'no beam', 10, 188); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; profile.material.map = t; profile.material.emissiveMap = t; profile.material.needsUpdate = true; }

    R.addPickable(laserBody, 'laser'); R.addPickable(shutterPivot, 'laser'); R.addPickable(m1.group, 'm1'); R.addPickable(m2.group, 'm2'); R.addPickable(stageBase, 'stage'); R.addPickable(stageTop, 'stage'); R.addPickable(head, 'meter'); R.addPickable(meterBox, 'meter'); R.addPickable(beamcamBody, 'beamcam'); R.addPickable(profile, 'beamcam');
    const hi = P.highlighter({ laser: [laserBody], m1: [m1.plate], m2: [m2.plate], stage: [stageBase], meter: [meterBox], beamcam: [beamcamBody] });
    const EX = 22; // visual exaggeration of mirror angles so a 0.1° move is visible

    return {
      focus: hi.focus,
      update(s, t) {
        hi.update();
        hub.ledMat.emissiveIntensity = s.hub.status === 'on' ? (2.5 + Math.sin(t * 2.2) * 1.5) * s.hub.led : 0;
        shutterPivot.rotation.z = -(s.laser.shutter === 'open' ? 1 : 0) * 1.3;
        m1.tilt.rotation.y = m1.rotY + THREE.MathUtils.degToRad(s.m1.yaw * EX); m1.tilt.rotation.z = THREE.MathUtils.degToRad(s.m1.pitch * EX);
        m2.tilt.rotation.y = m2.rotY + THREE.MathUtils.degToRad(s.m2.yaw * EX); m2.tilt.rotation.z = THREE.MathUtils.degToRad(s.m2.pitch * EX);
        const sx = (s.stage.x - 10) * 0.012; stageTop.position.x = sx; irisPost.position.x = sx; irisRing.position.x = sx;
        const p = meterReading(s) * s.meter.bump; const live = s.laser.on && s.laser.shutter === 'open';
        // beam: laser → M1 → M2 → meter head, with the M2 error steering the last leg
        const e2y = THREE.MathUtils.degToRad(s.m2.yaw * EX) * 2, e2p = THREE.MathUtils.degToRad(s.m2.pitch * EX) * 2, e1 = THREE.MathUtils.degToRad(s.m1.yaw * EX) * 2;
        const L2 = 1.05, L3 = 1.45;
        const hit2 = [0.7 + Math.tan(e1) * 0.75, Y, -0.45];
        const end = [-0.75, Y + Math.tan(e2p) * L3, -0.45 - Math.tan(e2y) * L3 * 0.6];
        place(segs[0], [-0.83, Y, 0.3], [0.7, Y, 0.3]); place(segs[1], [0.7, Y, 0.3], hit2); place(segs[2], hit2, end);
        segs.forEach((m) => (m.visible = live)); spot.visible = live; spot.position.set(...end);
        beamMat.emissiveIntensity = 2 + 3 * Math.min(1, s.laser.mW / 5);
        drawMeter(s.meter.status === 'offline' ? '----' : fmtUW(p)); drawProfile(s.m2.yaw * 180, s.m2.pitch * 180, s.beamcam.status === 'offline' ? 0 : p);
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
        { status: 'Step 1 · power' }, { say: 'Step 1 — power set 5.0 mW. Verified: driver reports 5.0 mW.' },
        { status: 'Step 2 · shutter' }, { set: 'laser.shutter', to: 'open', label: 'Shutter → open' }, { wait: 900 },
        { status: 'Step 3 · verify' },
        { fn: ({ chat, store }) => { const p = meterReading(store.state); chat.ncb(`Step 2 — shutter open. Verified: meter ${fmtUW(p)}, camera sees a spot. Beam is on the table. Holding.`); } },
        { wait: 1500 },
        { say: '00:30 — 455 µW, spot steady.' }, { wait: 1200 },
        { beat: 'recover' },
        { set: 'meter.bump', to: 0.0 },
        { fail: 'laser', say: '01:00 — meter dropped to 0 µW and the camera lost the spot, but the shutter still reports "open".' },
        { say: 'The device says one thing and the measurement says another. I trust the measurement. Closing the shutter and stopping — I won\'t hold a laser I can\'t see.' },
        { set: 'laser.shutter', to: 'closed', label: 'Shutter → closed (safe state)' },
        { replan: { intro: 'Stopped in a safe state:', changes: ['Shutter commanded closed; driver confirms closed', 'Laser stays powered but blocked', 'Nothing else on the table was touched'], needsYou: 'The shutter flag may be sticking. Inspect it before the next run; I won\'t reopen it on my own.' } },
        { set: 'meter.bump', to: 1 },
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
        { fn: ({ chat, store }) => chat.ncb(`Baseline: ${fmtUW(meterReading(store.state))} at M2 yaw +0.120°.`) },
        { fn: async ({ store, chat, fast }) => { if (store.get('plan.stepped')) { for (let i = 1; i <= 5; i++) { await store.tween('m2.yaw', 0.12 + 0.01 * i, fast ? 0 : 500); chat.ncb(`Step ${i}/5 — yaw +${(0.12 + 0.01 * i).toFixed(3)}° · ${fmtUW(meterReading(store.state))}`); } } else { await store.tween('m2.yaw', 0.17, fast ? 0 : 1500); } } },
        { status: 'M2 yaw → +0.170°' },
        { beat: 'recover' },
        { fn: ({ chat, store }) => chat.alert(`Done: M2 yaw +0.170°, encoder confirms. Meter ${fmtUW(meterReading(store.state))} — that's down from the baseline. The move took the beam further off the meter, not closer.`) },
        { ask: { intro: 'I did exactly what you asked and the result is worse. I won\'t "fix" it without being told. What do you want?', options: [
          { label: 'Reverse it — back to +0.120°', apply: [{ tween: 'm2.yaw', to: 0.12, ms: 1200, label: 'M2 yaw → +0.120°' }, { fn: ({ chat, store }) => chat.ncb(`Reversed. M2 yaw +0.120°, meter ${fmtUW(meterReading(store.state))}. Same as baseline.`) }] },
          { label: 'Keep it there', apply: [{ say: 'Kept at +0.170°. Logged as an intentional move.' }, { set: 'plan.keep', to: true }] },
          { label: 'Try −0.050° instead', apply: [{ tween: 'm2.yaw', to: 0.07, ms: 1500, label: 'M2 yaw → +0.070°' }, { fn: ({ chat, store }) => chat.ncb(`M2 yaw +0.070°, meter ${fmtUW(meterReading(store.state))} — better than baseline. Stopping there; you didn't ask me to keep going.`) }, { set: 'plan.keep', to: true }] },
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
        { set: 'stage.moving', to: true },
        { fn: async ({ store, chat, fast }) => { const lines = []; for (let i = 1; i <= 20; i++) { const x = Math.round((10 + i * 0.1) * 1000) / 1000; await store.tween('stage.x', x, fast ? 0 : 260); lines.push(`${x.toFixed(3)} mm → ${fmtUW(meterReading(store.state))}`); if (i % 5 === 0) chat.ncb(lines.splice(0).join('\n')); } } },
        { set: 'stage.moving', to: false },
        { beat: 'recover' },
        { fail: 'stage', say: 'Stage is at 12.000 mm — the configured soft limit. 4 steps remain to reach 12.400.' },
        { set: 'stage.status', to: 'online' },
        { ask: { intro: 'The limit exists for a reason I can\'t see from here. Your call:', options: [
          { label: 'Stop here at 12.000 mm', apply: [{ say: 'Stopped at 12.000 mm. Log has 20 entries. Limit unchanged.' }] },
          { label: 'Raise the limit to 13.000 mm and continue', apply: [{ set: 'stage.limit', to: 13, label: 'Soft limit → 13.000 mm (by you)' }, { set: 'stage.moving', to: true }, { fn: async ({ store, chat, fast }) => { const lines = []; for (let i = 21; i <= 24; i++) { const x = Math.round((10 + i * 0.1) * 1000) / 1000; await store.tween('stage.x', x, fast ? 0 : 260); lines.push(`${x.toFixed(3)} mm → ${fmtUW(meterReading(store.state))}`); } chat.ncb(lines.join('\n')); } }, { set: 'stage.moving', to: false }, { say: 'At 12.400 mm. Limit change is logged under your name, not mine.' }] },
          { label: 'Abort and return to 10.000 mm', apply: [{ set: 'stage.moving', to: true }, { tween: 'stage.x', to: 10, ms: 1500, label: 'Stage X → 10.000 mm' }, { set: 'stage.moving', to: false }, { say: 'Back at 10.000 mm. Log kept.' }] },
        ] } },
        { fn: ({ store }) => { if (store.get('stage.x') !== 12.0) store.set('plan.moved', true); } },
        { end: { headline: 'It stopped at the limit and asked.', body: 'A soft limit is a decision someone made. NeuCharBox executed to the edge of it, logged every step, and handed the decision back to a person instead of overriding it.' } },
      ],
    },
    {
      chip: 'Walk M2 to maximise power on the meter. Stop if any step drops it by more than 20%.',
      keywords: ['walk', 'maximise', 'maximize', 'optimise', 'optimize', 'power', 'meter', 'm2', 'align', 'alignment', 'peak', 'stop'],
      expect: { 'laser.shutter': 'open' },
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
        { fn: async ({ store, chat, fast }) => { let last = meterReading(store.state); chat.ncb(`Baseline ${fmtUW(last)}.`); for (let i = 1; i <= 5; i++) { const y = 0.12 - 0.02 * i; await store.tween('m2.yaw', y, fast ? 0 : 450); const p = meterReading(store.state); chat.ncb(`Step ${i}: yaw ${y >= 0 ? '+' : ''}${y.toFixed(3)}° → ${fmtUW(p)} (${p >= last ? '+' : ''}${((p / last - 1) * 100).toFixed(0)}%)`); last = p; } } },
        { beat: 'recover' },
        { set: 'meter.bump', to: 0.55 },
        { fn: async ({ store, chat, fast }) => { await store.tween('m2.yaw', 0.0, fast ? 0 : 450); const p = meterReading(store.state) * store.get('meter.bump'); chat.alert(`Step 6: yaw +0.000° → ${fmtUW(p)} — a 45% drop in one step. The camera shows the spot jumped, not drifted. Halting, as instructed.`); } },
        { say: 'A jump that size isn\'t alignment — something moved on the table, or something crossed the beam. I\'m not going to keep optimising against a reading I don\'t trust.' },
        { ask: { intro: 'Halted at +0.000°. Options:', options: [
          { label: 'Go back to the best step (+0.020°) and stop', apply: [{ tween: 'm2.yaw', to: 0.02, ms: 900, label: 'M2 yaw → +0.020°' }, { set: 'meter.bump', to: 1 }, { fn: ({ chat, store }) => chat.ncb(`At +0.020°, meter ${fmtUW(meterReading(store.state))}. Reading is back — whatever crossed the beam has cleared. Holding here; tell me when to resume.`) }] },
          { label: 'Hold here and let me look', apply: [{ say: 'Holding at +0.000°. Shutter stays open, nothing moves until you say.' }] },
          { label: 'Close the shutter', apply: [{ set: 'laser.shutter', to: 'closed', label: 'Shutter → closed' }, { say: 'Shutter closed. Position kept at +0.000° so you can resume from here.' }, { set: 'plan.closed', to: true }] },
        ] } },
        { end: { headline: 'A loop with a brake.', body: 'Closed-loop optimisation is only safe with a stop rule. NeuCharBox followed yours to the letter, halted on the first bad step, and told you why it didn\'t trust the number.' } },
      ],
    },
  ],
};
