// Scene 1 — Home, away for a week. Proves: say what you want, never name a device.

const KS_END = { headline: 'You never named a device. You never wrote a rule.', body: 'You said what you wanted. NeuCharBox found the devices, wrote the plan, waited for your approval, ran it, and re-planned around a failure instead of hiding it.' };

export default {
  id: 'home',
  title: 'Home, away for a week',
  startHour: 16.5,
  camera: { position: [2.9, 1.75, 3.3], target: [-0.1, 0.85, -0.9], minDistance: 1.6, maxDistance: 6.5 },
  setupIntro: 'This is NeuCharBox, on the side table. Plug it in to start.',
  askIntro: 'You\'re leaving for a week on Friday. What do you want the house to do while you\'re gone? Pick one, or type your own.',
  deviceOrder: ['lamp', 'blinds', 'soil', 'pump', 'camera', 'thermostat'],
  devices: {
    lamp:       { icon: 'lamp', name: 'Floor lamp', initial: { on: false, brightness: 0 }, format: (s) => (s.on || s.brightness > 0.02 ? `on · ${Math.round(s.brightness * 100)}%` : 'off'), faultText: 'not responding' },
    blinds:     { icon: 'blinds', name: 'Blinds', initial: { closed: 0 }, format: (s) => `${Math.round(s.closed * 100)}% closed`, faultText: 'motor stalled' },
    soil:       { icon: 'moisture', name: 'Soil sensor', initial: { moisture: 34 }, format: (s) => `${s.moisture.toFixed(0)}% moisture`, faultText: 'no reading' },
    pump:       { icon: 'pump', name: 'Water pump', initial: { running: false }, format: (s) => (s.running ? 'running' : 'idle'), faultText: 'not responding' },
    camera:     { icon: 'camera', name: 'Door camera', initial: { armed: false, motion: false }, format: (s) => (s.armed ? (s.motion ? 'motion at door' : 'armed · no motion') : 'standby'), faultText: 'offline' },
    thermostat: { icon: 'thermostat', name: 'Thermostat', initial: { target: 21, current: 21.4 }, format: (s) => `${s.target.toFixed(0)}° set · ${s.current.toFixed(1)}° now`, faultText: 'unreachable' },
  },

  build({ R, P, M, THREE, store }) {
    R.scene.background = new THREE.Color(0xDCEBF3);
    P.roomShell({ w: 5, d: 5, h: 2.8, window: { x: 0.7, y: 1.55, ww: 1.7, wh: 1.36 } });
    const slats = P.blinds(0.7, 2.14, -2.42, 1.52, 12);
    P.sofa(0.5, -1.95);
    P.rug(0.5, -0.55); P.table(0.5, -0.6, 1.0, 0.5); P.box(0.18, 0.025, 0.25, M.art, 0.3, 0.45, -0.6);
    const plant = P.plant(-1.9, -1.75);
    P.box(0.018, 0.34, 0.018, M.metal, -1.74, 0.5, -1.66); const sensorHead = P.box(0.06, 0.05, 0.03, M.hub, -1.74, 0.69, -1.66);
    const pump = P.box(0.26, 0.2, 0.2, M.black, -1.35, 0.1, -1.5, 0.02);
    P.tube([[-1.45, 0.16, -1.5], [-1.62, 0.3, -1.58], [-1.8, 0.47, -1.68], [-1.88, 0.45, -1.72]]);
    const pumpLed = P.ledDot(-1.35, 0.21, -1.39, 0x2FBF71);
    const lamp = P.floorLamp(1.95, -1.6);
    P.table(-1.75, -0.3, 0.6, 0.42, 0.55, M.wood, M.black);
    const hub = P.hub(-1.75, 0.57, -0.3); R.addPickable(hub.group, 'hub');
    const phone = P.phone(-1.55, 0.575, -0.22, -0.4);
    P.doorLeft(-2.5, 1.2);
    const cam = P.smallCamera(-2.44, 2.28, 1.2, Math.PI / 2);
    P.picture(-2.48, 1.6, -1.0);
    // thermostat on the left wall
    const thermo = P.box(0.03, 0.11, 0.11, M.white, -2.485, 1.45, 0.1, 0.01);
    const thermoScreen = P.screenPlane(0.07, 0.04, null); thermoScreen.rotation.y = Math.PI / 2; thermoScreen.position.set(-2.468, 1.46, 0.1); thermoScreen.material.emissiveIntensity = 0.7;
    let thermoShown = null;
    function thermoText(t) { if (thermoShown === t) return; thermoShown = t; const c = document.createElement('canvas'); c.width = 128; c.height = 72; const g = c.getContext('2d'); g.fillStyle = '#0B0F14'; g.fillRect(0, 0, 128, 72); g.fillStyle = '#9FE3F0'; g.font = '40px Inter, "Segoe UI", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t + '°', 64, 38); const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; thermoScreen.material.map = tex; thermoScreen.material.emissiveMap = tex; thermoScreen.material.needsUpdate = true; }
    thermoText('--');

    R.addPickable(lamp.group, 'lamp'); R.addPickable(lamp.shade, 'lamp');
    slats.forEach((s) => R.addPickable(s, 'blinds'));
    R.addPickable(sensorHead, 'soil'); R.addPickable(plant.pot, 'soil');
    R.addPickable(pump, 'pump'); R.addPickable(cam.group, 'camera'); R.addPickable(thermo, 'thermostat');

    const hi = P.highlighter({ lamp: [lamp.shade], blinds: slats, soil: [sensorHead, plant.pot], pump: [pump], camera: [cam.group.children[0]], thermostat: [thermo] });

    return {
      focus: hi.focus,
      update(s, t) {
        hi.update();
        R.daylight(s.env.hour);
        slats.forEach((sl) => (sl.rotation.x = s.blinds.closed * 1.3));
        const b = s.lamp.brightness; lamp.bulb.intensity = b * 9; lamp.bulbMesh.material.emissiveIntensity = b * 3; lamp.shadeMat.emissiveIntensity = b * 0.35;
        const bad = s.pump.status === 'fault', blink = Math.floor(t * 3) % 2 === 0;
        pumpLed.material.color.set(bad ? 0xE0563A : s.pump.running ? 0x3AB7FF : 0x2FBF71); pumpLed.material.emissive.copy(pumpLed.material.color); pumpLed.material.emissiveIntensity = bad ? (blink ? 6 : 1) : s.pump.running ? 4 : 2;
        pumpLed.visible = s.pump.status !== 'offline';
        cam.led.material.color.set(s.camera.status === 'fault' ? 0xE0563A : s.camera.armed ? (s.camera.motion ? 0xFFB020 : 0xE0563A) : 0x2FBF71); cam.led.material.emissive.copy(cam.led.material.color); cam.led.visible = s.camera.status !== 'offline';
        const hubOn = s.hub.status === 'on'; hub.ledMat.emissiveIntensity = hubOn ? (2.5 + Math.sin(t * 2.2) * 1.5) * s.hub.led : 0;
        thermoText(s.thermostat.status === 'offline' ? '--' : s.thermostat.status === 'fault' ? '!!' : String(Math.round(s.thermostat.target)));
      },
    };
  },

  prompts: [
    {
      chip: 'I\'m away until Sunday. Make the place look lived in, and don\'t let my plants die.',
      keywords: ['away', 'sunday', 'week', 'lived', 'plants', 'die', 'holiday', 'trip', 'travel', 'gone', 'vacation'],
      expect: { 'pump.status': 'fault', 'thermostat.target': 21 },
      steps: [
        { beat: 'plan' },
        { say: 'Got it. Let me see what I have to work with.' },
        { status: 'Checking connected devices' },
        { say: 'Six devices: the floor lamp, the blinds, the soil sensor, the pump, the door camera and the thermostat. Here\'s what I\'d do — nothing runs until you approve.' },
        { plan: { intro: 'Plan for Friday to Sunday:', steps: [
          { text: 'Evenings: lamp on a varied schedule between 18:30 and 23:00, like someone is home', alt: { text: 'Evenings: lamp on at a fixed 19:00–22:00', apply: [{ set: 'plan.lampFixed', to: true }] } },
          { text: 'Blinds close as the sun sets, open again at 08:00' },
          { text: 'Water the plant for 40 seconds whenever soil moisture drops below 30%' },
          { text: 'Door camera armed; I\'ll message you if anyone comes to the door' },
          { text: 'Thermostat held at 18° to save energy, back to 21° on Sunday afternoon', alt: { text: 'Thermostat held at 20° the whole time', apply: [{ set: 'plan.warm', to: true }] } },
        ] } },
        { beat: 'run' },
        { say: 'Approved. Running from now — I\'ll show you the weekend at speed.' },
        { status: 'Friday 17:40' },
        { parallel: [{ tween: 'env.hour', to: 18.6, ms: 2500 }, { fn: ({ store }) => store.tween('thermostat.target', store.get('plan.warm') ? 20 : 18, 1200) }] },
        { set: 'camera.armed', to: true, label: 'Door camera armed' },
        { tween: 'thermostat.current', to: 18.4, ms: 3000 },
        { status: 'Friday 18:35' },
        { say: '18:35 — sun\'s going. Lamp on at 70%, blinds closing.' },
        { set: 'lamp.on', to: true },
        { parallel: [{ tween: 'lamp.brightness', to: 0.7, ms: 1200, label: 'Lamp → 70%' }, { tween: 'blinds.closed', to: 1, ms: 3000, label: 'Blinds → closing' }, { tween: 'env.hour', to: 19.6, ms: 3000 }] },
        { wait: 700 },
        { fn: ({ chat, store }) => chat.ncb(store.get('plan.lampFixed') ? 'Overnight — lamp off at 22:00 as you set it. Blinds stay closed.' : 'Overnight — lamp off at 23:10 tonight, 22:40 tomorrow. Never the same minute twice. Blinds stay closed.') },
        { parallel: [{ tween: 'env.hour', to: 23.3, ms: 2500 }, { tween: 'lamp.brightness', to: 0, ms: 1600, label: 'Lamp → off' }] },
        { set: 'lamp.on', to: false },
        { status: 'Saturday 08:00' },
        { say: 'Saturday 08:00 — blinds open. Soil moisture is drifting down: 31%.' },
        { parallel: [{ tween: 'env.hour', to: 32, ms: 2500 }, { tween: 'blinds.closed', to: 0, ms: 2500, label: 'Blinds → open' }, { tween: 'soil.moisture', to: 31, ms: 2500 }] },
        { status: 'Saturday 14:20' },
        { say: '14:20 — soil at 29%. Starting a 40-second watering.' },
        { parallel: [{ tween: 'env.hour', to: 38.3, ms: 1500 }, { tween: 'soil.moisture', to: 29, ms: 1000 }] },
        { set: 'pump.status', to: 'busy' }, { set: 'pump.running', to: true, label: 'Pump → running' },
        { wait: 1800 },
        { beat: 'recover' },
        { fail: 'pump', say: 'The pump stopped answering six seconds into the watering. Soil is still at 29%.' },
        { set: 'pump.running', to: false },
        { say: 'I\'m not going to keep poking a device that isn\'t answering. Here\'s what I\'ve changed while it\'s out:' },
        { replan: { intro: 'Re-planned around the pump:', changes: ['Watering paused — no retries on a device that isn\'t responding', 'Blinds half-closed on the plant side so it gets less afternoon sun and dries slower', 'Lamp, blinds and camera continue exactly as planned', 'I\'ll ping the pump once an hour and tell you the moment it\'s back'], needsYou: 'Check the pump\'s hose and power when you\'re home. Nothing else needs you.' } },
        { tween: 'blinds.closed', to: 0.5, ms: 2000, label: 'Blinds → 50%' },
        { status: 'Sunday 16:00' },
        { fn: ({ chat, store }) => chat.ncb(`Sunday 16:00 — you're due back. ${store.get('plan.warm') ? 'Thermostat back to 21°' : 'Thermostat going from 18° back to 21°'}, blinds open, lamp schedule ends tonight. The plant is at 27% — fine for a day, but the pump still needs you.`) },
        { parallel: [{ tween: 'env.hour', to: 64, ms: 2500 }, { tween: 'thermostat.target', to: 21, ms: 1200, label: 'Thermostat → 21°' }, { tween: 'thermostat.current', to: 20.6, ms: 2500 }, { tween: 'blinds.closed', to: 0, ms: 2000 }, { tween: 'soil.moisture', to: 27, ms: 2500 }] },
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
        { say: 'Running. Fast-forwarding to Saturday afternoon.' },
        { status: 'Saturday 13:00' },
        { parallel: [{ tween: 'env.hour', to: 37, ms: 2500 }, { tween: 'blinds.closed', to: 0.5, ms: 2500, label: 'Blinds → 50%' }, { tween: 'soil.moisture', to: 30.5, ms: 2500 }] },
        { status: 'Saturday 15:10' },
        { say: '15:10 — moisture crossed 30%. Watering for 40 seconds.' },
        { set: 'pump.status', to: 'busy' }, { set: 'pump.running', to: true, label: 'Pump → running' },
        { tween: 'soil.moisture', to: 41, ms: 2500 },
        { set: 'pump.running', to: false }, { set: 'pump.status', to: 'online', label: 'Pump → idle' },
        { say: 'Done — 41%. Sensor confirmed the water arrived, so I know the pump actually pumped.' },
        { status: 'Sunday 09:40' },
        { parallel: [{ tween: 'env.hour', to: 57.6, ms: 2500 }, { tween: 'blinds.closed', to: 0, ms: 1500 }, { tween: 'soil.moisture', to: 33, ms: 2500 }] },
        { beat: 'recover' },
        { fail: 'soil', say: 'The soil sensor stopped reporting at 09:40. Last reading: 33%.' },
        { say: 'Without the sensor I can\'t see the soil, so I won\'t pretend to. Here\'s the fallback:' },
        { replan: { intro: 'Switched to a conservative schedule:', changes: ['One 30-second watering per day at 08:00 — enough to keep a pot alive, not enough to drown it', 'Blinds stay half-closed in the afternoons', 'Sensor is polled every 10 minutes; the moment it\'s back I return to moisture-based watering'], needsYou: 'The sensor probe may have been knocked out of the soil. Push it back in when you\'re home.' } },
        { tween: 'blinds.closed', to: 0.5, ms: 1500, label: 'Blinds → 50%' },
        { end: { headline: 'It didn\'t guess.', body: 'When the sensor went quiet, NeuCharBox switched to a safe schedule and told you exactly what to fix — instead of watering blind or doing nothing.' } },
      ],
    },
    {
      chip: 'Make it look like someone\'s home in the evenings.',
      keywords: ['look', 'someone', 'home', 'evenings', 'evening', 'lived', 'occupied', 'burglar', 'security', 'lights'],
      expect: { 'blinds.status': 'fault', 'lamp.on': false, 'blinds.closed': 0.4 },
      steps: [
        { beat: 'plan' },
        { say: 'Presence, then. Lamp, blinds and the door camera. The trick is variation — a light that comes on at exactly 19:00 every day looks more empty, not less.' },
        { plan: { intro: 'Evening presence plan:', steps: [
          { text: 'Lamp on between 18:20 and 18:50, off between 22:40 and 23:20 — different minute each day' },
          { text: 'Blinds close 10 minutes after the lamp comes on, open at 08:00' },
          { text: 'Door camera armed; I message you on motion, and I don\'t record when there isn\'t any', alt: { text: 'Door camera off entirely', apply: [{ set: 'plan.noCam', to: true }] } },
        ] } },
        { beat: 'run' },
        { status: 'Friday 18:32' },
        { fn: ({ store }) => { if (!store.get('plan.noCam')) store.set('camera.armed', true); } },
        { say: '18:32 — lamp on.' },
        { set: 'lamp.on', to: true },
        { parallel: [{ tween: 'env.hour', to: 18.7, ms: 1500 }, { tween: 'lamp.brightness', to: 0.75, ms: 1200, label: 'Lamp → 75%' }] },
        { say: '18:42 — closing the blinds.' },
        { parallel: [{ tween: 'blinds.closed', to: 0.4, ms: 1600, label: 'Blinds → closing' }, { tween: 'env.hour', to: 19.0, ms: 1600 }] },
        { beat: 'recover' },
        { fail: 'blinds', say: 'The blinds stopped at 40% and the motor reports a stall.' },
        { say: 'I\'ve stopped driving the motor — forcing a stalled blind is how you break one. Re-planned:' },
        { replan: { intro: 'Presence without the blinds:', changes: ['Lamp schedule continues; I\'ve moved it 20% brighter so the room still reads as occupied through a half-open blind', 'Camera stays armed', 'Blinds left at 40%; one gentle retry at 08:00, then I leave it alone'], needsYou: 'Something is probably caught in the blind track. Check it when you\'re back.' } },
        { tween: 'lamp.brightness', to: 0.9, ms: 1200, label: 'Lamp → 90%' },
        { status: 'Friday 23:05' },
        { parallel: [{ tween: 'env.hour', to: 23.1, ms: 2000 }] },
        { say: '23:05 — lamp off. Tomorrow it\'ll be 22:48. And no, I won\'t tell anyone the pattern.' },
        { parallel: [{ tween: 'lamp.brightness', to: 0, ms: 1400, label: 'Lamp → off' }] },
        { set: 'lamp.on', to: false },
        { end: { headline: 'It stopped instead of forcing it.', body: 'A stalled motor is a device telling you something. NeuCharBox listened, kept the rest of the plan working, and told you what to look at.' } },
      ],
    },
    {
      chip: 'Hold the house at 19° and tell me if anyone comes to the door.',
      keywords: ['hold', 'house', '19', 'degrees', 'temperature', 'heating', 'thermostat', 'door', 'anyone', 'comes', 'visitor', 'delivery', 'parcel'],
      expect: { 'thermostat.status': 'online', 'thermostat.target': 19, 'camera.motion': false },
      steps: [
        { beat: 'plan' },
        { say: 'Two jobs: heating and the front door. I\'ll use the thermostat and the door camera — nothing else needs to be involved.' },
        { plan: { intro: 'Plan:', steps: [
          { text: 'Thermostat set to 19° and held there; I message you if the room drifts more than 2° from it' },
          { text: 'Door camera armed. On motion I send you a still and a one-line note — no continuous recording', alt: { text: 'On motion I send you a note only, no image', apply: [{ set: 'plan.noImage', to: true }] } },
        ] } },
        { beat: 'run' },
        { status: 'Friday 17:00' },
        { parallel: [{ tween: 'thermostat.target', to: 19, ms: 1200, label: 'Thermostat → 19°' }, { tween: 'thermostat.current', to: 19.2, ms: 3000 }] },
        { set: 'camera.armed', to: true, label: 'Door camera armed' },
        { status: 'Saturday 14:02' },
        { parallel: [{ tween: 'env.hour', to: 38, ms: 2500 }] },
        { set: 'camera.motion', to: true, label: 'Motion at the door' },
        { fn: ({ chat, store }) => chat.ncb(store.get('plan.noImage') ? 'Saturday 14:02 — someone at the door for 40 seconds. They left a parcel by the mat.' : 'Saturday 14:02 — someone at the door for 40 seconds. Still attached: a courier, parcel left by the mat.') },
        { wait: 1200 },
        { set: 'camera.motion', to: false },
        { status: 'Sunday 03:15' },
        { parallel: [{ tween: 'env.hour', to: 51.2, ms: 2500 }] },
        { beat: 'recover' },
        { fail: 'thermostat', say: 'Sunday 03:15 — the thermostat stopped responding. Last reading 18.9°.' },
        { say: 'I can\'t see or set the temperature right now, and I\'m not going to assume it\'s fine. Here\'s what I\'m doing:' },
        { replan: { intro: 'Heating is unverified:', changes: ['Camera and door alerts continue — they don\'t depend on the thermostat', 'I\'ll keep trying the thermostat every 15 minutes', 'If it\'s still silent by 07:00 I\'ll message you again so you can decide whether to call someone'], needsYou: 'The thermostat may have dropped off the network. Power-cycle it when you\'re home, or ask a neighbour if it\'s cold.' } },
        { status: 'Sunday 07:00' },
        { parallel: [{ tween: 'env.hour', to: 55, ms: 2000 }] },
        { set: 'thermostat.status', to: 'online', label: 'Thermostat back' },
        { tween: 'thermostat.current', to: 18.7, ms: 1500 },
        { say: '06:40 — the thermostat came back on its own. Room is 18.7°, so the heating never actually stopped. Holding 19° again.' },
        { end: { headline: 'It told you what it couldn\'t verify.', body: 'A quiet device isn\'t a working device. NeuCharBox separates "I did it" from "I checked it" — and says which one it is.' } },
      ],
    },
  ],
};
