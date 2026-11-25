// Real-world assets for a scene's room (assets/CREDITS.md: Poly Haven, CC0): glTF models at 1k textures, PBR texture
// sets (colour, OpenGL normal, roughness) and an HDRI for the view out of the window. A scene lists what it wants in
//   scene.assets = { models: ['Sofa_01', …], textures: ['wood_floor', …], hdri: 'name_2k.hdr' }
// and main.js loads them before build(), which gets them as `assets`. A room must still build without them (Node
// tests, a failed download): build() falls back to its primitives.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

const cache = new Map(); // url → promise; a scene visited twice loads its files once (meshes are cloned per room)

function once(url, load) { if (!cache.has(url)) cache.set(url, load().catch((e) => { cache.delete(url); throw e; })); return cache.get(url); }

export async function loadAssets(spec, base = 'assets/') {
  const gl = new GLTFLoader(), tl = new THREE.TextureLoader(), hl = new HDRLoader();
  const out = { models: {}, textures: {}, hdri: null }, jobs = [];
  for (const id of spec.models || []) {
    // Some models keep each part in its own glTF scene (Poly Haven's potted plants): gather them all under one group.
    jobs.push(once(`${base}models/${id}/${id}_1k.gltf`, () => gl.loadAsync(`${base}models/${id}/${id}_1k.gltf`)).then((g) => {
      const root = new THREE.Group(); root.name = id;
      for (const s of g.scenes) for (const c of s.children) root.add(c.clone(true));
      // Geometry, materials and textures are shared by every copy of a model: a room that drops one copy (room3d.js
      // drop()) must not free them.
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = o.receiveShadow = true; o.geometry.userData.shared = true;
        for (const m of [].concat(o.material)) { m.userData.shared = true; for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) if (m[k]) m[k].userData.shared = true; }
      });
      out.models[id] = root;
    }));
  }
  for (const id of spec.textures || []) {
    const set = (out.textures[id] = {});
    for (const [key, file, srgb] of [['map', 'Diffuse', true], ['normalMap', 'nor_gl', false], ['roughnessMap', 'Rough', false]]) {
      const url = `${base}textures/${id}/${file}.jpg`;
      jobs.push(once(url, () => tl.loadAsync(url)).then((t) => { t = t.clone(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; t.userData.shared = true; set[key] = t; }));
    }
  }
  if (spec.hdri) { const url = `${base}hdri/${spec.hdri}`; jobs.push(once(url, () => hl.loadAsync(url)).then((t) => { t.mapping = THREE.EquirectangularReflectionMapping; out.hdri = t; })); }
  await Promise.all(jobs);
  // A fresh copy of a model for each placement (geometry, materials and textures shared): out.copy(id), null if absent.
  out.copy = (id) => (out.models[id] ? out.models[id].clone(true) : null);
  return out;
}

// A PBR material from a loaded texture set, tiled `repeat` times (its own texture copies, so repeats don't clash).
export function pbrMaterial(set, repeat = [1, 1], params = {}) {
  const m = {};
  for (const k of ['map', 'normalMap', 'roughnessMap']) if (set?.[k]) { const t = set[k].clone(); t.repeat.set(...repeat); t.needsUpdate = true; m[k] = t; }
  return new THREE.MeshStandardMaterial({ ...m, roughness: 1, ...params });
}

// Put a model on the floor (or a surface at y) centred on (x, z) by its bounding box, after rotating it by rotY and
// scaling it by s. Returns the world bounding box it ends up with.
export function place(obj, { x = 0, y = 0, z = 0, rotY = 0, s = 1 } = {}) {
  obj.rotation.y = rotY; obj.scale.setScalar(s); obj.position.set(0, 0, 0); obj.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(obj), c = b.getCenter(new THREE.Vector3());
  obj.position.set(x - c.x, y - b.min.y, z - c.z); obj.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(obj);
}
