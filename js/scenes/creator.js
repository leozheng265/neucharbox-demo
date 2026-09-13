// Scene 5 — Creator desk. Proves: one command, whole setup — and a backup when it counts.

export default {
  id: 'creator',
  title: 'Creator desk',
  startHour: 19.5,
  camera: { position: [2.4, 1.7, 2.9], target: [0.1, 1.0, -1.0], minDistance: 1.5, maxDistance: 5.5, azimuth: [-0.6, 1.1], fitAspect: 1.3 },
  setupIntro: 'A streaming desk. Key light, main camera on the arm, mic on the boom, capture card, the overlay on the monitor, the on-air sign on the wall and an LED strip behind the desk. A spare USB webcam sits on top of the monitor. The hub is on the desk, right of the monitor. Plug it in to start.',
  askIntro: 'What do you want to happen? Pick one, or type your own.',
  deviceOrder: ['keylight', 'cam', 'mic', 'capture', 'overlay', 'onair', 'strip'],
  extraNames: { webcam: 'USB webcam' }, // tap names for pickables that are not devices (main.js nameOf)
  devices: {
    keylight: { icon: 'keylight', name: 'Key light', initial: { on: false, brightness: 0, kelvin: 5600 }, format: (s) => (s.brightness > 0.02 ? `${Math.round(s.brightness * 100)}% · ${Math.round(s.kelvin / 100) * 100}K` : 'off'), active: (s) => s.brightness > 0.02, faultText: 'not responding' }, // kelvin to 100 K: it fades in the wrap-up
    cam:      { icon: 'camera', name: 'Main camera', initial: { on: false, signal: false }, format: (s) => (s.on ? (s.signal ? 'on · signal' : 'on · no signal') : 'off'), faultText: 'on, but no picture' },
    mic:      { icon: 'mic', name: 'Mic', initial: { muted: true, level: -90 }, format: (s) => (s.muted ? 'muted' : `live · ${Math.round(s.level)} dB`.replace('-', '−')), faultText: 'no input' },
    capture:  { icon: 'capture', name: 'Capture card', initial: { input: 'HDMI 1', signal: false }, format: (s) => `${s.input} · ${s.signal ? 'signal' : 'no signal'}`, active: (s) => s.signal, faultText: 'signal with camera off' },
    overlay:  { icon: 'display', name: 'Overlay', initial: { scene: 'idle' }, format: (s, st) => (s.scene === 'live' && st?.plan?.backup ? 'LIVE · USB webcam' : s.scene === 'recording' && st?.plan?.videoOnly ? 'REC · video only' : { idle: 'idle', starting: '"Starting soon"', live: 'LIVE scene', ending: '"Thanks for watching"', recording: 'REC' }[s.scene] || s.scene), active: (s) => s.scene !== 'idle', faultText: 'unreachable' },
    onair:    { icon: 'sign', name: 'On-air sign', initial: { on: false }, format: (s) => (s.on ? 'ON AIR' : 'off'), faultText: 'no response' },
    strip:    { icon: 'strip', name: 'LED strip', initial: { on: true, hue: 0.55, brightness: 0.5 }, format: (s) => (s.on && s.brightness > 0.005 ? `${s.hue >= 0.65 ? 'purple' : 'blue'} · ${Math.round(s.brightness * 100)}%` : 'off'), active: (s) => s.on && s.brightness > 0.005, faultText: 'no response' }, // "off" at 0%, not "purple · 0%"
  },

  build({ R, P, M, THREE, store, parts }) {
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x2E3A48, roughness: 0.95 });
    // The floor is a little more matte than the shared one: at 80% the key light's reflection in the glossy finish blew out
    // a wide patch of floor in front of the chair, seen from the front-left end of the view's sway.
    const floorMat = M.floor.clone(); Object.assign(floorMat, { roughness: 0.6, clearcoat: 0.12, clearcoatRoughness: 0.55 });
    P.roomShell({ w: 5, d: 4.5, h: 2.7, wallMat, floorMat });
    // Skirting and crown on the right wall (x = 2.5: the view's sway shows it about half the time) and the front wall
    // (z = 2.25, seen from behind the back wall), which the shell leaves bare. A few mm lower than the shell's, so no two
    // trims share a face in a corner; the front ones stop at the right wall's. They hide with their walls (renderer.js).
    for (const [hh, y] of [[0.098, 0.049], [0.057, 2.6705]]) { // skirting, crown
      P.onWall(P.flatNormals(P.box(0.02, hh, 4.5, M.trim, 2.49, y, 0), -1, 0, 0), -1, 0, -2.5);
      P.onWall(P.flatNormals(P.box(4.98, hh, 0.02, M.trim, -0.01, y, 2.24), 0, 0, -1), 0, -1, -2.25);
    }
    R.lights.sun.intensity = 0; R.lights.sun.castShadow = false; R.lights.hemi.intensity = 0.25; R.lights.fill.intensity = 0.2; R.scene.background = new THREE.Color(0x141A22); R.scene.environmentIntensity = 0.2;
    const ceilLight = new THREE.PointLight(0xFFF1DC, 3, 8, 1.6); ceilLight.position.set(0.5, 2.6, 0.6); R.scene.add(ceilLight);
    // Its fixture, flush on the ceiling (y = 2.7) just above the bulb, so the bright patch the bulb leaves on the ceiling
    // (seen from low or from behind the room) has a lamp in it. It hides with the ceiling once the camera is above it.
    const lamp = new THREE.Group(); lamp.position.set(0.5, 2.7, 0.6); lamp.userData.wall = { nx: 0, ny: -1, nz: 0, d: -2.7 }; R.scene.add(lamp);
    const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 40), new THREE.MeshStandardMaterial({ color: 0x5E646A, metalness: 0.6, roughness: 0.4 })); lampBase.position.y = -0.015; // a darker rim: it outlines the lamp in its own glow
    const lampDiffuser = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.16, 0.035, 40), new THREE.MeshStandardMaterial({ color: 0xFFFFFF, emissive: 0xFFF1DC, emissiveIntensity: 1.1, roughness: 0.6 })); lampDiffuser.position.y = -0.0375; lamp.add(lampBase, lampDiffuser);
    // desk against the back wall; its top is satin rather than semi-gloss, so looking into the key light doesn't blow it out
    const deskMat = M.wood.clone(); deskMat.roughness = 0.75;
    // Matte black for the gear on and over the desk. The key light is only a metre from the camera rig, and M.black's
    // specular turned the camera, its arm, the keyboard and the monitor's side white whenever the light was on.
    const gear = new THREE.MeshPhysicalMaterial({ color: 0x141619, roughness: 0.8, metalness: 0, specularIntensity: 0.3 });
    P.box(1.8, 0.04, 0.8, deskMat, 0, 0.74, -1.75, 0.01); [[-0.85, -0.35], [0.85, -0.35], [-0.85, 0.35], [0.85, 0.35]].forEach((p) => P.box(0.05, 0.72, 0.05, M.black, p[0], 0.36, -1.75 + p[1]));
    // monitor with the overlay scene on it
    const monitor = P.box(0.62, 0.38, 0.03, gear, 0, 1.14, -2.0, 0.01), monBase = P.box(0.14, 0.02, 0.18, gear, 0, 0.77, -1.95), monPost = P.box(0.04, 0.18, 0.04, gear, 0, 0.86, -2.0);
    const screen = P.screenPlane(0.58, 0.34, null); screen.position.set(0, 1.14, -1.983); screen.material.roughness = 0.85; // matte: the key light, grazing it, doesn't wash the picture out
    P.box(0.42, 0.02, 0.14, gear, 0, 0.77, -1.6, 0.005); P.box(0.06, 0.015, 0.1, gear, 0.45, 0.77, -1.6, 0.005); // keyboard, mouse
    // camera on an arm above the monitor
    const camArm = P.box(0.03, 0.03, 0.5, gear, 0.35, 1.44, -1.85), camPost = P.box(0.03, 0.695, 0.03, gear, 0.35, 1.1075, -2.1); // post: desk top (0.76) up to the arm
    const camBody = P.box(0.1, 0.08, 0.12, gear, 0.35, 1.48, -1.62, 0.01); const camLens = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.05, 20), M.anodized); camLens.rotation.x = Math.PI / 2; camLens.position.set(0.35, 1.48, -1.54); R.scene.add(camLens); const camLed = P.ledDot(0.315, 1.512, -1.558, 0xE0563A, 0.006); // tally, on the front face
    // spare USB webcam on top of the monitor (plugged into the PC, not the capture card)
    const WEB = [0.1, 1.33 + 0.018, -1.99]; // sits on the monitor's top edge (y = 1.33)
    const webcam = P.box(0.085, 0.036, 0.045, gear, ...WEB, 0.008); const webLens = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.013, 0.008, 20), M.anodized); webLens.rotation.x = Math.PI / 2; webLens.position.set(WEB[0], WEB[1], WEB[2] + 0.0265); R.scene.add(webLens);
    const webGlass = new THREE.Mesh(new THREE.CircleGeometry(0.0085, 20), new THREE.MeshStandardMaterial({ color: 0x0A0F14, roughness: 0.1, metalness: 0.3 })); webGlass.position.set(WEB[0], WEB[1], WEB[2] + 0.0307); R.scene.add(webGlass);
    const webcamLed = P.ledDot(WEB[0] + 0.03, WEB[1] + 0.007, WEB[2] + 0.0225, 0x2FBF71, 0.004);
    // mic on a boom arm from the desk's left edge
    const micPost = P.cyl(0.015, 0.015, 0.6, gear, -0.85, 1.06, -1.5, 12); const boom = P.box(0.6, 0.02, 0.02, gear, -0.55, 1.35, -1.5); boom.rotation.z = 0.15; const micBody = P.cyl(0.035, 0.035, 0.16, M.steel, -0.3, 1.32, -1.5, 20); micBody.rotation.x = 0.5; const micLed = P.ledDot(-0.3, 1.302, -1.4675, 0xE0563A, 0.006); // on the front face of the tilted mic
    // capture card box + hub + phone
    const capBox = P.box(0.14, 0.03, 0.09, M.anodized, 0.7, 0.775, -1.85, 0.006); const capLed = P.ledDot(0.65, 0.78, -1.803, 0x2FBF71, 0.005); // on the front face
    // The hub sits right of the monitor, clear of the camera post, the mouse and the capture card, and turned a little to the
    // default view: from there (on a phone too) it, its ring and its label stay clear of the chair back. The phone is by it.
    const hub = P.hub(0.5, 0.76, -1.78, { rotY: 0.3 }); R.addPickable(hub.group, 'hub'); P.phone(0.75, 0.765, -1.56, 0.35);
    // key light: stand right of the desk, in front of the chair, softbox aimed at where the streamer sits.
    // lookAt turns the box's +z face (the diffuser) to the chair, which also faces it to the default view behind the chair.
    const KEY = [1.35, 1.7, -1.95], KEY_AIM = [0, 1.15, -0.9], KEY_SPOT = [-0.1, 0.95, -1.25]; // spot centred between desk and chair
    const softbox = P.box(0.5, 0.5, 0.06, M.black, ...KEY, 0.01); softbox.lookAt(...KEY_AIM);
    const kAim = new THREE.Vector3(...KEY_AIM).sub(new THREE.Vector3(...KEY)).normalize(); const kBack = new THREE.Vector3(...KEY).addScaledVector(kAim, -0.03); // centre of the back face
    const kPole = new THREE.Vector3(-kAim.x, 0, -kAim.z).normalize().multiplyScalar(0.14).add(new THREE.Vector3(KEY[0], 1.58, KEY[2])); // stand top, behind the box
    const kStand = P.cyl(0.015, 0.015, kPole.y, M.black, kPole.x, kPole.y / 2, kPole.z, 12), kBase = P.cyl(0.18, 0.18, 0.02, M.black, kPole.x, 0.01, kPole.z, 24);
    const kArm = P.cyl(0.012, 0.012, kPole.distanceTo(kBack), M.black, (kPole.x + kBack.x) / 2, (kPole.y + kBack.y) / 2, (kPole.z + kBack.z) / 2, 10); kArm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), kBack.clone().sub(kPole).normalize());
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.46), new THREE.MeshStandardMaterial({ color: 0x8C8C8C, emissive: 0xFFF6E8, emissiveIntensity: 0, side: THREE.DoubleSide })); panel.position.set(0, 0, 0.031); softbox.add(panel);
    // A 40° half-angle with a wide soft edge: the chair, the streamer's head, the desk and the camera (12–18° off the axis)
    // stay in the full beam, while the floor past the chair falls in the soft edge. At 52° it lit that floor to a white pool.
    // Its reach is 5 m: the beam fades before the left wall, 4.4 m away along its axis past the chair, where at 6 m it left a
    // hot spot on the white skirting (phones, which have no AO, bloomed it). The chair and desk, 2 m away, lose about 2%.
    const keyLight = new THREE.SpotLight(0xFFF6E8, 0, 5, 0.7, 0.7, 1.2); keyLight.position.set(...KEY); keyLight.target.position.set(...KEY_SPOT); keyLight.castShadow = true; keyLight.shadow.mapSize.setScalar(R.quality === 'high' ? 2048 : 1024); keyLight.shadow.bias = -0.002; keyLight.shadow.normalBias = 0.02; R.scene.add(keyLight); R.scene.add(keyLight.target); // normalBias: the light grazes the back wall, which otherwise shows moiré rings (shadow acne)
    // A 50 cm softbox a metre from the camera rig casts a faint, very soft shadow, not a hard black cut-out of the rig on the
    // left wall: partial (intensity) and blurred (radius, in shadow-map texels).
    keyLight.shadow.intensity = 0.55; keyLight.shadow.radius = 4;
    // on-air sign on the back wall above the monitor
    const signBox = P.box(0.46, 0.17, 0.04, M.black, 0, 1.8, -2.25 + 0.02 + 0.002, 0.01); // just inside the wall plane at z = -2.25
    const signFace = P.screenPlane(0.42, 0.13, parts.labelTex('ON AIR', { bg: '#1A0A0A', fg: '#FF3030', size: 56, w: 420, h: 130 })); signFace.position.set(0, 1.8, -2.25 + 0.04 + 0.002 + 0.003); signFace.material.emissiveIntensity = 0; signFace.material.roughness = 0.85; // matte, like the screen: seen along the wall, the key light's glare turned it white
    // LED strip on the wall behind the desk, just inside the wall plane (z = -2.25) and above the desk top + shelf with things
    const strip = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.018, 0.012), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x6B4FD8, emissiveIntensity: 2 })); strip.position.set(0, 0.86, -2.25 + 0.006 + 0.002); R.scene.add(strip);
    // Never drawn: a tap target bigger than the strip. A plane facing the room, not a box: picking only takes its front
    // face, so from behind the back wall it doesn't catch taps meant for the hub or the capture card in front of it.
    const stripPick = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.1), new THREE.MeshBasicMaterial({ visible: false })); stripPick.position.set(0, 0.86, -2.17); R.scene.add(stripPick);
    const stripLights = [-0.5, 0.5].map((x) => { const l = new THREE.PointLight(0x6B4FD8, 1, 2.5, 1.5); l.position.set(x, 0.95, -2.17); R.scene.add(l); return l; }); // wall wash either side of the monitor
    P.onWall(P.box(1.2, 0.03, 0.22, M.wood, -1.3, 1.9, -2.13), 0, 1, -2.25); // shelf, top at y = 1.915
    const plant = P.plant(-1.7, -2.1, { scale: 0.45, y: 1.915, front: true }); // on the shelf
    for (let i = 0; i < 3; i++) P.onWall(P.box(0.05, 0.22, 0.16, [M.yellow, M.white, M.cardboard][i], -1.05 + i * 0.07, 2.025, -2.12), 0, 1, -2.25);
    // Hung on the back wall (z = -2.25): hidden with it once the camera is behind it (renderer.js). Not the strip's lights
    // (the room's lighting must not change with the view) nor stripPick (never drawn).
    for (const o of [signBox, signFace, strip, plant.group]) P.onWall(o, 0, 1, -2.25);
    // chair
    P.box(0.5, 0.08, 0.5, M.black, 0, 0.48, -0.9, 0.03); P.box(0.5, 0.39, 0.07, M.black, 0, 0.705, -0.665, 0.03); P.cyl(0.03, 0.03, 0.4, M.steel, 0, 0.24, -0.9, 12); for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; P.box(0.3, 0.02, 0.04, M.black, Math.cos(a) * 0.15, 0.03, -0.9 + Math.sin(a) * 0.15).rotation.y = -a; } // low-back chair: backrest top at 0.90, under the view line to the hub and capture card as the view sways past it

    let shownScene = null, shownBackup = null, shownVideo = null, shownLinked = null;
    function drawScene(name, backup, video, linked) { // linked: the overlay is connected (no NeuCharBox caption before discovery)
      if (name === shownScene && backup === shownBackup && video === shownVideo && linked === shownLinked) return; shownScene = name; shownBackup = backup; shownVideo = video; shownLinked = linked;
      const c = document.createElement('canvas'); c.width = 580; c.height = 340; const g = c.getContext('2d'); const grad = g.createLinearGradient(0, 0, 580, 340); grad.addColorStop(0, '#1B2430'); grad.addColorStop(1, '#3A2A6B'); g.fillStyle = grad; g.fillRect(0, 0, 580, 340);
      g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold 44px Inter, "Segoe UI", sans-serif'; const label = { starting: 'STARTING SOON', ending: 'THANKS FOR WATCHING' }[name]; if (label) g.fillText(label, 290, 150);
      if (name === 'live' || name === 'recording') { // program picture (500 x 250): the camera image as a head-and-shoulders placeholder, plus the LIVE / REC badge
        g.fillStyle = '#12161C'; g.fillRect(40, 30, 500, 250); g.fillStyle = backup && name === 'live' ? '#3C4650' : '#5A6E80'; g.beginPath(); g.arc(290, 148, 52, 0, Math.PI * 2); g.fill(); g.beginPath(); g.ellipse(290, 280, 118, 78, 0, Math.PI, 0); g.fill();
        g.fillStyle = '#FF3030'; g.beginPath(); g.arc(70, 55, 9, 0, Math.PI * 2); g.fill(); g.fillStyle = '#fff'; g.font = 'bold 22px Inter, "Segoe UI", sans-serif'; g.textAlign = 'left'; g.fillText(name === 'live' ? 'LIVE' : video ? 'REC · video only' : 'REC', 90, 56);
      }
      if (linked) { g.fillStyle = '#9FE3F0'; g.font = '18px Inter, "Segoe UI", sans-serif'; g.textAlign = 'left'; g.fillText('NeuCharBox scene control', 20, 320); }
      if (name === 'live' && backup) { g.fillStyle = '#FFB020'; g.beginPath(); g.roundRect(404, 302, 136, 32, 16); g.fill(); g.fillStyle = '#231703'; g.font = 'bold 18px Inter, "Segoe UI", sans-serif'; g.textAlign = 'center'; g.fillText('backup cam', 472, 319); } // monitor only: in the margin, not in the program
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; screen.material.map?.dispose(); screen.material.map = t; screen.material.emissiveMap = t; screen.material.needsUpdate = true;
    }

    R.addPickable(softbox, 'keylight'); R.addPickable(camBody, 'cam'); R.addPickable(webcam, 'webcam'); R.addPickable(micBody, 'mic'); R.addPickable(capBox, 'capture'); R.addPickable(screen, 'overlay'); R.addPickable(monitor, 'overlay'); R.addPickable(signBox, 'onair'); R.addPickable(signFace, 'onair'); R.addPickable(strip, 'strip'); R.addPickable(stripPick, 'strip');
    // The rest of each device (after the parts above, which stay where rings and labels appear): a tap on a stand, post or
    // boom selects its device instead of passing through to what is behind it (the monitor's stand picked the LED strip).
    for (const [o, id] of [[monPost, 'overlay'], [monBase, 'overlay'], [camArm, 'cam'], [camPost, 'cam'], [micPost, 'mic'], [boom, 'mic'], [kStand, 'keylight'], [kArm, 'keylight'], [kBase, 'keylight']]) R.addPickable(o, id);
    // Hidden with the back wall, the sign and the strip must not catch taps either: picking doesn't check .visible.
    for (const o of [signBox, signFace, strip]) o.raycast = function (ray, hits) { if (this.visible) THREE.Mesh.prototype.raycast.call(this, ray, hits); };
    const hi = P.highlighter({ keylight: [softbox], cam: [camBody], mic: [micBody], capture: [capBox], overlay: [screen], onair: [signBox], strip: [strip], webcam: [webcam] });
    const col = new THREE.Color();
    // Point at the moments the story turns on in the room (main.js already pings discovery and faults).
    const mark = (id, text) => { hi.focus(id); R.ping(id, text, { hold: 2600 }); };
    store.subscribe((state, path, value) => {
      if (path === 'onair.on' && value && !state.plan?.preset) mark('onair', 'On-air sign · ON'); // not when the wrap-up sets up "live for 48 minutes": NCB didn't do that
      else if (path === 'plan.backup' && value) mark('webcam', 'USB webcam · backup source');
      else if (path === 'capture.input' && value === 'disabled') mark('capture', 'Capture card · input disabled'); // replaces the fault marker
    });

    return {
      focus: hi.focus,
      update(s, t) {
        hi.update();
        hub.ledMat.emissiveIntensity = s.hub.status === 'on' ? (2.5 + Math.sin(t * 2.2) * 1.5) * s.hub.led : 0;
        const kb = s.keylight.brightness; keyLight.intensity = kb * 40; panel.material.emissiveIntensity = kb > 0.005 ? 0.25 + 1.5 * kb : 0; const warm = (6500 - s.keylight.kelvin) / 3500; panel.material.emissive.setRGB(1, 1 - 0.42 * warm, 1 - 0.72 * warm); keyLight.color.copy(panel.material.emissive); // ~blackbody: 3200 K reads orange
        const camOnAir = s.cam.on && s.cam.signal && !s.plan?.backup && (s.overlay.scene === 'live' || s.overlay.scene === 'recording'); // tally: red only while its picture is live or recording
        camLed.material.color.set(s.cam.status === 'fault' || camOnAir ? 0xE0563A : 0x2FBF71); camLed.material.emissive.copy(camLed.material.color); camLed.material.emissiveIntensity = s.cam.status === 'fault' ? (Math.floor(t * 3) % 2 ? 6 : 1) : s.cam.on ? 4 : 1; camLed.visible = s.cam.status !== 'offline';
        webcamLed.material.emissiveIntensity = s.plan?.backup ? 5 : 0.8; // bright while it is the backup source
        micLed.material.color.set(s.mic.muted || s.mic.status === 'fault' ? 0xE0563A : 0x2FBF71); micLed.material.emissive.copy(micLed.material.color); micLed.material.emissiveIntensity = s.mic.status === 'fault' ? (Math.floor(t * 3) % 2 ? 6 : 1) : 2; micLed.visible = s.mic.status !== 'offline';
        const capBad = s.capture.status === 'fault', capOff = !capBad && s.capture.input === 'disabled'; capLed.material.color.set(capBad ? 0xE0563A : capOff ? 0x1A1C1E : s.capture.signal ? 0x3AB7FF : 0xFFB020); capLed.material.emissive.copy(capLed.material.color); capLed.material.emissiveIntensity = capBad ? (Math.floor(t * 3) % 2 ? 6 : 1) : capOff ? 0 : 2; capLed.visible = s.capture.status !== 'offline'; // input disabled: LED dark
        drawScene(s.overlay.scene, !!s.plan?.backup, !!s.plan?.videoOnly, s.overlay.status !== 'offline');
        signFace.material.emissiveIntensity = s.onair.on ? 2.5 + 0.3 * Math.sin(t * 3) : 0; signFace.material.color.setScalar(s.onair.on ? 1 : 0.12); // off: unlit lettering, not red text
        col.setHSL(s.strip.hue, 0.7, 0.55); strip.material.emissive.copy(col); strip.material.emissiveIntensity = s.strip.on ? 1 + 2 * s.strip.brightness : 0; for (const l of stripLights) { l.color.copy(col); l.intensity = s.strip.on ? 1.6 * s.strip.brightness : 0; }
      },
    };
  },

  prompts: [
    {
      chip: 'Go live.',
      keywords: ['go', 'live', 'stream', 'streaming', 'livestream', 'livestreaming', 'start', 'broadcast', 'broadcasting', 'online', 'begin', 'air', 'sign'],
      avoid: ['cut', 'dark', 'end', 'ending', 'ended', 'stop', 'stopped', 'finish', 'finished', 'close', 'closing', 'break', 'brb', 'silent', 'silently', 'silence'], // "cut the stream", "go dark", "stopped streaming", "close the stream", "go to break", "go silent" (js/engine/match.js)
      rulesOut: ['record', 'recording', 'blue', 'green', 'pink', 'yellow', 'orange', 'teal', 'cyan', 'rainbow'], // it doesn't record ("record with the on-air sign on"); it turns the strip purple
      touches: ['Backup: the USB webcam, if the main camera fails'], // also the plan's last line; listed first, so "go live without the webcam" quotes it and not "Main camera on…"
      expect: { 'cam.status': 'fault', 'overlay.scene': 'live', 'onair.on': true, 'plan.backup': true, 'capture.signal': false, 'strip.hue': 0.75 },
      steps: [
        { beat: 'plan' },
        { say: 'Two words, seven devices. Here\'s the order I\'d do them in — the on-air sign is last because it should mean what it says.' },
        { plan: { intro: 'Go-live sequence:', steps: [
          { text: 'Key light on, 80% at 5600K', alt: { text: 'Key light on, 60% at 4000K — warmer, dimmer', apply: [{ set: 'plan.warm', to: true }] } }, // "on": "go live but keep the lights off" asks back
          { text: 'Main camera on; capture card on HDMI 1; verify a signal before the camera goes on screen' },
          { text: 'Overlay to "Starting soon" until the camera signal is confirmed, then the live scene' },
          { text: 'Mic unmuted as you go live on the stream — not before' }, // "go live", "stream" and "unmuted" in one clause: "go live muted" and "start the stream muted" ask back
          { text: 'LED strip to purple, then the on-air sign — only once the stream is actually up' },
          { text: 'Backup: the USB webcam, if the main camera fails' }, // what Recover does
        ] } },
        { beat: 'run' },
        { fn: async ({ store, tween, status }) => { const warm = store.get('plan.warm'); status(`Key light → ${warm ? '60% · 4000K' : '80% · 5600K'}`); store.set('keylight.on', true); store.set('keylight.kelvin', warm ? 4000 : 5600); await tween('keylight.brightness', warm ? 0.6 : 0.8, 1200); } },
        { set: 'cam.on', to: true, label: 'Main camera → on' }, { wait: 1200 },
        { set: 'overlay.scene', to: 'starting', label: 'Overlay → Starting soon' },
        { say: 'Overlay up: "Starting soon". Waiting on the camera signal before I switch to live…' },
        { wait: 1500 },
        { beat: 'recover' },
        { fail: 'cam', say: 'Main camera reports "on", but the capture card still sees no signal on HDMI 1. I go by the card: no picture.' },
        { say: 'I won\'t switch to a live scene with no picture on it. There\'s a backup: the spare USB webcam on the monitor. Switching the scene to it, and telling you rather than hiding it.' },
        { set: 'plan.backup', to: true, label: 'Video source → USB webcam' }, { wait: 800 },
        { replan: { intro: 'Going live on the backup:', changes: ['Scene video source switched from the capture card to the USB webcam on the PC — picture confirmed', 'Live scene next; a small "backup cam" tag goes on your monitor — not on the stream — so you know', 'Main camera: out of the scene for now; if its picture comes back I\'ll offer to switch back, not just switch'], needsYou: 'After the stream: check the HDMI cable on the main camera. It reported "on" but never sent a frame.' } },
        { set: 'overlay.scene', to: 'live', label: 'Overlay → LIVE' }, { wait: 600 }, { set: 'mic.muted', to: false }, { tween: 'mic.level', to: -18, ms: 600, label: 'Mic → live' },
        { parallel: [{ tween: 'strip.hue', to: 0.75, ms: 800, label: 'LED strip → purple' }, { tween: 'strip.brightness', to: 0.8, ms: 800 }] },
        { set: 'onair.on', to: true, label: 'On-air sign → ON' },
        { say: 'You\'re live on the backup camera. Mic open, strip purple, sign on.' },
        { end: { headline: 'It went live on the backup, and told you.', body: 'A device that says "on" but sends nothing gets caught before the audience sees it. NeuCharBox switched to the backup and put the fact on your screen, not in a log.' } },
      ],
    },
    {
      chip: 'I\'m done. Wrap up.',
      keywords: ['done', 'wrap', 'up', 'end', 'stop', 'finish', 'finished', 'offline', 'sign off', 'bye', 'over', 'shut', 'down', 'kill', 'stream', 'streaming', 'broadcast', 'go', 'live', 'air', 'mute', 'muted', 'thats', 'camera', 'ending', 'ended', 'stopped', 'livestream', 'livestreaming'], // no bare "turn off": "turn off the key light" is not a wrap-up (it ends with the light on); no "everything": "everything on"
      avoid: ['turn on', 'switch on', 'set up stream', 'set up streaming', 'fire up', 'power up', 'boot up', 'put up', 'hook up', 'up running', 'pause', 'paused', 'dark', 'check', 'test', 'fix', 'broken', 'repair', 'isnt', 'doesnt', 'working', 'voice', 'break', 'brb', 'silent', 'silently', 'silence',
        'mic down', 'turn down', 'light down', 'lights down', 'strip down', 'calm down', 'tone down'], // "turn everything on", "set up for streaming", "pause the stream", "check everything", "voice over", "go to break", "go silent": not an ending; "key light down", like "key light off", is not the whole wrap-up; "go dark": its plan leaves the lights on
      rulesOut: ['record', 'recording', 'blue', 'green', 'pink', 'yellow', 'teal', 'cyan', 'rainbow'], // it ends a stream, not a recording ("finish recording"); the strip stays purple, dimmed
      expect: { 'capture.status': 'online', 'capture.input': 'disabled', 'capture.signal': false, 'mic.muted': true, 'onair.on': false, 'overlay.scene': 'idle' },
      steps: [
        { beat: 'plan' },
        { say: 'Skipping ahead: you\'ve been live for 48 minutes on the main camera.' },
        { fn: ({ store }) => { store.set('plan.preset', true); store.set('keylight.on', true); store.set('keylight.brightness', 0.8); store.set('cam.on', true); store.set('cam.signal', true); store.set('capture.signal', true); store.set('overlay.scene', 'live'); store.set('mic.muted', false); store.set('mic.level', -18); store.set('onair.on', true); store.set('strip.hue', 0.75); store.set('strip.brightness', 0.8); } },
        { status: 'Live · 48 min' },
        { say: 'Wrapping up. Order matters: the mic goes first, because the thing you say after "I\'m done" is the thing you don\'t want on the stream.' },
        { plan: { intro: 'Wrap-up sequence:', steps: [
          { text: 'Mic muted immediately' },
          { text: 'Overlay to the "Thanks for watching" screen, then stream off and on-air sign off' },
          { text: 'Camera off; verify the capture card sees no signal' },
          { text: 'Key light to a warm 30%, LED strip dim', alt: { text: 'Key light and LED strip off', apply: [{ set: 'plan.dark', to: true }] } },
        ] } },
        { beat: 'run' },
        { set: 'mic.muted', to: true, label: 'Mic → muted' }, { set: 'mic.level', to: -90 }, { wait: 600 }, // each status label stays up long enough to read
        { set: 'overlay.scene', to: 'ending', label: 'Overlay → Thanks for watching' }, { wait: 1500 },
        { set: 'overlay.scene', to: 'idle', label: 'Stream → off' }, { wait: 600 }, { set: 'onair.on', to: false, label: 'On-air sign → off' }, { wait: 600 },
        { set: 'cam.on', to: false }, { set: 'cam.signal', to: false, label: 'Camera → off' }, { wait: 900 },
        { beat: 'recover' },
        { fail: 'capture', say: 'The camera is off, but the capture card still reports a signal on HDMI 1.' },
        { say: 'A capture card with a signal after the camera is "off" is a privacy problem, not a technical one. Disabling the input at the card so nothing can leave the desk.' },
        { set: 'capture.input', to: 'disabled', label: 'Capture input → disabled' }, { set: 'capture.signal', to: false }, { set: 'capture.status', to: 'online' }, { wait: 1000 }, // let the disabled card show before the lights change
        { status: (store) => (store.get('plan.dark') ? 'Key light and LED strip → off' : 'Key light → warm 30%, LED strip → dim') },
        { fn: async ({ store, tween }) => { const dark = store.get('plan.dark'); const t = [tween('keylight.brightness', dark ? 0 : 0.3, 1200), tween('strip.brightness', dark ? 0 : 0.25, 1200)]; if (!dark) t.push(tween('keylight.kelvin', 3200, 1200)); await Promise.all(t); if (dark) { store.set('keylight.on', false); store.set('strip.on', false); } } }, // warmer as it dims, never orange at 80%; "off" stays 5600K
        { replan: { intro: 'Done, with one flag:', changes: ['Capture input disabled at the card — verified: no signal', 'Stream is off, sign is off, mic is muted', 'Key light and strip as planned'], needsYou: 'Check the camera\'s standby or power settings: something kept HDMI alive after "off". I\'ll re-enable the input the next time you need the camera.' } },
        { end: { headline: 'Off means off.', body: 'The camera said off. The capture card said otherwise. NeuCharBox disabled the input at the card and told you why, because "probably fine" isn\'t good enough for a live feed.' } },
      ],
    },
    {
      chip: 'Recording only — camera and mic, no stream, no sign.',
      keywords: ['recording', 'record', 'rec', 'camera', 'mic', 'local', 'locally', 'video', 'start', 'begin', 'offline', 'cam', 'film', 'filming'],
      rulesOut: ['live', 'broadcast', 'online', 'livestream', 'webcam', 'backup', 'screen', 'purple', 'green', 'pink', 'yellow', 'orange', 'teal', 'cyan', 'rainbow'], // routing (js/engine/match.js): "go live without the sign" is never this; it records the main camera, strip untouched
      avoid: ['just video', 'video only', 'audio only', 'just audio', 'sound only', 'just sound', 'silent', 'silently', 'silence', 'dark', 'check', 'test', 'fix', 'broken', 'repair', 'isnt', 'doesnt', 'working',
        'finish', 'finished', 'done', 'end', 'ending', 'ended', 'stop', 'stopped', 'cut', 'drop', 'lose', 'hide', 'ditch', 'disconnect', 'lower mic', 'mic down'], // its plan turns the camera and light on, opens the mic and starts a recording: never for "record in the dark", "done recording", "cut the camera", "turn the mic down"; "the camera isn't working" is no request to record
      expect: { 'mic.status': 'online', 'overlay.scene': 'recording', 'onair.on': false, 'plan.fixed': true },
      steps: [
        { beat: 'plan' },
        { say: 'Local recording, nothing goes out. The stream stays off and so does the sign — that\'s the point of the request, so I\'ll treat both as "must not turn on".' },
        { plan: { intro: 'Recording setup:', steps: [
          { text: 'Key light on, 70% at 5000K' },
          { text: 'Video: camera on, capture on HDMI 1, verify signal' }, // "video", "audio", "sound": "record without video / audio / sound" asks back
          { text: 'Audio: mic open; recording starts only once it picks up sound — a silent recording is a wasted one' },
          { text: 'Stream: off. On-air sign: off. Both locked for this session.' },
        ] } },
        { beat: 'run' },
        { set: 'keylight.on', to: true }, { set: 'keylight.kelvin', to: 5000 }, { tween: 'keylight.brightness', to: 0.7, ms: 1000, label: 'Key light → 70% · 5000K' },
        { set: 'cam.on', to: true, label: 'Camera → on' }, { wait: 800 }, { set: 'cam.signal', to: true }, { set: 'capture.signal', to: true, label: 'Camera signal verified' }, { wait: 600 },
        { set: 'mic.level', to: -90 }, { set: 'mic.muted', to: false, label: 'Mic → live' },
        { say: 'Camera verified. Mic open. Waiting for audio level before I start the recording…' },
        { wait: 1600 },
        { beat: 'recover' },
        { fail: 'mic', say: 'Mic is unmuted but the level has stayed flat at −90 dB since I opened it. That\'s no input, not silence — a room is never that quiet.' },
        { say: 'Not starting a recording I can already tell is broken. Camera and key light stay on, so you keep your light and framing.' },
        { replan: { intro: 'Holding off on recording:', changes: ['Recording not started — nothing to clean up later', 'Camera, light and capture stay ready', 'Stream and sign remain off and locked', 'I\'ll start the recording the moment the mic shows level'], needsYou: 'Check the mic\'s USB or the boom arm cable — flat −90 dB usually means unplugged, not muted.' } },
        { ask: { intro: 'Your call:', options: [
          { label: 'Wait — I\'ll fix the mic', primary: true, apply: [{ status: 'Waiting for mic level…' }, { wait: 1500 }, { set: 'mic.status', to: 'online' }, { tween: 'mic.level', to: -20, ms: 800, label: 'Mic level −20 dB' }, { set: 'overlay.scene', to: 'recording', label: 'Recording started' }, { say: 'Level\'s back at −20 dB. Recording started. Stream and sign still off.' }, { set: 'plan.fixed', to: true }] },
          { label: 'Record video only, no audio', apply: [{ set: 'plan.videoOnly', to: true }, { set: 'overlay.scene', to: 'recording', label: 'Recording started · video only' }, { say: 'Recording video only — logged as such, so you\'re not surprised in the edit. Stream and sign still off.' }] },
        ] } },
        { end: { headline: 'It wouldn\'t record silence without asking.', body: 'A recording that\'s technically running and practically useless is the worst outcome. NeuCharBox checked the thing that mattered, held, and asked.' } },
      ],
    },
  ],
};
