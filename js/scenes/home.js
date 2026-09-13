// Scene 1 — Home, away for a week. Proves: say what you want, never name a device.

// True for every way into the away-for-a-week request: a typed one may name devices, and a beat skip runs the plan unapproved.
const KS_END = { headline: 'You never wrote a rule.', body: 'You said what you wanted. NeuCharBox found the devices, wrote the plan, showed it to you before anything ran, ran it, and re-planned around a failure instead of hiding it.' };
// Typed requests (js/engine/match.js, rulesOut): things this room doesn't have. A request that adds one ("…and lock the
// door", "…and feed the cat") gets the chips back instead of a plan that quietly leaves it out.
const NOT_HERE = ['lock', 'unlock', 'alarm', 'siren', 'tv', 'television', 'radio', 'music', 'garden', 'lawn', 'sprinkler', 'garage', 'feed', 'cat', 'cats', 'dog', 'dogs', 'pet', 'pets', 'fish'];

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
  camera: { position: [3.52, 2.22, 3.0], target: [-0.3, 1.2, -1.1], fov: 42, fitAspect: 1.5, azimuth: [0.72, 0.9], minDistance: 1.6, maxDistance: 6.5 },
  setupIntro: 'This is NeuCharBox, on the side table. Plug it in to start.',
  askIntro: 'You\'re leaving for a week on Friday. What do you want the house to do while you\'re gone? Pick one, or type your own.',
  deviceOrder: ['lamp', 'blinds', 'soil', 'pump', 'camera', 'thermostat'],
  devices: {
    // Tile follows the brightness, like the room does: a lamp faded to 0 reads "off" before its on flag drops.
    lamp:       { icon: 'lamp', name: 'Floor lamp', initial: { on: false, brightness: 0 }, format: (s) => (s.brightness > 0.02 ? `on · ${Math.round(s.brightness * 100)}%` : 'off'), active: (s) => s.brightness > 0.02, faultText: 'not responding' },
    blinds:     { icon: 'blinds', name: 'Blinds', initial: { closed: 0 }, format: (s) => `${Math.round(s.closed * 100)}% closed`, faultText: 'motor stalled' },
    soil:       { icon: 'moisture', name: 'Soil sensor', initial: { moisture: 34 }, format: (s) => `${s.moisture.toFixed(0)}% moisture`, faultText: 'no reading' },
    pump:       { icon: 'pump', name: 'Water pump', initial: { running: false }, format: (s) => (s.running ? 'running' : 'idle'), faultText: 'not responding' },
    camera:     { icon: 'camera', name: 'Door camera', initial: { armed: false, motion: false, off: false }, format: (s) => (s.off ? 'off' : s.armed ? (s.motion ? 'motion at door' : 'armed · no motion') : 'standby'), faultText: 'offline' },
    thermostat: { icon: 'thermostat', name: 'Thermostat', initial: { target: 21, current: 21.4 }, format: (s) => `${s.target.toFixed(0)}°C set · ${s.current.toFixed(1)}°C now`, faultText: 'unreachable' },
  },

  build({ R, P, M, THREE, store, speed = 1 }) {
    R.scene.background = new THREE.Color(0xDCEBF3);
    // ceilShadows: the floor lamp's shade keeps its light off the ceiling outside the shade's top opening (see the lamp).
    P.roomShell({ w: 5, d: 5, h: 2.8, window: { x: 0.7, y: 1.55, ww: 1.7, wh: 1.36 }, ceilShadows: true });
    // Skirting and crown on the right and front walls too (the shell trims the back and left walls only, and from outside
    // those two a bare joint showed on the far walls), as in elder.js: they hide with their walls, sit a few mm lower than
    // the shell's so no two trims share a face in a corner, and the front ones stop at the side walls' trims.
    for (const [th, ty] of [[0.098, 0.049], [0.057, 2.8 - 0.0295]]) { // skirting, crown
      P.onWall(P.flatNormals(P.box(0.02, th, 5, M.trim, 2.49, ty, 0), -1, 0, 0), -1, 0, -2.5);     // right wall, x = 2.5
      P.onWall(P.flatNormals(P.box(4.96, th, 0.02, M.trim, 0, ty, 2.49), 0, 0, -1), 0, -1, -2.5);  // front wall, z = 2.5
    }
    // Everything a builder adds to the room: P.blinds returns its slats but not the headrail, and both hang on the back
    // wall (tagged below).
    const addedBy = (build) => { const before = new Set(R.scene.children); const ret = build(); return [ret, R.scene.children.filter((o) => !before.has(o))]; };
    // 18 slats at a 7 cm pitch: tilted to 1.3 rad a 7.5 cm slat covers more than the pitch, so "100% closed" closes.
    // 1.74 m wide, past the 1.65 m between the window trims: the blind hangs 4 cm in front of them, so anything
    // narrower leaves bare glass at the sides from the room camera. The lowest slat (y 0.95) clears the sill (top 0.885).
    const [slats, blindParts] = addedBy(() => P.blinds(0.7, 2.14, -2.42, 1.74, 18, 0.07));
    // One shared slat geometry: the thin front/back edge faces take the broad face's normal, so a closed blind has no
    // dark sub-pixel line per slat (without MSAA, on phones, those broke into a fan of dashes), and a light→darker tint
    // from each slat's back edge to its front edge still reads as separate slats.
    {
      const geo = slats[0].geometry.clone(), nrm = geo.attributes.normal, pos = geo.attributes.position, col = [];
      for (let i = 0; i < nrm.count; i++) { if (Math.abs(nrm.getZ(i)) > 0.5) nrm.setXYZ(i, 0, 1, 0); const c = 0.84 + 0.16 * (0.5 - pos.getZ(i) / 0.075); col.push(c, c, c); }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      const mat = M.slat.clone(); mat.vertexColors = true;
      slats.forEach((s) => { s.geometry.dispose(); s.geometry = geo; s.material = mat; });
    }
    // Motor status LED on the headrail's front face, at the left end: at the right end the lamp's bloom drowns it.
    const blindsLed = P.ledDot(-0.08, 2.2, -2.376, 0x2FBF71, 0.01); P.onWall(P.group(blindsLed), 0, 1, -2.5); // see the cut-away note below
    // Screen-sized glow for a small status LED in fault (the LED itself is a 1–2 px dot from the room camera).
    // Depth-tested, but kept 12 cm towards the camera each frame so the device it sits on never cuts it in half.
    // Normal blending, not additive: these sit on white walls, where an additive red just washes out to white.
    // wall: [nx, nz, d] for a glow on a wall-hung device; it sits in a holder tagged with that wall (see the cut-away note).
    const glowMap = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32); rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.22, 'rgba(255,255,255,.85)'); rg.addColorStop(0.5, 'rgba(255,255,255,.3)'); rg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = rg; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
    const glow = (x, y, z, { hex = 0xE8402A, wall = null } = {}) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, color: hex, transparent: true, depthWrite: false, sizeAttenuation: false, opacity: 0 }));
      sp.scale.setScalar(0.04); sp.visible = false; sp.userData.noAO = true; sp.raycast = () => {}; R.scene.add(sp); if (wall) P.onWall(P.group(sp), ...wall);
      const at = new THREE.Vector3(x, y, z), v = new THREE.Vector3();
      return (k) => { sp.visible = k > 0.01; if (!sp.visible) return; sp.material.opacity = k; v.subVectors(R.camera.position, at); const d = v.length() || 1; sp.position.copy(at).addScaledVector(v, Math.min(0.12, d * 0.5) / d); };
    };
    const blindsGlow = glow(-0.08, 2.2, -2.37, { wall: [0, 1, -2.5] });
    P.sofa(0.5, -1.86); // backrest rear face at z -2.32, just clear of the window sill (front face z -2.33)
    P.rug(0.5, -0.55); P.table(0.5, -0.6, 1.0, 0.5); P.box(0.18, 0.025, 0.25, M.art, 0.3, 0.4525, -0.6);
    const plant = P.plant(-1.9, -1.75);
    // The soil darkens as it takes up water: 20% moisture reads dry and pale, 45% dark and wet.
    const soilMat = M.soil.clone(); plant.soil.material = soilMat; const DRY = new THREE.Color(0x7B5B40), WET = new THREE.Color(0x2A1C12); let soilShown = null;
    P.box(0.018, 0.34, 0.018, M.metal, -1.74, 0.5, -1.66); const sensorHead = P.box(0.06, 0.05, 0.03, M.hub, -1.74, 0.69, -1.66);
    const soilLed = P.ledDot(-1.74, 0.697, -1.64, 0x2FBF71, 0.009); // status LED on the sensor head's front face
    const soilGlow = glow(-1.74, 0.697, -1.635); // its fault is the plant-only request's story: keep it visible after the ping
    const pump = P.box(0.26, 0.2, 0.2, M.black, -1.35, 0.1, -1.5, 0.02);
    // Water reservoir on top of the pump, so it's clear where the water comes from.
    const tank = P.box(0.24, 0.2, 0.18, new THREE.MeshPhysicalMaterial({ color: 0xE8F4F8, roughness: 0.08, transparent: true, opacity: 0.28, depthWrite: false }), -1.35, 0.3, -1.5, 0.012);
    tank.castShadow = false; tank.userData.noAO = true; tank.renderOrder = 1; // drawn after the water inside it
    const water = P.box(0.22, 0.13, 0.16, new THREE.MeshStandardMaterial({ color: 0x4FA8CF, roughness: 0.2, transparent: true, opacity: 0.75 }), -1.35, 0.27, -1.5);
    const tankLid = P.box(0.25, 0.012, 0.19, M.black, -1.35, 0.406, -1.5, 0.004);
    // Hose from the pump over the pot rim to a drip end 8 cm above the soil, its mouth turned down; clears the tank, the rim
    // and the sensor stake. The drip end is 12 cm from the plant's centre, just clear of the stems on the room's side: in
    // among the stems the drops were hidden from the front and the right.
    const DRIP = [-1.855, 0.5, -1.636];
    P.tube([[-1.46, 0.12, -1.5], [-1.56, 0.3, -1.52], [-1.68, 0.55, -1.56], [-1.79, 0.55, -1.6], [-1.845, 0.52, -1.628], DRIP]);
    const pumpLed = P.ledDot(-1.35, 0.15, -1.39, 0x2FBF71);
    // Drops falling from the hose mouth to the soil (6 cm) while the pump runs, 2 cm apart so they read as separate drops.
    const dropMat = new THREE.MeshStandardMaterial({ color: 0xBFE6F5, emissive: 0x3AB7FF, emissiveIntensity: 0.35, roughness: 0.1, transparent: true, opacity: 0.9 });
    const drops = [0, 1, 2].map(() => { const d = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 8, 8), dropMat); d.visible = false; d.userData.noAO = true; R.scene.add(d); return d; });
    // shaded: the shade blocks its bulb on every tier (P.floorLamp). Without it the bulb lit the walls, ceiling and room
    // straight through the shade: a bright blob round the shade instead of light from its top and bottom openings.
    const lamp = P.floorLamp(1.95, -1.6, { shaded: true });
    // A soft rim to the light: at the default PCF radius (1) the shade's shadow edge was knife-sharp, a hard arc across
    // the floor and a stair-stepped ellipse on the ceiling. 8 softens both without visible grain at 1x (three's point-light
    // PCF takes 5 samples: from about 12 the edge turns to stipple). The phone tier's spot stand-ins have their own penumbra.
    lamp.bulb.shadow.radius = 8;
    P.table(-1.75, -0.3, 0.6, 0.42, 0.55, M.wood, M.black);
    const hub = P.hub(-1.75, 0.57, -0.3); R.addPickable(hub.group, 'hub');
    const phone = P.phone(-1.55, 0.575, -0.22, -0.4);
    // Left wall: front door with the door camera in it, thermostat beside it. Wall-mounted parts sit on the wall plane.
    P.doorLeft(-2.5, 0.45); // tags its own parts with the left wall
    // Door camera: a door viewer at eye height. Its lens sits in the door and looks out at the mat; the room side is
    // the body with an eyepiece and the status LED.
    const camBody = P.box(0.022, 0.13, 0.075, M.black, -2.459, 1.5, 0.45, 0.008);
    const camEye = P.cyl(0.013, 0.013, 0.006, M.anodized, -2.447, 1.475, 0.45, 20); camEye.rotation.z = Math.PI / 2;
    const camLed = P.ledDot(-2.447, 1.545, 0.45, 0x2FBF71, 0.007);
    const cam = { group: P.group(camBody, camEye, camLed), led: camLed };
    P.picture(-2.48, 1.6, -1.0); // tagged with the left wall (x -2.5) by P.picture
    const thermo = P.box(0.03, 0.11, 0.11, M.white, -2.483, 1.45, -0.3, 0.01);
    const thermoCanvas = document.createElement('canvas'); thermoCanvas.width = 256; thermoCanvas.height = 144;
    const thermoTex = new THREE.CanvasTexture(thermoCanvas); thermoTex.colorSpace = THREE.SRGBColorSpace;
    const thermoScreen = P.screenPlane(0.07, 0.04, thermoTex); thermoScreen.rotation.y = Math.PI / 2; thermoScreen.position.set(-2.466, 1.46, -0.3); thermoScreen.material.emissiveIntensity = 0.7;
    const thermoLed = P.ledDot(-2.466, 1.492, -0.34, 0xE0563A, 0.006); thermoLed.visible = false; P.onWall(P.group(thermoLed), 1, 0, -2.5); // alert LED, lit only in a fault
    const thermoGlow = glow(-2.46, 1.492, -0.34, { wall: [1, 0, -2.5] });
    let thermoShown = -1; // numeric key of what the screen shows (-1 offline, -2 fault); update() builds no strings unless it changes
    // Set point large, measured room temperature small underneath (one canvas and texture, redrawn on change).
    // A fault fills the screen red, so it reads as an alarm even as a few pixels from across the room.
    function thermoText(big, small, alarm = false) {
      const g = thermoCanvas.getContext('2d'); g.fillStyle = alarm ? '#5A120D' : '#0B0F14'; g.fillRect(0, 0, 256, 144);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = alarm ? '#FF7A62' : '#9FE3F0'; g.font = '600 70px Inter, "Segoe UI", sans-serif'; g.fillText(big, 128, small ? 56 : 72);
      if (small) { g.fillStyle = alarm ? '#FFC2B6' : '#6FB3C2'; g.font = '30px Inter, "Segoe UI", sans-serif'; g.fillText(small, 128, 116); }
      thermoTex.needsUpdate = true;
    }
    thermoText('--', '');
    // Dollhouse cut-away: seen from outside, a wall is see-through (single-sided), so what hangs on it hides with it
    // instead of floating in the air. The renderer owns .visible of anything tagged with P.onWall (renderer.js header).
    // Parts whose visibility also follows their device's state (the camera, blinds and thermostat LEDs, the fault glows)
    // hang in a tagged parent instead: the renderer shows the parent, update() shows the part.
    for (const o of [cam.group, thermo, thermoScreen]) P.onWall(o, 1, 0, -2.5);
    for (const o of blindParts) P.onWall(o, 0, 1, -2.5);
    R.addPickable(lamp.group, 'lamp'); R.addPickable(lamp.shade, 'lamp');
    slats.forEach((s) => R.addPickable(s, 'blinds')); R.addPickable(blindsLed, 'blinds');
    R.addPickable(sensorHead, 'soil'); R.addPickable(plant.pot, 'soil'); R.addPickable(soilLed, 'soil');
    R.addPickable(tank, 'pump', { anchor: true }); R.addPickable(pump, 'pump'); R.addPickable(water, 'pump'); R.addPickable(tankLid, 'pump'); // rings sit on top of the unit
    R.addPickable(cam.group, 'camera'); R.addPickable(thermo, 'thermostat'); R.addPickable(thermoScreen, 'thermostat');

    const hi = P.highlighter({ lamp: [lamp.shade], blinds: slats, soil: [sensorHead, plant.pot], pump: [pump, tank], camera: [camBody], thermostat: [thermo] });
    // Motion at the door is otherwise only an LED colour: mark it in the room. A device that comes back from a fault
    // mid-run (the thermostat) gets a ping too; a store.restore() writes whole devices, so it never triggers this.
    // A "Motion at the door" label next to Sunday's thermostat fault would be stale, so the label never outlives the
    // motion: the ping waits a tick and needs the motion still on (a beat skip runs Saturday's visit and clears it in one
    // go), and when the motion ends while the label can still be on screen (hold + its 600 ms fade: a skip to Recover, or
    // ?speed= review mode) it goes too, and so does the camera's highlight pulse (camHiCut, until the next focus on it).
    // R.clearMarkers() also drops a label the visitor tapped up in that moment; an engine R.unping(id) would drop just
    // this one, and is used when there is one. Holds are ms at normal speed and shrink with ?speed= (as in the lab).
    const MOTION_HOLD = Math.max(1200, 2500 / speed); let motionAt = -Infinity, camHiCut = false;
    const focus = (id, hex) => { if (id === 'camera') camHiCut = false; hi.focus(id, hex); };
    let thermoWas = store.state.thermostat.status;
    store.subscribe((state, path, value) => {
      if (path === 'camera.motion' && value) setTimeout(() => { if (!store.get('camera.motion')) return; focus('camera'); motionAt = performance.now(); R.ping('camera', 'Motion at the door', { color: '#FFB020', hex: 0xFFB020, hold: MOTION_HOLD }); }, 0);
      if (path === 'camera.motion' && !value && performance.now() - motionAt < MOTION_HOLD + 600) { motionAt = -Infinity; camHiCut = true; if (R.unping) R.unping('camera'); else R.clearMarkers(); }
      if (path === 'thermostat.status' && value === 'online' && thermoWas === 'fault') { focus('thermostat'); R.ping('thermostat', 'Thermostat · back online', { color: '#2FBF71', hex: 0x2FBF71, hold: Math.max(1200, 2200 / speed) }); }
      thermoWas = state.thermostat.status;
    });

    const led = (m, hex, intensity) => { m.material.color.set(hex); m.material.emissive.copy(m.material.color); m.material.emissiveIntensity = intensity; };
    return {
      focus,
      update(s, t) {
        hi.update(); if (camHiCut) camBody.traverse((o) => { if (o.userData.isShell) o.visible = false; });
        R.daylight(s.env.hour);
        const blink = Math.floor(t * 3) % 2 === 0;
        // A stalled motor leaves the slats uneven and the stack hanging askew from the headrail.
        const stalled = s.blinds.status === 'fault', skew = 0.03 + 0.12 * (1 - s.blinds.closed);
        slats.forEach((sl, i) => { sl.rotation.x = s.blinds.closed * 1.3 + (stalled ? Math.sin(i * 1.9) * skew : 0); sl.rotation.z = stalled ? (0.03 * i) / (slats.length - 1) : 0; });
        blindsLed.visible = s.blinds.status !== 'offline'; led(blindsLed, stalled ? 0xE0563A : 0x2FBF71, stalled ? (blink ? 6 : 1) : 1.5);
        blindsGlow(stalled ? (blink ? 1 : 0.25) : 0);
        const b = s.lamp.brightness; lamp.bulb.intensity = b * 9; lamp.bulbMesh.material.emissiveIntensity = b * 3; lamp.shadeMat.emissiveIntensity = b * 0.35;
        // No cube-shadow passes while the lamp is dark; render once up front so the depth map exists for the sampler.
        const lampShadow = lamp.bulb.shadow; lampShadow.autoUpdate = b > 0.02; if (!lampShadow.map) lampShadow.needsUpdate = true;
        const bad = s.pump.status === 'fault';
        led(pumpLed, bad ? 0xE0563A : s.pump.running ? 0x3AB7FF : 0x2FBF71, bad ? (blink ? 6 : 1) : s.pump.running ? 4 : 2);
        pumpLed.visible = s.pump.status !== 'offline';
        drops.forEach((d, i) => { d.visible = s.pump.running && !bad; if (d.visible) d.position.set(DRIP[0], DRIP[1] - 0.012 - ((t * 2.4 + i / 3) % 1) * 0.06, DRIP[2]); });
        if (s.soil.moisture !== soilShown) { soilShown = s.soil.moisture; const k = THREE.MathUtils.clamp((soilShown - 20) / 25, 0, 1); soilMat.color.lerpColors(DRY, WET, k); soilMat.roughness = 1 - 0.3 * k; }
        const soilBad = s.soil.status === 'fault';
        led(soilLed, soilBad ? 0xE0563A : 0x2FBF71, soilBad ? (blink ? 6 : 1) : 2);
        soilLed.visible = s.soil.status !== 'offline'; soilGlow(soilBad ? (blink ? 1 : 0.25) : 0);
        const camBad = s.camera.status === 'fault';
        led(cam.led, camBad ? 0xE0563A : s.camera.armed ? (s.camera.motion ? 0xFFB020 : 0xE0563A) : 0x2FBF71, camBad ? (blink ? 6 : 1) : s.camera.motion ? (blink ? 6 : 3) : s.camera.armed ? 3 : 2);
        cam.led.visible = s.camera.status !== 'offline' && (camBad || !s.camera.off); // switched off: LED dark
        const hubOn = s.hub.status === 'on'; hub.ledMat.emissiveIntensity = hubOn ? (2.5 + Math.sin(t * 2.2) * 1.5) * s.hub.led : 0;
        const th = s.thermostat, thBad = th.status === 'fault', thKey = th.status === 'offline' ? -1 : thBad ? -2 : Math.round(th.target) * 10000 + Math.round(th.current * 10);
        if (thKey !== thermoShown) {
          thermoShown = thKey;
          if (thKey === -1) thermoText('--', '');
          else if (thKey === -2) thermoText('!!', 'no network', true);
          else thermoText(`${Math.round(th.target)}°C`, `now ${th.current.toFixed(1)}°`);
        }
        thermoLed.visible = thBad; if (thBad) led(thermoLed, 0xE0563A, blink ? 6 : 1);
        thermoGlow(thBad ? (blink ? 1 : 0.25) : 0);
      },
    };
  },

  prompts: [
    {
      chip: 'I\'m away for a week. Make the place look lived in, and don\'t let my plants die.',
      keywords: ['away', 'sunday', 'week', 'lived', 'plants', 'die', 'holiday', 'trip', 'travel', 'gone', 'vacation'],
      rulesOut: NOT_HERE,
      expect: { 'pump.status': 'fault', 'thermostat.target': 21 },
      steps: [
        { beat: 'plan' },
        { say: 'Got it. Let me see what I have to work with.' },
        { status: 'Checking connected devices' },
        { say: 'Six devices: the floor lamp, the blinds, the soil sensor, the pump, the door camera and the thermostat. Here\'s what I\'d do — nothing runs until you approve.' },
        { status: 'Waiting for your approval' },
        { plan: { intro: 'Plan for the week you\'re away:', steps: [
          { text: 'Evenings: lamp on a varied schedule between 18:30 and 23:00, like someone is home', alt: { text: 'Evenings: lamp on at a fixed 19:00–22:00', apply: [{ set: 'plan.lampFixed', to: true }] } },
          { text: 'Blinds close as the sun sets, open again at 08:00' },
          { text: 'Water the plant for 40 seconds whenever soil moisture drops below 30%' },
          { text: 'Door camera armed; I\'ll message you if anyone comes to the door' },
          { text: 'Thermostat held at 18°C to save energy, back to 21°C the afternoon you\'re due home', alt: { text: 'Thermostat held at 20°C the whole time', apply: [{ set: 'plan.warm', to: true }] } },
        ] } },
        { beat: 'run' },
        { say: 'Running from now. I\'ll show you the week at speed.' }, // no "Approved": the plan may have been skipped past
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
        { fn: (c) => say(c, `Next Friday 16:00 — you're due back, so the away plan winds down. ${c.store.get('plan.warm') ? 'Thermostat stayed at 20°C all week, as you set it. Blinds open' : 'Thermostat going from 18°C back to 21°C, blinds open'}, lamp schedule ends tonight. The pump never came back. Soil is at 22%: dry, but it never went under 20%. Water the plant tonight and check the pump.`) },
        // "Held at 20°C the whole time" (Edit) leaves the set point alone; the default plan warms back up to 21°C.
        { parallel: [{ fn: (c) => { if (c.store.get('plan.warm')) return; c.status('Thermostat → 21°C'); return Promise.all([c.tween('thermostat.target', 21, 1200), c.tween('thermostat.current', 20.6, 2500)]); } }, { tween: 'blinds.closed', to: 0, ms: 2000 }] },
        { end: KS_END },
      ],
    },
    {
      chip: 'Just keep the plants alive while I\'m gone.',
      // Trip words at half weight (holidays, vacations, weekly, sundays match holiday, vacation, week, sunday as close
      // forms): "water my plants while I'm on holiday" outscores the whole-house prompt, "I'm on holiday" alone doesn't.
      keywords: ['plants', 'alive', 'water', 'watering', 'plant', 'soil', 'dry', 'away', 'holidays', 'vacations', 'travel', 'weekly', 'sundays'],
      // Not the lamp, camera or heating: "water the plants and turn on the lamp" gets the chips back. ('lamps' also
      // catches "lamp", 'lights' "light", but not "water them lightly".)
      rulesOut: [...NOT_HERE, 'lamps', 'lights', 'lighting', 'cameras', 'cam', 'thermostat', 'heating', 'heater'],
      expect: { 'soil.status': 'fault', 'pump.running': false },
      steps: [
        { beat: 'plan' },
        { status: 'Checking connected devices' },
        { say: 'Only the plant, then. I\'ll use the soil sensor, the pump and the blinds — the blinds because afternoon sun is what dries the pot out.' },
        { status: 'Waiting for your approval' },
        { plan: { intro: 'Plant-only plan:', steps: [
          { text: 'Water for 40 seconds whenever soil moisture drops below 30%, never more than twice a day', alt: { text: 'Water for 40 seconds every morning at 08:00, regardless of the sensor', apply: [{ set: 'plan.timed', to: true }] } },
          { text: 'Blinds half-closed between 13:00 and 17:00 to keep direct sun off the pot, open the rest of the day' }, // "keep the blinds closed" conflicts
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
        { status: 'Saturday 13:00 · Blinds → 50%' }, // one line: a tween label would replace the time at once
        { parallel: [{ tween: 'env.hour', to: 37, ms: 2000 }, { tween: 'blinds.closed', to: 0.5, ms: 2000 }, { tween: 'soil.moisture', to: 39, ms: 2000 }] },
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
        { fn: (c) => say(c, c.store.get('plan.timed') ? '08:00 — your scheduled 40 seconds.' : '08:00 — the conservative schedule: 30 seconds, the small daily dose, not a response to a reading.') },
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
      rulesOut: [...NOT_HERE, 'mornings', 'afternoons', 'daytime', 'thermostat', 'heating', 'heater'], // the plan runs 18:20–23:20
      expect: { 'blinds.status': 'fault', 'lamp.on': false, 'blinds.closed': 0.4 },
      steps: [
        { beat: 'plan' },
        { status: 'Checking connected devices' },
        { say: 'Presence, then. Lamp, blinds and the door camera. The trick is variation — a light that switches at the same minute every day is easy to spot from the street.' },
        { status: 'Waiting for your approval' },
        { plan: { intro: 'Evening presence plan:', steps: [
          { text: 'Lamp on between 18:20 and 18:50, off between 22:40 and 23:20 — different minute each day' },
          { text: 'Blinds close 10 minutes after the lamp comes on, open at 08:00' },
          { text: 'Door camera armed; I message you on motion, and I don\'t record when there isn\'t any', alt: { text: 'Door camera off entirely', apply: [{ set: 'plan.noCam', to: true }] } },
        ] } },
        { beat: 'run' },
        { status: 'Friday 18:32' },
        { fn: ({ store }) => store.set(store.get('plan.noCam') ? 'camera.off' : 'camera.armed', true) }, // Edit: switched off, not left on standby
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
      keywords: ['hold', 'house', '19', 'degrees', 'temperature', 'heating', 'thermostat', 'door', 'anyone', 'comes', 'visitor', 'delivery', 'parcel', 'freeze', 'pipes', 'someone', 'doorbell', 'warm', 'camera', 'arm', 'courier'],
      // Only the thermostat and the door camera. 'close' too: the matcher reads "…and close the blinds" like "leave the
      // lamp off", as something the text wants left out, which a plan that never touches them would agree with.
      rulesOut: [...NOT_HERE, 'lamps', 'lights', 'lighting', 'blinds', 'curtains', 'shades', 'close'],
      expect: { 'thermostat.status': 'online', 'thermostat.target': 19, 'camera.motion': false },
      steps: [
        { beat: 'plan' },
        { status: 'Checking connected devices' },
        { say: 'Two jobs: heating and the front door. I\'ll use the thermostat and the door camera — nothing else needs to be involved.' },
        { status: 'Waiting for your approval' },
        { plan: { intro: 'Plan:', steps: [
          { text: 'Thermostat set to 19°C and held there; I message you if the room drifts more than 2° from it' },
          { text: 'Door camera armed. On motion I send you a still photo and a one-line note — no continuous recording', alt: { text: 'Door camera armed. On motion I send you a one-line note only, no image — no continuous recording', apply: [{ set: 'plan.noImage', to: true }] } },
        ] } },
        { beat: 'run' },
        { status: 'Friday 17:00 · Thermostat → 19°C' }, // one line: a tween label would replace the time at once
        { parallel: [{ tween: 'env.hour', to: 17, ms: 1200 }, { tween: 'thermostat.target', to: 19, ms: 1200 }, { tween: 'thermostat.current', to: 19.2, ms: 3000 }] },
        { set: 'camera.armed', to: true, label: 'Door camera armed' },
        { wait: 900 }, // long enough to read, before the status jumps to Saturday
        { status: 'Saturday 14:02' },
        { parallel: [{ tween: 'env.hour', to: 38.03, ms: 2500 }] },
        { set: 'camera.motion', to: true, label: 'Motion at the door' },
        { fn: (c) => say(c, c.store.get('plan.noImage') ? 'Saturday 14:02 — motion at the door for 40 seconds. A one-line note went to your phone. No image, as you chose, so I can\'t tell you who it was.' : 'Saturday 14:02 — motion at the door for 40 seconds. A still photo and a one-line note went to your phone, as planned. No video was recorded.') },
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
