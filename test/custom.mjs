// Check 19: the custom-room catalog copy and layout model (js/custom/catalog.js, layout.js, tools/sync-catalog.mjs).
//   customChecks({ report, guardHits }) runs the checks below; pure Node, no DOM.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
}
