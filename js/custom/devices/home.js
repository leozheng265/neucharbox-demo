// The Home types' card UI and 3D models for the custom room (contract: devices/index.js). Their look follows Home's
// room (js/scenes/home.js), rebuilt as self-contained models: each stands, hangs or mounts on its own, with its own
// status LED, since here nothing else (a wall plug, a door) is there to carry it.
import { HEX, num, clamp01, pct, oneDecimal, statusLed, mergeMeshes } from './kit.js';

export default {
  // Off and full at the ends of the dimmer, never "0%" or "100%".
  floor_lamp: {
    icon: 'lamp', size: 0.6,
    edit: [{ field: 'brightness', kind: 'slider', step: 0.01, scale: 100, unit: '%' }],
    format: (s) => { const r = pct(s.brightness); return r <= 0 ? 'off' : r >= 100 ? 'full' : `on · ${r}%`; },
    active: (s) => pct(s.brightness) > 0,
    control: { kind: 'bar', field: 'brightness', min: 0, max: 1 },
    // P.floorLamp unshaded: no point-light shadows (six cube renders a frame each, and a light added after the renderer
    // starts would keep them on every tier). A smart dimmer module on the pole carries the status LED. With no shade
    // shadow the bulb lights the wall behind it at full strength: 2.8 at full keeps that wall from blowing out (and
    // blooming over the wall top) at night, and still lights the floor around it.
    model({ THREE, P, M }) {
      const lamp = P.floorLamp(0, 0);
      lamp.bulb.castShadow = false; lamp.bulb.userData.wantsShadow = false; lamp.bulb.distance = 6;
      // Home's finish: a brushed brass pole on a turned black-steel base (in place of the flat metal disc).
      const brass = new THREE.MeshPhysicalMaterial({ color: 0xC9A46A, metalness: 1, roughness: 0.32, clearcoat: 0.3, clearcoatRoughness: 0.3 });
      lamp.pole.material = brass;
      lamp.group.children.filter((o) => o.isMesh && o !== lamp.pole && o.geometry.type === 'CylinderGeometry' && o.position.y < 0.1).forEach((d) => { d.removeFromParent(); d.geometry.dispose(); });
      const prof = [[0, 0], [0.17, 0], [0.18, 0.006], [0.18, 0.016], [0.165, 0.026], [0.06, 0.034], [0.035, 0.05], [0.026, 0.075], [0.026, 0.09], [0, 0.09]].map(([x, y]) => new THREE.Vector2(x, y));
      const base = new THREE.Mesh(new THREE.LatheGeometry(prof, 48), new THREE.MeshPhysicalMaterial({ color: 0x1D1F22, metalness: 0.6, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.2 }));
      base.castShadow = base.receiveShadow = true; lamp.group.add(base);
      const dimmer = P.box(0.045, 0.075, 0.03, M.white, 0, 0.95, 0.035, 0.006);
      const root = P.group(lamp.group, dimmer);
      const led = statusLed(THREE, root, { at: [0, 0.972, 0.052], r: 0.005 });
      let shown = -1;
      return {
        root,
        update(s, t) {
          const b = clamp01(s.brightness);
          if (b !== shown) { shown = b; lamp.bulb.intensity = b * 2.8; lamp.bulbMesh.material.emissiveIntensity = b * 3; lamp.shadeMat.emissiveIntensity = b * 0.35; }
          led.set(s, t); // the light follows the brightness in a fault too: dark, or lit and stuck on
        },
      };
    },
  },

  // A window blind on its own window (frame and a pane), so open slats show daylight and closed ones block it. The pane
  // shows the sky (env.sky): pale by day, a dark night blue after dusk.
  // "open" and "closed" at the ends of the travel, as in Home.
  blinds: {
    icon: 'blinds', size: 1.2, mountY: 1.5, plural: true,
    edit: [{ field: 'closed', kind: 'slider', step: 0.01, scale: 100, unit: '%', top: 'closed' }],
    format: (s) => { const r = pct(s.closed); return r <= 0 ? 'open' : r >= 100 ? 'closed' : `${r}% closed`; },
    control: { kind: 'bar', field: 'closed', min: 0, max: 1 },
    model({ THREE, P, M }) {
      const W = 1.1, H = 1.12, Z = 0.085; // frame outside; the slats' plane, in front of the frame (0–0.035)
      const frame = mergeMeshes(THREE, [
        P.box(W, 0.05, 0.035, M.trim, 0, H / 2 - 0.025, 0.0175), P.box(W, 0.05, 0.035, M.trim, 0, -H / 2 + 0.025, 0.0175),
        P.box(0.05, H - 0.1, 0.035, M.trim, -W / 2 + 0.025, 0, 0.0175), P.box(0.05, H - 0.1, 0.035, M.trim, W / 2 - 0.025, 0, 0.0175),
        P.box(W + 0.06, 0.03, 0.07, M.trim, 0, -H / 2 - 0.015, 0.035), // sill
      ], M.trim, { consume: true });
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.1, H - 0.1), new THREE.MeshStandardMaterial({ color: 0xCFE3EE, emissive: 0xBFDDEE, emissiveIntensity: 0.45, roughness: 0.3 }));
      pane.position.z = 0.004; pane.receiveShadow = true;
      const DAY = new THREE.Color(0xCFE3EE), NIGHT = new THREE.Color(0x1E2A3A);
      // 16 slats at a 7 cm pitch, as Home's: tilted to 1.3 rad a 7.5 cm slat covers more than the pitch, so "closed" closes.
      // P.blinds returns the slats; its headrail is the next object it added, right after the last slat.
      const slats = P.blinds(0, H / 2 - 0.04, Z, W - 0.06, 16, 0.07);
      const host = slats[0].parent, rail = host.children[host.children.indexOf(slats[slats.length - 1]) + 1];
      // One shared slat geometry whose thin front/back faces take the broad face's normal (no dashed line per closed
      // slat on phones without MSAA), with a light-to-darker tint across each slat so closed slats still read apart.
      const geo = slats[0].geometry.clone(), nrm = geo.attributes.normal, pos = geo.attributes.position, col = [];
      for (let i = 0; i < nrm.count; i++) { if (Math.abs(nrm.getZ(i)) > 0.5) nrm.setXYZ(i, 0, 1, 0); const c = 0.84 + 0.16 * (0.5 - pos.getZ(i) / 0.075); col.push(c, c, c); }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      const slatMat = M.slat.clone(); slatMat.vertexColors = true;
      for (const s of slats) { s.geometry.dispose(); s.geometry = geo; s.material = slatMat; }
      const root = P.group(frame, pane, ...slats, rail);
      const led = statusLed(THREE, root, { at: [-W / 2 + 0.07, H / 2 + 0.02, Z + 0.044], r: 0.006 }); // motor LED, headrail front
      let shown = -1, sky = -1;
      return {
        root,
        update(s, t, env) {
          const a = clamp01(s.closed) * 1.3;
          if (a !== shown) { shown = a; for (const sl of slats) sl.rotation.x = a; }
          const k = Math.round(clamp01(env?.sky ?? 1) * 50) / 50; // in 2% steps: no material write every frame
          if (k !== sky) { sky = k; pane.material.color.lerpColors(NIGHT, DAY, k); pane.material.emissiveIntensity = 0.45 * k; }
          led.set(s, t);
        },
      };
    },
  },

  // Soil moisture probe in a potted plant; the soil darkens as it takes up water (20% reads dry and pale, 45% dark).
  soil_sensor: {
    icon: 'moisture', size: 0.8,
    edit: [{ field: 'moisture', kind: 'slider', step: 1, unit: '%', top: 'saturated' }],
    format: (s) => { const m = Math.round(num(s.moisture)); return m >= 100 ? 'saturated' : `${Math.max(0, m)}% moisture`; },
    control: false,
    // With the room's assets the plant is Home's real one (Poly Haven potted_plant_02, its 34 cm pot scaled to 0.9), the
    // probe in its soil; its textured soil takes a colour multiplier (white dry, dark wet).
    model({ THREE, P, M, A }) {
      const real = A?.copy?.('potted_plant_02');
      let plantRoot, soilMat, DRY, WET, potTop;
      if (real) {
        real.scale.setScalar(0.9); real.rotation.y = 0.6; plantRoot = real; potTop = 0.336 * 0.9;
        let dirt = null; real.traverse((o) => { if (!dirt && o.isMesh && o.name.includes('dirt')) dirt = o; });
        soilMat = (dirt?.material || M.soil).clone(); soilMat.userData.shared = false; if (dirt) dirt.material = soilMat;
        DRY = new THREE.Color(0xF2EAE2); WET = new THREE.Color(0x6A5A50);
      } else {
        const S = 0.8, plant = P.plant(0, 0, { scale: S });
        // 16 leaves and 16 stems → one mesh each (each leaf keeps its tint as a vertex colour)
        const stems = plant.group.children.filter((c) => c.isMesh && c.material === M.stem);
        const leafMat = M.leaf.clone(); leafMat.color.setHex(0xFFFFFF); leafMat.vertexColors = true;
        plant.group.add(mergeMeshes(THREE, plant.leaves, leafMat, { tint: true, consume: true }), mergeMeshes(THREE, stems, M.stem, { consume: true }));
        soilMat = M.soil.clone(); plant.soil.material = soilMat; plantRoot = plant.group; potTop = 0.42 * S;
        DRY = new THREE.Color(0x7B5B40); WET = new THREE.Color(0x2A1C12);
      }
      const dy = potTop - 0.336; // the probe stands in the soil whichever pot it is
      const stake = P.box(0.016, 0.3, 0.016, M.metal, 0.1, 0.4 + dy, 0.06), head = P.box(0.05, 0.042, 0.026, M.hub, 0.1, 0.57 + dy, 0.06, 0.006);
      const root = P.group(plantRoot, stake, head);
      const led = statusLed(THREE, root, { at: [0.1, 0.578 + dy, 0.076], r: 0.006 });
      let shown = null;
      return {
        root,
        update(s, t) {
          const m = num(s.moisture);
          if (m !== shown) { shown = m; const k = THREE.MathUtils.clamp((m - 20) / 25, 0, 1); soilMat.color.lerpColors(DRY, WET, k); soilMat.roughness = 1 - 0.3 * k; }
          led.set(s, t, HEX.green, 2);
        },
      };
    },
  },

  // Pump with its water tank on top (as Home's) and an impeller window on the front that spins while it runs; the
  // hose runs out along the floor.
  water_pump: {
    icon: 'pump', size: 0.5,
    edit: [{ field: 'running', kind: 'switch' }],
    format: (s) => (s.running ? 'running' : 'idle'),
    active: (s) => !!s.running,
    control: { kind: 'switch', field: 'running' },
    model({ THREE, P, M }) {
      // Home's unit: a matte graphite body with rounded edges, rubber feet and an aqua strip, under a round reservoir.
      const graphite = new THREE.MeshPhysicalMaterial({ color: 0x2B2F33, roughness: 0.5, metalness: 0.1, clearcoat: 0.25, clearcoatRoughness: 0.4 });
      const body = P.box(0.26, 0.19, 0.2, graphite, 0, 0.105, 0, 0.035);
      const tank = P.cyl(0.086, 0.086, 0.2, new THREE.MeshPhysicalMaterial({ color: 0xE8F4F8, roughness: 0.08, transparent: true, opacity: 0.28, depthWrite: false }), 0, 0.3, 0, 48);
      tank.castShadow = false; tank.userData.noAO = true; tank.renderOrder = 1; // drawn after the water inside it
      const water = P.cyl(0.08, 0.08, 0.13, new THREE.MeshStandardMaterial({ color: 0x4FA8CF, roughness: 0.2, transparent: true, opacity: 0.75 }), 0, 0.268, 0, 48);
      const lid = mergeMeshes(THREE, [P.cyl(0.09, 0.09, 0.016, graphite, 0, 0.407, 0, 48), P.cyl(0.091, 0.091, 0.008, graphite, 0, 0.204, 0, 48)], graphite, { consume: true });
      const strip = P.box(0.17, 0.005, 0.003, new THREE.MeshStandardMaterial({ color: 0x6FD3CB, roughness: 0.4, emissive: 0x2FB5AC, emissiveIntensity: 0.4 }), 0, 0.031, 0.1005);
      const feet = mergeMeshes(THREE, [[-0.1, -0.075], [0.1, -0.075], [-0.1, 0.075], [0.1, 0.075]].map(([x, z]) => P.cyl(0.012, 0.012, 0.01, M.rubber, x, 0.005, z, 12)), M.rubber, { consume: true });
      const hose = P.tube([[0.09, 0.07, -0.09], [0.12, 0.035, -0.15], [0.1, 0.018, -0.2], [0.04, 0.018, -0.22]], 0.012);
      const disc = P.cyl(0.048, 0.048, 0.008, M.steel, 0, 0, 0.004, 18); disc.rotation.x = Math.PI / 2;
      const vanes = [P.box(0.08, 0.012, 0.005, M.white, 0, 0, 0.011), P.box(0.012, 0.08, 0.005, M.white, 0, 0, 0.011)];
      const rotor = P.group(disc, ...vanes); rotor.position.set(-0.03, 0.1, 0.1);
      const root = P.group(body, tank, water, lid, strip, feet, hose, rotor);
      const led = statusLed(THREE, root, { at: [0.085, 0.16, 0.104], r: 0.007 });
      return {
        root,
        update(s, t) {
          if (s.running) rotor.rotation.z = -((t * 14) % (Math.PI * 2));
          led.set(s, t, s.running ? HEX.blue : HEX.green, s.running ? 4 : 2);
        },
      };
    },
  },

  // A wall-mounted camera on a short bracket (P.smallCamera), tilted down at the room. Its LED: green standby, red
  // armed, amber motion (blinking while armed), as in Home.
  door_camera: {
    icon: 'camera', size: 0.3, mountY: 2.0,
    edit: [{ field: 'armed', kind: 'switch', label: 'armed' }, { field: 'motion', kind: 'switch', label: 'motion' }],
    format: (s) => (s.armed ? (s.motion ? 'motion at door' : 'armed · no motion') : s.motion ? 'standby · motion' : 'standby'),
    active: (s) => !!s.armed,
    control: { kind: 'switch', field: 'armed' },
    model({ THREE, P, M }) {
      const plate = P.box(0.07, 0.1, 0.012, M.white, 0, 0, 0.006, 0.004), arm = P.box(0.018, 0.018, 0.07, M.white, 0, 0, 0.045);
      const cam = P.smallCamera(0, 0, 0.12); cam.group.rotation.x = 0.3;
      const root = P.group(plate, arm, cam.group);
      const led = statusLed(THREE, root, { mesh: cam.led });
      return {
        root,
        update(s, t) {
          const blink = Math.floor(t * 3) % 2 === 0;
          if (s.motion) led.set(s, t, HEX.amber, s.armed ? (blink ? 6 : 3) : 2.5);
          else led.set(s, t, s.armed ? HEX.red : HEX.green, s.armed ? 3 : 2);
        },
      };
    },
  },

  // Set point large and the room's temperature small on its screen (one canvas, redrawn on change); a fault fills the
  // screen red so it reads as an alarm from across the room, and offline shows dashes.
  thermostat: {
    icon: 'thermostat', size: 0.3, mountY: 1.45,
    edit: [{ field: 'target', kind: 'slider', step: 0.5, unit: '°C', label: 'set' }, { field: 'current', kind: 'slider', step: 0.5, unit: '°C', label: 'now' }],
    format: (s) => `${oneDecimal(s.target)}°C set · ${num(s.current).toFixed(1)}°C now`,
    control: { kind: 'bar', field: 'target', min: 10, max: 28 }, // the set point on the thermostat's 10–28 °C range
    model({ THREE, P, M }) {
      // Home's round thermostat: a brushed-steel ring 10 cm across, a glass face over a round screen showing the set
      // point as an arc on the 10–28 °C range, the set point big and the room's temperature under it.
      const body = P.cyl(0.05, 0.05, 0.026, new THREE.MeshStandardMaterial({ color: 0xC9CDD1, metalness: 1, roughness: 0.28 }), 0, 0, 0.013, 64); body.rotation.x = Math.PI / 2;
      const c = document.createElement('canvas'); c.width = 256; c.height = 256;
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      const screen = new THREE.Mesh(new THREE.CircleGeometry(0.043, 64), new THREE.MeshPhysicalMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.75, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.03 }));
      screen.position.set(0, 0, 0.0265);
      const root = P.group(body, screen);
      const led = statusLed(THREE, root, { at: [0, -0.038, 0.028], r: 0.004 });
      const draw = (big, small, alarm = false, k = NaN) => {
        const g = c.getContext('2d'); g.fillStyle = alarm ? '#5A120D' : '#05080B'; g.fillRect(0, 0, 256, 256);
        if (!alarm && Number.isFinite(k)) { g.lineCap = 'round'; g.lineWidth = 10; g.strokeStyle = '#1C2A30'; g.beginPath(); g.arc(128, 128, 104, Math.PI * 0.75, Math.PI * 2.25); g.stroke(); g.strokeStyle = '#29EEE5'; g.beginPath(); g.arc(128, 128, 104, Math.PI * 0.75, Math.PI * (0.75 + 1.5 * k)); g.stroke(); }
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillStyle = alarm ? '#FF7A62' : '#E8FBFF'; g.font = '600 64px Inter, "Segoe UI", sans-serif'; g.fillText(big, 128, small ? 116 : 128);
        if (small) { g.fillStyle = alarm ? '#FFC2B6' : '#7FC9D6'; g.font = '26px Inter, "Segoe UI", sans-serif'; g.fillText(small, 128, 176); }
        tex.needsUpdate = true;
      };
      let shown = null; // what the screen shows: -1 offline, -2 fault, else target and current in tenths
      return {
        root,
        update(s, t) {
          const key = s.status === 'offline' ? -1 : s.status === 'fault' ? -2 : Math.round(num(s.target) * 10) * 1e5 + Math.round(num(s.current) * 10) + 5e4;
          if (key !== shown) {
            shown = key;
            if (key === -1) draw('--', ''); else if (key === -2) draw('!!', 'no reply', true);
            else draw(`${oneDecimal(s.target)}°C`, `now ${num(s.current).toFixed(1)}°`, false, clamp01((num(s.target) - 10) / 18));
          }
          led.set(s, t);
        },
      };
    },
  },
};
