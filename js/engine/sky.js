// Day/night sky dome for rooms with a window. Analytic, in the spirit of three's Sky example but tuned to stay light by
// day (the brand's pale aqua, not a deep blue that blooms through the window): a zenith→horizon gradient, a warm glow
// round the sun that spreads along the horizon at dusk, the sun's disc, and a navy night with a faint horizon. The
// renderer feeds it the same sun vector as its sun light (daylight()), so the window, the light on the floor and the
// shadows always agree.
import * as THREE from 'three';

export function createSky() {
  const uniforms = {
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    day: { value: 1 }, dusk: { value: 0 }, night: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
        vec4 p = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // on the far plane: behind everything
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 sunDir; uniform float day, dusk, night;
      varying vec3 vDir;
      vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.2, 1.0), up = pow(max(h, 0.0), 0.45);
        vec3 zenD = lin(vec3(0.53, 0.76, 0.92)), horD = lin(vec3(0.89, 0.95, 0.97));
        vec3 zenK = lin(vec3(0.33, 0.43, 0.62)), horK = lin(vec3(0.98, 0.72, 0.52));
        vec3 zenN = lin(vec3(0.03, 0.06, 0.12)), horN = lin(vec3(0.08, 0.13, 0.21));
        vec3 dayC = mix(horD, zenD, up), duskC = mix(horK, zenK, pow(max(h, 0.0), 0.35)), nightC = mix(horN, zenN, up);
        float wd = clamp(dusk, 0.0, 1.0) * (1.0 - night);
        vec3 col = mix(mix(dayC, duskC, wd * (1.0 - day * 0.6)), nightC, night);
        float s = max(dot(d, normalize(sunDir)), 0.0), above = smoothstep(-0.05, 0.05, sunDir.y);
        vec3 warm = mix(vec3(1.0, 0.93, 0.8), vec3(1.0, 0.6, 0.32), wd);
        col += warm * (0.35 * pow(s, 8.0) + 0.25 * pow(s, 64.0)) * above * (1.0 - night);
        col += warm * 6.0 * smoothstep(0.9992, 0.9996, s) * above * (1.0 - night); // the disc (blooms a little)
        col += warm * wd * 0.25 * exp(-abs(d.y) * 9.0) * pow(max(dot(normalize(d.xz + 1e-4), normalize(sunDir.xz + 1e-4)), 0.0), 2.0);
        col = mix(col, horD * mix(1.0, 0.05, night), smoothstep(0.0, -0.15, d.y) * 0.6); // below the horizon: haze over the ground
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
  mesh.frustumCulled = false; mesh.renderOrder = -1000; mesh.castShadow = mesh.receiveShadow = false;
  mesh.userData.noAO = true; mesh.userData.noContact = true; mesh.raycast = () => {};
  mesh.onBeforeRender = (r, s, cam) => { mesh.position.copy(cam.position); mesh.scale.setScalar(cam.far * 0.5); mesh.updateMatrixWorld(); };
  return { mesh, uniforms };
}
