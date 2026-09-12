// Headless check: play every prompt of every scene through the real player with a
// stub chat, then assert the store reaches each prompt's `expect` state.
// Usage: node test/run.mjs
import { createStore } from '../js/engine/store.js';
import { createPlayer, setupSteps } from '../js/engine/player.js';
import { matchPrompt } from '../js/engine/match.js';
import { readdirSync } from 'node:fs';

const stubChat = (log) => ({
  enableInput() {}, typing() {}, resolvePending() {},
  ncb: (t) => log.push(['ncb', t]), user: (t) => log.push(['me', t]), alert: (t) => log.push(['alert', t]),
  button: () => Promise.resolve(), qr: () => Promise.resolve(), chips() {},
  plan: (spec) => { log.push(['plan', spec.steps.length]); return Promise.resolve({ approved: true, alts: {} }); },
  ask: (spec) => { log.push(['ask', spec.options.length]); return Promise.resolve(0); },
  replan: (spec) => log.push(['replan', spec.changes?.length]), end: (spec) => log.push(['end', spec.headline]),
});

let failures = 0, prompts = 0;
const files = readdirSync(new URL('../js/scenes/', import.meta.url)).filter((f) => f.endsWith('.js') && f !== 'index.js');
for (const f of files) {
  const { default: scene } = await import(`../js/scenes/${f}`);
  for (const prompt of scene.prompts) {
    prompts++;
    const initial = { env: { hour: scene.startHour ?? 17 }, hub: { status: 'off', led: 0 }, plan: {} };
    for (const [id, d] of Object.entries(scene.devices)) initial[id] = { status: 'offline', ...d.initial };
    const store = createStore(initial, { headless: true });
    const log = []; const beats = [];
    const player = createPlayer({ store, chat: stubChat(log), headless: true, onBeat: (b) => beats.push(b) });
    const problems = [];
    try { await player.play(setupSteps(scene)); await player.play(prompt.steps); }
    catch (e) { problems.push('threw: ' + e.message); }
    for (const [path, want] of Object.entries(prompt.expect || {})) { const got = store.get(path); if (got !== want) problems.push(`${path} = ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`); }
    for (const b of ['plan', 'run', 'recover', 'end']) if (!beats.includes(b)) problems.push(`beat "${b}" never reached`);
    if (!log.some(([k]) => k === 'end')) problems.push('no end card');
    if (!prompt.steps.some((s) => s.plan || s.ask)) problems.push('no plan/ask step');
    // every device the prompt touches must exist
    const touched = new Set(); const walk = (steps) => { for (const s of steps) { for (const k of ['set', 'tween']) if (s[k]) touched.add(s[k].split('.')[0]); if (s.fail) touched.add(s.fail); if (s.parallel) walk(s.parallel); if (s.plan) for (const ps of s.plan.steps) if (ps.alt?.apply) walk(ps.alt.apply); if (s.ask) for (const o of s.ask.options) walk(o.apply || []); } };
    walk(prompt.steps);
    for (const id of touched) if (!(id in initial)) problems.push(`unknown device "${id}"`);
    // the chip must match itself
    const m = matchPrompt(prompt.chip, scene.prompts); if (m.prompt !== prompt) problems.push('chip does not match its own prompt');
    // guardrails
    const text = JSON.stringify(prompt.steps).toLowerCase();
    for (const bad of [/zigbee/, /matter protocol/, /thread/, /z-wave/, /100%/, /guarantee/]) if (bad.test(text)) problems.push(`guardrail: matches ${bad}`);
    const tag = `${scene.id} · "${prompt.chip.slice(0, 50)}"`;
    if (problems.length) { failures++; console.log(`FAIL ${tag}\n   - ${problems.join('\n   - ')}`); } else console.log(`ok   ${tag}`);
  }
}
console.log(`\n${prompts - failures}/${prompts} prompts pass across ${files.length} scene file(s)`);
process.exit(failures ? 1 : 0);
