// Scene 1 — Home, away for a week. Proves: say what you want, never name a device.

const KS_END = { headline: 'You never named a device. You never wrote a rule.', body: 'You said what you wanted. NeuCharBox found the devices, wrote the plan, waited for your approval, ran it, and re-planned around a failure instead of hiding it.' };

// An NCB line whose wording depends on the visitor's plan choices, paced like a { say } step.
async function say({ chat, sleep, fast }, text) {
  if (!fast) { chat.typing(true); await sleep(Math.min(1800, 350 + text.length * 14)); chat.typing(false); }
  chat.ncb(text); await sleep(400);
}

export default {
  id: 'home',
  title: 'Home, away for a week',
  startHour: 16.5,
  // Frames every device (door camera and thermostat on the left wall, lamp in the right corner) at aspect 1.5; the
  // renderer widens the vertical FOV on narrower canvases (fitAspect). The auto-sway (home azimuth 0.75) only turns
  // right of home: below ~0.7 the door camera's ping label ("Motion at the door") runs off the left edge.
  camera: { position: [3.52, 2.22, 3.0], target: [-0.3, 1.2, -1.1], fov: 42, fitAspect: 1.5, azimuth: [0.72, 1.0], minDistance: 1.6, maxDistance: 6.5 },
  setupIntro: 'This is NeuCharBox, on the side table. Plug it in to start.',
  askIntro: 'You\'re leaving for a week on Friday. What do you want the house to do while you\'re gone? Pick one, or type your own.',
  deviceOrder: ['lamp', 'blinds', 'soil', 'pump', 'camera', 'thermostat'],
  devices: {
    lamp:       { icon: 'lamp', name: 'Floor lamp', initial: { on: false, brightness: 0 }, format: (s) => (s.on || s.brightness > 0.02 ? `on · ${Math.round(s.brightness * 100)}%` : 'off'), faultText: 'not responding' },
    blinds:     { icon: 'blinds', name: 'Blinds', initial: { closed: 0 }, format: (s) => `${Math.round(s.closed * 100)}% closed`, faultText: 'motor stalled' },
    soil:       { icon: 'moisture', name: 'Soil sensor', initial: { moisture: 34 }, format: (s) => `${s.moisture.toFixed(0)}% moisture`, faultText: 'no reading' },
    pump:       { icon: 'pump', name: 'Water pump', initial: { running: false }, format: (s) => (s.running ? 'running' : 'idle'), faultText: 'not responding' },
    camera:     { icon: 'camera', name: 'Door camera', initial: { armed: false, motion: false }, format: (s) => (s.armed ? (s.motion ? 'motion at door' : 'armed · no motion') : 'standby'), faultText: 'offline' },
    thermostat: { icon: 'thermostat', name: 'Thermostat', initial: { target: 21, current: 21.4 }, format: (s) => `${s.target.toFixed(0)}°C set · ${s.current.toFixed(1)}°C now`, faultText: 'unreachable' },
  },

  build({ R, P, M, THREE, store }) {
    R.scene.background = new THREE.Color(0xDCEBF3);
    P.roomShell({ w: 5, d: 5, h: 2.8, window: { x: 0.7, y: 1.55, ww: 1.7, wh: 1.36 } });
    // 18 slats at a 7 cm pitch: tilted to 1.3 rad a 7.5 cm slat covers more than the pitch, so "100% closed" closes.
    // The lowest slat (y 0.95) stays clear of the sill (top 0.885) at any tilt.
    const slats = P.blinds(0.7, 2.14, -2.42, 1.52, 18, 0.07);
    const blindsLed = P.ledDot(1.4, 2.2, -2.376, 0x2FBF71, 0.01); // motor status LED on the headrail's front face
    P.sofa(0.5, -1.86); // backrest rear face at z -2.32, just clear of the window sill (front face z -2.33)
    P.rug(0.5, -0.55); P.table(0.5, -0.6, 1.0, 0.5); P.box(0.18, 0.025, 0.25, M.art, 0.3, 0.4525, -0.6);
    const plant = P.plant(-1.9, -1.75);
    P.box(0.018, 0.34, 0.018, M.metal, -1.74, 0.5, -1.66); const sensorHead = P.box(0.06, 0.05, 0.03, M.hub, -1.74, 0.69, -1.66);
    const soilLed = P.ledDot(-1.74, 0.697, -1.64, 0x2FBF71, 0.009); // status LED on the sensor head's front face
    const pump = P.box(0.26, 0.2, 0.2, M.black, -1.35, 0.1, -1.5, 0.02);
    // Hose from the pump over the pot rim to a drip end just above the soil; clears the rim and the sensor stake.
    P.tube([[-1.45, 0.16, -1.5], [-1.55, 0.38, -1.52], [-1.68, 0.54, -1.55], [-1.8, 0.52, -1.62], [-1.87, 0.47, -1.7]]);
    const pumpLed = P.ledDot(-1.35, 0.21, -1.39, 0x2FBF71);
    const lamp = P.floorLamp(1.95, -1.6);
    P.table(-1.75, -0.3, 0.6, 0.42, 0.55, M.wood, M.black);
    const hub = P.hub(-1.75, 0.57, -0.3); R.addPickable(hub.group, 'hub');
    const phone = P.phone(-1.55, 0.575, -0.22, -0.4);
    // Left wall: front door with its camera above it, thermostat beside it. Wall-mounted parts sit on the wall plane.
    P.doorLeft(-2.5, 0.45);
    const cam = P.smallCamera(-2.453, 2.28, 0.45, Math.PI / 2);
    cam.led.scale.setScalar(1.5); cam.led.position.set(0.017, 0.017, 0.046);
    P.picture(-2.48, 1.6, -1.0);
    const thermo = P.box(0.03, 0.11, 0.11, M.white, -2.483, 1.45, -0.3, 0.01);
    const thermoCanvas = document.createElement('canvas'); thermoCanvas.width = 256; thermoCanvas.height = 144;
    const thermoTex = new THREE.CanvasTexture(thermoCanvas); thermoTex.colorSpace = THREE.SRGBColorSpace;
    const thermoScreen = P.screenPlane(0.07, 0.04, thermoTex); thermoScreen.rotation.y = Math.PI / 2; thermoScreen.position.set(-2.466, 1.46, -0.3); thermoScreen.material.emissiveIntensity = 0.7;
    let thermoShown = -1; // numeric key of what the screen shows (-1 offline, -2 fault); update() builds no strings unless it changes
    // Set point large, measured room temperature small underneath (one canvas and texture, redrawn on change).
    function thermoText(big, small) {
      const g = thermoCanvas.getContext('2d'); g.fillStyle = '#0B0F14'; g.fillRect(0, 0, 256, 144);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#9FE3F0'; g.font = '600 70px Inter, "Segoe UI", sans-serif'; g.fillText(big, 128, small ? 56 : 72);
      if (small) { g.fillStyle = '#6FB3C2'; g.font = '30px Inter, "Segoe UI", sans-serif'; g.fillText(small, 128, 116); }
      thermoTex.needsUpdate = true;
    }
    thermoText('--', '');

    R.addPickable(lamp.group, 'lamp'); R.addPickable(lamp.shade, 'lamp');
    slats.forEach((s) => R.addPickable(s, 'blinds')); R.addPickable(blindsLed, 'blinds');
    R.addPickable(sensorHead, 'soil'); R.addPickable(plant.pot, 'soil'); R.addPickable(soilLed, 'soil');
    R.addPickable(pump, 'pump'); R.addPickable(cam.group, 'camera'); R.addPickable(thermo, 'thermostat'); R.addPickable(thermoScreen, 'thermostat');

    const hi = P.highlighter({ lamp: [lamp.shade], blinds: slats, soil: [sensorHead, plant.pot], pump: [pump], camera: [cam.group.children[0]], thermostat: [thermo] });
    // Motion at the door is otherwise only an LED colour: mark it in the room.
    store.subscribe((state, path, value) => { if (path === 'camera.motion' && value) { hi.focus('camera'); R.ping('camera', 'Motion at the door', { color: '#FFB020', hex: 0xFFB020, hold: 2500 }); } });

    const led = (m, hex, intensity) => { m.material.color.set(hex); m.material.emissive.copy(m.material.color); m.material.emissiveIntensity = intensity; };
    return {
      focus: hi.focus,
      update(s, t) {
        hi.update();
        R.daylight(s.env.hour);
        const blink = Math.floor(t * 3) % 2 === 0;
        // A stalled motor leaves the slats uneven and the stack hanging askew from the headrail.
        const stalled = s.blinds.status === 'fault', skew = 0.03 + 0.12 * (1 - s.blinds.closed);
        slats.forEach((sl, i) => { sl.rotation.x = s.blinds.closed * 1.3 + (stalled ? Math.sin(i * 1.9) * skew : 0); sl.rotation.z = stalled ? (0.03 * i) / (slats.length - 1) : 0; });
        blindsLed.visible = s.blinds.status !== 'offline'; led(blindsLed, stalled ? 0xE0563A : 0x2FBF71, stalled ? (blink ? 6 : 1) : 1.5);
        const b = s.lamp.brightness; lamp.bulb.intensity = b * 9; lamp.bulbMesh.material.emissiveIntensity = b * 3; lamp.shadeMat.emissiveIntensity = b * 0.35;
        // No cube-shadow passes while the lamp is dark; render once up front so the depth map exists for the sampler.
        const lampShadow = lamp.bulb.shadow; lampShadow.autoUpdate = b > 0.02; if (!lampShadow.map) lampShadow.needsUpdate = true;
        const bad = s.pump.status === 'fault';
        led(pumpLed, bad ? 0xE0563A : s.pump.running ? 0x3AB7FF : 0x2FBF71, bad ? (blink ? 6 : 1) : s.pump.running ? 4 : 2);
        pumpLed.visible = s.pump.status !== 'offline';
        const soilBad = s.soil.status === 'fault';
        led(soilLed, soilBad ? 0xE0563A : 0x2FBF71, soilBad ? (blink ? 6 : 1) : 2);
        soilLed.visible = s.soil.status !== 'offline';
        const camBad = s.camera.status === 'fault';
        led(cam.led, camBad ? 0xE0563A : s.camera.armed ? (s.camera.motion ? 0xFFB020 : 0xE0563A) : 0x2FBF71, camBad ? (blink ? 6 : 1) : s.camera.motion ? (blink ? 6 : 3) : s.camera.armed ? 3 : 2);
        cam.led.visible = s.camera.status !== 'offline';
        const hubOn = s.hub.status === 'on'; hub.ledMat.emissiveIntensity = hubOn ? (2.5 + Math.sin(t * 2.2) * 1.5) * s.hub.led : 0;
        const th = s.thermostat, thKey = th.status === 'offline' ? -1 : th.status === 'fault' ? -2 : Math.round(th.target) * 10000 + Math.round(th.current * 10);
        if (thKey !== thermoShown) {
          thermoShown = thKey;
          if (thKey === -1) thermoText('--', '');
          else if (thKey === -2) thermoText('!!', 'no network');
          else thermoText(`${Math.round(th.target)}°C`, `now ${th.current.toFixed(1)}°`);
        }
      },
    };
  },

  prompts: [
    {
      chip: 'I\'m away for a week. Make the place look lived in, and don\'t let my plants die.',
      keywords: ['away', 'sunday', 'week', 'lived', 'plants', 'die', 'holiday', 'trip', 'travel', 'gone', 'vacation'],
      expect: { 'pump.status': 'fault', 'thermostat.target': 21 },
      steps: [
        { beat: 'plan' },
        { say: 'Got it. Let me see what I have to work with.' },
        { status: 'Checking connected devices' },
        { say: 'Six devices: the floor lamp, the blinds, the soil sensor, the pump, the door camera and the thermostat. Here\'s what I\'d do — nothing runs until you approve.' },
        { plan: { intro: 'Plan for the week you\'re away:', steps: [
          { text: 'Evenings: lamp on a varied schedule between 18:30 and 23:00, like someone is home', alt: { text: 'Evenings: lamp on at a fixed 19:00–22:00', apply: [{ set: 'plan.lampFixed', to: true }] } },
          { text: 'Blinds close as the sun sets, open again at 08:00' },
          { text: 'Water the plant for 40 seconds whenever soil moisture drops below 30%' },
          { text: 'Door camera armed; I\'ll message you if anyone comes to the door' },
          { text: 'Thermostat held at 18°C to save energy, back to 21°C the afternoon you\'re due home', alt: { text: 'Thermostat held at 20°C the whole time', apply: [{ set: 'plan.warm', to: true }] } },
        ] } },
        { beat: 'run' },
        { say: 'Approved. Running from now — I\'ll show you the week at speed.' },
        { status: 'Friday 17:40' },
        { parallel: [{ tween: 'env.hour', to: 17.67, ms: 1500 }, { fn: ({ store, tween }) => tween('thermostat.target', store.get('plan.warm') ? 20 : 18, 1200) }] },
        { set: 'camera.armed', to: true, label: 'Door camera armed' },
        { parallel: [{ tween: 'env.hour', to: 18.58, ms: 3000 }, { fn: ({ store, tween }) => tween('thermostat.current', store.get('plan.warm') ? 20.3 : 18.4, 3000) }] },
        { status: 'Friday 18:35' },
        { fn: (c) => say(c, c.store.get('plan.lampFixed') ? '18:35 — sun\'s going. Blinds closing; the lamp waits for 19:00, as you set it.' : '18:35 — sun\'s going. Lamp on at 70%, blinds closing.') },
        // Fixed schedule: blinds close first, the lamp comes on at 19:00.
        { fn: async (c) => { if (!c.store.get('plan.lampFixed')) return; await Promise.all([c.tween('blinds.closed', 1, 3000), c.tween('env.hour', 19, 3000)]); c.status('Friday 19:00'); await say(c, '19:00 — lamp on at 70%.'); } },
        { set: 'lamp.on', to: true },
        { parallel: [{ tween: 'blinds.closed', to: 1, ms: 3000, label: 'Blinds → closing' }, { tween: 'env.hour', to: 19.6, ms: 3000 }, { tween: 'lamp.brightness', to: 0.7, ms: 1200, label: 'Lamp → 70%' }] },
        { wait: 700 },
        { fn: (c) => say(c, c.store.get('plan.lampFixed') ? 'Overnight — lamp off at 22:00 as you set it. Blinds stay closed.' : 'Overnight — lamp off at 22:50 tonight, 22:25 tomorrow. Never the same minute twice. Blinds stay closed.') },
        { parallel: [{ tween: 'env.hour', to: 22.9, ms: 2500 }, { tween: 'lamp.brightness', to: 0, ms: 1600, label: 'Lamp → off' }] },
        { set: 'lamp.on', to: false },
        { status: 'Saturday 08:00' },
        { parallel: [{ tween: 'env.hour', to: 32, ms: 2000 }, { tween: 'soil.moisture', to: 31, ms: 2000 }] },
        { say: 'Saturday 08:00 — soil is drifting down: 31%. Opening the blinds.' },
        { tween: 'blinds.closed', to: 0, ms: 2000, label: 'Blinds → open' },
        { status: 'Saturday 14:20' },
        { parallel: [{ tween: 'env.hour', to: 38.33, ms: 1500 }, { tween: 'soil.moisture', to: 29, ms: 1500 }] },
        { say: '14:20 — soil at 29%. Starting a 40-second watering.' },
        { set: 'pump.status', to: 'busy' }, { set: 'pump.running', to: true, label: 'Pump → running' },
        { wait: 1800 },
        { beat: 'recover' },
        { fail: 'pump', say: 'The pump stopped answering six seconds into the watering. Soil is still at 29%.' },
        { set: 'pump.running', to: false },
        { say: 'I\'m not going to keep poking a device that isn\'t answering. Here\'s what I\'ve changed while it\'s out:' },
        { replan: { intro: 'Re-planned around the pump:', changes: ['Watering paused — no retries on a device that isn\'t responding', 'Blinds also half-close in the afternoons, so the plant gets less direct sun and dries slower', 'Lamp, camera and thermostat continue exactly as planned', 'I\'ll ping the pump once an hour and tell you the moment it\'s back'], needsYou: 'Check the pump\'s hose and power when you\'re home. If the soil drops below 20% before then, I\'ll message you so someone can water it by hand.' } },
        { tween: 'blinds.closed', to: 0.5, ms: 2000, label: 'Blinds → 50%' },
        { status: 'Next Friday 16:00' },
        { set: 'env.hour', to: 182.4 }, // same time of day a week on: no day/night flicker on the jump
        { parallel: [{ tween: 'env.hour', to: 184, ms: 2000 }, { tween: 'soil.moisture', to: 22, ms: 2000 }] },
        { fn: (c) => say(c, `Next Friday 16:00 — you're due back. ${c.store.get('plan.warm') ? 'Thermostat back to 21°C' : 'Thermostat going from 18°C back to 21°C'}, blinds open, lamp schedule ends tonight. The pump never came back. Soil is at 22%: dry, but it never went under 20%. Water the plant tonight and check the pump.`) },
        { parallel: [{ tween: 'thermostat.target', to: 21, ms: 1200, label: 'Thermostat → 21°C' }, { fn: ({ store, tween }) => tween('thermostat.current', store.get('plan.warm') ? 20.8 : 20.6, 2500) }, { tween: 'blinds.closed', to: 0, ms: 2000 }] },
        { end: KS_END },
      ],
    },
    {
      chip: 'Just keep the plants alive while I\'m gone.',
      keywords: ['plants', 'alive', 'water', 'watering', 'plant', 'soil', 'dry'],
      expect: { 'soil.status': 'fault', 'pump.running': false },
      steps: [
        { beat: 'plan' },
        { say: 'Only the plant, then. I\'ll use the soil sensor, the pump and the blinds — the blinds because afternoon sun is what dries the pot out.' },
        { plan: { intro: 'Plant-only plan:', steps: [
          { text: 'Water for 40 seconds whenever soil moisture drops below 30%, never more than twice a day', alt: { text: 'Water for 40 seconds every morning at 08:00, regardless of the sensor', apply: [{ set: 'plan.timed', to: true }] } },
          { text: 'Blinds half-closed between 13:00 and 17:00 to keep direct sun off the pot' },
          { text: 'Message you if the sensor reads below 20% or the pump fails' },
        ] } },
        { beat: 'run' },
        { say: 'Running. Fast-forwarding to Saturday.' },
        { status: (store) => (store.get('plan.timed') ? 'Saturday 08:00' : 'Saturday 11:20') },
        // Moisture rule: water when the soil reads under 30% (11:20). Timed schedule: water at 08:00 whatever it reads.
        { fn: ({ store, tween }) => { const timed = store.get('plan.timed'); return Promise.all([tween('env.hour', timed ? 32 : 35.33, 2500), tween('soil.moisture', timed ? 31 : 29, 2500)]); } },
        { fn: (c) => say(c, c.store.get('plan.timed') ? '08:00 — scheduled watering, 40 seconds. Soil reads 31%; you asked me not to wait for the sensor.' : '11:20 — soil at 29%, under the 30% line. Watering for 40 seconds.') },
        { set: 'pump.status', to: 'busy' }, { set: 'pump.running', to: true, label: 'Pump → running' },
        { tween: 'soil.moisture', to: 41, ms: 2500 },
        { set: 'pump.running', to: false }, { set: 'pump.status', to: 'online', label: 'Pump → idle' },
        { say: 'Done — 41%. The sensor confirmed the water arrived, so I know the pump actually pumped.' },
        { status: 'Saturday 13:00' },
        { parallel: [{ tween: 'env.hour', to: 37, ms: 2000 }, { tween: 'blinds.closed', to: 0.5, ms: 2000, label: 'Blinds → 50%' }, { tween: 'soil.moisture', to: 39, ms: 2000 }] },
        { status: 'Sunday 07:10' },
        { parallel: [{ tween: 'env.hour', to: 55.17, ms: 2500 }, { tween: 'blinds.closed', to: 0, ms: 1500 }, { tween: 'soil.moisture', to: 33, ms: 2500 }] },
        { beat: 'recover' },
        { fail: 'soil', say: 'The soil sensor stopped reporting at 07:10. Last reading: 33%.' },
        { say: 'Without the sensor I can\'t see the soil, so I won\'t pretend to. Here\'s what that means:' },
        { fn: ({ chat, store }) => chat.replan(store.get('plan.timed')
          ? { intro: 'Your 08:00 schedule carries on:', changes: ['The 40-second watering at 08:00 stays — it never depended on the sensor', 'What I lose is the check: I can\'t confirm the water lands, or warn you below 20%', 'Blinds stay half-closed in the afternoons', 'Sensor is polled every 10 minutes; I\'ll tell you the moment it\'s back'], needsYou: 'The sensor probe may have been knocked out of the soil. Push it back in when you\'re home.' }
          : { intro: 'Switched to a conservative schedule:', changes: ['One 30-second watering per day at 08:00 — enough to keep a pot alive, not enough to drown it', 'Blinds stay half-closed in the afternoons', 'Sensor is polled every 10 minutes; the moment it\'s back I return to moisture-based watering'], needsYou: 'The sensor probe may have been knocked out of the soil. Push it back in when you\'re home.' }) },
        { wait: 700 },
        { status: 'Sunday 08:00' },
        { tween: 'env.hour', to: 56, ms: 1200 },
        { fn: (c) => say(c, c.store.get('plan.timed') ? '08:00 — your scheduled 40 seconds.' : '08:00 — the fallback watering, 30 seconds.') },
        { set: 'pump.status', to: 'busy' }, { set: 'pump.running', to: true, label: 'Pump → running' },
        { fn: ({ store, sleep }) => sleep(store.get('plan.timed') ? 2000 : 1500) },
        { set: 'pump.running', to: false }, { set: 'pump.status', to: 'online', label: 'Pump → idle' },
        { say: 'Done. With the sensor out I can\'t see whether it reached the soil, so I\'m not saying it did.' },
        { end: { headline: 'It didn\'t guess.', body: 'When the sensor went quiet, NeuCharBox said so, watered on a fixed daily schedule, and stopped claiming the water had landed. Then it told you exactly what to fix.' } },
      ],
    },
    {
      chip: 'Make it look like someone\'s home in the evenings.',
      keywords: ['look', 'someone', 'home', 'evenings', 'evening', 'lived', 'occupied', 'burglar', 'security', 'lights'],
      expect: { 'blinds.status': 'fault', 'lamp.on': false, 'blinds.closed': 0.4 },
      steps: [
        { beat: 'plan' },
        { say: 'Presence, then. Lamp, blinds and the door camera. The trick is variation — a light that switches at the same minute every day is easy to spot from the street.' },
        { plan: { intro: 'Evening presence plan:', steps: [
          { text: 'Lamp on between 18:20 and 18:50, off between 22:40 and 23:20 — different minute each day' },
          { text: 'Blinds close 10 minutes after the lamp comes on, open at 08:00' },
          { text: 'Door camera armed; I message you on motion, and I don\'t record when there isn\'t any', alt: { text: 'Door camera off entirely', apply: [{ set: 'plan.noCam', to: true }] } },
        ] } },
        { beat: 'run' },
        { status: 'Friday 18:32' },
        { fn: ({ store }) => { if (!store.get('plan.noCam')) store.set('camera.armed', true); } },
        { tween: 'env.hour', to: 18.53, ms: 1500 },
        { say: '18:32 — lamp on.' },
        { set: 'lamp.on', to: true },
        { tween: 'lamp.brightness', to: 0.75, ms: 1200, label: 'Lamp → 75%' },
        { tween: 'env.hour', to: 18.7, ms: 1000 },
        { say: '18:42 — closing the blinds.' },
        { parallel: [{ tween: 'blinds.closed', to: 0.4, ms: 1600, label: 'Blinds → closing' }, { tween: 'env.hour', to: 18.75, ms: 1600 }] },
        { beat: 'recover' },
        { fail: 'blinds', say: 'The blinds stopped at 40% and the motor reports a stall.' },
        { say: 'I\'ve stopped driving the motor — forcing a stalled blind is how you break one. Re-planned:' },
        { fn: ({ chat, store }) => chat.replan({ intro: 'Presence without the blinds:', changes: ['Lamp schedule continues; I\'ve moved it 20% brighter so the room still reads as occupied through a half-open blind', store.get('plan.noCam') ? 'Camera stays off, as you chose' : 'Camera stays armed', 'Blinds left at 40%; one gentle retry at 08:00, then I leave it alone'], needsYou: 'Something is probably caught in the blind track. Check it when you\'re back.' }) },
        { wait: 700 },
        { tween: 'lamp.brightness', to: 0.9, ms: 1200, label: 'Lamp → 90%' },
        { status: 'Friday 23:05' },
        { parallel: [{ tween: 'env.hour', to: 23.08, ms: 2000 }] },
        { say: '23:05 — lamp off. Tomorrow it\'ll be 22:48. And no, I won\'t tell anyone the pattern.' },
        { parallel: [{ tween: 'lamp.brightness', to: 0, ms: 1400, label: 'Lamp → off' }] },
        { set: 'lamp.on', to: false },
        { end: { headline: 'It stopped instead of forcing it.', body: 'A stalled motor is a device telling you something. NeuCharBox listened, kept the rest of the plan working, and told you what to look at.' } },
      ],
    },
    {
      chip: 'Hold the house at 19°C and tell me if anyone comes to the door.',
      keywords: ['hold', 'house', '19', 'degrees', 'temperature', 'heating', 'thermostat', 'door', 'anyone', 'comes', 'visitor', 'delivery', 'parcel'],
      expect: { 'thermostat.status': 'online', 'thermostat.target': 19, 'camera.motion': false },
      steps: [
        { beat: 'plan' },
        { say: 'Two jobs: heating and the front door. I\'ll use the thermostat and the door camera — nothing else needs to be involved.' },
        { plan: { intro: 'Plan:', steps: [
          { text: 'Thermostat set to 19°C and held there; I message you if the room drifts more than 2° from it' },
          { text: 'Door camera armed. On motion I send you a still and a one-line note — no continuous recording', alt: { text: 'On motion I send you a note only, no image', apply: [{ set: 'plan.noImage', to: true }] } },
        ] } },
        { beat: 'run' },
        { status: 'Friday 17:00' },
        { parallel: [{ tween: 'env.hour', to: 17, ms: 1200 }, { tween: 'thermostat.target', to: 19, ms: 1200, label: 'Thermostat → 19°C' }, { tween: 'thermostat.current', to: 19.2, ms: 3000 }] },
        { set: 'camera.armed', to: true, label: 'Door camera armed' },
        { status: 'Saturday 14:02' },
        { parallel: [{ tween: 'env.hour', to: 38.03, ms: 2500 }] },
        { set: 'camera.motion', to: true, label: 'Motion at the door' },
        { fn: (c) => say(c, c.store.get('plan.noImage') ? 'Saturday 14:02 — motion at the door for 40 seconds. No image, as you chose, so I can\'t tell you who it was.' : 'Saturday 14:02 — someone at the door for 40 seconds. Still attached: a courier, parcel left by the mat.') },
        { wait: 1200 },
        { set: 'camera.motion', to: false },
        { status: 'Sunday 03:15' },
        { parallel: [{ tween: 'env.hour', to: 51.25, ms: 2500 }, { tween: 'thermostat.current', to: 18.9, ms: 2500 }] },
        { beat: 'recover' },
        { fail: 'thermostat', say: 'Sunday 03:15 — the thermostat stopped responding. Last reading 18.9°C.' },
        { say: 'I can\'t see or set the temperature right now, and I\'m not going to assume it\'s fine. Here\'s what I\'m doing:' },
        { replan: { intro: 'Heating is unverified:', changes: ['Camera and door alerts continue — they don\'t depend on the thermostat', 'I\'ll keep trying the thermostat every 15 minutes', 'If it\'s still silent by 07:00 I\'ll message you again so you can decide whether to call someone'], needsYou: 'The thermostat may have dropped off the network. Power-cycle it when you\'re home, or ask a neighbour if it\'s cold.' } },
        { status: 'Sunday 06:40' },
        { parallel: [{ tween: 'env.hour', to: 54.67, ms: 2000 }] },
        { set: 'thermostat.status', to: 'online', label: 'Thermostat back' },
        { tween: 'thermostat.current', to: 18.7, ms: 1500 },
        { say: '06:40 — the thermostat came back on its own. Room is 18.7°C, down 0.2° from its last reading. I can\'t see what happened in between. Holding 19°C again.' },
        { end: { headline: 'It told you what it couldn\'t verify.', body: 'A quiet device isn\'t a working device. NeuCharBox separates "I did it" from "I checked it" — and says which one it is.' } },
      ],
    },
  ],
};
