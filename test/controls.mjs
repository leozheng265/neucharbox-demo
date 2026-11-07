// Card controls: which control (bar or switch) a device's tile shows, decided from the device's state.
import { controlFor } from '../js/engine/controls.js';
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
  report('engine · card controls follow the device state', p);
  // Task 2 adds the per-scene table below this line.
}
