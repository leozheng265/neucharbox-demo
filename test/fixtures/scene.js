// A tiny scene for the engine's own checks (test/run.mjs): three devices and one request with what-ifs.
//   lamp  used, authored scenario at 'lit' (with its own intro)
//   pump  used, authored scenario at 'watering': a fail with faultText inside a parallel, an ask whose second option
//         fails the pump again (a bare fail keeps the note), and a later faultNote rewrite
//   fan   not used by the request: the engine's generic scenario at genericAt ('watering')
//   dip   a special (no device fails): an alert from an fn step
// The clean run has a plan Edit (plan.dim), an ask before the second failPoint (how much water) and one after it
// (keep the lamp on), so a generic what-if's fast-forward uses the rest of the recorded answers.
const say = (text) => ({ fn: (c) => c.say(typeof text === 'function' ? text(c.store) : text) });

export default {
  id: 'fixture',
  title: 'Fixture room',
  startHour: 9,
  camera: { position: [2, 2, 2], target: [0, 0.5, 0], fov: 42 },
  deviceOrder: ['lamp', 'pump', 'fan'],
  devices: {
    lamp: { icon: 'lamp', name: 'Desk lamp', ref: 'the desk lamp', initial: { on: false, level: 0 }, format: (s) => (s.on ? `on · ${Math.round(s.level * 100)}%` : 'off'), active: (s) => s.on, faultText: 'not responding' },
    pump: { icon: 'pump', name: 'Water pump', ref: 'the water pump', initial: { running: false, litres: 0 }, format: (s) => (s.running ? 'running' : `idle · ${s.litres} l`), faultText: 'no answer' },
    fan:  { icon: 'generic', name: 'Ceiling fan', ref: 'the ceiling fan', initial: { on: false }, format: (s) => (s.on ? 'on' : 'off'), faultText: 'off the network' },
  },

  // The room: one tappable group per device, and a ping when the pump starts, which a quiet replay must not ring.
  build({ R, THREE, store, quiet }) {
    const isQuiet = typeof quiet === 'function' ? quiet : () => false;
    const parts = {};
    for (const id of ['lamp', 'pump', 'fan']) { const g = new THREE.Group(); R.scene.add(g); R.addPickable(g, id); parts[id] = g; }
    store.subscribe((st, path, v) => { if (isQuiet()) return; if (path === 'pump.running' && v) R.ping('pump', 'Water pump · running'); });
    return {
      focus() {},
      update(s) { parts.lamp.scale.setScalar(0.5 + s.lamp.level); parts.pump.visible = s.pump.status !== 'offline'; parts.fan.rotation.y += s.fan.on ? 0.1 : 0; },
    };
  },

  prompts: [
    {
      chip: 'Light the desk and water the plant.',
      keywords: ['light', 'desk', 'water', 'plant'],
      expect: { 'lamp.on': true, 'pump.running': false, 'pump.status': 'online' },
      genericAt: 'watering',
      steps: [
        { beat: 'plan' },
        { say: 'I will use the desk lamp and the water pump.' },
        { status: 'Waiting for your approval' },
        { plan: { intro: 'Plan:', steps: [
          { text: 'Desk lamp on at 80%', alt: { text: 'Desk lamp on at 40%', apply: [{ set: 'plan.dim', to: true }] } },
          { text: 'Water the plant, then ask about the lamp' },
        ] } },
        { beat: 'run' },
        { fn: ({ store, tween }) => { store.set('lamp.on', true); return tween('lamp.level', store.get('plan.dim') ? 0.4 : 0.8, 600); } },
        { status: (st) => `Desk lamp at ${Math.round(st.get('lamp.level') * 100)}%` },
        { failPoint: 'lit' },
        { ask: { intro: 'How much water?', options: [{ label: 'One litre', primary: true, apply: [{ set: 'plan.litres', to: 1 }] }, { label: 'Three litres', apply: [{ set: 'plan.litres', to: 3 }] }] } },
        { failPoint: 'watering' },
        { set: 'pump.running', to: true, label: 'Water pump → running' },
        { fn: ({ store, tween }) => tween('pump.litres', store.get('plan.litres'), 800) },
        { set: 'pump.running', to: false, label: 'Water pump → idle' },
        say((st) => `Watered: ${st.get('pump.litres')} l.`),
        { ask: { intro: 'Keep the desk lamp on?', options: [{ label: 'Keep it on', primary: true, apply: [] }, { label: 'Dim it', apply: [{ set: 'lamp.level', to: 0.2 }] }] } },
        { end: { headline: 'Lit and watered.', body: 'The desk lamp came on and the plant got its water.' } },
      ],
      whatIf: {
        lamp: { at: 'lit', intro: 'Replaying this request. This time the desk lamp goes dark right after it comes on.', steps: [
          { status: 'Checking the desk lamp' }, { wait: 300 },
          { fail: 'lamp', faultText: 'went dark', say: 'The desk lamp went dark and stopped answering.', title: '⚠ Lamp down' },
          { set: 'lamp.level', to: 0 },
          say('I will not keep switching a lamp that is not answering. The watering goes ahead.'),
          { replan: { intro: 'Re-planned around the lamp:', changes: ['Desk lamp flagged', 'Watering as planned'], needsYou: 'Check the bulb.' } },
          { status: 'Watering · desk lamp flagged' }, { wait: 300 },
          { end: { headline: 'A dark lamp, a watered plant.', body: 'The lamp failed, and the watering did not need it. NeuCharBox flagged the lamp and carried on.' } },
        ] },
        pump: { at: 'watering', steps: [
          { status: 'Watering' }, { wait: 300 },
          { parallel: [{ set: 'pump.running', to: true }, { fail: 'pump', faultText: 'stalled', say: 'The water pump stalled as it started.', title: '⚠ Pump stalled' }] },
          { set: 'pump.running', to: false },
          { ask: { intro: 'Try the pump once more?', options: [
            { label: 'Leave it off', primary: true, apply: [say('Leaving it off.')] },
            { label: 'Try once more', apply: [{ fail: 'pump' }, say('It stalled again. Leaving it off.')] },
          ] } },
          { fn: ({ store }) => store.set('pump.faultNote', 'stalled · left off') },
          { replan: { intro: 'Watering paused:', changes: ['Pump flagged, no retries'], needsYou: 'Check the hose.' } },
          { wait: 300 },
          { end: { headline: 'The pump stalled, so it stopped.', body: 'NeuCharBox saw the stall and left the pump off instead of forcing it.' } },
        ] },
        dip: { label: 'The power dips', ask: 'What if the power dips?', at: 'watering', steps: [
          { status: 'Power dip' },
          { fn: async ({ chat, sleep, store }) => { chat.alert(`The power dipped with ${store.get('plan.litres')} l planned.`, '⚠ Power dip'); await sleep(300); } },
          say('Everything came back within a second. Watering as planned.'),
          { set: 'pump.running', to: true }, { fn: ({ store, tween }) => tween('pump.litres', store.get('plan.litres'), 400) }, { set: 'pump.running', to: false },
          { wait: 300 },
          { end: { headline: 'A dip, then the plan.', body: 'The power came back, so NeuCharBox carried on as planned.' } },
        ] },
      },
    },
  ],
};
