// Check 19: the custom room: catalog copy and layout model (js/custom/catalog.js, layout.js, tools/sync-catalog.mjs),
// the device UI registry and models (js/custom/devices/), the 3D room (room3d.js) and the scene object (scene.js).
//   customChecks({ report, guardHits }) runs the checks below in Node; the 3D ones use test/build.mjs's fake canvas
//   and stub renderer.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { env, stubRenderer } from './build.mjs';
import { ICONS } from '../js/engine/icons.js';
import { controlFor, editsFor } from '../js/engine/controls.js';

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

  await check('clampPos · wall devices keep off the window', mods(({ eq, ok }) => {
    const { clampPos, WINDOW, addDevice, emptyLayout, moveDevice } = lay;
    eq(WINDOW, { x: 2.2, y: 1.55, ww: 1.8, wh: 1.36 }, 'WINDOW');
    const lo = WINDOW.x - WINDOW.ww / 2, hi = WINDOW.x + WINDOW.ww / 2, off = (p, s) => p.x + s / 2 <= lo || p.x - s / 2 >= hi;
    for (const s of [0.3, 0.5, 0.9]) for (let x = 1; x <= 3.5; x += 0.05) { const p = clampPos('wall', { x, z: -3 }, s); ok(p.z === -3 && off(p, s), `size ${s} at x ${x.toFixed(2)} → ${p.x}`); }
    eq(clampPos('wall', { x: 2.1, z: -3 }, 0.5).x, 1.01, 'left of the window when nearer the left');
    eq(clampPos('wall', { x: 2.3, z: -3 }, 0.5).x, 3.39, 'right of it when nearer the right');
    ok(clampPos('wall', { x: 2.9, z: -3 }, 1.2).x + 0.6 <= lo, 'too wide for the right side: the left');
    eq(clampPos('wall', { x: -3.9, z: 0.2 }, 0.5), { x: -4, z: 0.2 }, 'the left wall has no window');
    let L = emptyLayout(); for (let i = 0; i < 14; i++) L = addDevice(L, 'thermostat', 0.3).layout;
    ok(L.devices.every((d) => d.x === -4 || off(d, 0.3)), 'freeSpot never puts one on the window');
    L = moveDevice(L, 'thermostat', { x: 2.2, z: -3 }, 0.3); ok(off(L.devices[0], 0.3), 'nor does a move');
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

  // Editable cards (live mode): each catalog `edit` field is a slider (number) or a switch (bool) on the card. The range
  // is the catalog's; DEVICE_UI only says how to show it.
  await check('ui · every catalog edit field has a presentation', need(ui)(({ eq, ok }) => {
    let fields = 0;
    for (const t of types()) {
      const u = ui.DEVICE_UI[t.type]; if (!u) continue;
      const pres = u.edit ?? [], cat = t.edit || [];
      ok(Array.isArray(pres), `${t.type}: edit is a list`); if (!Array.isArray(pres)) continue;
      eq(pres.map((p) => p.field), cat.map((e) => e.field), `${t.type}: the presented fields, in the catalog's order`);
      for (const e of cat) {
        const p = pres.find((x) => x.field === e.field), at = `${t.type}.${e.field}`; if (!p) continue;
        fields++;
        ok(Object.keys(p).every((k) => ['field', 'kind', 'step', 'scale', 'unit', 'label', 'top'].includes(k)), `${at}: only field, kind, step, scale, unit, label, top (the range is the catalog's)`);
        ok(p.top == null || (p.kind === 'slider' && p.unit === '%'), `${at}: a top word only on a percent slider`);
        if (e.kind === 'bool') { eq(p.kind, 'switch', `${at} kind`); ok(p.step == null && p.scale == null && p.unit == null, `${at}: a switch has no step, scale or unit`); continue; }
        eq(p.kind, 'slider', `${at} kind`);
        const scale = p.scale ?? 1, n = (e.max - e.min) / p.step;
        ok(Number.isFinite(scale) && scale > 0, `${at}: scale ${p.scale}`);
        ok(Number.isFinite(p.step) && p.step > 0 && n <= 1000 && Math.abs(n - Math.round(n)) < 1e-6, `${at}: step ${p.step} divides ${e.min}–${e.max} in at most 1000 steps`);
        if (e.min === 0 && e.max === 1) eq([p.scale, p.unit], [100, '%'], `${at}: a 0–1 field shows as a percent`);
        ok(p.unit == null || typeof p.unit === 'string', `${at}: unit is text`);
      }
      for (const p of pres) for (const s of [p.label, p.unit, p.top]) if (s != null) {
        ok(typeof s === 'string' && s.length <= 14, `${t.type}.${p.field}: "${s}" is short text`);
        for (const g of guardHits(String(s))) ok(false, `${t.type}.${p.field}: "${s}" ${g}`);
      }
      // Two sliders, or two switches, on one card are told apart by their labels.
      const sliders = pres.filter((p) => p.kind === 'slider'), switches = pres.filter((p) => p.kind === 'switch');
      if (sliders.length > 1) ok(sliders.every((p) => p.label), `${t.type}: each of its sliders has a label`);
      for (const list of [sliders, switches]) eq(new Set(list.map((p) => p.label ?? p.field)).size, list.length, `${t.type}: distinct labels`);
    }
    eq(fields, types().reduce((a, t) => a + (t.edit || []).length, 0), 'every catalog edit field');
  }));

  // A device's world bounding box (its meshes, no highlight shells or unseen tap boxes): inside the room.
  const ROOM_EPS = 1e-3;
  const outside = (THREE, obj) => {
    obj.updateWorldMatrix(true, true);
    const b = new THREE.Box3(), mb = new THREE.Box3();
    obj.traverse((m) => { if (!m.isMesh || m.userData.isShell || m.userData.proxy) return; if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); b.union(mb.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld)); });
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

  await check('ui · screens in the room never print "100%" (every text drawn on a model canvas, at every edit max)', need(ui, r3)(async ({ ok }) => {
    const { THREE, R } = await room3dOn(), { parts } = await env();
    const drawn = [], real = document.createElement;
    document.createElement = (...a) => { const c = real.apply(document, a); const gc = c.getContext; c.getContext = (...b) => { const g = gc.apply(c, b); return new Proxy(g, { get: (t, k) => (k === 'fillText' ? (txt, ...r) => { drawn.push(String(txt)); return t.fillText(txt, ...r); } : t[k]) }); }; return c; };
    try {
      for (const type of ['temp_humidity_sensor', 'energy_meter', 'printer_3d', 'robot_arm', 'label_printer', 'ev_charger']) {
        const t = cat.typeOf(type), M = parts.materials(), P = parts.parts(R.scene, M);
        const m = ui.DEVICE_UI[type].model({ THREE, P, M });
        for (const s of reachableStates(t)) { if (s.status === 'online') m.update(s, 1); }
        for (const e of t.edit || []) if (e.kind === 'number') for (const v of [e.min, e.max]) m.update({ ...t.initial, [e.field]: v, status: 'online' }, 2);
      }
    } finally { document.createElement = real; }
    ok(drawn.length > 0, 'the screens drew some text');
    ok(!drawn.some((x) => /100\s*%/.test(x)), `a screen printed 100%: ${drawn.filter((x) => /100\s*%/.test(x)).join(', ')}`);
  }));

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

  await check('mount · no line hides code behind a trailing // comment (the build → run thumbnail timer once did)', async ({ ok }) => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../js/custom/mount.js', import.meta.url), 'utf8');
    const bad = src.split('\n').filter((l) => /\} \/\/ .*\belse\b/.test(l));
    ok(bad.length === 0, `an else after a // on: ${bad.join(' | ').slice(0, 200)}`);
    ok(/\} else if \(thumbs && !thumbTimer\) thumbTimer = setTimeout\(/.test(src), 'the idle thumbnail timer is armed on leaving build');
  });
  await check('room3d · a small wall device has an unseen tap box at least 40 cm across, flush with its wall', need(ui, r3)(async ({ ok }) => {
    const { THREE, R, room } = await room3dOn();
    const { emptyLayout, addDevice, moveDevice } = lay;
    let L = addDevice(emptyLayout(), 'door_window_sensor', ui.DEVICE_UI.door_window_sensor.size).layout;
    L = moveDevice(L, 'door_window_sensor', { x: 1, z: -3 }, ui.DEVICE_UI.door_window_sensor.size); room.sync(L);
    const o = room.objectFor('door_window_sensor'); o.updateWorldMatrix(true, true);
    let proxy = null; o.traverse((x) => { if (x.userData.proxy) proxy = x; });
    ok(proxy && proxy.visible === false, 'a hidden proxy box');
    const b = new THREE.Box3().setFromObject(proxy), sz = b.getSize(new THREE.Vector3());
    ok(sz.x >= 0.399 && sz.y >= 0.399, `proxy ${sz.x.toFixed(2)} x ${sz.y.toFixed(2)}`);
    ok(b.min.z >= -3 - 1e-6, `the proxy stays on the room side of the wall (z from ${b.min.z.toFixed(3)})`);
    const near = new THREE.Raycaster(new THREE.Vector3(1.17, o.position.y + 0.15, 2), new THREE.Vector3(0, 0, -1));
    ok(near.intersectObject(o, true).some((h) => h.object.userData.proxy), 'a ray 17 cm beside the sensor hits the proxy');
  }));
  await check('room3d · a removed device frees its own materials and textures, never the shared ones, and asks the renderer to prune its shadow twins', need(ui, r3)(async ({ eq, ok }) => {
    const { THREE, parts } = await env(), R = stubRenderer(), M = parts.materials(), P = parts.parts(R.scene, M);
    const room = r3.createRoom3d({ R, P, M, THREE, store: null });
    let pruned = 0; R.pruneTwins = () => { pruned++; };
    const { emptyLayout, addDevice, removeDevice } = lay;
    let L = emptyLayout(); for (const type of ['thermostat', 'door_camera']) L = addDevice(L, type, ui.DEVICE_UI[type].size).layout;
    room.sync(L);
    const maps = new Set(), mats = new Set(), shared = new Set(); let freedMaps = 0, freedMats = 0, freedShared = 0;
    room.objectFor('thermostat').traverse((x) => { for (const m of [].concat(x.material || [])) { mats.add(m); for (const k of ['map', 'emissiveMap']) if (m[k]) maps.add(m[k]); } });
    ok(maps.size > 0, 'the thermostat has a screen texture');
    for (const t of maps) t.addEventListener('dispose', () => { freedMaps++; });
    for (const m of mats) m.addEventListener('dispose', () => { freedMats++; });
    for (const m of Object.values(M)) m?.addEventListener?.('dispose', () => { freedShared++; });
    room.sync(removeDevice(L, 'thermostat'));
    eq(pruned, 1, 'pruneTwins asked once for the removed device');
    eq(freedMaps, maps.size, 'every screen texture is freed');
    ok(freedMats > 0, 'its own materials are freed');
    eq(freedShared, 0, 'no shared M material was freed');
    ok(R.pickIds.has('door_camera'), 'the other device is untouched');
  }));
  await check('room3d · the light budget goes to lit lights, and every light type lights the room', need(ui, r3)(async ({ eq, ok }) => {
    const { THREE, R, room } = await room3dOn();
    const { emptyLayout, addDevice } = lay, { DEVICE_UI } = ui;
    const lightsOf = (id) => { const l = []; room.objectFor(id).traverse((x) => { if (x.isLight) l.push(x); }); return l; };
    const visibleCount = () => { let n = 0; R.scene.traverse((o) => { if (o.isPointLight && o.visible) n++; }); return n; };
    const withState = (on) => { const st = { env: { hour: 20 }, hub: { status: 'online', led: 1 }, plan: {} }; for (const id of on) st[id] = { brightness: 1, status: 'online' }; return st; };
    let L = emptyLayout(); for (let i = 0; i < 5; i++) L = addDevice(L, 'floor_lamp', DEVICE_UI.floor_lamp.size).layout;
    room.sync(L); eq(r3.LIGHT_BUDGET, 4, 'the budget');
    room.update(withState([]), 1);
    ok(!lightsOf('floor_lamp_5')[0].visible && visibleCount() === 4, 'all dark: the first four in layout order hold the slots');
    room.update(withState(['floor_lamp_5']), 2);
    ok(lightsOf('floor_lamp_5')[0].visible && lightsOf('floor_lamp_5')[0].intensity > 0, 'only the fifth is on: it gets a slot');
    eq(visibleCount(), 4, 'the number of visible lights stays at the budget');
    room.update(withState(['floor_lamp_5', 'floor_lamp_2']), 3);
    ok(lightsOf('floor_lamp_5')[0].visible && lightsOf('floor_lamp_2')[0].visible && visibleCount() === 4, 'two on: both lit, still four');
    room.update(withState(['floor_lamp', 'floor_lamp_2', 'floor_lamp_3', 'floor_lamp_4', 'floor_lamp_5']), 4);
    eq(visibleCount(), 4, 'all five on: still four');
    ok(lightsOf('floor_lamp')[0].visible && !lightsOf('floor_lamp_5')[0].visible, 'all lit: layout order decides');
    room.update(withState([]), 5); eq(visibleCount(), 4, 'back to dark: still four');
    // visible flags change only when the set of lit lights changes
    const flips = []; for (const id of ['floor_lamp', 'floor_lamp_5']) { const l = lightsOf(id)[0]; let v = l.visible; Object.defineProperty(l, 'visible', { get: () => v, set: (x) => { if (x !== v) flips.push(id); v = x; } }); }
    for (let f = 0; f < 20; f++) room.update(withState(['floor_lamp_5']), 6 + f / 30);
    eq(flips.length, 1, `one change when the 5th goes on, none after (flips: ${flips})`);
    // every light-type device carries a point light that follows its brightness
    const kinds = ['floor_lamp', 'night_light', 'hall_light', 'key_light', 'ceiling_light', 'colour_bulb'];
    let K = emptyLayout(); for (const type of kinds) K = addDevice(K, type, DEVICE_UI[type].size).layout;
    room.sync(K);
    for (const type of kinds) {
      const ls = lightsOf(type); ok(ls.length === 1 && ls[0].isPointLight, `${type}: one point light`);
      room.update({ env: { hour: 20 }, hub: { status: 'online' }, [type]: { ...cat.typeOf(type).initial, brightness: 0, status: 'online' } }, 20);
      eq(ls[0].intensity, 0, `${type}: dark at brightness 0`);
      room.update({ env: { hour: 20 }, hub: { status: 'online' }, [type]: { ...cat.typeOf(type).initial, brightness: 1, status: 'online' } }, 21);
      ok(ls[0].intensity > 0.3, `${type}: lights the room at full (${ls[0].intensity})`);
    }
    room.update({ env: { hour: 20 }, hub: { status: 'online' }, colour_bulb: { brightness: 1, color: 'green', status: 'online' } }, 22);
    ok(lightsOf('colour_bulb')[0].color.g > lightsOf('colour_bulb')[0].color.r, 'the colour bulb lights in its colour');
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

  await check('scene · editsFor on a custom scene matches the catalog', need(ui, sc)(({ eq, ok }) => {
    const all = types().map((t) => t.type);
    let seen = 0, numbered = 0;
    for (let i = 0; i < all.length; i += 19) { // 19 types and a second floor lamp: at most 20 devices a room
      let L = lay.emptyLayout();
      for (const type of all.slice(i, i + 19)) L = lay.addDevice(L, type).layout;
      if (i === 0) L = lay.addDevice(L, 'floor_lamp').layout;
      const s = sc.sceneFor(L), init = sc.initialFor(s);
      for (const id of s.deviceOrder) {
        const t = cat.typeOf(s.devices[id].type);
        const got = editsFor(id, s.devices[id], init[id]).map((e) => ({ path: e.path, kind: e.kind, min: e.min, max: e.max, value: e.value }));
        const want = (t.edit || []).map((e) => ({ path: `${id}.${e.field}`, kind: e.kind === 'bool' ? 'switch' : 'slider', min: e.min, max: e.max, value: t.initial[e.field] }));
        eq(got, want, id); seen++;
        for (const e of editsFor(id, s.devices[id], init[id])) if (e.kind === 'slider') ok(Number.isFinite(e.step) && e.step > 0 && e.scale > 0, `${e.path}: step ${e.step}, scale ${e.scale}`);
        if (id === 'floor_lamp_2') numbered++;
      }
    }
    eq([seen, numbered], [all.length + 1, 1], 'every type, and a numbered device on its own id');
  }));

  // The slider readout (panel.js) is visitor text too: a percent at the top reads as a word, never "100%".
  await check('ui · slider readouts pass the guardrails at min and max (Home and every custom slider, through panel.js)', need(ui, sc)(async ({ eq, ok }) => {
    const { editValueText } = await import('../js/engine/panel.js');
    const home = (await import('../js/scenes/home.js')).default;
    const sliders = [], homeSliders = [];
    for (const [id, d] of Object.entries(home.devices)) homeSliders.push(...editsFor(id, d, d.initial).filter((e) => e.kind === 'slider'));
    sliders.push(...homeSliders);
    const all = types().map((t) => t.type);
    for (let i = 0; i < all.length; i += 20) {
      let L = lay.emptyLayout(); for (const type of all.slice(i, i + 20)) L = lay.addDevice(L, type).layout;
      const s = sc.sceneFor(L), init = sc.initialFor(s);
      for (const id of s.deviceOrder) sliders.push(...editsFor(id, s.devices[id], init[id]).filter((e) => e.kind === 'slider'));
    }
    eq(sliders.length, 5 + types().reduce((a, t) => a + (t.edit || []).filter((e) => e.kind === 'number').length, 0), 'Home\'s 5 sliders and one per catalog number field');
    for (const e of sliders) for (const v of [e.min, e.max]) {
      const text = editValueText(e, v);
      ok(typeof text === 'string' && text && !/undefined|NaN|null/.test(text), `${e.path} at ${v}: "${text}"`);
      for (const g of guardHits(text)) ok(false, `${e.path} at ${v}: "${text}" ${g}`);
    }
    const E = (path) => sliders.slice(homeSliders.length).find((e) => e.path === path), H = (path) => homeSliders.find((e) => e.path === path);
    eq([['floor_lamp.brightness', 1], ['floor_lamp.brightness', 0.43], ['blinds.closed', 1], ['soil_sensor.moisture', 100], ['soil_sensor.moisture', 34], ['robot_vacuum.battery', 100],
      ['printer_3d.progress', 100], ['humidifier.humidity', 100], ['conveyor.speed', 0.5], ['conveyor.speed', 0]].map(([p, v]) => editValueText(E(p), v)),
    ['full', '43%', 'closed', 'saturated', '34%', 'full', 'done', 'saturated', '0.5 m/s', '0.0 m/s'], 'custom spot readouts');
    eq([['lamp.brightness', 1], ['lamp.brightness', 0.3], ['blinds.closed', 1], ['soil.moisture', 100], ['thermostat.target', 28]].map(([p, v]) => editValueText(H(p), v)),
      ['full', '30%', 'full', 'full', '28.0°C'], 'Home spot readouts (the default top word; below the top as before)');
  }));

  // ---- Task 7: the mode controller, the code gate and the live hooks (real createLive against the contract mock) ----
  const ctl = await import('../js/custom/controller.js').catch((e) => ({ err: e }));
  const gate = await import('../js/custom/gate.js').catch((e) => ({ err: e }));
  const cpy = await import('../js/custom/copy.js').catch((e) => ({ err: e }));
  const lv = await import('../js/engine/live.js'), lapi = await import('../js/engine/liveapi.js'), stm = await import('../js/engine/store.js'), mk = await import('./fixtures/live-mock.mjs');
  const live2 = (...ms) => (fn) => async (t) => { for (const m of [cat, lay, sc, ui, ...ms]) if (m.err) throw m.err; await fn(t); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (cond, what) => { for (let i = 0; i < 600; i++) { if (cond()) return; await sleep(5); } throw new Error(`timed out waiting for ${what}`); };
  const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
  const postsTo = (m, re) => m.calls.filter((c) => c.method === 'POST' && re.test(c.path));

  // stub view / panel / ui for createLive (the shape test/live.mjs's harness uses)
  function liveParts(log) {
    const rec = (source) => (method, ...args) => { log.push([source, method, ...args]); };
    const h = { lastAccess: null, accessCount: 0 };
    const nop = () => ({ mergeSteps() {}, step() {}, call() {}, result() {}, timeline() {}, done() {} });
    const view = {
      ...Object.fromEntries(['user', 'ncb', 'chips', 'planning', 'reading', 'sayDelta', 'summary', 'failures', 'lost', 'input', 'live', 'closeChips'].map((m) => [m, rec('view').bind(null, m)])),
      endCard() { return { close() {} }; },
      planCard() { return { enable() {}, busy() {}, declined() {}, close() {}, toChecklist: nop }; },
      checklist: nop,
      access(spec, { onCode, onApply, onBack }) {
        log.push(['view', 'access', spec]); h.accessCount++;
        const a = { spec, code: (t) => onCode(t), apply: (x) => onApply(x), back: () => onBack(), close: () => log.push(['access', 'close']) };
        h.lastAccess = a; return a;
      },
    };
    const panel = { mark() {}, reveal() {} };
    const uiStub = { alive: () => true, ...Object.fromEntries(['status', 'beats', 'resetRoom', 'offerGuided', 'track', 'rewind'].map((m) => [m, rec('ui').bind(null, m)])), baseline: () => null };
    return { h, view, panel, ui: uiStub };
  }

  // A controller wired to the mock. makeLive builds a createLive per room, as the page will.
  function rig({ mock = mk.createMockLive({ scenes: ['home', 'custom'] }), saved = true } = {}) {
    const storage = mem(), codes = lv.codeStore(mem()); if (saved) codes.set(mk.MOCK_CODE);
    const log = [], lives = [], seen = [], notices = [], modes = [], layouts = [];
    const spy = (url, init) => { // how many streams were still open, on every earlier session, when each new session was asked for
      if (/\/sessions$/.test(String(url)) && String(init?.method).toUpperCase() === 'POST') seen.push(lives.map((l) => mock.openStreams(l.live.sessionId ?? '')));
      return mock.fetch(url, init);
    };
    const makeLive = (scene, devices) => {
      const p = liveParts(log), store = stm.createStore(sc.initialFor(scene));
      const live = lv.createLive({ scene, store, view: p.view, panel: p.panel, ui: p.ui, base: 'http://mock', fetch: spy, codes, sessionExtra: () => ({ devices }) });
      lives.push({ live, parts: p, devices, store }); return live;
    };
    const c = ctl.createCustomController({ storage, makeLive, ui: { mode: (m) => modes.push(m), layout: (l) => layouts.push(l), notice: (k) => notices.push(k) } });
    return { c, mock, codes, storage, log, lives, seen, notices, modes, layouts, last: () => lives.at(-1) };
  }

  await check('gate · no code shows the access card; a good code passes and is saved', live2(gate, cpy)(async ({ eq, ok }) => {
    const mock = mk.createMockLive({ scenes: ['home', 'custom'] }), codes = lv.codeStore(mem()), log = [], p = liveParts(log);
    const api = lapi.createLiveApi({ base: 'http://mock', fetch: mock.fetch, getCode: () => codes.get() });
    let backed = 0; const done = gate.passGate({ api, codes, view: p.view, onBack: () => backed++ });
    await waitFor(() => p.h.lastAccess, 'the access card');
    eq([p.h.lastAccess.spec.mode, p.h.lastAccess.spec.backLabel], ['code', 'Back to scenes'], 'a code card that says Back to scenes');
    eq(await p.h.lastAccess.code('wrong-code'), lv.LIVE_COPY.badCode, 'a bad code is told so');
    eq(codes.get(), null, 'a bad code is not saved');
    eq(await p.h.lastAccess.code(' ncb-test-case '), null, 'a good code answers null');
    eq(await done, true, 'the gate passes');
    eq(codes.get(), mk.MOCK_CODE, 'the normalised code is saved');
    eq(backed, 0, 'no back');
    ok(postsTo(mock, /sessions$/).length === 0, 'the gate makes no session');
    ok(log.some((e) => e[0] === 'access' && e[1] === 'close'), 'the card is closed');
  }));

  await check('gate · a saved good code passes without a card; live off shows the offline card; back resolves false', live2(gate, cpy)(async ({ eq }) => {
    const mkApi = (mock, codes) => lapi.createLiveApi({ base: 'http://mock', fetch: mock.fetch, getCode: () => codes.get() });
    { // saved and good
      const mock = mk.createMockLive({ scenes: ['custom'] }), codes = lv.codeStore(mem()), p = liveParts([]); codes.set(mk.MOCK_CODE);
      eq(await gate.passGate({ api: mkApi(mock, codes), codes, view: p.view, onBack() {} }), true, 'saved code passes');
      eq(p.h.accessCount, 0, 'no card');
    }
    { // live off: the offline card, and Back resolves false
      const mock = mk.createMockLive({ scenes: ['custom'], liveEnabled: false }), codes = lv.codeStore(mem()), p = liveParts([]); codes.set(mk.MOCK_CODE);
      let backed = 0; const r = gate.passGate({ api: mkApi(mock, codes), codes, view: p.view, onBack: () => backed++ });
      await waitFor(() => p.h.lastAccess, 'the offline card');
      eq([p.h.lastAccess.spec.mode, p.h.lastAccess.spec.backLabel], ['offline', 'Back to scenes'], 'offline card');
      p.h.lastAccess.back(); eq(await r, false, 'back resolves false'); eq(backed, 1, 'onBack called');
    }
    { // the scene missing from /health counts as off
      const mock = mk.createMockLive({ scenes: ['home'] }), codes = lv.codeStore(mem()), p = liveParts([]);
      const r = gate.passGate({ api: mkApi(mock, codes), codes, view: p.view, onBack() {} });
      await waitFor(() => p.h.lastAccess, 'the card'); eq(p.h.lastAccess.spec.mode, 'offline', 'custom not in scenes'); p.h.lastAccess.back(); await r;
    }
    { // a saved code that no longer works is cleared, with the note; a code with none left says so
      const mock = mk.createMockLive({ scenes: ['custom'], code: 'OTHER' }), codes = lv.codeStore(mem()), p = liveParts([]); codes.set(mk.MOCK_CODE);
      const r = gate.passGate({ api: mkApi(mock, codes), codes, view: p.view, onBack() {} });
      await waitFor(() => p.h.lastAccess, 'the card');
      eq([p.h.lastAccess.spec.mode, p.h.lastAccess.spec.note, codes.get()], ['code', lv.LIVE_COPY.savedCodeGone, null], 'gone code');
      eq(await p.h.lastAccess.code('OTHER'), null); eq(await r, true, 'then a new code passes');
      const m2 = mk.createMockLive({ scenes: ['custom'], remaining: 0 }), c2 = lv.codeStore(mem()), q = liveParts([]); c2.set(mk.MOCK_CODE);
      const r2 = gate.passGate({ api: mkApi(m2, c2), codes: c2, view: q.view, onBack() {} });
      await waitFor(() => q.h.lastAccess, 'the card'); eq(q.h.lastAccess.spec.note, lv.LIVE_COPY.noneLeft, 'none left'); q.h.lastAccess.back(); await r2;
    }
  }));

  await check('controller · done posts the device list', live2(ctl, cpy)(async ({ eq }) => {
    const t = rig(); t.c.gated(); eq(t.c.mode, 'build', 'gated');
    t.c.add('floor_lamp'); t.c.add('soil_sensor');
    eq(t.layouts.length, 2, 'ui.layout per change');
    eq(JSON.parse(t.storage.getItem('ncb.customRoom')).devices.map((d) => d.id), ['floor_lamp', 'soil_sensor'], 'saved');
    await t.c.done();
    eq(postsTo(t.mock, /^sessions$/).map((c) => c.body), [{ scene: 'custom', devices: [{ type: 'floor_lamp', id: 'floor_lamp' }, { type: 'soil_sensor', id: 'soil_sensor' }] }], 'POST sessions body');
    eq([t.c.mode, t.c.live.phase, t.c.live === t.last().live], ['run', 'idle', true], 'run, idle');
    t.c.teardown();
  }));

  await check('controller · moving keeps the session', live2(ctl, cpy)(async ({ eq }) => {
    const t = rig(); t.c.gated(); t.c.add('floor_lamp'); await t.c.done();
    const first = t.c.live; eq(t.c.toBuild(), true, 'toBuild'); eq(t.c.mode, 'build');
    t.c.move('floor_lamp', { x: 1, z: 1 }); t.c.rotate('floor_lamp'); t.c.moveHub({ x: 0.5, z: -1 });
    eq(t.c.changedSinceRun, false, 'moving is not a device change'); eq(t.notices, [], 'no notice');
    await t.c.done();
    eq(postsTo(t.mock, /^sessions$/).length, 1, 'no new POST sessions'); eq([t.c.live === first, t.c.mode], [true, 'run'], 'same live, run');
    t.c.teardown();
  }));

  await check('controller · a device change closes the old live before the new session', live2(ctl, cpy)(async ({ eq, ok }) => {
    const t = rig(); t.c.gated(); t.c.add('floor_lamp'); await t.c.done();
    for (let i = 0; i < 6; i++) {
      const old = t.c.live, oldSid = old.sessionId;
      await waitFor(() => t.mock.openStreams(oldSid) === 1, 'the stream to open');
      eq(t.c.toBuild(), true); t.c.add(i % 2 ? 'soil_sensor' : 'blinds'); // never the same room as the last run
      eq(t.c.changedSinceRun, true, `changedSinceRun before done (round ${i})`);
      const n = postsTo(t.mock, /^sessions$/).length;
      await t.c.done();
      eq(postsTo(t.mock, /^sessions$/).length, n + 1, 'one new session');
      ok(t.c.live !== old && t.c.live.phase === 'idle', 'a new live in idle');
      eq(t.mock.openStreams(oldSid), 0, 'the old stream is closed');
      eq(t.seen.at(-1).every((c) => c === 0), true, 'no earlier stream was open when the new session was asked for');
      t.c.remove(t.c.layout.devices.at(-1).id);
    }
    ok(!t.log.some((e) => e[0] === 'view' && e[1] === 'ncb' && e[2] === lv.LIVE_COPY.limitCode), 'no code_limit');
    t.c.teardown();
  }));

  await check('controller · Build is refused while a request runs', live2(ctl, cpy)(async ({ eq }) => {
    const t = rig(); t.c.gated(); t.c.add('floor_lamp'); await t.c.done();
    const sub = t.c.live.submit('pizza'); // a request the mock answers with cannot_do, then done
    eq(t.c.canBuild, false, 'cannot build mid-request');
    eq([t.c.toBuild(), t.c.mode, t.notices.at(-1)], [false, 'run', 'buildBusy'], 'refused with the notice');
    await sub; await waitFor(() => t.c.live.phase === 'idle', 'the request to end');
    eq([t.c.canBuild, t.c.toBuild(), t.c.mode], [true, true, 'build'], 'allowed once idle');
    t.c.teardown();
  }));

  await check('controller · a dead code at Done building asks again and keeps the room', live2(ctl, cpy)(async ({ eq, ok }) => {
    const t = rig(); t.c.gated(); t.c.add('floor_lamp'); await t.c.done();
    t.c.toBuild(); t.c.add('soil_sensor'); const before = JSON.stringify(t.c.layout);
    t.mock.set({ code: 'OTHER' });
    await t.c.done();
    const p = t.last().parts;
    ok(p.h.lastAccess && p.h.lastAccess.spec.mode === 'code', 'the access card is shown again');
    eq(p.h.lastAccess.spec.note, lv.LIVE_COPY.savedCodeGone, 'with the note');
    eq(JSON.stringify(t.c.layout), before, 'the room is unchanged'); eq(t.codes.get(), null, 'the dead code is forgotten');
    eq(await p.h.lastAccess.code('OTHER'), null, 'a new code is accepted');
    await waitFor(() => t.c.live.phase === 'idle', 'idle after the new code');
    eq(t.c.live.phase, 'idle'); t.c.teardown();
  }));

  await check('controller · an access card at Done building still lets the visitor build', live2(ctl, cpy)(async ({ eq }) => {
    const t = rig(); t.c.gated(); t.c.add('floor_lamp'); await t.c.done();
    t.c.toBuild(); t.c.add('soil_sensor'); t.mock.set({ code: 'OTHER' }); await t.c.done();
    const live = t.c.live; eq(live.phase, 'access', 'the access card is up');
    eq([t.c.canBuild, t.c.toBuild(), t.c.mode], [true, true, 'build'], 'back to building');
    t.c.move('soil_sensor', { x: 1, z: 1 }); await t.c.done();
    eq([t.c.mode, t.c.live === live, postsTo(t.mock, /^sessions$/).length], ['run', true, 1], 'the same live, still at its card');
    t.c.teardown();
  }));

  await check('controller · full and empty', live2(ctl, cpy)(async ({ eq, ok }) => {
    const t = rig(); t.c.gated();
    await t.c.done(); eq([postsTo(t.mock, /^sessions$/).length, t.c.mode, t.c.live], [0, 'build', null], 'done with no devices does nothing');
    for (let i = 0; i < 20; i++) ok(t.c.add('floor_lamp'), `add ${i}`);
    eq(t.notices, [], 'no notice yet'); eq(t.c.add('floor_lamp'), null, '21st add'); eq(t.notices, ['full'], 'full notice');
    eq(t.c.layout.devices.length, 20, 'still 20');
    t.c.clear(); eq(t.c.layout.devices.length, 0, 'cleared'); await t.c.done(); eq(postsTo(t.mock, /^sessions$/).length, 0, 'still no POST');
  }));

  await check('controller · says a change restarts the conversation once', live2(ctl, cpy)(async ({ eq }) => {
    const t = rig(); t.c.gated(); t.c.add('floor_lamp'); await t.c.done(); t.c.toBuild();
    t.c.add('blinds'); t.c.add('soil_sensor'); t.c.remove('blinds'); eq(t.notices, ['changed'], 'one changed notice');
    eq(t.c.layout.hub.x, 0, 'the hub stays'); t.c.teardown();
  }));

  // ---- Task 8: placement's pure helpers (the QA page test/custom-build.html runs them in a browser too) ----
  const pl = await import('../js/custom/placement.js').catch((e) => ({ err: e }));
  await check('placement · rays, grab offsets and the selection bar', need(pl)(({ eq, ok }) => {
    const { hitOn, grabOffset, dragTo, isTap, selection } = pl;
    const v = (x, y, z) => ({ x, y, z }), cam = v(7, 4.2, 6.2);
    const toward = (p) => { const d = v(p.x - cam.x, p.y - cam.y, p.z - cam.z), l = Math.hypot(d.x, d.y, d.z); return v(d.x / l, d.y / l, d.z / l); };
    const r = (p) => p && Object.fromEntries(Object.entries(p).map(([k, x]) => [k, typeof x === 'number' ? Math.round(x * 1e6) / 1e6 : x]));
    eq(r(hitOn('floor', cam, toward(v(1.5, 0, -0.5)))), { x: 1.5, z: -0.5 }, 'floor');
    eq(r(hitOn('ceiling', cam, toward(v(-1, 2.8, 1)))), { x: -1, z: 1 }, 'ceiling');
    eq(r(hitOn('wall', cam, toward(v(0.5, 1.4, -3)))), { x: 0.5, z: -3, wall: 'back' }, 'back wall');
    eq(r(hitOn('wall', cam, toward(v(-4, 1.4, 1)))), { x: -4, z: 1, wall: 'left' }, 'left wall');
    eq(r(hitOn('wall', cam, toward(v(-1, 0, 1)))), { x: -1, z: 1, wall: 'left' }, 'over the floor: the nearer wall');
    eq(hitOn('floor', cam, v(0, 1, 0)), null, 'the sky');
    eq(r(hitOn('floor', cam, toward(v(-3.7, 1.65, -2.7)), 1.65)), { x: -3.7, z: -2.7 }, 'the plane at the grab height');
    eq(r(dragTo('floor', { x: 2.2, z: 0.2 }, grabOffset('floor', { x: 1, z: 1, rot: 0 }, { x: 1.2, z: 0.7 }))), { x: 2, z: 0.5 }, 'floor offset kept');
    const gw = grabOffset('wall', { x: -1, z: -3, rot: 0 }, { x: -0.8, z: -3, wall: 'back' });
    eq(r(dragTo('wall', { x: 0.2, z: -3, wall: 'back' }, gw)), { x: 0, z: -3 }, 'along the wall');
    eq(dragTo('wall', { x: -4, z: 1, wall: 'left' }, gw), { x: -4, z: 1 }, 'round the corner');
    ok(isTap({ x: 0, y: 0 }, { x: 4, y: 4 }) && !isTap({ x: 0, y: 0 }, { x: 7, y: 0 }), 'tap slop');
    let L = lay.emptyLayout(); for (const t of ['floor_lamp', 'blinds']) L = lay.addDevice(L, t).layout;
    eq([selection(L, 'hub'), selection(L, 'floor_lamp'), selection(L, 'blinds'), selection(L, 'x')], [
      { id: 'hub', name: 'NeuCharBox', rotate: false, remove: false }, { id: 'floor_lamp', name: 'Floor lamp', rotate: true, remove: true },
      { id: 'blinds', name: 'Blinds', rotate: false, remove: true }, null], 'selection');
  }));

  // ---- Task 10: inventory pictures (the QA page test/custom-build.html renders them in a browser) ----
  await check('thumbs · null without WebGL', async ({ eq, ok }) => {
    const th = await import('../js/custom/thumbs.js'), { THREE, parts } = await env();
    const t = th.createThumbs({ THREE, parts });
    eq(await t.get('floor_lamp'), null, 'no document: null'); eq(await t.get('nope'), null, 'unknown type: null');
    t.dispose(); eq(await t.get('blinds'), null, 'still null after dispose');
    const fake = th.createThumbs({ THREE, parts, makeCanvas: () => ({ addEventListener() {}, width: 1, height: 1 }) });
    let threw = false; const r = await fake.get('floor_lamp').catch(() => { threw = true; }); ok(!threw && r === null, 'a canvas with no WebGL context: null, no throw');
    eq(await fake.get('blinds'), null, 'and it stays null'); fake.dispose();
  });

  await check('copy · CUSTOM_COPY passes the guardrails', live2(cpy)(({ eq, ok }) => {
    const C = cpy.CUSTOM_COPY, hits = [];
    for (const [k, v] of Object.entries(C)) for (const text of typeof v === 'function' ? [v(0), v(1), v(20)] : [v]) { ok(typeof text === 'string' && text, `${k} is a string`); hits.push(...guardHits(text).map((g) => `${k}: ${g}`)); }
    eq(hits, [], 'guard hits'); eq([C.cardTitle, C.done, C.count(3), C.clearConfirm(5)], ['Build your own', 'Done building →', '3 / 20 devices', 'Clear all 5 devices?'], 'spot values');
  }));

  await check('live hooks · createSession without extra posts { scene } only; the mock builds a custom room', live2()(async ({ eq }) => {
    const mock = mk.createMockLive(), api = lapi.createLiveApi({ base: 'http://mock', fetch: mock.fetch, getCode: () => mk.MOCK_CODE });
    await api.createSession('home'); eq(mock.calls.at(-1).body, { scene: 'home' }, 'plain body');
    const m2 = mk.createMockLive({ scenes: ['custom'] }), a2 = lapi.createLiveApi({ base: 'http://mock', fetch: m2.fetch, getCode: () => mk.MOCK_CODE });
    const r = await a2.createSession('custom', { devices: [{ type: 'floor_lamp', id: 'floor_lamp' }] });
    eq(Object.keys(r.state).sort(), ['env', 'floor_lamp'], 'custom state'); eq(r.state.floor_lamp, { brightness: 0, status: 'online' }, 'initial + online');
    for (const bad of [[], [{ type: 'floor_lamp', id: 'floor_lamp_1' }], [{ type: 'nope', id: 'nope' }], [{ type: 'floor_lamp', id: 'floor_lamp' }, { type: 'floor_lamp', id: 'floor_lamp' }]]) {
      try { await a2.createSession('custom', { devices: bad }); eq('no error', 'bad_room'); } catch (e) { eq([e.status, e.kind], [400, 'bad_room'], 'bad room'); }
    }
  }));

  // ---- Task 9: run mode: the ui createLive gets, and the per-session reset (js/custom/liveui.js) ----
  const lu = await import('../js/custom/liveui.js').catch((e) => ({ err: e }));
  const runMods = (fn) => live2(lu)(fn);
  // A DOM-free stand-in for the card: createElement gives a node whose innerHTML is parsed for its buttons and links.
  const fakeDoc = () => ({ createElement: () => { const n = { className: '', _h: '', mounted: false, parts: {}, querySelector(sel) { return this.parts[sel] ?? null; }, get innerHTML() { return this._h; },
    set innerHTML(h) { this._h = h; this.parts = { button: { onclick: null, disabled: false } }; } }; return n; } });

  await check('run · liveUiFor: the card, the baseline and the no-op beats', runMods(({ eq, ok }) => {
    const ref = { current: { env: { hour: 16.5 } } }, mounted = [], calls = [], statusEl = { textContent: '', classList: { toggle: (k, v) => calls.push(['bad', k, v]) } };
    let toB = 0, torn = false, tracked = [];
    const ui = lu.liveUiFor({ statusEl, getPanel: () => ({ track: (on) => tracked.push(on), rewind: () => tracked.push('rewind') }), room3d: { reset: () => calls.push('reset') }, R: { clearMarkers: () => calls.push('clear') },
      baselineRef: ref, onBackToBuilding: () => { toB++; return true; }, chat: { mount: (n) => mounted.push(n) }, alive: () => !torn, doc: fakeDoc() });
    eq(ui.baseline(), ref.current, 'baseline is the ref'); eq(ui.beats('x'), undefined, 'beats is a no-op');
    ui.status('hi', true); eq([statusEl.textContent, calls[0]], ['hi', ['bad', 'bad', true]], 'status'); ui.track(true); ui.rewind(); eq(tracked, [true, 'rewind'], 'track and rewind go to the panel');
    ui.resetRoom(); eq(calls.slice(1), ['reset', 'clear'], 'resetRoom clears the room and the markers');
    eq(ui.alive(), true); torn = true; eq(ui.alive(), false, 'alive follows the page');
    ui.offerGuided('x'); eq(mounted.length, 1, 'one card');
    const h = mounted[0].innerHTML; ok(h.includes(cpy.CUSTOM_COPY.toBuilding) && h.includes(cpy.CUSTOM_COPY.otherScenes) && /<a [^>]*href="#"/.test(h), 'both buttons, the link to #');
    mounted[0].parts.button.onclick(); eq([toB, mounted[0].parts.button.disabled], [1, true], 'Back to building runs and disables the button');
  }));

  await check('run · liveUiFor wires editing and the clock as main.js does', runMods(({ eq, ok }) => {
    const calls = [], classes = new Set(), edits = [], text = { textContent: '' };
    const statusEl = { textContent: '', classList: { toggle: (k, v) => calls.push(['bad', !!v]) } };
    let onEdit = null;
    const panel = { editable: (on, o) => { calls.push(['editable', on]); onEdit = o?.onEdit ?? null; }, track() {}, rewind() {} };
    const ui = lu.liveUiFor({ statusEl, statusTextEl: text, getPanel: () => panel, room3d: { reset() {} }, R: { clearMarkers() {} }, baselineRef: { current: null },
      onBackToBuilding: () => true, chat: { mount() {} }, alive: () => true, doc: fakeDoc(),
      editRoot: { classList: { toggle: (k, v) => (v ? classes.add(k) : classes.delete(k)) } },
      clockCtl: { active: (on) => calls.push(['clock active', on]), render: (c) => calls.push(['clock render', c]) },
      getLive: () => ({ edit: (p, v) => edits.push([p, v]) }) });
    ok(typeof ui.editing === 'function' && typeof ui.clock === 'function', 'the ui has editing and clock');
    ui.editing(true);
    eq(calls.splice(0), [['editable', true], ['clock active', true]], 'editing on: the panel takes edits, the clock control shows');
    ok(classes.has('live-edit'), 'the page is marked live-edit (the phone layout makes room for the controls)');
    onEdit?.('soil_sensor.moisture', 25); eq(edits, [['soil_sensor.moisture', 25]], 'a card edit goes to the current live');
    const c = { label: 'Fri 16:30', enabled: true, reason: null };
    ui.clock(c); eq(calls.splice(0), [['clock render', c]], 'the clock control renders the controller\'s clock');
    ui.status('Fri 16:30'); eq(text.textContent, '', 'a status line that is only the clock\'s label is dropped while the clock shows');
    ui.status('Live AI · 2 devices · waiting for your request', true); eq([text.textContent, calls.splice(0)], ['Live AI · 2 devices · waiting for your request', [['bad', true]]], 'other status text shows, in the text span');
    eq(statusEl.textContent, '', 'the row keeps its children (the clock control)');
    ui.editing(false);
    eq(calls.splice(0), [['editable', false], ['clock active', false]], 'editing off: display-only cards, no clock control');
    ok(!classes.has('live-edit'), 'live-edit off');
    ui.status('Fri 16:30'); eq(text.textContent, 'Fri 16:30', 'with the clock control hidden, the label shows again');
  }));

  await check('run · a custom room\'s hand edits post set on catalog paths, and the mock checks them against the catalog', live2(ctl)(async ({ eq, ok }) => {
    const t = rig(); t.c.gated(); t.c.add('soil_sensor'); t.c.add('water_pump'); await t.c.done();
    const L = t.last(); await waitFor(() => L.live.phase === 'idle', 'idle');
    await L.live.edit('soil_sensor.moisture', 25);
    eq(L.store.get('soil_sensor.moisture'), 25, 'the store moves at once and stays (the mock took it)');
    eq(postsTo(t.mock, /\/set$/).map((c) => c.body), [{ path: 'soil_sensor.moisture', value: 25 }], 'one set, on the catalog path');
    await L.live.edit('soil_sensor.status', 'fault'); await L.live.edit('soil.moisture', 25); await L.live.edit('water_pump.seconds', 5);
    eq(postsTo(t.mock, /\/set$/).length, 1, 'paths outside the catalog\'s edit post nothing');
    await L.live.edit('water_pump.running', true);
    await waitFor(() => L.store.get('water_pump.running') === true, 'the switch edit');
    eq(L.parts.h.accessCount, 0, 'no access card');
    ok(!t.log.some((x) => x[0] === 'view' && x[1] === 'ncb' && x[2] === lv.LIVE_COPY.editRejected), 'no edit was refused');
    const api = lapi.createLiveApi({ base: 'http://mock', fetch: t.mock.fetch, getCode: () => mk.MOCK_CODE }), sid = L.live.sessionId;
    for (const [path, value] of [['soil_sensor.moisture', 101], ['soil_sensor.status', 'fault'], ['soil.moisture', 25], ['water_pump.running', 1]]) {
      let got = 'no error'; try { await api.set(sid, path, value); } catch (e) { got = [e.status, e.kind]; }
      eq(got, [400, 'bad_value'], `mock: ${path} = ${JSON.stringify(value)}`);
    }
    t.c.teardown();
  }));

  // The stand-in panel reads EVERY device of its scene on each store write, as the real one does (a TypeError on a
  // device the store no longer has: the Task 8 crash).
  function sessionRig() {
    const store = stm.createStore(sc.initialFor(sc.sceneFor(lay.emptyLayout()))), ref = { current: null }, order = [];
    const w = lu.createSessionWiring({ store, baselineRef: ref, replaceEl: () => order.push('el'), clearRoom: () => order.push('room'),
      makePanel: (scene, st) => { const render = (state) => { for (const id of scene.deviceOrder) void state[id].status; }; st.subscribe(render); render(st.state); order.push('panel'); return { scene, render }; } });
    return { store, ref, order, w };
  }
  await check('run · rebuilding resets the room to the new devices\' initials', runMods(({ eq }) => {
    const t = sessionRig(); let L = lay.emptyLayout(); L = lay.addDevice(L, 'floor_lamp').layout;
    t.w.begin(sc.sceneFor(L)); t.store.set('floor_lamp.brightness', 0.4); eq(t.store.state.floor_lamp.brightness, 0.4);
    L = lay.addDevice(L, 'soil_sensor').layout; t.w.begin(sc.sceneFor(L));
    eq([t.store.state.floor_lamp.brightness, t.store.state.soil_sensor.moisture], [0, 34], 'fresh initials');
    eq(t.ref.current, t.store.snapshot(), 'the baseline is the fresh snapshot'); eq(t.order.slice(-3), ['el', 'room', 'panel'], 'the panel is made last');
  }));

  await check('run · done, remove a device, done: a second session, no throw (through the real reset)', live2(ctl, lu)(async ({ eq, ok }) => {
    const t = sessionRig(), mock = mk.createMockLive({ scenes: ['home', 'custom'] }), codes = lv.codeStore(mem()); codes.set(mk.MOCK_CODE);
    const makeLive = (scene, devices) => { t.w.begin(scene); const p = liveParts([]); return lv.createLive({ scene, store: t.store, view: p.view, panel: p.panel, ui: p.ui, base: 'http://mock', fetch: mock.fetch, codes, sessionExtra: () => ({ devices }) }); };
    const c = ctl.createCustomController({ storage: mem(), makeLive, ui: { mode() {}, layout() {}, notice() {} } });
    c.gated(); c.add('floor_lamp'); c.add('soil_sensor'); await c.done();
    c.toBuild(); c.remove('soil_sensor'); await c.done(); // the old panel's render would throw on the dropped soil slice if it were still subscribed
    eq(postsTo(mock, /^sessions$/).length, 2, 'a second POST sessions'); eq(Object.keys(t.store.state).sort(), ['env', 'floor_lamp', 'hub', 'plan'], 'the store holds only the new room');
    eq(c.live.phase, 'idle', 'the new live is idle'); c.teardown();
  }));

  await check('run · the mock\'s reset returns a custom room\'s own state', runMods(async ({ eq }) => {
    const mock = mk.createMockLive({ scenes: ['custom'] }), api = lapi.createLiveApi({ base: 'http://mock', fetch: mock.fetch, getCode: () => mk.MOCK_CODE });
    const r = await api.createSession('custom', { devices: [{ type: 'floor_lamp', id: 'floor_lamp' }] });
    const body = await api.reset(r.sessionId); eq(Object.keys(body.state).sort(), ['env', 'floor_lamp'], 'the room, not Home'); eq(body.state.floor_lamp, { brightness: 0, status: 'online' });
  }));

  await check('live copy · a one-device room reads singular; Home reads as before', live2()(({ eq }) => {
    const L = lv.LIVE_COPY;
    eq(L.intro(1), 'Live AI is on. Type what you want this device to do. A real model plans it, and nothing runs until you approve.', 'intro 1');
    eq(L.placeholder(1), 'Type your own request for this device…', 'placeholder 1'); eq(L.statusWaiting(1), 'Live AI · 1 device · waiting for your request', 'status 1');
    eq(L.intro(6), 'Live AI is on. Type what you want these 6 devices to do. A real model plans it, and nothing runs until you approve.', 'intro 6');
    eq([L.placeholder(6), L.statusWaiting(6)], ['Type your own request for these 6 devices…', 'Live AI · 6 devices · waiting for your request'], 'home unchanged');
    eq([guardHits(L.intro(1)), guardHits(L.placeholder(1)), guardHits(L.statusWaiting(1))], [[], [], []], 'guards');
  }));
}
