// Three.js setup shared by every scene: renderer, camera, controls, lights,
// post-processing, quality tiers, device picking and the frame loop.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export { THREE };

export function detectQuality() {
  const touch = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(innerWidth, innerHeight) < 700;
  const mem = navigator.deviceMemory || 8;
  return touch || small || mem <= 4 ? 'low' : 'high';
}

export function createRenderer(canvas, { quality = detectQuality(), camera: camOpts = {} } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, quality === 'high' ? 2 : 1.5));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.85;

  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xCFDDE6);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.35;

  const camera = new THREE.PerspectiveCamera(camOpts.fov ?? 42, 1.5, 0.05, 80);
  camera.position.set(...(camOpts.position ?? [2.9, 1.75, 3.3]));
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(...(camOpts.target ?? [-0.1, 0.85, -0.9]));
  controls.enableDamping = true; controls.autoRotate = true; controls.autoRotateSpeed = 0.25;
  controls.maxPolarAngle = Math.PI / 2 - 0.02; controls.minPolarAngle = 0.15; controls.minDistance = camOpts.minDistance ?? 1.5; controls.maxDistance = (camOpts.maxDistance ?? 7) * 1.6;
  controls.enablePan = true; controls.panSpeed = 0.8; controls.screenSpacePanning = true; controls.zoomSpeed = 0.9;
  controls.listenToKeyEvents(window); controls.keyPanSpeed = 12;
  // Free orbit: walls are single-sided so any angle looks into the room (dollhouse cut-away). Auto-sway stays in a pleasant arc.
  const [azMin, azMax] = camOpts.azimuth ?? [-0.35, 1.3]; controls.update();
  const home = { pos: camera.position.clone(), target: controls.target.clone() };
  canvas.addEventListener('pointerdown', () => { controls.autoRotate = false; }, { passive: true });
  canvas.addEventListener('wheel', () => { controls.autoRotate = false; }, { passive: true });
  function resetView() { camera.position.copy(home.pos); controls.target.copy(home.target); controls.autoRotate = true; controls.update(); }

  const hemi = new THREE.HemisphereLight(0xEAF2F8, 0x6E6258, 0.55); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xFFF1DC, 2.6); sun.position.set(2.2, 5.5, -7.5); sun.target.position.set(0.3, 0.3, 0.2); scene.add(sun.target); scene.add(sun);
  sun.castShadow = true; Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5.5, bottom: -4.5, near: 1, far: 24 });
  sun.shadow.bias = -0.00015; sun.shadow.normalBias = 0.015; sun.shadow.radius = 2;
  const fill = new THREE.DirectionalLight(0xDCE8F0, 0.35); fill.position.set(4, 3, 4); scene.add(fill);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const gtao = new GTAOPass(scene, camera, 1, 1); gtao.output = GTAOPass.OUTPUT.Default; gtao.blendIntensity = 0.9;
  gtao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1, thickness: 1, scale: 1.2, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
  composer.addPass(gtao);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.5, 0.92); composer.addPass(bloom);
  composer.addPass(new OutputPass());

  let currentQuality = null;
  function setQuality(q) {
    if (q === currentQuality) return; currentQuality = q;
    gtao.enabled = q === 'high';
    sun.shadow.mapSize.set(q === 'high' ? 4096 : 1536, q === 'high' ? 4096 : 1536);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, q === 'high' ? 2 : 1.5));
    resize();
  }

  function resize() {
    const w = canvas.clientWidth || 300, h = canvas.clientHeight || Math.round(w * 0.75);
    renderer.setSize(w, h, false); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas.parentElement);
  setQuality(quality);

  // ---- picking ----
  const pickables = []; const pickHandlers = [];
  const ray = new THREE.Raycaster(); const ptr = new THREE.Vector2(); let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return; down = null;
    const r = canvas.getBoundingClientRect(); ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hits = ray.intersectObjects(pickables.map((p) => p.obj), true);
    if (!hits.length) return;
    let o = hits[0].object; while (o && !o.userData.deviceId) o = o.parent;
    if (o) pickHandlers.forEach((fn) => fn(o.userData.deviceId));
  });
  function addPickable(obj, id) { obj.userData.deviceId = id; obj.traverse((c) => { c.userData.deviceId = id; }); pickables.push({ obj, id }); }

  // ---- discovery / attention markers: an expanding ring plus a floating label at a device ----
  const markers = []; const box3 = new THREE.Box3(); const tmp = new THREE.Vector3();
  function anchorOf(id) {
    const ps = pickables.filter((p) => p.id === id); if (!ps.length) return null;
    box3.makeEmpty(); for (const p of ps) { p.obj.updateWorldMatrix(true, true); box3.expandByObject(p.obj); }
    if (box3.isEmpty()) return null; box3.getCenter(tmp); tmp.y = box3.max.y; return tmp.clone();
  }
  function labelSprite(text, color) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128; const g = c.getContext('2d');
    g.font = '600 44px Inter, "Segoe UI", sans-serif'; const w = Math.min(508, g.measureText(text).width + 100);
    g.fillStyle = 'rgba(18,34,42,0.92)'; g.beginPath(); g.roundRect((512 - w) / 2, 24, w, 80, 40); g.fill();
    g.fillStyle = color; g.beginPath(); g.arc((512 - w) / 2 + 40, 64, 12, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(text, (512 - w) / 2 + 66, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false })); sp.scale.set(1.0, 0.25, 1); sp.renderOrder = 999; return sp;
  }
  function ping(id, text, { color = '#29EEE5', hex = 0x29EEE5, hold = 2600 } = {}) {
    const a = anchorOf(id); if (!a) return;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 48), new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, side: THREE.DoubleSide })); ring.renderOrder = 998; ring.position.copy(a); ring.position.y += 0.02; scene.add(ring);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 12), new THREE.MeshBasicMaterial({ color: hex, depthTest: false })); dot.renderOrder = 998; dot.position.copy(a); scene.add(dot);
    const label = text ? labelSprite(text, color) : null; if (label) { label.position.copy(a); label.position.y += 0.26; scene.add(label); }
    markers.push({ ring, dot, label, t0: performance.now(), hold });
  }
  function updateMarkers(now) {
    for (let i = markers.length - 1; i >= 0; i--) {
      const m = markers[i]; const age = (now - m.t0) / 1000; const k = (age % 1.1) / 1.1;
      m.ring.lookAt(camera.position); m.ring.scale.setScalar(0.2 + k * 1.4); m.ring.material.opacity = (1 - k) * 0.9 * Math.min(1, (m.hold / 1000 + 0.6 - age) / 0.6);
      const dist = camera.position.distanceTo(m.dot.position); if (m.label) m.label.scale.set(0.2 * dist, 0.05 * dist, 1);
      if (age * 1000 > m.hold && m.label) m.label.material.opacity = Math.max(0, 1 - (age * 1000 - m.hold) / 500);
      if (age * 1000 > m.hold + 600) { scene.remove(m.ring); scene.remove(m.dot); if (m.label) scene.remove(m.label); markers.splice(i, 1); }
    }
  }

  // ---- daylight helper for scenes with windows ----
  function daylight(hour) {
    const h = ((hour % 24) + 24) % 24;
    const day = Math.max(0, Math.sin(((h - 6) / 12) * Math.PI));         // 0 at 6/18, 1 at noon
    const dusk = Math.exp(-Math.pow((h - 18.5) / 1.2, 2)) + Math.exp(-Math.pow((h - 6) / 1.2, 2));
    sun.intensity = 2.8 * day + 1.2 * dusk;
    sun.color.setHSL(0.08, 0.6, 0.62 + 0.3 * day - 0.15 * dusk);
    hemi.intensity = 0.15 + 0.45 * day; fill.intensity = 0.1 + 0.3 * day;
    scene.background.setHSL(0.6, 0.35, 0.12 + 0.62 * day + 0.2 * dusk);
    scene.environmentIntensity = 0.12 + 0.28 * day;
    const ang = ((h - 6) / 12) * Math.PI; sun.position.set(Math.cos(ang) * 6 + 1, 2 + Math.sin(ang) * 5, -7.5);
  }

  // ---- loop with fps watchdog ----
  const frameFns = []; let running = false; let frames = 0, fpsStart = performance.now(), checks = 0;
  const clock = new THREE.Clock();
  function loop() {
    if (!running) return;
    const now = performance.now(); const t = clock.getElapsedTime();
    for (const fn of frameFns) fn(t, now);
    updateMarkers(now);
    if (controls.autoRotate) { const az = controls.getAzimuthalAngle(); if (az <= azMin + 0.02 && controls.autoRotateSpeed > 0) controls.autoRotateSpeed *= -1; if (az >= azMax - 0.02 && controls.autoRotateSpeed < 0) controls.autoRotateSpeed *= -1; }
    controls.update(); composer.render();
    frames++;
    if (now - fpsStart > 2500) { const fps = (frames * 1000) / (now - fpsStart); frames = 0; fpsStart = now; checks++; if (checks <= 3 && fps < 38 && currentQuality === 'high') setQuality('low'); }
    requestAnimationFrame(loop);
  }

  return {
    THREE, renderer, scene, camera, controls, lights: { hemi, sun, fill }, composer, gtao, bloom,
    addPickable, onPick: (fn) => pickHandlers.push(fn), onFrame: (fn) => frameFns.push(fn), ping, anchorOf, resetView,
    daylight, setQuality, resize, get quality() { return currentQuality; },
    start() { running = true; resize(); loop(); },
    stop() { running = false; },
    dispose() { running = false; renderer.dispose(); composer.dispose?.(); },
  };
}
