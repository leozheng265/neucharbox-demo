// Procedural textures, materials and builders shared across scenes.
// Every builder adds to `scene` and returns the handles a scene needs to animate.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// ---------- textures ----------
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function grain(g, w, h, amount) { const img = g.getImageData(0, 0, w, h), d = img.data; for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * amount; d[i] += n; d[i + 1] += n; d[i + 2] += n; } g.putImageData(img, 0, 0); }
export function tex(c, rep = [1, 1], srgb = true) { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...rep); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }

export function noiseTex(base, amount, size = 512) { const [c, g] = canvas(size, size); g.fillStyle = base; g.fillRect(0, 0, size, size); grain(g, size, size, amount); return c; }
export function woodTex({ hue = 27, light = 60, rows = 6 } = {}) {
  const w = 1024, h = 1024, [c, g] = canvas(w, h); const ph = h / rows;
  for (let r = 0; r < rows; r++) {
    let x = -Math.random() * 400;
    while (x < w) {
      const len = 350 + Math.random() * 450, L = light - 2 + Math.random() * 9, hu = hue + Math.random() * 6;
      g.fillStyle = `hsl(${hu}, 40%, ${L}%)`; g.fillRect(x, r * ph, len, ph);
      for (let k = 0; k < 90; k++) { g.strokeStyle = `hsla(${hu - 3}, 45%, ${L - 14 + Math.random() * 10}%, ${0.18 + Math.random() * 0.25})`; g.lineWidth = 0.6 + Math.random() * 1.6; const y = r * ph + Math.random() * ph; g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + len * 0.3, y + (Math.random() - 0.5) * 10, x + len * 0.7, y + (Math.random() - 0.5) * 10, x + len, y + (Math.random() - 0.5) * 4); g.stroke(); }
      if (Math.random() < 0.35) { const kx = x + 60 + Math.random() * (len - 120), ky = r * ph + ph * 0.3 + Math.random() * ph * 0.4; const rg = g.createRadialGradient(kx, ky, 2, kx, ky, 26); rg.addColorStop(0, `hsla(${hu - 6},45%,${L - 22}%,.8)`); rg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = rg; g.fillRect(kx - 30, ky - 30, 60, 60); }
      g.fillStyle = 'rgba(30,15,5,.55)'; g.fillRect(x + len - 2, r * ph, 3, ph); x += len;
    }
    g.fillStyle = 'rgba(30,15,5,.55)'; g.fillRect(0, r * ph, w, 3);
  }
  grain(g, w, h, 14); return c;
}
export function rugTex() {
  const [c, g] = canvas(512, 512); g.fillStyle = '#9A8E7E'; g.fillRect(0, 0, 512, 512);
  g.strokeStyle = '#7E7364'; g.lineWidth = 14; g.strokeRect(30, 30, 452, 452); g.lineWidth = 4; g.strokeRect(60, 60, 392, 392);
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) { g.fillStyle = (i + j) % 2 ? '#8A7F70' : '#A69A89'; g.fillRect(90 + i * 55, 90 + j * 55, 50, 50); }
  grain(g, 512, 512, 30); return c;
}
export function holeGridTex() { // optical breadboard: 25 mm pitch holes
  const [c, g] = canvas(1024, 1024); g.fillStyle = '#2B2E31'; g.fillRect(0, 0, 1024, 1024); grain(g, 1024, 1024, 10);
  for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) { g.fillStyle = '#0C0D0E'; g.beginPath(); g.arc(32 + i * 64, 32 + j * 64, 7, 0, Math.PI * 2); g.fill(); g.fillStyle = 'rgba(255,255,255,.08)'; g.beginPath(); g.arc(32 + i * 64, 30 + j * 64, 8, Math.PI, Math.PI * 2); g.fill(); }
  return c;
}
export function concreteTex() { const [c, g] = canvas(1024, 1024); g.fillStyle = '#8E8F8B'; g.fillRect(0, 0, 1024, 1024); grain(g, 1024, 1024, 40); for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`; g.beginPath(); g.arc(Math.random() * 1024, Math.random() * 1024, 20 + Math.random() * 90, 0, Math.PI * 2); g.fill(); } g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 3; g.strokeRect(2, 2, 508, 508); g.strokeRect(514, 2, 508, 508); g.strokeRect(2, 514, 508, 508); g.strokeRect(514, 514, 508, 508); return c; }
export function tileTex(a = '#E9E6DF', b = '#DED9CF') { const [c, g] = canvas(512, 512); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { g.fillStyle = (i + j) % 2 ? a : b; g.fillRect(i * 128, j * 128, 126, 126); } g.fillStyle = '#B9B3A6'; for (let i = 0; i <= 4; i++) { g.fillRect(i * 128 - 1, 0, 2, 512); g.fillRect(0, i * 128 - 1, 512, 2); } grain(g, 512, 512, 12); return c; }
export function gradientTex(a, b) { const [c, g] = canvas(128, 8); const gr = g.createLinearGradient(0, 0, 128, 0); gr.addColorStop(0, a); gr.addColorStop(1, b); g.fillStyle = gr; g.fillRect(0, 0, 128, 8); return c; }
export function labelTex(text, { bg = '#101418', fg = '#7CF0D8', size = 40, w = 256, h = 96 } = {}) { const [c, g] = canvas(w, h); g.fillStyle = bg; g.fillRect(0, 0, w, h); g.fillStyle = fg; g.font = `${size}px "Segoe UI", Inter, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }

// ---------- materials ----------
export function materials() {
  const woodC = woodTex(), plasterC = noiseTex('#E9E4DA', 22), fabricC = noiseTex('#5E6266', 46), rugC = rugTex();
  const M = {
    floor:   new THREE.MeshPhysicalMaterial({ map: tex(woodC, [1.6, 1.6]), bumpMap: tex(woodC, [1.6, 1.6], false), bumpScale: 0.6, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.35 }),
    wall:    new THREE.MeshStandardMaterial({ map: tex(plasterC, [3, 2]), bumpMap: tex(plasterC, [3, 2], false), bumpScale: 0.25, roughness: 0.95 }),
    wallDark:new THREE.MeshStandardMaterial({ color: 0x5C6166, roughness: 0.95 }),
    ceiling: new THREE.MeshStandardMaterial({ color: 0xF4F1EB, roughness: 1 }),
    trim:    new THREE.MeshStandardMaterial({ color: 0xF6F3EC, roughness: 0.6 }),
    sofa:    new THREE.MeshStandardMaterial({ map: tex(fabricC, [5, 5]), bumpMap: tex(fabricC, [5, 5], false), bumpScale: 0.35, roughness: 1 }),
    cushion: new THREE.MeshStandardMaterial({ color: 0xB9C7BE, roughness: 1, bumpMap: tex(fabricC, [4, 4], false), bumpScale: 0.3 }),
    bedding: new THREE.MeshStandardMaterial({ color: 0xE8E4DC, roughness: 1, bumpMap: tex(fabricC, [4, 4], false), bumpScale: 0.3 }),
    rug:     new THREE.MeshStandardMaterial({ map: tex(rugC), bumpMap: tex(rugC, [1, 1], false), bumpScale: 0.5, roughness: 1 }),
    pot:     new THREE.MeshStandardMaterial({ color: 0xA9573A, roughness: 0.85 }),
    soil:    new THREE.MeshStandardMaterial({ color: 0x3B2A1E, roughness: 1 }),
    leaf:    new THREE.MeshStandardMaterial({ color: 0x3E7A3A, roughness: 0.55, side: THREE.DoubleSide }),
    stem:    new THREE.MeshStandardMaterial({ color: 0x4E6B3A, roughness: 0.8 }),
    wood:    new THREE.MeshStandardMaterial({ color: 0x4A2E1A, roughness: 0.5 }),
    woodLight:new THREE.MeshStandardMaterial({ color: 0xC9A576, roughness: 0.6 }),
    metal:   new THREE.MeshStandardMaterial({ color: 0xC2C7CC, roughness: 0.3, metalness: 0.95 }),
    steel:   new THREE.MeshStandardMaterial({ color: 0x8A9096, roughness: 0.45, metalness: 0.8 }),
    black:   new THREE.MeshStandardMaterial({ color: 0x2C3035, roughness: 0.5, metalness: 0.4 }),
    anodized:new THREE.MeshStandardMaterial({ color: 0x1B1D20, roughness: 0.55, metalness: 0.6 }),
    hub:     new THREE.MeshPhysicalMaterial({ color: 0xF8FBFA, roughness: 0.28, clearcoat: 0.9, clearcoatRoughness: 0.15 }),
    white:   new THREE.MeshStandardMaterial({ color: 0xF2F4F3, roughness: 0.6 }),
    shade:   new THREE.MeshStandardMaterial({ color: 0xF1E5CF, roughness: 0.95, side: THREE.DoubleSide, emissive: 0xFFC98A, emissiveIntensity: 0 }),
    glass:   new THREE.MeshPhysicalMaterial({ color: 0xDDE8EE, roughness: 0.08, transparent: true, opacity: 0.12, envMapIntensity: 0.4 }),
    slat:    new THREE.MeshStandardMaterial({ color: 0xF5F1E8, roughness: 0.7 }),
    door:    new THREE.MeshStandardMaterial({ color: 0xE6E1D8, roughness: 0.7 }),
    frame:   new THREE.MeshStandardMaterial({ color: 0x1E1E1E, roughness: 0.6 }),
    art:     new THREE.MeshStandardMaterial({ color: 0xC9D7D2, roughness: 0.9 }),
    outside: new THREE.MeshStandardMaterial({ color: 0x4F7448, roughness: 1 }),
    tree:    new THREE.MeshStandardMaterial({ color: 0x4F7D48, roughness: 1 }),
    yellow:  new THREE.MeshStandardMaterial({ color: 0xE4B53A, roughness: 0.6 }),
    cardboard:new THREE.MeshStandardMaterial({ color: 0xB58A57, roughness: 1 }),
    rubber:  new THREE.MeshStandardMaterial({ color: 0x1A1C1E, roughness: 0.9 }),
    screen:  new THREE.MeshStandardMaterial({ color: 0x0B0F14, roughness: 0.2, emissive: 0x0B0F14, emissiveIntensity: 1 }),
  };
  M.led = (hex) => new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 2 });
  return M;
}

// ---------- builders ----------
export function parts(scene, M) {
  const add = (m) => { m.castShadow = m.receiveShadow = true; scene.add(m); return m; };
  const box = (w, h, d, mat, x, y, z, r) => { const m = new THREE.Mesh(r ? new RoundedBoxGeometry(w, h, d, 4, r) : new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return add(m); };
  const cyl = (rt, rb, h, mat, x, y, z, seg = 24) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat); m.position.set(x, y, z); return add(m); };
  const group = (...meshes) => { const g = new THREE.Group(); meshes.forEach((m) => { scene.remove(m); g.add(m); }); scene.add(g); return g; };

  const P = { add, box, cyl, group };

  // A room whose walls are single-sided planes facing inward: solid from inside, invisible when the camera orbits
  // outside them (dollhouse cut-away), so the visitor can look in from any angle. Optional window in the back wall.
  P.roomShell = ({ w = 5, d = 5, h = 2.8, floorMat = M.floor, wallMat = M.wall, window = null, skirting = true } = {}) => {
    const wm = wallMat.clone(); wm.shadowSide = THREE.DoubleSide;
    const floor = add(new THREE.Mesh(new THREE.PlaneGeometry(w, d), floorMat)); floor.rotation.x = -Math.PI / 2;
    const cm = M.ceiling.clone(); cm.shadowSide = THREE.DoubleSide;
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), cm); ceil.rotation.x = Math.PI / 2; ceil.position.y = h; scene.add(ceil);
    const wall = (pw, ph, x, y, z, rotY) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), wm); m.position.set(x, y, z); m.rotation.y = rotY; m.receiveShadow = true; m.castShadow = true; scene.add(m); return m; };
    const zb = -d / 2, xl = -w / 2;
    if (window) {
      const { x, y, ww, wh } = window; // window centre x, centre y, width, height
      const lw = (x - ww / 2) - xl, rw = (w / 2) - (x + ww / 2);
      wall(lw, h, xl + lw / 2, h / 2, zb, 0); wall(rw, h, x + ww / 2 + rw / 2, h / 2, zb, 0);
      wall(ww, y - wh / 2, x, (y - wh / 2) / 2, zb, 0); wall(ww, h - (y + wh / 2), x, (h + y + wh / 2) / 2, zb, 0);
      box(ww + 0.06, 0.05, 0.28, M.trim, x, y - wh / 2 - 0.01, zb + 0.03);
      box(0.05, wh + 0.06, 0.2, M.trim, x - ww / 2, y, zb - 0.06); box(0.05, wh + 0.06, 0.2, M.trim, x + ww / 2, y, zb - 0.06); box(ww + 0.06, 0.05, 0.2, M.trim, x, y + wh / 2, zb - 0.06);
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(ww, wh), M.glass); glass.position.set(x, y, zb - 0.1); scene.add(glass);
      box(0.03, wh, 0.03, M.trim, x, y, zb - 0.1); box(ww, 0.03, 0.03, M.trim, x, y, zb - 0.1);
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 30), M.outside); ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.02, -18); ground.receiveShadow = true; scene.add(ground);
      for (let i = 0; i < 7; i++) { const t = new THREE.Mesh(new THREE.ConeGeometry(0.7 + Math.random() * 0.6, 2.5 + Math.random() * 2, 7), M.tree); t.position.set(-4 + i * 1.7 + Math.random(), 1.2, -6 - Math.random() * 3); t.castShadow = true; scene.add(t); }
    } else {
      wall(w, h, 0, h / 2, zb, 0);
    }
    wall(d, h, xl, h / 2, 0, Math.PI / 2);          // left, faces +x
    wall(d, h, w / 2, h / 2, 0, -Math.PI / 2);      // right, faces -x
    wall(w, h, 0, h / 2, d / 2, Math.PI);           // front, faces -z
    if (skirting) { box(w, 0.1, 0.02, M.trim, 0, 0.05, zb + 0.01); box(0.02, 0.1, d, M.trim, xl + 0.01, 0.05, 0); box(0.02, 0.06, d, M.trim, xl + 0.01, h - 0.03, 0); box(w, 0.06, 0.02, M.trim, 0, h - 0.03, zb + 0.01); }
    return { floor };
  };

  P.blinds = (x, yTop, z, ww, n = 12, pitch = 0.107) => { const slats = []; for (let i = 0; i < n; i++) slats.push(box(ww, 0.012, 0.075, M.slat, x, yTop - i * pitch, z)); box(ww + 0.04, 0.05, 0.08, M.trim, x, yTop + 0.06, z); return slats; };

  // NeuCharBox hub, modelled on the Standard unit: dark graphite aluminium slab ~13 cm square, 3 cm tall,
  // white N logo + wordmark on top, black front panel with a silver power button, status LED and four USB-A
  // ports, vertical vent slots on both sides, and a lighter bevel at the base. Origin at the base centre; front = +z.
  P.hub = (x, y, z, { rotY = 0, scale = 1 } = {}) => {
    const W = 0.14 * scale, H = 0.034 * scale, D = 0.14 * scale;
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rotY; scene.add(g);
    const brushed = noiseTex('#2C2F33', 10, 256);
    const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0x2A2D31, metalness: 0.78, roughness: 0.42, bumpMap: tex(brushed, [4, 1], false), bumpScale: 0.004, clearcoat: 0.15, clearcoatRoughness: 0.5 });
    const body = new THREE.Mesh(new RoundedBoxGeometry(W, H - 0.004 * scale, D, 5, 0.008 * scale), bodyMat); body.position.y = (H - 0.004 * scale) / 2 + 0.004 * scale; body.castShadow = body.receiveShadow = true; g.add(body);
    const bevel = new THREE.Mesh(new RoundedBoxGeometry(W - 0.004 * scale, 0.004 * scale, D - 0.004 * scale, 2, 0.002 * scale), new THREE.MeshStandardMaterial({ color: 0xA9AEB3, metalness: 0.9, roughness: 0.35 })); bevel.position.y = 0.002 * scale; g.add(bevel);
    // top logo (white silkscreen) as a transparent decal
    const lc = document.createElement('canvas'); lc.width = lc.height = 512; const lg = lc.getContext('2d');
    lg.fillStyle = '#F4F6F7'; lg.beginPath(); lg.roundRect(176, 130, 160, 160, 28); lg.fill();
    lg.globalCompositeOperation = 'destination-out'; lg.beginPath(); lg.roundRect(222, 130, 68, 92, 14); lg.fill(); lg.beginPath(); lg.roundRect(222, 198, 68, 92, 14); lg.fill();
    lg.globalCompositeOperation = 'source-over'; lg.fillStyle = '#F4F6F7'; lg.beginPath(); lg.moveTo(214, 148); lg.lineTo(258, 148); lg.lineTo(298, 272); lg.lineTo(254, 272); lg.closePath(); lg.fill();
    lg.font = '600 46px Inter, "Segoe UI", Arial, sans-serif'; lg.textAlign = 'center'; lg.textBaseline = 'top'; lg.fillText('NeuCharBox', 256, 306);
    const logoT = new THREE.CanvasTexture(lc); logoT.colorSpace = THREE.SRGBColorSpace; logoT.anisotropy = 8;
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.62, W * 0.62), new THREE.MeshStandardMaterial({ map: logoT, transparent: true, roughness: 0.8, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2 })); logo.rotation.x = -Math.PI / 2; logo.position.y = H + 0.0004; g.add(logo);
    // front panel: black inset with four USB-A ports and labels
    const fc = document.createElement('canvas'); fc.width = 1024; fc.height = 128; const fg = fc.getContext('2d');
    fg.fillStyle = '#0A0B0D'; fg.beginPath(); fg.roundRect(0, 0, 1024, 128, 14); fg.fill();
    fg.fillStyle = '#15171A'; for (let i = 0; i < 1024; i += 6) fg.fillRect(i, 0, 2, 128);
    for (let i = 0; i < 4; i++) { const cx = 470 + i * 150; fg.fillStyle = '#C6CACF'; fg.beginPath(); fg.roundRect(cx - 34, 30, 68, 30, 4); fg.fill(); fg.fillStyle = '#0A0B0D'; fg.fillRect(cx - 29, 35, 58, 20); fg.fillStyle = '#E8EAED'; fg.fillRect(cx - 24, 38, 48, 8); fg.fillStyle = '#B8BCC1'; fg.font = '600 20px Inter, "Segoe UI", Arial, sans-serif'; fg.textAlign = 'center'; fg.textBaseline = 'top'; fg.fillText('USB', cx, 70); }
    fg.fillStyle = '#B8BCC1'; fg.font = '600 20px Inter, "Segoe UI", Arial, sans-serif'; fg.textAlign = 'center'; fg.fillText('⏻', 150, 74);
    const frontT = new THREE.CanvasTexture(fc); frontT.colorSpace = THREE.SRGBColorSpace; frontT.anisotropy = 8;
    const front = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.84, H * 0.5), new THREE.MeshStandardMaterial({ map: frontT, roughness: 0.3, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -2 })); front.position.set(W * 0.02, H * 0.5, D / 2 + 0.0003); g.add(front);
    const button = new THREE.Mesh(new THREE.CylinderGeometry(0.0032 * scale, 0.0032 * scale, 0.0015 * scale, 20), new THREE.MeshStandardMaterial({ color: 0xC9CDD2, metalness: 0.9, roughness: 0.3 })); button.rotation.x = Math.PI / 2; button.position.set(-W * 0.34, H * 0.55, D / 2 + 0.0008); g.add(button);
    const ledMat = new THREE.MeshStandardMaterial({ color: 0x9FF5E8, emissive: 0x29EEE5, emissiveIntensity: 0 });
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.0012 * scale, 10, 10), ledMat); led.position.set(-W * 0.29, H * 0.58, D / 2 + 0.0008); g.add(led);
    // vent slots on both sides
    const vc = document.createElement('canvas'); vc.width = 256; vc.height = 64; const vg = vc.getContext('2d');
    vg.fillStyle = '#2A2D31'; vg.fillRect(0, 0, 256, 64); vg.fillStyle = '#0C0D0F'; for (let i = 8; i < 248; i += 12) { vg.beginPath(); vg.roundRect(i, 10, 5, 44, 2); vg.fill(); }
    const ventT = new THREE.CanvasTexture(vc); ventT.colorSpace = THREE.SRGBColorSpace;
    for (const sx of [-1, 1]) { const v = new THREE.Mesh(new THREE.PlaneGeometry(D * 0.66, H * 0.55), new THREE.MeshStandardMaterial({ map: ventT, roughness: 0.6, metalness: 0.5, polygonOffset: true, polygonOffsetFactor: -2 })); v.rotation.y = sx * Math.PI / 2; v.position.set(sx * (W / 2 + 0.0003), H * 0.5, -D * 0.08); g.add(v); }
    return { group: g, body, led, ledMat };
  };

  P.phone = (x, y, z, rotY = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rotY; scene.add(g); const b = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.008, 0.145, 3, 0.006), M.black); b.castShadow = true; g.add(b); const s = new THREE.Mesh(new THREE.PlaneGeometry(0.062, 0.135), new THREE.MeshStandardMaterial({ color: 0x0B0F14, emissive: 0x9FE3F0, emissiveIntensity: 0.25 })); s.rotation.x = -Math.PI / 2; s.position.y = 0.0045; g.add(s); return g; };

  P.plant = (x, z, { scale = 1 } = {}) => {
    const pot = cyl(0.24 * scale, 0.18 * scale, 0.42 * scale, M.pot, x, 0.21 * scale, z, 32);
    const soil = new THREE.Mesh(new THREE.CircleGeometry(0.22 * scale, 32), M.soil); soil.rotation.x = -Math.PI / 2; soil.position.set(x, 0.42 * scale, z); scene.add(soil);
    const leafGeo = new THREE.SphereGeometry(1, 12, 8); leafGeo.scale(0.07 * scale, 0.015 * scale, 0.2 * scale);
    const leaves = [];
    for (let i = 0; i < 16; i++) { const a = i * 2.39996, rad = (0.06 + (i % 4) * 0.03) * scale, h = (0.55 + (i % 5) * 0.09) * scale;
      const stem = add(new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.01, h - 0.42 * scale, 6), M.stem)); stem.position.set(x + Math.cos(a) * rad * 0.5, (h + 0.42 * scale) / 2, z + Math.sin(a) * rad * 0.5); stem.rotation.z = Math.cos(a) * 0.25; stem.rotation.x = -Math.sin(a) * 0.25;
      const leaf = add(new THREE.Mesh(leafGeo, M.leaf.clone())); leaf.material.color.offsetHSL(0, 0, (Math.random() - 0.5) * 0.12); leaf.position.set(x + Math.cos(a) * (rad + 0.12 * scale), h, z + Math.sin(a) * (rad + 0.12 * scale)); leaf.rotation.y = -a + Math.PI / 2; leaf.rotation.x = -0.35 - Math.random() * 0.3; leaves.push(leaf); }
    return { pot, soil, leaves };
  };

  P.floorLamp = (x, z) => {
    cyl(0.02, 0.02, 1.55, M.metal, x, 0.78, z, 16); cyl(0.2, 0.2, 0.03, M.metal, x, 0.015, z, 40);
    const shadeMat = M.shade.clone(); const shade = add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 0.36, 40, 1, true), shadeMat)); shade.position.set(x, 1.68, z);
    const bulb = new THREE.PointLight(0xFFCF98, 0, 7, 1.7); bulb.position.set(x, 1.62, z); bulb.castShadow = true; bulb.shadow.mapSize.set(1024, 1024); bulb.shadow.bias = -0.002; scene.add(bulb);
    const bulbMesh = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 16), new THREE.MeshStandardMaterial({ color: 0xFFF3DC, emissive: 0xFFD9A6, emissiveIntensity: 0 })); bulbMesh.position.copy(bulb.position); scene.add(bulbMesh);
    return { shade, shadeMat, bulb, bulbMesh, group: group(shade) };
  };

  P.sofa = (x, z) => { const parts = [box(1.9, 0.18, 0.9, M.sofa, x, 0.18, z, 0.03), box(0.85, 0.16, 0.8, M.sofa, x - 0.43, 0.35, z + 0.05, 0.05), box(0.85, 0.16, 0.8, M.sofa, x + 0.43, 0.35, z + 0.05, 0.05), box(1.9, 0.55, 0.22, M.sofa, x, 0.63, z - 0.35, 0.05), box(0.22, 0.6, 0.9, M.sofa, x - 1.05, 0.39, z, 0.05), box(0.22, 0.6, 0.9, M.sofa, x + 1.05, 0.39, z, 0.05)]; const c = box(0.42, 0.42, 0.13, M.cushion, x - 0.35, 0.62, z - 0.18, 0.05); c.rotation.y = 0.15; c.rotation.x = -0.15; [[-0.85, -0.35], [0.85, -0.35], [-0.85, 0.35], [0.85, 0.35]].forEach((p) => cyl(0.03, 0.02, 0.09, M.wood, x + p[0], 0.045, z + p[1], 10)); return parts; };
  P.table = (x, z, w = 1.0, d = 0.5, h = 0.42, top = M.wood, leg = M.black) => { const t = box(w, 0.04, d, top, x, h, z, 0.01); [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach((p) => box(0.04, h - 0.02, 0.04, leg, x + p[0] * (w / 2 - 0.05), (h - 0.02) / 2, z + p[1] * (d / 2 - 0.05))); return t; };
  P.rug = (x, z, w = 2.4, d = 1.7) => { const r = add(new THREE.Mesh(new THREE.PlaneGeometry(w, d), M.rug)); r.rotation.x = -Math.PI / 2; r.position.set(x, 0.006, z); return r; };
  P.picture = (x, y, z, w = 0.82, h = 0.62) => { box(0.03, h, w, M.frame, x, y, z); box(0.005, h - 0.08, w - 0.08, M.art, x + 0.02, y, z); };
  P.doorLeft = (xWall, z, w = 0.9, h = 2.05) => { box(0.03, h, w, M.door, xWall + 0.015, h / 2, z); box(0.035, h + 0.05, 0.06, M.trim, xWall + 0.02, h / 2 + 0.02, z - w / 2 - 0.03); box(0.035, h + 0.05, 0.06, M.trim, xWall + 0.02, h / 2 + 0.02, z + w / 2 + 0.03); box(0.035, 0.06, w + 0.12, M.trim, xWall + 0.02, h + 0.03, z); add(new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 12), M.metal)).position.set(xWall + 0.05, 1.0, z + w / 2 - 0.1); };
  P.smallCamera = (x, y, z, rotY = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rotY; scene.add(g); const b = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.06, 0.09, 3, 0.01), M.black); b.castShadow = true; g.add(b); const lens = new THREE.Mesh(new THREE.CircleGeometry(0.014, 16), new THREE.MeshStandardMaterial({ color: 0x0A0F14, roughness: 0.1 })); lens.position.z = 0.046; g.add(lens); const led = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 8), M.led(0x2FBF71)); led.position.set(0.02, 0.02, 0.046); g.add(led); return { group: g, led }; };
  P.ledDot = (x, y, z, hex = 0x2FBF71, r = 0.02) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 12), M.led(hex)); m.position.set(x, y, z); scene.add(m); return m; };
  P.tube = (points, r = 0.012, mat = M.black) => add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p))), 24, r, 8), mat));
  P.screenPlane = (w, h, texture) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: texture, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.9, roughness: 0.3 })); scene.add(m); return m; };
  P.beacon = (x, y, z) => { cyl(0.03, 0.03, 0.02, M.black, x, y, z); const m = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.06, 16), new THREE.MeshStandardMaterial({ color: 0x2FBF71, emissive: 0x2FBF71, emissiveIntensity: 1.5, transparent: true, opacity: 0.85 })); m.position.set(x, y + 0.04, z); scene.add(m); return m; };
  P.parcel = (x, y, z, s = 0.3) => { const m = box(s, s * 0.7, s * 0.8, M.cardboard, x, y + s * 0.35, z, 0.008); const tape = new THREE.Mesh(new THREE.BoxGeometry(s * 0.2, 0.002, s * 0.82), M.white); tape.position.y = s * 0.351; m.add(tape); return m; };

  // Highlight pulse for tapped devices: { deviceId: [meshes] }. Clones materials so shared ones aren't affected.
  P.highlighter = (map) => {
    const pulse = {}; const base = new Map();
    for (const meshes of Object.values(map)) for (const m of meshes) { if (m.material && !base.has(m)) { m.material = m.material.clone(); base.set(m, m.material.emissive ? m.material.emissive.clone() : null); } }
    return {
      focus(id) { pulse[id] = performance.now(); },
      update() { for (const [id, meshes] of Object.entries(map)) { const age = pulse[id] ? (performance.now() - pulse[id]) / 1000 : 99; const k = age < 1.6 ? Math.abs(Math.sin(age * Math.PI * 2.5)) * (1 - age / 1.6) : 0; for (const m of meshes) { const b = base.get(m); if (!b) continue; if (k > 0) m.material.emissive.set(0x29EEE5).lerp(b, 1 - k); else m.material.emissive.copy(b); } } },
    };
  };

  return P;
}

// Set light/emissive intensity helpers used by scenes.
export const lerp = (a, b, k) => a + (b - a) * k;
export const clamp01 = (v) => Math.max(0, Math.min(1, v));
