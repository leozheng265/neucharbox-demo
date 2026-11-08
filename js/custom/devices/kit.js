// Shared parts of the custom room's device models (js/custom/devices/<category>.js): a status LED with a fault glow,
// mesh merging (fewer draw calls, so 20 devices stay smooth on a phone) and the number helpers card status lines use.
// Nothing here imports 'three': models get THREE from their context, so the page, Node checks and thumbnails share them.

export const HEX = { green: 0x2FBF71, red: 0xE0563A, amber: 0xFFB020, blue: 0x3AB7FF, off: 0x2E3337 };

export const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0); // null, NaN and text read as 0
export const clamp01 = (v) => Math.min(1, Math.max(0, num(v)));
export const pct = (v) => Math.round(clamp01(v) * 100); // a 0–1 field as a whole percent
export const oneDecimal = (v) => String(Number(num(v).toFixed(1))); // 21 → "21", 19.5 → "19.5", no float noise

// One radial glow texture for every LED (created on first use).
let glowTex = null;
function glowMap(THREE) {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32); rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.22, 'rgba(255,255,255,.85)'); rg.addColorStop(0.5, 'rgba(255,255,255,.3)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c); glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

// A device's status LED: a small emissive sphere added to `parent` at `at`, or an LED mesh a builder already made
// (`mesh`, e.g. P.smallCamera's). set(slice, t, hex, level) each frame:
//   offline → a dark dot (no light) · fault → blinking red with a screen-sized red glow · busy → `hex` pulsing ·
//   otherwise `hex` (green by default) at `level`.
// The LED itself is a pixel or two from the room camera, so a fault also shows the glow (as Home's do): depth-tested,
// normal blending (an additive red washes out to white on a pale wall), and moved up to 12 cm toward the camera each
// frame (onBeforeRender), so its own device never cuts it in half.
export function statusLed(THREE, parent, { at = [0, 0, 0], r = 0.007, mesh = null, size = 0.045 } = {}) {
  const led = mesh || new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), new THREE.MeshStandardMaterial({ color: HEX.green, emissive: HEX.green, emissiveIntensity: 1.5 }));
  if (!mesh) { led.position.set(...at); parent.add(led); }
  const host = led.parent, mat = led.material;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap(THREE), color: HEX.red, transparent: true, depthWrite: false, sizeAttenuation: false, opacity: 0 }));
  glow.scale.setScalar(size); glow.visible = false; glow.userData.noAO = true; glow.raycast = () => {}; host.add(glow);
  const home = led.position.clone(), toCam = new THREE.Vector3();
  glow.position.copy(home);
  glow.onBeforeRender = (renderer, scene, cam) => {
    toCam.copy(cam.position); host.worldToLocal(toCam).sub(home); const d = toCam.length() || 1;
    glow.position.copy(home).addScaledVector(toCam, Math.min(0.12, d * 0.5) / d); glow.updateMatrixWorld();
  };
  const paint = (hex, k) => { mat.color.setHex(hex); mat.emissive.setHex(hex); mat.emissiveIntensity = k; };
  return {
    mesh: led,
    set(s, t, hex = HEX.green, level = 1.5) {
      const st = s && s.status, blink = Math.floor(t * 3) % 2 === 0;
      glow.visible = st === 'fault';
      if (st === 'offline') paint(HEX.off, 0);
      else if (st === 'fault') { paint(HEX.red, blink ? 6 : 1); glow.material.opacity = blink ? 1 : 0.25; }
      else paint(hex, st === 'busy' ? level * (0.55 + 0.45 * Math.sin(t * 6)) : level);
    },
  };
}

// One mesh from several siblings (their transforms in their common parent baked in), in `material`: one draw call
// instead of many. The parts must have no maps (no uvs are kept). tint: each part's material colour becomes its vertex
// colour (give a white, vertexColors material). consume: the parts leave their parent and free their geometry.
export function mergeMeshes(THREE, meshes, material, { tint = false, consume = false } = {}) {
  const pos = [], nrm = [], col = [], idx = [], v = new THREE.Vector3(), nm = new THREE.Matrix3();
  for (const m of meshes) {
    m.updateMatrix(); nm.getNormalMatrix(m.matrix);
    const g = m.geometry, P = g.attributes.position, N = g.attributes.normal, base = pos.length / 3, c = m.material.color;
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(m.matrix); pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nrm.push(v.x, v.y, v.z);
      if (tint) col.push(c.r, c.g, c.b);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
    else for (let i = 0; i < P.count; i++) idx.push(base + i);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  if (tint) geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  const out = new THREE.Mesh(geo, material); out.castShadow = out.receiveShadow = true;
  if (consume) for (const m of meshes) { m.removeFromParent(); m.geometry.dispose(); }
  return out;
}
