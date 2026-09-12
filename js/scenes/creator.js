// Scene 5 — Creator desk. Proves: one command, whole setup — and a backup when it counts.

export default {
  id: 'creator',
  title: 'Creator desk',
  startHour: 19.5,
  camera: { position: [2.4, 1.7, 2.9], target: [0.1, 1.0, -1.0], minDistance: 1.5, maxDistance: 5.5, azimuth: [-0.6, 1.1], fitAspect: 1.3 },
  setupIntro: 'A streaming desk. Key light, main camera on the arm, mic on the boom, capture card, the overlay on the monitor, the on-air sign on the wall and an LED strip behind the desk. A spare USB webcam sits on top of the monitor. The hub is on the desk. Plug it in to start.',
  askIntro: 'What do you want to happen? Pick one, or type your own.',
  deviceOrder: ['keylight', 'cam', 'mic', 'capture', 'overlay', 'onair', 'strip'],
  devices: {
    keylight: { icon: 'keylight', name: 'Key light', initial: { on: false, brightness: 0, kelvin: 5600 }, format: (s) => (s.brightness > 0.02 ? `${Math.round(s.brightness * 100)}% · ${s.kelvin}K` : 'off'), faultText: 'not responding' },
    cam:      { icon: 'camera', name: 'Main camera', initial: { on: false, signal: false }, format: (s) => (s.on ? (s.signal ? 'on · signal' : 'on · no signal') : 'off'), faultText: 'on, but no picture' },
    mic:      { icon: 'mic', name: 'Mic', initial: { muted: true, level: -90 }, format: (s) => (s.muted ? 'muted' : `live · ${Math.round(s.level)} dB`.replace('-', '−')), faultText: 'no input' },
    capture:  { icon: 'capture', name: 'Capture card', initial: { input: 'HDMI 1', signal: false }, format: (s) => `${s.input} · ${s.signal ? 'signal' : 'no signal'}`, faultText: 'signal with camera off' },
    overlay:  { icon: 'display', name: 'Overlay', initial: { scene: 'idle' }, format: (s, st) => (s.scene === 'live' && st?.plan?.backup ? 'LIVE · backup cam' : s.scene === 'recording' && st?.plan?.videoOnly ? 'REC · video only' : { idle: 'idle', starting: '"Starting soon"', live: 'LIVE scene', ending: '"Thanks for watching"', recording: 'REC' }[s.scene] || s.scene), faultText: 'unreachable' },
    onair:    { icon: 'sign', name: 'On-air sign', initial: { on: false }, format: (s) => (s.on ? 'ON AIR' : 'off'), faultText: 'no response' },
    strip:    { icon: 'strip', name: 'LED strip', initial: { on: true, hue: 0.55, brightness: 0.5 }, format: (s) => (s.on ? `${s.hue >= 0.65 ? 'purple' : 'blue'} · ${Math.round(s.brightness * 100)}%` : 'off'), faultText: 'no response' },
  },

  build({ R, P, M, THREE, store, parts }) {
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x2E3A48, roughness: 0.95 });
    P.roomShell({ w: 5, d: 4.5, h: 2.7, wallMat, floorMat: M.floor });
    R.lights.sun.intensity = 0; R.lights.sun.castShadow = false; R.lights.hemi.intensity = 0.25; R.lights.fill.intensity = 0.2; R.scene.background = new THREE.Color(0x141A22); R.scene.environmentIntensity = 0.2;
    const ceilLight = new THREE.PointLight(0xFFF1DC, 3, 8, 1.6); ceilLight.position.set(0.5, 2.6, 0.6); R.scene.add(ceilLight);
    // desk against the back wall
    P.box(1.8, 0.04, 0.8, M.wood, 0, 0.74, -1.75, 0.01); [[-0.85, -0.35], [0.85, -0.35], [-0.85, 0.35], [0.85, 0.35]].forEach((p) => P.box(0.05, 0.72, 0.05, M.black, p[0], 0.36, -1.75 + p[1]));
    // monitor with the overlay scene on it
    P.box(0.62, 0.38, 0.03, M.black, 0, 1.14, -2.0, 0.01); P.box(0.14, 0.02, 0.18, M.black, 0, 0.77, -1.95); P.box(0.04, 0.18, 0.04, M.black, 0, 0.86, -2.0);
    const screen = P.screenPlane(0.58, 0.34, null); screen.position.set(0, 1.14, -1.983);
    P.box(0.42, 0.02, 0.14, M.black, 0, 0.77, -1.6, 0.005); P.box(0.06, 0.015, 0.1, M.black, 0.45, 0.77, -1.6, 0.005); // keyboard, mouse
    // camera on an arm above the monitor
    P.box(0.03, 0.03, 0.5, M.black, 0.35, 1.36, -1.85); P.box(0.03, 0.615, 0.03, M.black, 0.35, 1.0675, -2.1); // post: desk top (0.76) up to the arm
    const camBody = P.box(0.1, 0.08, 0.12, M.black, 0.35, 1.4, -1.62, 0.01); const camLens = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.05, 20), M.anodized); camLens.rotation.x = Math.PI / 2; camLens.position.set(0.35, 1.4, -1.54); R.scene.add(camLens); const camLed = P.ledDot(0.315, 1.432, -1.558, 0xE0563A, 0.006); // tally, on the front face
    // spare USB webcam on top of the monitor (plugged into the PC, not the capture card)
    P.box(0.06, 0.03, 0.04, M.black, -0.15, 1.345, -1.99, 0.008); const webcamLed = P.ledDot(-0.13, 1.345, -1.968, 0x2FBF71, 0.004);
    // mic on a boom arm from the desk's left edge
    P.cyl(0.015, 0.015, 0.6, M.black, -0.85, 1.06, -1.5, 12); const boom = P.box(0.6, 0.02, 0.02, M.black, -0.55, 1.35, -1.5); boom.rotation.z = 0.15; const micBody = P.cyl(0.035, 0.035, 0.16, M.steel, -0.3, 1.32, -1.5, 20); micBody.rotation.x = 0.5; const micLed = P.ledDot(-0.3, 1.302, -1.4675, 0xE0563A, 0.006); // on the front face of the tilted mic
    // capture card box + hub + phone
    const capBox = P.box(0.14, 0.03, 0.09, M.anodized, 0.7, 0.775, -1.85, 0.006); const capLed = P.ledDot(0.65, 0.78, -1.803, 0x2FBF71, 0.005); // on the front face
    const hub = P.hub(-0.6, 0.76, -1.95, { rotY: 0.25 }); R.addPickable(hub.group, 'hub'); P.phone(-0.35, 0.765, -1.9, 0.5);
    // key light: stand right of the desk, in front of the chair, softbox aimed at where the streamer sits.
    // lookAt turns the box's +z face (the diffuser) to the chair, which also faces it to the default view behind the chair.
    const KEY = [1.35, 1.7, -1.95], KEY_AIM = [0, 1.15, -0.9], KEY_SPOT = [-0.1, 0.95, -1.25]; // spot centred between desk and chair
    P.cyl(0.015, 0.015, 1.7, M.black, KEY[0], 0.85, KEY[2], 12); P.cyl(0.18, 0.18, 0.02, M.black, KEY[0], 0.01, KEY[2], 24);
    const softbox = P.box(0.5, 0.5, 0.06, M.black, ...KEY, 0.01); softbox.lookAt(...KEY_AIM);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.46), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xFFF6E8, emissiveIntensity: 0, side: THREE.DoubleSide })); panel.position.set(0, 0, 0.031); softbox.add(panel);
    const keyLight = new THREE.SpotLight(0xFFF6E8, 0, 6, 0.9, 0.6, 1.2); keyLight.position.set(...KEY); keyLight.target.position.set(...KEY_SPOT); keyLight.castShadow = true; keyLight.shadow.mapSize.set(1024, 1024); keyLight.shadow.bias = -0.002; R.scene.add(keyLight); R.scene.add(keyLight.target);
    // on-air sign on the left wall
    const signBox = P.box(0.04, 0.16, 0.42, M.black, -2.5 + 0.02 + 0.002, 1.9, -1.2, 0.01); // just inside the wall plane at x = -2.5
    const signFace = P.screenPlane(0.38, 0.12, parts.labelTex('ON AIR', { bg: '#1A0A0A', fg: '#FF3030', size: 52, w: 380, h: 120 })); signFace.rotation.y = Math.PI / 2; signFace.position.set(-2.453, 1.9, -1.2); signFace.material.emissiveIntensity = 0.05;
    // LED strip on the wall behind the desk, just inside the wall plane (z = -2.25) and above the desk top + shelf with things
    const strip = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.018, 0.012), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x6B4FD8, emissiveIntensity: 2 })); strip.position.set(0, 0.86, -2.25 + 0.006 + 0.002); R.scene.add(strip);
    const stripPick = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 0.1), new THREE.MeshBasicMaterial({ visible: false })); stripPick.position.set(0, 0.86, -2.2); R.scene.add(stripPick); // never drawn: a tap target bigger than the strip
    const stripLight = new THREE.PointLight(0x6B4FD8, 2, 3, 1.5); stripLight.position.set(0, 0.85, -2.05); R.scene.add(stripLight);
    P.box(1.2, 0.03, 0.22, M.wood, -1.3, 1.9, -2.13); // shelf, top at y = 1.915
    const plant = P.plant(-1.7, -2.1, { scale: 0.45, y: 1.915, front: true }); // on the shelf
    for (let i = 0; i < 3; i++) P.box(0.05, 0.22, 0.16, [M.yellow, M.white, M.cardboard][i], -1.05 + i * 0.07, 2.025, -2.12);
    // chair
    P.box(0.5, 0.08, 0.5, M.black, 0, 0.5, -0.9, 0.03); P.box(0.5, 0.55, 0.08, M.black, 0, 0.82, -0.66, 0.03); P.cyl(0.03, 0.03, 0.42, M.steel, 0, 0.25, -0.9, 12); for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; P.box(0.3, 0.02, 0.04, M.black, Math.cos(a) * 0.15, 0.03, -0.9 + Math.sin(a) * 0.15).rotation.y = -a; }

    let shownScene = null, shownBackup = null, shownVideo = null;
    function drawScene(name, backup, video) { if (name === shownScene && backup === shownBackup && video === shownVideo) return; shownScene = name; shownBackup = backup; shownVideo = video; const key = `${name}|${backup ? 'backup' : ''}|${video ? 'video' : ''}`; const c = document.createElement('canvas'); c.width = 580; c.height = 340; const g = c.getContext('2d'); const grad = g.createLinearGradient(0, 0, 580, 340); grad.addColorStop(0, '#1B2430'); grad.addColorStop(1, '#3A2A6B'); g.fillStyle = grad; g.fillRect(0, 0, 580, 340); g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold 44px Inter, "Segoe UI", sans-serif'; const label = { idle: '', starting: 'STARTING SOON', live: '', ending: 'THANKS FOR WATCHING', recording: '' }[key.split('|')[0]] ?? ''; if (label) g.fillText(label, 290, 150); if (key.startsWith('live')) { g.fillStyle = '#12161C'; g.fillRect(40, 30, 500, 250); g.fillStyle = key.includes('backup') ? '#3C4650' : '#5A6E80'; g.beginPath(); g.arc(290, 170, 70, 0, Math.PI * 2); g.fill(); g.fillStyle = '#FF3030'; g.beginPath(); g.arc(70, 55, 9, 0, Math.PI * 2); g.fill(); g.fillStyle = '#fff'; g.font = 'bold 22px Inter, "Segoe UI", sans-serif'; g.textAlign = 'left'; g.fillText(key.includes('backup') ? 'LIVE · backup cam' : 'LIVE', 90, 56); } if (key.startsWith('recording')) { g.fillStyle = '#12161C'; g.fillRect(40, 30, 500, 250); g.fillStyle = '#FF3030'; g.beginPath(); g.arc(70, 55, 9, 0, Math.PI * 2); g.fill(); g.fillStyle = '#fff'; g.font = 'bold 22px Inter, "Segoe UI", sans-serif'; g.textAlign = 'left'; g.fillText(key.includes('video') ? 'REC · video only' : 'REC', 90, 56); } g.fillStyle = '#9FE3F0'; g.font = '18px Inter, "Segoe UI", sans-serif'; g.textAlign = 'left'; g.fillText('NeuCharBox scene control', 20, 320); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; screen.material.map?.dispose(); screen.material.map = t; screen.material.emissiveMap = t; screen.material.needsUpdate = true; }

    R.addPickable(softbox, 'keylight'); R.addPickable(camBody, 'cam'); R.addPickable(micBody, 'mic'); R.addPickable(capBox, 'capture'); R.addPickable(screen, 'overlay'); R.addPickable(signBox, 'onair'); R.addPickable(signFace, 'onair'); R.addPickable(strip, 'strip'); R.addPickable(stripPick, 'strip');
    const hi = P.highlighter({ keylight: [softbox], cam: [camBody], mic: [micBody], capture: [capBox], overlay: [screen], onair: [signBox], strip: [strip] });
    const col = new THREE.Color();

    return {
      focus: hi.focus,
      update(s, t) {
        hi.update();
        hub.ledMat.emissiveIntensity = s.hub.status === 'on' ? (2.5 + Math.sin(t * 2.2) * 1.5) * s.hub.led : 0;
        const kb = s.keylight.brightness; keyLight.intensity = kb * 40; panel.material.emissiveIntensity = kb * 2.5; const warm = (6500 - s.keylight.kelvin) / 3500; panel.material.emissive.setRGB(1, 1 - 0.25 * warm, 1 - 0.5 * warm); keyLight.color.copy(panel.material.emissive);
        camLed.material.color.set(s.cam.status === 'fault' ? 0xE0563A : s.cam.on && s.cam.signal ? 0xE0563A : 0x2FBF71); camLed.material.emissive.copy(camLed.material.color); camLed.material.emissiveIntensity = s.cam.status === 'fault' ? (Math.floor(t * 3) % 2 ? 6 : 1) : s.cam.on ? 4 : 1; camLed.visible = s.cam.status !== 'offline';
        webcamLed.material.emissiveIntensity = s.plan?.backup ? 5 : 0.8; // bright while it is the backup source
        micLed.material.color.set(s.mic.muted || s.mic.status === 'fault' ? 0xE0563A : 0x2FBF71); micLed.material.emissive.copy(micLed.material.color); micLed.material.emissiveIntensity = s.mic.status === 'fault' ? (Math.floor(t * 3) % 2 ? 6 : 1) : 2; micLed.visible = s.mic.status !== 'offline';
        const capBad = s.capture.status === 'fault'; capLed.material.color.set(capBad ? 0xE0563A : s.capture.signal ? 0x3AB7FF : 0xFFB020); capLed.material.emissive.copy(capLed.material.color); capLed.material.emissiveIntensity = capBad ? (Math.floor(t * 3) % 2 ? 6 : 1) : 2; capLed.visible = s.capture.status !== 'offline';
        drawScene(s.overlay.scene, !!s.plan?.backup, !!s.plan?.videoOnly);
        signFace.material.emissiveIntensity = s.onair.on ? 2.5 + 0.3 * Math.sin(t * 3) : 0.05;
        col.setHSL(s.strip.hue, 0.7, 0.55); strip.material.emissive.copy(col); strip.material.emissiveIntensity = s.strip.on ? 1 + 2 * s.strip.brightness : 0; stripLight.color.copy(col); stripLight.intensity = s.strip.on ? 3 * s.strip.brightness : 0;
      },
    };
  },

  prompts: [
    {
      chip: 'Go live.',
      keywords: ['go', 'live', 'stream', 'streaming', 'start', 'broadcast', 'broadcasting', 'online', 'begin', 'air', 'sign', 'turn on', 'switch on'],
      expect: { 'cam.status': 'fault', 'overlay.scene': 'live', 'onair.on': true, 'plan.backup': true, 'capture.signal': false, 'strip.hue': 0.75 },
      steps: [
        { beat: 'plan' },
        { say: 'Two words, seven devices. Here\'s the order I\'d do them in — the on-air sign is last because it should mean what it says.' },
        { plan: { intro: 'Go-live sequence:', steps: [
          { text: 'Key light to 80% at 5600K', alt: { text: 'Key light to 60% at 4000K — warmer, dimmer', apply: [{ set: 'plan.warm', to: true }] } },
          { text: 'Main camera on; capture card on HDMI 1; verify a signal before the camera goes on screen' },
          { text: 'Overlay to "Starting soon" until the camera signal is confirmed, then the live scene' },
          { text: 'Mic unmuted at the switch to live — not before' },
          { text: 'LED strip to purple, then the on-air sign — only once the stream is actually up' },
        ] } },
        { beat: 'run' },
        { fn: async ({ store, tween }) => { const warm = store.get('plan.warm'); store.set('keylight.on', true); store.set('keylight.kelvin', warm ? 4000 : 5600); await tween('keylight.brightness', warm ? 0.6 : 0.8, 1200); } },
        { status: 'Key light on' },
        { set: 'cam.on', to: true, label: 'Main camera → on' }, { wait: 1200 },
        { set: 'overlay.scene', to: 'starting', label: 'Overlay → Starting soon' },
        { say: 'Overlay up: "Starting soon". Waiting on the camera signal before I switch to live…' },
        { wait: 1500 },
        { beat: 'recover' },
        { fail: 'cam', say: 'Main camera reports "on", but the capture card still sees no signal on HDMI 1. I go by the card: no picture.' },
        { say: 'I won\'t switch to a live scene with no picture on it. There\'s a backup: the spare USB webcam on the monitor. Switching the scene to it, and telling you rather than hiding it.' },
        { set: 'plan.backup', to: true, label: 'Video source → USB webcam' }, { wait: 800 },
        { replan: { intro: 'Going live on the backup:', changes: ['Scene video source switched from the capture card to the USB webcam on the PC — picture confirmed', 'Live scene next; a small "backup cam" tag goes on your monitor — not on the stream — so you know', 'Main camera: power-cycling it in the background; if it comes back I\'ll offer to switch, not just switch'], needsYou: 'After the stream: check the HDMI cable on the main camera. It reported on but never sent a frame.' } },
        { set: 'overlay.scene', to: 'live', label: 'Overlay → LIVE' }, { set: 'mic.muted', to: false }, { tween: 'mic.level', to: -18, ms: 600, label: 'Mic → live' },
        { parallel: [{ tween: 'strip.hue', to: 0.75, ms: 800, label: 'LED strip → purple' }, { tween: 'strip.brightness', to: 0.8, ms: 800 }] },
        { set: 'onair.on', to: true, label: 'On-air sign → ON' },
        { say: 'You\'re live on the backup camera. Mic open, strip purple, sign on. The "backup cam" tag is on your monitor, not on the stream.' },
        { end: { headline: 'It went live on the backup, and told you.', body: 'A device that says "on" but sends nothing gets caught before the audience sees it. NeuCharBox switched to the backup and put the fact on your screen, not in a log.' } },
      ],
    },
    {
      chip: 'I\'m done. Wrap up.',
      keywords: ['done', 'wrap', 'up', 'end', 'stop', 'finish', 'finished', 'offline', 'sign off', 'bye', 'over', 'shut', 'down', 'kill', 'stream', 'streaming', 'broadcast', 'go', 'live', 'air', 'mute', 'muted', 'thats', 'turn off', 'switch off', 'shut off'],
      expect: { 'capture.status': 'online', 'capture.input': 'disabled', 'capture.signal': false, 'mic.muted': true, 'onair.on': false, 'overlay.scene': 'idle' },
      steps: [
        { beat: 'plan' },
        { say: 'Skipping ahead: you\'ve been live for 48 minutes on the main camera.' },
        { fn: ({ store }) => { store.set('keylight.on', true); store.set('keylight.brightness', 0.8); store.set('cam.on', true); store.set('cam.signal', true); store.set('capture.signal', true); store.set('overlay.scene', 'live'); store.set('mic.muted', false); store.set('mic.level', -18); store.set('onair.on', true); store.set('strip.hue', 0.75); store.set('strip.brightness', 0.8); } },
        { status: 'Live · 48 min' },
        { say: 'Wrapping up. The order matters here too — the mic goes first, because the thing you say after "I\'m done" is the thing you don\'t want on the stream.' },
        { plan: { intro: 'Wrap-up sequence:', steps: [
          { text: 'Mic muted immediately' },
          { text: 'Overlay to "Thanks for watching", then stream off and on-air sign off' },
          { text: 'Camera off; verify the capture card sees no signal' },
          { text: 'Key light to a warm 30%, LED strip dim', alt: { text: 'Key light and LED strip off', apply: [{ set: 'plan.dark', to: true }] } },
        ] } },
        { beat: 'run' },
        { set: 'mic.muted', to: true, label: 'Mic → muted' }, { set: 'mic.level', to: -90 },
        { set: 'overlay.scene', to: 'ending', label: 'Overlay → Thanks' }, { wait: 1500 },
        { set: 'overlay.scene', to: 'idle', label: 'Stream → off' }, { set: 'onair.on', to: false, label: 'On-air sign → off' },
        { set: 'cam.on', to: false }, { set: 'cam.signal', to: false, label: 'Camera → off' }, { wait: 900 },
        { beat: 'recover' },
        { fail: 'capture', say: 'The camera is off, but the capture card still reports a signal on HDMI 1.' },
        { say: 'A capture card with a signal after the camera is "off" is a privacy problem, not a technical one. Disabling the input at the card so nothing can leave the desk.' },
        { set: 'capture.input', to: 'disabled', label: 'Capture input → disabled' }, { set: 'capture.signal', to: false }, { set: 'capture.status', to: 'online' },
        { status: 'Key light and LED strip → as planned' },
        { fn: async ({ store, tween }) => { const dark = store.get('plan.dark'); store.set('keylight.kelvin', 3200); await Promise.all([tween('keylight.brightness', dark ? 0 : 0.3, 1200), tween('strip.brightness', dark ? 0 : 0.25, 1200)]); if (dark) { store.set('keylight.on', false); store.set('strip.on', false); } } },
        { replan: { intro: 'Done, with one flag:', changes: ['Capture input disabled at the card — verified: no signal', 'Stream is off, sign is off, mic is muted', 'Key light and strip as planned'], needsYou: 'Check the camera\'s standby or power settings: something kept HDMI alive after "off". I\'ll re-enable the input the next time you need the camera.' } },
        { end: { headline: 'Off means off.', body: 'The camera said off. The capture card said otherwise. NeuCharBox disabled the input at the card and told you why, because "probably fine" isn\'t good enough for a live feed.' } },
      ],
    },
    {
      chip: 'Recording only — camera and mic, no stream, no sign.',
      keywords: ['recording', 'record', 'rec', 'only', 'camera', 'mic', 'local', 'locally', 'video', 'start', 'without', 'offline', 'cam'],
      expect: { 'mic.status': 'online', 'overlay.scene': 'recording', 'onair.on': false, 'plan.fixed': true },
      steps: [
        { beat: 'plan' },
        { say: 'Local recording, nothing goes out. The stream stays off and so does the sign — that\'s the point of the request, so I\'ll treat both as "must not turn on".' },
        { plan: { intro: 'Recording setup:', steps: [
          { text: 'Key light 70% at 5000K' },
          { text: 'Camera on, capture on HDMI 1, verify signal' },
          { text: 'Mic live; recording starts only when I see audio level — a silent recording is a wasted one' },
          { text: 'Stream: off. On-air sign: off. Both locked for this session.' },
        ] } },
        { beat: 'run' },
        { set: 'keylight.on', to: true }, { set: 'keylight.kelvin', to: 5000 }, { tween: 'keylight.brightness', to: 0.7, ms: 1000, label: 'Key light → 70%' },
        { set: 'cam.on', to: true }, { wait: 800 }, { set: 'cam.signal', to: true }, { set: 'capture.signal', to: true, label: 'Camera signal verified' },
        { set: 'mic.level', to: -90 }, { set: 'mic.muted', to: false, label: 'Mic → live' },
        { say: 'Camera verified. Mic open. Waiting for audio level before I start the recording…' },
        { wait: 1600 },
        { beat: 'recover' },
        { fail: 'mic', say: 'Mic is unmuted but the level has stayed flat at −90 dB since I opened it. That\'s no input, not silence — a room is never that quiet.' },
        { say: 'Not starting a recording I can already tell is broken. Camera stays on so you don\'t lose the light and framing.' },
        { replan: { intro: 'Holding before record:', changes: ['Recording not started — nothing to clean up later', 'Camera, light and capture stay ready', 'Stream and sign remain off and locked', 'I\'ll start the recording the moment the mic shows level'], needsYou: 'Check the mic\'s USB or the boom arm cable — flat −90 dB usually means unplugged, not muted.' } },
        { ask: { intro: 'Your call:', options: [
          { label: 'Wait — I\'ll fix the mic', apply: [{ status: 'Waiting for mic level…' }, { wait: 1500 }, { set: 'mic.status', to: 'online' }, { tween: 'mic.level', to: -20, ms: 800, label: 'Mic level −20 dB' }, { set: 'overlay.scene', to: 'recording', label: 'Recording started' }, { say: 'Level\'s back at −20 dB. Recording started. Stream and sign still off.' }, { set: 'plan.fixed', to: true }] },
          { label: 'Record video only, no audio', apply: [{ set: 'plan.videoOnly', to: true }, { set: 'overlay.scene', to: 'recording', label: 'Recording started · video only' }, { say: 'Recording video only — logged as such, so you\'re not surprised in the edit. Stream and sign still off.' }] },
        ] } },
        { end: { headline: 'It wouldn\'t record silence without asking.', body: 'A recording that\'s technically running and practically useless is the worst outcome. NeuCharBox checked the thing that mattered, held, and asked.' } },
      ],
    },
  ],
};
