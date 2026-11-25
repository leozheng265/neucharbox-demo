// Procedural textures, materials and builders shared across scenes.
// Every builder adds to `scene` and returns the handles a scene needs to animate.
import './compat.js';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// ---------- textures ----------
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function grain(g, w, h, amount) { const img = g.getImageData(0, 0, w, h), d = img.data; for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * amount; d[i] += n; d[i + 1] += n; d[i + 2] += n; } g.putImageData(img, 0, 0); }
export function tex(c, rep = [1, 1], srgb = true) { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...rep); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }

export function noiseTex(base, amount, size = 512) { const [c, g] = canvas(size, size); g.fillStyle = base; g.fillRect(0, 0, size, size); grain(g, size, size, amount); return c; }
// Plank floor, seamless in both directions so any repeat tiles without a visible edge: each row is a loop of planks
// exactly one canvas wide (a plank running off the right edge is drawn again, identically, at the left), grain stays
// inside its row, and the tint varies per plank only (nothing that differs between opposite edges). Knots are rare,
// faint and stretched along the grain.
export function woodTex({ hue = 27, light = 60, rows = 9, sat = 40 } = {}) {
  const w = 1024, h = 1024, [c, g] = canvas(w, h); const ph = h / rows, R = Math.random, nLines = Math.round(ph * 0.55);
  for (let r = 0; r < rows; r++) {
    const y0 = r * ph, lens = []; let sum = 0;
    while (sum < w * 0.8 || lens.length < 2) { const len = 300 + R() * 420; lens.push(len); sum += len; }
    let x = -R() * w; // where the row's loop starts
    g.save(); g.beginPath(); g.rect(0, y0, w, ph); g.clip();
    for (const l0 of lens) {
      const len = (l0 * w) / sum, L = light - 2 + R() * 9, hu = hue + R() * 6;
      const lines = Array.from({ length: nLines }, () => [y0 + R() * ph, 0.6 + R() * 1.6, L - 14 + R() * 10, 0.18 + R() * 0.25, (R() - 0.5) * 10, (R() - 0.5) * 10, (R() - 0.5) * 4]);
      const knot = R() < 0.14 ? [50 + R() * (len - 100), y0 + ph * (0.3 + R() * 0.4), 6 + R() * 3] : null;
      for (const px of [x, x + w, x - w]) {
        if (px >= w || px + len <= 0) continue;
        g.fillStyle = `hsl(${hu}, ${sat}%, ${L}%)`; g.fillRect(px, y0, len, ph);
        for (const [y, lw, ll, la, a, b, e] of lines) { g.strokeStyle = `hsla(${hu - 3}, ${sat + 5}%, ${ll}%, ${la})`; g.lineWidth = lw; g.beginPath(); g.moveTo(px, y); g.bezierCurveTo(px + len * 0.3, y + a, px + len * 0.7, y + b, px + len, y + e); g.stroke(); }
        if (knot) { const [kx, ky, kr] = knot; g.save(); g.translate(px + kx, ky); g.scale(3.2, 1); const rg = g.createRadialGradient(0, 0, 0.5, 0, 0, kr); rg.addColorStop(0, `hsla(${hu - 8}, 45%, ${L - 26}%, .6)`); rg.addColorStop(0.3, `hsla(${hu - 6}, 45%, ${L - 17}%, .3)`); rg.addColorStop(1, `hsla(${hu - 4}, 42%, ${L - 9}%, 0)`); g.fillStyle = rg; g.fillRect(-kr, -kr, 2 * kr, 2 * kr); g.restore(); }
        g.fillStyle = 'rgba(30,15,5,.55)'; g.fillRect(px + len - 2, y0, 3, ph); // butt joint at the plank's end
      }
      x += len;
    }
    g.restore();
    g.fillStyle = 'rgba(30,15,5,.55)'; g.fillRect(0, y0, w, 3); // joint along the top of the row (the row below the last wraps to the top)
  }
  grain(g, w, h, 14); return c;
}
// ---- noise-driven surfaces (seeded, so every visit draws the same room) ----
// Tileable value-noise fBm in [0, 1]: `cells` lattice cells across the tile at the first octave, doubling per octave.
function rng(seed) { let s = (seed >>> 0) || 1; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }
export function fbm(size, cells = 4, octaves = 5, seed = 1, gain = 0.5) {
  const out = new Float32Array(size * size), R = rng(seed); let amp = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = cells << o; if (n > size) break; const g = Float32Array.from({ length: n * n }, R);
    for (let y = 0; y < size; y++) {
      const fy = (y * n) / size, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty), r0 = y0 * n, r1 = ((y0 + 1) % n) * n;
      for (let x = 0; x < size; x++) {
        const fx = (x * n) / size, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx), x1 = (x0 + 1) % n;
        const a = g[r0 + x0], b = g[r0 + x1], c = g[r1 + x0], d = g[r1 + x1];
        out[y * size + x] += amp * ((a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy);
      }
    }
    norm += amp; amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm; return out;
}
// Paint a size×size canvas from fn(x, y, i) → [r, g, b] (0–255).
function paint(size, fn) { const [c, g] = canvas(size, size); const img = g.getImageData(0, 0, size, size), d = img.data; for (let y = 0, i = 0; y < size; y++) for (let x = 0; x < size; x++, i++) { const [r, gg, b] = fn(x, y, i); d[i * 4] = r; d[i * 4 + 1] = gg; d[i * 4 + 2] = b; d[i * 4 + 3] = 255; } g.putImageData(img, 0, 0); return c; }
const hex3 = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
// Plaster: soft trowel clouds plus a fine sand grain. Returns colour, bump and roughness canvases.
export function plasterTex(base = 0xEAE6DE, seed = 7) {
  const S = 512, lo = fbm(S, 3, 5, seed), hi = fbm(S, 64, 2, seed + 1), [r, g, b] = hex3(base);
  const col = paint(S, (x, y, i) => { const k = 1 + (lo[i] - 0.5) * 0.07 + (hi[i] - 0.5) * 0.05; return [r * k, g * k, b * k]; });
  const bump = paint(S, (x, y, i) => { const v = 255 * (0.65 * hi[i] + 0.35 * lo[i]); return [v, v, v]; });
  const rough = paint(S, (x, y, i) => { const v = 255 * (0.82 + 0.18 * lo[i]); return [v, v, v]; });
  return { col, bump, rough };
}
// Plain-weave upholstery: warp and weft threads crossing over and under, each thread a slightly different shade (slub),
// plus a low cloud of wear. `threads` per tile edge (integer, so it tiles). Colour, and a height map for the bump.
export function fabricTex(base = 0x5E6266, { threads = 112, seed = 3, size = 512 } = {}) {
  const lo = fbm(size, 4, 4, seed), R = rng(seed + 9), slubU = Float32Array.from({ length: threads }, () => (R() - 0.5) * 0.12), slubV = Float32Array.from({ length: threads }, () => (R() - 0.5) * 0.12), [r, g, b] = hex3(base);
  const H = new Float32Array(size * size), C = new Float32Array(size * size);
  for (let y = 0, i = 0; y < size; y++) for (let x = 0; x < size; x++, i++) {
    const u = (x * threads) / size, v = (y * threads) / size, iu = Math.floor(u), iv = Math.floor(v), warp = (iu + iv) % 2 === 0;
    const h = warp ? Math.sin(Math.PI * (u - iu)) : Math.sin(Math.PI * (v - iv));
    H[i] = 0.25 + 0.75 * h; C[i] = (0.8 + 0.2 * h) * (1 + (warp ? slubU[iu] : slubV[iv]) + (lo[i] - 0.5) * 0.12);
  }
  const col = paint(size, (x, y, i) => [r * C[i], g * C[i], b * C[i]]);
  const bump = paint(size, (x, y, i) => { const v = 255 * H[i]; return [v, v, v]; });
  return { col, bump };
}
// Furniture wood: long grain along the tile's x, growth rings bent by a noise field, pores as fine dark streaks.
export function grainTex({ light = [176, 134, 92], dark = [120, 82, 52], rings = 14, seed = 5, size = 512 } = {}) {
  const warp = fbm(size, 2, 4, seed), pore = fbm(size, 128, 1, seed + 3), fine = fbm(size, 8, 3, seed + 5);
  return paint(size, (x, y, i) => {
    const t = (y / size) * rings + warp[i] * 1.6 + fine[i] * 0.3, f = t - Math.floor(t), ring = Math.pow(Math.abs(Math.sin(Math.PI * f)), 4);
    const k = Math.min(1, 0.4 + 0.32 * ring + 0.3 * (fine[i] - 0.5)) * (pore[i] > 0.8 ? 0.82 : 1);
    return [dark[0] + (light[0] - dark[0]) * (1 - k), dark[1] + (light[1] - dark[1]) * (1 - k), dark[2] + (light[2] - dark[2]) * (1 - k)];
  });
}
// Wool rug: oatmeal field, a double border with a thin aqua line, a faint lattice, and a fibre grain over all of it.
export function rugTex(size = 1024) {
  const fib = fbm(size, 256, 1, 11), cloud = fbm(size, 4, 4, 12), R = rng(13), field = [200, 189, 170], band = [150, 136, 118], aqua = [128, 186, 182];
  const c = paint(size, (x, y, i) => {
    const e = Math.min(x, y, size - 1 - x, size - 1 - y) / size; // 0 at the edge
    let col = field;
    if (e < 0.06) col = band; else if (e > 0.075 && e < 0.083) col = aqua; else if (e > 0.1 && e < 0.108) col = band;
    else if (e > 0.108) { const u = (x / size) * 7, v = (y / size) * 5, d = Math.abs(((u + v) % 1) - 0.5) + Math.abs(((u - v + 100) % 1) - 0.5); if (d < 0.06) col = [186, 174, 154]; }
    const k = (0.86 + 0.24 * fib[i]) * (1 + (cloud[i] - 0.5) * 0.08) + (R() - 0.5) * 0.06; return [col[0] * k, col[1] * k, col[2] * k];
  });
  return c;
}
// A leaf: midrib, paired side veins curving to the tip, a darker edge and a little mottling. u across, v along (tip at v 1).
export function leafTex() {
  const [c, g] = canvas(128, 256), n = fbm(64, 4, 3, 51);
  const lg = g.createLinearGradient(0, 256, 0, 0); lg.addColorStop(0, '#4E8A44'); lg.addColorStop(1, '#3B7436'); g.fillStyle = lg; g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 64; i++) for (let j = 0; j < 64; j++) { const k = n[j * 64 + i] - 0.5; g.fillStyle = k > 0 ? `rgba(120,170,90,${k * 0.35})` : `rgba(20,50,20,${-k * 0.35})`; g.fillRect(i * 2, j * 4, 2, 4); }
  g.strokeStyle = 'rgba(190,220,150,.75)'; g.lineWidth = 3; g.beginPath(); g.moveTo(64, 256); g.lineTo(64, 0); g.stroke();
  g.strokeStyle = 'rgba(170,210,140,.4)'; g.lineWidth = 1.4;
  for (let i = 0; i < 9; i++) { const y = 240 - i * 26; for (const sx of [-1, 1]) { g.beginPath(); g.moveTo(64, y); g.quadraticCurveTo(64 + sx * 34, y - 18, 64 + sx * 60, y - 52); g.stroke(); } }
  const eg = g.createLinearGradient(0, 0, 128, 0); eg.addColorStop(0, 'rgba(20,45,20,.35)'); eg.addColorStop(0.18, 'rgba(20,45,20,0)'); eg.addColorStop(0.82, 'rgba(20,45,20,0)'); eg.addColorStop(1, 'rgba(20,45,20,.35)'); g.fillStyle = eg; g.fillRect(0, 0, 128, 256);
  return c;
}
// Leaf blade geometry, centred like the old ellipsoid leaf (length along z, ±len/2): a pointed oval, folded a little along
// the midrib and arched along its length, so it catches light like a leaf and not a pebble.
export function leafGeometry(len = 0.4, wid = 0.14) {
  const geo = new THREE.PlaneGeometry(1, 1, 4, 12), pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const xn = pos.getX(i), t = pos.getY(i) + 0.5; // xn in [-0.5, 0.5] across, t 0 at the stalk, 1 at the tip
    const w = Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.08)), 0.75) * (1 - 0.25 * t) * wid;
    pos.setXYZ(i, xn * w, 0.07 * len * Math.sin(Math.PI * t) - 0.1 * len * t * t + Math.abs(xn) * w * 0.35, (t - 0.5) * len);
  }
  geo.computeVertexNormals(); return geo;
}
export function grassTex(size = 256) { const a = fbm(size, 8, 5, 21), b = fbm(size, 64, 2, 22); return paint(size, (x, y, i) => { const k = 0.75 + 0.4 * a[i] + 0.2 * (b[i] - 0.5); return [70 * k, 110 * k, 62 * k]; }); }
// Terracotta: warm clay with mottling and a little sand.
export function clayTex(size = 256) { const a = fbm(size, 4, 5, 31), b = fbm(size, 96, 1, 32); return paint(size, (x, y, i) => { const k = 0.88 + 0.22 * a[i] + 0.1 * (b[i] - 0.5); return [178 * k, 96 * k, 66 * k]; }); }
export function holeGridTex() { // optical breadboard: 25 mm pitch holes
  const [c, g] = canvas(1024, 1024); g.fillStyle = '#2B2E31'; g.fillRect(0, 0, 1024, 1024); grain(g, 1024, 1024, 10);
  for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) { g.fillStyle = '#0C0D0E'; g.beginPath(); g.arc(32 + i * 64, 32 + j * 64, 7, 0, Math.PI * 2); g.fill(); g.fillStyle = 'rgba(255,255,255,.08)'; g.beginPath(); g.arc(32 + i * 64, 30 + j * 64, 8, Math.PI, Math.PI * 2); g.fill(); }
  return c;
}
// Concrete slabs: grain, soft seamless mottling (hard-edged dark discs read as polka dots at floor scale), four joints.
export function concreteTex() {
  const [c, g] = canvas(1024, 1024); g.fillStyle = '#8E8F8B'; g.fillRect(0, 0, 1024, 1024); grain(g, 1024, 1024, 40);
  for (let i = 0; i < 45; i++) {
    const x = Math.random() * 1024, y = Math.random() * 1024, r = 50 + Math.random() * 130, a = 0.025 + Math.random() * 0.04, col = Math.random() < 0.7 ? '0,0,0' : '255,255,255';
    for (const cx of [x - 1024, x, x + 1024]) for (const cy of [y - 1024, y, y + 1024]) {
      if (cx + r < 0 || cx - r > 1024 || cy + r < 0 || cy - r > 1024) continue;
      const rg = g.createRadialGradient(cx, cy, 0, cx, cy, r); rg.addColorStop(0, `rgba(${col},${a})`); rg.addColorStop(1, `rgba(${col},0)`); g.fillStyle = rg; g.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    }
  }
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 3; g.strokeRect(2, 2, 508, 508); g.strokeRect(514, 2, 508, 508); g.strokeRect(2, 514, 508, 508); g.strokeRect(514, 514, 508, 508); return c;
}
export function tileTex(a = '#E9E6DF', b = '#DED9CF') { const [c, g] = canvas(512, 512); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { g.fillStyle = (i + j) % 2 ? a : b; g.fillRect(i * 128, j * 128, 126, 126); } g.fillStyle = '#B9B3A6'; for (let i = 0; i <= 4; i++) { g.fillRect(i * 128 - 1, 0, 2, 512); g.fillRect(0, i * 128 - 1, 512, 2); } grain(g, 512, 512, 12); return c; }
export function gradientTex(a, b) { const [c, g] = canvas(128, 8); const gr = g.createLinearGradient(0, 0, 128, 0); gr.addColorStop(0, a); gr.addColorStop(1, b); g.fillStyle = gr; g.fillRect(0, 0, 128, 8); return c; }
// A sign's text on a canvas; anisotropic like tex(), so it stays readable at a grazing angle. weight: '600', 'bold'…
export function labelTex(text, { bg = '#101418', fg = '#7CF0D8', size = 40, w = 256, h = 96, weight = '' } = {}) { const [c, g] = canvas(w, h); g.fillStyle = bg; g.fillRect(0, 0, w, h); g.fillStyle = fg; g.font = `${weight ? weight + ' ' : ''}${size}px "Segoe UI", Inter, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }

// ---------- materials ----------
export function materials() {
  // Floor planks about 19 cm wide (the tile repeats 3 times across a 5 m room), in a natural oak rather than an orange one.
  const woodC = woodTex({ hue: 31, light: 63, sat: 30 }), plaster = plasterTex(), fabric = fabricTex(0x5E6266), weave = fabricTex(0xB9C7BE, { threads: 80, seed: 4 }), rugC = rugTex(), linen = fabricTex(0xF3EBDD, { threads: 96, seed: 8 });
  const walnut = grainTex({ light: [112, 74, 46], dark: [58, 36, 22], rings: 12, seed: 5 }), oak = grainTex({ light: [214, 180, 136], dark: [168, 128, 86], rings: 16, seed: 6 }), clay = clayTex();
  const lin = (c, rep) => tex(c, rep, false);
  const M = {
    floor:   new THREE.MeshPhysicalMaterial({ map: tex(woodC, [3, 3]), bumpMap: lin(woodC, [3, 3]), bumpScale: 0.6, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.6 }), // at 0.35 the coat mirrored the sky into a bloom haze seen from behind a room
    // Plaster: soft trowel clouds and a sand grain, with the roughness varying a little across the wall.
    wall:    new THREE.MeshStandardMaterial({ map: tex(plaster.col, [2.5, 1.5]), bumpMap: lin(plaster.bump, [2.5, 1.5]), bumpScale: 0.35, roughnessMap: lin(plaster.rough, [2.5, 1.5]), roughness: 1 }),
    wallDark:new THREE.MeshStandardMaterial({ color: 0x5C6166, roughness: 0.95 }),
    ceiling: new THREE.MeshStandardMaterial({ map: tex(plaster.col, [2, 2]), color: 0xFBF9F4, roughness: 1 }),
    trim:    new THREE.MeshStandardMaterial({ color: 0xF6F3EC, roughness: 0.6 }),
    // Upholstery: a woven cloth with sheen, the soft bright rim fabric takes at grazing angles.
    sofa:    new THREE.MeshPhysicalMaterial({ map: tex(fabric.col, [6, 6]), bumpMap: lin(fabric.bump, [6, 6]), bumpScale: 0.5, roughness: 0.95, sheen: 1, sheenRoughness: 0.55, sheenColor: 0x8E979E }),
    cushion: new THREE.MeshPhysicalMaterial({ map: tex(weave.col, [3, 3]), bumpMap: lin(weave.bump, [3, 3]), bumpScale: 0.4, roughness: 1, sheen: 1, sheenRoughness: 0.5, sheenColor: 0xE4EEE8 }),
    bedding: new THREE.MeshStandardMaterial({ color: 0xE8E4DC, roughness: 1, bumpMap: lin(fabric.bump, [4, 4]), bumpScale: 0.3 }),
    rug:     new THREE.MeshPhysicalMaterial({ map: tex(rugC), bumpMap: lin(rugC, [1, 1]), bumpScale: 0.8, roughness: 1, sheen: 0.8, sheenRoughness: 0.8, sheenColor: 0xEDE4D4 }),
    pot:     new THREE.MeshStandardMaterial({ map: tex(clay, [2, 1]), bumpMap: lin(clay, [2, 1]), bumpScale: 0.4, roughness: 0.85 }),
    soil:    new THREE.MeshStandardMaterial({ color: 0x3B2A1E, roughness: 1 }),
    leaf:    new THREE.MeshPhysicalMaterial({ map: tex(leafTex()), color: 0xF2F2F2, roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.4, sheen: 0.4, sheenRoughness: 0.5, sheenColor: 0xBFE3A6, side: THREE.DoubleSide }),
    stem:    new THREE.MeshStandardMaterial({ color: 0x4E6B3A, roughness: 0.8 }),
    // Varnished woods: grain in the colour and the bump, under a clear coat that catches the light.
    wood:    new THREE.MeshPhysicalMaterial({ map: tex(walnut), bumpMap: lin(walnut), bumpScale: 0.25, roughness: 0.6, clearcoat: 0.6, clearcoatRoughness: 0.28 }),
    woodLight:new THREE.MeshPhysicalMaterial({ map: tex(oak), bumpMap: lin(oak), bumpScale: 0.25, roughness: 0.62, clearcoat: 0.45, clearcoatRoughness: 0.35 }),
    metal:   new THREE.MeshStandardMaterial({ color: 0xC2C7CC, roughness: 0.3, metalness: 0.95 }),
    steel:   new THREE.MeshStandardMaterial({ color: 0x8A9096, roughness: 0.45, metalness: 0.8 }),
    black:   new THREE.MeshStandardMaterial({ color: 0x2C3035, roughness: 0.5, metalness: 0.4 }),
    anodized:new THREE.MeshStandardMaterial({ color: 0x1B1D20, roughness: 0.55, metalness: 0.6 }),
    hub:     new THREE.MeshPhysicalMaterial({ color: 0xF8FBFA, roughness: 0.28, clearcoat: 0.9, clearcoatRoughness: 0.15 }),
    white:   new THREE.MeshStandardMaterial({ color: 0xF2F4F3, roughness: 0.6 }),
    shade:   new THREE.MeshStandardMaterial({ map: tex(linen.col, [6, 2]), color: 0xFFFFFF, roughness: 0.95, side: THREE.DoubleSide, emissive: 0xFFC98A, emissiveIntensity: 0 }),
    glass:   new THREE.MeshPhysicalMaterial({ color: 0xDDE8EE, roughness: 0.08, transparent: true, opacity: 0.12, envMapIntensity: 0.4 }),
    slat:    new THREE.MeshStandardMaterial({ color: 0xF5F1E8, roughness: 0.7 }),
    door:    new THREE.MeshStandardMaterial({ color: 0xE6E1D8, roughness: 0.7 }),
    frame:   new THREE.MeshStandardMaterial({ color: 0x1E1E1E, roughness: 0.6 }),
    art:     new THREE.MeshStandardMaterial({ color: 0xC9D7D2, roughness: 0.9 }),
    outside: new THREE.MeshStandardMaterial({ map: tex(grassTex(), [40, 40]), roughness: 1 }),
    tree:    new THREE.MeshStandardMaterial({ color: 0x5A8A50, roughness: 1, flatShading: true }),
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

  // Thin trims (skirting, crown, door casing, window mullions) are 2–3.5 cm deep: their narrow top, bottom and side faces
  // are sub-pixel strips that break into dotted lines without MSAA (phones) and serrate with it. Every vertex takes the
  // normal of the face the trim shows, so the whole box shades as that one surface.
  const flat = (m, nx, ny, nz) => { const a = m.geometry.attributes.normal; for (let i = 0; i < a.count; i++) a.setXYZ(i, nx, ny, nz); a.needsUpdate = true; return m; };
  // Wall-hung parts hide with their wall when the camera is outside it (renderer.js owns .visible of anything tagged).
  const onWall = (o, nx, nz, d, span) => { o.userData.wall = span ? { nx, nz, d, span } : { nx, nz, d }; return o; };
  P.flatNormals = flat; P.onWall = onWall;

  // A room whose walls are single-sided planes facing inward: solid from inside, invisible when the camera orbits
  // outside them (dollhouse cut-away), so the visitor can look in from any angle. Optional window in the back wall,
  // with a garden behind it: ground under and around the room, trees well behind the back wall.
  // Everything hung on the back or left wall (window, skirting, crown, and the trees once the camera is out in the
  // garden) is tagged userData.wall, so it hides with its wall. Returns the parts, for scenes that adjust them.
  // ceilShadows: the ceiling takes shadows, so a shade or pendant darkens the ceiling above it instead of leaving a hot
  // spot. Off by default: lights a few cm under the ceiling (lab, warehouse) would draw shadow-acne rings on it.
  P.roomShell = ({ w = 5, d = 5, h = 2.8, floorMat = M.floor, wallMat = M.wall, window = null, skirting = true, ceilShadows = false } = {}) => {
    const wm = wallMat.clone(); wm.shadowSide = THREE.DoubleSide;
    const floor = add(new THREE.Mesh(new THREE.PlaneGeometry(w, d), floorMat)); floor.rotation.x = -Math.PI / 2;
    const cm = M.ceiling.clone(); cm.shadowSide = THREE.DoubleSide;
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), cm); ceil.rotation.x = Math.PI / 2; ceil.position.y = h; ceil.castShadow = true; ceil.receiveShadow = ceilShadows; scene.add(ceil);
    const wall = (pw, ph, x, y, z, rotY) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), wm); m.position.set(x, y, z); m.rotation.y = rotY; m.receiveShadow = true; m.castShadow = true; scene.add(m); return m; };
    const zb = -d / 2, xl = -w / 2, walls = { back: [] }, trims = [], trees = []; let windowParts = [], ground = null;
    if (window) {
      const { x, y, ww, wh } = window; // window centre x, centre y, width, height
      const lw = (x - ww / 2) - xl, rw = (w / 2) - (x + ww / 2);
      walls.back.push(wall(lw, h, xl + lw / 2, h / 2, zb, 0), wall(rw, h, x + ww / 2 + rw / 2, h / 2, zb, 0), wall(ww, y - wh / 2, x, (y - wh / 2) / 2, zb, 0), wall(ww, h - (y + wh / 2), x, (h + y + wh / 2) / 2, zb, 0));
      // sill: the part in the room, and the part in the window reveal behind the wall plane (with the casing, below)
      const sill = box(ww + 0.06, 0.05, 0.17, M.trim, x, y - wh / 2 - 0.01, zb + 0.085), reveal = box(ww + 0.06, 0.05, 0.11, M.trim, x, y - wh / 2 - 0.01, zb - 0.055);
      const casing = [reveal, box(0.05, wh + 0.06, 0.2, M.trim, x - ww / 2, y, zb - 0.06), box(0.05, wh + 0.06, 0.2, M.trim, x + ww / 2, y, zb - 0.06), box(ww + 0.06, 0.05, 0.2, M.trim, x, y + wh / 2, zb - 0.06)];
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(ww, wh), M.glass); glass.position.set(x, y, zb - 0.1); scene.add(glass);
      const mullions = [flat(box(0.03, wh, 0.03, M.trim, x, y, zb - 0.1), 0, 0, 1), flat(box(ww, 0.03, 0.03, M.trim, x, y, zb - 0.1), 0, 0, 1)];
      // The casing sits behind the wall plane, so it is only ever seen through the window: past the end of the wall (a
      // camera outside the right wall, level with the back one) there is no wall to hide it, hence the span.
      onWall(sill, 0, 1, zb); for (const m of [...casing, glass, ...mullions]) onWall(m, 0, 1, zb, [xl, w / 2]); windowParts = [sill, ...casing, glass, ...mullions];
      // Ground under and around the room (the floor covers it inside, 2 cm above), so the room never hangs over sky.
      ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), M.outside); ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.02, -8); ground.receiveShadow = true; scene.add(ground);
      // Trees 12–15 m back, past the reach of an orbiting camera; they also hide with the back wall, so a camera out in
      // the garden never looks at the room through (or from inside) a tree.
      // Each tree: a trunk under a crown of three lumpy, flat-shaded blobs (one jittered geometry per tree), in two greens.
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6B5643, roughness: 1 }), crownMats = [M.tree, M.tree.clone()]; crownMats[1].color.set(0x4C7A46);
      const TR = rng(41);
      for (let i = 0; i < 7; i++) {
        const t = new THREE.Group(), s = 0.8 + TR() * 0.5; t.position.set(-4.5 + i * 1.8 + TR(), 0, -12 - TR() * 3);
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * s, 0.11 * s, 1.6 * s, 7), trunkMat); trunk.position.y = 0.8 * s; trunk.castShadow = true; t.add(trunk);
        const geo = new THREE.IcosahedronGeometry(1, 2), pos = geo.attributes.position, v = new THREE.Vector3();
        for (let k = 0; k < pos.count; k++) { v.fromBufferAttribute(pos, k); const n = 1 + 0.18 * Math.sin(v.x * 4.1 + i) * Math.sin(v.y * 3.7) * Math.sin(v.z * 4.3 + i * 0.7); pos.setXYZ(k, v.x * n, v.y * n, v.z * n); }
        geo.computeVertexNormals();
        for (const [dx, dy, dz, r] of [[0, 2.2, 0, 0.95], [0.5, 1.8, 0.2, 0.7], [-0.45, 1.9, -0.1, 0.75]]) { const c = new THREE.Mesh(geo, crownMats[i % 2]); c.position.set(dx * s, dy * s, dz * s); c.scale.set(r * s, r * s * 1.1, r * s); c.castShadow = true; t.add(c); }
        onWall(t, 0, 1, zb); scene.add(t); trees.push(t);
      }
    } else {
      walls.back.push(wall(w, h, 0, h / 2, zb, 0));
    }
    walls.left = wall(d, h, xl, h / 2, 0, Math.PI / 2);       // faces +x
    walls.right = wall(d, h, w / 2, h / 2, 0, -Math.PI / 2);  // faces -x
    walls.front = wall(w, h, 0, h / 2, d / 2, Math.PI);       // faces -z
    if (skirting) {
      trims.push(onWall(flat(box(w, 0.1, 0.02, M.trim, 0, 0.05, zb + 0.01), 0, 0, 1), 0, 1, zb), onWall(flat(box(w, 0.06, 0.02, M.trim, 0, h - 0.03, zb + 0.01), 0, 0, 1), 0, 1, zb)); // back: skirting, crown
      trims.push(onWall(flat(box(0.02, 0.1, d, M.trim, xl + 0.01, 0.05, 0), 1, 0, 0), 1, 0, xl), onWall(flat(box(0.02, 0.06, d, M.trim, xl + 0.01, h - 0.03, 0), 1, 0, 0), 1, 0, xl)); // left: skirting, crown
    }
    return { floor, ceil, walls, trims, windowParts, ground, trees };
  };

  P.blinds = (x, yTop, z, ww, n = 12, pitch = 0.107) => { const slats = []; for (let i = 0; i < n; i++) slats.push(box(ww, 0.012, 0.075, M.slat, x, yTop - i * pitch, z)); box(ww + 0.04, 0.05, 0.08, M.trim, x, yTop + 0.06, z); return slats; };

  // NeuCharBox hub, modelled on the Standard unit: dark graphite aluminium slab ~13 cm square, 3 cm tall,
  // N logo + wordmark on top, black front panel with a silver power button, status LED and four USB-A ports, vertical
  // vent slots on both sides, and a satin bevel at the base. Origin at the base centre; front = +z.
  // Off reads as off: the LED is a dark dot, the logo a plain grey print and nothing blooms. The scene drives
  // ledMat.emissiveIntensity (0 while the hub is off); the LED's glow and the backlit logo follow it.
  P.hub = (x, y, z, { rotY = 0, scale = 1 } = {}) => {
    const W = 0.14 * scale, H = 0.034 * scale, D = 0.14 * scale;
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rotY; scene.add(g);
    const brushed = noiseTex('#2C2F33', 10, 256);
    const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0x2A2D31, metalness: 0.78, roughness: 0.42, bumpMap: tex(brushed, [4, 1], false), bumpScale: 0.004, clearcoat: 0.15, clearcoatRoughness: 0.5 });
    const body = new THREE.Mesh(new RoundedBoxGeometry(W, H - 0.004 * scale, D, 5, 0.008 * scale), bodyMat); body.position.y = (H - 0.004 * scale) / 2 + 0.004 * scale; body.castShadow = body.receiveShadow = true; g.add(body);
    const bevel = new THREE.Mesh(new RoundedBoxGeometry(W - 0.004 * scale, 0.004 * scale, D - 0.004 * scale, 2, 0.002 * scale), new THREE.MeshStandardMaterial({ color: 0x6F757B, metalness: 0.45, roughness: 0.5 })); bevel.position.y = 0.002 * scale; g.add(bevel);
    // top logo (white silkscreen) as a transparent decal
    const lc = document.createElement('canvas'); lc.width = lc.height = 512; const lg = lc.getContext('2d');
    lg.fillStyle = '#F4F6F7'; lg.beginPath(); lg.roundRect(176, 130, 160, 160, 28); lg.fill();
    lg.globalCompositeOperation = 'destination-out'; lg.beginPath(); lg.roundRect(222, 130, 68, 92, 14); lg.fill(); lg.beginPath(); lg.roundRect(222, 198, 68, 92, 14); lg.fill();
    lg.globalCompositeOperation = 'source-over'; lg.fillStyle = '#F4F6F7'; lg.beginPath(); lg.moveTo(214, 148); lg.lineTo(258, 148); lg.lineTo(298, 272); lg.lineTo(254, 272); lg.closePath(); lg.fill();
    lg.font = '600 46px Inter, "Segoe UI", Arial, sans-serif'; lg.textAlign = 'center'; lg.textBaseline = 'top'; lg.fillText('NeuCharBox', 256, 306);
    const logoT = new THREE.CanvasTexture(lc); logoT.colorSpace = THREE.SRGBColorSpace; logoT.anisotropy = 8;
    // printed in light grey (a white print blooms under a bright lamp while the hub is still off); backlit once it is on
    const logoMat = new THREE.MeshStandardMaterial({ map: logoT, color: 0xB4BABE, emissive: 0xD6FFF8, emissiveMap: logoT, emissiveIntensity: 0, transparent: true, roughness: 0.8, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2 });
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.62, W * 0.62), logoMat); logo.rotation.x = -Math.PI / 2; logo.position.y = H + 0.0004; g.add(logo);
    logo.onBeforeRender = () => { logoMat.emissiveIntensity = 0.9 * Math.min(1, ledMat.emissiveIntensity); };
    // front panel: black inset with four USB-A ports and labels
    const fc = document.createElement('canvas'); fc.width = 1024; fc.height = 128; const fg = fc.getContext('2d');
    fg.fillStyle = '#0A0B0D'; fg.beginPath(); fg.roundRect(0, 0, 1024, 128, 14); fg.fill();
    fg.fillStyle = '#15171A'; for (let i = 0; i < 1024; i += 6) fg.fillRect(i, 0, 2, 128);
    for (let i = 0; i < 4; i++) { const cx = 470 + i * 150; fg.fillStyle = '#C6CACF'; fg.beginPath(); fg.roundRect(cx - 34, 30, 68, 30, 4); fg.fill(); fg.fillStyle = '#0A0B0D'; fg.fillRect(cx - 29, 35, 58, 20); fg.fillStyle = '#E8EAED'; fg.fillRect(cx - 24, 38, 48, 8); fg.fillStyle = '#B8BCC1'; fg.font = '600 20px Inter, "Segoe UI", Arial, sans-serif'; fg.textAlign = 'center'; fg.textBaseline = 'top'; fg.fillText('USB', cx, 70); }
    fg.fillStyle = '#B8BCC1'; fg.font = '600 20px Inter, "Segoe UI", Arial, sans-serif'; fg.textAlign = 'center'; fg.fillText('⏻', 150, 74);
    const frontT = new THREE.CanvasTexture(fc); frontT.colorSpace = THREE.SRGBColorSpace; frontT.anisotropy = 8;
    const front = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.84, H * 0.5), new THREE.MeshStandardMaterial({ map: frontT, roughness: 0.3, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -2 })); front.position.set(W * 0.02, H * 0.5, D / 2 + 0.0003); g.add(front);
    const button = new THREE.Mesh(new THREE.CylinderGeometry(0.0032 * scale, 0.0032 * scale, 0.0015 * scale, 20), new THREE.MeshStandardMaterial({ color: 0xC9CDD2, metalness: 0.9, roughness: 0.3 })); button.rotation.x = Math.PI / 2; button.position.set(-W * 0.34, H * 0.55, D / 2 + 0.0008); g.add(button);
    const ledMat = new THREE.MeshStandardMaterial({ color: 0x2A3A3A, emissive: 0x29EEE5, emissiveIntensity: 0 }); // dark dot while off
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.0012 * scale, 10, 10), ledMat); led.position.set(-W * 0.29, H * 0.58, D / 2 + 0.0008); g.add(led);
    // The LED is 2.4 mm across (sub-pixel from any room camera), so it gets a small screen-sized glow driven by ledMat.
    const hc = document.createElement('canvas'); hc.width = hc.height = 64; const hgc = hc.getContext('2d');
    const rg = hgc.createRadialGradient(32, 32, 0, 32, 32, 32); rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.22, 'rgba(255,255,255,.85)'); rg.addColorStop(0.5, 'rgba(255,255,255,.3)'); rg.addColorStop(1, 'rgba(255,255,255,0)'); hgc.fillStyle = rg; hgc.fillRect(0, 0, 64, 64);
    const haloT = new THREE.CanvasTexture(hc); haloT.colorSpace = THREE.SRGBColorSpace;
    // normal blending, not additive: over the black body an additive glow went dark teal and over a bright counter it
    // washed out, so its two halves read as a disc cut along the hub's outline
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloT, color: 0x29EEE5, transparent: true, depthWrite: false, sizeAttenuation: false, opacity: 0 }));
    const ledAt = led.position.clone(), toCam = new THREE.Vector3();
    halo.scale.setScalar(0.016); halo.position.copy(ledAt); halo.userData.noAO = true; halo.raycast = () => {}; g.add(halo);
    // Depth-tested, but moved a few cm from the LED toward the camera every frame (about three times the glow's radius at that
    // distance): the hub's own body can't cut it into a half-disc, and anything standing between the camera and the hub
    // (a chair back, a partition) still hides it.
    halo.onBeforeRender = (r, sc, cam) => {
      halo.material.opacity = Math.min(1, ledMat.emissiveIntensity / 3);
      toCam.copy(cam.position); g.worldToLocal(toCam).sub(ledAt); const d = toCam.length() || 1;
      halo.position.copy(ledAt).addScaledVector(toCam, Math.min(0.4 * d, Math.max(0.04, 0.025 * d)) / d); halo.updateMatrixWorld();
    };
    // vent slots on both sides
    const vc = document.createElement('canvas'); vc.width = 256; vc.height = 64; const vg = vc.getContext('2d');
    vg.fillStyle = '#2A2D31'; vg.fillRect(0, 0, 256, 64); vg.fillStyle = '#0C0D0F'; for (let i = 8; i < 248; i += 12) { vg.beginPath(); vg.roundRect(i, 10, 5, 44, 2); vg.fill(); }
    const ventT = new THREE.CanvasTexture(vc); ventT.colorSpace = THREE.SRGBColorSpace;
    for (const sx of [-1, 1]) { const v = new THREE.Mesh(new THREE.PlaneGeometry(D * 0.66, H * 0.55), new THREE.MeshStandardMaterial({ map: ventT, roughness: 0.6, metalness: 0.5, polygonOffset: true, polygonOffsetFactor: -2 })); v.rotation.y = sx * Math.PI / 2; v.position.set(sx * (W / 2 + 0.0003), H * 0.5, -D * 0.08); g.add(v); }
    return { group: g, body, led, ledMat };
  };

  P.phone = (x, y, z, rotY = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rotY; scene.add(g); const b = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.008, 0.145, 3, 0.006), M.black); b.castShadow = true; g.add(b); const s = new THREE.Mesh(new THREE.PlaneGeometry(0.062, 0.135), new THREE.MeshStandardMaterial({ color: 0x0B0F14, emissive: 0x9FE3F0, emissiveIntensity: 0.25 })); s.rotation.x = -Math.PI / 2; s.position.y = 0.0045; g.add(s); return g; };

  // Potted plant under one root group at (x, y, z); parts are local to it. Soil sits 3 mm above the pot's top cap.
  P.plant = (x, z, { scale = 1, y = 0, front = false } = {}) => { // front: leaves only on the +z side (plant against a back wall)
    const g = new THREE.Group(); g.position.set(x, y, z); scene.add(g);
    const put = (m) => { m.castShadow = m.receiveShadow = true; g.add(m); return m; };
    const pot = put(new THREE.Mesh(new THREE.CylinderGeometry(0.24 * scale, 0.18 * scale, 0.42 * scale, 32), M.pot)); pot.position.y = 0.21 * scale;
    const soil = new THREE.Mesh(new THREE.CircleGeometry(0.22 * scale, 32), M.soil); soil.rotation.x = -Math.PI / 2; soil.position.y = 0.42 * scale + 0.003; soil.receiveShadow = true; g.add(soil);
    const leafGeo = leafGeometry(0.4 * scale, 0.14 * scale);
    const leaves = [];
    for (let i = 0; i < 16; i++) { const a0 = i * 2.39996, a = front ? 0.15 + ((a0 % (2 * Math.PI)) / (2 * Math.PI)) * (Math.PI - 0.3) : a0, rad = (0.06 + (i % 4) * 0.03) * scale, h = (0.55 + (i % 5) * 0.09) * scale;
      const stem = put(new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.01, h - 0.42 * scale, 6), M.stem)); stem.position.set(Math.cos(a) * rad * 0.5, (h + 0.42 * scale) / 2, Math.sin(a) * rad * 0.5); stem.rotation.z = Math.cos(a) * 0.25; stem.rotation.x = -Math.sin(a) * 0.25;
      const leaf = put(new THREE.Mesh(leafGeo, M.leaf.clone())); leaf.material.color.offsetHSL(0, 0, (Math.random() - 0.5) * 0.12); leaf.position.set(Math.cos(a) * (rad + 0.12 * scale), h, Math.sin(a) * (rad + 0.12 * scale)); leaf.rotation.y = -a + Math.PI / 2; leaf.rotation.x = -0.35 - Math.random() * 0.3; leaves.push(leaf); }
    return { group: g, pot, soil, leaves };
  };
  // Floor (or table) lamp under one root group at (x, y, z). Defaults reproduce the original floor lamp:
  // pole top 1.555, shade centre 1.68, bulb 1.62. base: false drops the floor disc (e.g. a lamp on a table).
  // shaded: the shade blocks its bulb on every tier. The bulb's shadow near plane moves in to 5 cm so the shade (10–30 cm
  // from the bulb) is in its shadow map, with a smaller depth bias (point shadows store perspective depth), a normal
  // bias against acne rings near the bulb and a soft rim (PCF radius 8: three's 5-sample point PCF stipples from about
  // 12). The shade keeps only its inside, which takes no shadows so its own bulb doesn't darken it, and gets an outer
  // skin (returned as `skin`, glowing with shadeMat) that does take them, so the sun or a lamp in the next room doesn't
  // light it through a wall; the shade itself casts from both sides. Where the tier drops point-light shadows, the
  // renderer lights the room through the shade's openings instead (renderer.js, shadeCones).
  P.floorLamp = (x, z, { y = 0, height = 1.55, shadeScale = 1, base = true, shaded = false } = {}) => {
    const g = new THREE.Group(); g.position.set(x, y, z); scene.add(g);
    const put = (m) => { m.castShadow = m.receiveShadow = true; g.add(m); return m; };
    const pr = 0.02 * Math.max(0.6, shadeScale);
    // the pole stands right under the bulb: with a near shadow plane its shadow from that bulb was a black disc at its foot
    const pole = put(new THREE.Mesh(new THREE.CylinderGeometry(pr, pr, height, 16), M.metal)); pole.position.y = height / 2 + 0.005; pole.castShadow = false;
    if (base) { const disc = put(new THREE.Mesh(new THREE.CylinderGeometry(0.2 * shadeScale, 0.2 * shadeScale, 0.03, 40), M.metal)); disc.position.y = 0.015; }
    const shadeMat = M.shade.clone(); const shade = put(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 0.36, 40, 1, true), shadeMat)); shade.scale.setScalar(shadeScale); shade.position.y = height + 0.13 * shadeScale;
    const bulb = new THREE.PointLight(0xFFCF98, 0, 7, 1.7); bulb.position.y = height + 0.07 * shadeScale; bulb.castShadow = true; bulb.shadow.mapSize.set(1024, 1024); bulb.shadow.bias = -0.002; g.add(bulb);
    let skin = null;
    if (shaded) {
      Object.assign(bulb.shadow, { bias: -0.0002, normalBias: 0.01, radius: 8 }); bulb.shadow.camera.near = 0.05; bulb.shadow.camera.updateProjectionMatrix(); shade.receiveShadow = false;
      shadeMat.side = THREE.BackSide; shadeMat.shadowSide = THREE.DoubleSide;
      skin = new THREE.Mesh(shade.geometry, shadeMat.clone()); skin.material.side = THREE.FrontSide; skin.castShadow = false; skin.receiveShadow = true; skin.userData.noHighlight = true;
      skin.onBeforeRender = () => { skin.material.color.copy(shadeMat.color); skin.material.emissive.copy(shadeMat.emissive); skin.material.emissiveIntensity = shadeMat.emissiveIntensity; };
      shade.add(skin);
      // the openings seen from the bulb: bottom rim 67° off straight down, top rim 40° off straight up; the shade itself
      // lies within 0.31 × shadeScale of the bulb
      bulb.userData.shadeCones = [{ dir: [0, -1, 0], angle: 1.2, penumbra: 0.12 }, { dir: [0, 1, 0], angle: 0.74, penumbra: 0.15 }]; bulb.userData.shadeReach = 0.42 * shadeScale;
    }
    const bulbMesh = new THREE.Mesh(new THREE.SphereGeometry(0.035 * Math.max(0.5, shadeScale), 16, 16), new THREE.MeshStandardMaterial({ color: 0xFFF3DC, emissive: 0xFFD9A6, emissiveIntensity: 0 })); bulbMesh.position.copy(bulb.position); g.add(bulbMesh);
    return { group: g, pole, shade, shadeMat, skin, bulb, bulbMesh };
  };

  P.sofa = (x, z) => { const parts = [box(1.9, 0.18, 0.9, M.sofa, x, 0.18, z, 0.03), box(0.85, 0.16, 0.8, M.sofa, x - 0.43, 0.35, z + 0.05, 0.05), box(0.85, 0.16, 0.8, M.sofa, x + 0.43, 0.35, z + 0.05, 0.05), box(1.9, 0.55, 0.22, M.sofa, x, 0.63, z - 0.35, 0.05), box(0.22, 0.6, 0.9, M.sofa, x - 1.05, 0.39, z, 0.05), box(0.22, 0.6, 0.9, M.sofa, x + 1.05, 0.39, z, 0.05)]; const c = box(0.42, 0.42, 0.13, M.cushion, x - 0.35, 0.62, z - 0.18, 0.05); c.rotation.y = 0.15; c.rotation.x = -0.15; [[-0.85, -0.35], [0.85, -0.35], [-0.85, 0.35], [0.85, 0.35]].forEach((p) => cyl(0.03, 0.02, 0.09, M.wood, x + p[0], 0.045, z + p[1], 10)); return parts; };
  P.table = (x, z, w = 1.0, d = 0.5, h = 0.42, top = M.wood, leg = M.black) => { const t = box(w, 0.04, d, top, x, h, z, 0.01); [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach((p) => box(0.04, h - 0.02, 0.04, leg, x + p[0] * (w / 2 - 0.05), (h - 0.02) / 2, z + p[1] * (d / 2 - 0.05))); return t; };
  P.rug = (x, z, w = 2.4, d = 1.7) => { const r = add(new THREE.Mesh(new THREE.PlaneGeometry(w, d), M.rug)); r.rotation.x = -Math.PI / 2; r.position.set(x, 0.006, z); return r; };
  // Picture on a wall facing +x (a left wall) whose plane is 2 cm behind x; it hides with that wall. Returns its meshes.
  P.picture = (x, y, z, w = 0.82, h = 0.62) => [box(0.03, h, w, M.frame, x, y, z), box(0.005, h - 0.08, w - 0.08, M.art, x + 0.02, y, z)].map((m) => onWall(m, 1, 0, x - 0.02));
  // Door in a left wall (plane x = xWall, facing +x): leaf, casing and knob hide with the wall. Returns its meshes.
  P.doorLeft = (xWall, z, w = 0.9, h = 2.05) => {
    const parts = [box(0.03, h, w, M.door, xWall + 0.015, h / 2, z), box(0.035, h + 0.05, 0.06, M.trim, xWall + 0.02, h / 2 + 0.02, z - w / 2 - 0.03), box(0.035, h + 0.05, 0.06, M.trim, xWall + 0.02, h / 2 + 0.02, z + w / 2 + 0.03), box(0.035, 0.06, w + 0.12, M.trim, xWall + 0.02, h + 0.03, z)].map((m) => flat(m, 1, 0, 0));
    const knob = add(new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 12), M.metal)); knob.position.set(xWall + 0.05, 1.0, z + w / 2 - 0.1);
    return [...parts, knob].map((m) => onWall(m, 1, 0, xWall));
  };
  P.smallCamera = (x, y, z, rotY = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rotY; scene.add(g); const b = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.06, 0.09, 3, 0.01), M.black); b.castShadow = true; g.add(b); const lens = new THREE.Mesh(new THREE.CircleGeometry(0.014, 16), new THREE.MeshStandardMaterial({ color: 0x0A0F14, roughness: 0.1 })); lens.position.z = 0.046; g.add(lens); const led = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 8), M.led(0x2FBF71)); led.position.set(0.02, 0.02, 0.046); g.add(led); return { group: g, led }; };
  P.ledDot = (x, y, z, hex = 0x2FBF71, r = 0.02) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 12), M.led(hex)); m.position.set(x, y, z); scene.add(m); return m; };
  P.tube = (points, r = 0.012, mat = M.black) => add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p))), 24, r, 8), mat));
  P.screenPlane = (w, h, texture) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: texture, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.9, roughness: 0.3 })); scene.add(m); return m; };
  P.beacon = (x, y, z) => { cyl(0.03, 0.03, 0.02, M.black, x, y, z); const m = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.06, 16), new THREE.MeshStandardMaterial({ color: 0x2FBF71, emissive: 0x2FBF71, emissiveIntensity: 1.5, transparent: true, opacity: 0.85 })); m.position.set(x, y + 0.04, z); scene.add(m); return m; };
  const TAPE = new THREE.MeshStandardMaterial({ color: 0xD8D5CB, roughness: 0.85 }); // parcel tape: off-white and matte, so it doesn't bloom under bright ceiling lights
  P.parcel = (x, y, z, s = 0.3) => { const m = box(s, s * 0.7, s * 0.8, M.cardboard, x, y + s * 0.35, z, 0.008); const tape = new THREE.Mesh(new THREE.BoxGeometry(s * 0.2, 0.002, s * 0.82), TAPE); tape.position.y = s * 0.351; m.add(tape); return m; };

  // Highlight pulse for tapped devices: { deviceId: [meshes or groups] }. Adds a faint additive cyan shell as a
  // child of each mesh instead of touching the device's own material, so scenes can keep animating emissive,
  // colour or opacity on the real materials (and shared materials never light up other objects). A mesh with
  // userData.noHighlight (a lamp shade's outer skin) gets none. focus(id, hex) pulses in that colour: main.js passes
  // red for a fault, under its red ring; a later focus(id) is cyan again. A pulse in another colour than cyan ends the
  // cyan pulses still running on other devices (a move cue's), so the eye goes to the fault, not to what moved before it.
  P.highlighter = (map) => {
    const pulse = {}; const shells = {}; const hue = {};
    for (const [id, targets] of Object.entries(map)) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x29EEE5, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
      const meshes = []; for (const t of targets) t && t.traverse((m) => { if (m.isMesh && !m.userData.isShell && !m.userData.noHighlight) meshes.push(m); });
      const list = meshes.map((m) => {
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        const bb = m.geometry.boundingBox, c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
        const o = new THREE.Mesh(m.geometry, mat); o.userData.isShell = o.userData.noAO = true;
        o.scale.set(sz.x > 1e-4 ? 1 + 0.008 / sz.x : 1, sz.y > 1e-4 ? 1 + 0.008 / sz.y : 1, sz.z > 1e-4 ? 1 + 0.008 / sz.z : 1);
        o.position.set(c.x * (1 - o.scale.x), c.y * (1 - o.scale.y), c.z * (1 - o.scale.z));
        o.visible = false; o.raycast = () => {}; m.add(o); return o;
      });
      shells[id] = { mat, list };
    }
    return {
      focus(id, hex = 0x29EEE5) {
        if (hex !== 0x29EEE5) for (const k of Object.keys(pulse)) if (k !== id && hue[k] === 0x29EEE5) delete pulse[k];
        pulse[id] = performance.now(); hue[id] = hex; shells[id]?.mat.color.setHex(hex);
      },
      update() {
        const now = performance.now();
        for (const [id, sh] of Object.entries(shells)) {
          const age = pulse[id] ? (now - pulse[id]) / 1000 : 99; const k = age < 1.6 ? Math.abs(Math.sin(age * Math.PI * 2.5)) * (1 - age / 1.6) : 0;
          sh.mat.opacity = k * 0.6; for (const o of sh.list) o.visible = k > 0.01;
        }
      },
    };
  };

  return P;
}

// Set light/emissive intensity helpers used by scenes.
export const lerp = (a, b, k) => a + (b - a) * k;
export const clamp01 = (v) => Math.max(0, Math.min(1, v));
