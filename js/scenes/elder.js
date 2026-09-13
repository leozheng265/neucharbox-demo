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
    night:  { icon: 'bulb', name: 'Night light', initial: { on: false, brightness: 0 }, active: (s) => s.brightness > 0.02, format: (s) => (s.brightness > 0.02 ? `on · ${Math.round(s.brightness * 100)}%` : 'off'), faultText: 'no response' },
    hall:   { icon: 'bulb', name: 'Hall light', initial: { on: false, brightness: 0 }, active: (s) => s.brightness > 0.02, format: (s) => (s.brightness > 0.02 ? `on · ${Math.round(s.brightness * 100)}%` : 'off'), faultText: 'no response' },
  },

  build({ R, P, M, THREE, store, parts }) {
    // ceilShadows: the pendant's cone and the lamp shade darken the ceiling above them instead of leaving a hot spot
    const shell = P.roomShell({ w: 7, d: 5, h: 2.7, window: { x: 1.9, y: 1.6, ww: 1.4, wh: 1.1 }, ceilShadows: true });
    // The garden's trees stand 12–15 m back for eye-level cameras; from up here their tops still showed at the top of the
    // frame, over the back wall. Push them further back.
    for (const t of shell.trees) t.position.z -= 9;
    // partition between bedroom and hall with a doorway, in the shell's wall material: like the walls (and the door leaf,
    // below) it casts shadows from both faces. Cast from its far face only, a lamp on one side lit a thin line along the
    // partition's foot and up its corner with the back wall on the other side.
    const wallM = shell.walls.left.material;
    P.box(0.12, 2.7, 1.5, wallM, -0.5, 1.35, -1.75); P.box(0.12, 2.7, 2.5, wallM, -0.5, 1.35, 1.25); P.box(0.12, 0.6, 1.0, wallM, -0.5, 2.4, -0.5);
    // Its top (level with the ceiling, which is see-through from above) was the only wall face the sun lit straight on: in
    // daylight it blew out into a glowing bar with a star at the back wall. A matte cut-colour cap covers it and the crowns
    // either side, facing up only, so from inside the room (under the ceiling) it never shows.
    const cap = new THREE.Mesh(new THREE.PlaneGeometry(0.164, 5.0), new THREE.MeshStandardMaterial({ color: 0xB9B4AC, roughness: 1 })); cap.rotation.x = -Math.PI / 2; cap.position.set(-0.5, 2.702, 0); R.scene.add(cap);
    // Skirting and crown where the shell leaves the walls bare (it trims the back and left walls only): the right and
    // front walls, whose trims hide with them, and both faces of the partition, where the skirting is 1 cm deep (flush
    // with the door casing it stops at). A few mm lower than the shell's, so no two trims share a face in a corner.
    const trim = (w, h, d, x, y, z, nx, nz) => P.flatNormals(P.box(w, h, d, M.trim, x, y, z), nx, 0, nz);
    for (const [h, y, pd] of [[0.098, 0.049, 0.01], [0.057, 2.6705, 0.02]]) { // skirting, crown; pd: depth on the partition
      P.onWall(trim(0.02, h, 5, 3.49, y, 0, -1, 0), -1, 0, -3.5);
      for (const [x0, x1] of [[-3.5, -0.56 - pd], [-0.44 + pd, 3.48]]) P.onWall(trim(x1 - x0, h, 0.02, (x0 + x1) / 2, y, 2.49, 0, -1), 0, -1, -2.5);
      for (const sx of [-1, 1]) { // the partition's faces (x = -0.56, -0.44); the skirting stops at the door casing, the crown runs over the header
        const x = -0.5 + sx * (0.06 + pd / 2);
        for (const [z0, z1] of pd < 0.02 ? [[-2.5, -1.03], [0.03, 2.5]] : [[-2.5, 2.5]]) {
          const m = trim(pd, h, z1 - z0, x, y, (z0 + z1) / 2, sx, 0), n = m.geometry.attributes.normal;
          // a crown's top shows from above, beside the partition's own top: it shades as that top does (box vertices
          // 8–11 are the +y face), not as the dark strip its face's normal made of it
          if (pd === 0.02) for (let i = 8; i < 12; i++) n.setXYZ(i, 0, 1, 0);
          // the ends (16–19 +z, 20–23 −z) show where the partition meets the front and back walls, seen from outside:
          // they shade as the partition's own end does (with the bedroom face's normal, the crown's end was a dark block)
          for (let i = 16; i < 24; i++) n.setXYZ(i, 0, 0, i < 20 ? 1 : -1);
          n.needsUpdate = true;
        }
      }
    }
    // Door casing, as a bedroom half and a hall half that each shade as the face they show (P.flatNormals). One box across
    // the partition had 1 cm side strips that broke into dashes on phones, and the hall light lit the bedroom half's strip
    // with the door shut.
    for (const sx of [-1, 1]) { const cx = -0.5 + sx * 0.035; for (const [h, d, y, z] of [[2.12, 0.06, 1.06, -1.0], [2.12, 0.06, 1.06, 0.0], [0.06, 1.06, 2.11, -0.5]]) P.flatNormals(P.box(0.07, h, d, M.trim, cx, y, z), sx, 0, 0); }
    const doorPivot = new THREE.Group(); doorPivot.position.set(-0.5, 0, -0.97); R.scene.add(doorPivot);
    // the leaf fills the frame (up into the head trim, across to the latch jamb): with a gap, the hall light drew a thin
    // stripe across the bedroom walls through it while the door was shut
    const doorM = M.door.clone(); doorM.shadowSide = THREE.DoubleSide;
    const doorLeaf = new THREE.Mesh(new THREE.BoxGeometry(0.04, 2.09, 0.94), doorM); doorLeaf.position.set(0, 1.045, 0.47); doorLeaf.castShadow = doorLeaf.receiveShadow = true; doorPivot.add(doorLeaf);
    for (const kx of [0.04, -0.04]) { const knob = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 12), M.metal); knob.position.set(kx, 1.0, 0.8); knob.receiveShadow = true; doorPivot.add(knob); } // a knob on each face (in the leaf's shadow: the hall light doesn't reach the bedroom one)
    const contact = P.box(0.03, 0.02, 0.06, M.white, -0.415, 2.0, 0.0); // door contact on the hall face of the latch jamb
    // bedroom: bed, bedside table, night light, rug, picture
    P.box(1.05, 0.25, 1.95, M.woodLight, -2.3, 0.2, -1.5, 0.01); [[-0.48, -0.9], [0.48, -0.9], [-0.48, 0.9], [0.48, 0.9]].forEach((p) => P.box(0.06, 0.08, 0.06, M.wood, -2.3 + p[0], 0.04, -1.5 + p[1]));
    const mattress = P.box(0.98, 0.18, 1.85, M.bedding, -2.3, 0.415, -1.5, 0.03);
    P.box(0.9, 0.12, 0.65, M.cushion, -2.3, 0.53, -0.925, 0.04); P.box(0.7, 0.09, 0.4, M.white, -2.3, 0.53, -2.15, 0.03); // duvet folded at the foot, pillow
    P.box(1.05, 0.53, 0.06, M.woodLight, -2.3, 0.585, -2.45); // headboard, down onto the frame (no seam from behind)
    const matMat = M.black.clone(); matMat.metalness = 0.1; matMat.roughness = 0.8;
    const mat = P.box(0.9, 0.012, 0.5, matMat, -2.3, 0.512, -1.6); // pressure strip across the middle of the mattress, left uncovered so its state shows
    P.table(-1.5, -2.2, 0.45, 0.4, 0.55, M.woodLight, M.woodLight);
    // night light: the floor-lamp parts cut down to a small lamp on the bedside table, on its 20 cm base disc (the lamp's
    // origin sits 8 mm under the table top at 0.57, so the 3 cm disc stands 2.2 cm proud of it, round the pole's foot);
    // shaded: the shade blocks its bulb (P.floorLamp; on phones, see the spot lights below)
    const nl = P.floorLamp(-1.5, -2.2, { y: 0.562, height: 0.643, shadeScale: 0.5, base: true, shaded: true }); nl.bulb.distance = 4;
    const nlBase = nl.group.children.find((m) => m.isMesh && ![nl.pole, nl.shade, nl.bulbMesh].includes(m)); // the disc: tapping it picks the lamp
    // The walls are single-sided (a cut-away): what hangs on a wall hides with it when the camera orbits behind that wall
    // (userData.wall, renderer.js). The shell tags its own window, trims and trees, P.picture its frame; the right and
    // front trims are tagged above, the upper cabinets and the kettle plug below.
    P.rug(-2.0, -0.2, 1.6, 1.2); P.picture(-3.48, 1.6, -1.2, 0.6, 0.45);
    // hallway: motion sensor (small dome on a plate, high on the partition), hall pendant
    const pirPlate = P.box(0.015, 0.12, 0.12, M.white, -0.4325, 2.24, 0.6);
    const pir = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.white); pir.rotation.z = -Math.PI / 2; pir.position.set(-0.425, 2.25, 0.6); R.scene.add(pir);
    const pirLed = P.ledDot(-0.424, 2.197, 0.6, 0x2FBF71, 0.008);
    // invisible tap target (the sensor itself is only a few pixels on a phone), stretched toward the camera rather than
    // up, so on screen it covers the sensor and the wall below it but not the doorway behind it
    const pirHit = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial()); pirHit.visible = false; pirHit.scale.set(0.1, 0.13, 0.18); pirHit.position.set(-0.41, 2.24, 0.72); R.scene.add(pirHit);
    P.cyl(0.004, 0.004, 0.5, M.black, 0.5, 2.45, 0.6, 8); const pendant = P.add(new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.16, 32, 1, true), M.shade.clone())); pendant.position.set(0.5, 2.15, 0.6);
    const hallLight = new THREE.PointLight(0xFFE2B8, 0, 6, 1.6); hallLight.position.set(0.5, 2.05, 0.6); hallLight.castShadow = true; hallLight.shadow.mapSize.set(1024, 1024); R.scene.add(hallLight);
    // The pendant cone sits a few cm from its bulb, inside the default 0.5 m shadow near plane, so the light went straight
    // through it (a hot spot on the ceiling). A 5 cm near plane lets it cast; the smaller depth bias keeps the old offset
    // at room distances (point shadows store perspective depth) and the normal bias keeps surfaces close to the bulb free
    // of acne rings. The cone's inside doesn't receive shadows, so it stays lit (its outside is a skin, below). (The night
    // lamp does the same: shaded.)
    // A 3-texel filter: the cone's shadow line across the partition, a metre from the bulb, came out as stair steps.
    hallLight.shadow.camera.near = 0.05; hallLight.shadow.camera.updateProjectionMatrix(); Object.assign(hallLight.shadow, { bias: -0.0002, normalBias: 0.01, radius: 3 });
    pendant.receiveShadow = false;
    // Phones render without point-light shadows, and a light without a shadow shines straight through the partition and
    // the shut door: the night light lit the hall floor at 03:55 ("the hallway is dark"), the hall light the bedroom at
    // 02:50. There the two fittings light the flat with spot lights, which keep their shadows on every tier, aimed
    // through the openings of their shades (the lamp shade's bottom and top, the pendant's open bottom), plus a light no
    // bigger than the shade that keeps it glowing inside; each spot draws its shadow map only while it is on. (The
    // renderer's shadowless stand-ins, userData.shadeCones, would still light through the wall: the lamp's are dropped,
    // and shaded: true stays for its desktop shadow settings.)
    delete nl.bulb.userData.shadeCones; delete nl.bulb.userData.shadeReach;
    // A cone is [down -1 or up 1, half-angle, penumbra, shadow map size]; the pendant's is as wide as a spot's shadow
    // allows (160°, so a 1024 map), and a 5 cm normal bias keeps its grazing light on the partition free of acne stripes.
    const phoneLights = (parent, at, color, distance, decay, cones, reach) => {
      const ls = cones.map(([dy, angle, penumbra, size]) => {
        const sp = new THREE.SpotLight(color, 0, distance, angle, penumbra, decay); sp.target.position.set(0, dy, 0); sp.add(sp.target);
        sp.castShadow = true; sp.shadow.mapSize.set(size, size); sp.shadow.camera.near = 0.25; Object.assign(sp.shadow, { bias: -0.0005, normalBias: 0.05, needsUpdate: true });
        return sp;
      });
      ls.push(new THREE.PointLight(color, 0, reach, decay));
      for (const l of ls) { l.position.copy(at); parent.add(l); }
      return ls;
    };
    const nlPhone = phoneLights(nl.group, nl.bulb.position, 0xFFCF98, 4, 1.7, [[-1, 1.2, 0.12, 512], [1, 0.74, 0.15, 512]], 0.21);
    const hallPhone = phoneLights(R.scene, hallLight.position, 0xFFE2B8, 6, 1.6, [[-1, 1.4, 0.25, 1024]], 0.3);
    const setTier = () => { const phone = R.quality !== 'high'; nl.bulb.visible = hallLight.visible = !phone; for (const l of [...nlPhone, ...hallPhone]) l.visible = phone; };
    setTier(); // before the renderer's first compile; again each frame, for a drop to the phone tier while running
    // kitchen: counter along the back wall, cabinets, kettle + plug, hub
    P.box(3.0, 0.05, 0.6, M.white, 1.9, 0.9, -2.2); P.box(3.0, 0.85, 0.58, M.woodLight, 1.9, 0.425, -2.2); for (let i = 0; i < 4; i++) P.box(0.02, 0.6, 0.03, M.metal, 0.6 + i * 0.75, 0.55, -1.9);
    // upper cabinets either side of the window (wall-hung: they hide with the back wall), a bin
    for (const cab of [P.box(0.75, 0.7, 0.35, M.white, 0.775, 2.1, -2.32), P.box(0.75, 0.7, 0.35, M.white, 3.025, 2.1, -2.32)]) P.onWall(cab, 0, 1, -2.5); P.box(0.5, 0.4, 0.3, M.metal, 2.9, 0.2, -1.0);
    // kettle and its smart plug on the wall right of the window. The plug, its LED and the lead up the wall hide with the
    // back wall (the scene toggles the LED itself, as a child of the tagged group).
    const plug = P.box(0.08, 0.08, 0.02, M.white, 2.95, 1.15, -2.49); const plugLed = P.ledDot(2.97, 1.125, -2.478, 0x2FBF71, 0.006);
    const kettleBody = P.cyl(0.09, 0.11, 0.22, M.metal, 2.8, 1.035, -2.15, 24); P.cyl(0.02, 0.02, 0.1, M.black, 2.8, 1.16, -2.15, 12); P.box(0.02, 0.12, 0.06, M.black, 2.91, 1.06, -2.15, 0.005);
    const lead = P.tube([[2.84, 0.932, -2.24], [2.9, 0.932, -2.38], [2.935, 0.95, -2.462], [2.95, 1.03, -2.472], [2.95, 1.105, -2.475]], 0.005, M.white); // kettle lead up to the plug
    P.onWall(P.group(plug, plugLed, lead), 0, 1, -2.5);
    // steam while the kettle is on: soft puffs that rise from the lid, swell and fade (one translucent ball read as a
    // glass bead). Sprites are unlit, so their grey follows the room's light (they don't glow in a dim kitchen).
    const puffC = document.createElement('canvas'); puffC.width = puffC.height = 64; const pg = puffC.getContext('2d');
    const pgr = pg.createRadialGradient(32, 32, 0, 32, 32, 32); pgr.addColorStop(0, 'rgba(255,255,255,.85)'); pgr.addColorStop(0.4, 'rgba(255,255,255,.4)'); pgr.addColorStop(1, 'rgba(255,255,255,0)'); pg.fillStyle = pgr; pg.fillRect(0, 0, 64, 64);
    const puffT = new THREE.CanvasTexture(puffC); puffT.colorSpace = THREE.SRGBColorSpace;
    const puffs = [0, 1, 2, 3].map(() => { const p = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffT, transparent: true, depthWrite: false, opacity: 0 })); p.visible = false; p.userData.noAO = true; p.raycast = () => {}; R.scene.add(p); return p; });
    const hub = P.hub(0.9, 0.925, -2.15, { rotY: 0.2 }); R.addPickable(hub.group, 'hub'); P.phone(1.25, 0.93, -2.05, 0.4);
    P.box(0.25, 0.3, 0.25, M.cardboard, 3.2, 1.075, -2.2); P.cyl(0.06, 0.06, 0.2, M.white, 1.6, 1.025, -2.2, 16); // a box, a mug-ish canister (clear of the window sill)
    P.table(1.8, 0.4, 0.9, 0.9, 0.75, M.woodLight, M.woodLight); P.box(0.42, 0.04, 0.42, M.woodLight, 1.1, 0.46, 0.4); [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]].forEach((p) => P.box(0.03, 0.46, 0.03, M.woodLight, 1.1 + p[0], 0.23, 0.4 + p[1])); P.box(0.03, 0.4, 0.42, M.woodLight, 0.905, 0.68, 0.4);

    R.addPickable(mat, 'mat'); R.addPickable(mattress, 'mat'); R.addPickable(doorPivot, 'door'); R.addPickable(contact, 'door'); R.addPickable(pir, 'motion'); R.addPickable(pirPlate, 'motion'); R.addPickable(pirLed, 'motion'); R.addPickable(pirHit, 'motion'); R.addPickable(plug, 'kettle', { anchor: true }); R.addPickable(kettleBody, 'kettle'); R.addPickable(nl.shade, 'night'); R.addPickable(nl.pole, 'night'); R.addPickable(nlBase, 'night'); R.addPickable(nl.bulbMesh, 'night'); R.addPickable(pendant, 'hall');
    const hi = P.highlighter({ mat: [mat, mattress], door: [doorLeaf], motion: [pir, pirPlate], kettle: [plug, kettleBody], night: [nl.shade], hall: [pendant] });
    // The pendant doesn't take shadows (inside, its own bulb would shade it), so the morning sun lit it through the walls
    // and ceiling. It keeps only its inside and gets an outer skin that does take shadows (its bulb never lights the
    // outside); the cone itself still casts from both sides. Added after the highlighter, so a tap doesn't pulse two
    // shells on it. (The night lamp's shade has the same skin from P.floorLamp, shaded, glowing with nl.shadeMat.)
    const skins = [pendant].map((m) => {
      const out = new THREE.Mesh(m.geometry, m.material.clone()); out.material.side = THREE.FrontSide; out.receiveShadow = true; m.add(out);
      m.material.side = THREE.BackSide; m.material.shadowSide = THREE.DoubleSide; return out;
    });

    return {
      focus: hi.focus,
      update(s, t) {
        hi.update(); R.daylight(s.env.hour);
        // Deep night (from about 23:00 to 05:30) is darker than the evening the flat is set up in, so a 20–30% light,
        // or a hall light that didn't come on, shows in the room; on a phone the flat itself still reads (at ×0.3 the
        // hall table and the kitchen went black). No sun then: before 04:30 it sits below the garden, which casts no
        // shadow, and lit a faint window-shaped patch on the partition at 03:55. (The night sky's own dark navy comes
        // from R.daylight.)
        const hod = ((s.env.hour % 24) + 24) % 24, ramp = (x, a, b) => Math.min(1, Math.max(0, (x - a) / (b - a)));
        const deep = hod >= 12 ? ramp(hod, 22.5, 23.5) : 1 - ramp(hod, 5, 6);
        if (deep > 0) { R.lights.hemi.intensity *= 1 - 0.5 * deep; R.lights.fill.intensity *= 1 - 0.5 * deep; R.scene.environmentIntensity *= 1 - 0.45 * deep; R.lights.sun.intensity *= 1 - deep; }
        hub.ledMat.emissiveIntensity = s.hub.status === 'on' ? (2.5 + Math.sin(t * 2.2) * 1.5) * s.hub.led : 0;
        doorPivot.rotation.y = -s.door.open * 1.4;
        const mBad = s.motion.status === 'fault';
        pirLed.material.color.set(mBad ? 0xE0563A : s.motion.active ? 0xFFB020 : 0x2FBF71); pirLed.material.emissive.copy(pirLed.material.color);
        pirLed.material.emissiveIntensity = s.motion.status === 'offline' ? 0 : mBad ? (Math.floor(t * 3) % 2 ? 6 : 1) : s.motion.active ? 6 : 1;
        plugLed.material.color.set(s.kettle.status === 'fault' ? 0xE0563A : s.kettle.on ? 0xFFB020 : 0x2FBF71); plugLed.material.emissive.copy(plugLed.material.color); plugLed.material.emissiveIntensity = s.kettle.status === 'fault' ? (Math.floor(t * 3) % 2 ? 6 : 1) : 2; plugLed.visible = s.kettle.status !== 'offline';
        const grey = Math.min(1, 0.3 + R.lights.hemi.intensity * 1.4 + R.lights.sun.intensity * 0.12);
        puffs.forEach((p, i) => {
          const k = (t * 0.55 + i / puffs.length) % 1; p.visible = s.kettle.on; if (!p.visible) return;
          p.position.set(2.76 + 0.025 * Math.sin(t * 1.1 + i * 1.7) - k * 0.03, 1.2 + k * 0.2, -2.15 + 0.015 * Math.cos(t * 0.9 + i));
          p.scale.setScalar(0.035 + k * 0.09); p.material.opacity = 0.6 * Math.sin(k * Math.PI) * (1 - k * 0.4); p.material.color.setScalar(grey);
        });
        const nb = s.night.brightness; nl.bulb.intensity = nb * 3; nl.bulbMesh.material.emissiveIntensity = nb * 2; nl.shadeMat.emissiveIntensity = nb * 0.4;
        const hb = s.hall.brightness; hallLight.intensity = hb * 7; pendant.material.emissiveIntensity = skins[0].material.emissiveIntensity = hb * 0.5;
        setTier(); for (const [ls, i] of [[nlPhone, nb * 3], [hallPhone, hb * 7]]) for (const l of ls) { l.intensity = i; if (l.isSpotLight) l.shadow.autoUpdate = i > 0; }
        mat.material.color.set(s.mat.pressed ? 0x2C3035 : 0x8CC3B3); // dark under weight, pale when released
      },
    };
  },

  prompts: [
    {
      chip: 'Let me know when mum\'s up in the morning — without a camera in her room.',
      // 'know' ("let me know") is a kettle keyword too, so a bare "let me know if…" matches both and is asked about
      // rather than run; "tell" is a stop word (js/engine/match.js), so a bare "tell me if…" gets the plain clarify.
      // No 'mum': one hit is enough to run, and it sent "tell me if mum falls" to a light rule. 'more' and 'leave' are
      // filler from the kettle chip ("…for more than…") and its 'leave' stem: listed here too, "tell me more" and "tell
      // me if she leaves the flat" are asked about instead of running the kettle request.
      // 'bed' (the night light has it too, so "turn on the light when she gets out of bed" stays the night light's): with
      // 'know', it outweighs the kettle chip's "10" ("let me know if she's still in bed at 10" ran the kettle request).
      // 'stills' is a stem worth half a hit on "still": "tell me if she's still in bed" runs this, "let me know if the
      // kettle is still on" stays the kettle's. Not 'shes': half a hit on "she's" would make "tell me when she's up" this
      // request, but also "let me know when she's gone to bed" or "…in the bathroom", so that one asks back.
      keywords: ['up', 'morning', 'awake', 'camera', 'without', 'wake', 'woke', 'wakes', 'waking', 'get', 'gets', 'got', 'yet', 'routine', 'more', 'leave', 'bed', 'stills'],
      // routing (js/engine/match.js): a fall question never names this request, nor does "if something's wrong / happens"
      // (it ran the kettle request on "know" and the kettle's 'somethin' stem)
      avoid: ['falls', 'fell', 'fallen', 'wrong', 'happens', 'happen', 'happened'],
      // telling Pat is the Edit, not this plan ("message you once — no calls to anyone else"), and it has no microphone,
      // video or recording ("record her room" ran it): asked for, they're asked about (a close form counts too: plurals,
      // "recording", "listening"). It watches 05:00–10:00 only ("let me know if she wakes up at night" ran it), not her
      // going (back) to bed, and not whether a sensor works: named, those are asked about.
      rulesOut: ['pat', 'neighbour', 'neighbor', 'record', 'microphone', 'mic', 'mics', 'listen', 'hear', 'video', 'audio', 'film',
        'night', 'midnight', 'gone', 'goes', 'going', 'went', 'back', 'working', 'broken', 'battery', 'batteries', 'offline', 'faulty'],
      expect: { 'mat.pressed': false, 'door.open': 1, 'kettle.on': false },
      steps: [
        { beat: 'plan' }, { status: 'Checking connected devices' },
        { say: 'No camera, no microphone. I can answer "is she up?" from four things that don\'t look at anyone: the bed sensor, the bedroom door, the hallway motion sensor and the kettle plug.' },
        { status: 'Waiting for your approval' },
        { plan: { intro: 'Plan:', steps: [
          { text: 'Between 05:00 and 10:00, when the bed sensor releases AND the door opens or the hallway motion sensor sees movement → message you "Mum\'s up", with the time' },
          { text: 'Kettle switching on counts as a second confirmation, not a requirement' },
          { text: 'If nothing by 09:30, message you once — no alarms, no calls to anyone else', alt: { text: 'If nothing by 09:30, message you and her neighbour Pat', apply: [{ set: 'plan.neighbour', to: true }] } },
          { text: 'No video, no audio, nothing to play back. I keep a few timestamps (when she got up, the last hallway movement), not a record of where she goes.' },
        ] } },
        { beat: 'run' },
        { status: 'Tuesday 03:10' }, { say: 'Running. Fast-forwarding through the night.' },
        { tween: 'env.hour', to: 27.17, ms: 2000 },
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
        { fn: ({ chat, store }) => { const pat = store.get('plan.neighbour'); chat.replan({ intro: pat ? 'That\'s the message I said I\'d send, to you and to Pat.' : 'That\'s the one message I said I\'d send.', changes: ['No alarm, no siren, no lights flashing in her flat', pat ? 'Pat has the same message, as you chose. No one else' : 'I haven\'t contacted anyone else', pat ? 'I\'ll tell you and Pat the moment anything changes' : 'I\'ll tell you the moment anything changes'], needsYou: 'A late morning is usually just a late morning. A phone call from you is the right next step, not a device.' }); } },
        { wait: 700 },
        { status: 'Wednesday 09:41' }, { tween: 'env.hour', to: 57.68, ms: 1200 },
        { set: 'mat.pressed', to: false, label: 'Bed sensor → out of bed' }, { tween: 'door.open', to: 1, ms: 1000, label: 'Bedroom door → open' }, { set: 'motion.active', to: true }, { set: 'motion.last', to: '09:41' }, { wait: 600 },
        { fn: ({ store, say }) => say(store.get('plan.neighbour') ? 'Mum\'s up · 09:41. All clear. I\'ve told Pat too.' : 'Mum\'s up · 09:41. All clear.') }, { set: 'motion.active', to: false },
        { status: 'Wednesday 09:41 · Mum\'s up' },
        { end: { headline: 'She was never watched. You still knew.', body: 'Four small sensors, a rule you approved, and a message when she wasn\'t up by 09:30. NeuCharBox answers the question without a camera, and escalates by telling you, not by alarming her.' } },
      ],
    },
    {
      chip: 'If she gets up at night, light the way to the bathroom, softly.',
      // 'fall'/'trip' only as in "don't let her fall": "tell me if she falls" asks for fall detection, which this isn't.
      // 'more': see the first request ("she's up more than twice at night" isn't the kettle either). 'bed': see there.
      keywords: ['night', 'light', 'way', 'bathroom', 'softly', 'soft', 'gets up', 'got', 'dark', 'path', 'toilet', 'fall', 'trip', 'safe', 'safely', 'more', 'bed'],
      // routing (js/engine/match.js): fall detection or leaving the house is something else, and so is a TV left on all
      // night (it ran this on "night"); brighter, another room or telling the neighbour is not this plan ("light the way
      // to the kitchen" asks back; "tell Pat if she's not up" ran it)
      avoid: ['falls', 'fell', 'fallen', 'detect', 'detects', 'detection', 'leaves house', 'leaves flat', 'leaves home', 'goes out', 'outside', 'wander', 'wanders', 'wandering', 'tv', 'telly', 'television', 'wrong', 'happens', 'happen', 'happened'],
      rulesOut: ['bright', 'kitchen', 'stairs', 'garden', 'lounge', 'garage', 'front', 'pat', 'neighbour', 'neighbor'],
      expect: { 'hall.status': 'fault', 'night.brightness': 0.3 },
      steps: [
        { beat: 'plan' }, { status: 'Checking connected devices' },
        { say: 'Night light and hall light, triggered by the bed sensor — not by motion, because by the time motion sees her she\'s already walking in the dark.' },
        { status: 'Waiting for your approval' },
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
        { fn: ({ store, tween, status }) => { const b = store.get('plan.brighter') ? 0.5 : 0.3; status(`Hall light → ${Math.round(b * 100)}%`); return tween('hall.brightness', b, 900); } },
        { tween: 'door.open', to: 1, ms: 1000, label: 'Bedroom door → open' }, { set: 'motion.active', to: true }, { set: 'motion.last', to: '02:41' }, { wait: 700 }, { set: 'motion.active', to: false },
        { say: '02:41 — she\'s up. Night light 20%, hall light on. Nothing else.' },
        { status: 'Tuesday 02:49' }, { tween: 'door.open', to: 0, ms: 800 }, { set: 'mat.pressed', to: true, label: 'Bed sensor → in bed' },
        { say: '02:49 — back in bed. Lights off in five minutes.' },
        { status: 'Tuesday 02:54' }, { tween: 'env.hour', to: 26.9, ms: 1200 },
        { parallel: [{ tween: 'night.brightness', to: 0, ms: 1200 }, { tween: 'hall.brightness', to: 0, ms: 1200 }] }, { set: 'night.on', to: false }, { set: 'hall.on', to: false },
        // an hour later the same night (fast-forwarding to the next night flashed the dark flat through a whole day)
        { status: 'Tuesday 03:55' }, { tween: 'env.hour', to: 27.92, ms: 1500 },
        { set: 'mat.pressed', to: false, label: 'Bed sensor → out of bed' }, { set: 'night.on', to: true }, { tween: 'night.brightness', to: 0.2, ms: 700, label: 'Night light → 20%' },
        { wait: 500 }, { status: 'Hall light: sending "on"…' }, { wait: 900 }, // an arrow means the state changed; this one never does
        { beat: 'recover' },
        { fail: 'hall', title: '📝 Logged for your morning', say: '03:55 — the hall light didn\'t respond. She\'s up and the hallway is dark.' },
        { say: 'The hall light is the one that matters here and it\'s not answering. I can\'t make it work, so I\'m using what I have:' },
        { fn: ({ chat, store }) => chat.replan({ intro: 'Right now:', changes: [`Night light up from 20% to ${store.get('plan.brighter') ? 50 : 30}%, the most your limit allows. It's by the bed, so it lights her way to the door, not the hall`, 'Retrying the hall light while she\'s up', 'Logging this so you see it in the morning, not at 4 am'], needsYou: 'It could be the bulb or the wall switch; I can\'t tell which from here. Check it tomorrow.' }) },
        { wait: 700 },
        { fn: ({ store, tween, status }) => { const b = store.get('plan.brighter') ? 0.5 : 0.3; status(`Night light → ${Math.round(b * 100)}%`); return tween('night.brightness', b, 700); } },
        // the retry the new plan promises, shown: sent again, and again no answer (red status line, ring and tile)
        { status: 'Hall light: sending "on" again…' }, { wait: 900 }, { fail: 'hall' },
        { tween: 'door.open', to: 1, ms: 1000 }, { set: 'motion.active', to: true }, { set: 'motion.last', to: '03:56' }, { wait: 600 }, { set: 'motion.active', to: false },
        { end: { headline: 'It did the most it could, and said so.', body: 'When the important device failed, NeuCharBox didn\'t pretend. It used what still worked, kept retrying, and left you a note for the morning instead of a 4 am alert.' } },
      ],
    },
    {
      chip: 'Tell me if the kettle\'s been on for more than 10 minutes.',
      // Appliance words run this. 'know' is shared with the first request's "let me know", so a bare "let me know if…"
      // is asked about (see there). 'leave' and 'somethin' are stems worth half a hit on
      // "leaves" / "something": "what if she leaves something on" runs this, "leaves the flat" alone doesn't.
      // 'dry': "the kettle might boil dry"; with it, "let the kettle boil dry" is refused as this chip's opposite.
      keywords: ['kettle', 'minutes', 'boil', 'plug', 'stove', 'cooker', 'oven', 'hob', 'appliance', 'appliances', 'switched on', 'safe', 'safely', 'leave', 'somethin', 'know', 'dry'],
      // routing (js/engine/match.js): a fall question never names this request, nor does "if something's wrong / happens"
      // (see the first request); "boil the kettle" (exact words, not negated: "don't let the kettle boil dry" still runs
      // it) asks for the opposite of a watch that switches it off; "let me know if she's still asleep at 10" is the first
      // request's, not this one's on the chip's "10"
      avoid: ['falls', 'fell', 'fallen', 'boil kettle', 'still asleep', 'wrong', 'happens', 'happen', 'happened'],
      // so do "switch on the kettle" and "put the kettle on"; "message me first" is the Edit; it tells no neighbour
      rulesOut: ['turn on', 'switch on', 'put', 'first', 'pat', 'neighbour', 'neighbor'],
      expect: { 'kettle.status': 'fault', 'kettle.on': true },
      steps: [
        { beat: 'plan' }, { status: 'Checking connected devices' },
        { say: 'The kettle plug reports power draw, so I can see "on" without seeing the kitchen. Ten minutes at full draw means it\'s stuck on or the auto-off has failed.' },
        { status: 'Waiting for your approval' },
        { plan: { intro: 'Plan:', steps: [
          { text: 'Kettle drawing > 1,000 W for more than 10 minutes → switch it off at the plug and message you', alt: { text: 'Kettle drawing > 1,000 W for more than 10 minutes → message you first; switch it off at the plug only if it\'s still on at 15 minutes', apply: [{ set: 'plan.warnFirst', to: true }] } },
          { text: 'Confirm the switch-off by watching the power draw fall to zero — the plug saying "off" isn\'t enough' },
          { text: 'Normal boils (under 5 minutes) are ignored' },
        ] } },
        { beat: 'run' },
        { status: 'Tuesday 07:12' }, { tween: 'env.hour', to: 31.2, ms: 1800 },
        // she's up: the bed and door agree with someone being in the kitchen
        { set: 'mat.pressed', to: false }, { set: 'motion.last', to: '07:10' }, { tween: 'door.open', to: 1, ms: 700 },
        { set: 'kettle.on', to: true }, { tween: 'kettle.watts', to: 1850, ms: 500, label: 'Kettle → on' },
        { parallel: [{ tween: 'kettle.minutes', to: 3, ms: 1500 }, { tween: 'env.hour', to: 31.25, ms: 1500 }] }, // the 3-minute boil takes the clock to 07:15
        { set: 'kettle.on', to: false }, { set: 'kettle.watts', to: 0 }, { set: 'kettle.minutes', to: 0 },
        { status: 'Tuesday 07:15' }, { say: '07:15 — the kettle was on for 3 minutes, then off. A normal boil, ignored as planned.' },
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
        { status: 'Kettle plug: sending "off"…' }, { wait: 900 }, // not "→ off": the tile still says on, and it never goes off
        { beat: 'recover' },
        // the title is the "NOT off, in those words" the new plan below promises
        { fail: 'kettle', title: '⚠ The kettle is NOT off', say: 'The plug reports "off" — but it\'s still drawing 1,850 W. The relay hasn\'t actually opened.' },
        { say: 'I don\'t trust the plug\'s word over the meter. A kettle that\'s been on this long with a stuck plug isn\'t something I can fix from here.' },
        { replan: { intro: 'Escalating, by message, right now:', changes: ['Retrying the plug\'s off command', 'Telling you it\'s NOT off, in those words', 'Nothing else in the flat changes — no lights, no sounds'], needsYou: 'Call her now and ask her to switch the kettle off at the wall. Then that plug needs replacing.' } },
        // the retry, shown: the off command again, and again "off" with 1,850 W still flowing (red status line, ring and tile)
        { status: 'Kettle plug: sending "off" again…' }, { wait: 900 }, { fail: 'kettle' },
        { end: { headline: '"Off" wasn\'t off. It said so.', body: 'The plug claimed success. The power draw said otherwise. NeuCharBox reported the measurement, not the claim, and handed you a phone call instead of a false all-clear.' } },
      ],
    },
  ],
};
