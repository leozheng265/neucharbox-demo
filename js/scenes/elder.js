// Scene 3 — Elder care. Proves: sensing without cameras. "Mum's up · 7:12".

export default {
  id: 'elder',
  title: 'Elder care',
  startHour: 21.5,
  // Looks down over the partition from the hall side, so the bed, night light, door, hallway sensor and kettle are all
  // in view; the sway stays on the hall side (the motion sensor faces the hall) and high enough to see over the partition.
  camera: { position: [0.57, 6.13, 3.87], target: [0.3, 0.9, -1.5], minDistance: 2.5, maxDistance: 8, azimuth: [0.0, 0.22], fov: 48, fitAspect: 1.3 },
  setupIntro: 'Your mum\'s flat: bedroom on the left, hallway, kitchen on the right. No cameras anywhere. The hub is on the kitchen counter. Plug it in to start.',
  askIntro: 'What do you want to know, or have happen, without putting a camera in her home? Pick one, or type your own.',
  deviceOrder: ['mat', 'door', 'motion', 'kettle', 'night', 'hall'],
  devices: {
    mat:    { icon: 'bed', name: 'Bed sensor', initial: { pressed: true }, format: (s) => (s.pressed ? 'in bed' : 'out of bed'), faultText: 'no signal' },
    door:   { icon: 'door', name: 'Bedroom door', initial: { open: 0 }, format: (s) => (s.open > 0.5 ? 'open' : 'closed'), faultText: 'no signal' },
    motion: { icon: 'motion', name: 'Hallway motion', initial: { active: false, last: '—' }, format: (s) => (s.active ? 'movement now' : `last ${s.last}`), faultText: 'offline' },
    kettle: { icon: 'kettle', name: 'Kettle plug', initial: { on: false, watts: 0, minutes: 0 }, format: (s) => (s.on ? `on · ${Math.round(s.watts).toLocaleString('en-GB')} W · ${s.minutes.toFixed(0)} min` : 'off'), faultText: 'says off · 1,850 W' },
    night:  { icon: 'bulb', name: 'Night light', initial: { on: false, brightness: 0 }, format: (s) => (s.brightness > 0.02 ? `on · ${Math.round(s.brightness * 100)}%` : 'off'), faultText: 'no response' },
    hall:   { icon: 'bulb', name: 'Hall light', initial: { on: false, brightness: 0 }, format: (s) => (s.brightness > 0.02 ? `on · ${Math.round(s.brightness * 100)}%` : 'off'), faultText: 'no response' },
  },

  build({ R, P, M, THREE, store, parts }) {
    P.roomShell({ w: 7, d: 5, h: 2.7, window: { x: 1.9, y: 1.6, ww: 1.4, wh: 1.1 } });
    // partition between bedroom and hall with a doorway
    P.box(0.12, 2.7, 1.5, M.wall, -0.5, 1.35, -1.75); P.box(0.12, 2.7, 2.5, M.wall, -0.5, 1.35, 1.25); P.box(0.12, 0.6, 1.0, M.wall, -0.5, 2.4, -0.5);
    P.box(0.14, 2.12, 0.06, M.trim, -0.5, 1.06, -1.0); P.box(0.14, 2.12, 0.06, M.trim, -0.5, 1.06, 0.0); P.box(0.14, 0.06, 1.06, M.trim, -0.5, 2.11, -0.5);
    const doorPivot = new THREE.Group(); doorPivot.position.set(-0.5, 0, -0.97); R.scene.add(doorPivot);
    const doorLeaf = new THREE.Mesh(new THREE.BoxGeometry(0.04, 2.05, 0.9), M.door); doorLeaf.position.set(0, 1.025, 0.45); doorLeaf.castShadow = doorLeaf.receiveShadow = true; doorPivot.add(doorLeaf);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 12), M.metal); knob.position.set(0.04, 1.0, 0.8); doorPivot.add(knob);
    const contact = P.box(0.03, 0.02, 0.06, M.white, -0.415, 2.0, 0.0); // door contact on the hall face of the latch jamb
    // bedroom: bed, bedside table, night light, rug, picture
    P.box(1.05, 0.25, 1.95, M.woodLight, -2.3, 0.2, -1.5, 0.01); [[-0.48, -0.9], [0.48, -0.9], [-0.48, 0.9], [0.48, 0.9]].forEach((p) => P.box(0.06, 0.08, 0.06, M.wood, -2.3 + p[0], 0.04, -1.5 + p[1]));
    const mattress = P.box(0.98, 0.18, 1.85, M.bedding, -2.3, 0.415, -1.5, 0.03);
    P.box(0.9, 0.12, 0.65, M.cushion, -2.3, 0.53, -0.925, 0.04); P.box(0.7, 0.09, 0.4, M.white, -2.3, 0.53, -2.15, 0.03); // duvet folded at the foot, pillow
    P.box(1.05, 0.5, 0.06, M.woodLight, -2.3, 0.6, -2.45);
    const matMat = M.black.clone(); matMat.metalness = 0.1; matMat.roughness = 0.8;
    const mat = P.box(0.9, 0.012, 0.5, matMat, -2.3, 0.512, -1.6); // pressure strip across the middle of the mattress, left uncovered so its state shows
    P.table(-1.5, -2.2, 0.45, 0.4, 0.55, M.woodLight, M.woodLight);
    // night light: the floor-lamp parts cut down to a small lamp on the bedside table (no floor base)
    const nl = P.floorLamp(-1.5, -2.2, { y: 0.57, height: 0.635, shadeScale: 0.5, base: false }); nl.shade.castShadow = false; nl.bulb.distance = 4;
    P.rug(-2.0, -0.2, 1.6, 1.2); P.picture(-3.48, 1.6, -1.2, 0.6, 0.45);
    // hallway: motion sensor (small dome on a plate, high on the partition), hall pendant
    const pirPlate = P.box(0.015, 0.12, 0.12, M.white, -0.4325, 2.24, 0.6);
    const pir = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.white); pir.rotation.z = -Math.PI / 2; pir.position.set(-0.425, 2.25, 0.6); R.scene.add(pir);
    const pirLed = P.ledDot(-0.424, 2.197, 0.6, 0x2FBF71, 0.008);
    // invisible tap target (the sensor itself is only a few pixels on a phone), stretched toward the camera rather than
    // up, so on screen it covers the sensor and the wall below it but not the doorway behind it
    const pirHit = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial()); pirHit.visible = false; pirHit.scale.set(0.1, 0.13, 0.18); pirHit.position.set(-0.41, 2.24, 0.72); R.scene.add(pirHit);
    P.cyl(0.004, 0.004, 0.5, M.black, 0.5, 2.45, 0.6, 8); const pendant = P.add(new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.16, 32, 1, true), M.shade.clone())); pendant.position.set(0.5, 2.15, 0.6);
    const hallLight = new THREE.PointLight(0xFFE2B8, 0, 6, 1.6); hallLight.position.set(0.5, 2.05, 0.6); hallLight.castShadow = true; hallLight.shadow.mapSize.set(1024, 1024); hallLight.shadow.bias = -0.002; R.scene.add(hallLight);
    // kitchen: counter along the back wall, cabinets, kettle + plug, hub
    P.box(3.0, 0.05, 0.6, M.white, 1.9, 0.9, -2.2); P.box(3.0, 0.85, 0.58, M.woodLight, 1.9, 0.425, -2.2); for (let i = 0; i < 4; i++) P.box(0.02, 0.6, 0.03, M.metal, 0.6 + i * 0.75, 0.55, -1.9);
    P.box(0.75, 0.7, 0.35, M.white, 0.775, 2.1, -2.32); P.box(0.75, 0.7, 0.35, M.white, 3.025, 2.1, -2.32); P.box(0.5, 0.4, 0.3, M.metal, 2.9, 0.2, -1.0); // upper cabinets either side of the window, a bin
    // kettle and its smart plug on the wall right of the window
    const plug = P.box(0.08, 0.08, 0.02, M.white, 2.95, 1.15, -2.49); const plugLed = P.ledDot(2.97, 1.18, -2.478, 0x2FBF71, 0.006);
    const kettleBody = P.cyl(0.09, 0.11, 0.22, M.metal, 2.8, 1.035, -2.15, 24); P.cyl(0.02, 0.02, 0.1, M.black, 2.8, 1.16, -2.15, 12); P.box(0.02, 0.12, 0.06, M.black, 2.91, 1.06, -2.15, 0.005);
    const steam = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0 })); steam.position.set(2.82, 1.22, -2.15); R.scene.add(steam);
    const hub = P.hub(0.9, 0.925, -2.15, { rotY: 0.2 }); R.addPickable(hub.group, 'hub'); P.phone(1.25, 0.93, -2.05, 0.4);
    P.box(0.25, 0.3, 0.25, M.cardboard, 3.2, 1.075, -2.2); P.cyl(0.06, 0.06, 0.2, M.white, 1.6, 1.025, -2.2, 16); // a box, a mug-ish canister (clear of the window sill)
    P.table(1.8, 0.4, 0.9, 0.9, 0.75, M.woodLight, M.woodLight); P.box(0.42, 0.04, 0.42, M.woodLight, 1.1, 0.46, 0.4); [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]].forEach((p) => P.box(0.03, 0.46, 0.03, M.woodLight, 1.1 + p[0], 0.23, 0.4 + p[1])); P.box(0.42, 0.4, 0.03, M.woodLight, 1.1, 0.68, 0.6);

    R.addPickable(mat, 'mat'); R.addPickable(mattress, 'mat'); R.addPickable(doorPivot, 'door'); R.addPickable(contact, 'door'); R.addPickable(pir, 'motion'); R.addPickable(pirPlate, 'motion'); R.addPickable(pirLed, 'motion'); R.addPickable(pirHit, 'motion'); R.addPickable(kettleBody, 'kettle'); R.addPickable(plug, 'kettle'); R.addPickable(nl.shade, 'night'); R.addPickable(nl.pole, 'night'); R.addPickable(nl.bulbMesh, 'night'); R.addPickable(pendant, 'hall');
    const hi = P.highlighter({ mat: [mat, mattress], door: [doorLeaf], motion: [pir, pirPlate], kettle: [kettleBody], night: [nl.shade], hall: [pendant] });

    return {
      focus: hi.focus,
      update(s, t) {
        hi.update(); R.daylight(s.env.hour);
        hub.ledMat.emissiveIntensity = s.hub.status === 'on' ? (2.5 + Math.sin(t * 2.2) * 1.5) * s.hub.led : 0;
        doorPivot.rotation.y = -s.door.open * 1.4;
        const mBad = s.motion.status === 'fault';
        pirLed.material.color.set(mBad ? 0xE0563A : s.motion.active ? 0xFFB020 : 0x2FBF71); pirLed.material.emissive.copy(pirLed.material.color);
        pirLed.material.emissiveIntensity = s.motion.status === 'offline' ? 0 : mBad ? (Math.floor(t * 3) % 2 ? 6 : 1) : s.motion.active ? 6 : 1;
        plugLed.material.color.set(s.kettle.status === 'fault' ? 0xE0563A : s.kettle.on ? 0xFFB020 : 0x2FBF71); plugLed.material.emissive.copy(plugLed.material.color); plugLed.material.emissiveIntensity = s.kettle.status === 'fault' ? (Math.floor(t * 3) % 2 ? 6 : 1) : 2; plugLed.visible = s.kettle.status !== 'offline';
        steam.material.opacity = s.kettle.on ? 0.35 + 0.15 * Math.sin(t * 5) : 0; steam.position.y = 1.22 + (s.kettle.on ? 0.03 * Math.sin(t * 2) : 0);
        const nb = s.night.brightness; nl.bulb.intensity = nb * 3; nl.bulbMesh.material.emissiveIntensity = nb * 2; nl.shadeMat.emissiveIntensity = nb * 0.4;
        const hb = s.hall.brightness; hallLight.intensity = hb * 7; pendant.material.emissiveIntensity = hb * 0.5;
        mat.material.color.set(s.mat.pressed ? 0x2C3035 : 0x8CC3B3); // dark under weight, pale when released
      },
    };
  },

  prompts: [
    {
      chip: 'Let me know when mum\'s up in the morning — without a camera in her room.',
      keywords: ['mum', 'mom', 'mother', 'up', 'morning', 'awake', 'camera', 'without', 'know', 'wake', 'woke', 'wakes', 'waking', 'she', 'get', 'gets', 'got', 'yet', 'routine'],
      expect: { 'mat.pressed': false, 'door.open': 1, 'kettle.on': false },
      steps: [
        { beat: 'plan' },
        { say: 'No camera, no microphone. I can answer "is she up?" from four things that don\'t look at anyone: the bed sensor, the bedroom door, the hallway motion sensor and the kettle plug.' },
        { plan: { intro: 'Plan:', steps: [
          { text: 'Between 05:00 and 10:00, when the bed sensor releases AND the door opens or the hallway sees movement → message you "Mum\'s up", with the time' },
          { text: 'Kettle switching on counts as a second confirmation, not a requirement' },
          { text: 'If nothing by 09:30, message you once — no alarms, no calls to anyone else', alt: { text: 'If nothing by 09:30, message you and her neighbour Pat', apply: [{ set: 'plan.neighbour', to: true }] } },
          { text: 'No video, no audio, nothing to play back. I keep a few timestamps (when she got up, the last hallway movement), not a record of where she goes.' },
        ] } },
        { beat: 'run' },
        { say: 'Running. Fast-forwarding through the night.' },
        { status: 'Tuesday 03:10' }, { tween: 'env.hour', to: 27.17, ms: 2000 },
        { status: 'Tuesday 07:08' }, { tween: 'env.hour', to: 31.13, ms: 2500 },
        { set: 'mat.pressed', to: false, label: 'Bed sensor → out of bed' }, { wait: 900 },
        { tween: 'door.open', to: 1, ms: 1200, label: 'Bedroom door → open' },
        { set: 'motion.active', to: true, label: 'Hallway → movement' }, { set: 'motion.last', to: '07:11' }, { wait: 800 },
        { say: 'Mum\'s up · 07:11' },
        { set: 'motion.active', to: false },
        { set: 'kettle.on', to: true }, { tween: 'kettle.watts', to: 1850, ms: 600, label: 'Kettle → on' },
        { say: '07:12 — and the kettle\'s on. Normal morning.' },
        { tween: 'kettle.minutes', to: 3, ms: 1500 }, { set: 'kettle.on', to: false }, { set: 'kettle.watts', to: 0 }, { set: 'kettle.minutes', to: 0 },
        // that evening she goes to bed as usual: last hallway movement 22:40, door shut, weight on the bed
        { status: 'Tuesday 22:40' }, { tween: 'env.hour', to: 46.67, ms: 2200 },
        { set: 'motion.active', to: true }, { set: 'motion.last', to: '22:40' }, { wait: 500 }, { set: 'motion.active', to: false },
        { tween: 'door.open', to: 0, ms: 800, label: 'Bedroom door → closed' }, { set: 'mat.pressed', to: true, label: 'Bed sensor → in bed' }, { wait: 500 },
        { status: 'Wednesday 09:30' }, { tween: 'env.hour', to: 57.5, ms: 2200 },
        { beat: 'recover' },
        { fn: async ({ chat, sleep }) => { chat.alert('09:30 and she\'s not up yet. Bed sensor still shows weight, door closed, no hallway movement since 22:40 last night. Yesterday she was up at 07:11.', '⏰ Not up yet'); await sleep(600); } },
        { fn: ({ chat, store }) => chat.replan({ intro: 'That\'s the one message I said I\'d send.', changes: ['No alarm, no siren, no lights flashing in her flat', 'I haven\'t contacted anyone else' + (store.get('plan.neighbour') ? ' except Pat, as you chose' : ''), 'I\'ll tell you the moment anything changes'], needsYou: 'A late morning is usually just a late morning. A phone call from you is the right next step, not a device.' }) },
        { wait: 700 },
        { status: 'Wednesday 09:41' }, { tween: 'env.hour', to: 57.68, ms: 1200 },
        { set: 'mat.pressed', to: false, label: 'Bed sensor → out of bed' }, { tween: 'door.open', to: 1, ms: 1000, label: 'Bedroom door → open' }, { set: 'motion.active', to: true }, { set: 'motion.last', to: '09:41' }, { wait: 600 },
        { say: 'Mum\'s up · 09:41. All clear.' }, { set: 'motion.active', to: false },
        { end: { headline: 'She was never watched. You still knew.', body: 'Four small sensors, a rule you approved, and one message when she wasn\'t up by 09:30. NeuCharBox answers the question without a camera, and escalates by telling you, not by alarming her.' } },
      ],
    },
    {
      chip: 'If she gets up at night, light the way to the bathroom, softly.',
      keywords: ['night', 'light', 'way', 'bathroom', 'softly', 'soft', 'gets up', 'got', 'dark', 'path', 'toilet', 'wander', 'wanders', 'wandering'],
      expect: { 'hall.status': 'fault', 'night.brightness': 0.3 },
      steps: [
        { beat: 'plan' },
        { say: 'Night light and hall light, triggered by the bed sensor — not by motion, because by the time motion sees her she\'s already walking in the dark.' },
        { plan: { intro: 'Plan, 23:00 to 06:00:', steps: [
          { text: 'Bed sensor releases → night light on at 20% immediately, hall light two seconds later' },
          { text: 'Lights off 5 minutes after she\'s back in bed' },
          { text: 'Hall light at 30%. Nothing brighter than 30% at night', alt: { text: 'Hall light at 50%, because she\'s said 30% is too dim. Nothing brighter than 50% at night', apply: [{ set: 'plan.brighter', to: true }] } },
        ] } },
        { beat: 'run' },
        { status: 'Tuesday 02:40' }, { tween: 'env.hour', to: 26.67, ms: 2000 },
        { set: 'mat.pressed', to: false, label: 'Bed sensor → out of bed' },
        { set: 'night.on', to: true }, { tween: 'night.brightness', to: 0.2, ms: 700, label: 'Night light → 20%' },
        { wait: 500 }, { set: 'hall.on', to: true },
        { fn: ({ store, tween }) => tween('hall.brightness', store.get('plan.brighter') ? 0.5 : 0.3, 900) },
        { tween: 'door.open', to: 1, ms: 1000, label: 'Bedroom door → open' }, { set: 'motion.active', to: true }, { set: 'motion.last', to: '02:41' }, { wait: 700 }, { set: 'motion.active', to: false },
        { say: '02:41 — she\'s up. Night light 20%, hall light on. Nothing else.' },
        { status: 'Tuesday 02:49' }, { tween: 'door.open', to: 0, ms: 800 }, { set: 'mat.pressed', to: true, label: 'Bed sensor → in bed' },
        { say: '02:49 — back in bed. Lights off in five minutes.' },
        { status: 'Tuesday 02:54' }, { tween: 'env.hour', to: 26.9, ms: 1200 },
        { parallel: [{ tween: 'night.brightness', to: 0, ms: 1200 }, { tween: 'hall.brightness', to: 0, ms: 1200 }] }, { set: 'night.on', to: false }, { set: 'hall.on', to: false },
        { status: 'Wednesday 03:55' }, { tween: 'env.hour', to: 51.92, ms: 2000 },
        { set: 'mat.pressed', to: false, label: 'Bed sensor → out of bed' }, { set: 'night.on', to: true }, { tween: 'night.brightness', to: 0.2, ms: 700, label: 'Night light → 20%' },
        { wait: 500 }, { status: 'Hall light → on' }, { wait: 900 },
        { beat: 'recover' },
        { fail: 'hall', say: '03:55, logged for your morning: the hall light didn\'t respond. She\'s up and the hallway is dark.' },
        { say: 'The hall light is the one that matters here and it\'s not answering. I can\'t make it work, so I\'m using what I have:' },
        { fn: ({ chat, store }) => chat.replan({ intro: 'Right now:', changes: [`Night light up from 20% to ${store.get('plan.brighter') ? 50 : 30}%, the most your limit allows. It's by the bed, so it lights her way to the door, not the hall`, 'Retrying the hall light every 10 seconds while she\'s up', 'Logging this so you see it in the morning, not at 4 am'], needsYou: 'Probably a bulb or a switch that\'s been flicked off. Check it tomorrow.' }) },
        { wait: 700 },
        { fn: ({ store, tween }) => tween('night.brightness', store.get('plan.brighter') ? 0.5 : 0.3, 700) },
        { tween: 'door.open', to: 1, ms: 1000 }, { set: 'motion.active', to: true }, { set: 'motion.last', to: '03:56' }, { wait: 600 }, { set: 'motion.active', to: false },
        { end: { headline: 'It did the most it could, and said so.', body: 'When the important device failed, NeuCharBox didn\'t pretend. It used what still worked, kept retrying, and left you a note for the morning instead of a 4 am alert.' } },
      ],
    },
    {
      chip: 'Tell me if the kettle\'s been on for more than 10 minutes.',
      keywords: ['kettle', 'on', 'minutes', 'long', 'left', 'leave', 'leaves', 'boil', 'plug', 'stove', 'cooker', 'oven', 'hob', 'appliance', 'appliances', 'forgot', 'forget', 'forgets'],
      expect: { 'kettle.status': 'fault', 'kettle.on': true },
      steps: [
        { beat: 'plan' },
        { say: 'The kettle plug reports power draw, so I can see "on" without seeing the kitchen. Ten minutes at full draw means it\'s stuck on or the auto-off has failed.' },
        { plan: { intro: 'Plan:', steps: [
          { text: 'Kettle drawing > 1,000 W for more than 10 minutes → switch it off at the plug and message you', alt: { text: 'Message you first; only switch it off if it\'s still on after 15 minutes', apply: [{ set: 'plan.warnFirst', to: true }] } },
          { text: 'Confirm the switch-off by watching the power draw fall to zero — the plug saying "off" isn\'t enough' },
          { text: 'Normal boils (under 5 minutes) are ignored' },
        ] } },
        { beat: 'run' },
        { status: 'Tuesday 07:12' }, { tween: 'env.hour', to: 31.2, ms: 1800 },
        // she's up: the bed and door agree with someone being in the kitchen
        { set: 'mat.pressed', to: false }, { set: 'motion.last', to: '07:10' }, { tween: 'door.open', to: 1, ms: 700 },
        { set: 'kettle.on', to: true }, { tween: 'kettle.watts', to: 1850, ms: 500, label: 'Kettle → on' }, { tween: 'kettle.minutes', to: 3, ms: 1500 },
        { set: 'kettle.on', to: false }, { set: 'kettle.watts', to: 0 }, { set: 'kettle.minutes', to: 0 },
        { say: '07:12 — kettle on for 3 minutes, then off. A normal boil, ignored as planned.' },
        { status: 'Tuesday 18:02' }, { tween: 'env.hour', to: 42.03, ms: 2000 }, { set: 'motion.last', to: '17:58' },
        { set: 'kettle.on', to: true }, { tween: 'kettle.watts', to: 1850, ms: 500, label: 'Kettle → on' },
        { parallel: [{ tween: 'kettle.minutes', to: 10, ms: 2600 }, { tween: 'env.hour', to: 42.2, ms: 2600 }] },
        { fn: ({ chat, store }) => chat.ncb(store.get('plan.warnFirst') ? '18:12 — the kettle has been drawing 1,850 W for 10 minutes. Messaging you first, as you chose. I\'ll switch it off at 18:17 if it\'s still on.' : '18:12 — the kettle has been drawing 1,850 W for 10 minutes. Switching it off at the plug.') },
        { wait: 1500 },
        { fn: async ({ store, chat, tween, sleep, status }) => {
          if (!store.get('plan.warnFirst')) return;
          await Promise.all([tween('kettle.minutes', 15, 1600), tween('env.hour', 42.28, 1600)]);
          status('Tuesday 18:17'); chat.ncb('18:17 — still on, still drawing 1,850 W. Switching it off at the plug.'); await sleep(1500);
        } },
        { status: 'Plug → off' }, { wait: 900 },
        { beat: 'recover' },
        { fail: 'kettle', say: 'The plug reports "off" — but it\'s still drawing 1,850 W. The relay hasn\'t actually opened.' },
        { say: 'I don\'t trust the plug\'s word over the meter. A kettle that\'s been on this long with a stuck plug isn\'t something I can fix from here.' },
        { replan: { intro: 'Escalating, by message, right now:', changes: ['Retrying the plug\'s off command every 5 seconds', 'Telling you it\'s NOT off, in those words', 'Nothing else in the flat changes — no lights, no sounds'], needsYou: 'Call her now and ask her to switch the kettle off at the wall. Then that plug needs replacing.' } },
        { end: { headline: '"Off" wasn\'t off. It said so.', body: 'The plug claimed success. The power draw said otherwise. NeuCharBox reported the measurement, not the claim, and handed you a phone call instead of a false all-clear.' } },
      ],
    },
  ],
};
