// Three.js setup shared by every scene: renderer, camera, controls, lights,
// post-processing, quality tiers, device picking, attention markers and the frame loop.
import './compat.js';
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

// camOpts: { position, target, fov, azimuth: [min, max] auto-sway arc, minDistance, maxDistance,
//            fitAspect: below this canvas aspect the vertical FOV widens so the horizontal framing is kept }
export function createRenderer(canvas, { quality = detectQuality(), camera: camOpts = {} } = {}) {
  const pr0 = Math.min(devicePixelRatio, quality === 'high' ? 2 : 1.5);
  // Anti-aliasing happens in the composer's multisampled target; the default framebuffer only gets a full-screen quad.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(pr0);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; // r186: PCFSoft was folded into PCF
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.85;

  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xCFDDE6);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.35;

  const baseFov = camOpts.fov ?? 42;
  const camera = new THREE.PerspectiveCamera(baseFov, 1.5, 0.05, 80);
  camera.position.set(...(camOpts.position ?? [2.9, 1.75, 3.3]));
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(...(camOpts.target ?? [-0.1, 0.85, -0.9]));
  controls.enableDamping = true; controls.autoRotate = true; controls.autoRotateSpeed = 0.25;
  controls.maxPolarAngle = Math.PI / 2 - 0.02; controls.minPolarAngle = 0.15; controls.minDistance = camOpts.minDistance ?? 1.5; controls.maxDistance = (camOpts.maxDistance ?? 7) * 1.6;
  controls.enablePan = true; controls.panSpeed = 0.8; controls.screenSpacePanning = true; controls.zoomSpeed = 0.9;
  // Arrow keys pan the room only while the room has focus (click it first), never while typing in the chat.
  canvas.tabIndex = 0; canvas.style.outline = 'none';
  controls.listenToKeyEvents(canvas); controls.keyPanSpeed = 12;
  // Free orbit: walls are single-sided so any angle looks into the room (dollhouse cut-away). Auto-sway stays in a pleasant arc.
  const [azMin, azMax] = camOpts.azimuth ?? [-0.35, 1.3]; controls.update();
  const home = { pos: camera.position.clone(), target: controls.target.clone() };
  canvas.addEventListener('pointerdown', () => { controls.autoRotate = false; canvas.focus({ preventScroll: true }); }, { passive: true });
  canvas.addEventListener('wheel', () => { controls.autoRotate = false; }, { passive: true });
  function resetView() { camera.position.copy(home.pos); controls.target.copy(home.target); controls.autoRotate = true; controls.update(); }

  const hemi = new THREE.HemisphereLight(0xEAF2F8, 0x6E6258, 0.55); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xFFF1DC, 2.6); sun.position.set(2.2, 5.5, -7.5); sun.target.position.set(0.3, 0.3, 0.2); scene.add(sun.target); scene.add(sun);
  sun.castShadow = true; Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5.5, bottom: -4.5, near: 1, far: 24 });
  sun.shadow.bias = -0.00015; sun.shadow.normalBias = 0.015; sun.shadow.radius = 2;
  const fill = new THREE.DirectionalLight(0xDCE8F0, 0.35); fill.position.set(4, 3, 4); scene.add(fill);

  const msaa = quality === 'high' && devicePixelRatio < 1.5 ? 4 : 0;
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: msaa }));
  composer.setPixelRatio(pr0);
  composer.addPass(new RenderPass(scene, camera));
  const gtao = new GTAOPass(scene, camera, 1, 1); gtao.output = GTAOPass.OUTPUT.Default; gtao.blendIntensity = 0.9;
  gtao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1, thickness: 1, scale: 1.2, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
  // Keep overlays (ping labels/rings, highlight shells, LED halos) out of the AO normal pre-pass: sprites have no
  // normals (NaN → black slab) and additive shells would cast AO halos. Anything with userData.noAO is skipped.
  const aoPrepass = gtao._overrideVisibility.bind(gtao);
  gtao._overrideVisibility = function () { aoPrepass(); this.scene.traverse((o) => { if (o.visible && (o.isSprite || o.userData.noAO)) { o.visible = false; this._visibilityCache.push(o); } }); };
  composer.addPass(gtao);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.5, 0.92); composer.addPass(bloom);
  composer.addPass(new OutputPass());

  let currentQuality = null;
  // Point-light shadows cost six shadow renders each per frame; phones and slow machines go without them.
  // Only called at start() and on a tier change (castShadow changes recompile lit materials).
  function applyLightTier() {
    scene.traverse((o) => {
      if (!(o.isPointLight || o.isSpotLight)) return;
      if (o.userData.wantsShadow === undefined) o.userData.wantsShadow = o.castShadow;
      o.castShadow = o.userData.wantsShadow && (currentQuality === 'high' || o.isSpotLight);
      if (!o.castShadow && o.shadow.map) { o.shadow.map.dispose(); o.shadow.map = null; }
    });
  }
  function setQuality(q) {
    if (q === currentQuality) return; const first = currentQuality === null; currentQuality = q;
    if (!first) applyLightTier();
    gtao.enabled = q === 'high';
    sun.shadow.mapSize.set(q === 'high' ? 4096 : 1536, q === 'high' ? 4096 : 1536);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    if (q !== 'high') for (const t of [composer.renderTarget1, composer.renderTarget2]) if (t.samples) { t.samples = 0; t.dispose(); }
    const pr = Math.min(devicePixelRatio, q === 'high' ? 2 : 1.5); renderer.setPixelRatio(pr); composer.setPixelRatio(pr);
    resize();
  }

  function resize() {
    const w = canvas.clientWidth || 300, h = canvas.clientHeight || Math.round(w * 0.75);
    renderer.setSize(w, h, false); composer.setSize(w, h); camera.aspect = w / h;
    const fit = camOpts.fitAspect;
    camera.fov = fit && camera.aspect < fit ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(baseFov / 2)) * (fit / camera.aspect))) : baseFov;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(canvas.parentElement);
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
  // Register a tappable part for a device. The first part registered for an id (or one passed { anchor: true })
  // is where rings and labels appear.
  function addPickable(obj, id, { anchor = false } = {}) { obj.userData.deviceId = id; obj.traverse((c) => { c.userData.deviceId = id; }); const rec = { obj, id }; if (anchor) pickables.unshift(rec); else pickables.push(rec); }

  // ---- discovery / attention markers: an expanding ring plus a floating label at a device ----
  const markers = []; const box3 = new THREE.Box3(); const _bb = new THREE.Box3(); const tmp = new THREE.Vector3(); const ndc = new THREE.Vector3(); const viewPos = new THREE.Vector3();
  const ringGeo = new THREE.RingGeometry(0.42, 0.5, 48), dotGeo = new THREE.SphereGeometry(0.035, 12, 12);
  function anchorOf(id) {
    const p = pickables.find((q) => q.id === id); if (!p) return null;
    p.obj.updateWorldMatrix(true, true); box3.makeEmpty();
    p.obj.traverseVisible((o) => { if (!o.geometry || o.userData.isShell || o.isSprite) return; if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); box3.union(_bb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld)); });
    if (box3.isEmpty()) return null; box3.getCenter(tmp); tmp.y = box3.max.y; return tmp.clone();
  }
  const LABEL_FONT = '600 44px Inter, "Segoe UI", system-ui, -apple-system, sans-serif';
  function labelSprite(text, color) {
    const c = document.createElement('canvas'); let g = c.getContext('2d'); g.font = LABEL_FONT;
    c.width = Math.ceil(g.measureText(text).width) + 116; c.height = 128; g = c.getContext('2d'); g.font = LABEL_FONT; // resizing resets the context
    g.fillStyle = 'rgba(18,34,42,0.92)'; g.beginPath(); g.roundRect(4, 24, c.width - 8, 80, 40); g.fill();
    g.fillStyle = color; g.beginPath(); g.arc(44, 64, 12, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(text, 70, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false }));
    sp.userData.aspect = c.width / c.height; sp.userData.noAO = true; sp.renderOrder = 999; return sp;
  }
  function dropMarker(m) { for (const o of [m.ring, m.dot, m.label]) { if (!o) continue; scene.remove(o); o.material.map?.dispose(); o.material.dispose(); } }
  function ping(id, text, { color = '#29EEE5', hex = 0x29EEE5, hold = 2600 } = {}) {
    const a = anchorOf(id); if (!a) return;
    for (let i = markers.length - 1; i >= 0; i--) if (markers[i].id === id) { dropMarker(markers[i]); markers.splice(i, 1); } // one marker per device
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, side: THREE.DoubleSide })); ring.renderOrder = 998; ring.userData.noAO = true; ring.position.copy(a); ring.position.y += 0.02; scene.add(ring);
    const dot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: hex, depthTest: false })); dot.renderOrder = 998; dot.userData.noAO = true; dot.position.copy(a); scene.add(dot);
    const label = text ? labelSprite(text, color) : null; if (label) scene.add(label);
    markers.push({ id, ring, dot, label, t0: performance.now(), hold });
  }
  const MARGIN_PX = 6;
  function updateMarkers(now) {
    const cw = Math.max(1, canvas.clientWidth), ch = Math.max(1, canvas.clientHeight);
    const LABEL_PX = THREE.MathUtils.clamp(ch * 0.1, 30, 40), PILL_PX = LABEL_PX * 80 / 128 + 4; // ~10–14 px text
    const placed = []; // screen rects of labels already laid out this frame (oldest first), so newer ones step aside
    for (let i = 0; i < markers.length; i++) {
      const m = markers[i]; const age = (now - m.t0) / 1000; const k = (age % 1.1) / 1.1;
      const a = anchorOf(m.id); if (a) { m.dot.position.copy(a); m.ring.position.set(a.x, a.y + 0.02, a.z); } // follow moving devices
      m.ring.lookAt(camera.position); m.ring.scale.setScalar(0.2 + k * 1.4); m.ring.material.opacity = (1 - k) * 0.9 * Math.min(1, (m.hold / 1000 + 0.6 - age) / 0.6);
      if (m.label) {
        // Constant on-screen size (LABEL_PX tall), sitting just above the dot, and pushed back inside the frame.
        // Sprite size on screen follows view-space depth (not straight-line distance), so scale from depth.
        const pxAt = (pos) => { viewPos.copy(pos).applyMatrix4(camera.matrixWorldInverse); return (2 * Math.max(0.05, -viewPos.z) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / ch; };
        let hgt = LABEL_PX * pxAt(m.dot.position);
        m.label.position.set(m.dot.position.x, m.dot.position.y + 0.035 + 0.45 * hgt, m.dot.position.z);
        ndc.copy(m.label.position).project(camera);
        if (ndc.z < 1) {
          // Work in CSS pixels: clamp inside the canvas, then step below (or above) any label already placed.
          const w = LABEL_PX * m.label.userData.aspect, hw = w / 2 + MARGIN_PX, hh = PILL_PX / 2 + MARGIN_PX;
          let sx = THREE.MathUtils.clamp((ndc.x + 1) / 2 * cw, hw, cw - hw), sy = THREE.MathUtils.clamp((1 - ndc.y) / 2 * ch, hh, ch - hh);
          for (let tries = 0; tries < 6; tries++) {
            const hit = placed.find((r) => Math.abs(r.x - sx) < (r.w + w) / 2 + 4 && Math.abs(r.y - sy) < PILL_PX + 2);
            if (!hit) break;
            sy = hit.y + PILL_PX + 4 <= ch - hh ? hit.y + PILL_PX + 4 : hit.y - PILL_PX - 4;
          }
          placed.push({ x: sx, y: sy, w });
          ndc.x = (sx / cw) * 2 - 1; ndc.y = 1 - (sy / ch) * 2; m.label.position.copy(ndc.unproject(camera));
        }
        hgt = LABEL_PX * pxAt(m.label.position); m.label.scale.set(hgt * m.label.userData.aspect, hgt, 1);
        if (age * 1000 > m.hold) m.label.material.opacity = Math.max(0, 1 - (age * 1000 - m.hold) / 500);
      }
    }
    for (let i = markers.length - 1; i >= 0; i--) { const m = markers[i]; if ((now - m.t0) > m.hold + 600) { dropMarker(m); markers.splice(i, 1); } }
  }

  // ---- daylight helper for scenes with windows ----
  function daylight(hour) {
    const h = ((hour % 24) + 24) % 24;
    const day = Math.max(0, Math.sin(((h - 6) / 12) * Math.PI));         // 0 at 6/18, 1 at noon
    const dusk = Math.exp(-Math.pow((h - 18.5) / 1.2, 2)) + Math.exp(-Math.pow((h - 6) / 1.2, 2));
    sun.intensity = 2.8 * day + 1.2 * dusk;
    sun.color.setHSL(0.08, 0.6, 0.62 + 0.3 * day - 0.15 * dusk);
    hemi.intensity = 0.15 + 0.45 * day; fill.intensity = 0.1 + 0.3 * day;
    if (scene.background?.isColor) scene.background.setHSL(0.6, 0.35, 0.12 + 0.62 * day + 0.2 * dusk);
    scene.environmentIntensity = 0.12 + 0.28 * day;
    const ang = ((h - 6) / 12) * Math.PI; sun.position.set(Math.cos(ang) * 6 + 1, 2 + Math.sin(ang) * 5, -7.5);
  }

  // ---- loop with fps watchdog ----
  // The watchdog ignores the first window (shader compile, texture uploads) and any window containing a long
  // frame gap (hidden tab, stall), and only downgrades during windows 2–4 of genuinely slow rendering.
  const frameFns = []; let running = false; let frames = 0, fpsStart = 0, lastFrame = 0, windows = 0;
  const t0 = performance.now(); const clock = { getElapsedTime: () => (performance.now() - t0) / 1000 }; const failed = new Set();
  const guard = (key, fn) => { try { fn(); } catch (e) { if (!failed.has(key)) { failed.add(key); console.error('[ncb] frame error in', key, e); } } };
  function loop() {
    if (!running) return;
    requestAnimationFrame(loop); // schedule first, so one bad frame can never stop the loop (and the store's tweens)
    const now = performance.now(); const t = clock.getElapsedTime();
    if (now - lastFrame > 1000) { frames = 0; fpsStart = now; } lastFrame = now;
    frameFns.forEach((fn, i) => guard(`frame#${i}`, () => fn(t, now)));
    guard('markers', () => updateMarkers(now));
    guard('render', () => {
      if (controls.autoRotate) { const az = controls.getAzimuthalAngle(); if (az <= azMin + 0.02 && controls.autoRotateSpeed > 0) controls.autoRotateSpeed *= -1; if (az >= azMax - 0.02 && controls.autoRotateSpeed < 0) controls.autoRotateSpeed *= -1; }
      controls.update(); composer.render();
    });
    frames++;
    if (now - fpsStart > 2500) { const fps = (frames * 1000) / (now - fpsStart); frames = 0; fpsStart = now; windows++; if (windows >= 2 && windows <= 4 && fps < 38 && currentQuality === 'high') setQuality('low'); }
  }

  return {
    THREE, renderer, scene, camera, controls, lights: { hemi, sun, fill }, composer, gtao, bloom,
    addPickable, onPick: (fn) => pickHandlers.push(fn), onFrame: (fn) => frameFns.push(fn), ping, anchorOf, resetView,
    daylight, setQuality, resize, get quality() { return currentQuality; },
    // Debug/QA: render one frame on demand (works while the tab is hidden and requestAnimationFrame is paused).
    step(n = 1) { for (let k = 0; k < n; k++) { const now = performance.now(); const t = clock.getElapsedTime(); frameFns.forEach((fn, i) => guard(`frame#${i}`, () => fn(t, now))); guard('markers', () => updateMarkers(now)); controls.update(); } composer.render(); },
    start() {
      running = true; applyLightTier(); resize();
      try { renderer.compile(scene, camera); } catch (e) { console.warn('[ncb] precompile skipped', e); }
      frames = 0; fpsStart = lastFrame = performance.now(); loop();
    },
    stop() { running = false; },
    dispose() {
      running = false; ro.disconnect();
      controls.stopListenToKeyEvents?.(); controls.dispose();
      for (const m of markers) dropMarker(m); markers.length = 0; ringGeo.dispose(); dotGeo.dispose();
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        for (const m of mats) { for (const k of ['map', 'bumpMap', 'emissiveMap', 'roughnessMap', 'normalMap', 'alphaMap']) m[k]?.dispose?.(); m.dispose(); }
        if (o.shadow?.map) o.shadow.map.dispose();
      });
      scene.environment?.dispose?.(); pmrem.dispose();
      composer.dispose?.(); renderer.dispose(); renderer.forceContextLoss();
    },
  };
}
