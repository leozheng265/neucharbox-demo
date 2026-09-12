// Headless check of every scene script. Usage: node test/run.mjs
//  1. Default path of every prompt (auto-approve, ask option 0): reaches plan/run/recover/end, doesn't throw,
//     ends in the prompt's `expect` state, touches only known devices, chip matches itself, copy guardrails hold.
//  2. Every plan Edit alternative and every ask option: reaches the end card without throwing, and an Edit
//     choice must change what NCB says or the final state (a no-op Edit is a bug).
//  3. All prompts back-to-back with ONE shared player and ONE store, restored to the post-setup snapshot before
//     each prompt, as main.js does: restore must reproduce the snapshot and each prompt must reach `expect`.
//  4. Real-timer skip: a non-headless player at high speed, skipped to 'recover' right after the plan appears,
//     must still show the plan card, reach the end, and leave the player at normal speed for the next request.
//  5. Every device format() renders the initial, online, fault and busy states.
//  6. Scene sources don't use raw store.tween(...) / setTimeout(...) inside fn steps (use ctx.tween / ctx.sleep).
//  7. Every scene's 3D room builds in Node (fake canvas) and update() runs through every prompt without throwing.
import { createStore } from '../js/engine/store.js';
import { createPlayer, setupSteps } from '../js/engine/player.js';
import { matchPrompt } from '../js/engine/match.js';
import { SCENES } from '../js/scenes/index.js';
import { readdirSync, readFileSync } from 'node:fs';
import { register } from 'node:module';
register('./loader.mjs', import.meta.url); // 'three' -> vendor/three for the room-build checks

const GUARD = [/\bzigbee\b/, /\bmatter\b/, /\bthread\b/, /\bz-?wave\b/, /100\s?%/, /\bguarantee/, /home assistant(?![^.]{0,80}\b(?:bridge|in progress)\b)/];
const stubChat = (log) => ({
  enableInput() {}, typing() {}, resolvePending() {},
  ncb: (t) => log.push(['ncb', t]), user: (t) => log.push(['me', t]), alert: (t) => log.push(['alert', t]),
  button: () => Promise.resolve(), qr: () => Promise.resolve(), chips() {},
  plan: () => Promise.resolve({ approved: true, alts: {} }), ask: () => Promise.resolve(0),
  replan: (spec) => log.push(['replan', JSON.stringify(spec)]), end: (spec) => log.push(['end', spec.headline]),
});
const initialOf = (scene) => { const init = { env: { hour: scene.startHour ?? 17 }, hub: { status: 'off', led: 0 }, plan: {} }; for (const [id, d] of Object.entries(scene.devices)) init[id] = { status: 'offline', ...d.initial }; return init; };
const walk = (steps, visit) => { for (const s of steps) { visit(s); if (s.parallel) walk(s.parallel, visit); if (s.plan) for (const ps of s.plan.steps) if (ps.alt?.apply) walk(ps.alt.apply, visit); if (s.ask) for (const o of s.ask.options) walk(o.apply || [], visit); } };
const checkExpect = (prompt, store) => Object.entries(prompt.expect || {}).filter(([p, want]) => store.get(p) !== want).map(([p, want]) => `${p} = ${JSON.stringify(store.get(p))}, expected ${JSON.stringify(want)}`);

async function play(scene, prompt, { alts = {}, askIdx = 0 } = {}) {
  const store = createStore(initialOf(scene), { headless: true });
  const log = [], beats = [], problems = [];
  const player = createPlayer({ store, chat: stubChat(log), headless: true, onBeat: (b) => beats.push(b), autoPlan: () => alts, autoAsk: () => askIdx });
  try { await player.play(setupSteps(scene)); await player.play(prompt.steps); }
  catch (e) { problems.push('threw: ' + (e.stack || e.message).split('\n').slice(0, 2).join(' | ')); }
  for (const b of ['plan', 'run', 'recover', 'end']) if (!beats.includes(b)) problems.push(`beat "${b}" never reached`);
  if (!log.some(([k]) => k === 'end')) problems.push('no end card');
  for (const [id, d] of Object.entries(scene.devices)) { try { d.format(store.state[id], store.state); } catch (e) { problems.push(`format(${id}) threw at end: ${e.message}`); } }
  return { store, log, beats, problems };
}

let failures = 0, runs = 0; const report = (tag, problems) => { runs++; if (problems.length) { failures++; console.log(`FAIL ${tag}\n   - ${problems.join('\n   - ')}`); } else console.log(`ok   ${tag}`); };
const files = readdirSync(new URL('../js/scenes/', import.meta.url)).filter((f) => f.endsWith('.js') && f !== 'index.js');
for (const f of files) {
  const { default: scene } = await import(`../js/scenes/${f}`);
  const init = initialOf(scene);
  const meta = SCENES.find((m) => m.id === scene.id) || {};
  // 5. formatters; scene-level copy guardrails
  {
    const problems = [];
    for (const [id, d] of Object.entries(scene.devices)) for (const status of ['offline', 'online', 'fault', 'busy']) { try { const st = { ...init, [id]: { ...init[id], status } }; d.format(st[id], st); } catch (e) { problems.push(`format(${id}, ${status}) threw: ${e.message}`); } }
    const text = JSON.stringify([meta.title, meta.promise, meta.tag, scene.title, scene.setupIntro, scene.askIntro, Object.values(scene.devices).map((d) => [d.name, d.faultText])]).toLowerCase();
    for (const g of GUARD) if (g.test(text)) problems.push(`guardrail (scene copy): matches ${g}`);
    report(`${scene.id} · device formatters and scene copy`, problems);
  }
  // 6. fn steps use ctx.tween / ctx.sleep
  {
    const src = readFileSync(new URL(`../js/scenes/${f}`, import.meta.url), 'utf8'); const promptSrc = src.slice(src.indexOf('prompts:'));
    const problems = []; for (const re of [/store\.tween\(/g, /setTimeout\(/g]) { const n = (promptSrc.match(re) || []).length; if (n) problems.push(`${n}× ${re.source.replace(/\\/g, '')} in prompts (use ctx.tween / ctx.sleep)`); }
    report(`${scene.id} · fn steps use ctx.tween / ctx.sleep`, problems);
  }
  for (const prompt of scene.prompts) {
    const tag = `${scene.id} · "${prompt.chip.slice(0, 48)}"`;
    // 1. default path
    const base = await play(scene, prompt); const problems = [...base.problems, ...checkExpect(prompt, base.store)];
    const touched = new Set(); walk(prompt.steps, (s) => { for (const k of ['set', 'tween']) if (s[k]) touched.add(s[k].split('.')[0]); if (s.fail) touched.add(s.fail); });
    for (const id of touched) if (!(id in init)) problems.push(`unknown device "${id}"`);
    if (!prompt.steps.some((s) => s.plan || s.ask)) problems.push('no plan/ask step');
    if (matchPrompt(prompt.chip, scene.prompts).prompt !== prompt) problems.push('chip does not match its own prompt');
    const text = JSON.stringify(prompt).toLowerCase();
    for (const g of GUARD) if (g.test(text)) problems.push(`guardrail: matches ${g}`);
    report(tag, problems);
    // 2. every Edit alternative (must change something) and every ask option
    const plan = prompt.steps.find((s) => s.plan)?.plan; const asks = []; walk(prompt.steps, (s) => { if (s.ask) asks.push(s.ask); });
    const sig = (r) => JSON.stringify([r.log, r.store.state]);
    for (const [i, ps] of (plan?.steps || []).entries()) if (ps.alt) { const rr = await play(scene, prompt, { alts: { [i]: true } }); const pr = [...rr.problems]; if (sig(rr) === sig(base)) pr.push('Edit changes nothing: same chat and same final state as the default path'); report(`${tag} · edit #${i + 1}`, pr); }
    const maxOpts = Math.max(0, ...asks.map((a) => a.options.length));
    for (let k = 1; k < maxOpts; k++) { const rr = await play(scene, prompt, { askIdx: k }); report(`${tag} · ask option ${k + 1}`, rr.problems); }
  }
  // 3. back-to-back: one player, one store, restore before each prompt (as main.js)
  {
    const store = createStore(init, { headless: true }); const log = [], beats = [], problems = [];
    const player = createPlayer({ store, chat: stubChat(log), headless: true, onBeat: (b) => beats.push(b) });
    await player.play(setupSteps(scene)); const baseline = store.snapshot();
    for (const prompt of [...scene.prompts].reverse()) {
      store.restore(baseline); if (JSON.stringify(store.state) !== JSON.stringify(baseline)) problems.push('restore() did not reproduce the post-setup snapshot');
      log.length = 0; beats.length = 0;
      try { await player.play(prompt.steps); } catch (e) { problems.push(`"${prompt.chip.slice(0, 30)}" threw: ${e.message}`); }
      if (!beats.includes('end')) problems.push(`"${prompt.chip.slice(0, 30)}" never reached the end`);
      problems.push(...checkExpect(prompt, store).map((p) => `"${prompt.chip.slice(0, 30)}": ${p}`));
    }
    report(`${scene.id} · all prompts back-to-back`, problems);
  }
  // 4. real-timer skip to 'recover' once the plan card is up
  {
    const problems = [];
    for (const prompt of scene.prompts) {
      const store = createStore(init); const iv = setInterval(() => store.tick(performance.now()), 4);
      let plans = 0, skippedPlans = 0; const beats = []; let player;
      const chat = { ...stubChat([]), plan: (spec, { skipped } = {}) => { plans++; if (skipped) { skippedPlans++; return Promise.resolve({ approved: true, alts: {} }); } setTimeout(() => player.skipTo('recover'), 5); return new Promise((r) => { chat._r = r; }); }, ask: () => Promise.resolve(0), resolvePending: () => { chat._r?.({ approved: true, alts: {} }); chat._r = null; } };
      player = createPlayer({ store, chat, onBeat: (b) => beats.push(b), speed: 400 });
      try { await player.play(setupSteps(scene).filter((s) => !s.fn)); await player.play(prompt.steps); }
      catch (e) { problems.push(`"${prompt.chip.slice(0, 30)}" threw: ${e.message}`); }
      clearInterval(iv);
      if (prompt.steps.some((s) => s.plan) && plans === 0) problems.push(`"${prompt.chip.slice(0, 30)}": plan card never shown`); // a safety stop deliberately has no plan
      if (!beats.includes('end')) problems.push(`"${prompt.chip.slice(0, 30)}": never reached the end after a skip`);
      if (player.fast) problems.push(`"${prompt.chip.slice(0, 30)}": player left in fast mode after the prompt`);
    }
    report(`${scene.id} · skip to Recover with real timers`, problems);
  }
}
// 7. room builds
const { buildChecks } = await import('./build.mjs');
await buildChecks({ report, initialOf, stubChat });

console.log(`\n${runs - failures}/${runs} checks pass across ${files.length} scene file(s)`);
process.exit(failures ? 1 : 0);
