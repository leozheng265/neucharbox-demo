// A virtual clock for real-time runs in Node (test/run.mjs, test/build.mjs). While virtualTime(fn) runs, the globals
// setTimeout / clearTimeout / setInterval / clearInterval and performance.now are replaced, and time moves on from
// one event to the next (a timer falling due, or the next frame, 60 a second), so a request that takes a minute at
// normal speed plays in a fraction of a second, the same way every time. onFrame(now) runs on every frame: tick the
// store's tweens there, and update a room. Pending promise callbacks run between events.
const realImmediate = globalThis.setImmediate;
const flush = () => new Promise((r) => realImmediate(r)); // every pending promise callback runs before this resolves

export async function virtualTime(fn, { fps = 60, onFrame = null, limitMs = 15 * 60e3 } = {}) {
  const real = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval };
  const perf = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  let now = 0, seq = 0, done = false, error = null, result;
  const timers = new Map(); // id → { at, f, args, every }
  globalThis.setTimeout = (f, ms = 0, ...args) => { const id = ++seq; timers.set(id, { at: now + Math.max(0, Number(ms) || 0), f, args }); return id; };
  globalThis.clearTimeout = (id) => { timers.delete(id); };
  globalThis.setInterval = (f, ms = 0, ...args) => { const id = ++seq, every = Math.max(1, Number(ms) || 0); timers.set(id, { at: now + every, f, args, every }); return id; };
  globalThis.clearInterval = (id) => { timers.delete(id); };
  Object.defineProperty(globalThis, 'performance', { value: { now: () => now, timeOrigin: 0, mark() {}, measure() {} }, configurable: true, writable: true });
  try {
    Promise.resolve().then(fn).then((v) => { result = v; }, (e) => { error = e; }).finally(() => { done = true; });
    const frame = 1000 / fps; let nextFrame = frame;
    await flush();
    while (!done && now < limitMs) {
      let next = nextFrame; for (const t of timers.values()) if (t.at < next) next = t.at;
      now = next;
      for (;;) { // the timers due now, earliest (then oldest) first
        let id = null, due = null; for (const [i, t] of timers) if (t.at <= now && (!due || t.at < due.at)) { id = i; due = t; }
        if (!due) break;
        if (due.every) due.at += due.every; else timers.delete(id);
        try { due.f(...due.args); } catch (e) { error ??= e; }
        await flush();
      }
      if (now >= nextFrame) { nextFrame += frame; try { onFrame?.(now); } catch (e) { error ??= e; } await flush(); }
    }
  } finally {
    Object.assign(globalThis, real);
    if (perf) Object.defineProperty(globalThis, 'performance', perf); else delete globalThis.performance;
  }
  if (error) throw error;
  if (!done) throw new Error(`still running after ${Math.round(limitMs / 1000)} s of virtual time (a card nobody answers?)`);
  return result;
}
