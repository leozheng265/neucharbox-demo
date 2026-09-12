// Headless check of every scene script. Usage: node test/run.mjs
//  1. Default path of every prompt (auto-approve, ask option 0): must reach plan/run/recover/end, must not
//     throw, and must end in the prompt's `expect` state.
//  2. Every plan Edit alternative and every ask option: must reach the end card without throwing and without
//     touching unknown devices.
//  3. All prompts of a scene back-to-back in ONE store, restored to the post-setup snapshot between prompts
//     (what the page does): each must still reach its `expect` state.
//  4. Every device format() must render the initial, online and fault states without throwing.
//  5. Each chip must match its own prompt; copy guardrails must hold.
import { createStore } from '../js/engine/store.js';
import { createPlayer, setupSteps } from '../js/engine/player.js';
import { matchPrompt } from '../js/engine/match.js';
import { readdirSync } from 'node:fs';

const stubChat = (log) => ({
  enableInput() {}, typing() {}, resolvePending() {},
  ncb: (t) => log.push(['ncb', t]), user: (t) => log.push(['me', t]), alert: (t) => log.push(['alert', t]),
  button: () => Promise.resolve(), qr: () => Promise.resolve(), chips() {},
  plan: () => Promise.resolve({ approved: true, alts: {} }), ask: () => Promise.resolve(0),
  replan: (spec) => log.push(['replan', spec.changes?.length]), end: (spec) => log.push(['end', spec.headline]),
});
const initialOf = (scene) => { const init = { env: { hour: scene.startHour ?? 17 }, hub: { status: 'off', led: 0 }, plan: {} }; for (const [id, d] of Object.entries(scene.devices)) init[id] = { status: 'offline', ...d.initial }; return init; };
const walk = (steps, visit) => { for (const s of steps) { visit(s); if (s.parallel) walk(s.parallel, visit); if (s.plan) for (const ps of s.plan.steps) if (ps.alt?.apply) walk(ps.alt.apply, visit); if (s.ask) for (const o of s.ask.options) walk(o.apply || [], visit); } };

async function play(scene, prompt, { store, alts = {}, askIdx = 0 } = {}) {
  store = store || createStore(initialOf(scene), { headless: true });
  const log = [], beats = [], problems = [];
  const player = createPlayer({ store, chat: stubChat(log), headless: true, onBeat: (b) => beats.push(b), autoPlan: () => alts, autoAsk: () => askIdx });
  try { if (!store.get('hub.status') || store.get('hub.status') === 'off') await player.play(setupSteps(scene)); await player.play(prompt.steps); }
  catch (e) { problems.push('threw: ' + (e.stack || e.message).split('\n').slice(0, 2).join(' | ')); }
  for (const b of ['plan', 'run', 'recover', 'end']) if (!beats.includes(b)) problems.push(`beat "${b}" never reached`);
  if (!log.some(([k]) => k === 'end')) problems.push('no end card');
  for (const [id, d] of Object.entries(scene.devices)) { try { d.format(store.state[id], store.state); } catch (e) { problems.push(`format(${id}) threw at end: ${e.message}`); } }
  return { store, log, beats, problems };
}
const checkExpect = (prompt, store) => Object.entries(prompt.expect || {}).filter(([p, want]) => store.get(p) !== want).map(([p, want]) => `${p} = ${JSON.stringify(store.get(p))}, expected ${JSON.stringify(want)}`);

let failures = 0, runs = 0; const report = (tag, problems) => { runs++; if (problems.length) { failures++; console.log(`FAIL ${tag}\n   - ${problems.join('\n   - ')}`); } else console.log(`ok   ${tag}`); };
const files = readdirSync(new URL('../js/scenes/', import.meta.url)).filter((f) => f.endsWith('.js') && f !== 'index.js');
for (const f of files) {
  const { default: scene } = await import(`../js/scenes/${f}`);
  const init = initialOf(scene);
  // 4. formatters on initial / online / fault states
  { const problems = []; for (const [id, d] of Object.entries(scene.devices)) for (const status of ['offline', 'online', 'fault', 'busy']) { try { const st = { ...init, [id]: { ...init[id], status } }; d.format(st[id], st); } catch (e) { problems.push(`format(${id}, ${status}) threw: ${e.message}`); } } report(`${scene.id} · device formatters`, problems); }
  for (const prompt of scene.prompts) {
    const tag = `${scene.id} · "${prompt.chip.slice(0, 48)}"`;
    // 1. default path
    const r = await play(scene, prompt); const problems = [...r.problems, ...checkExpect(prompt, r.store)];
    const touched = new Set(); walk(prompt.steps, (s) => { for (const k of ['set', 'tween']) if (s[k]) touched.add(s[k].split('.')[0]); if (s.fail) touched.add(s.fail); });
    for (const id of touched) if (!(id in init)) problems.push(`unknown device "${id}"`);
    if (!prompt.steps.some((s) => s.plan || s.ask)) problems.push('no plan/ask step');
    if (matchPrompt(prompt.chip, scene.prompts).prompt !== prompt) problems.push('chip does not match its own prompt');
    const text = JSON.stringify(prompt.steps).toLowerCase();
    for (const bad of [/\bzigbee\b/, /\bmatter protocol\b/, /\bz-wave\b/, /100%(?! closed)/, /\bguarantee/]) if (bad.test(text)) problems.push(`guardrail: matches ${bad}`);
    report(tag, problems);
    // 2. every Edit alternative and every ask option
    const plan = prompt.steps.find((s) => s.plan)?.plan; const asks = []; walk(prompt.steps, (s) => { if (s.ask) asks.push(s.ask); });
    for (const [i, ps] of (plan?.steps || []).entries()) if (ps.alt) { const rr = await play(scene, prompt, { alts: { [i]: true } }); report(`${tag} · edit #${i + 1}`, rr.problems); }
    const maxOpts = Math.max(0, ...asks.map((a) => a.options.length));
    for (let k = 1; k < maxOpts; k++) { const rr = await play(scene, prompt, { askIdx: k }); report(`${tag} · ask option ${k + 1}`, rr.problems); }
  }
  // 3. back-to-back in one store with the page's reset between prompts
  {
    const store = createStore(init, { headless: true });
    const setup = createPlayer({ store, chat: stubChat([]), headless: true }); await setup.play(setupSteps(scene));
    const baseline = store.snapshot(); const problems = [];
    for (const prompt of [...scene.prompts].reverse()) { store.restore(baseline); const rr = await play(scene, prompt, { store }); problems.push(...rr.problems.map((p) => `"${prompt.chip.slice(0, 30)}": ${p}`), ...checkExpect(prompt, store).map((p) => `"${prompt.chip.slice(0, 30)}": ${p}`)); }
    report(`${scene.id} · all prompts back-to-back`, problems);
  }
}
console.log(`\n${runs - failures}/${runs} checks pass across ${files.length} scene file(s)`);
process.exit(failures ? 1 : 0);
