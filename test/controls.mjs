// Card controls: which control (bar or switch) a device's tile shows, decided from the device's state.
import { controlFor, editsFor } from '../js/engine/controls.js';
export function controlChecks({ report, scenes }) {
  const p = [];
  const eq = (got, want, what) => { if (JSON.stringify(got) !== JSON.stringify(want)) p.push(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
  eq(controlFor({}, { on: true, brightness: 0.2 }), { kind: 'bar', field: 'brightness', value: 0.2 }, 'bar beats switch');
  eq(controlFor({}, { closed: 0.5, open: 1 }), { kind: 'bar', field: 'closed', value: 0.5 }, 'bar field order');
  eq(controlFor({}, { running: true, armed: false }), { kind: 'switch', field: 'armed', on: false }, 'switch field order');
  eq(controlFor({}, { moisture: 34 }), null, 'no known field → text only');
  eq(controlFor({}, { brightness: 1.4 }), { kind: 'bar', field: 'brightness', value: 1 }, 'clamp high');
  eq(controlFor({}, { brightness: -0.1 }), { kind: 'bar', field: 'brightness', value: 0 }, 'clamp low');
  eq(controlFor({}, { brightness: null }), { kind: 'bar', field: 'brightness', value: 0 }, 'null → 0');
  eq(controlFor({}, { brightness: NaN }), { kind: 'bar', field: 'brightness', value: 0 }, 'NaN → 0');
  eq(controlFor({}, undefined), null, 'no slice');
  eq(controlFor({ control: false }, { on: true }), null, 'override off');
  eq(controlFor({ control: { kind: 'bar', field: 'target', min: 10, max: 28 } }, { target: 19 }), { kind: 'bar', field: 'target', value: 0.5 }, 'ranged bar');
  eq(controlFor({ control: { kind: 'switch', field: 'open' } }, { open: 0.7 }), { kind: 'switch', field: 'open', on: true }, 'switch override');
  eq(controlFor({ control: (s) => ({ kind: 'switch', field: 'muted', on: !s.muted }) }, { muted: true }), { kind: 'switch', field: 'muted', on: false }, 'function override');
  const E = (id, f) => { const d = scenes.home?.devices[id]; return d ? editsFor(id, d, f) : null; };
  if (scenes.home) {
    const sum = (id, f) => (E(id, f) || []).map((e) => `${e.kind}:${e.path}:${e.value}:${e.min}-${e.max}/${e.step}x${e.scale}${e.unit}:${e.label}`);
    eq(sum('lamp', { brightness: 0.3 }), ['slider:lamp.brightness:0.3:0-1/0.01x100%:undefined'], 'lamp edits');
    eq(sum('blinds', { closed: 1 }), ['slider:blinds.closed:1:0-1/0.01x100%:undefined'], 'blinds edits');
    eq(sum('soil', { moisture: 34 }), ['slider:soil.moisture:34:0-100/1x1%:undefined'], 'soil edits');
    eq(sum('pump', { running: true }), ['switch:pump.running:true:undefined-undefined/undefinedx1undefined:undefined'], 'pump edits');
    eq(sum('camera', { armed: true, motion: false }).map((x) => x.split(':').slice(0, 3).join(':')), ['switch:camera.armed:true', 'switch:camera.motion:false'], 'camera has 2 entries');
    eq((E('camera', { armed: true, motion: false }) || []).map((e) => e.label), ['armed', 'motion'], 'camera labels');
    eq(sum('thermostat', { current: 21.4, target: 21 }), ['slider:thermostat.current:21.4:5-35/0.5x1°C:now', 'slider:thermostat.target:21:10-28/0.5x1°C:set'], 'thermostat edits');
    eq(E('lamp', undefined), [], 'no slice'); eq(E('lamp', 'x'), [], 'slice not an object');
    eq(editsFor('x', {}, { a: 1 }), [], 'no edit array');
  }
  report('engine · card controls follow the device state', p);
  const WANT = {
    home:      { lamp: 'bar:brightness', blinds: 'bar:closed', soil: '—', pump: 'switch:running', camera: 'switch:armed', thermostat: 'bar:target' },
    lab:       { laser: 'switch:shutter', beamcam: '—', m1: '—', m2: '—', meter: '—', stage: '—' },
    elder:     { mat: 'switch:pressed', door: 'switch:open', motion: 'switch:active', kettle: 'switch:on', night: 'bar:brightness', hall: 'bar:brightness' },
    warehouse: { c1: 'bar:speed', c2: 'bar:speed', c3: 'bar:speed', scanner: 'switch:armed', gate: '—', agvA: '—', agvB: '—', dock: '—' },
    creator:   { keylight: 'bar:brightness', cam: 'switch:on', mic: 'switch:muted', capture: '—', overlay: '—', onair: 'switch:on', strip: 'bar:brightness' },
  };
  const VALUES = {
    home: [['thermostat', { target: 19, current: 19 }, 'value', 0.5]],
    warehouse: [['c1', { running: true, speed: 0.5 }, 'value', 1], ['c1', { running: true, speed: 0.2 }, 'value', 0.4]],
    elder: [['door', { open: 0.3 }, 'on', false], ['door', { open: 0.8 }, 'on', true]],
    lab: [['laser', { shutter: 'open' }, 'on', true], ['laser', { shutter: 'closed' }, 'on', false]],
    creator: [['mic', { muted: false }, 'on', true], ['mic', { muted: true }, 'on', false]],
  };
  for (const [id, want] of Object.entries(WANT)) {
    const sc = scenes[id]; if (!sc) continue;
    const q = [], devs = sc.devices;
    const name = (c) => (c ? `${c.kind}:${c.field}` : '—');
    for (const d of sc.deviceOrder) {
      if (!(d in want)) { q.push(`${d} is in the scene but not in the table`); continue; }
      const got = name(controlFor(devs[d], devs[d].initial));
      if (got !== want[d]) q.push(`${id} ${d}: got ${got}, want ${want[d]}`);
    }
    for (const d of Object.keys(want)) if (!sc.deviceOrder.includes(d)) q.push(`${d} is in the table but not in the scene`);
    for (const [d, slice, key, w] of VALUES[id] || []) {
      const c = controlFor(devs[d], slice);
      if (!c || c[key] !== w) q.push(`${id} ${d} ${JSON.stringify(slice)}: got ${c && c[key]}, want ${w}`);
    }
    report(`${id} · each device card shows the right control`, q);
  }
}
