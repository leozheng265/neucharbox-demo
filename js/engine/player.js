// Runs a scene's authored steps against the store and the chat.
// Step shapes:
//   { beat: 'setup'|'ask'|'plan'|'run'|'recover'|'end' }
//   { say: text }                       NCB message
//   { user: text }                      visitor message
//   { status: text }                    small progress line under the room
//   { plan: { intro, steps: [{ text, alt: { text, apply: [steps] } }], approve } }  waits for approval
//   { ask: { intro, options: [{ label, apply: [steps] }] } }   halts and asks (lab)
//   { wait: ms }
//   { set: path, to: value, label? }
//   { tween: path, to: number, ms, label? }
//   { parallel: [steps] }
//   { fail: deviceId, say?: text }
//   { replan: { intro, changes: [text], needsYou: text } }
//   { end: { headline, body } }
//   { fn: (ctx) => any | Promise }
//
// fn steps receive ctx = { store, chat, fast, tween, sleep }. `fast` is a live getter (true while skipping or
// headless). Use ctx.tween(path, to, ms) and ctx.sleep(ms) inside fn steps: they honour ?speed=, go instant
// when skipping, and are released immediately by a beat skip — raw store.tween/setTimeout do not.

export function createPlayer({ store, chat, headless = false, onBeat = () => {}, onStatus = () => {}, autoPlan = () => ({}), autoAsk = () => 0, endOptions = () => ({}) }) {
  let fast = headless;
  let stopAt = null;         // beat name to stop fast-forwarding at
  let currentBeat = 'setup';
  let cancelled = false;

  const SPEED = (typeof location !== 'undefined' && Number(new URLSearchParams(location.search).get('speed'))) || 1;
  const timers = new Map();  // timeout id -> resolve, so a skip or cancel can release in-flight sleeps
  const sleep = (ms) => (fast || ms <= 0 ? Promise.resolve() : new Promise((r) => { const id = setTimeout(() => { timers.delete(id); r(); }, ms / SPEED); timers.set(id, r); }));
  const releaseSleeps = () => { for (const [id, r] of timers) { clearTimeout(id); r(); } timers.clear(); };
  const tween = (path, to, ms = 800) => (fast || ms <= 0 ? (store.set(path, to), Promise.resolve()) : store.tween(path, to, ms / SPEED));
  const typing = (text) => Math.min(1800, 350 + text.length * 14);
  const ctx = { store, chat, tween, sleep, get fast() { return fast; } };

  async function run(step) {
    if (cancelled) return;
    if (step.beat) {
      currentBeat = step.beat;
      if (stopAt && stopAt === step.beat) { fast = headless; stopAt = null; }
      onBeat(step.beat);
      return;
    }
    if (step.fail) { store.set(`${step.fail}.status`, 'fault'); if (step.say) chat.alert(step.say); await sleep(600); return; }
    if (step.say != null) { if (!fast) { chat.typing(true); await sleep(typing(step.say)); chat.typing(false); } if (cancelled) return; chat.ncb(step.say); await sleep(400); return; }
    if (step.user != null) { chat.user(step.user); await sleep(500); return; }
    if (step.status != null) { onStatus(step.status); return; }
    if (step.wait != null) return sleep(step.wait);
    if (step.set != null) { store.set(step.set, step.to); if (step.label) onStatus(step.label); return; }
    if (step.tween != null) { if (step.label) onStatus(step.label); return tween(step.tween, step.to, step.ms ?? 800); }
    if (step.parallel) return Promise.all(step.parallel.map(run));
    if (step.replan) { chat.replan(step.replan); await sleep(700); return; }
    if (step.plan) {
      const choices = fast ? { approved: true, alts: autoPlan(step.plan) || {} } : await chat.plan(step.plan);
      for (const [i, on] of Object.entries(choices.alts || {})) {
        const alt = step.plan.steps[Number(i)]?.alt;
        if (on && alt?.apply) for (const s of alt.apply) await run(s);
      }
      return;
    }
    if (step.ask) {
      const idx = fast ? autoAsk(step.ask) || 0 : await chat.ask(step.ask);
      const opt = step.ask.options[idx] || step.ask.options[0];
      for (const s of opt.apply || []) await run(s);
      return;
    }
    if (step.end) { currentBeat = 'end'; chat.end(step.end, endOptions()); onBeat('end'); return; }
    if (step.fn) return step.fn(ctx);
    throw new Error('Unknown step: ' + JSON.stringify(step));
  }

  async function play(steps) { for (const s of steps) { if (cancelled) return; await run(s); } }

  // Fast-forward until the named beat is reached (or the end). Interactive cards on screen resolve with the
  // visitor's current choices; in-flight sleeps and tweens finish immediately.
  function skipTo(beat) { stopAt = beat; fast = true; store.finishTweens(); releaseSleeps(); chat.resolvePending(); }
  function cancel() { cancelled = true; releaseSleeps(); chat.resolvePending(); }

  return { play, run, skipTo, cancel, get beat() { return currentBeat; }, get fast() { return fast; } };
}

// The setup beat is generic: power the hub, scan, discover devices in order.
export function setupSteps(scene) {
  const ids = scene.deviceOrder || Object.keys(scene.devices).filter((d) => d !== 'hub' && d !== 'env');
  const steps = [
    { beat: 'setup' },
    { say: scene.setupIntro || 'This is NeuCharBox. Plug it in to start.' },
    { fn: ({ chat, fast }) => (fast ? null : chat.button('Plug in')) },
    { set: 'hub.status', to: 'on', label: 'Hub powered' },
    { tween: 'hub.led', to: 1, ms: 900 },
    { say: 'Now scan the QR code on the hub with your phone and I\'ll find what\'s on this network.' },
    { fn: ({ chat, fast }) => (fast ? null : chat.qr()) },
    { say: 'Looking for devices…' },
  ];
  for (const id of ids) {
    const d = scene.devices[id];
    steps.push({ set: `${id}.status`, to: 'online', label: `Found ${d.name}` }, { wait: 1100 });
  }
  steps.push({ say: `${ids.length} devices connected. No coding, no setup — that's it.` }, { beat: 'ask' });
  return steps;
}
