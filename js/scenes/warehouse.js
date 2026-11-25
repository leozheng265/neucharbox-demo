// Scene 4 — Warehouse (illustrative). Proves: a line that runs as planned, and handles a unit dropping out (opt-in what-ifs).
// The room's kit follows the custom-room remodels (js/custom/devices/warehouse.js); kit.js imports nothing, so Node builds it.
import { mergeMeshes, canvasTex } from '../custom/devices/kit.js';

const TAU = Math.PI * 2, FONT = 'Inter, "Segoe UI", sans-serif';
const rng = (seed) => { let s = seed >>> 0 || 1; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }; // seeded: the room is the same every visit
// Place a loaded model by its bounding box (js/engine/assets.js place()), inlined as in home.js.
function placeModel(THREE, obj, { x = 0, y = 0, z = 0, rotY = 0, s = 1 } = {}) {
  obj.rotation.y = rotY; obj.scale.setScalar(s); obj.position.set(0, 0, 0); obj.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(obj), c = b.getCenter(new THREE.Vector3());
  obj.position.set(x - c.x, y - b.min.y, z - c.z); obj.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(obj);
}

// Cart loop in front of the line, shared by the room and the scripts. u = 0 is alongside the end of C1 (pick-up),
// u = 1 alongside C3 (drop-off); 1 < u < 2 is the way back on the return lane, and u = 2 is u = 0 again.
// Carts only pass each other on different lanes, so they never drive through one another.
const X_PICK = -2.35, X_DROP = 2.6, Z_IN = 1.18, Z_OUT = 1.95;
const SHIFT = Z_OUT - Z_IN, RUN = X_DROP - X_PICK, BACK = RUN + 2 * SHIFT;
const uOut = (x) => (x - X_PICK) / RUN;                 // u of a spot on the belt-side lane
const uBack = (x) => 1 + (SHIFT + X_DROP - x) / BACK;   // u of a spot on the return lane
const HOME = { agvA: -3.0, agvB: -1.4 }, HOME_Z = 2.85;  // the carts' bays (x), off the loop beside the desk
// Cart legs are timed from their length. A leg eases in and out, so it peaks at twice its average speed: d metres take
// 2·d / V_CART seconds and never go faster than V_CART. The room runs its belts 2.2× faster than labelled (SPEED_K), so
// 3.5 m/s here is a cart at about 1.6 m/s beside belts at 0.5 m/s.
const V_CART = 3.5, legMs = (d) => Math.max(600, Math.round((2000 * d) / V_CART));
const backTo = (x) => SHIFT + X_DROP - x;              // metres from the drop-off back to x on the return lane
function cartAt(u, v) {
  if (u <= 1) return v.set(X_PICK + RUN * Math.max(0, u), 0, Z_IN);
  const s = (Math.min(u, 2) - 1) * BACK;
  if (s < SHIFT) return v.set(X_DROP, 0, Z_IN + s);
  if (s < SHIFT + RUN) return v.set(X_DROP - (s - SHIFT), 0, Z_OUT);
  return v.set(X_PICK, 0, Z_OUT - (s - SHIFT - RUN));
}
// A cart's state: 'moving' on the loop, 'parking' while it turns off the return lane into its bay (the tile says parked,
// and the beacon goes steady green, only once it is in), 'parked', or 'stopped' where the stop found it.
const driving = (s) => s.state === 'moving' || s.state === 'parking';
const cartText = (s) => (s.state === 'moving' ? (s.load ? 'moving · loaded' : 'moving · empty') : s.state);
// A belt reads as moving from 0.05 m/s, as its beacon in the room does (blue): the tail of a ramp down, or the start of
// a ramp up, would otherwise show "running · 0.0 m/s".
const beltMoving = (s) => s.running && s.speed > 0.05;
const beltText = (s) => (beltMoving(s) ? `running · ${s.speed.toFixed(1)} m/s` : 'stopped');
// The Divert prompt's end card depends on the Edit the visitor chose; the step before `end` fills it in.
const DIVERT_SAFE = { headline: 'It stopped trusting the scanner, and said so.', body: 'A rule you approved decided what happens when the scanner\'s word isn\'t good enough. NeuCharBox took the safe option, not the fast one, and told you what to check.' };
const DIVERT_HELD = { headline: 'It held the parcel instead of guessing.', body: 'You chose to stop on an unreadable label. NeuCharBox stopped C1 at the first one, flagged the arch for slow reads, and told you exactly which parcel needs a person.' };
const DIVERT_END = { ...DIVERT_SAFE };

// The parcels live in the room, and the scanner and dock tiles count what the room does: a parcel is scanned when it
// crosses the red beam while the arch is armed, and docked when it goes through the door. build() registers the
// room's line here; the tests run the scripts without a room, and then every step falls back to scripted numbers.
const lineOf = new WeakMap(); // store → line
const SX = -2.7;              // the scanner arch, over the end of C1
const GATE_CALL_X = -0.1;     // a parcel for lane B calls the gate about a metre before it gets there
function sync(store, line) {
  if (store.get('scanner.count') !== line.scanned) store.set('scanner.count', line.scanned);
  const d = Math.min(line.docked, store.get('dock.target') || Infinity); if (store.get('dock.parcels') !== d) store.set('dock.parcels', d);
}
// Keeps the tiles on the room while the line moves: one loop per room, until the room is reset for another request
// or the visitor skips ahead (the script then sets the skipped-to state, and the next wait starts the loop again).
// The line keeps the script's ctx, so the room can start the loop again itself once a quiet replay is over (update()).
function watch(ctx, line = lineOf.get(ctx.store)) {
  if (line) line.ctx = ctx;
  if (!line || line.watching || ctx.fast) return;
  const gen = line.gen; line.watching = true;
  (async () => { while (!ctx.fast && line.gen === gen) { sync(ctx.store, line); await ctx.sleep(60); } if (line.gen === gen) line.watching = false; })();
}
// Waits on the script's clock (so ?speed= and skips apply) until the room says so. False when there is no room
// (tests) or the visitor skipped ahead: the caller then sets the scripted state itself.
async function until(ctx, test, maxMs = 40000) {
  const line = lineOf.get(ctx.store); if (!line) return false;
  const gen = line.gen; watch(ctx, line);
  for (let t = 0; t < maxMs; t += 50) { if (ctx.fast || line.gen !== gen) return false; if (test(line)) { sync(ctx.store, line); return true; } await ctx.sleep(50); }
  return false;
}
// A skip (or a headless run) jumps to n parcels scanned: the room lays the line out to match, the tiles follow it.
// `past`: how far the n-th is past the beam; `total`: the most parcels in all; `lag`: how far each parcel sent down lane
// B by a gate swing held the ones behind it back (GATE_LAG). With no room (the tests), the dock count is what lay()
// gives for one such swing at most: parcel k is SX + past + (n − k) m along (plus `lag` ahead of a swing), and the door
// is 9.85 m past the beam: n − 10 for the default past (0.05), as before.
function jump(store, n, past = 0.05, total = Infinity, lag = 0) { const line = lineOf.get(store); if (line) { line.lay(n, past, total, lag); sync(store, line); } else { store.set('scanner.count', n); store.set('dock.parcels', Math.min(store.get('dock.target') || Infinity, Math.max(0, n - Math.floor(9.85 - past - lag) - 1))); } }
// A gate swing for one parcel holds the parcels behind it at C2's end stop while the arm goes over and back: they come
// out of it this far behind where they would have been (measured in the room at 30 to 144 fps: 0.98-0.99 m).
const GATE_LAG = 0.99;
// The Divert line after a skip: every per-parcel swing so far has held the rest back by GATE_LAG.
const jumpSorted = (store, n, past = 0.05) => jump(store, n, past, Infinity, GATE_LAG);
// Lane B for one parcel: the gate swings as that parcel comes up to it, and back once it is in lane B.
async function divert(ctx, n, stick = false) {
  const { store, tween, status } = ctx; const at = (l) => l.find(n);
  await until(ctx, (l) => { const p = at(l); return !p || p.lane !== 'main' || p.x >= GATE_CALL_X; }, 15000);
  store.set('gate.lane', 'B'); status(`Gate → lane B · parcel ${n}`); await tween('gate.pos', 1, 700);
  await until(ctx, (l) => { const p = at(l); return !p || p.lane === 'wait' || (p.lane === 'B' && p.b > 0.6) || (p.lane === 'main' && p.x > 1.8); }, 15000);
  if (ctx.fast) lineOf.get(store)?.diverted(n); // skipped: parcel n is in the tote all the same, not left on the line
  if (stick) { store.set('gate.stuck', true); status('Gate → lane A'); return; } // the command back to A goes out; the arm, and its sensor, stay on B
  store.set('gate.lane', 'A'); status('Gate → lane A'); await tween('gate.pos', 0, 700);
}

const HOLD = { wait: 2000 };  // before every scenario's end card, so the re-plan card is read first
// A scenario's first step: the tiles follow the room again, and the status line replaces "Replaying this request...".
// `pre` runs first in the same tick, for a fault that must be in place before the room's next frame.
const lead = (text, pre) => ({ fn: (ctx) => { pre?.(ctx.store); watch(ctx); ctx.status(text); } });
// A re-plan card whose lines depend on the store (a plan Edit, or the tiles' counts). Silent in a quiet replay.
const replanWith = (spec) => ({ fn: async ({ chat, store, sleep }) => { chat.replan(spec(store)); await sleep(700); } });
// Ramps conveyors to 0 together, then marks them stopped.
const halt = (ids, ms = 1200) => ({ fn: async ({ store, tween }) => { await Promise.all(ids.map((k) => tween(`${k}.speed`, 0, ms))); for (const k of ids) store.set(`${k}.running`, false); } });
// Waits until the door has counted n in. Skipped, or with no room: the first n are delivered (off the belts, counted).
async function toDock(ctx, n, maxMs = 15000) {
  if (await until(ctx, (l) => l.docked >= n, maxMs)) return;
  const line = lineOf.get(ctx.store); if (line) { line.deliver(n); sync(ctx.store, line); } else ctx.store.set('dock.parcels', n);
}
// Closing dock 2: the light turns red at once; the tile reads "closing" until the door is down (1.2 s), then "closed".
const closeDock = (label) => [{ set: 'dock.shut', to: false }, { set: 'dock.light', to: 'red', label }, { wait: 1300 }, { set: 'dock.shut', to: true }];
// What the tiles say: n scanned, d at the dock (lines built from them stay right after a beat skip).
const counts = (store) => ({ n: Math.round(store.get('scanner.count')), d: Math.round(store.get('dock.parcels')) });

// ── Move 40. The clean run is these pieces with failure points between them; scenarios reuse them.
const P0_START = [
  { set: 'c1.running', to: true }, { tween: 'c1.speed', to: 0.5, ms: 800, label: 'C1 → 0.5 m/s' }, { wait: 400 },
  { set: 'c2.running', to: true }, { tween: 'c2.speed', to: 0.5, ms: 800, label: 'C2 → 0.5 m/s' }, { wait: 400 },
  { set: 'c3.running', to: true }, { tween: 'c3.speed', to: 0.5, ms: 800, label: 'C3 → 0.5 m/s' },
  { say: 'Scanner armed. Line running.' },
];
// Dock 2 opens once the first parcel is on C3 (with the "now" Edit it opened at the start of the run).
const P0_OPEN = { fn: async (ctx) => { if (ctx.store.get('plan.earlyGreen')) return; await until(ctx, (l) => l.onC3()); ctx.store.set('dock.light', 'green'); ctx.status('Dock 2 → open'); } };
// The progress line as parcel 16 crosses the beam (copy unchanged).
const P0_AT16 = { fn: async (ctx) => {
  const { store, chat } = ctx; let said = false;
  if (await until(ctx, (l) => l.scanned >= 15)) {
    chat.typing(true);
    if (await until(ctx, (l) => l.scanned >= 16)) { chat.typing(false); chat.ncb(`16 scanned, ${store.get('dock.parcels')} at the dock. On pace for 14 minutes.`); said = true; }
    chat.typing(false);
  }
  if (!said) { jump(store, 16); chat.ncb(`16 scanned, ${store.get('dock.parcels')} at the dock. On pace for 14 minutes.`); }
} };
// Four more at full speed, then a time-lapse to 36. Receiving stops sending: the last 4 of the 40 are the only ones
// left before the arch (jump's total).
const P0_TO36 = [
  { fn: async (ctx) => { if (!await until(ctx, (l) => l.scanned >= 20)) jump(ctx.store, 20); } },
  { fn: (ctx) => { ctx.store.set('plan.feedStop', true); jump(ctx.store, 36, 0.05, 40); ctx.status('Time-lapse · parcels 21 to 36'); ctx.chat.ncb('(Time-lapse: parcels 21 to 36 skipped — same pace, each one scanned.)'); } },
];
// The 40th through the arch and off C1 (a skip: 1.2 m past the beam, on C2), then C1 stops behind it.
const P0_TO40 = [
  { fn: async (ctx) => { if (!await until(ctx, (l) => l.scanned >= 40 && l.offC1(40), 15000)) jump(ctx.store, 40, 1.2, 40); } },
  { set: 'c1.running', to: false }, { set: 'c1.speed', to: 0, label: 'C1 stopped · all 40 through the arch' },
  { say: 'All 40 scanned. C1 has stopped behind the last one; C2 and C3 take the rest to dock 2.' },
  // by the end of that line the 33rd has gone through the door (a skip, or a what-if's replay: that layout, 34 to 39 on
  // C3 and the 40th on C2), so a scenario starting here starts where the request played in real time had the line
  { fn: async (ctx) => { if (!await until(ctx, (l) => l.docked >= 33, 8000)) jump(ctx.store, 40, 2.92, 40); } },
];
// All 40 through the door (a skip lays the line out empty, all 40 counted in).
const P0_ALL_IN = [
  { status: 'C2 and C3 taking the last parcels to dock 2' },
  { fn: async (ctx) => { if (!await until(ctx, (l) => l.docked >= 40, 15000)) jump(ctx.store, 40, 10, 40); } },
];
// All 40 in: the belts stop first, then dock 2 closes (the door takes 1.2 s) and the scanner is disarmed.
const P0_HALT = [{ status: 'All 40 in · stopping C2 and C3' }, halt(['c2', 'c3'], 1000), { wait: 300 }];
const P0_CLOSE = [...closeDock('Dock 2 → closed'), { set: 'scanner.armed', to: false, label: 'Line stopped · scanner disarmed' }];
// Scenarios that carry on after their fault: a time-lapse to the end of the run, all 40 in, C1 stopped, then a beat so
// its status line can be read. The line names the first parcel skipped, from the arch's count at that moment.
const P0_LAPSE_TO_END = [{ fn: (ctx) => {
  const { store } = ctx; const from = Math.min(40, Math.round(store.get('scanner.count')) + 1);
  store.set('plan.feedStop', true); jump(store, 40, 10, 40); store.set('c1.running', false); store.set('c1.speed', 0);
  ctx.status('Time-lapse · the rest of the run'); ctx.chat.ncb(`(Time-lapse: parcels ${from} to 40 skipped — same pace, each one scanned and counted in at the door.)`);
} }, { wait: 1200 }];
// Move · gate: the next parcel to reach the gate when it went quiet, noted at the fault (store → parcel number).
const gateCheck = new WeakMap();

// ── Divert. Parcel 10 and parcel 17 are the fragile ones; every other label reads clean.
const P1_TEN = { fn: async (ctx) => { if (!await until(ctx, (l) => l.scanned >= 10)) jumpSorted(ctx.store, 10); ctx.chat.ncb('Parcel 10 — FRAGILE. Gate to lane B for it.'); } };
// Parcel 10 is in lane B and the gate back on A: 14 is 0.59 m past the beam by then, and 1-9 are GATE_LAG further on
// than an even line would have them (a skip, or a what-if's replay, lays that out: 14 scanned, 5 at the dock).
const P1_AT14 = { fn: async (ctx) => { if (!await until(ctx, (l) => l.scanned >= 14)) jumpSorted(ctx.store, 14, 0.59); } };
const P1_SEVENTEEN = { fn: async (ctx) => { if (!await until(ctx, (l) => l.scanned >= 17)) jumpSorted(ctx.store, 17); ctx.chat.ncb('Parcel 17 — FRAGILE. Gate to lane B for it.'); } };
const P1_AT22 = { fn: async (ctx) => { if (!await until(ctx, (l) => l.scanned >= 22)) jumpSorted(ctx.store, 22); } };

// ── Stop. The mid-shift start and the settle are the current steps, unchanged; the stop itself is split into its four
// steps, so a failure point can sit between them.
const P2_MIDSHIFT = { fn: (ctx) => {
  const { store, chat, tween } = ctx;
  for (const k of ['c1', 'c2', 'c3']) { store.set(`${k}.running`, true); store.set(`${k}.speed`, 0.5); }
  store.set('scanner.armed', true); store.set('dock.light', 'green');
  store.set('agvA.u', 0.7); store.set('agvA.load', true); store.set('agvA.state', 'moving');
  store.set('agvB.u', uBack(-0.9)); store.set('agvB.state', 'moving');
  const line = lineOf.get(store); if (line) { line.midShift(26); sync(store, line); watch(ctx, line); } else { store.set('scanner.count', 26); store.set('dock.parcels', 16); }
  chat.ncb('(It\'s mid-shift: belts running at 0.5 m/s, dock 2 open, both carts out.)');
  ctx.status('Mid-shift · belts at 0.5 m/s, dock 2 open, both carts out');
  tween('agvA.u', 0.765, 600); tween('agvB.u', uBack(-1.3), 600); // both moves end within P2_SETTLE, where the stop finds them
} };
const P2_SETTLE = { fn: async (ctx) => { await ctx.sleep(700); if (ctx.fast) jump(ctx.store, 26, 0.82); } };
const STOP_SAY = { fn: (ctx) => { watch(ctx); ctx.chat.ncb('Stopping now. A stop doesn\'t wait for approval — but it does go in a set order, meant to keep carts and parcels from colliding or dropping:'); } };
// 1 · both carts stop where P2_MIDSHIFT's moves left them (A at u 0.765, B beside C2); the snap covers a skip mid-move
const STOP_CARTS = { fn: async (ctx) => {
  const { store, chat, sleep, status } = ctx; const line = lineOf.get(store);
  line?.snap('agvA', 0.765); line?.snap('agvB', uBack(-1.3));
  status('1 · carts'); store.set('agvA.state', 'stopped'); store.set('agvB.state', 'stopped');
  chat.ncb('1 — Carts: stop where they are, brakes on. Both confirmed.');
  await sleep(300);
  // parcel 27 has crossed the beam by now, and 17 the door (a skip, or a what-if's replay: that layout)
  if (!await until(ctx, (l) => l.scanned >= 27, 2000)) jump(store, 27, 0.17);
} };
const STOP_BELTS = { fn: async (ctx) => {
  const { store, chat, tween, status } = ctx;
  status('2 · conveyors'); chat.ncb('2 — Conveyors ramp down C1, C2, C3 together, 2 seconds, so nothing pushes into a stopped belt.');
  await Promise.all(['c1', 'c2', 'c3'].map((k) => tween(`${k}.speed`, 0, 2000)));
  for (const k of ['c1', 'c2', 'c3']) store.set(`${k}.running`, false);
  if (ctx.fast) jump(store, 28, 0.25); // skipped: the line where the stop leaves it when played (28 scanned, 18 docked)
} };
// Step 2 sent without waiting for its ramp: a scenario goes on (and can fault) while the belts slow down.
const STOP_BELTS_NOW = { fn: (ctx) => { STOP_BELTS.fn(ctx); } };
const STOP_SCANNER = { fn: async ({ store, chat, sleep, status }) => { status('3 · scanner'); store.set('scanner.armed', false); chat.ncb('3 — Scanner disarmed, now that nothing is moving through it.'); await sleep(300); } };
// 4 · the door takes 1.2 s: the tile reads "closing" until it is down on its switch
const STOP_DOCK = { fn: async ({ store, chat, sleep, status }) => { status('4 · dock'); store.set('dock.shut', false); store.set('dock.light', 'red'); chat.ncb('4 — Dock 2 closing, light red.'); await sleep(1400); store.set('dock.shut', true); } };

export default {
  id: 'warehouse',
  title: 'Warehouse',
  startHour: 10,
  // Seen from outside the (cut-away) front wall, three-quarter from the left, so the whole line fits: hub desk,
  // receiving, scanner, gate and lane B, the carts, C3 and the dock door with its light.
  camera: { position: [-5.07, 3.8, 8.46], target: [-0.5, 0.8, 1.0], minDistance: 3, maxDistance: 12, azimuth: [-0.66, -0.45], fov: 50, fitAspect: 1.3, panBounds: { x: [-6.5, 6.5], y: [0.3, 3], z: [-4.5, 4.5] } },
  setupIntro: 'A small outbound line — an illustrative setup, not a specific site. Three conveyor sections, a scanner arch, a sorter gate to lane B, two carts, and dock 2. The hub is on the desk. Plug it in to start.',
  askIntro: 'Give the line an instruction. Pick one, or type your own.',
  deviceOrder: ['c1', 'c2', 'c3', 'scanner', 'gate', 'agvA', 'agvB', 'dock'],
  devices: {
    c1:      { icon: 'conveyor', name: 'Conveyor C1', ref: 'conveyor C1', initial: { running: false, speed: 0, slip: false, runOn: false }, format: beltText, active: beltMoving, faultText: 'motor fault', control: { kind: 'bar', field: 'speed', max: 0.5 } }, // full speed is 0.5 m/s
    c2:      { icon: 'conveyor', name: 'Conveyor C2', ref: 'conveyor C2', initial: { running: false, speed: 0, slip: false, runOn: false }, format: beltText, active: beltMoving, faultText: 'motor fault', control: { kind: 'bar', field: 'speed', max: 0.5 } }, // full speed is 0.5 m/s
    c3:      { icon: 'conveyor', name: 'Conveyor C3', ref: 'conveyor C3', initial: { running: false, speed: 0, slip: false, runOn: false }, format: beltText, active: beltMoving, faultText: 'motor fault', control: { kind: 'bar', field: 'speed', max: 0.5 } }, // full speed is 0.5 m/s
    scanner: { icon: 'scanner', name: 'Scanner arch', ref: 'the scanner arch', initial: { armed: false, count: 0, misreads: 0, dark: false }, format: (s) => (!s.armed ? 'idle' : s.misreads ? `${Math.round(s.count)} scanned · ${Math.round(s.misreads)} unreadable` : `armed · ${Math.round(s.count)} scanned`), faultText: 'reads not trusted' },
    gate:    { icon: 'gate', name: 'Sorter gate', ref: 'the sorter gate', initial: { lane: 'A', pos: 0, all: false, stuck: false }, format: (s) => `→ lane ${s.lane}${s.lane === 'B' && s.all ? ' · every parcel' : ''}`, active: (s) => s.lane === 'B', faultText: 'controller offline' },
    agvA:    { icon: 'cart', name: 'Cart A', ref: 'cart A', initial: { state: 'parked', u: 0, load: false, creep: false }, format: cartText, active: driving, faultText: 'off the network' },
    agvB:    { icon: 'cart', name: 'Cart B', ref: 'cart B', initial: { state: 'parked', u: 0, load: false, creep: false }, format: cartText, active: driving, faultText: 'off the network' },
    dock:    { icon: 'dock', name: 'Dock 2', ref: 'dock 2', initial: { light: 'red', parcels: 0, target: 40, stuck: false, shut: true }, format: (s) => { const n = Math.round(s.parcels); return `${s.light === 'green' ? 'open' : s.shut ? 'closed' : 'closing'} · ${n}${s.target ? `/${s.target} parcels` : n === 1 ? ' parcel' : ' parcels'}`; }, faultText: 'door fault' }, // target 0: none (Divert), "1 parcel"
  },

  // Real-world assets (js/engine/assets.js, assets/CREDITS.md). Without them (Node tests, a failed download) the room
  // builds from primitives: the procedural concrete floor, a code-built packing table and supplies shelf.
  assets: {
    models: ['wooden_table_02', 'steel_frame_shelves_03'],
    textures: ['garage_floor', 'painted_plaster_wall'],
  },

  build({ R, P, M, THREE, store, parts, speed = 1, quiet, assets = null }) {
    const isQuiet = typeof quiet === 'function' ? quiet : () => false; // A2: true from a what-if's quiet replay until its first step
    const AST = assets?.models ? assets : null, MOD = (id) => AST?.models[id] || null, TX = (id) => AST?.textures?.[id] || null;
    const pbr = (id, rep, extra = {}) => { const set = TX(id); if (!set) return null; const m = {}; for (const k of ['map', 'normalMap', 'roughnessMap']) if (set[k]) { const t = set[k].clone(); t.repeat.set(...rep); t.needsUpdate = true; m[k] = t; } return new THREE.MeshStandardMaterial({ ...m, roughness: 1, ...extra }); };
    const rnd = rng(17); // the room is the same on every visit
    // Rounded boxes with 1 or 2 segments per corner (about 100 or 300 triangles; P.box's 4 make about 1k). The class comes
    // from P.box itself, as js/custom/devices/warehouse.js does.
    const RBox = (() => { const m = P.box(0.1, 0.1, 0.1, M.steel, 0, 0, 0, 0.01), C = m.geometry.constructor; m.removeFromParent(); m.geometry.dispose(); return C; })();
    const rb = (w, h, d, mat, x, y, z, r, seg = 1) => { const m = new THREE.Mesh(new RBox(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2)), mat); m.position.set(x, y, z); return P.add(m); };
    const merge = (meshes, mat, tint = false) => P.add(mergeMeshes(THREE, meshes, mat, { consume: true, tint }));
    const alongX = (m) => { m.rotation.z = Math.PI / 2; return m; }, alongZ = (m) => { m.rotation.x = Math.PI / 2; return m; };
    const lensMat = (hex) => new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 1.5, roughness: 0.3 }); // a lamp's own lens, driven by setLamp

    // ---- finishes ----
    const paint = (hex, rough = 0.5) => new THREE.MeshPhysicalMaterial({ color: hex, roughness: rough, metalness: 0.15, clearcoat: 0.35, clearcoatRoughness: 0.45 }); // powder coat
    const galv = (map = null) => new THREE.MeshStandardMaterial({ color: map ? 0xFFFFFF : 0xB4BABF, map, metalness: 1, roughness: 0.38 });
    const frameMat = galv(), yellow = paint(0xF2B705, 0.45), graphite = paint(0x3A3F45, 0.5), panel = paint(0xD9DCDE, 0.55), shellMat = paint(0xE4E7E9, 0.45), red = paint(0xC8261E, 0.35), greenBtn = paint(0x2E9E58, 0.4);
    const tapeMat = new THREE.MeshStandardMaterial({ color: 0xD8D5CB, roughness: 0.85 }); // off-white and matte, so it doesn't bloom under the ceiling lights
    // ---- canvas textures (detail drawn, not modelled) ----
    // A dark PVC belt with a fine weave and a lighter splice stripe every 10 cm along u (z for `alongZ`): the offset scrolls it.
    const beltTex = (len, alongZ = false) => {
      const t = canvasTex(THREE, (g, w, h) => {
        g.fillStyle = '#272B2F'; g.fillRect(0, 0, w, h);
        g.fillStyle = 'rgba(255,255,255,0.05)'; for (let y = 0; y < h; y += 4) for (let x = (y / 2) % 4; x < w; x += 4) g.fillRect(x, y, 2, 1);
        if (alongZ) { g.fillStyle = '#3C434A'; g.fillRect(0, 0, w, 9); g.fillStyle = '#1B1E21'; g.fillRect(0, 9, w, 3); } else { g.fillStyle = '#3C434A'; g.fillRect(0, 0, 9, h); g.fillStyle = '#1B1E21'; g.fillRect(9, 0, 3, h); }
      });
      if (alongZ) t.repeat.set(1, len / 0.1); else t.repeat.set(len / 0.1, 1); t.anisotropy = 8;
      return t;
    };
    const hazardTex = (rx, ry) => { const t = canvasTex(THREE, (g, w, h) => { g.fillStyle = '#F2B705'; g.fillRect(0, 0, w, h); g.fillStyle = '#1C1C1C'; for (let i = -2; i < 2; i++) { g.beginPath(); g.moveTo(i * w, h); g.lineTo(i * w + w / 2, h); g.lineTo(i * w + w * 1.5, 0); g.lineTo(i * w + w, 0); g.closePath(); g.fill(); } }); t.repeat.set(rx, ry); return t; };
    const hazMat = (rx, ry) => new THREE.MeshStandardMaterial({ map: hazardTex(rx, ry), roughness: 0.55 });
    // a side channel's face: brushed galvanised steel with a roller-axle nut every 15 cm
    const sideMat = (len) => { const t = canvasTex(THREE, (g, w, h) => { g.fillStyle = '#B9BFC4'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(0,0,0,0.06)'; for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1); g.fillStyle = '#7B8288'; g.beginPath(); g.arc(w / 2, h * 0.3, 6, 0, TAU); g.fill(); g.fillStyle = '#D9DDE0'; g.beginPath(); g.arc(w / 2 - 1, h * 0.3 - 1, 3, 0, TAU); g.fill(); }); t.repeat.set(len / 0.15, 1); return galv(t); };
    const slotTex = (horizontal) => { const t = canvasTex(THREE, (g, w, h) => { g.fillStyle = '#C3C8CD'; g.fillRect(0, 0, w, h); g.fillStyle = '#3E444A'; g.fillRect(w / 2 - 6, 0, 12, h); g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(w / 2 - 8, 0, 2, h); g.fillRect(w / 2 + 6, 0, 2, h); }); if (horizontal) { t.center.set(0.5, 0.5); t.rotation = Math.PI / 2; } return t; };
    const finTex = () => { const t = canvasTex(THREE, (g, w, h) => { g.fillStyle = '#4A5057'; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 8) { g.fillStyle = '#2A2E33'; g.fillRect(x, 0, 3, h); g.fillStyle = '#636A72'; g.fillRect(x + 3, 0, 1, h); } }); t.repeat.set(3, 1); return t; };
    // Kraft board: fibre specks and a darker rim where the faces meet (each face of a rounded box maps the whole canvas).
    const kraftT = canvasTex(THREE, (g, w, h) => {
      g.fillStyle = '#CDA778'; g.fillRect(0, 0, w, h);
      const r = rng(5); for (let i = 0; i < 2400; i++) { g.fillStyle = r() < 0.55 ? `rgba(96,64,32,${0.05 + r() * 0.08})` : `rgba(255,240,214,${0.04 + r() * 0.06})`; g.fillRect(r() * w, r() * h, 1 + r() * 3, 1); }
      for (let k = 0; k < 9; k++) { g.strokeStyle = `rgba(78,50,24,${0.06 - k * 0.006})`; g.lineWidth = 3; g.strokeRect(k * 3 + 1.5, k * 3 + 1.5, w - k * 6 - 3, h - k * 6 - 3); }
    }, 256, 256); kraftT.anisotropy = 8;
    const kraft = (hex) => new THREE.MeshStandardMaterial({ map: kraftT, color: hex, roughness: 0.92 });
    const KRAFT = [0xFFFFFF, 0xE9D7C2, 0xD9C0A0].map(kraft);
    // A shipping label: address lines, a dock code and a barcode, on matte white paper.
    const labelT = canvasTex(THREE, (g, w, h) => {
      const r = rng(9); g.fillStyle = '#F6F5F0'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#1E2226'; g.font = `bold 22px ${FONT}`; g.textBaseline = 'top'; g.fillText('SHIP TO', 12, 10);
      for (let i = 0; i < 4; i++) g.fillRect(12, 42 + i * 14, 70 + r() * 80, 6);
      g.fillRect(w - 62, 10, 50, 50); g.fillStyle = '#F6F5F0'; g.font = `bold 28px ${FONT}`; g.fillText('D2', w - 56, 20);
      g.fillStyle = '#1E2226'; for (let x = 12; x < w - 12;) { const bw = 1 + Math.floor(r() * 4); g.fillRect(x, 108, bw, 50); x += bw + 1 + Math.floor(r() * 3); }
      g.fillRect(0, 100, w, 2);
    }, 256, 176); labelT.anisotropy = 8;
    const labelMat = new THREE.MeshStandardMaterial({ map: labelT, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 });
    const labelGeo = new THREE.PlaneGeometry(1, 1);
    // A carton (w × h × d centred at x, y, z): kraft, slightly rounded, a tape strip along its top and a label on top or in front.
    function carton(w, h, d, mat, x, y, z, { tape = true, label = 'top' } = {}) {
      const m = rb(w, h, d, mat, x, y, z, Math.min(0.012, w * 0.04), 1);
      if (tape) { const t = new THREE.Mesh(new THREE.BoxGeometry(Math.min(0.06, w * 0.2), 0.002, d + 0.002), tapeMat); t.position.y = h / 2 + 0.0005; m.add(t); }
      if (label) {
        const l = new THREE.Mesh(labelGeo, labelMat), lw = Math.min(0.15, w * 0.3);
        if (label === 'top') { l.scale.set(lw, lw * 0.69, 1); l.rotation.x = -Math.PI / 2; l.position.set(w * 0.27, h / 2 + 0.0012, d * 0.1); } else { l.scale.set(lw, lw * 0.69, 1); l.position.set((rnd() - 0.5) * (w - lw) * 0.6, h * 0.12, d / 2 + 0.0012); }
        m.add(l);
      }
      return m;
    }

    // ---- room: garage concrete tiled every 2 m, painted block walls ----
    const floorMat = pbr('garage_floor', [7, 5], { color: 0xF2F2F0 }) || new THREE.MeshStandardMaterial({ map: parts.tex(parts.concreteTex(), [4, 3]), roughness: 0.85 });

    // The concrete photo is a warm brown: keep its relief and use its roughness map (grey mottling) as the colour, tinted grey,
    // so the floor reads as clean sealed concrete, not dirt.
    const greyConcrete = (m, hex) => { if (m?.normalMap && m.roughnessMap) { m.map = m.roughnessMap; m.color.set(hex); m.needsUpdate = true; } };
    greyConcrete(floorMat, 0xC4C7C8);
    // Painted concrete block, 40 × 20 cm, light grey over a mid-grey 1.2 m dado (one tile: 2 m wide, the wall's full 5 m).
    const blockC = (() => {
      const c = document.createElement('canvas'); c.width = 512; c.height = 1024; const g = c.getContext('2d'), r = rng(23), bw = 512 / 5, bh = 1024 / 25;
      for (let row = 0; row < 25; row++) {
        const y = 1024 - (row + 1) * bh, low = row < 6, base = low ? [150, 156, 160] : [214, 217, 215];
        for (let i = -1; i < 6; i++) { const x = i * bw + (row % 2 ? bw / 2 : 0), k = 1 + (r() - 0.5) * 0.035; g.fillStyle = `rgb(${base.map((v) => Math.round(v * k)).join(',')})`; g.fillRect(x, y, bw, bh); }
        g.fillStyle = low ? 'rgba(40,44,48,0.35)' : 'rgba(60,64,66,0.22)'; g.fillRect(0, y, 512, 2); for (let i = 0; i < 6; i++) g.fillRect(i * bw + (row % 2 ? bw / 2 : 0), y, 2, bh);
      }
      g.fillStyle = 'rgba(30,34,38,0.5)'; g.fillRect(0, 1024 - 6 * bh - 3, 512, 3); // the dado's top edge
      return c;
    })();
    const wallTex = (rx) => { const t = new THREE.CanvasTexture(blockC); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.repeat.set(rx, 1); return t; };
    let wallMat = pbr('painted_plaster_wall', [7, 2.5]);
    if (wallMat) { wallMat.map = wallTex(7); wallMat.normalScale.set(0.5, 0.5); } else wallMat = new THREE.MeshStandardMaterial({ map: wallTex(7), roughness: 0.92 });
    const shell = P.roomShell({ w: 14, d: 10, h: 5, floorMat, wallMat, skirting: false });
    { // the side walls are 10 m wide, not 14: their own copy keeps the blocks 40 cm
      const sm = shell.walls.left.material.clone(); for (const k of ['map', 'normalMap', 'roughnessMap']) if (sm[k]) { sm[k] = sm[k].clone(); sm[k].repeat.x *= 5 / 7; sm[k].needsUpdate = true; }
      shell.walls.left.material = sm; shell.walls.right.material = sm;
    }
    // yard around the building: the default view is from outside the cut-away front wall, so the ground never ends in
    // view. It reaches past the camera's far plane (80 m) from anywhere the orbit goes (the camera stays within 19.2 m of
    // its target), so its edge never shows, even from behind at full zoom-out: the far plane cuts it along the horizon.
    const yardMat = pbr('garage_floor', [100, 100], { color: 0xA9AEAE }) || new THREE.MeshStandardMaterial({ map: parts.tex(parts.concreteTex(), [57, 57]), color: 0x9EA3A3, roughness: 0.95 });
    greyConcrete(yardMat, 0x9FA4A4);
    const yard = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), yardMat); yard.rotation.x = -Math.PI / 2; yard.position.set(0, -0.012, 0); yard.receiveShadow = true; R.scene.add(yard);
    R.lights.sun.intensity = 0; R.lights.sun.castShadow = false; R.lights.hemi.intensity = 0.45; R.lights.fill.intensity = 0.25; R.scene.background = new THREE.Color(0xA8B0B4);
    // ceiling lights: linear LED high-bays on the 5 m ceiling (white housing, glowing diffuser); they hide with it when the
    // camera is above it
    const fixMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.5 });
    const housings = [], diffusers = [];
    for (const x of [-4, 0, 4]) for (const z of [-3, 1]) {
      const l = new THREE.PointLight(0xF4F1E8, 9, 16, 1.5); l.position.set(x, 4.8, z); if (x === 0 && z === 1) { l.castShadow = true; l.shadow.mapSize.set(2048, 2048); l.shadow.bias = -0.001; } R.scene.add(l);
      housings.push(P.box(1.3, 0.07, 0.34, M.white, x, 4.965, z), P.box(0.04, 0.03, 0.3, M.black, x - 0.6, 4.915, z), P.box(0.04, 0.03, 0.3, M.black, x + 0.6, 4.915, z));
      diffusers.push(P.box(1.16, 0.012, 0.26, fixMat, x, 4.925, z));
    }
    for (const m of [merge(housings, M.white), merge(diffusers, fixMat)]) { m.castShadow = false; m.userData.wall = { nx: 0, ny: -1, nz: 0, d: -5 }; }
    // floor markings: line zone boundaries, and a dashed divider between the carts' belt-side lane and return lane
    const line = new THREE.MeshStandardMaterial({ color: 0xE4B53A, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -1 }), dash = new THREE.MeshStandardMaterial({ color: 0xE9E7E0, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -1 });
    const paintStrip = (w, d, mat, x, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.004, z); m.receiveShadow = true; R.scene.add(m); };
    for (const z of [-2.9, 2.4]) paintStrip(12, 0.08, line, 0, z);
    for (let x = X_PICK + 0.15; x < X_DROP - 0.1; x += 0.6) paintStrip(0.3, 0.05, dash, x, (Z_IN + Z_OUT) / 2);

    // ---- pallet racking along the back wall: blue slotted upright frames with bracing, orange step beams, mesh decks ----
    // Pallets rest on the floor or a deck; cartons stand on their pallet. The decks are matte galvanised: polished steel
    // mirrored the ceiling lights into white hot spots from above.
    {
      const upT = canvasTex(THREE, (g, w, h) => { g.fillStyle = '#2F5E9E'; g.fillRect(0, 0, w, h); g.fillStyle = '#16263A'; g.beginPath(); g.roundRect(w / 2 - 4, 8, 8, 20, 4); g.fill(); g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, 0, 2, h); }, 32, 64); upT.repeat.set(1, 42);
      const upMat = new THREE.MeshStandardMaterial({ map: upT, roughness: 0.5, metalness: 0.25 }), braceMat = paint(0x2F5E9E, 0.5), beamMat = paint(0xE2621B, 0.45);
      const deckT = canvasTex(THREE, (g, w, h) => { g.fillStyle = '#9AA1A7'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(38,42,46,0.55)'; g.fillRect(0, 0, w, 3); g.fillRect(0, 0, 3, h); g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(0, 3, w, 1); }, 32, 32); deckT.repeat.set(2.11 / 0.05, 1.0 / 0.1);
      const deckMat = new THREE.MeshStandardMaterial({ map: deckT, roughness: 0.75, metalness: 0.35 });
      const palT = parts.grainTex({ light: [206, 176, 132], dark: [164, 130, 90], rings: 10, seed: 13, size: 256 });
      const palletMat = new THREE.MeshStandardMaterial({ map: parts.tex(palT, [1, 1]), roughness: 0.9 });
      const ups = [], braces = [], beams = [], decks = [], plates = [], guards = [], pal = [], boxes = [], tapes = [], labels = [];
      const tint = [0xFFFFFF, 0xF2E6D6, 0xE6D3BB, 0xDCC5A6, 0xF7EDE0, 0xE0CBB0].map((c) => new THREE.MeshBasicMaterial({ color: c })); // vertex tints, merged into one kraft mesh
      const pallet = (x, y, z) => {
        for (let i = 0; i < 5; i++) pal.push(P.box(0.9, 0.018, 0.12, palletMat, x, y + 0.091, z - 0.39 + i * 0.195));
        for (const dz of [-0.39, 0, 0.39]) { pal.push(P.box(0.9, 0.018, 0.12, palletMat, x, y + 0.009, z + dz)); for (const dx of [-0.39, 0, 0.39]) pal.push(P.box(0.11, 0.064, 0.12, palletMat, x + dx, y + 0.05, z + dz)); }
      };
      // cartons on a pallet (or loose on a deck): an n × n grid, one or two layers; tape on top, labels on the front row
      const load = (x, y, z, n, layers, hc, size = 0.88) => {
        const cw = (size - (n - 1) * 0.012) / n;
        for (let L = 0; L < layers; L++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
          const cx = x - size / 2 + cw / 2 + i * (cw + 0.012) + (rnd() - 0.5) * 0.012, cz = z - size / 2 + cw / 2 + j * (cw + 0.012) + (rnd() - 0.5) * 0.012, cy = y + hc / 2 + L * hc;
          const b = rb(cw, hc - 0.004, cw, tint[Math.floor(rnd() * tint.length)], cx, cy, cz, 0.012, 1); b.rotation.y = (rnd() - 0.5) * 0.04; boxes.push(b);
          if (L === layers - 1) tapes.push(P.box(Math.min(0.06, cw * 0.2), 0.002, cw + 0.004, tapeMat, cx, cy + hc / 2 - 0.001, cz));
          if (j === n - 1 && rnd() < 0.85) { const l = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), labelMat), lw = Math.min(0.13, cw * 0.4); l.scale.set(lw, lw * 0.69, 1); l.position.set(cx + (rnd() - 0.5) * (cw - lw) * 0.6, cy + hc * 0.12, cz + cw / 2 + 0.006); P.add(l); labels.push(l); }
        }
      };
      for (let r = 0; r < 4; r++) {
        const x = -5.2 + r * 2.6;
        for (const dx of [-1.1, 1.1]) {
          for (const z of [-4.7, -3.7]) { ups.push(P.box(0.09, 4.2, 0.07, upMat, x + dx, 2.1, z)); plates.push(P.box(0.16, 0.012, 0.14, M.steel, x + dx, 0.006, z)); }
          guards.push(P.box(0.13, 0.4, 0.11, yellow, x + dx, 0.212, -3.7)); // upright protector on the aisle side
          // the frame's lacing: horizontals top and bottom, diagonals between them
          for (const y of [0.15, 4.05]) braces.push(P.box(0.035, 0.035, 0.93, braceMat, x + dx, y, -4.2));
          const steps = 4, hy = (4.05 - 0.15) / steps;
          for (let i = 0; i < steps; i++) { const y0 = 0.15 + i * hy, dir = i % 2 ? 1 : -1, len = Math.hypot(0.93, hy); const b = P.box(0.03, len, 0.03, braceMat, x + dx, y0 + hy / 2, -4.2); b.rotation.x = dir * Math.atan2(0.93, hy); braces.push(b); }
        }
        for (const y of [0.9, 2.2, 3.5]) { for (const z of [-4.7, -3.7]) beams.push(P.box(2.11, 0.11, 0.05, beamMat, x, y + 0.03 - 0.055, z)); decks.push(P.box(2.11, 0.012, 0.95, deckMat, x, y + 0.024, -4.2)); }
        for (const y of [0.0, 0.93, 2.23]) for (const dx of [-0.55, 0.55]) {
          if (rnd() < 0.8) { const h = 0.45 + rnd() * 0.3, n = rnd() < 0.35 ? 3 : 2, layers = h > 0.58 ? 2 : 1; pallet(x + dx, y, -4.2); load(x + dx, y + 0.1, -4.2, n, layers, h / layers); }
        }
        for (const dx of [-0.6, 0.6]) if (rnd() < 0.45) load(x + dx, 3.53, -4.2 + 0.1, 2, 1, 0.24 + rnd() * 0.12, 0.6); // loose cartons on the top deck
      }
      merge(ups, upMat); merge(braces, braceMat); merge(beams, beamMat); merge(decks, deckMat); merge(plates, M.steel); merge(guards, yellow); merge(pal, palletMat);
      merge(boxes, new THREE.MeshStandardMaterial({ map: kraftT, vertexColors: true, roughness: 0.92 }), true); merge(tapes, tapeMat); const lm = merge(labels, labelMat); lm.castShadow = false;
    }
    // supplies shelf in the back right corner (a real steel shelving unit when the assets are in)
    {
      const shelf = MOD('steel_frame_shelves_03');
      if (shelf) { R.scene.add(shelf); placeModel(THREE, shelf, { x: 5.3, z: -5 + 0.38 }); }
      else {
        const sp = []; for (const dx of [-1.15, 1.15]) for (const dz of [-0.33, 0.33]) sp.push(P.box(0.04, 2.3, 0.04, M.steel, 5.3 + dx, 1.15, -4.62 + dz));
        for (const y of [0.15, 0.8, 1.45, 2.1]) sp.push(P.box(2.34, 0.03, 0.7, M.steel, 5.3, y, -4.62)); merge(sp, M.steel);
      }
    }

    // Wall-hung parts hide with their wall when the camera is outside it (renderer.js); `hang` gathers everything built
    // since `from` into one tagged group, so the door's own animation (slats, lamps) stays the scene's. Hidden, the group
    // catches no taps (the picker skips wall-hidden parts).
    const hang = (from, nx, d) => {
      const g = new THREE.Group(); for (const o of R.scene.children.slice(from)) g.add(o); R.scene.add(P.onWall(g, nx, 0, d));
      return g;
    };
    // The two yellow wall signs, in bold and filtered for grazing angles: both are mostly read edge-on from across the
    // room, where regular-weight letters blurred into the yellow, and DOCK 2 (in the corner the ceiling lights make
    // brightest, whose glow veils it) turned into a blank pale panel.
    const signMat = (text, w, h, px) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
      g.fillStyle = '#E4B53A'; g.fillRect(0, 0, w, h); g.fillStyle = '#1A1C1E'; g.font = `bold ${px}px "Segoe UI", Inter, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      return new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 });
    };
    // Parcels never show past the receiving hatch or the trailer panel: they slide out of the one and into the other.
    const IN_X = -6.99, OUT_X = 6.975;
    // dock 2 on the right wall: a galvanised roller shutter (slats drawn on a texture, so they keep their 10 cm as the
    // curtain rolls up) with an aluminium bottom bar, in steel guides with striped impact guards, under a rounded coil box
    // with the dock light on top; laminated bumpers, the sign, the signal and a pushbutton station. It opens while the
    // dock light is green. The sign hangs over the signal, beside the door rather than above it: the "Dock 2" label the
    // room shows over the door (discovery, a tap) covered a sign above the door on desktop, and the phone view's hint
    // pill (top right of the room) reaches down to the top of the door.
    const dock0 = R.scene.children.length;
    const SLATS = 32; // 10 cm slats over the 3.2 m curtain
    const slatT = canvasTex(THREE, (g, w, h) => {
      const lg = g.createLinearGradient(0, 0, 0, h); lg.addColorStop(0, '#DADEE1'); lg.addColorStop(0.5, '#C4C9CD'); lg.addColorStop(0.85, '#AAB0B5'); lg.addColorStop(1, '#8E9499');
      g.fillStyle = lg; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(0,0,0,0.14)'; g.fillRect(0, h / 2, w, 2);
      g.fillStyle = '#5A6065'; g.fillRect(0, h - 6, w, 3); g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(0, h - 3, w, 2);
    }); slatT.repeat.set(1, SLATS); slatT.anisotropy = 8;
    const door = P.box(0.06, 3.2, 3.0, new THREE.MeshStandardMaterial({ map: slatT, bumpMap: slatT, bumpScale: 1.2, metalness: 0.55, roughness: 0.45 }), 6.96, 1.6, 0.6); door.userData.noContact = true;
    const bottomBar = P.group(P.box(0.075, 0.05, 3.0, M.metal, 0, 0, 0), P.box(0.05, 0.012, 2.98, M.rubber, 0, -0.031, 0)); bottomBar.position.set(6.955, 0.025, 0.6); bottomBar.userData.noContact = true;
    // the trailer's dark interior behind the open door: one panel facing the room, at OUT_X
    const trailer = new THREE.Mesh(new THREE.PlaneGeometry(2.98, 3.18), new THREE.MeshStandardMaterial({ color: 0x15181B, roughness: 1 })); trailer.rotation.y = -Math.PI / 2; trailer.position.set(OUT_X, 1.59, 0.6); trailer.receiveShadow = true; R.scene.add(trailer);
    const guardMat = hazMat(1.5, 8), guides = P.group(merge([-0.94, 2.14].map((z) => P.box(0.1, 3.26, 0.08, frameMat, 6.95, 1.63, z)), frameMat), merge([-0.94, 2.14].map((z) => P.box(0.11, 0.6, 0.1, guardMat, 6.94, 0.3, z)), guardMat));
    const dockHousing = P.group(rb(0.26, 0.28, 3.24, frameMat, 6.87, 3.34, 0.6, 0.07, 2), merge([-1.025, 2.225].map((z) => P.box(0.27, 0.29, 0.012, M.steel, 6.87, 3.34, z)), M.steel));
    P.cyl(0.055, 0.06, 0.03, M.black, 6.88, 3.495, 0.6, 20);
    const dockLight = P.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.09, 24), lensMat(0xE0563A))); dockLight.position.set(6.88, 3.555, 0.6);
    P.cyl(0.052, 0.052, 0.014, M.black, 6.88, 3.607, 0.6, 20);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.3), signMat('DOCK 2', 256, 96, 70)); sign.rotation.y = -Math.PI / 2; sign.position.set(6.99, 2.85, -1.4); R.scene.add(sign);
    // laminated rubber bumpers between steel angles, outboard of the guides
    {
      const lamT = canvasTex(THREE, (g, w, h) => { for (let y = 0, i = 0; y < h; y += 8, i++) { g.fillStyle = i % 2 ? '#1E2022' : '#26292B'; g.fillRect(0, y, w, 8); g.fillStyle = '#101112'; g.fillRect(0, y + 7, w, 1); } }); lamT.repeat.set(1, 0.3 / 0.08);
      const lam = new THREE.MeshStandardMaterial({ map: lamT, roughness: 0.92 });
      merge([-1.2, 2.4].map((z) => P.box(0.26, 0.3, 0.36, lam, 6.86, 0.2, z)), lam);
      merge([-1.2, 2.4].flatMap((z) => [0.04, 0.36].map((y) => P.box(0.27, 0.014, 0.38, M.steel, 6.86, y, z))), M.steel);
    }
    // dock signal on the wall beside the door, at eye height: red over green under visors, the lit one is the dock's state
    const sigHousing = P.group(rb(0.08, 0.44, 0.22, M.black, 6.95, 2.25, -1.4, 0.02, 2), merge([2.445, 2.225].map((y) => P.box(0.07, 0.008, 0.18, M.black, 6.88, y, -1.4)), M.black));
    const lamp = (hex, y) => { const m = alongX(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 28), new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 0, roughness: 0.25 }))); m.position.set(6.9, y, -1.4); m.userData.hex = hex; R.scene.add(m); return m; };
    const sigRed = lamp(0xE0563A, 2.36), sigGreen = lamp(0x2FBF71, 2.14), SIG = [sigRed, sigGreen];
    // pushbutton station under the signal: up and down (black), stop (red)
    const station = P.group(rb(0.05, 0.2, 0.12, panel, 6.965, 1.45, -1.4, 0.008, 2), ...[[1.51, M.black], [1.45, red], [1.39, M.black]].map(([y, m]) => alongX(P.cyl(0.016, 0.016, 0.012, m, 6.935, y, -1.4, 16))));
    hang(dock0, -1, -7); // the right wall, x = 7
    // the dock leveller on the floor inside the door: tread plate with a striped front edge
    {
      const tread = canvasTex(THREE, (g, w, h) => { g.fillStyle = '#8B9197'; g.fillRect(0, 0, w, h); const bar = (x, y, a) => { g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = '#5F656B'; g.beginPath(); g.ellipse(1, 1.5, 11, 3, 0, 0, TAU); g.fill(); g.fillStyle = '#C0C6CB'; g.beginPath(); g.ellipse(0, 0, 11, 3, 0, 0, TAU); g.fill(); g.restore(); }; bar(16, 16, 0.75); bar(48, 48, 0.75); bar(48, 16, -0.75); bar(16, 48, -0.75); }); tread.repeat.set(0.7 / 0.06, 2.9 / 0.06);
      const plate = P.box(0.7, 0.014, 2.9, new THREE.MeshStandardMaterial({ map: tread, metalness: 0.85, roughness: 0.45 }), 6.6, 0.007, 0.6); plate.castShadow = false; plate.userData.noContact = true; // flush with the floor: no baked dark rim
      const edge = P.box(0.06, 0.016, 2.9, hazMat(0.5, 2.9 / 0.06), 6.22, 0.008, 0.6); edge.castShadow = false; edge.userData.noContact = true;
    }

    // Three conveyor sections along x at z = 0.5, belt top at 0.83: flat belts in galvanised side channels on H-frame
    // legs with levelling feet, the return belt underneath. The gearmotors and stack lights sit on the back rail, so the
    // front stays clear for the carts. The back rail is open where lane B leaves. The belts' splice stripes scroll with
    // their speed (update()).
    const beltY = 0.8, LZ = 0.5, GAP = [0.945, 1.655];
    const rails = (x0, x1, z, into) => { if (x1 - x0 > 0.001) { into.side.push(P.box(x1 - x0, 0.14, 0.05, into.mat, (x0 + x1) / 2, beltY - 0.02, z)); for (const y of [beltY + 0.053, beltY - 0.087]) into.lips.push(P.box(x1 - x0, 0.006, 0.06, frameMat, (x0 + x1) / 2, y, z)); } };
    // H-frame legs every 1.5 m at most, with a long brace and levelling feet; x0..x1 the section, at z (± 0.28)
    const legs = (x0, x1, into, z = LZ) => {
      const n = Math.max(2, Math.ceil((x1 - x0 - 0.5) / 1.5) + 1), xs = []; for (let i = 0; i < n; i++) xs.push(x0 + 0.25 + (x1 - x0 - 0.5) * (i / (n - 1)));
      for (const lx of xs) {
        for (const dz of [-0.28, 0.28]) { into.lips.push(P.box(0.05, beltY - 0.1, 0.05, frameMat, lx, 0.025 + (beltY - 0.1) / 2, z + dz)); into.feet.push(P.cyl(0.032, 0.036, 0.016, M.rubber, lx, 0.008, z + dz, 14)); }
        into.lips.push(P.box(0.05, 0.04, 0.62, frameMat, lx, beltY - 0.05, z), P.box(0.035, 0.035, 0.56, frameMat, lx, 0.2, z));
      }
      into.lips.push(P.box(xs[xs.length - 1] - xs[0], 0.035, 0.035, frameMat, (xs[0] + xs[xs.length - 1]) / 2, 0.2, z));
    };
    const finMat = new THREE.MeshStandardMaterial({ map: finTex(), metalness: 0.5, roughness: 0.5 });
    function conveyor(x0, x1) {
      const len = x1 - x0, cx = (x0 + x1) / 2, tex = beltTex(len);
      const beltMesh = P.box(len, 0.06, 0.62, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }), cx, beltY, LZ);
      const into = { mat: sideMat(len), side: [], lips: [], feet: [] };
      rails(x0, x1, LZ + 0.33, into); rails(x0, Math.min(x1, Math.max(x0, GAP[0])), LZ - 0.33, into); rails(Math.max(x0, Math.min(x1, GAP[1])), x1, LZ - 0.33, into);
      legs(x0, x1, into);
      const ret = P.box(len - 0.08, 0.006, 0.5, M.rubber, cx, beltY - 0.12, LZ); into.feet.push(ret);
      const railMesh = merge(into.side, into.mat), frame = P.group(merge(into.lips, frameMat), merge(into.feet, M.rubber));
      // gearmotor on the back of the drive end: gearbox, finned barrel, fan cowl, terminal box, output shaft into the channel
      const mx = x1 - 0.3, mz = LZ - 0.33 - 0.025 - 0.09;
      const motor = P.group(
        rb(0.13, 0.17, 0.15, graphite, mx + 0.04, 0.715, mz, 0.015, 2),
        alongX(P.cyl(0.058, 0.058, 0.17, finMat, mx - 0.11, 0.7, mz, 20)),
        alongX(P.cyl(0.054, 0.05, 0.05, graphite, mx - 0.22, 0.7, mz, 20)),
        rb(0.07, 0.04, 0.07, graphite, mx - 0.1, 0.775, mz, 0.006, 1),
        alongZ(P.cyl(0.02, 0.02, 0.07, M.steel, mx + 0.04, 0.74, mz + 0.09, 12)),
      );
      // stack light on a post on the back rail: a grey base, the lens (the belt's beacon), a cap
      const led = P.add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.07, 20), lensMat(0x2FBF71))); led.position.set(mx, beltY + 0.35, LZ - 0.33);
      const stack = P.group(P.cyl(0.011, 0.011, 0.25, M.steel, mx, beltY + 0.175, LZ - 0.33, 10), P.cyl(0.03, 0.034, 0.03, M.black, mx, beltY + 0.3, LZ - 0.33, 20), P.cyl(0.031, 0.031, 0.012, M.black, mx, beltY + 0.391, LZ - 0.33, 20));
      // pushbutton box on the first leg, facing the aisle: an E-stop in a yellow collar
      const bx = x0 + 0.25, pb = P.group(rb(0.09, 0.13, 0.045, panel, bx, 0.5, LZ + 0.33, 0.008, 2), alongZ(P.cyl(0.024, 0.024, 0.008, yellow, bx, 0.52, LZ + 0.356, 20)), alongZ(P.cyl(0.017, 0.019, 0.018, red, bx, 0.52, LZ + 0.366, 20)), alongZ(P.cyl(0.009, 0.009, 0.008, greenBtn, bx, 0.465, LZ + 0.356, 14)));
      return { x0, x1, beltMesh, motor, led, tex, rails: railMesh, frame, stack, pb };
    }
    const C = { c1: conveyor(-5.0, -2.0), c2: conveyor(-2.0, 1.0), c3: conveyor(1.0, 6.9) };
    // receiving: parcels come in through a hatch in the left wall (a dark panel at IN_X, framed, with its sign), onto a
    // short infeed that runs with C1 and ends at the wall
    const feedTex = beltTex(2.0);
    P.box(2.0, 0.06, 0.62, new THREE.MeshStandardMaterial({ map: feedTex, roughness: 0.85 }), -6.0, beltY, LZ);
    { const into = { mat: sideMat(2.0), side: [], lips: [], feet: [] }; rails(-7.0, -5.0, LZ + 0.33, into); rails(-7.0, -5.0, LZ - 0.33, into); legs(-7.0, -5.0, into); merge(into.side, into.mat); merge(into.lips, frameMat); merge(into.feet, M.rubber); }
    const recv0 = R.scene.children.length;
    const hatch = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.78), new THREE.MeshStandardMaterial({ color: 0x15181B, roughness: 1 })); hatch.rotation.y = Math.PI / 2; hatch.position.set(IN_X, beltY + 0.36, LZ); R.scene.add(hatch);
    merge([P.box(0.06, 0.08, 1.1, frameMat, -6.97, beltY + 0.79, LZ), ...[-0.51, 0.51].map((dz) => P.box(0.06, 0.86, 0.08, frameMat, -6.97, beltY + 0.36, LZ + dz))], frameMat);
    const rsign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.26), signMat('RECEIVING', 320, 92, 46)); rsign.rotation.y = Math.PI / 2; rsign.position.set(-6.99, beltY + 1.05, LZ); R.scene.add(rsign);
    hang(recv0, 1, -7); // the left wall, x = -7
    // lane B: a branch off the C2/C3 junction toward the back, ending over its tote
    const LB0 = LZ - 0.315, LB1 = -2.0;
    const laneTex = beltTex(LB0 - LB1, true);
    P.box(0.62, 0.06, LB0 - LB1, new THREE.MeshStandardMaterial({ map: laneTex, roughness: 0.85 }), 1.3, beltY, (LB0 + LB1) / 2);
    const LBR = LZ - 0.305, MOUTH = 0.3; // left rail starts MOUTH further back: the open side where parcels slide in off the gate
    {
      const bSide = sideMat(LBR - LB1); // the ±x faces map u along z
      const sides = [P.box(0.05, 0.14, LBR - MOUTH - LB1, bSide, 0.97, beltY - 0.02, (LBR - MOUTH + LB1) / 2), P.box(0.05, 0.14, LBR - LB1, bSide, 1.63, beltY - 0.02, (LBR + LB1) / 2)];
      const lips = [], feet = [];
      for (const lz of [-0.3, -1.75]) { for (const dx of [-0.28, 0.28]) { lips.push(P.box(0.05, beltY - 0.1, 0.05, frameMat, 1.3 + dx, 0.025 + (beltY - 0.1) / 2, lz)); feet.push(P.cyl(0.032, 0.036, 0.016, M.rubber, 1.3 + dx, 0.008, lz, 14)); } lips.push(P.box(0.62, 0.04, 0.05, frameMat, 1.3, beltY - 0.05, lz), P.box(0.56, 0.035, 0.035, frameMat, 1.3, 0.2, lz)); }
      merge(sides, bSide); merge(lips, frameMat); merge(feet, M.rubber);
    }
    // lane B tote: a grey polypropylene bin under the belt end with a printed card. A diverted parcel drops in and sinks
    // below what's already there (the fill: parcel tops drawn on a canvas).
    {
      const tote = paint(0x5B636B, 0.6);
      merge([rb(0.84, 0.03, 0.64, tote, 1.3, 0.015, -2.3, 0.01, 1), ...[-0.335, 0.335].map((dz) => rb(0.9, 0.6, 0.03, tote, 1.3, 0.3, -2.3 + dz, 0.01, 1)), ...[-0.435, 0.435].map((dx) => rb(0.03, 0.6, 0.64, tote, 1.3 + dx, 0.3, -2.3, 0.01, 1)),
        ...[-0.345, 0.345].map((dz) => P.box(0.92, 0.03, 0.03, tote, 1.3, 0.585, -2.3 + dz)), ...[-0.445, 0.445].map((dx) => P.box(0.03, 0.03, 0.72, tote, 1.3 + dx, 0.585, -2.3))], tote);
      const card = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.12), new THREE.MeshStandardMaterial({ map: parts.labelTex('LANE B', { bg: '#F4F5F3', fg: '#1E2226', size: 44, w: 256, h: 118, weight: 'bold' }), roughness: 0.8 })); card.position.set(1.3, 0.38, -2.3 + 0.352); R.scene.add(card);
      const fillT = canvasTex(THREE, (g, w, h) => { const r = rng(31); g.fillStyle = '#2E2620'; g.fillRect(0, 0, w, h); for (let i = 0; i < 14; i++) { const bw = 40 + r() * 70, bh = 30 + r() * 50, x = r() * (w - bw), y = r() * (h - bh), k = 0.7 + r() * 0.35; g.fillStyle = `rgb(${Math.round(196 * k)},${Math.round(160 * k)},${Math.round(116 * k)})`; g.fillRect(x, y, bw, bh); g.fillStyle = 'rgba(216,213,203,0.8)'; g.fillRect(x + bw * 0.42, y, bw * 0.16, bh); g.fillStyle = 'rgba(40,30,20,0.35)'; g.fillRect(x, y + bh - 3, bw, 3); } }, 256, 192);
      P.box(0.835, 0.01, 0.635, new THREE.MeshStandardMaterial({ map: fillT, roughness: 1 }), 1.3, 0.465, -2.3);
    }
    // scanner arch over the end of C1, on the belt rails: T-slot aluminium posts and beam on striped base plates, a yellow
    // light curtain on each post's inner face, two downward camera heads with an illumination bar, a stack light on top
    // and a control box on the aisle post whose screen shows the mode and the count.
    const postMat = new THREE.MeshStandardMaterial({ map: slotTex(false), metalness: 1, roughness: 0.34 }), beamTexMat = new THREE.MeshStandardMaterial({ map: slotTex(true), metalness: 1, roughness: 0.34 });
    const curtainT = canvasTex(THREE, (g, w, h) => { g.fillStyle = '#140A0B'; g.fillRect(0, 0, w, h); for (let y = 8; y < h; y += 16) { g.fillStyle = '#5A1A1A'; g.beginPath(); g.arc(w / 2, y, 5, 0, TAU); g.fill(); g.fillStyle = '#C23A30'; g.beginPath(); g.arc(w / 2, y, 2.2, 0, TAU); g.fill(); } }, 32, 64); curtainT.repeat.set(1, 0.58 / 0.06);
    const curtainMat = new THREE.MeshStandardMaterial({ map: curtainT, emissive: 0xFF3A30, emissiveMap: curtainT, emissiveIntensity: 0, roughness: 0.2 });
    const illumMat = new THREE.MeshStandardMaterial({ color: 0xE8ECEE, emissive: 0xEFF7FF, emissiveIntensity: 0, roughness: 0.3 });
    const archHaz = hazMat(1, 1);
    const archFrame = P.group(
      merge([LZ - 0.33, LZ + 0.33].map((z) => P.box(0.06, 0.74, 0.06, postMat, SX, beltY + 0.432, z)), postMat),
      P.box(0.06, 0.06, 0.78, beamTexMat, SX, 1.63, LZ),
      merge([LZ - 0.33, LZ + 0.33].map((z) => P.box(0.11, 0.012, 0.08, archHaz, SX, beltY + 0.062, z)), archHaz),
      merge([LZ - 0.285, LZ + 0.285].map((z) => rb(0.04, 0.62, 0.03, yellow, SX, 1.2, z, 0.006, 1)), yellow),
      merge([LZ - 0.285, LZ + 0.285].flatMap((z) => [0.895, 1.505].map((y) => P.box(0.044, 0.03, 0.034, M.black, SX, y, z))), M.black),
      ...[[LZ - 0.2695, 0], [LZ + 0.2695, Math.PI]].map(([z, ry]) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.024, 0.58), curtainMat); m.position.set(SX, 1.2, z); m.rotation.y = ry; return P.add(m); }),
    );
    const glass = new THREE.MeshStandardMaterial({ color: 0x0A0E12, roughness: 0.05, metalness: 0.2 });
    const scanHead = P.group(
      merge([LZ - 0.17, LZ + 0.17].map((z) => rb(0.1, 0.07, 0.12, shellMat, SX, 1.565, z, 0.012, 2)), shellMat),
      merge([LZ - 0.17, LZ + 0.17].map((z) => P.cyl(0.026, 0.026, 0.008, M.black, SX, 1.527, z, 20)), M.black),
      merge([LZ - 0.17, LZ + 0.17].map((z) => P.cyl(0.019, 0.019, 0.006, glass, SX, 1.523, z, 20)), glass),
      rb(0.06, 0.03, 0.18, M.anodized, SX, 1.585, LZ, 0.006, 1),
      P.box(0.045, 0.004, 0.16, illumMat, SX, 1.569, LZ),
    );
    P.cyl(0.05, 0.054, 0.03, M.black, SX, 1.675, LZ, 20);
    const scanBeacon = P.add(new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.1, 24), lensMat(0x2FBF71))); scanBeacon.position.set(SX, 1.74, LZ); // status lamp on the crossbar, sized like the dock light
    P.cyl(0.047, 0.047, 0.014, M.black, SX, 1.797, LZ, 20);
    const hmi = (() => { const c = document.createElement('canvas'); c.width = 256; c.height = 160; const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; return { g: c.getContext('2d'), tex }; })();
    const ctrl = P.group(
      rb(0.16, 0.2, 0.05, panel, SX, 1.26, LZ + 0.33 + 0.055, 0.01, 2),
      (() => { const m = P.screenPlane(0.12, 0.075, hmi.tex); m.position.set(SX, 1.29, LZ + 0.33 + 0.0805); return m; })(),
      ...[[SX - 0.04, greenBtn], [SX + 0.04, M.black]].map(([x, m]) => alongZ(P.cyl(0.01, 0.01, 0.008, m, x, 1.2, LZ + 0.33 + 0.083, 14))),
    );
    const drawHmi = (mode, n, bad) => {
      const g = hmi.g; g.fillStyle = mode === 'fault' ? '#4A0F0B' : mode === 'off' ? '#05070A' : '#0A1218'; g.fillRect(0, 0, 256, 160); g.textAlign = 'left'; g.textBaseline = 'middle';
      if (mode === 'fault') { g.fillStyle = '#FF7A62'; g.font = `600 30px ${FONT}`; g.fillText('CHECK', 16, 56); g.fillStyle = '#FFC2B6'; g.font = `20px ${FONT}`; g.fillText(`${n} scanned`, 16, 104); }
      else if (mode !== 'off') {
        const armed = mode === 'armed'; g.fillStyle = armed ? '#2FBF71' : '#24313A'; g.fillRect(0, 0, 256, 38);
        g.fillStyle = armed ? '#06140C' : '#A9B8C2'; g.font = `600 22px ${FONT}`; g.fillText(armed ? 'ARMED' : 'IDLE', 14, 20);
        g.fillStyle = '#7FC9D6'; g.font = `18px ${FONT}`; g.fillText(bad ? `${bad} unreadable` : 'scanned', 14, 62);
        g.fillStyle = '#E8FBFF'; g.font = `600 54px ${FONT}`; g.fillText(String(n), 14, 112);
      }
      hmi.tex.needsUpdate = true;
    };
    const scanLine = new THREE.Mesh(new THREE.PlaneGeometry(0.012, 0.6), new THREE.MeshStandardMaterial({ color: 0xFF3030, emissive: 0xFF2020, emissiveIntensity: 5, transparent: true, opacity: 0.7, side: THREE.DoubleSide })); scanLine.rotation.z = Math.PI / 2; scanLine.rotation.y = Math.PI / 2; scanLine.position.set(SX, beltY + 0.04, LZ); R.scene.add(scanLine);
    // sorter gate: a pneumatic paddle diverter hinged on the front rail at the C2 → C3 junction; it swings back across the
    // belt to push parcels into lane B. A square-cap air cylinder on a bracket outboard of the frame pushes it (its rod
    // follows the paddle, update()), fed by a blue air line from a solenoid valve; a photo-eye looks across the belt ahead
    // of it. From the default view it is nearly end-on at lane B, so the paddle carries a wide top flange that still
    // reads end-on, and a stack light on a mast just upstream shows the lane too: green for A, amber for B.
    const GP = new THREE.Vector3(1.0, beltY + 0.12, LZ + 0.33);
    const gatePivot = new THREE.Group(); gatePivot.position.copy(GP); R.scene.add(gatePivot);
    const inPivot = (m) => { m.castShadow = true; gatePivot.add(m); return m; };
    const gateArm = inPivot(new THREE.Mesh(new RBox(0.7, 0.24, 0.03, 1, 0.008), yellow)); gateArm.position.set(0.35, 0.06, 0);
    const gateCap = inPivot(new THREE.Mesh(new RBox(0.7, 0.035, 0.11, 1, 0.008), yellow)); gateCap.position.set(0.35, 0.195, 0);
    inPivot(new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.19, 0.006), M.rubber)).position.set(0.36, 0.05, -0.018); // wear face on the belt side
    inPivot(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 0.03), M.steel)).position.set(0.25, 0.06, 0.03); // the rod's lug
    const LUG = [0.25, 0.03], BASE = new THREE.Vector3(1.62, beltY + 0.18, LZ + 0.48), TUBE = 0.28;
    const hinge = P.group(P.cyl(0.02, 0.02, 0.32, M.steel, 1.0, beltY + 0.18, LZ + 0.33, 12), P.cyl(0.032, 0.032, 0.035, M.anodized, 1.0, beltY + 0.05, LZ + 0.33, 16), P.cyl(0.032, 0.032, 0.035, M.anodized, 1.0, beltY + 0.335, LZ + 0.33, 16));
    const alu = new THREE.MeshStandardMaterial({ color: 0xC9CED2, metalness: 1, roughness: 0.3 });
    const cyl = new THREE.Group(); cyl.position.copy(BASE); R.scene.add(cyl);
    const cylBody = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, TUBE - 0.04, 16).rotateZ(-Math.PI / 2).translate(TUBE / 2, 0, 0), alu);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 1, 10).rotateZ(-Math.PI / 2).translate(0.5, 0, 0), M.metal); rod.position.x = TUBE;
    const clevis = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.02, 0.018), M.steel);
    const caps = [0.014, TUBE - 0.012].map((x) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.05, 0.05), M.anodized); m.position.x = x; return m; });
    cyl.add(cylBody, rod, clevis, ...caps); cyl.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
    const gateBracket = P.group(P.box(0.12, 0.012, 0.145, frameMat, 1.62, beltY + 0.066, LZ + 0.4275), P.box(0.04, 0.11, 0.04, frameMat, 1.62, beltY + 0.127, BASE.z),
      rb(0.07, 0.03, 0.035, M.anodized, 1.62, beltY + 0.087, LZ + 0.375, 0.003, 1), rb(0.03, 0.035, 0.03, M.black, 1.665, beltY + 0.09, LZ + 0.375, 0.003, 1),
      P.tube([[1.6, beltY + 0.1, LZ + 0.39], [1.6, beltY + 0.15, LZ + 0.43], [1.615, BASE.y, BASE.z - 0.02]], 0.004, paint(0x2E6FB0, 0.5)));
    // photo-eye on the front rail and its reflector on the back rail, just upstream of the paddle
    P.group(rb(0.03, 0.04, 0.03, M.black, 0.5, beltY + 0.075, LZ + 0.345, 0.004, 1), alongZ(P.cyl(0.014, 0.014, 0.004, new THREE.MeshStandardMaterial({ color: 0xB0201A, roughness: 0.2 }), 0.5, beltY + 0.075, LZ - 0.33, 16)));
    const GLX = 0.8;
    const gateMast = P.group(P.cyl(0.011, 0.011, 0.34, M.black, GLX, beltY + 0.2, LZ + 0.33, 10), P.cyl(0.036, 0.04, 0.02, M.black, GLX, beltY + 0.38, LZ + 0.33, 16), P.cyl(0.036, 0.036, 0.012, M.black, GLX, beltY + 0.476, LZ + 0.33, 16));
    const gateLamp = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.08, 16), new THREE.MeshStandardMaterial({ color: 0x2FBF71, emissive: 0x2FBF71, emissiveIntensity: 2, roughness: 0.3 })); gateLamp.position.set(GLX, beltY + 0.43, LZ + 0.33); R.scene.add(gateLamp);

    // Parcels flow along the whole line as one queue: each advances at its section's speed, keeps SPACING to the one
    // ahead, and waits at the end of its section when the next one is dead, the gate is swinging, or the dock is shut.
    // They come in through the receiving hatch and leave through the dock door, out of sight on both ends; delivered
    // parcels re-enter from receiving. Diverted parcels slide along the gate arm, ride lane B and drop into the tote.
    // Each is a kraft carton (three shades) with tape and a label on top.
    const SEC = [C.c1, C.c2, C.c3], SPACING = 1.0, END_STOP = 0.22, ENTRY_X = -7.4, DOOR_X = 7.15, SPEED_K = 2.2, INTO = 0.5 * SPEED_K;
    const secAt = (x) => (x < C.c1.x1 ? 0 : x < C.c2.x1 ? 1 : 2);
    const flow = []; for (let i = 0; i < 24; i++) { const s = 0.26 + (i % 3) * 0.04; const mesh = carton(s, s * 0.7, s * 0.8, KRAFT[(i * 7) % 3], 0, beltY + 0.03 + s * 0.35, LZ); mesh.userData.noContact = true; flow.push({ mesh, y0: mesh.position.y, hw: s / 2 }); }
    const BPATH = [[0.962, LZ], [1.251, 0.136], [1.3, -0.25], [1.3, LB1], [1.3, -2.3]]; // x, z
    const BLEN = []; { let acc = 0; BLEN.push(0); for (let i = 1; i < BPATH.length; i++) { acc += Math.hypot(BPATH[i][0] - BPATH[i - 1][0], BPATH[i][1] - BPATH[i - 1][1]); BLEN.push(acc); } }
    // x, z and drop along lane B into `out`. Off the belt end the parcel falls into the tote and is below its fill
    // for the last quarter of the way, so it is out of sight before it is recycled.
    const bAt = (b, out) => { let i = 1; while (i < BPATH.length - 1 && b > BLEN[i]) i++; const k = Math.min(1, Math.max(0, (b - BLEN[i - 1]) / (BLEN[i] - BLEN[i - 1]))); out[0] = BPATH[i - 1][0] + (BPATH[i][0] - BPATH[i - 1][0]) * k; out[1] = BPATH[i - 1][1] + (BPATH[i][1] - BPATH[i - 1][1]) * k; out[2] = i === BPATH.length - 1 ? 0.62 * Math.min(1, k / 0.75) ** 2 : 0; return out; };
    const free = () => flow.find((p) => p.lane === 'wait');
    const put = (x, sn = 0) => { const p = free(); if (p) Object.assign(p, { lane: 'main', x, sn, b: 0, k: 0, cart: null }); return p; };
    // The room's line, read and set by the scripts: counters (see sync), where a given scanned parcel is, and snaps
    // for skips, for the mid-shift start of the Stop request and for the Move request's time-lapse.
    const ln = {
      gen: 0, watching: false, scanned: 0, docked: 0, toB: new Set(), // toB: the scanned numbers sent down lane B
      find: (n) => flow.find((p) => p.sn === n && p.lane !== 'wait'),
      onC3: () => flow.some((p) => p.lane === 'main' && p.x >= C.c3.x0),
      offC1: (n) => { const p = ln.find(n); return !p || p.lane !== 'main' || p.x >= C.c2.x0; },
      nextToGate: () => { let q = null; for (const p of flow) if (p.lane === 'main' && p.sn && p.x < C.c2.x1 && (!q || p.x > q.x)) q = p; return q ? q.sn : null; },
      inDoorway: () => flow.some((p) => p.lane === 'main' && p.x > C.c3.x1 - END_STOP && p.x <= DOOR_X),
      deliver(n) { let k = 0, s = 0; while (k < n && s < 999) { s++; if (!ln.toB.has(s)) k++; } for (const p of flow) if (p.lane === 'main' && p.sn && p.sn <= s) Object.assign(p, { lane: 'wait', sn: 0 }); ln.docked = Math.max(ln.docked, n); },
      doorAt(v) { doorVis = v; }, // a skip: the door where a stuck one would have stopped
      c2: () => flow.filter((p) => p.lane === 'main' && p.x >= C.c2.x0 && p.x < C.c2.x1).map((p) => p.x).sort((a, b) => b - a), // most downstream first
      riding: () => flow.filter((p) => (p.lane === 'main' && p.x >= C.c3.x0) || p.lane === 'down' || (p.lane === 'cart' && p.cart.group.position.x > C.c3.x0)).length, // still on their way down C3
      // as if n had gone through the armed arch with every belt running and the door open: one per SPACING, the n-th
      // `past` the beam, the earliest already through the door. What's on a cart or in lane B stays there, and a parcel
      // already sent down lane B leaves its gap in the line (and isn't counted at the dock).
      lay(n, past = 0.05, total = Infinity, lag = 0) {
        for (const p of flow) if (p.lane !== 'cart' && p.lane !== 'B') Object.assign(p, { lane: 'wait', sn: 0, cart: null });
        let docked = 0;
        for (let k = n, swings = 0; k >= 1; k--) { if (k < n && ln.toB.has(k + 1)) swings++; const x = SX + past + (n - k) * SPACING + swings * lag; if (x > DOOR_X) { docked = k; for (const b of ln.toB) if (b <= k) docked--; break; } if (!ln.toB.has(k)) put(x, k); }
        for (let x = SX + past - SPACING, k = n; x >= ENTRY_X && k < total; x -= SPACING, k++) put(x); // no more than `total` in all
        ln.scanned = n; ln.docked = docked;
        doorVis = store.state.dock.light === 'green' ? 1 : 0; gateVis = store.state.gate.pos; // where they'd be by now: nothing moves in view
      },
      // a skip: cart `id` where it would be by now at u (the room eases carts along, and holds a stopped one where it is)
      snap(id, u) { const c = CARTS.find((k) => k.id === id); c.group.position.lerpVectors(c.home, cartAt(u, tmp), smooth(c.blend)); },
      // cart `id` has finished turning into its bay
      inBay: (id) => CARTS.find((k) => k.id === id).blend < 0.001,
      // a skip passed parcel n's turn at the gate: it is in the tote, as if the gate had taken it
      diverted(n) { ln.intoTote(n); gateVis = store.state.gate.pos; }, // the arm is where the gate says
      // a skip passed parcel n's trip down lane B: it is in the tote; the arm is left to the room (it swings once the zone is clear)
      intoTote(n) { const p = ln.find(n); if (p && p.lane === 'main') Object.assign(p, { lane: 'wait', sn: 0 }); ln.toB.add(n); },
      // time-lapse: C1 keeps only the last `queue` parcels (the first at its end stop, already scanned); C2 and C3 stay
      // as they are; the counts jump so that `dockedAfter` is at the dock once C1's queue and C3 have gone through
      cut(queue, scanned, dockedAfter) {
        const onC1 = flow.filter((p) => p.lane === 'main' && p.x < C.c1.x1).sort(byX); // the front ones stay (as the last ones)
        onC1.forEach((p, i) => Object.assign(p, i < queue ? { x: C.c1.x1 - END_STOP - i * SPACING, sn: i === 0 ? scanned : 0 } : { lane: 'wait', sn: 0 }));
        for (let i = onC1.length; i < queue; i++) put(C.c1.x1 - END_STOP - i * SPACING, i === 0 ? scanned : 0);
        ln.scanned = scanned; ln.docked = dockedAfter - queue - ln.riding();
      },
      // the Stop request starts mid-shift: the line laid out as if n had been scanned, the door already up and the
      // carts already out on the loop (with a parcel on board if the store says loaded). Nothing starts up in view.
      midShift(n) {
        const s = store.state; ln.lay(n);
        doorVis = s.dock.light === 'green' ? 1 : 0; gateVis = s.gate.pos;
        for (const c of CARTS) {
          const st = s[c.id]; c.blend = st.state === 'parked' || st.state === 'parking' ? 0 : 1; c.group.position.lerpVectors(c.home, cartAt(st.u, tmp), smooth(c.blend)); c.wasLoaded = !!st.load;
          if (st.load && !flow.some((p) => p.cart === c)) { const p = free(); if (p) Object.assign(p, { lane: 'cart', cart: c, sn: 0 }); }
        }
      },
    };
    lineOf.set(store, ln);
    // the idle line: a queue on C1, all of it before the scanner, and the next one half out of the hatch (at x = -7.0:
    // any further in and only a few centimetres of it showed, a flat slab standing in the opening)
    function initFlow() {
      for (const p of flow) Object.assign(p, { lane: 'wait', x: 0, b: 0, k: 0, cart: null, sn: 0 });
      for (let x = SX - 0.3; x > ENTRY_X + 0.2; x -= SPACING) put(x);
      ln.scanned = 0; ln.docked = 0; ln.toB.clear();
    }


    // carts: lift AMRs whose roller deck sits at belt height, so a parcel moves belt → deck → belt on one level. A light
    // grey body on a rubber bumper band, yellow safety scanners at both ends (they drive both ways), a white light bar at
    // +x and a red one at -x, a bellows-covered lift column, an E-stop on the rear corner and the cart's letter on its
    // aisle side. The column reaches 1 cm into the deck: a column that stopped short left a see-through slit under the
    // deck at eye level.
    const bellowsT = canvasTex(THREE, (g, w, h) => { const lg = g.createLinearGradient(0, 0, 0, h); lg.addColorStop(0, '#2A2E33'); lg.addColorStop(0.5, '#4A5058'); lg.addColorStop(1, '#22262A'); g.fillStyle = lg; g.fillRect(0, 0, w, h); }, 8, 16);
    const rollerT = canvasTex(THREE, (g, w, h) => { const lg = g.createLinearGradient(0, 0, 0, h); lg.addColorStop(0, '#2A2E33'); lg.addColorStop(0.2, '#7D848B'); lg.addColorStop(0.5, '#C9CED3'); lg.addColorStop(0.8, '#7D848B'); lg.addColorStop(1, '#2A2E33'); g.fillStyle = lg; g.fillRect(0, 0, w, h); }, 8, 32); rollerT.repeat.set(1, 0.56 / 0.05);
    const deckMat = new THREE.MeshStandardMaterial({ map: rollerT, metalness: 0.6, roughness: 0.4 }), scanWin = new THREE.MeshStandardMaterial({ color: 0x0A0C0E, roughness: 0.08, metalness: 0.3 });
    function cart(id, x, z) {
      const g = new THREE.Group(); g.position.set(x, 0, z); R.scene.add(g); g.userData.noContact = true; // it moves: no baked contact shadow left behind
      const put = (m) => { g.add(m); return m; };
      const body = put(rb(0.9, 0.22, 0.6, shellMat, 0, 0.2, 0, 0.04, 2));
      put(rb(0.92, 0.05, 0.62, M.rubber, 0, 0.115, 0, 0.02, 1)); // bumper band
      const colH = beltY - 0.33;
      const bt = bellowsT.clone(); bt.repeat.set(1, colH / 0.035); bt.needsUpdate = true;
      put(P.box(0.5, colH, 0.4, new THREE.MeshStandardMaterial({ map: bt, roughness: 0.7 }), 0, 0.31 + colH / 2, 0));
      put(P.box(0.85, 0.03, 0.56, deckMat, 0, beltY - 0.015, 0));
      for (const dz of [-0.29, 0.29]) put(P.box(0.85, 0.05, 0.02, yellow, 0, beltY + 0.025, dz));
      for (const sx of [-1, 1]) { put(rb(0.04, 0.06, 0.2, yellow, sx * 0.45, 0.2, 0, 0.006, 1)); put(P.box(0.004, 0.02, 0.16, scanWin, sx * 0.4705, 0.2, 0)); }
      const head = new THREE.MeshStandardMaterial({ color: 0xF4F7F8, emissive: 0xEAF4FF, emissiveIntensity: 0.8, roughness: 0.3 }), tail = new THREE.MeshStandardMaterial({ color: 0x5A1412, emissive: 0xE0302A, emissiveIntensity: 0.8, roughness: 0.3 });
      for (const dz of [-0.22, 0.22]) { put(P.box(0.006, 0.014, 0.08, head, 0.451, 0.265, dz)); put(P.box(0.006, 0.014, 0.08, tail, -0.451, 0.265, dz)); }
      put(P.cyl(0.03, 0.03, 0.01, yellow, -0.36, 0.315, 0.22, 16)); put(P.cyl(0.022, 0.024, 0.02, red, -0.36, 0.33, 0.22, 16));
      const tag = put(new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.1), new THREE.MeshStandardMaterial({ map: parts.labelTex(id === 'agvA' ? 'A' : 'B', { bg: '#E4E7E9', fg: '#2A2F34', size: 76, w: 160, h: 100, weight: 'bold' }), roughness: 0.6 }))); tag.position.set(0.22, 0.205, 0.3015);
      for (const [dx, dz] of [[-0.3, -0.25], [0.3, -0.25], [-0.3, 0.25], [0.3, 0.25]]) put(alongZ(P.cyl(0.08, 0.08, 0.06, M.rubber, dx, 0.08, dz, 18)));
      put(P.cyl(0.028, 0.028, 0.012, M.black, -0.4, beltY + 0.006, 0.24, 14));
      const beacon = put(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.06, 16), lensMat(0x2FBF71))); beacon.position.set(-0.4, beltY + 0.042, 0.24);
      return { id, group: g, body, beacon, head, tail, home: new THREE.Vector3(x, 0, z), blend: 0, wasLoaded: false };
    }
    const A = cart('agvA', HOME.agvA, HOME_Z), B = cart('agvB', HOME.agvB, HOME_Z);

    // packing desk with the hub, a phone, a monitor on a stand, a label printer and a tape gun
    const DX = -4.4, DZ = 2.9;
    let topY = 0.77;
    const deskModel = MOD('wooden_table_02');
    if (deskModel) { R.scene.add(deskModel); topY = placeModel(THREE, deskModel, { x: DX, z: DZ }).max.y; } else P.table(DX, DZ, 1.2, 0.6, 0.75, M.woodLight, M.steel);
    const hub = P.hub(DX - 0.2, topY, DZ, { rotY: 0.4 }); R.addPickable(hub.group, 'hub'); P.phone(DX + 0.2, topY + 0.005, DZ + 0.1, 0.3);
    {
      const screenC = document.createElement('canvas'); screenC.width = 512; screenC.height = 288; const g = screenC.getContext('2d');
      g.fillStyle = '#F4F7F8'; g.fillRect(0, 0, 512, 288); g.fillStyle = '#1F2A30'; g.fillRect(0, 0, 512, 40);
      g.fillStyle = '#29C6C0'; g.fillRect(0, 40, 512, 4); g.fillStyle = '#E8FBFF'; g.font = `600 20px ${FONT}`; g.textBaseline = 'middle'; g.fillText('Outbound · Dock 2', 16, 21);
      g.fillStyle = '#5A6A72'; g.font = `15px ${FONT}`; ['Parcel', 'Lane', 'Status'].forEach((h, i) => g.fillText(h, 16 + i * 150, 66));
      for (let i = 0; i < 6; i++) { const y = 84 + i * 28; g.fillStyle = i % 2 ? '#FFFFFF' : '#EBF1F3'; g.fillRect(10, y, 330, 26); g.fillStyle = '#2A3A42'; g.fillRect(18, y + 10, 60, 6); g.fillRect(168, y + 10, 18, 6); g.fillStyle = i < 4 ? '#2FBF71' : '#C9D3D8'; g.fillRect(318, y + 9, 16, 8); }
      g.strokeStyle = '#D7E1E4'; g.lineWidth = 14; g.beginPath(); g.arc(428, 150, 50, 0, TAU); g.stroke();
      g.strokeStyle = '#29C6C0'; g.beginPath(); g.arc(428, 150, 50, -Math.PI / 2, -Math.PI / 2 + TAU * 0.62); g.stroke();
      g.fillStyle = '#1F2A30'; g.font = `600 22px ${FONT}`; g.textAlign = 'center'; g.fillText('62%', 428, 151);
      const st = new THREE.CanvasTexture(screenC); st.colorSpace = THREE.SRGBColorSpace; st.anisotropy = 4;
      const mx = DX + 0.1, mz = DZ - 0.2;
      const mon = P.group(
        rb(0.22, 0.012, 0.16, graphite, mx, topY + 0.006, mz, 0.005, 1),
        P.box(0.045, 0.24, 0.02, graphite, mx, topY + 0.13, mz - 0.022),
        rb(0.56, 0.34, 0.024, M.anodized, mx, topY + 0.31, mz, 0.008, 2),
        (() => { const m = P.screenPlane(0.535, 0.301, st); m.material.emissiveIntensity = 0.3; m.position.set(mx, topY + 0.315, mz + 0.0125); return m; })(),
      );
      mon.userData.noContact = true;
      P.group(rb(0.17, 0.1, 0.2, panel, DX - 0.43, topY + 0.05, DZ - 0.12, 0.012, 2), P.box(0.1, 0.004, 0.06, M.black, DX - 0.43, topY + 0.1, DZ - 0.04), (() => { const l = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.04), labelMat); l.rotation.x = -0.9; l.position.set(DX - 0.43, topY + 0.104, DZ + 0.0); return P.add(l); })()); // label printer, a label coming out
      P.group(rb(0.05, 0.12, 0.03, red, DX + 0.45, topY + 0.07, DZ - 0.08, 0.008, 1), alongZ(P.cyl(0.045, 0.045, 0.05, tapeMat, DX + 0.45, topY + 0.1, DZ - 0.08, 20)), P.box(0.03, 0.07, 0.02, M.black, DX + 0.45, topY + 0.035, DZ - 0.04)); // tape gun
    }
    // spare cartons by receiving
    carton(0.5, 0.5, 0.5, KRAFT[1], -6.2, 0.25, 1.5, { label: 'front' }); carton(0.5, 0.45, 0.5, KRAFT[0], -6.2, 0.727, 1.5, { label: 'front' });
    R.addContactShadows?.({ w: 14, d: 10, y: 0.009 }); // the soft dark where racks, pallets, legs and the desk meet the floor

    for (const k of ['c1', 'c2', 'c3']) for (const o of [C[k].beltMesh, C[k].motor, C[k].rails, C[k].frame, C[k].stack, C[k].led, C[k].pb]) R.addPickable(o, k);
    for (const o of [scanHead, scanBeacon, archFrame, ctrl]) R.addPickable(o, 'scanner');
    for (const o of [gatePivot, hinge, gateLamp, gateMast, cyl, gateBracket]) R.addPickable(o, 'gate');
    R.addPickable(A.group, 'agvA'); R.addPickable(B.group, 'agvB');
    for (const o of [door, bottomBar, guides, dockHousing, dockLight, sigHousing, sigRed, sigGreen, station]) R.addPickable(o, 'dock');
    const hi = P.highlighter({
      c1: [C.c1.beltMesh, C.c1.motor, C.c1.rails, C.c1.frame], c2: [C.c2.beltMesh, C.c2.motor, C.c2.rails, C.c2.frame], c3: [C.c3.beltMesh, C.c3.motor, C.c3.rails, C.c3.frame],
      scanner: [scanHead, scanBeacon, archFrame, ctrl], gate: [gatePivot, cyl], agvA: [A.group], agvB: [B.group], dock: [door, bottomBar, guides, dockHousing, sigHousing],
    });

    // status lamps (belt beacons, gate lamp, cart beacons, dock light): unlit until their device is connected, then lit
    // in its colour at intensity k (a fault blinks)
    const RED = 0xE0563A, GREEN = 0x2FBF71, BLUE = 0x3AB7FF, AMBER = 0xFFB020, UNLIT = 0x2A2C2E;
    const setLamp = (mat, hex, k) => { if (hex == null) { mat.color.setHex(UNLIT); mat.emissive.setHex(0); mat.emissiveIntensity = 0; } else { mat.color.setHex(hex); mat.emissive.setHex(hex); mat.emissiveIntensity = k; } };
    const blink = (t, hz, on, off) => (Math.floor(t * hz) % 2 ? on : off);
    const approach = (v, to, step) => v + Math.max(-step, Math.min(step, to - v));
    const smooth = (k) => k * k * (3 - 2 * k);
    const tmp = new THREE.Vector3(), KEYS = ['c1', 'c2', 'c3'], CARTS = [A, B], spd = [0, 0, 0], tight = [false, false, false], queue = [], bp = [0, 0, 0], byX = (a, b) => b.x - a.x; // reused every frame
    let lastT = null, gateVis = 0, doorVis = 0, sent = 0, shownHmi = null; // sent: parcels diverted since the gate was last told to go to B
    initFlow();

    function load(c, onPath, cx) {
      // at the end of C1: the scanned parcel at the end stop; alongside C2: the most downstream parcel within reach
      const zone = cx < C.c1.x1 ? (p) => p.x > SX && p.x <= C.c1.x1 : (p) => p.x >= C.c2.x0 && p.x < C.c2.x1 && Math.abs(p.x - cx) <= 1.0;
      const q = onPath ? flow.filter((p) => p.lane === 'main' && zone(p)).sort((a, b) => b.x - a.x)[0] : null;
      if (q) Object.assign(q, { lane: 'up', k: 0, cart: c, fx: q.x });
      else { const w = free(); if (w) Object.assign(w, { lane: 'cart', cart: c, sn: 0 }); } // a skip left the cart short of the belt: it's simply loaded
    }
    function unload(c, onPath, cx) {
      const q = flow.find((p) => p.cart === c && (p.lane === 'cart' || p.lane === 'up')); if (!q) return;
      if (onPath && cx > C.c3.x0 + 0.2) Object.assign(q, { lane: 'down', k: 0, fx: q.mesh.position.x, fy: q.mesh.position.y, fz: q.mesh.position.z, tx: cx });
      else Object.assign(q, { lane: 'wait', cart: null });
    }

    return {
      focus: hi.focus,
      reset() { initFlow(); for (const c of [A, B]) { c.blend = 0; c.wasLoaded = false; c.group.position.copy(c.home); } gateVis = 0; doorVis = 0; sent = 0; lastT = null; ln.gen++; ln.watching = false; },
      update(s, t) {
        hi.update();
        const hush = isQuiet(); // a what-if's quiet replay and its holds: the room keeps the replayed layout, nothing moves in view
        if (!hush && !ln.watching && ln.ctx && !ln.ctx.fast) watch(ln.ctx, ln); // the tiles follow the room again after a quiet replay (the engine's own scenario too)
        // Belts follow ?speed= like the script. A frame gap counts up to 0.2 s, in steps of at most 0.05 s (× speed) for the
        // parcels: on a device rendering under 20 fps the line keeps to the script's clock instead of running slow.
        const gap = hush || lastT == null ? 0 : Math.min(0.2, Math.max(0, t - lastT)); lastT = t;
        const dt = gap * speed, subs = Math.max(1, Math.ceil(gap / 0.05 - 1e-9));
        hub.ledMat.emissiveIntensity = s.hub.status === 'on' ? (2.5 + Math.sin(t * 2.2) * 1.5) * s.hub.led : 0;
        for (let i = 0; i < 3; i++) { const st = s[KEYS[i]]; tight[i] = st.status === 'fault' && !!st.runOn; spd[i] = (st.status === 'fault' && !st.runOn) || !st.running || st.slip ? 0 : st.speed * SPEED_K; } // slip: the drive turns, the belt doesn't carry; runOn: a faulted drive keeps its last command
        // conveyor beacons
        for (const k of KEYS) { const c = C[k], st = s[k]; const bad = st.status === 'fault'; setLamp(c.led.material, st.status === 'offline' ? null : bad ? RED : beltMoving(st) ? BLUE : GREEN, bad ? blink(t, 3, 6, 0.6) : st.running ? 2.5 : 1.2); }
        // belts: the splice stripes run at the belt's speed (one stripe every 10 cm); the infeed runs with C1, lane B with C3
        for (let i = 0; i < 3; i++) { const tx = C[KEYS[i]].tex; tx.offset.x = (tx.offset.x - (spd[i] * dt) / 0.1) % 1; }
        feedTex.offset.x = (feedTex.offset.x - (spd[0] * dt) / 0.1) % 1; laneTex.offset.y = (laneTex.offset.y - (spd[2] * dt) / 0.1) % 1;
        // dock: the door rolls up while the light is green; parcels only go through a door that is open
        if (!s.dock.stuck) doorVis = hush ? (s.dock.light === 'green' ? 1 : 0) : approach(doorVis, s.dock.light === 'green' ? 1 : 0, dt / 1.2); // a stuck door stays where it is
        const lift = 0.9 * smooth(doorVis); door.scale.y = 1 - lift; door.position.y = 3.2 - 1.6 * (1 - lift);
        slatT.repeat.y = SLATS * (1 - lift); bottomBar.position.y = 3.2 * lift + 0.025; // the slats keep their 10 cm as the curtain rolls up; the bottom bar rides its foot
        const dockOpen = s.dock.light === 'green' && doorVis > 0.6;
        const dockBad = s.dock.status === 'fault'; setLamp(dockLight.material, s.dock.status === 'offline' ? null : dockBad ? RED : s.dock.light === 'green' ? GREEN : RED, dockBad ? blink(t, 4, 4, 1) : 1.5);
        const live = s.dock.status !== 'offline', go = s.dock.light === 'green' && !dockBad; // a door fault shows red, blinking
        for (const m of SIG) { const on = live && (m === sigGreen) === go; setLamp(m.material, on ? m.userData.hex : null, dockBad ? blink(t, 4, 3, 0.6) : 3); }
        // gate: swings only through a gap (nothing between C2's end stop and a little way down C3), and holds C2's
        // parcels while it moves
        const gTo = s.gate.pos;
        let zoneBusy = false; for (const p of flow) if (p.lane === 'main' && p.x > C.c2.x1 - END_STOP + 0.001 && p.x < C.c3.x0 + 0.8) { zoneBusy = true; break; }
        if (!s.gate.stuck) gateVis = hush ? gTo : !(gTo > gateVis && gateVis < 0.02 && zoneBusy) ? approach(gateVis, gTo, dt * 2.2) : gateVis; // a stuck arm stays where it is
        gatePivot.rotation.y = gateVis * 0.9;
        { // the air cylinder turns toward the paddle's lug and its rod reaches it
          const a = gateVis * 0.9, ca = Math.cos(a), sa = Math.sin(a);
          const lx = GP.x + LUG[0] * ca + LUG[1] * sa - BASE.x, lz = GP.z - LUG[0] * sa + LUG[1] * ca - BASE.z, d = Math.hypot(lx, lz);
          cyl.rotation.y = Math.atan2(-lz, lx); rod.scale.x = Math.max(0.001, d - TUBE - 0.006); clevis.position.x = d - 0.006;
        }
        const settled = Math.abs(gateVis - gTo) < 0.03 && (gTo < 0.03 || gTo > 0.97), toB = settled && gTo > 0.5;
        if (s.gate.lane !== 'B') sent = 0;
        const oneDone = () => !s.gate.all && sent >= 1; // a per-parcel swing takes one parcel; the rest wait for the gate to come back
        const gB = s.gate.lane === 'B', gateBad = s.gate.status === 'fault'; setLamp(gateLamp.material, s.gate.status === 'offline' ? null : gateBad ? RED : gB ? AMBER : GREEN, gateBad || (gB && !settled) ? blink(t, 4, 4, 1) : 2.2);
        for (let n = 0; n < subs; n++) { // the parcels, one sub-step at a time
          const dt = gap * speed / subs;
          // main-line queue, front to back
          let ahead = null;
          queue.length = 0; for (const p of flow) if (p.lane === 'main') queue.push(p); queue.sort(byX);
          for (const p of queue) {
            const si = secAt(p.x), x0 = p.x, stop = SEC[si].x1 - END_STOP; let nx = p.x + spd[si] * dt;
            const blocked = si === 0 ? spd[1] === 0 : si === 1 ? spd[2] === 0 || !settled || (toB && oneDone()) : !dockOpen;
            let crossing = false;
            if (ahead && secAt(ahead.x) === si) nx = Math.min(nx, ahead.x - (tight[si] ? ahead.hw + p.hw + 0.02 : SPACING)); // a faulted drive that runs on pushes them together
            else if (ahead) { nx = Math.min(nx, ahead.x - 0.4); crossing = ahead.x - nx < SPACING - 1e-6; } // cross into the next section only with a full gap
            if (si === 2 && x0 > stop) nx = x0 + Math.max(spd[2], INTO) * dt; // past C3's end stop it is already going through the door
            else if ((blocked || crossing) && x0 <= stop) nx = Math.min(nx, stop); // past its end stop it is already on its way over
            p.x = Math.max(p.x, nx);
            if (x0 <= SX && p.x > SX && s.scanner.armed && !s.scanner.dark) p.sn = ++ln.scanned; // a dark arch reads nothing
            if (si === 1 && toB && !oneDone() && p.x >= BPATH[0][0]) { p.lane = 'B'; p.b = 0; sent++; if (p.sn) ln.toB.add(p.sn); continue; }
            if (si === 2 && p.x > DOOR_X) { p.lane = 'wait'; ln.docked++; continue; } // into the trailer, out of sight behind the door frame
            ahead = p;
          }
          for (const p of flow) if (p.lane === 'B') { p.b += spd[2] * dt; if (p.b >= BLEN[BLEN.length - 1]) p.lane = 'wait'; }
          // every parcel counted in and the door shut: nothing is left past C1 (only matters when the visitor skipped ahead)
          if (s.dock.target && s.dock.parcels >= s.dock.target && s.dock.light !== 'green') for (const p of flow) if (p.lane === 'main' && p.x >= C.c2.x0) p.lane = 'wait';
          let tail = Infinity; for (const p of flow) if (p.lane === 'main') tail = Math.min(tail, p.x);
          if (spd[0] > 0 && !s.plan.feedStop && tail - ENTRY_X >= SPACING) put(tail === Infinity ? ENTRY_X : tail - SPACING); // exactly one gap behind, inside the hatch
        }
        // carts: ease between the parking spot and the loop; hold position once told to stop
        for (const c of CARTS) {
          const st = s[c.id];
          const onLoop = st.state === 'parked' || st.state === 'parking' ? 0 : 1; c.blend = hush ? onLoop : approach(c.blend, onLoop, dt / 0.9);
          const px = cartAt(st.u, tmp).x;
          if (st.state !== 'stopped' || st.creep) c.group.position.lerpVectors(c.home, tmp, smooth(c.blend)); // creep: it said "stopped" and kept rolling
          const onPath = c.blend > 0.75; // near enough: the transfer follows the cart as it settles
          if (st.load && !c.wasLoaded) load(c, onPath, px);
          if (!st.load && c.wasLoaded) unload(c, onPath, px);
          c.wasLoaded = !!st.load;
          const bad = st.status === 'fault'; setLamp(c.beacon.material, st.status === 'offline' ? null : bad ? RED : driving(st) ? AMBER : GREEN, driving(st) || bad ? blink(t, 4, 4, 1) : 1.5);
          c.head.emissiveIntensity = c.tail.emissiveIntensity = st.status === 'offline' ? 0 : 0.8; // an offline robot shows no head or tail lights
        }
        // parcels: belt ↔ deck transfers, then place every mesh
        for (const p of flow) if (p.lane === 'up' || p.lane === 'down') { p.k = Math.min(1, p.k + dt / 0.35); if (p.k >= 1) { if (p.lane === 'up') p.lane = 'cart'; else Object.assign(p, { lane: 'main', x: p.tx, cart: null }); } }
        for (const p of flow) {
          const m = p.mesh; m.visible = p.lane !== 'wait'; m.scale.x = 1;
          if (p.lane === 'main') { // only the part inside the room shows, so a parcel slides out of the hatch and into the trailer
            const lo = Math.max(p.x - p.hw, IN_X), hi = Math.min(p.x + p.hw, OUT_X);
            if (hi - lo < 0.004) m.visible = false; else { m.scale.x = (hi - lo) / (2 * p.hw); m.position.set((lo + hi) / 2, p.y0, LZ); }
          }
          else if (p.lane === 'B') { bAt(p.b, bp); m.position.set(bp[0], p.y0 - bp[2], bp[1]); }
          else if (p.lane === 'cart') { const g = p.cart.group.position; m.position.set(g.x, p.y0 - 0.03, g.z); }
          else if (p.lane === 'up') { const g = p.cart.group.position, e = smooth(p.k); m.position.set(p.fx + (g.x - p.fx) * e, p.y0 - 0.03 * e + 0.07 * Math.sin(Math.PI * e), LZ + (g.z - LZ) * e); }
          else if (p.lane === 'down') { const e = smooth(p.k); m.position.set(p.fx + (p.tx - p.fx) * e, p.fy + (p.y0 - p.fy) * e + 0.07 * Math.sin(Math.PI * e), p.fz + (LZ - p.fz) * e); }
        }
        // scanner: the beam stays on while armed (it keeps logging); amber once its reads are no longer trusted
        const bad = s.scanner.status === 'fault'; scanLine.visible = !!s.scanner.armed && !s.scanner.dark;
        setLamp(scanBeacon.material, s.scanner.status === 'offline' ? null : bad ? RED : GREEN, bad ? blink(t, 3, 6, 0.6) : s.scanner.armed ? 2.5 : 1.2);
        scanLine.material.color.set(bad ? 0xFFB020 : 0xFF3030); scanLine.material.emissive.set(bad ? 0xFFA010 : 0xFF2020); scanLine.material.opacity = bad ? 0.45 : 0.5 + 0.3 * Math.abs(Math.sin(t * 6));
        // the arch's light curtains and illumination glow while it is armed and seeing; its screen shows the mode and the count
        const seeing = !!s.scanner.armed && !s.scanner.dark && s.scanner.status !== 'offline';
        curtainMat.emissiveIntensity = seeing ? 0.8 : 0; illumMat.emissiveIntensity = seeing ? 1.4 : 0;
        const mode = s.scanner.status === 'offline' || s.scanner.dark ? 'off' : bad ? 'fault' : s.scanner.armed ? 'armed' : 'idle', nScan = Math.max(0, Math.round(s.scanner.count)), nBad = Math.round(s.scanner.misreads || 0), key = `${mode}:${nScan}:${nBad}`;
        if (key !== shownHmi) { shownHmi = key; drawHmi(mode, nScan, nBad); }
      },
    };
  },

  prompts: [
    {
      chip: 'Move today\'s 40 outbound parcels from receiving to dock 2, scanning each one.',
      keywords: ['move', 'parcels', 'outbound', 'dock', 'scanning', 'scan', 'receiving', 'ship', 'boxes', 'orders', '40', 'start', 'restart'],
      avoid: ['close', 'closed', 'shut', 'lock', 'locked'], // routing (js/engine/match.js): "close the dock" never runs a plan that opens it
      rulesOut: ['gate', 'gates'], // "move the gate" is about the sorter gate, not these 40 parcels: it asks back
      expect: { 'dock.parcels': 40, 'scanner.count': 40, 'dock.light': 'red', 'dock.shut': true, 'c1.running': false, 'c2.running': false, 'c3.running': false, 'scanner.armed': false, 'agvA.state': 'parked', 'agvB.state': 'parked', 'c2.status': 'online' },
      steps: [
        { beat: 'plan' },
        { status: 'Line idle · waiting for your approval' },
        { say: 'Three conveyors, a scanner, a gate, two carts and the dock. Here\'s the sequence — nothing moves until you approve it.' },
        { plan: { intro: 'Plan for 40 parcels:', steps: [
          { text: 'Arm the scanner first; every parcel is scanned on C1 or it doesn\'t leave C1' },
          { text: 'Start C1, C2, C3 at 0.5 m/s, in that order, about a second apart' },
          { text: 'Gate stays on lane A (straight through)' },
          // says "open": the room rolls the door up, and routing (match.js) reads it, so "…but keep the dock closed" asks back
          { text: 'Open dock 2 (light green) once the first parcel is on C3; close it (red) when the count hits 40', alt: { text: 'Open dock 2 (light green) now, before parcels arrive; close it (red) when the count hits 40', apply: [{ set: 'plan.earlyGreen', to: true }] } },
          { text: 'Carts A and B stay parked unless a conveyor drops out' },
        ] } },
        { beat: 'run' },
        { fn: ({ store }) => { if (store.get('plan.earlyGreen')) store.set('dock.light', 'green'); } },
        { set: 'scanner.armed', to: true, label: 'Scanner armed' }, { wait: 400 },
        { failPoint: 'start' },
        ...P0_START,
        P0_OPEN,
        P0_AT16,
        { failPoint: 'midRun' },
        ...P0_TO36,
        { failPoint: 'late' },
        ...P0_TO40,
        { failPoint: 'lastLeg' },
        ...P0_ALL_IN,
        ...P0_HALT,
        { failPoint: 'close' },
        ...P0_CLOSE,
        { say: '40 of 40 at dock 2, and all 40 scanned. Dock 2 is closed, confirmed by its door switch. Line stopped; the carts never left their bays.' },
        { status: 'Done · 40 of 40 at dock 2 · line stopped' },
        { end: { headline: '40 scanned, 40 at dock 2, door shut.', body: 'NeuCharBox ran the line in the order you approved, counted every parcel at the arch and again at the door, and closed dock 2 when the two counts agreed.' } },
      ],
      whatIf: {
        c1: { at: 'start', intro: 'Replaying this request. This time, conveyor C1 doesn\'t start.', steps: [
          lead('C1 → 0.5 m/s · waiting for C1'),
          { wait: 1600 },
          { status: 'C1 → 0.5 m/s · no answer · sent again' },
          { wait: 1400 },
          { fail: 'c1', faultText: 'no response', title: '⚠ C1 didn\'t start', say: 'C1 hasn\'t answered the start command, sent twice, and the arch hasn\'t seen a single parcel, so the belt hasn\'t moved either.' },
          { wait: 1500 },
          { say: 'I start the belts one at a time and wait for each to answer. C1 didn\'t, so I stopped there: C2 and C3 were never started.' },
          { say: 'I\'ve cancelled C1\'s start and sent it a stop, in case it wakes up with someone at it. The carts can\'t help: they pick up at the end of C1, and nothing has reached it.' },
          { fn: ({ store, say }) => say(store.get('plan.earlyGreen')
            ? 'Dock 2 stays open, as you asked, with nothing coming yet. The scanner stays armed at 0, so the count starts at parcel 1 whenever C1 runs.'
            : 'Dock 2 stays closed: your plan opens it when the first parcel reaches C3. The scanner stays armed at 0, so the count starts at parcel 1 whenever C1 runs.') },
          replanWith((st) => ({ intro: 'Not started:', changes: ['C1: start sent twice, no answer; start cancelled and a stop sent; the belt hasn\'t moved', 'C2 and C3: not started', st.get('plan.earlyGreen') ? 'Dock 2 open, as you asked, until 40 or until you say' : 'Dock 2 closed until parcels reach C3', 'Scanner armed · 0 scanned · carts parked'], needsYou: 'C1 isn\'t answering. Switch it off at its power switch before anyone works on it, then check its drive. Ask me to start the run again once it answers.' })),
          { status: 'Line idle · C1 flagged' },
          HOLD,
          { end: { headline: 'C1 never started, so nothing else did.', body: 'NeuCharBox waits for each belt to answer before starting the next. When C1 didn\'t, it stopped there, cancelled the start, and handed you a line with nothing to undo.' } },
        ] },
        c2: { at: 'midRun', intro: 'Replaying this request. This time, conveyor C2 trips as parcel 17 reaches the arch.', steps: [
          lead('Line running · parcel 17 coming up to the arch'),
          // C2's motor trips as parcel 17 crosses the beam, with 14–16 on C2 (a skip lays that out)
          { fn: async (ctx) => { if (!await until(ctx, (l) => l.scanned >= 17)) jump(ctx.store, 17); ctx.store.set('c2.running', false); ctx.store.set('c2.speed', 0); } },
          { fail: 'c2', title: '⚠ C2 motor fault', say: 'C2 motor fault at parcel 17. C2 has stopped with 3 parcels on it. C1 and C3 are still running.' },
          { say: 'Re-planning around C2, not stopping the line:' },
          { replan: { intro: 'New routing:', changes: ['C1, C3 and dock 2 carry on; every parcel scanned', 'Carts A and B shuttle parcels from the end of C1 to C3, one each, alternating', 'Slower: new finish estimate 21 minutes, up from 14', 'The carts pick up C2\'s 3 stranded parcels last'], needsYou: 'C2\'s motor needs a look — overload trip or a jammed roller. I won\'t restart it on my own.' } },
          { set: 'agvA.u', to: 0 }, { set: 'agvB.u', to: uBack(HOME.agvB) }, { set: 'agvA.state', to: 'moving' }, { set: 'agvB.state', to: 'moving', label: 'Carts A and B → the line' },
          { fn: async (ctx) => {
            const { store, chat, tween, sleep, status } = ctx;
            const run = async (n, out, back) => {
              status(`Cart run ${n} of 24`);
              store.set(`${out}.load`, true);
              if (n === 24) { store.set('c1.running', false); store.set('c1.speed', 0); }
              const ms = legMs(BACK);
              await Promise.all([tween(`${out}.u`, 1, ms), tween(`${back}.u`, 2, ms)]);
              store.set(`${out}.load`, false); store.set(`${back}.u`, 0);
            };
            await sleep(900);
            await run(1, 'agvA', 'agvB');
            store.set('plan.feedStop', true);
            const line = lineOf.get(store); if (line) { line.cut(1, 40, 37); sync(store, line); } else { store.set('scanner.count', 40); store.set('dock.parcels', 36); }
            status('Time-lapse · runs 2–23 skipped'); chat.ncb('(Time-lapse: runs 2 to 23 skipped — same routine, one parcel per run.)');
            await sleep(400);
            await run(24, 'agvB', 'agvA');
          } },
          { status: 'C1 done · the carts turn to C2' },
          { say: 'All 40 scanned. C1 is done and stopped, and C3 is taking its last parcels to dock 2. Now the 3 on C2.' },
          { fn: async (ctx) => {
            const { store, tween, sleep, status } = ctx;
            const park = async (id) => { store.set(`${id}.state`, 'parking'); await until(ctx, (l) => l.inBay(id), 4000); store.set(`${id}.state`, 'parked'); };
            const xs = lineOf.get(store)?.c2() ?? [], at = [0.5, -0.5, -1.5].map((x, i) => xs[i] ?? x);
            const trips = [['agvA', 'agvB'], ['agvB', 'agvA'], ['agvA', 'agvB']];
            for (const [i, [out, back]] of trips.entries()) {
              const last = i === trips.length - 1;
              status(`C2 parcel ${i + 1} of 3 → C3`);
              const ret = last ? tween(`${back}.u`, uBack(HOME[back]), legMs(backTo(HOME[back]))).then(() => park(back)) : tween(`${back}.u`, 2, legMs(BACK));
              await tween(`${out}.u`, uOut(at[i]), legMs(at[i] - X_PICK));
              store.set(`${out}.load`, true); await sleep(350);
              await tween(`${out}.u`, 1, legMs(X_DROP - at[i]));
              store.set(`${out}.load`, false);
              await ret; if (!last) store.set(`${back}.u`, 0);
            }
            // cart A heads home while C3 clears its last parcels to dock 2 (both before the line stops)
            const home = tween('agvA.u', uBack(X_PICK), legMs(backTo(X_PICK))).then(() => park('agvA'));
            status('C3 clearing to dock 2');
            if (!await until(ctx, (l) => l.docked >= 40, 12000)) jump(store, 40, 10, 40); // a skip: all 40 through the door, nothing left on the belts
            await home;
          } },
          ...P0_HALT, ...P0_CLOSE,
          { say: '40 of 40 at dock 2, all scanned. Line stopped, carts parked. C2 is still flagged.' },
          { status: 'Line stopped · C2 flagged' },
          HOLD,
          { end: { headline: 'One unit failed. The line didn\'t.', body: 'NeuCharBox re-routed around the fault using what was still working, kept every parcel scanned, and told you the new finish time and what to fix.' } },
        ] },
        c3: { at: 'lastLeg', intro: 'Replaying this request. This time, conveyor C3\'s belt slips near the end of the run.', steps: [
          lead('C2 and C3 taking the last 7 to dock 2', (st) => st.set('c3.slip', true)), // the belt stops carrying before the next frame
          { wait: 3000 },
          { fail: 'c3', faultText: 'belt not moving', title: '⚠ C3 not carrying', say: 'C3 says it\'s running at 0.5 m/s, but nothing has reached dock 2 for 3 seconds. At this pace a parcel should arrive about every second.' },
          { wait: 1500 },
          { say: 'I believe the dock count, not the drive. Stopping C2, so nothing piles up behind C3, and C3 itself, so its belt can\'t suddenly grip again and jolt what\'s on it.' },
          halt(['c2', 'c3'], 1200),
          { wait: 600 },
          { say: 'All 40 scanned, 33 at dock 2. The other 7 are on the line, all scanned: 6 on C3 and the 40th on C2. Dock 2 stays open for them.' },
          { say: 'The carts can\'t help this time: they hand parcels onto C3, and C3 is the belt that isn\'t moving.' },
          { replan: { intro: 'Stopped short of the dock:', changes: ['C3 flagged: its drive said 0.5 m/s, its belt wasn\'t carrying', 'C2 stopped; C3\'s drive stopped (its belt wasn\'t moving anyway); C1 had already finished', '33 at dock 2; the other 7, all scanned, on C3 and C2', 'Dock 2 stays open for the last 7'], needsYou: 'Check C3\'s belt tension and drive roller before anyone restarts it. When it moves again, I\'ll count the last 7 in at the door.' } },
          { status: 'Line stopped · C3 flagged · 33 of 40 at dock 2' },
          HOLD,
          { end: { headline: 'It believed the dock count, not the drive.', body: 'C3\'s drive said it was running while nothing reached the door. NeuCharBox went by the count at the door, stopped the belts, and told you exactly where the last 7 parcels are.' } },
        ] },
        scanner: { at: 'midRun', intro: 'Replaying this request. This time, the scanner arch goes dark in the middle of the run.', steps: [
          lead('Line running · 16 scanned'),
          // the arch goes dark as parcel 16 leaves C1 (a skip: that layout)
          { fn: async (ctx) => { if (!await until(ctx, (l) => l.offC1(16), 4000)) jump(ctx.store, 16, 0.7); } },
          { set: 'scanner.dark', to: true }, // beam off, no more reads: the visitor sees it go out
          { parallel: [
            { fail: 'scanner', faultText: 'not answering', title: '⚠ Scanner silent', say: 'The scanner arch stopped answering: no reads, and no sign of life when I check on it.' },
            { set: 'c1.running', to: false }, { set: 'c1.speed', to: 0 }, // C1 stops in the same instant
          ] },
          { wait: 1500 },
          { say: 'C1 stopped the moment the arch went quiet. The last label it read was parcel 16. Your plan says nothing leaves C1 unscanned, so the other 24 stay on C1 and at receiving.' },
          { say: 'Parcels 1 to 16 were all read before that. C2 and C3 are taking them on to dock 2, and the door count will show each one in. The carts stay parked: they could lift parcels off C1, but none of those has been scanned.' },
          { fn: (ctx) => toDock(ctx, 16) },
          halt(['c2', 'c3'], 1000),
          { say: '16 scanned, 16 at dock 2: every parcel that was read is in. C2 and C3 are empty, so I\'ve stopped them. Dock 2 stays open for the other 24.' },
          { replan: { intro: 'Held at the arch:', changes: ['C1 stopped the moment the arch went quiet; the next parcel waits on C1, unscanned', 'Parcels 1 to 16, all read, delivered: 16 at dock 2', 'C2 and C3 stopped once empty; dock 2 open for the other 24', 'Carts parked: nothing unscanned leaves C1'], needsYou: 'The arch isn\'t answering: check its power and its cable. When it\'s back, I\'ll restart C1, and every parcel from 17 on gets read.' } },
          { status: 'Line held · scanner flagged · 16 of 40 at dock 2' },
          HOLD,
          { end: { headline: 'The scans stopped, so C1 stopped.', body: 'Your plan said nothing leaves C1 unscanned. When the arch went quiet, NeuCharBox stopped C1 at once, let the 16 scanned parcels reach the dock, and kept the rest on C1.' } },
        ] },
        gate: { at: 'midRun', intro: 'Replaying this request. This time, the sorter gate goes quiet in the middle of the run.', steps: [
          lead('Line running · gate on lane A'),
          { wait: 1200 },
          { fn: ({ store }) => { const n = lineOf.get(store)?.nextToGate(); gateCheck.set(store, n ?? Math.max(1, Math.round(store.get('scanner.count')) - 3)); } }, // the next parcel to reach the gate, at the fault
          { fail: 'gate', faultText: 'not answering', title: '⚠ Gate not answering', say: 'The sorter gate stopped answering. Its last report was lane A, straight through, where your plan keeps it.' },
          { wait: 1500 },
          { fn: async (ctx) => {
            const { store, chat, say, sleep } = ctx; const n = gateCheck.get(store);
            await say(`I can't ask the gate where its arm is, so I'm checking the parcels instead. Parcel ${n} was the first to pass the gate since it went quiet: if the arm is clear, it reaches dock 2 in a few seconds, on time.`);
            await toDock(ctx, n);
            await say(`Parcel ${n} is at dock 2, on time, and so is every parcel before it. The arm isn't in the way, so the run goes on. If the door count ever falls behind, I stop C1 and C2 at once.`);
            chat.replan({ intro: 'Carrying on, watching the gate:', changes: ['Gate flagged: not answering; last report lane A', `Checked by the door count: parcel ${n} arrived on time`, 'Run unchanged: 0.5 m/s, every parcel scanned, dock closes at 40', 'If the door count falls behind, C1 and C2 stop'], needsYou: 'The gate isn\'t answering. Have someone check its controller after the run; the run doesn\'t need it to move.' });
            await sleep(700);
          } },
          { status: 'Line running · gate flagged' },
          { wait: 1200 },
          ...P0_LAPSE_TO_END,
          ...P0_HALT,
          ...P0_CLOSE,
          { say: '40 of 40 at dock 2, all scanned, each one on time at the door. The door is down; its switch agrees. The gate is still flagged.' },
          { status: 'Line stopped · gate flagged' },
          HOLD,
          { end: { headline: 'It checked the gate by counting parcels.', body: 'When the gate went quiet, NeuCharBox didn\'t guess where its arm was. It watched the next parcel past the gate reach the dock on time, kept the run going, and flagged the gate for later.' } },
        ] },
        agvA: { at: 'midRun', intro: 'Replaying this request. This time, cart A stops answering while it waits in its bay.', steps: [
          lead('Line running · carts parked'),
          { wait: 1500 },
          { fail: 'agvA', faultText: 'not answering', title: '⚠ Cart A not answering', say: 'Cart A stopped answering in its bay. Its last report: parked, brakes on.' },
          { wait: 1500 },
          { say: 'The run doesn\'t need the carts: they\'re the standby in case a conveyor drops out. So the line keeps going, and I won\'t send cart A anything until it answers.' },
          { say: 'The standby is now cart B alone. If a conveyor dropped out, one cart would shuttle at half the rate of two, so the finish would be later.' },
          { replan: { intro: 'Carrying on, one cart down:', changes: ['Cart A flagged: not answering, last report parked in its bay', 'Same pace: 14 minutes, every parcel scanned', 'Standby if a conveyor drops out: cart B only', 'Nothing sent to cart A until it answers'], needsYou: 'Check cart A in its bay, its power or its network link. Nothing needs it unless a conveyor drops out.' } },
          { status: 'Line running · cart A flagged' },
          { wait: 1500 },
          ...P0_LAPSE_TO_END,
          ...P0_HALT,
          ...P0_CLOSE,
          { say: '40 of 40 at dock 2, all scanned. Dock 2 is shut; its door switch says so. Cart B never had to step in; cart A is still flagged.' },
          { status: 'Line stopped · cart A flagged' },
          HOLD,
          { end: { headline: 'It noticed the spare was gone.', body: 'Cart A stopped answering while it waited as the standby. NeuCharBox kept the run going, stopped relying on cart A, and told you the backup was down to one cart.' } },
        ] },
        agvB: { at: 'late', intro: 'Replaying this request. This time, cart B latches a safety stop in its bay, near the end of the run.', steps: [
          lead('Line running · the last parcels coming through'),
          { wait: 1200 },
          { fail: 'agvB', faultText: 'bumper stop', title: '⚠ Cart B safety stop', say: 'Cart B reports its front bumper was pressed, in its bay. It has latched its safety stop, as it should: it won\'t move until a person resets it on the cart.' },
          { wait: 1500 },
          { say: 'I can\'t reset that from here, and I wouldn\'t: whatever pressed the bumper, someone should see it first. The run doesn\'t need cart B, so the last parcels carry on to the dock.' },
          { replan: { intro: 'Finishing without cart B:', changes: ['Cart B: safety stop latched in its bay; flagged', 'Line unchanged: the last parcels to dock 2, then it closes at 40', 'Standby if a conveyor drops out: cart A only'], needsYou: 'Walk over to cart B\'s bay, check what pressed its bumper, then reset it on the cart. Nothing here needs it before then.' } },
          ...P0_TO40,
          ...P0_ALL_IN,
          ...P0_HALT,
          ...P0_CLOSE,
          { say: '40 of 40 at dock 2, all scanned. Door down, confirmed by its switch. Cart B is still in its safety stop, waiting for a person.' },
          { status: 'Line stopped · cart B flagged' },
          HOLD,
          { end: { headline: 'A safety stop waits for a person.', body: 'Cart B latched its own safety stop in its bay. NeuCharBox finished the run without it and left the reset to someone on site, who can see what happened.' } },
        ] },
        dock: { at: 'close', intro: 'Replaying this request. This time, dock 2\'s door won\'t close when the run is done.', steps: [
          lead('Dock 2 → closed', (st) => st.set('dock.stuck', true)), // the door won't move from here
          { set: 'dock.shut', to: false }, { set: 'dock.light', to: 'red' },
          { wait: 1600 },
          { fail: 'dock', faultText: 'door still open', title: '⚠ Door not closed', say: 'Dock 2\'s light is red, but its door hasn\'t moved: it should be down by now, and its bottom switch still reads open.' },
          { wait: 1500 },
          { say: 'All 40 are through and C2 and C3 are stopped, so nothing more needs that door. I haven\'t sent the close again: a door that doesn\'t move may have something in its way, and I can\'t see the doorway from here.' },
          { set: 'scanner.armed', to: false, label: 'Scanner disarmed · dock 2 still open' },
          { say: 'I won\'t call dock 2 closed. The red light is only what I asked for; the door switch says open.' },
          { replan: { intro: 'Run done, dock open:', changes: ['40 of 40 at dock 2, all scanned', 'Line stopped: C1, C2 and C3 at 0, scanner disarmed, carts parked', 'Dock 2: close sent once; door still up; light red', 'Reported as open until its switch says closed'], needsYou: 'Check the doorway, then close dock 2 from its own control and check its drive. Until its switch reads closed, I\'ll report the dock as open.' } },
          { status: 'Line stopped · dock 2 flagged · door open' },
          HOLD,
          { end: { headline: 'Closed on command isn\'t closed.', body: 'All 40 parcels made it, but dock 2\'s door never came down. NeuCharBox didn\'t force it, and reported the dock as open because the door switch said so, whatever the light showed.' } },
        ] },
      },
    },
    {
      chip: 'Divert anything scanned as fragile to lane B.',
      keywords: ['divert', 'fragile', 'lane', 'b', 'sort', 'route', 'separate', 'glass'], // not 'gate': "close the gate" or "check the gate" alone isn't this rule
      // routing (js/engine/match.js): other kinds of parcel than fragile ("divert anything heavy") are not this rule, and
      // neither is all of them ("divert everything to lane B", "send every box to lane B"): it diverts fragile ones only
      rulesOut: ['everything', 'every', 'all', 'whole', 'entire', 'each', 'any', 'full', 'rest', 'lot', 'some', 'most', 'half', 'heavy', 'heavier', 'large', 'big', 'bigger', 'oversized', 'bulky', 'damaged', 'liquid', 'liquids', 'urgent', 'express', 'priority', 'perishable', 'frozen'],
      expect: { 'gate.lane': 'A', 'gate.pos': 0, 'gate.all': false, 'scanner.misreads': 0, 'scanner.status': 'online', 'scanner.count': 22, 'dock.light': 'green', 'c1.running': true, 'c2.running': true, 'c3.running': true },
      steps: [
        { beat: 'plan' },
        { status: 'Line idle · waiting for your approval' },
        { say: 'The scanner reads the label; the gate does the diverting. The important part is what happens when the scanner can\'t read a label.' },
        { plan: { intro: 'Plan:', steps: [
          { text: 'Open dock 2, arm the scanner, start the line' },
          { text: 'Label says FRAGILE → gate to lane B for that parcel, back to A after it passes' },
          { text: 'Label unreadable → treat it as fragile: lane B for a human check', alt: { text: 'Label unreadable → stop C1 and wait for a person', apply: [{ set: 'plan.stopOnMisread', to: true }] } },
          { text: 'If more than 1 in 10 labels are unreadable, stop trusting the scanner and tell you' },
        ] } },
        { beat: 'run' },
        { set: 'dock.target', to: 0 }, // no count to reach here: the dock tile counts on while the line runs
        { set: 'dock.light', to: 'green' }, { set: 'scanner.armed', to: true }, { set: 'c1.running', to: true }, { set: 'c1.speed', to: 0.5 }, { set: 'c2.running', to: true }, { set: 'c2.speed', to: 0.5 }, { set: 'c3.running', to: true }, { set: 'c3.speed', to: 0.5, label: 'Dock 2 open, scanner armed, line running' },
        { fn: (ctx) => watch(ctx) },
        { say: 'Line running. Reading every label.' },
        P1_TEN,
        { failPoint: 'divert10' },
        { fn: (ctx) => divert(ctx, 10) },
        P1_AT14,
        { failPoint: 'after10' },
        P1_SEVENTEEN,
        { fn: (ctx) => divert(ctx, 17) },
        P1_AT22,
        { failPoint: 'sorted' },
        { fn: ({ store, say }) => say(`Parcels 10 and 17 were fragile and went to lane B; every other label read clean. None was unreadable, so your rule for that (${store.get('plan.stopOnMisread') ? 'stop C1 and wait for a person' : 'lane B for a human check'}) never had to act. It stays on.`) },
        { status: 'Sorting on · 2 to lane B so far' },
        { end: { headline: 'Two fragile parcels found, both in lane B.', body: 'NeuCharBox read every label at the arch, swung the gate for parcels 10 and 17 only, and sent everything else on toward dock 2. Your rule for unreadable labels stayed ready in case one came.' } },
      ],
      genericAt: 'sorted', // the carts (the engine's own scenario): after the sort, so none of it is fast-forwarded in view
      whatIf: {
        c1: { at: 'after10', intro: 'Replaying this request. This time, conveyor C1 trips just after a fragile parcel goes under the arch.', steps: [
          lead('Sorting · parcel 10 in lane B'),
          P1_SEVENTEEN, // parcel 17 crosses the beam: FRAGILE, as in the clean run
          { wait: 300 },
          { fail: 'c1', title: '⚠ C1 motor fault', say: 'C1\'s motor tripped. C1 has stopped with parcel 17 on it, just past the arch, and parcel 17 is the fragile one.' },
          { wait: 1500 },
          { say: 'I\'m keeping parcel 17 marked fragile. When C1 runs again, the gate takes it to lane B as planned.' },
          { say: 'C2 and C3 carry on: everything on them has already been read as not fragile, so it goes to dock 2 as planned.' },
          { fn: (ctx) => toDock(ctx, 15) },
          halt(['c2', 'c3'], 1000),
          { say: '17 scanned: 15 at dock 2, parcel 10 in the lane B tote, parcel 17 on C1. C2 and C3 are empty, so I\'ve stopped them.' },
          { replan: { intro: 'Holding for C1:', changes: ['C1 stopped on a motor fault, fragile parcel 17 on it', 'Parcel 17 stays marked fragile: lane B when C1 runs', 'C2 and C3 cleared to dock 2, then stopped: 15 delivered, parcel 10 in the tote', 'Scanner, gate and sorting rule unchanged'], needsYou: 'C1\'s motor needs a look; the restart is yours to call. If you lift parcel 17 off by hand, please put it in the lane B tote, not on to the dock.' } },
          { status: 'C1 flagged · fragile parcel 17 waiting on C1' },
          HOLD,
          { end: { headline: 'The fragile one kept its label.', body: 'C1 stopped with a fragile parcel on it. NeuCharBox kept that parcel\'s sort, let the sorted ones finish, and told you where each of the 17 is.' } },
        ] },
        c2: { at: 'after10', intro: 'Replaying this request. This time, conveyor C2 stalls in the middle of the sorting.', steps: [
          lead('Sorting · parcel 10 in lane B'),
          // C2's motor trips as parcel 15 crosses the beam, with 12–14 on C2 (a skip lays that out)
          { fn: async (ctx) => { if (!await until(ctx, (l) => l.scanned >= 15)) jumpSorted(ctx.store, 15); ctx.store.set('c2.running', false); ctx.store.set('c2.speed', 0); } },
          { fail: 'c2', title: '⚠ C2 stopped mid-sort', say: 'C2\'s motor tripped as parcel 15 went under the arch. C2 has stopped with parcels 12, 13 and 14 on it. None of them is fragile.' },
          { set: 'c1.running', to: false }, { set: 'c1.speed', to: 0 }, // at once: nothing is pushed onto a stopped C2
          { wait: 1500 },
          { say: 'C1 is stopped too, so nothing gets pushed onto C2. C3 carries on: its parcels have all been through the gate, so they go to dock 2 as planned.' },
          { say: 'The carts could move parcels around C2, but they can only set them down on C3, past the gate, where nothing could send a fragile one to lane B. So they stay parked, and the line waits.' },
          { fn: (ctx) => toDock(ctx, 10) },
          halt(['c3'], 1000),
          { say: '15 scanned: ten delivered to dock 2, parcel 10 in the lane B tote, 12 to 14 on C2, and 15 on C1. C3 is empty and stopped; dock 2 stays open.' },
          { replan: { intro: 'Held for C2:', changes: ['C2 stopped on a motor fault, with 12, 13 and 14 on it, none fragile', 'C1 stopped behind it: parcel 15 read, not fragile', 'C3 cleared to dock 2 and stopped: ten delivered; parcel 10 in the lane B tote', 'Carts parked: they would bypass the gate'], needsYou: 'C2\'s motor needs checking before anything restarts. When it runs, I\'ll start C3, then C2, then C1, so every parcel reaches the gate in order.' } },
          { status: 'Line held · C2 flagged' },
          HOLD,
          { end: { headline: 'It kept the carts out of the sort.', body: 'With C2 down, the carts could have moved parcels on, but past the gate. NeuCharBox held the line instead, so every parcel that reached the dock had been through the gate.' } },
        ] },
        c3: { at: 'after10', intro: 'Replaying this request. This time, conveyor C3 goes quiet in the middle of the sorting.', steps: [
          lead('Sorting · parcel 10 in lane B', (st) => st.set('c3.runOn', true)), // once faulted, its drive keeps its last command
          { wait: 1400 },
          { parallel: [
            { fail: 'c3', faultText: 'not answering', title: '⚠ C3 not answering', say: 'C3 stopped answering: no reports, and nothing back when I check on it.' },
            halt(['c1', 'c2'], 1000), // at once, unlabelled: nothing more goes onto C3
          ] },
          { wait: 900 },
          { say: 'It\'s still carrying, though: parcels keep reaching dock 2, about one a second. I can\'t stop C3 from here, so I\'ve stopped C1 and C2: nothing more goes onto it.' },
          // C3 carries its last parcel out (a skip: what was on C3 is through the door)
          { fn: async (ctx) => { if (!await until(ctx, (l) => !l.onC3(), 15000)) { const line = lineOf.get(ctx.store); if (line) { line.deliver(line.docked + line.riding()); sync(ctx.store, line); } } } },
          { say: 'C3 has carried its last parcel through and is running empty. Dock 2 stays open while it runs: anything that ends up on it would be pushed into a closed door.' },
          replanWith((st) => { const { n, d } = counts(st); return { intro: 'Holding what I can stop:', changes: ['C3 flagged: not answering; still running, going by the dock count', 'C1 and C2 stopped: nothing more goes onto C3', `${n} scanned: ${d} at dock 2, parcel 10 in the lane B tote, ${n - d - 1} waiting on C1 and C2`, 'Dock 2 open while C3 runs'], needsYou: 'Press the stop button on C3 itself, then have its network link checked. Tell me when it stops, and I\'ll check that the dock count has stopped too.' }; }),
          { status: 'Line held · C3 flagged, running empty' },
          HOLD,
          { end: { headline: 'It stopped feeding the belt it couldn\'t stop.', body: 'C3 went quiet but kept running, and the dock count showed it. NeuCharBox stopped the belts it could still control, so nothing more went onto C3, and told you where to stop it by hand.' } },
        ] },
        scanner: { at: 'after10', intro: 'Replaying this request. This time, the scanner arch struggles to read labels.', steps: [
          lead('Sorting · parcel 10 in lane B'),
          // parcel 15 can't be read, and neither can 17: the rule you approved decides (unchanged)
          { fn: async (ctx) => {
            const { store, chat } = ctx;
            if (!await until(ctx, (l) => l.scanned >= 15)) jumpSorted(store, 15);
            store.set('scanner.misreads', 1);
            if (store.get('plan.stopOnMisread')) { store.set('c1.running', false); store.set('c1.speed', 0); return; } // parcel 15 stays on C1
            chat.ncb('Parcel 15 — label unreadable. Treating it as fragile: lane B.'); ctx.status('Parcel 15 unreadable · lane B at the gate');
            if (!await until(ctx, (l) => l.scanned >= 17)) jumpSorted(store, 17);
            store.set('scanner.misreads', 2);
          } },
          { fn: ({ store, chat }) => {
            if (!store.get('plan.stopOnMisread')) { chat.alert('Parcels 15 and 17 were unreadable — 2 in the last 10. That\'s over the 1-in-10 line you set.', '⚠ Scanner not trusted'); return; }
            chat.alert('Parcel 15\'s label is unreadable. C1 is stopped, as you chose — parcel 15 stays on C1 until a person reads it.', '⚠ Label unreadable');
            store.set('scanner.faultNote', 'slow reads · 4 of last 10'); // the evidence, on the tile and the status line from the fault below
          } },
          { fail: 'scanner' },
          // default plan: the hold starts as parcel 15, the first unreadable one, comes up to the gate, so 15 is the first to go
          // down lane B (a move that lands at the fault: unlabelled). Without a room: the counts.
          { fn: async (ctx) => {
            const { store, tween } = ctx; if (store.get('plan.stopOnMisread')) return;
            if (!await until(ctx, (l) => { const p = l.find(15); return !p || p.lane !== 'main' || p.x >= GATE_CALL_X; }, 15000)) jumpSorted(store, 17, 0.71);
            store.set('gate.all', true); store.set('gate.lane', 'B'); await tween('gate.pos', 1, 700);
          } },
          { wait: 1200 },
          { fn: ({ store, say }) => say(store.get('plan.stopOnMisread')
            ? 'The arch is also slow on labels it did read: it needed three or more tries on 4 of its last 10. Your line is about unreadable labels, and this is only one, so the rule stands. But I\'ve flagged the arch for a check. C1 stays stopped, as you chose.'
            : 'I\'ve stopped trusting the scanner as a sorter. Every parcel goes to lane B for a human check until it\'s fixed — that\'s the safe direction, not the fast one.') },
          { status: (st) => (st.get('plan.stopOnMisread') ? 'C1 held · parcel 15 needs a person · scanner flagged' : 'Gate held on lane B · every parcel · scanner flagged') },
          { wait: 1000 },
          { fn: async (ctx) => {
            const { store, say } = ctx;
            if (!store.get('plan.stopOnMisread')) { if (ctx.fast) { const l = lineOf.get(store); if (l) for (const k of [15, 16, 17]) l.intoTote(k); } await say('Parcels 15, 16 and 17 are in lane B now, with parcel 10, and so is everything after them. Nothing unread has reached the dock.'); return; }
            await say('C2 and C3 are taking the parcels read before 15 on to dock 2; the gate stays on lane A.');
            await toDock(ctx, 13); await halt(['c2', 'c3'], 1000).fn(ctx);
            await say('13 at dock 2 and parcel 10 in the lane B tote. C2 and C3 are empty, so I\'ve stopped them.');
          } },
          { fn: async ({ store, chat, sleep }) => {
            const held = store.get('plan.stopOnMisread');
            Object.assign(DIVERT_END, held ? DIVERT_HELD : DIVERT_SAFE);
            chat.replan(held
              ? { intro: 'Held until you look:', changes: ['C1 stopped with parcel 15 on it — nothing leaves C1 unread', 'C2 and C3 cleared to dock 2, then stopped: 13 delivered; gate on lane A', 'Scanner flagged: slow reads on 4 of the last 10; sorting rule unchanged'], needsYou: 'Read parcel 15\'s label by hand, and have the arch\'s window checked. Then tell me to restart C1.' }
              : { intro: 'Until the scanner is checked:', changes: ['Gate held on lane B — nothing unverified goes to the dock', 'Scanner still logging, but its reads don\'t drive the gate', 'Line speed unchanged; lane B tote will fill in about 12 minutes'], needsYou: 'Two unreadable labels in ten usually means a dirty lens or a misprinted label batch. Check the arch. The gate stays on lane B until you tell me the reads are good again.' });
            await sleep(700);
          } },
          HOLD,
          { end: DIVERT_END },
        ] },
        gate: { at: 'divert10', intro: 'Replaying this request. This time, the sorter gate sticks after the first fragile parcel.', steps: [
          lead('Parcel 10 — FRAGILE · gate to lane B for it'),
          { fn: (ctx) => divert(ctx, 10, true) }, // parcel 10 goes down lane B; the command back to A goes out, the arm stays on B
          { wait: 1900 }, // "2 seconds ago"
          { fail: 'gate', faultText: 'stuck on lane B', title: '⚠ Gate stuck', say: 'The gate didn\'t come back from lane B. It was told lane A 2 seconds ago, and its own position sensor still says B.' },
          halt(['c1', 'c2'], 800), // at once, unlabelled
          { wait: 1200 },
          { say: 'C1 and C2 are stopped: with the gate stuck on B, every parcel would go down lane B, fragile or not. I won\'t change your sort without asking.' },
          { say: 'C3 kept running: what was on it had passed the gate before it stuck, so it went on to dock 2 as planned. Parcel 10 is in the lane B tote, where it belongs.' },
          { fn: (ctx) => toDock(ctx, 9) },
          halt(['c3'], 1000),
          { say: 'C3 is empty, so it\'s stopped too. Nothing near the gate is moving.' },
          { ask: { intro: 'The gate is stuck on lane B. Your call:', options: [
            { label: 'Keep the line stopped', primary: true, apply: [
              { status: 'Line held · gate flagged, stuck on lane B' },
              { say: 'Holding. Nothing reaches the gate until someone frees it, and your rule stays as it is.' },
              { replan: { intro: 'Held at the gate:', changes: ['Gate stuck on lane B, by its own sensor; flagged', 'C1, C2 and C3 stopped; 9 at dock 2', 'Parcel 10 in the lane B tote'], needsYou: 'The belts around the gate are stopped. Free the arm by hand; something may be caught at its hinge. Tell me when it moves, and I\'ll test it before sorting again.' } },
            ] },
            { label: 'Send everything down lane B for now', apply: [
              { set: 'gate.all', to: true },
              { set: 'c3.running', to: true }, { set: 'c2.running', to: true }, { set: 'c1.running', to: true },
              { parallel: [{ tween: 'c3.speed', to: 0.5, ms: 800 }, { tween: 'c2.speed', to: 0.5, ms: 800 }, { tween: 'c1.speed', to: 0.5, ms: 800 }] },
              { status: 'Every parcel → lane B · gate flagged, stuck on lane B' },
              { say: 'Running again, with every parcel going down lane B to the tote for a person to sort. That\'s where the stuck arm sends them anyway, so nothing is pushed against it. The tote fills in about 12 minutes; I\'ll stop C1 before then.' },
              { replan: { intro: 'Everything to lane B:', changes: ['Gate stuck on lane B, by its own sensor; flagged', 'C3, C2 and C1 running; every parcel to the lane B tote for a person to sort', 'Nothing unsorted reaches dock 2', 'C1 stops before the tote is full'], needsYou: 'Someone needs to sort the lane B tote by hand, and free the gate once the line is stopped.' } },
            ] },
          ] } },
          HOLD,
          { end: { headline: 'It asked before changing your sort.', body: 'The gate\'s own sensor showed it stuck on lane B. NeuCharBox stopped everything around it and let you choose: hold, or send every parcel to lane B for a person to sort.' } },
        ] },
        dock: { at: 'after10', intro: 'Replaying this request. This time, dock 2 loses its trailer signal in the middle of the sorting.', steps: [
          lead('Sorting · parcel 10 in lane B'),
          // parcel 15 read, and nobody in the doorway (a skip: that layout, 5 through the door)
          { fn: async (ctx) => { if (!await until(ctx, (l) => l.scanned >= 15 && !l.inDoorway(), 4000)) jumpSorted(ctx.store, 15, 0.1); } },
          { parallel: [
            { fail: 'dock', faultText: 'no trailer detected', title: '⚠ No trailer at dock 2', say: 'Dock 2 reports no trailer at the door. Either the trailer has pulled away or its sensor has failed; I can\'t tell which from here.' },
            { set: 'c1.running', to: false }, { set: 'c1.speed', to: 0 }, { set: 'c2.running', to: false }, { set: 'c2.speed', to: 0 }, { set: 'c3.running', to: false }, { set: 'c3.speed', to: 0 },
          ] },
          { wait: 1500 },
          { say: 'So I stopped the whole line at once, C1, C2 and C3 together: nothing goes out of an open door with nothing behind it. Now closing the door. An open dock with no trailer is a drop to the yard.' },
          ...closeDock('Dock 2 → closed'),
          { fn: ({ store, say }) => { const { n, d } = counts(store); return say(`Dock 2's door is down, confirmed by its switch. ${n} scanned: ${d} at dock 2, parcel 10 in the lane B tote, and the other ${n - d - 1} held on the belts, up to parcel ${n} on C1. Nothing moves toward the door until a trailer is confirmed.`); } },
          replanWith((st) => { const { n, d } = counts(st); return { intro: 'Stopped at the door:', changes: ['Dock 2 flagged: no trailer detected', 'C1, C2 and C3 stopped together; door closed, confirmed by its switch', `${n} scanned: ${d} at dock 2, parcel 10 in the lane B tote, ${n - d - 1} on the belts`, 'Sorting rule unchanged'], needsYou: 'Check whether the trailer is at dock 2: you can see it; I can\'t. If it is, its sensor needs a look. Tell me when it\'s safe, and I\'ll restart from C3 back.' }; }),
          { status: 'Line stopped · dock 2 flagged · door closed' },
          HOLD,
          { end: { headline: 'No trailer signal, so nothing went out.', body: 'Dock 2 lost sight of its trailer. NeuCharBox stopped the line at once, closed the door and confirmed it, and held every parcel where it was until a person checks.' } },
        ] },
        unreadable: { label: 'A label can\'t be read', ask: 'What if a parcel\'s label can\'t be read?', at: 'after10', intro: 'Replaying this request. This time, parcel 17 has a torn label the arch can\'t read; the arch itself is fine.', steps: [
          lead('Sorting · parcel 10 in lane B'),
          { fn: async (ctx) => {
            const { store } = ctx;
            if (!await until(ctx, (l) => l.scanned >= 17)) jumpSorted(store, 17);
            store.set('scanner.misreads', 1);
            if (store.get('plan.stopOnMisread')) { store.set('c1.running', false); store.set('c1.speed', 0); } // parcel 17 stays on C1
            ctx.status(store.get('plan.stopOnMisread') ? 'C1 stopped · parcel 17 unreadable, needs a person' : 'Parcel 17 unreadable · lane B at the gate');
          } },
          { parallel: [
            { fn: async (ctx) => { if (!ctx.store.get('plan.stopOnMisread')) await divert(ctx, 17); } },
            { fn: async ({ store, say, sleep }) => {
              if (!store.get('plan.stopOnMisread')) return say('Parcel 17 — label unreadable. Your rule says treat it as fragile, so the gate takes it to lane B for a person to read. That\'s 1 in the last 10: within your line, so I keep trusting the scanner.');
              await sleep(600); // parcel 17 at rest just past the arch
              return say('Parcel 17 — label unreadable. You chose to stop C1 for that, so C1 is stopped with parcel 17 just past the arch.');
            } },
          ] },
          { wait: 1000 },
          { fn: async (ctx) => {
            const { store, say } = ctx;
            if (!store.get('plan.stopOnMisread')) { await say('Parcel 17 is in the lane B tote for someone to read by hand. Sorting goes on as before.'); return; }
            await say('C2 and C3 take what\'s already sorted on to dock 2. That\'s 1 unreadable in the last 10, within your line, so I keep trusting the scanner.');
            await toDock(ctx, 15); await halt(['c2', 'c3'], 1000).fn(ctx);
            await say('15 at dock 2, parcel 10 in the lane B tote. C2 and C3 are empty, so I\'ve stopped them; they start again with C1.');
          } },
          replanWith((st) => (st.get('plan.stopOnMisread')
            ? { intro: 'Waiting for a person:', changes: ['Parcel 17: label unreadable; C1 stopped with it just past the arch, as you chose', 'C2 and C3 cleared what was already sorted, then stopped: 15 at dock 2', 'Scanner trusted: 1 unreadable in the last 10'], needsYou: 'Read parcel 17\'s label by hand, then tell me to restart C1.' }
            : { intro: 'Sorting on:', changes: ['Parcel 17: label unreadable; sent to lane B like a fragile one', 'Scanner trusted: 1 unreadable in the last 10, within your line', 'Gate back on lane A for the next parcel'], needsYou: 'Someone should read parcel 17\'s label in the lane B tote; if it isn\'t fragile, it can go on to the dock.' })),
          { status: (st) => (st.get('plan.stopOnMisread') ? 'Line held · parcel 17 needs a person' : 'Sorting on · parcel 17 in lane B for a person') },
          HOLD,
          { end: { headline: 'One unreadable label, handled your way.', body: 'Parcel 17\'s label couldn\'t be read, so NeuCharBox did what your rule for that case says. It kept trusting the arch: one unreadable label in ten is within the line you set.' } },
        ] },
      },
    },
    {
      chip: 'Stop everything, safely, now.',
      keywords: ['stop', 'everything', 'safely', 'now', 'halt', 'emergency', 'e-stop', 'estop', 'freeze', 'pause', 'kill', 'shut', 'turn off', 'switch off', 'power', 'abort'],
      // routing: asking for the opposite of a stop ("turn everything on", "unlock everything", "resume") never runs one
      avoid: ['turn on', 'switch on', 'power up', 'start', 'restart', 'resume', 'restore', 'unlock', 'unlocked', 'unfreeze', 'unpause', 'release'],
      // routing (js/engine/match.js): what the fn steps below do, as plan lines, so "stop everything except the carts"
      // or "…but not the scanner" asks back instead of braking the carts and disarming the scanner. NCB quotes the line
      // it conflicts with ('…its plan includes "Scanner disarmed"…'), so keep these worded like the stop's own steps.
      touches: ['Carts A and B stop where they are, brakes on', 'Conveyors and the line stop: C1, C2 and C3 ramp down together', 'Scanner disarmed', 'Dock 2 closed, light red'],
      expect: { 'c1.running': false, 'c2.running': false, 'c3.running': false, 'scanner.armed': false, 'dock.light': 'red', 'dock.shut': true, 'agvA.state': 'stopped', 'agvB.state': 'stopped', 'agvB.status': 'online', 'scanner.count': 28, 'dock.parcels': 18 },
      steps: [
        { beat: 'plan' },
        P2_MIDSHIFT,
        P2_SETTLE,
        { beat: 'run' },
        { failPoint: 'carts' },
        STOP_SAY,
        STOP_CARTS,
        { failPoint: 'belts' },
        STOP_BELTS,
        { failPoint: 'disarm' },
        STOP_SCANNER,
        { failPoint: 'close' },
        STOP_DOCK,
        { say: 'All stopped, and each stop confirmed: carts A and B by their own brake reports, C1 to C3 by their encoders, the scanner disarmed, and dock 2\'s door down on its switch.' },
        { status: 'All stopped · every device confirmed' },
        { end: { headline: 'Stopped in order, every stop confirmed.', body: 'NeuCharBox stopped the carts first, then the belts together, then the scanner and the dock, and only called it done when each device had confirmed its own stop.' } },
      ],
      whatIf: {
        agvA: { at: 'carts', intro: 'Replaying this request. This time, cart A doesn\'t quite stop.', steps: [
          lead('Stopping · carts first', (st) => st.set('agvA.creep', true)), // the room keeps moving cart A to its drop-off after "stopped"
          STOP_SAY,
          { fn: async ({ store, chat, tween, sleep, status }) => {
            status('1 · carts'); store.set('agvA.state', 'stopped'); store.set('agvB.state', 'stopped');
            chat.ncb('1 — Carts: stop where they are, brakes on. Cart B confirmed. Cart A answered "stopped" too.');
            tween('agvA.u', 1, 2500); // not awaited: it finishes its move, on to its drop-off beside C3, over 2.5 s
            await sleep(300);
          } },
          STOP_BELTS_NOW, // step 2 goes out at once; the belts ramp down while NCB watches cart A
          { wait: 1000 },
          { fail: 'agvA', faultText: 'says stopped · still moving', title: '⚠ Cart A still moving', say: 'Cart A says it\'s stopped, but its position reports say it\'s still moving: about 60 cm since it said so, along C3, with its parcel on board.' },
          { wait: 1500 },
          STOP_SCANNER, STOP_DOCK,
          { say: 'I sent cart A the stop again and carried on with the rest: a stop doesn\'t wait for one cart.' },
          { set: 'agvA.faultNote', to: 'ignored stop · at drop-off' }, // a note over about 28 characters wraps in the desktop tile
          { say: 'Cart A rolled on to its drop-off beside C3 and halted there, about 1.2 m past where the stop found it. Its position hasn\'t changed since, so it is stopped now, but not because it obeyed.' },
          { replan: { intro: 'Where the stop left cart A:', changes: ['Cart B: stopped, brakes on, confirmed', 'Cart A: answered "stopped" twice, kept rolling to its drop-off beside C3; still loaded', 'C1, C2, C3 stopped, confirmed by their encoders; scanner disarmed; dock 2 closed', 'Restart locked until cart A is checked'], needsYou: 'Cart A ignored a stop. Have someone check its brakes and drive before it moves again. Restart stays locked until then.' } },
          { status: 'Stopped · cart A flagged · restart locked' },
          HOLD,
          { end: { headline: 'A cart said "stopped." Its position disagreed.', body: 'Cart A answered the stop but finished its move anyway. NeuCharBox went by its position, not its word, finished the stop around it, and locked restart until someone checks it.' } },
        ] },
        agvB: { at: 'carts', intro: 'Replaying this request. This time, cart B goes silent as the stop goes out.', steps: [
          lead('Stopping · carts first'),
          STOP_SAY,
          { fn: async ({ store, chat, sleep, status }) => { status('1 · carts'); store.set('agvA.state', 'stopped'); chat.ncb('1 — Carts: stop where they are, brakes on.'); await sleep(300); } },
          STOP_BELTS, STOP_SCANNER, STOP_DOCK,
          { fail: 'agvB', faultText: 'no acknowledgement', title: '⚠ Cart B not confirmed', say: 'Everything acknowledged the stop except cart B. Its last reported position is on the return lane beside C2. It may be stopped; I can\'t confirm it.' },
          { say: 'I won\'t say "all stopped" when one thing hasn\'t said so. Here\'s the state, honestly:' },
          { replan: { intro: 'Stop status:', changes: ['C1, C2, C3: stopped and confirmed by their encoders', 'Cart A: stopped, brakes on, confirmed', 'Cart B: stop sent, no acknowledgement — treat it as moving until seen', 'Restart is locked until cart B is confirmed'], needsYou: 'Eyes on cart B, please — on the return lane beside C2. Then tell me it\'s stopped and I\'ll unlock.' } },
          { ask: { intro: 'Cart B still hasn\'t confirmed. Your call:', options: [
            { label: 'Keep everything locked', primary: true, apply: [{ status: 'Locked · cart B not confirmed' }, { say: 'Locked. Cart B stays flagged, and restart stays locked until cart B answers or you confirm it\'s stopped.' }] },
            { label: 'Cart B is stopped — confirmed by me', apply: [{ set: 'agvB.state', to: 'stopped' }, { status: 'Stopped · cart B confirmed by you, still not answering' }, { set: 'agvB.faultNote', to: 'seen stopped · no answer' }, { say: 'Logged: cart B confirmed stopped by you, on the return lane beside C2. Everything is stopped, cart B on your word. Restart is unlocked, but nothing restarts until you say, and cart B stays flagged until it answers.' }, { set: 'plan.confirmed', to: true }] },
          ] } },
          HOLD,
          { end: { headline: 'A stop with an honest status.', body: 'NeuCharBox stopped the line in a safe order, and when one cart didn\'t confirm, it said so instead of declaring "all stopped" on its own. That distinction is the whole product.' } },
        ] },
        c1: { at: 'belts', intro: 'Replaying this request. This time, conveyor C1\'s drive trips while it slows down.', steps: [
          lead('2 · conveyors'),
          // All three on the same 2 s ramp, as NCB says: it passes 0.2 m/s about 1.1 s in, where C1's drive trips (a new
          // tween on C1 ends its ramp there), so C1 never reads slower than C2 and C3 before it trips.
          { fn: ({ chat, tween }) => { chat.ncb('2 — Conveyors ramp down C1, C2, C3 together, 2 seconds, so nothing pushes into a stopped belt.'); tween('c1.speed', 0, 2000); tween('c2.speed', 0, 2000); tween('c3.speed', 0, 2000); } },
          { wait: 1100 },
          { fn: ({ tween }) => tween('c1.speed', 0.2, 1) }, // where the ramp is now, give or take a frame
          { fail: 'c1', faultText: 'drive tripped', title: '⚠ C1 drive tripped', say: 'C1\'s drive tripped part-way down the ramp, at 0.2 m/s.' },
          { set: 'c1.speed', to: 0 }, { set: 'c1.running', to: false }, // a tripped drive lets go of the belt: unlabelled
          { fn: async ({ store, sleep }) => { await sleep(900); store.set('c2.running', false); store.set('c3.running', false); } }, // C2 and C3 finish their 2 s ramp (C1 tripped 1.1 s into it)
          { wait: 1000 },
          STOP_SCANNER, STOP_DOCK, // the stop goes on in its order before NCB explains
          { say: 'C1 is stopped all the same: its encoder reads 0. But a trip isn\'t a controlled stop: the drive let go of the belt instead of slowing it. C2 and C3 ramped down as planned, confirmed by their encoders.' },
          { say: 'Everything is stopped and confirmed, dock 2 included. C1 is flagged: a drive that trips on the way down may trip again when it starts.' },
          { replan: { intro: 'What stopped, and how:', changes: ['Carts, C2 and C3: stopped, each confirmed', 'C1: tripped at 0.2 m/s mid-ramp; encoder reads 0', 'Scanner disarmed; dock 2 closed on its switch', 'Restart locked for C1 until its drive is checked'], needsYou: 'Check C1\'s belt for anything dragging, then reset its drive at the panel. I won\'t reset it from here.' } },
          { status: 'All stopped · C1 flagged, drive tripped' },
          HOLD,
          { end: { headline: 'Stopped, but not the way it planned.', body: 'C1 reached a stop by tripping instead of ramping down. NeuCharBox counted it stopped only because its encoder said 0, and flagged the trip instead of calling it a clean stop.' } },
        ] },
        c2: { at: 'belts', intro: 'Replaying this request. This time, conveyor C2 won\'t ramp down.', steps: [
          lead('2 · conveyors', (st) => st.set('c2.runOn', true)), // its belt keeps moving once it is faulted
          { fn: async ({ store, chat, tween }) => {
            chat.ncb('2 — Conveyors ramp down C1, C2, C3 together, 2 seconds, so nothing pushes into a stopped belt.');
            await Promise.all([tween('c1.speed', 0, 2000), tween('c3.speed', 0, 2000)]); // C2's speed never comes down
            store.set('c1.running', false); store.set('c3.running', false);
          } },
          { wait: 400 },
          { fail: 'c2', faultText: 'still running', title: '⚠ C2 didn\'t stop', say: 'C2 didn\'t ramp down. Its drive still reports 0.5 m/s and its encoder agrees: the belt is moving. C1 and C3 are stopped.' },
          { wait: 1500 },
          STOP_SCANNER, STOP_DOCK, // the stop goes on in its order before NCB explains
          { say: 'I sent C2 the stop twice more: no change. So C2 has to be stopped at the belt, with its own stop button or its power switch. Please keep hands away from it until then.' },
          { say: 'Everything else is stopped and confirmed, dock 2 included. C2 is not: it\'s still running, and its parcels are bunched up at its end, against stopped C3. I won\'t call this stop done.' },
          { replan: { intro: 'Not all stopped:', changes: ['Carts A and B: stopped, brakes on, confirmed', 'C1 and C3: stopped, confirmed by their encoders', 'C2: stop sent three times; still running at 0.5 m/s, by its drive and its encoder', 'Scanner disarmed; dock 2 closed on its switch'], needsYou: 'C2 won\'t stop from here. Press its local stop or switch it off at its power switch, then tell me, and I\'ll check that its encoder reads 0.' } },
          { status: 'Not all stopped · C2 still running' },
          HOLD,
          { end: { headline: 'It won\'t call it stopped while C2 runs.', body: 'C2 ignored the ramp and kept running. NeuCharBox stopped everything else in order, told you plainly that the stop wasn\'t complete, and said where C2 can be stopped by hand.' } },
        ] },
        c3: { at: 'disarm', intro: 'Replaying this request. This time, conveyor C3 won\'t stay stopped.', steps: [
          lead('3 · scanner'),
          { fn: async ({ store, chat, sleep }) => { store.set('scanner.armed', false); chat.ncb('3 — Scanner disarmed, now that nothing is moving through it.'); await sleep(800); } },
          { set: 'c3.running', to: true }, { tween: 'c3.speed', to: 0.5, ms: 900 }, // its drive resets itself and goes back to its last speed
          { parallel: [
            { fail: 'c3', faultText: 'restarted on its own', title: '⚠ C3 restarted', say: 'C3 started again on its own, just after it stopped: its drive reports it reset a fault and went back to its last speed.' },
            { tween: 'c3.speed', to: 0, ms: 600 }, // stopped again at once (a faulted belt carries nothing in the room)
          ] },
          { set: 'c3.running', to: false },
          { fn: (ctx) => toDock(ctx, 19, 3000) }, // parcel 19, carried past C3's end stop while it ran, goes on through the door
          { wait: 1000 },
          { say: 'Stopped it again: its encoder reads 0. While it ran, parcel 19 went through the open door into the trailer. It\'s counted: 19 at dock 2.' },
          { say: 'Keep clear of C3: it may start again by itself, and a stop from me can\'t prevent that.' },
          { status: 'Watching C3 · dock 2 held open' },
          { say: 'I\'m holding dock 2 open for now: a door coming down in front of a belt that restarts could catch a parcel in the doorway.' },
          { wait: 3000 },
          { say: 'C3 has stayed at 0 for over 10 seconds now; last time it restarted within about a second. Closing dock 2 now: the door takes about a second.' },
          STOP_DOCK,
          { say: 'Everything else is stopped and confirmed, and dock 2\'s door is down on its switch. C3 is stopped for now, but its drive restarts itself after a fault, so it isn\'t safe until it\'s locked out.' },
          { replan: { intro: 'Stopped twice:', changes: ['Carts, C1 and C2: stopped, each confirmed', 'C3 restarted on its own; stopped again, encoder at 0; it may restart again', 'Parcel 19 went through while C3 ran: 19 at dock 2', 'Scanner disarmed; dock 2 closed on its switch'], needsYou: 'Lock C3 out at its power switch now, then have its fault found and its automatic restart switched off. The line stays locked until then.' } },
          { status: 'All stopped · C3 flagged, may restart itself' },
          HOLD,
          { end: { headline: 'A belt restarted itself. The dock waited.', body: 'C3 came back on by itself right after the stop. NeuCharBox stopped it again, waited before closing dock 2 in front of it, and told you to lock C3 out, because a stop from here can\'t hold it.' } },
        ] },
        scanner: { at: 'disarm', intro: 'Replaying this request. This time, the scanner arch goes quiet as the stop reaches it.', steps: [
          lead('3 · scanner'),
          { fn: async ({ chat, sleep }) => { chat.ncb('3 — Scanner: disarm sent.'); await sleep(300); } },
          STOP_DOCK, // step 4 doesn't wait for the arch's answer
          { status: 'Scanner · no answer to the disarm · sent again' },
          { wait: 1200 },
          { fail: 'scanner', faultText: 'not answering', title: '⚠ Scanner not answering', say: 'The scanner arch hasn\'t answered the disarm, sent twice, or anything since. Its last report: armed, 28 scanned.' },
          { wait: 1500 },
          { say: 'Nothing is moving under it: C1 is stopped, confirmed by its encoder. An armed arch with nothing passing only watches; it can\'t move anything. So the stop went on without waiting for it.' },
          { say: 'Everything that moves is stopped and confirmed, and dock 2\'s door is down on its switch. The scanner isn\'t confirmed disarmed: its last word was "armed".' },
          { replan: { intro: 'Stopped, one thing unconfirmed:', changes: ['Carts, conveyors and dock 2: stopped or closed, each confirmed', 'Scanner: disarm sent twice, no answer; last report armed, 28 scanned', 'Its count can\'t be relied on until it answers again', 'Before the next run, I check that it answers and re-arm it'], needsYou: 'Check the arch\'s power and its network cable. The stop doesn\'t need it; the next run does.' } },
          { status: 'All stopped · scanner flagged, not confirmed disarmed' },
          HOLD,
          { end: { headline: 'The scanner went quiet; the stop went on.', body: 'The scanner never confirmed it was disarmed, but nothing was moving under it. NeuCharBox finished the stop, said exactly what it couldn\'t confirm, and why that one could wait.' } },
        ] },
        dock: { at: 'close', intro: 'Replaying this request. This time, dock 2\'s door halts part-way at the end of the stop.', steps: [
          lead('4 · dock'),
          { fn: async (ctx) => { const { store, chat, sleep } = ctx; store.set('dock.shut', false); store.set('dock.light', 'red'); chat.ncb('4 — Dock 2 closing, light red.'); await sleep(650); if (ctx.fast) lineOf.get(store)?.doorAt(0.46); store.set('dock.stuck', true); } }, // the door stops about half-way (a skip puts it there)
          { wait: 1400 },
          { fail: 'dock', faultText: 'part-open · safety edge', title: '⚠ Dock 2 door stopped', say: 'Dock 2\'s door stopped about half-way down. Its safety edge tripped: something touched the bottom of the door, or the edge itself has failed.' },
          { wait: 1500 },
          { say: 'I won\'t send it down again. A safety edge stops a door because something may be under it, and I can\'t see under it from here.' },
          { say: 'Everything else is stopped and confirmed: carts, conveyors and the scanner. Dock 2 is part-open, with its light red. I won\'t call this stop done until its door is down.' },
          { replan: { intro: 'Stopped, door part-open:', changes: ['Carts, conveyors and scanner: stopped or disarmed, each confirmed', 'Dock 2: door stopped part-way when its safety edge tripped; light red', 'No retry until someone has looked under it', 'Restart locked while dock 2 isn\'t closed'], needsYou: 'Look under dock 2\'s door before anything else. If it\'s clear, close it from the dock\'s own control; I\'ll confirm it on its switch.' } },
          { status: 'Stopped · dock 2 flagged, door part-open' },
          HOLD,
          { end: { headline: 'It didn\'t force a door that stopped itself.', body: 'Dock 2\'s door stopped half-way when its safety edge tripped. NeuCharBox left it there instead of retrying, called the stop incomplete, and asked a person to look under it first.' } },
        ] },
        gate: { at: 'belts', intro: 'Replaying this request. This time, the sorter gate drops out during the stop.', steps: [
          lead('2 · conveyors'),
          STOP_BELTS_NOW, // step 2 goes out; the belts ramp down over 2 s while the gate goes quiet
          { wait: 900 },
          { fail: 'gate', faultText: 'not answering', title: '⚠ Gate silent', say: 'The sorter gate stopped answering. Its last report was lane A, straight through.' },
          { wait: 1500 },
          { say: 'The gate only moves when it\'s told to, and I\'m not telling it anything. C2 and C3 are stopped now, so nothing reaches it either. The stop goes on.' },
          STOP_SCANNER, STOP_DOCK,
          { say: 'Carts, conveyors and the scanner are stopped and confirmed, and dock 2\'s door is down on its switch. The gate I can\'t confirm: its last word was lane A.' },
          { replan: { intro: 'Stopped around a silent gate:', changes: ['Carts, conveyors, scanner and dock 2: stopped or closed, each confirmed', 'Gate: not answering; last report lane A; not confirmed held', 'Nothing reaches it while C2 is stopped', 'Restart locked until the gate answers'], needsYou: 'Check the gate\'s controller before the line restarts. Nothing reaches it while the belts are stopped.' } },
          { status: 'All stopped · gate flagged, not answering' },
          HOLD,
          { end: { headline: 'A quiet gate, and nothing feeding it.', body: 'The gate stopped answering in the middle of the stop. NeuCharBox finished the stop, made sure nothing was feeding the gate, and kept the line locked until it answers.' } },
        ] },
      },
    },
  ],
};
