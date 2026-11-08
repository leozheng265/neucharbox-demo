// Check 19: the custom room: catalog copy and layout model (js/custom/catalog.js, layout.js, tools/sync-catalog.mjs),
// the device UI registry and models (js/custom/devices/), the 3D room (room3d.js) and the scene object (scene.js).
//   customChecks({ report, guardHits }) runs the checks below in Node; the 3D ones use test/build.mjs's fake canvas
//   and stub renderer.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { env, stubRenderer } from './build.mjs';
import { ICONS } from '../js/engine/icons.js';
import { controlFor } from '../js/engine/controls.js';

// Every state the catalog can reach for a type, as store slices: the initial state; each edit field at its min and
// max (a bool both ways); each value an action's effects can write (a constant, every enum value of the argument it
// takes, an argument's min and max times its scale, a bool argument both ways); each of those in every status.
export function reachableStates(t) {
  const base = { ...t.initial }, out = [base];
  for (const e of t.edit || []) out.push(...(e.kind === 'bool' ? [true, false] : [e.min, e.max]).map((v) => ({ ...base, [e.field]: v })));
  for (const a of t.actions || []) for (const f of a.effects || []) {
    if (!f.set) continue;
    if ('value' in f) out.push({ ...base, [f.set]: f.value });
    const p = f.arg ? a.parameters?.properties?.[f.arg] : null; if (!p) continue;
    const vals = p.enum ? p.enum : p.type === 'boolean' ? [true, false] : Number.isFinite(p.minimum) && Number.isFinite(p.maximum) ? [p.minimum, p.maximum].map((v) => v * (f.scale ?? 1)) : [];
    out.push(...vals.map((v) => ({ ...base, [f.set]: v })));
  }
  return ['online', 'busy', 'fault', 'offline'].flatMap((status) => out.map((s) => ({ ...s, status })));
}

export async function customChecks({ report, guardHits }) {
  const check = async (tag, fn) => {
    const p = [];
    const eq = (got, want, what = '') => { if (JSON.stringify(got) !== JSON.stringify(want)) p.push(`${what ? `${what}: ` : ''}got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); };
    const ok = (c, what = 'check failed') => { if (!c) p.push(what); };
    try { await fn({ eq, ok }); } catch (e) { p.push(`threw: ${String(e.stack || e).split('\n').slice(0, 2).join(' | ')}`); }
    report(tag, p);
  };
  const cat = await import('../js/custom/catalog.js').catch((e) => ({ err: e }));
  const lay = await import('../js/custom/layout.js').catch((e) => ({ err: e }));
  const mods = (fn) => async (t) => { if (cat.err) throw cat.err; if (lay.err) throw lay.err; await fn(t); };

  if (process.env.NCB_LIVE_CATALOG) {
    await check("catalog · copy matches the server's", async ({ eq }) => {
      const tool = fileURLToPath(new URL('../tools/sync-catalog.mjs', import.meta.url));
      const r = spawnSync(process.execPath, [tool, '--check', process.env.NCB_LIVE_CATALOG], { encoding: 'utf8' });
      eq(r.status, 0, `sync-catalog --check exit (${(r.stderr || r.stdout || '').trim().slice(0, 200)})`);
    });
  } else console.log('custom · catalog sync check skipped (set NCB_LIVE_CATALOG)');

  await check("catalog · names and ids follow the server's rule", mods(({ eq, ok }) => {
    const { CATALOG, MAX_DEVICES, typeOf, idFor, nameOf, validId } = cat;
    eq(MAX_DEVICES, 20, 'MAX_DEVICES');
    ok(CATALOG.types.length > 0 && typeOf('floor_lamp') && typeOf('nope') === null, 'typeOf');
    eq(nameOf('floor_lamp', 'floor_lamp'), { name: 'Floor lamp', ref: 'the floor lamp' });
    eq(nameOf('floor_lamp', 'floor_lamp_2'), { name: 'Floor lamp 2', ref: 'the floor lamp 2' });
    eq(idFor('floor_lamp', 1), 'floor_lamp'); eq(idFor('floor_lamp', 2), 'floor_lamp_2');
    ok(validId('floor_lamp', 'floor_lamp') && validId('floor_lamp', 'floor_lamp_2') && validId('floor_lamp', 'floor_lamp_20'), 'valid ids');
    for (const bad of ['floor_lamp_1', 'floor_lamp_21', 'floor_lamp_02', 'x', 'floor_lamp_', 'blinds']) ok(!validId('floor_lamp', bad), `${bad} must be invalid`);
    ok(!validId('nope', 'nope'), 'unknown type');
    const hits = []; for (const t of CATALOG.types) for (const s of [t.name, t.ref, t.faultText]) hits.push(...guardHits(s).map((g) => `${t.type}: ${g}`));
    eq(hits, [], 'guard hits');
  }));

  await check('addDevice · reuses the lowest free number', mods(({ eq }) => {
    const { emptyLayout, addDevice, removeDevice } = lay;
    let L = emptyLayout(); const ids = [];
    let r = addDevice(L, 'floor_lamp'); L = r.layout; ids.push(r.id);
    r = addDevice(L, 'floor_lamp'); L = r.layout; ids.push(r.id);
    L = removeDevice(L, 'floor_lamp');
    r = addDevice(L, 'floor_lamp'); L = r.layout; ids.push(r.id);
    eq(ids, ['floor_lamp', 'floor_lamp_2', 'floor_lamp'], 'ids');
    eq(addDevice(L, 'nope').error, 'unknown', 'unknown type');
    let F = emptyLayout(); for (let i = 0; i < 20; i++) { r = addDevice(F, 'floor_lamp'); F = r.layout; }
    eq(F.devices.length, 20, 'twenty fit');
    eq(F.devices[19].id, 'floor_lamp_20', 'twentieth id');
    const over = addDevice(F, 'floor_lamp'); eq(over.error, 'full', '21st'); eq(over.layout.devices.length, 20, 'unchanged');
    eq(emptyLayout().devices, [], 'empty'); eq(L.devices.length, 2);
    const before = JSON.stringify(L); addDevice(L, 'blinds'); eq(JSON.stringify(L), before, 'input not mutated');
  }));

  await check('clampPos · keeps every mount inside', mods(({ eq, ok }) => {
    const { clampPos, ROOM, HUB_HOME } = lay;
    eq(ROOM, { w: 8, d: 6, h: 2.8 }, 'ROOM'); eq(HUB_HOME, { x: 0, z: -2.4 }, 'HUB_HOME');
    eq(clampPos('floor', { x: 99, z: -99 }, 0.5), { x: 3.75, z: -2.75 }, 'floor corner');
    eq(clampPos('floor', { x: -99, z: 99 }, 0.5), { x: -3.75, z: 2.75 }, 'floor other corner');
    eq(clampPos('wall', { x: 0.5, z: -2 }, 0.5), { x: 0.5, z: -3 }, 'wall nearer the back wall');
    eq(clampPos('wall', { x: -3.9, z: 0 }, 0.5), { x: -4, z: 0 }, 'wall nearer the left wall');
    eq(clampPos('wall', { x: 99, z: -99 }, 0.5), { x: 3.75, z: -3 }, 'wall along the back wall');
    eq(clampPos('wall', { x: -99, z: 99 }, 0.5), { x: -4, z: 2.75 }, 'wall along the left wall');
    const c = clampPos('ceiling', { x: 50, z: 50 }, 0.5); ok(Math.abs(c.x) <= 3.75 && Math.abs(c.z) <= 2.75, 'ceiling inside');
    let L = lay.addDevice(lay.emptyLayout(), 'blinds').layout;
    L = lay.moveDevice(L, 'blinds', { x: -3.9, z: 1 }); eq([L.devices[0].x, L.devices[0].rot], [-4, 90], 'left wall rot');
    L = lay.moveDevice(L, 'blinds', { x: 1, z: -2.9 }); eq([L.devices[0].z, L.devices[0].rot], [-3, 0], 'back wall rot');
    L = lay.rotateDevice(L, 'blinds'); eq(L.devices[0].rot, 0, 'wall devices do not rotate');
    let F = lay.addDevice(lay.emptyLayout(), 'floor_lamp').layout;
    F = lay.rotateDevice(F, 'floor_lamp'); F = lay.rotateDevice(F, 'floor_lamp'); eq(F.devices[0].rot, 180, 'floor rotates +90');
    for (let i = 0; i < 2; i++) F = lay.rotateDevice(F, 'floor_lamp'); eq(F.devices[0].rot, 0, 'wraps');
    const H = lay.moveHub(F, { x: 99, z: 99 }); ok(Math.abs(H.hub.x) < 4 && Math.abs(H.hub.z) < 3, 'hub clamped');
    eq(lay.clearDevices(F).devices, [], 'clear'); eq(lay.clearDevices(H).hub, H.hub, 'clear keeps hub');
  }));

  await check('freeSpot · no overlaps until full', mods(({ eq, ok }) => {
    const { emptyLayout, addDevice, freeSpot } = lay;
    let L = emptyLayout();
    for (let i = 0; i < 20; i++) L = addDevice(L, 'floor_lamp').layout;
    const pts = [{ x: L.hub.x, z: L.hub.z }, ...L.devices];
    let worst = Infinity; for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) worst = Math.min(worst, Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z));
    ok(worst >= 0.5 - 1e-9, `closest pair ${worst.toFixed(3)} m`);
    let W = emptyLayout(); for (let i = 0; i < 6; i++) W = addDevice(W, 'blinds').layout;
    ok(W.devices.every((d) => d.z === -3 || d.x === -4), 'wall devices sit on a wall');
    const dense = { ...emptyLayout(), devices: [] };
    for (let x = -4; x <= 4; x += 0.25) for (let z = -3; z <= 3; z += 0.25) dense.devices.push({ id: 'x', type: 'floor_lamp', x, z, rot: 0 });
    eq(freeSpot(dense, 'floor', 0.5), { x: 0, z: 0 }, 'centre fallback');
  }));

  await check('loadLayout · survives junk', mods(({ eq, ok }) => {
    const { loadLayout, saveLayout, emptyLayout, addDevice } = lay;
    const store = (raw) => ({ getItem: () => raw, setItem() {}, removeItem() {} });
    const valid = (L) => L && L.v === 1 && Number.isFinite(L.hub.x) && Number.isFinite(L.hub.z) && Array.isArray(L.devices) && L.devices.length <= 20
      && L.devices.every((d) => cat.typeOf(d.type) && cat.validId(d.type, d.id) && Number.isFinite(d.x) && Number.isFinite(d.z) && Number.isFinite(d.rot))
      && new Set(L.devices.map((d) => d.id)).size === L.devices.length;
    const dev = (type, id, x = 0, z = 0) => ({ id, type, x, z, rot: 0 });
    const cases = {
      'truncated json': '{', 'null': 'null', 'array': '[]', 'v2': JSON.stringify({ v: 2, hub: { x: 0, z: 0 }, devices: [dev('floor_lamp', 'floor_lamp')] }),
      'unknown type': JSON.stringify({ v: 1, hub: { x: 0, z: -2.4 }, devices: [dev('nope', 'nope'), dev('floor_lamp', 'floor_lamp')] }),
      'bad id': JSON.stringify({ v: 1, hub: { x: 0, z: -2.4 }, devices: [dev('floor_lamp', 'floor_lamp_02'), dev('floor_lamp', 'floor_lamp_1'), dev('floor_lamp', 'blinds')] }),
      'duplicate id': JSON.stringify({ v: 1, hub: { x: 0, z: -2.4 }, devices: [dev('floor_lamp', 'floor_lamp', 1, 1), dev('floor_lamp', 'floor_lamp', 2, 2)] }),
      '30 devices': JSON.stringify({ v: 1, hub: { x: 0, z: -2.4 }, devices: Array.from({ length: 30 }, (_, i) => dev('floor_lamp', i ? `floor_lamp_${i + 1}` : 'floor_lamp', i * 0.2 - 3, 0)) }),
      'NaN positions': '{"v":1,"hub":{"x":null,"z":"a"},"devices":[{"id":"floor_lamp","type":"floor_lamp","x":null,"z":"q","rot":"?"}]}',
      'off-room positions': JSON.stringify({ v: 1, hub: { x: 500, z: 500 }, devices: [dev('floor_lamp', 'floor_lamp', 900, -900)] }),
      'devices not array': JSON.stringify({ v: 1, hub: { x: 0, z: 0 }, devices: 'x' }),
    };
    for (const [name, raw] of Object.entries(cases)) {
      let L; try { L = loadLayout(store(raw)); } catch (e) { L = null; ok(false, `${name} threw ${e.message}`); }
      ok(valid(L), `${name}: ${JSON.stringify(L)?.slice(0, 120)}`);
    }
    eq(loadLayout(store(cases['30 devices'])).devices.length, 20, 'capped at 20');
    eq(loadLayout(store(cases['unknown type'])).devices.map((d) => d.id), ['floor_lamp'], 'unknown dropped');
    eq(loadLayout(store(cases['duplicate id'])).devices.length, 1, 'duplicates dropped');
    eq(loadLayout(store(cases['NaN positions'])).devices.length, 1, 'NaN device kept and re-placed');
    ok(valid(loadLayout({ getItem() { throw new Error('denied'); } })), 'throwing getItem');
    ok(valid(loadLayout(null)) && valid(loadLayout(undefined)), 'no storage');
    eq(loadLayout(store(null)), emptyLayout(), 'nothing saved');
    let L = emptyLayout(); for (const t of ['floor_lamp', 'floor_lamp', 'blinds', 'thermostat']) L = addDevice(L, t).layout;
    const mem = new Map(); const s = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
    saveLayout(s, L); ok(mem.has('ncb.customRoom'), 'key ncb.customRoom'); eq(loadLayout(s), L, 'round trip');
    let threw = false; try { saveLayout({ setItem() { throw new Error('full'); } }, L); saveLayout(null, L); } catch { threw = true; } ok(!threw, 'saveLayout never throws');
  }));

  await check('sameDevices · ignores positions', mods(({ eq }) => {
    const { emptyLayout, addDevice, moveDevice, moveHub, sameDevices, devicesForSession } = lay;
    let A = emptyLayout(); for (const t of ['floor_lamp', 'blinds', 'floor_lamp']) A = addDevice(A, t).layout;
    const B = moveHub(moveDevice(A, 'floor_lamp', { x: 1, z: 1 }), { x: 2, z: 2 });
    eq(sameDevices(A, B), true, 'moved');
    eq(sameDevices(A, addDevice(A, 'thermostat').layout), false, 'added');
    eq(sameDevices(A, { ...A, devices: [...A.devices].reverse() }), false, 'order matters');
    eq(sameDevices(A, { ...A, devices: A.devices.map((d, i) => (i === 1 ? { ...d, type: 'thermostat' } : d)) }), false, 'type');
    eq(devicesForSession(A), [{ type: 'floor_lamp', id: 'floor_lamp' }, { type: 'blinds', id: 'blinds' }, { type: 'floor_lamp', id: 'floor_lamp_2' }]);
  }));

  // ---- Task 6: the device UI registry, the models and the 3D room ----
  const ui = await import('../js/custom/devices/index.js').catch((e) => ({ err: e }));
  const r3 = await import('../js/custom/room3d.js').catch((e) => ({ err: e }));
  const sc = await import('../js/custom/scene.js').catch((e) => ({ err: e }));
  const need = (...ms) => (fn) => async (t) => { for (const m of [cat, lay, ...ms]) if (m.err) throw m.err; await fn(t); };
  const types = () => cat.CATALOG.types;

  await check('ui · every catalog type has its UI, and nothing else', need(ui)(({ eq, ok }) => {
    const { DEVICE_UI } = ui;
    eq(Object.keys(DEVICE_UI).sort(), types().map((t) => t.type).sort(), 'DEVICE_UI keys');
    for (const t of types()) {
      const u = DEVICE_UI[t.type]; if (!u) continue;
      ok(typeof u.format === 'function' && typeof u.model === 'function', `${t.type}: format and model are functions`);
      ok(Number.isFinite(u.size) && u.size > 0 && u.size <= 2, `${t.type}: size ${u.size} m`);
      ok(u.mountY == null || (t.mount === 'wall' && u.mountY > 0 && u.mountY < 2.8), `${t.type}: mountY ${u.mountY} only on a wall mount, inside the room`);
      ok(u.plural == null || typeof u.plural === 'boolean', `${t.type}: plural is a boolean`);
      ok(u.active == null || typeof u.active === 'function', `${t.type}: active is a function`);
      const c = u.control;
      ok(c === undefined || c === false || typeof c === 'function' || (c && (c.kind === 'bar' || c.kind === 'switch') && c.field in t.initial), `${t.type}: control ${JSON.stringify(c)} is a bar or switch on a state field`);
    }
    eq(DEVICE_UI.blinds?.plural, true, 'the blinds are plural');
  }));

  await check('ui · format renders every reachable state', need(ui)(({ ok }) => {
    for (const t of types()) {
      const u = ui.DEVICE_UI[t.type]; if (!u) continue;
      const bad = new Set();
      for (const s of reachableStates(t)) {
        const at = `${t.type} ${JSON.stringify(s)}`;
        try {
          const text = u.format(s);
          if (typeof text !== 'string' || !text.trim()) bad.add(`${at}: format gave ${JSON.stringify(text)}`);
          else { if (/undefined|NaN|null|\[object/.test(text)) bad.add(`${at}: "${text}"`); for (const g of guardHits(text)) bad.add(`${at}: "${text}" ${g}`); }
          if (u.active) u.active(s);
          const c = controlFor(u, s);
          if (c && c.kind === 'bar' && !(c.value >= 0 && c.value <= 1)) bad.add(`${at}: bar value ${c.value}`);
        } catch (e) { bad.add(`${at}: threw ${e.message}`); }
      }
      ok(!bad.size, [...bad].slice(0, 4).join(' · '));
    }
    const f = (type, s) => ui.DEVICE_UI[type].format({ ...cat.typeOf(type).initial, ...s, status: 'online' });
    ok(f('floor_lamp', { brightness: 1 }) === 'full' && f('floor_lamp', { brightness: 0 }) === 'off' && f('floor_lamp', { brightness: 0.996 }) === 'full', `lamp ends: ${f('floor_lamp', { brightness: 1 })} / ${f('floor_lamp', { brightness: 0 })} / ${f('floor_lamp', { brightness: 0.996 })}`);
    ok(f('blinds', { closed: 0 }) === 'open' && f('blinds', { closed: 1 }) === 'closed' && f('blinds', { closed: 0.4 }) === '40% closed', `blinds: ${f('blinds', { closed: 0 })} / ${f('blinds', { closed: 1 })} / ${f('blinds', { closed: 0.4 })}`);
  }));

  await check('ui · icons exist', need(ui)(({ ok }) => {
    for (const [type, u] of Object.entries(ui.DEVICE_UI)) ok(typeof u.icon === 'string' && u.icon in ICONS, `${type}: icon "${u.icon}" is not in ICONS`);
  }));

  // A device's world bounding box (its meshes, no highlight shells): inside the room.
  const ROOM_EPS = 1e-3;
  const outside = (THREE, obj) => {
    obj.updateWorldMatrix(true, true);
    const b = new THREE.Box3(), mb = new THREE.Box3();
    obj.traverse((m) => { if (!m.isMesh || m.userData.isShell) return; if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); b.union(mb.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld)); });
    if (b.isEmpty()) return 'no meshes';
    const f = (v) => v.toFixed(3);
    return b.min.y >= -ROOM_EPS && b.max.y <= 2.8 + ROOM_EPS && b.min.x >= -4 - ROOM_EPS && b.max.x <= 4 + ROOM_EPS && b.min.z >= -3 - ROOM_EPS && b.max.z <= 3 + ROOM_EPS
      ? null : `box (${f(b.min.x)}, ${f(b.min.y)}, ${f(b.min.z)}) – (${f(b.max.x)}, ${f(b.max.y)}, ${f(b.max.z)})`;
  };
  const room3dOn = async () => {
    const { THREE, parts } = await env();
    const R = stubRenderer(), M = parts.materials(), P = parts.parts(R.scene, M);
    return { THREE, R, room: r3.createRoom3d({ R, P, M, THREE, store: null }) };
  };

  await check('room3d · builds and animates every type', need(ui, r3)(async ({ ok }) => {
    const { THREE, R, room } = await room3dOn();
    const { emptyLayout, addDevice, moveDevice, rotateDevice } = lay, { DEVICE_UI } = ui;
    const all = types().map((t) => t.type);
    ok(R.pickIds.has('hub') && room.hubObject && room.pickIds().includes('hub'), 'the hub is tappable as "hub"');
    let t = 0;
    for (let i = 0; i < all.length; i += 20) {
      let L = emptyLayout();
      for (const type of all.slice(i, i + 20)) L = addDevice(L, type, DEVICE_UI[type].size).layout;
      room.sync(L);
      for (const d of L.devices) {
        ok(R.pickIds.has(d.id) && room.pickIds().includes(d.id), `${d.id} is not tappable`);
        const o = room.objectFor(d.id); ok(o && o.parent, `${d.id}: objectFor gives an object in the scene`);
        const out = o && outside(THREE, o); ok(!out, `${d.id} at (${d.x}, ${d.z}) rot ${d.rot}: ${out}`);
      }
      // every reachable state, 30 frames each
      const st = Object.fromEntries(L.devices.map((d) => [d.id, reachableStates(cat.typeOf(d.type))]));
      const n = Math.max(...Object.values(st).map((v) => v.length));
      for (let k = 0; k < n; k++) {
        const state = { env: { hour: 16.5 + k * 0.7 }, hub: { status: k % 2 ? 'online' : 'offline', led: 1 }, plan: {} };
        for (const d of L.devices) state[d.id] = st[d.id][k % st[d.id].length];
        for (let f = 0; f < 30; f++) room.update(state, (t += 1 / 30));
      }
      room.update({ env: { hour: 16.5 } }, (t += 1 / 30)); // no slices yet (a device just added in build mode)
      for (const d of L.devices) room.focus(d.id); room.focus('hub'); room.update({ env: { hour: 16.5 } }, (t += 1 / 30)); room.reset();
      // pushed into every corner (floor and ceiling devices in all four turns): still inside the room
      for (const d of L.devices) {
        const mount = cat.typeOf(d.type).mount, size = DEVICE_UI[d.type].size;
        for (const pos of [{ x: 99, z: 99 }, { x: -99, z: -99 }, { x: 99, z: -99 }, { x: -99, z: 99 }]) {
          let C = moveDevice(L, d.id, pos, size);
          for (let r = 0; r < (mount === 'wall' ? 1 : 4); r++) {
            room.sync(C); const c = C.devices.find((x) => x.id === d.id);
            const out = outside(THREE, room.objectFor(d.id)); ok(!out, `${d.id} at (${c.x}, ${c.z}) rot ${c.rot}: ${out}`);
            C = rotateDevice(C, d.id);
          }
        }
      }
      room.sync(L);
    }
  }));

  await check('room3d · sync adds, moves and removes devices', need(ui, r3)(async ({ eq, ok }) => {
    const { THREE, R, room } = await room3dOn();
    const { emptyLayout, addDevice, removeDevice, moveDevice, moveHub } = lay;
    let L = emptyLayout(); for (const type of ['floor_lamp', 'blinds', 'floor_lamp']) L = addDevice(L, type, ui.DEVICE_UI[type].size).layout;
    room.sync(L);
    eq(room.pickIds().sort(), ['blinds', 'floor_lamp', 'floor_lamp_2', 'hub'], 'pickIds');
    const blinds = room.objectFor('blinds'), lamp = room.objectFor('floor_lamp');
    L = removeDevice(L, 'floor_lamp'); room.sync(L);
    ok(!R.pickIds.has('floor_lamp') && !room.pickIds().includes('floor_lamp'), 'a removed device is no longer tappable');
    ok(R.pickIds.has('floor_lamp_2'), 'the other lamp stays tappable');
    ok(room.objectFor('floor_lamp') == null && !lamp.parent, 'a removed device leaves the scene');
    ok(room.objectFor('blinds') === blinds, 'a device that stays is not rebuilt');
    const wall = (o) => { let w = null; o.traverse((x) => { if (!w && x.userData.wall) w = x.userData.wall; }); return w; };
    eq(wall(blinds), { nx: 0, nz: 1, d: -3 }, 'blinds on the back wall hide with it');
    eq([blinds.position.z, Math.abs(blinds.rotation.y) < 1e-9], [-3, true], 'back wall: z -3, facing +z');
    L = moveDevice(L, 'blinds', { x: -3.9, z: 0.5 }, ui.DEVICE_UI.blinds.size); room.sync(L);
    eq(wall(blinds), { nx: 1, nz: 0, d: -4 }, 'blinds moved to the left wall hide with it');
    ok(blinds.position.x === -4 && Math.abs(blinds.rotation.y - Math.PI / 2) < 1e-9, `left wall: x -4, facing +x (got x ${blinds.position.x}, rotation ${blinds.rotation.y})`);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(blinds.quaternion); ok(fwd.x > 0.999, `the left-wall blinds face +x (${fwd.toArray().map((v) => v.toFixed(2))})`);
    ok(Math.abs(blinds.position.y - (ui.DEVICE_UI.blinds.mountY ?? 1.4)) < 1e-9, 'a wall device hangs at its mountY');
    L = moveDevice(L, 'floor_lamp_2', { x: 1.25, z: 0.5 }, ui.DEVICE_UI.floor_lamp.size); room.sync(L);
    const l2 = room.objectFor('floor_lamp_2'); eq([l2.position.x, l2.position.y, l2.position.z], [1.25, 0, 0.5], 'a floor device stands where the layout says');
    L = moveHub(L, { x: 2, z: 1 }); room.sync(L); eq([room.hubObject.position.x, room.hubObject.position.z], [2, 1], 'the hub follows the layout');
    for (const pos of [{ x: 99, z: 99 }, { x: -99, z: -99 }]) { room.sync(moveHub(L, pos)); const out = outside(THREE, room.hubObject); ok(!out, `the hub in a corner: ${out}`); }
    ok(room.objectFor('hub') === room.hubObject, 'objectFor("hub")');
    let sprites = 0; R.scene.traverse((o) => { if (o.isSprite) sprites++; });
    const spriteGeo = new THREE.Sprite().geometry; let freed = false; spriteGeo.addEventListener('dispose', () => { freed = true; });
    room.sync(removeDevice(L, 'blinds')); ok(!freed, 'removing a device leaves the sprite geometry every sprite shares');
    room.sync(L); ok(sprites > 0, 'the LEDs have their glow sprites');
    // six lamps: only a few real lights, so a room of lamps stays smooth on a phone
    let F = emptyLayout(); for (let i = 0; i < 6; i++) F = addDevice(F, 'floor_lamp', ui.DEVICE_UI.floor_lamp.size).layout;
    room.sync(F); let lights = 0; R.scene.traverse((o) => { if (o.isPointLight && o.visible) lights++; });
    ok(lights <= 4, `${lights} visible point lights for six lamps`);
    room.sync(emptyLayout()); eq(room.pickIds(), ['hub'], 'an empty room leaves the hub');
    let meshes = 0; R.scene.traverse((o) => { if (o.isMesh && o.userData.deviceId && o.userData.deviceId !== 'hub') meshes++; });
    eq(meshes, 0, 'no device meshes left in the scene');
  }));

  await check('scene · sceneFor names and orders devices', need(ui, sc)(({ eq, ok }) => {
    const { emptyLayout, addDevice } = lay;
    let L = emptyLayout(); for (const type of ['floor_lamp', 'floor_lamp', 'blinds']) L = addDevice(L, type).layout;
    const s = sc.sceneFor(L);
    eq([s.id, s.title, s.startHour], ['custom', 'Build your own', 16.5], 'id, title, start hour');
    ok(s.camera && Array.isArray(s.camera.position) && Array.isArray(s.camera.target), 'a camera');
    eq(s.deviceOrder, ['floor_lamp', 'floor_lamp_2', 'blinds'], 'deviceOrder');
    eq(s.deviceOrder.map((id) => s.devices[id].name), ['Floor lamp', 'Floor lamp 2', 'Blinds'], 'names');
    eq(s.devices.floor_lamp_2.ref, 'the floor lamp 2', 'ref');
    const d = s.devices.floor_lamp;
    eq([d.type, d.icon, d.faultText, d.plural, d.initial], ['floor_lamp', 'lamp', 'off the network', false, { brightness: 0 }], 'device fields');
    ok(d.format === ui.DEVICE_UI.floor_lamp.format && d.control === ui.DEVICE_UI.floor_lamp.control, 'format and control from DEVICE_UI');
    eq(s.devices.blinds.plural, true, 'blinds plural');
    const init = sc.initialFor(s);
    eq(init.floor_lamp_2, { brightness: 0, status: 'online' }, 'device initial');
    eq([init.hub, init.env, init.plan], [{ status: 'online', led: 1 }, { hour: 16.5 }, {}], 'hub, env, plan');
    init.floor_lamp.brightness = 1; eq(sc.initialFor(s).floor_lamp.brightness, 0, 'initialFor gives fresh objects');
    eq(sc.sceneFor(emptyLayout()).deviceOrder, [], 'an empty room');
    for (const g of guardHits(`${s.title}`)) ok(false, `title ${g}`);
  }));
}
