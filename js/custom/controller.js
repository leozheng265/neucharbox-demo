// The custom scene's mode controller: gate → build → run. A pure module (no DOM): the page gives it storage, a
// makeLive(scene, devices) that builds a createLive with sessionExtra: () => ({ devices }), and a small ui sink.
// Moving or rotating devices changes nothing on the server; adding or removing starts a fresh live session at Done.
import { addDevice, removeDevice, moveDevice, moveHub, rotateDevice, clearDevices, devicesForSession, sameDevices, loadLayout, saveLayout } from './layout.js';
import { sceneFor } from './scene.js';
import { DEVICE_UI } from './devices/index.js';

export function createCustomController({ storage, makeLive, ui }) {
  let layout = loadLayout(storage), mode = 'gate', live = null, liveLayout = null;

  const changed = () => !!live && !sameDevices(layout, liveLayout);
  const setMode = (m) => { mode = m; ui.mode(m); };
  // A layout change: remember it, show it, and say once that the conversation will restart.
  function commit(next, { devices = false } = {}) {
    const was = changed();
    layout = next; saveLayout(storage, layout); ui.layout(layout);
    if (devices && !was && changed()) ui.notice('changed');
  }
  // Building waits for a request to end; an access card waiting for a code is not one (the room stays as built).
  const canBuild = () => !(live && live.active && !['idle', 'off', 'access'].includes(live.phase));

  return {
    get mode() { return mode; },
    get layout() { return layout; },
    get live() { return live; },
    get canBuild() { return canBuild(); },
    get changedSinceRun() { return changed(); },
    add(type) {
      const r = addDevice(layout, type, DEVICE_UI[type]?.size);
      if (r.error === 'full') { ui.notice('full'); return null; }
      if (r.error) return null;
      commit(r.layout, { devices: true });
      return r.id;
    },
    remove(id) { if (layout.devices.some((d) => d.id === id)) commit(removeDevice(layout, id), { devices: true }); },
    move(id, pos) {
      const d = layout.devices.find((x) => x.id === id);
      if (d) commit(moveDevice(layout, id, pos, DEVICE_UI[d.type]?.size));
    },
    moveHub(pos) { commit(moveHub(layout, pos)); },
    rotate(id) { commit(rotateDevice(layout, id)); },
    clear() { if (layout.devices.length) commit(clearDevices(layout), { devices: true }); },
    gated() { if (mode === 'gate') setMode('build'); },
    async done() {
      if (!layout.devices.length) return;
      if (live && live.active && sameDevices(layout, liveLayout)) { setMode('run'); return; }
      live?.close(); // its stream ends before the new session is made
      const next = makeLive(sceneFor(layout), devicesForSession(layout));
      live = next; liveLayout = layout;
      setMode('run');
      await next.open();
    },
    toBuild() {
      if (!canBuild()) { ui.notice('buildBusy'); return false; }
      setMode('build');
      return true;
    },
    teardown() { live?.close(); live = null; liveLayout = null; },
  };
}
