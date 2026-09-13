// Headless check of every scene script. Usage: node test/run.mjs [--scene <id>]
//   --scene <id>          one scene only (its checks, typed-request cases and room); --scene fixture: the engine checks
//   NCB_REQUIRE_WHATIF=1  every prompt must have a failPoint (opt-in failures). Off by default while scenes convert.
// Every prompt:
//  1. Default path (auto-approve, ask option 0): doesn't throw, ends in the prompt's `expect` state, touches only
//     known devices, chip matches itself, copy guardrails hold. A request that still scripts its failure (no failPoint)
//     must reach plan, run, recover and end. A request with what-ifs (a failPoint) must run CLEAN: plan, run and end,
//     no recover beat, no *.status = 'fault' write, no chat.alert, exactly one end card (headline ≤ 8 words, body ≤ 2
//     sentences), guardrails on everything it said.
//  2. Every plan Edit alternative and every ask option: runs to the end card without throwing (clean and in its
//     `expect` state, for a request with what-ifs), and an Edit must change what NCB says or the final state.
//  3. All prompts back-to-back with ONE shared player and ONE store, restored to the post-setup snapshot before
//     each prompt, as main.js does: restore must reproduce the snapshot and each prompt must reach `expect`.
//  4. Real-timer skip: a non-headless player at high speed, skipped once the plan card is up (to Recover for a request
//     that scripts its failure, to Done for one with what-ifs), must still show the plan card, reach the end, and
//     leave the player at normal speed for the next request.
//  9. "Not this" on a plan (real timers): play() returns { declined: true }, nothing after the plan runs (store, chat
//     and beats as they were when the plan showed; no end card), and the next play() runs to the end.
// Every prompt with what-ifs (js/engine/whatif.js; the walkers go into parallel, plan alt applies, ask option applies
// and whatIf.*.steps):
// 10. What-if data: failPoints only at the top level of steps, names unique; every `at` and `genericAt` names one;
//     whatIf keys are devices, or specials with a label and an ask; scenarios have steps and no { beat }; alsoFaults
//     are devices; genericTitle is text. The last step of the clean steps and of every scenario is its { end } card
//     (an end card with steps after it would show buttons while the request still runs). Every device of a scene
//     with what-ifs has a `ref`.
// 11. Every connected device and every special, after the clean run of every Edit / ask-option combination, under
//     every option of the scenario's own asks: the what-if flow (the same runWhatIf() as main.js) runs headless to
//     exactly one end card and one recover beat; the quiet replay says, shows and beats nothing, reaches its failPoint
//     and leaves the room exactly as the (fast) clean run had it there; the scenario updates the status line before
//     NCB speaks; a device scenario ends with that device in 'fault'; no other device ends in 'fault' unless the
//     scenario lists it in alsoFaults; end cards as in 1 (an authored one never takes an engine headline); guardrails
//     hold on everything said and shown at run time, plan and ask cards included. "Not this" on every plan card a
//     scenario shows still ends it with exactly one end card, the device still in fault.
//     (How the replay compares with the request played in REAL time, with the room: test/build.mjs, check 17.)
// 12. Generic eligibility (clean run only): a device with no scenario of its own is really unused. No clean run writes
//     its state (other than status), and no chip, plan line, NCB line, status line or end card names it (its name or
//     ref as a whole phrase, any case).
// 13. What-ifs on the virtual clock (test/clock.mjs), normal speed: skipped to Done at the Recover beat (every pick),
//     during the intro and during the hold before the replay, the end card comes at once (the skip carries through
//     the replay into the scenario); skipped to Recover during the intro, the scenario plays at normal speed. One end
//     card, the Recover beat reached, the player back at normal speed.
// Every scene:
//  5. Every device format() renders the initial, online, fault and busy states.
//  6. Scene sources (module-level helpers and constants above `export default`, and the prompts) don't use raw
//     store.tween(...) / setTimeout(...) (use ctx.tween / ctx.sleep), and no text in them trips the copy guardrails.
// 14. End-card headlines differ across a scene's success and scenario cards (the engine's own aside).
//  7. Every scene's 3D room builds in Node (fake canvas) and update() runs through every prompt and every what-if
//     (test/build.mjs); a quiet replay rings (R.ping) and pulses (highlighter focus) nothing in the room.
// 17. (test/build.mjs) The quiet replay puts the room where the request played in real time had it: the clean run on
//     the virtual clock, at normal speed, its room updated every frame, against the replay at each failure point, for
//     every Edit / ask-option combination. Device state must match; a difference in plan.* only counts if a scenario
//     starting there says something different.
//  8. Typed requests route correctly: run the intended chip, refuse negations, ask when vague (test/routing.mjs).
// The engine itself, on test/fixtures/scene.js (three devices, one request with what-ifs; skipped with --scene <id>):
// 15. Player: failPoint is a no-op; `until` at any nesting level; choices in encounter order (asks in ask options, alt
//     applies, parallel branches) and replayed in that order, cards an fn step builds anew too; quiet plays are silent
//     and instant; faultText → faultNote; carry.
// 16. Host logic: the picker, scenario defaults (A1, A9), the what-if flow's order of events, the generic scenario's
//     fast-forward with the remaining answers, the room's quiet flag, leaving mid-run; the checks above catch broken
//     data (a misspelt `at`, a nested failPoint, a generic device the copy names, steps after an end card, a scenario
//     that talks before the status line changes); and the page's request flow (js/engine/flow.js, without a DOM):
//     phases, the beat bar, end-card buttons and their labels, the picker, a declined plan in a request and in a
//     scenario, an end-card button pressed while its request still runs, no ping or pop while quiet, fault lines.
import { createStore } from '../js/engine/store.js';
import { createPlayer, setupSteps } from '../js/engine/player.js';
import { matchPrompt } from '../js/engine/match.js';
import { hasWhatIf, failPointsOf, isFailPoint, pickerOf, scenarioOf, runWhatIf, refOf, devicesOf, GENERIC_HEADLINE, REPLAYING, ENGINE_HEADLINES, DECLINED_END, DECLINED_SAY } from '../js/engine/whatif.js';
import { createFlow, WHATIF_LABEL, ANOTHER_FAILURE, FRESH_START } from '../js/engine/flow.js';
import { virtualTime } from './clock.mjs';
import { sceneSource } from './source.mjs';
import { SCENES } from '../js/scenes/index.js';
import { readdirSync, readFileSync } from 'node:fs';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
register('./loader.mjs', import.meta.url); // 'three' -> vendor/three for the room-build checks

const argv = process.argv.slice(2);
const ONLY = (() => { const i = argv.indexOf('--scene'); return i >= 0 ? String(argv[i + 1] || '') : null; })();
const REQUIRE_WHATIF = process.env.NCB_REQUIRE_WHATIF === '1';

const GUARD = [/\bzigbee\b/, /\bmatter\b/, /\bthread\b/, /\bz-?wave\b/, /100\s?%/, /\bguarantee/, /home assistant(?![^.]{0,80}\b(?:bridge|in progress)\b)/];
const guardHits = (text) => { const t = String(text).toLowerCase(); return GUARD.filter((g) => g.test(t)).map((g) => `matches ${g}`); };
// The words of a plan or ask card, as the chat log keeps them (so guardrails and generic eligibility see cards an fn
// step builds at run time too).
const cardWords = (kind, spec) => [spec?.intro, ...(kind === 'plan' ? (spec?.steps || []).flatMap((s) => [s.text, s.alt?.text]) : (spec?.options || []).map((o) => o.label))].filter((t) => typeof t === 'string');
const stubChat = (log) => ({
  enableInput() {}, typing() {}, resolvePending() {}, failures() {}, closeFailures() {}, closeEnds() {}, closeChips() {},
  ncb: (t) => log.push(['ncb', t]), user: (t) => log.push(['me', t]), alert: (t, title) => log.push(['alert', t, title]),
  button: () => Promise.resolve(), qr: () => Promise.resolve(), chips() {},
  plan: (spec) => { log.push(['plan', ...cardWords('plan', spec)]); return Promise.resolve({ approved: true, alts: {} }); },
  ask: (spec) => { log.push(['ask', ...cardWords('ask', spec)]); return Promise.resolve(0); },
  replan: (spec) => log.push(['replan', JSON.stringify(spec)]), end: (spec) => log.push(['end', spec.headline, spec.body]),
});
const initialOf = (scene) => { const init = { env: { hour: scene.startHour ?? 17 }, hub: { status: 'off', led: 0 }, plan: {} }; for (const [id, d] of Object.entries(scene.devices)) init[id] = { status: 'offline', ...d.initial }; return init; };
// Every step of a list, nested ones too (depth > 0): parallel branches, plan alt applies, ask option applies.
const walk = (steps, visit, depth = 0) => { for (const s of steps || []) { visit(s, depth); if (s.parallel) walk(s.parallel, visit, depth + 1); if (s.plan) for (const ps of s.plan.steps || []) if (ps.alt?.apply) walk(ps.alt.apply, visit, depth + 1); if (s.ask) for (const o of s.ask.options || []) walk(o.apply || [], visit, depth + 1); } };
// A prompt's clean steps (key null), then every what-if scenario's steps (key = its whatIf key).
const walkPrompt = (prompt, visit) => { walk(prompt.steps, (s, d) => visit(s, d, null)); for (const [k, w] of Object.entries(prompt.whatIf || {})) walk(w?.steps || [], (s, d) => visit(s, d, k)); };
const checkExpect = (prompt, store) => Object.entries(prompt.expect || {}).filter(([p, want]) => store.get(p) !== want).map(([p, want]) => `${p} = ${JSON.stringify(store.get(p))}, expected ${JSON.stringify(want)}`);
// The words a step shows the visitor (static copy; fn steps are covered by what they log at run time).
const copyOf = (s) => [s.say, s.user, typeof s.status === 'string' ? s.status : null, s.label, s.fail ? s.title : null,
  s.replan && [s.replan.intro, ...(s.replan.changes || []), s.replan.needsYou], s.end && [s.end.headline, s.end.body],
  s.plan && [s.plan.intro, ...(s.plan.steps || []).flatMap((p) => [p.text, p.alt?.text])], s.ask && [s.ask.intro, ...(s.ask.options || []).map((o) => o.label)]].flat(3).filter((t) => typeof t === 'string');
const logText = (log) => log.map(([, ...rest]) => rest.filter((x) => typeof x === 'string').join(' ')).join('\n');
const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
const sentences = (s) => String(s || '').trim().split(/(?<=[.!?])["”’)]?\s+(?=["“‘(]?[A-Z0-9])/).filter(Boolean).length;
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const phrase = (p) => new RegExp(`(^|[^a-z0-9])${escRe(String(p).toLowerCase())}($|[^a-z0-9])`);
const cardProblems = (log) => log.filter(([k]) => k === 'end').flatMap(([, h, b]) => [
  ...(words(h) > 8 ? [`end card headline over 8 words: "${h}"`] : []),
  ...(sentences(b) > 2 ? [`end card body over 2 sentences: "${String(b).slice(0, 60)}…"`] : [])]);
const primaryOf = (spec) => Math.max(0, (spec.options || []).findIndex((o) => o.primary));
const short = (e) => (e.stack || e.message || String(e)).split('\n').slice(0, 2).join(' | ');
// 6. A scene file, outside its build() method: raw timers / store tweens, and guardrail words in any string or template.
function sourceProblems(src) {
  const { raw, texts } = sceneSource(src), p = [];
  for (const k of ['store.tween(', 'setTimeout(']) { const n = raw.filter((x) => x === k).length; if (n) p.push(`${n}× ${k} outside build() (fn steps and their helpers: use ctx.tween / ctx.sleep)`); }
  for (const t of texts) for (const g of guardHits(t)) p.push(`guardrail (scene source): "${t.slice(0, 60)}${t.length > 60 ? '…' : ''}" ${g}`);
  return p;
}

// A clean run of a prompt, headless: setup first (its chat and statuses dropped), then the prompt. Its plan and ask
// cards go into the log (headless players answer them without the chat).
async function play(scene, prompt, { alts = {}, askIdx = 0 } = {}) {
  const store = createStore(initialOf(scene), { headless: true });
  const log = [], beats = [], statuses = [], writes = [], problems = [];
  const player = createPlayer({ store, chat: stubChat(log), headless: true, onBeat: (b) => beats.push(b), onStatus: (t) => statuses.push(t),
    autoPlan: (spec) => { log.push(['plan', ...cardWords('plan', spec)]); return alts; }, autoAsk: (spec) => { log.push(['ask', ...cardWords('ask', spec)]); return askIdx; } });
  let res = null;
  try {
    await player.play(setupSteps(scene)); log.length = 0; statuses.length = 0;
    store.subscribe((st, path, v) => writes.push([path, v]));
    res = await player.play(prompt.steps);
  } catch (e) { problems.push('threw: ' + short(e)); }
  if (!log.some(([k]) => k === 'end')) problems.push('no end card');
  for (const [id, d] of Object.entries(scene.devices)) { try { d.format(store.state[id], store.state); } catch (e) { problems.push(`format(${id}) threw at end: ${e.message}`); } }
  return { store, log, beats, statuses, writes, problems, choices: res?.choices || [] };
}
const legacyBeats = (r) => ['plan', 'run', 'recover', 'end'].filter((b) => !r.beats.includes(b)).map((b) => `beat "${b}" never reached`);
// A request with what-ifs runs clean (check 1).
function cleanProblems(r, prompt) {
  const p = [...r.problems];
  for (const b of ['plan', 'run', 'end']) if (!r.beats.includes(b)) p.push(`beat "${b}" never reached`);
  if (r.beats.includes('recover')) p.push('a clean run reached a recover beat (failures are opt-in: move the story into whatIf)');
  const faults = r.writes.filter(([path, v]) => /\.status$/.test(path) && v === 'fault').map(([path]) => path.slice(0, -7));
  if (faults.length) p.push(`a clean run faults ${[...new Set(faults)].join(', ')}`);
  const alerts = r.log.filter(([k]) => k === 'alert'); if (alerts.length) p.push(`a clean run raises an alert: "${String(alerts[0][1]).slice(0, 60)}"`);
  const ends = r.log.filter(([k]) => k === 'end').length; if (ends !== 1) p.push(`${ends} end cards`);
  p.push(...checkExpect(prompt, r.store), ...cardProblems(r.log));
  p.push(...guardHits(`${logText(r.log)}\n${r.statuses.join('\n')}`).map((g) => `guardrail (run-time copy): ${g}`));
  return p;
}

// ---------------- what-ifs ----------------
// One what-if, headless, with the same runWhatIf() as main.js. The host stubs check the quiet replay. declinePlans:
// the visitor answers every plan card of the scenario with "Not this". Returns, besides the log: plans (plan cards the
// scenario showed) and talkedFirst (the first thing NCB said in the scenario, if it came before any status line).
async function whatIfRun(scene, prompt, key, choices, askIdx = 0, { declinePlans = false } = {}) {
  const store = createStore(initialOf(scene), { headless: true });
  const log = [], beats = [], statuses = [], problems = [];
  let quiet = false, quietFrom = 0, replayState = null, res = null, plans = 0, scenarioFrom = null, statusAt = null;
  const status = (t) => { statuses.push(t); if (scenarioFrom != null && statusAt == null) statusAt = log.length; };
  const player = createPlayer({ store, chat: stubChat(log), headless: true,
    autoPlan: (spec) => { if (quiet) return {}; plans++; log.push(['plan', ...cardWords('plan', spec)]); return declinePlans ? false : {}; },
    autoAsk: (spec) => { if (!quiet) log.push(['ask', ...cardWords('ask', spec)]); return askIdx; },
    onBeat: (b) => { beats.push(b); if (quiet) problems.push(`beat "${b}" during the quiet replay`); },
    onStatus: (t) => { if (quiet) problems.push(`status during the quiet replay: "${t}"`); status(t); } });
  // The page (js/engine/flow.js) writes the status line for a fault: "<name> · <faultNote or faultText>"
  store.subscribe((st, path, v) => { const [id, k] = path.split('.'); if (!quiet && k === 'status' && v === 'fault' && scene.devices[id]) status(`${scene.devices[id].name} · ${st[id].faultNote || scene.devices[id].faultText || 'fault'}`); });
  try {
    await player.play(setupSteps(scene)); const baseline = store.snapshot(); log.length = 0; statuses.length = 0; beats.length = 0;
    res = await runWhatIf({ player, scene, prompt, key, choices, host: {
      quiet: (on) => {
        if (on) quietFrom = log.length; else if (log.length > quietFrom) problems.push(`chat during the quiet replay: ${log.slice(quietFrom).map(([k, t]) => `${k} "${String(t).slice(0, 40)}"`).join(', ')}`);
        quiet = on; if (!on && scenarioFrom == null) scenarioFrom = log.length; // the scenario starts
      },
      freshRoom: () => store.restore(baseline),
      status: (t) => statuses.push(t),
      clearMarkers: () => { replayState = JSON.stringify(store.state); },
    } });
  } catch (e) { problems.push('threw: ' + short(e)); }
  const talkedFirst = scenarioFrom != null && log.length > scenarioFrom && (statusAt == null || statusAt > scenarioFrom) ? log[scenarioFrom] : null;
  return { store, log, beats, statuses, problems, res, replayState, plans, talkedFirst };
}
// The room of a clean run (Edit / ask-option combination) at a failPoint, played fast: what the replay's mechanics
// (recorded answers, `until`, the fresh room) must reproduce exactly. The real-time comparison is test/build.mjs's.
async function stateAt(scene, prompt, at, combo) {
  const store = createStore(initialOf(scene), { headless: true });
  const player = createPlayer({ store, chat: stubChat([]), headless: true, autoPlan: () => combo.alts || {}, autoAsk: () => combo.askIdx || 0 });
  await player.play(setupSteps(scene)); await player.play(prompt.steps, { until: (s) => isFailPoint(s) && s.failPoint === at });
  return JSON.stringify(store.state);
}
const kindOfStep = (s) => (s ? Object.keys(s).find((k) => k !== 'label') || 'an empty step' : 'nothing');
// 10. Static what-if data of one prompt.
function dataProblems(scene, prompt) {
  const p = [], pts = failPointsOf(prompt), ids = devicesOf(scene);
  walkPrompt(prompt, (s, depth, key) => {
    if (isFailPoint(s) && (depth > 0 || key)) p.push(`failPoint "${s.failPoint}" is ${key ? `inside whatIf.${key}` : 'nested (parallel, plan alt or ask option)'}: failPoints go at the top level of steps`);
    if (key && s.beat) p.push(`whatIf.${key} has a { beat: '${s.beat}' } step (the engine adds Recover before a scenario)`);
  });
  const dup = pts.filter((x, i) => pts.indexOf(x) !== i); if (dup.length) p.push(`failPoint names repeat: ${[...new Set(dup)].join(', ')}`);
  if (prompt.genericAt != null && !pts.includes(prompt.genericAt)) p.push(`genericAt "${prompt.genericAt}" is not a failPoint (${pts.join(', ')})`);
  if (prompt.genericTitle != null && !(typeof prompt.genericTitle === 'string' && prompt.genericTitle.trim())) p.push('genericTitle is not text (the alert title of the engine-generated failure)');
  const endLast = (steps, where) => { const last = steps[steps.length - 1]; if (!last?.end) p.push(`${where} ${last ? `end with ${kindOfStep(last)}` : 'are empty'}, not the { end } card: an end card with steps after it shows its buttons while the request still runs`); };
  endLast(prompt.steps, 'the clean steps');
  for (const [k, w] of Object.entries(prompt.whatIf || {})) {
    if (!w || typeof w !== 'object') { p.push(`whatIf.${k} is not an object`); continue; }
    const dev = ids.includes(k);
    if (!dev && scene.devices[k]) p.push(`whatIf.${k}: "${k}" is a device missing from deviceOrder`);
    if (!dev && !(typeof w.label === 'string' && w.label.trim())) p.push(`whatIf.${k}: a special needs a label (its picker button)`);
    if (!dev && !(typeof w.ask === 'string' && w.ask.trim())) p.push(`whatIf.${k}: a special needs an ask (the visitor's question)`);
    if (w.at != null && !pts.includes(w.at)) p.push(`whatIf.${k}.at "${w.at}" is not a failPoint (${pts.join(', ')})`);
    if (!Array.isArray(w.steps) || !w.steps.length) p.push(`whatIf.${k} has no steps`); else endLast(w.steps, `whatIf.${k}'s steps`);
    if (w.alsoFaults != null && !Array.isArray(w.alsoFaults)) p.push(`whatIf.${k}.alsoFaults is not a list`);
    for (const id of w.alsoFaults || []) if (!ids.includes(id)) p.push(`whatIf.${k}.alsoFaults: "${id}" is not a device`);
    for (const f of ['intro', 'ask', 'label']) if (w[f] != null && typeof w[f] !== 'string') p.push(`whatIf.${k}.${f} is not a string`);
  }
  return p;
}
// 12. Generic eligibility, from the clean runs only.
function eligibilityProblems(scene, prompt, runs) {
  const p = [], unused = pickerOf(scene, prompt).devices.filter((d) => d.unused).map((d) => d.key);
  if (!unused.length) return p;
  const texts = [prompt.chip]; walk(prompt.steps, (s) => texts.push(...copyOf(s)));
  for (const r of runs) texts.push(logText(r.log), ...r.statuses);
  const all = texts.join('\n').toLowerCase();
  for (const id of unused) {
    const wrote = new Set(); for (const r of runs) for (const [path] of r.writes) { const [dev, k] = path.split('.'); if (dev === id && k && k !== 'status') wrote.add(path); }
    if (wrote.size) p.push(`${id} has no scenario of its own (so the generic one), but the clean run writes ${[...wrote].slice(0, 3).join(', ')}: give it a whatIf entry`);
    const named = [scene.devices[id].name, refOf(scene, id)].find((n) => n && phrase(n).test(all));
    if (named) p.push(`${id} has no scenario of its own (so the generic one), but the request's copy names "${named}": give it a whatIf entry`);
  }
  return p;
}
// 11. Every pick of one prompt, after every clean combination. `heads` collects end-card headlines per scene (14).
async function whatIfProblems(scene, prompt, pi, combos, heads) {
  const out = [], picker = pickerOf(scene, prompt), keys = [...picker.devices.map((d) => d.key), ...picker.specials.map((s) => s.key)];
  const atState = new Map();
  for (const key of keys) {
    const sc = scenarioOf(scene, prompt, key), found = new Map(); // problem → the combinations it showed in
    const add = (m, tag) => { if (!found.has(m)) found.set(m, []); found.get(m).push(tag); };
    if (!sc) { out.push([key, ['no scenario for this pick']]); continue; }
    const asks = []; walk(sc.authored ? sc.steps : [], (s) => { if (s.ask) asks.push(s.ask); });
    const nOpts = Math.max(1, ...asks.map((a) => a.options.length));
    const endChecks = (r, tag) => {
      const ends = r.log.filter(([e]) => e === 'end'); if (ends.length !== 1) add(`${ends.length} end cards`, tag);
      const rec = r.beats.filter((b) => b === 'recover').length; if (rec !== 1) add(`${rec} recover beats`, tag);
      if (sc.kind === 'device' && r.store.get(`${key}.status`) !== 'fault') add(`${key} ends "${r.store.get(`${key}.status`)}", not in fault`, tag);
      const others = devicesOf(scene).filter((id) => id !== key && r.store.get(`${id}.status`) === 'fault' && !sc.alsoFaults.includes(id));
      if (others.length) add(`${others.join(', ')} also end${others.length > 1 ? '' : 's'} in fault (not in alsoFaults)`, tag);
      for (const [id, d] of Object.entries(scene.devices)) { try { d.format(r.store.state[id], r.store.state); } catch (e) { add(`format(${id}) threw at the end: ${e.message}`, tag); } }
      cardProblems(ends).forEach((m) => add(m, tag));
      guardHits(`${logText(r.log)}\n${r.statuses.join('\n')}`).forEach((g) => add(`guardrail (run-time copy): ${g}`, tag));
      return ends;
    };
    let declineRun = false;
    for (const c of combos) for (let k = 0; k < nOpts; k++) {
      const tag = `${c.label}${nOpts > 1 ? `, its ask option ${k + 1}` : ''}`;
      const r = await whatIfRun(scene, prompt, key, c.run.choices, k);
      r.problems.forEach((m) => add(m, tag));
      if (!r.res?.replay?.stopped) add(`the quiet replay never reached failPoint "${sc.at}"`, tag);
      const ends = endChecks(r, tag);
      { const eh = ends.find(([, h]) => ENGINE_HEADLINES.includes(h)); if (sc.authored && eh) add(`an authored scenario uses the engine's headline "${eh[1]}"`, tag); }
      if (r.talkedFirst) add(`the scenario speaks (${r.talkedFirst[0]} "${String(r.talkedFirst[1] ?? '').slice(0, 40)}…") before it updates the status line, so "${REPLAYING}" is still up: start with a status step (or a fail)`, tag);
      if (r.statuses.includes(REPLAYING) && r.statuses[r.statuses.length - 1] === REPLAYING) add(`"${REPLAYING}" is still the status line at the end card`, tag);
      const sk = `${c.label}@${sc.at}`; if (!atState.has(sk)) atState.set(sk, await stateAt(scene, prompt, sc.at, c));
      if (r.replayState != null && r.replayState !== atState.get(sk)) add(`the quiet replay left the room unlike the clean run at "${sc.at}"`, tag);
      for (const [, h] of ends) { if (!heads.has(h)) heads.set(h, new Set()); heads.get(h).add(sc.authored ? `p${pi + 1} ${key}` : 'generic'); }
      // "Not this" on the scenario's plan cards (a { plan } step, or one an fn step opens): still exactly one end card
      if (r.plans && !declineRun) {
        declineRun = true; const dtag = `${tag}, "Not this" on its plan cards`;
        const d = await whatIfRun(scene, prompt, key, c.run.choices, k, { declinePlans: true });
        d.problems.forEach((m) => add(m, dtag)); endChecks(d, dtag);
        if (d.res?.declined && !d.log.some(([e, t]) => e === 'ncb' && t === DECLINED_SAY)) add('a declined scenario plan did not get NCB\'s closing line', dtag);
      }
    }
    out.push([key, [...found].map(([m, tags]) => `${m}${combos.length > 1 || tags.length > 1 ? ` [${[...new Set(tags)].slice(0, 4).join('; ')}${tags.length > 4 ? '; …' : ''}]` : ''}`), sc]);
  }
  return out;
}
// 13. On the virtual clock at normal speed (so a skip that doesn't carry shows as seconds): a skip to Done at the
// Recover beat ('recover'), during NCB's intro ('intro'), or during the hold before the replay ('hold'); or a skip to
// Recover during the intro ('intro-recover'), after which the scenario plays at normal speed. An ask card waits for the
// skip (which answers its primary option), except after a skip to Recover, when the visitor answers at once.
async function skippedWhatIf(scene, prompt, key, choices, when) {
  const setupStore = createStore(initialOf(scene), { headless: true });
  await createPlayer({ store: setupStore, chat: stubChat([]), headless: true }).play(setupSteps(scene));
  const baseline = setupStore.snapshot(), store = createStore(baseline);
  const log = [], beats = [], problems = [], pend = []; let player, fastAtRecover = null, skippedAt = null, endAt = null;
  const chat = { ...stubChat(log), plan: () => Promise.resolve({ approved: true, alts: {} }),
    ask: (spec, { skipped } = {}) => (skipped || when === 'intro-recover' ? Promise.resolve(primaryOf(spec)) : new Promise((r) => pend.push(() => r(primaryOf(spec))))),
    resolvePending: () => { for (const f of pend.splice(0)) f(); },
    end: (spec) => { endAt ??= performance.now(); log.push(['end', spec.headline, spec.body]); } };
  const skip = (beat) => { skippedAt = performance.now(); player.skipTo(beat); };
  try {
    await virtualTime(async () => {
      player = createPlayer({ store, chat, speed: 1, onBeat: (b) => {
        beats.push(b);
        if (b === 'run' && !beats.includes('recover') && (when === 'intro' || when === 'intro-recover')) setTimeout(() => skip(when === 'intro' ? 'end' : 'recover'), 300);
        if (b === 'recover') { fastAtRecover = player.fast; if (when === 'recover') setTimeout(() => skip('end'), 0); }
      } });
      await runWhatIf({ player, scene, prompt, key, choices, host: { freshRoom: () => store.restore(baseline), status: () => { if (when === 'hold') setTimeout(() => skip('end'), 200); } } });
    }, { onFrame: (now) => store.tick(now) });
  } catch (e) { problems.push(`threw: ${e.message}`); }
  const ends = log.filter(([k]) => k === 'end').length, target = when === 'intro-recover' ? 'Recover' : 'Done';
  if (ends !== 1) problems.push(`${ends} end cards after a skip to ${target}`);
  if (!beats.includes('recover')) problems.push('never reached the Recover beat');
  if (when === 'intro-recover' && fastAtRecover !== false) problems.push('the scenario did not play at normal speed after a skip to Recover');
  if (when !== 'intro-recover' && skippedAt != null && endAt != null && endAt - skippedAt > 150) problems.push(`the end card came ${Math.round(endAt - skippedAt)} ms after a skip to Done ${when === 'recover' ? 'at the Recover beat' : `during the ${when}`}: the skip didn't carry through`);
  if (skippedAt == null) problems.push('the skip never happened');
  if (scenarioOf(scene, prompt, key)?.kind === 'device' && store.get(`${key}.status`) !== 'fault') problems.push(`${key} ends "${store.get(`${key}.status`)}", not in fault`);
  if (player?.fast) problems.push('player left in fast mode');
  return problems;
}

// ---------------- the checks, per scene ----------------
let failures = 0, runs = 0; const report = (tag, problems) => { runs++; if (problems.length) { failures++; console.log(`FAIL ${tag}\n   - ${problems.join('\n   - ')}`); } else console.log(`ok   ${tag}`); };

async function sceneChecks(scene, { src = null, meta = {} } = {}) {
  const init = initialOf(scene);
  const heads = new Map(); // end-card headline → where it came from (14)
  // 5. formatters; scene-level copy guardrails; refs
  {
    const problems = [];
    for (const [id, d] of Object.entries(scene.devices)) for (const status of ['offline', 'online', 'fault', 'busy']) { try { const st = { ...init, [id]: { ...init[id], status } }; d.format(st[id], st); } catch (e) { problems.push(`format(${id}, ${status}) threw: ${e.message}`); } }
    const text = JSON.stringify([meta.title, meta.promise, meta.tag, scene.title, scene.setupIntro, scene.askIntro, Object.values(scene.devices).map((d) => [d.name, d.ref, d.faultText])]).toLowerCase();
    for (const g of GUARD) if (g.test(text)) problems.push(`guardrail (scene copy): matches ${g}`);
    if (scene.prompts.some(hasWhatIf)) for (const id of devicesOf(scene)) if (!(typeof scene.devices[id].ref === 'string' && scene.devices[id].ref.trim())) problems.push(`device "${id}" has no ref (how NCB names it mid-sentence in what-ifs)`);
    report(`${scene.id} · device formatters and scene copy`, problems);
  }
  // 6. the scene's source outside build() (module-level helpers and constants, the prompts): fn code uses ctx.tween /
  //    ctx.sleep, and no text in it trips the copy guardrails (text an fn step builds, even in a branch no run takes)
  if (src != null) {
    const problems = [], s = sourceProblems(src);
    problems.push(...s);
    report(`${scene.id} · fn steps use ctx.tween / ctx.sleep; guardrails on all the scene's text`, problems);
  }
  for (const [pi, prompt] of scene.prompts.entries()) {
    const tag = `${scene.id} · "${prompt.chip.slice(0, 48)}"`, wi = hasWhatIf(prompt);
    // 1. default path
    const base = await play(scene, prompt);
    const problems = wi ? cleanProblems(base, prompt) : [...base.problems, ...legacyBeats(base), ...checkExpect(prompt, base.store)];
    const touched = new Set(); walkPrompt(prompt, (s) => { for (const k of ['set', 'tween']) if (s[k]) touched.add(s[k].split('.')[0]); if (s.fail) touched.add(s.fail); });
    for (const id of touched) if (!(id in init)) problems.push(`unknown device "${id}"`);
    // A request shows its plan or asks. One with what-ifs may go without a plan card when it doesn't wait for approval
    // (a safety stop): its Plan beat is enough (check 1 above requires it).
    if (!prompt.steps.some((s) => s.plan || s.ask) && !(wi && prompt.steps.some((s) => s.beat === 'plan'))) problems.push('no plan/ask step');
    if (matchPrompt(prompt.chip, scene.prompts).prompt !== prompt) problems.push('chip does not match its own prompt');
    for (const g of GUARD) if (g.test(JSON.stringify(prompt).toLowerCase())) problems.push(`guardrail: matches ${g}`); // whatIf included
    if (!wi && prompt.whatIf) problems.push('has whatIf entries but no failPoint: nobody can reach them');
    if (!wi && REQUIRE_WHATIF) problems.push('no failPoint (NCB_REQUIRE_WHATIF=1: every request needs what-ifs)');
    report(tag, problems);
    // 2. every Edit alternative (must change something) and every ask option
    const plan = prompt.steps.find((s) => s.plan)?.plan; const asks = []; walk(prompt.steps, (s) => { if (s.ask) asks.push(s.ask); });
    const sig = (r) => JSON.stringify([r.log, r.store.state]);
    const combos = [{ label: 'default plan', alts: {}, askIdx: 0, run: base }];
    for (const [i, ps] of (plan?.steps || []).entries()) if (ps.alt) {
      const rr = await play(scene, prompt, { alts: { [i]: true } }); const pr = wi ? cleanProblems(rr, prompt) : [...rr.problems, ...legacyBeats(rr)];
      if (sig(rr) === sig(base)) pr.push('Edit changes nothing: same chat and same final state as the default path');
      report(`${tag} · edit #${i + 1}`, pr); combos.push({ label: `edit #${i + 1}`, alts: { [i]: true }, askIdx: 0, run: rr });
    }
    const maxOpts = Math.max(0, ...asks.map((a) => a.options.length));
    for (let k = 1; k < maxOpts; k++) {
      const rr = await play(scene, prompt, { askIdx: k }); report(`${tag} · ask option ${k + 1}`, wi ? cleanProblems(rr, prompt) : [...rr.problems, ...legacyBeats(rr)]);
      combos.push({ label: `ask option ${k + 1}`, alts: {}, askIdx: k, run: rr });
    }
    if (!wi) continue;
    for (const [, h] of base.log.filter(([k]) => k === 'end')) { if (!heads.has(h)) heads.set(h, new Set()); heads.get(h).add(`p${pi + 1} success`); }
    // 10. data, 12. generic eligibility, 11. every pick, 13. skips on the virtual clock
    report(`${tag} · what-if data`, dataProblems(scene, prompt));
    report(`${tag} · generic devices are unused by the clean run`, eligibilityProblems(scene, prompt, combos.map((c) => c.run)));
    for (const [key, pr, sc] of await whatIfProblems(scene, prompt, pi, combos, heads)) report(`${tag} · what if ${sc ? (sc.kind === 'special' ? `"${sc.label}"` : `${key}${sc.authored ? '' : ' (generic)'}`) : key}`, pr);
    {
      // Every pick: a skip to Done at the Recover beat, during the intro and during the hold; a skip to Recover in the intro.
      const pr = [], pk = pickerOf(scene, prompt), keys = [...pk.devices.map((d) => d.key), ...pk.specials.map((s) => s.key)];
      for (const key of keys) for (const when of ['recover', 'intro', 'hold', 'intro-recover']) pr.push(...(await skippedWhatIf(scene, prompt, key, base.choices, when)).map((m) => `${key}, ${when === 'intro-recover' ? 'skip to Recover during the intro' : `skip to Done ${when === 'recover' ? 'at Recover' : `during the ${when}`}`}: ${m}`));
      report(`${tag} · what-ifs skipped (virtual clock, normal speed): to Done at Recover, in the intro, in the hold; to Recover in the intro`, pr);
    }
  }
  // 14. headlines differ
  if (scene.prompts.some(hasWhatIf)) {
    const problems = [];
    for (const [h, from] of heads) if (!ENGINE_HEADLINES.includes(h) && from.size > 1) problems.push(`"${h}" is the headline of ${[...from].join(', ')}`);
    report(`${scene.id} · end-card headlines are all different`, problems);
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
  // 4. real-timer skip once the plan card is up: to Recover (scripted failure) or Done (what-ifs)
  {
    const problems = [];
    for (const prompt of scene.prompts) {
      const target = hasWhatIf(prompt) ? 'end' : 'recover';
      const store = createStore(init); const iv = setInterval(() => store.tick(performance.now()), 4);
      let plans = 0; const beats = [], log = []; let player;
      const chat = { ...stubChat(log), plan: (spec, { skipped } = {}) => { plans++; if (skipped) return Promise.resolve({ approved: true, alts: {} }); setTimeout(() => player.skipTo(target), 5); return new Promise((r) => { chat._r = r; }); }, ask: (spec) => Promise.resolve(primaryOf(spec)), resolvePending: () => { chat._r?.({ approved: true, alts: {} }); chat._r = null; } };
      player = createPlayer({ store, chat, onBeat: (b) => beats.push(b), speed: 400 });
      try { await player.play(setupSteps(scene).filter((s) => !s.fn)); await player.play(prompt.steps); }
      catch (e) { problems.push(`"${prompt.chip.slice(0, 30)}" threw: ${e.message}`); }
      clearInterval(iv);
      if (prompt.steps.some((s) => s.plan) && plans === 0) problems.push(`"${prompt.chip.slice(0, 30)}": plan card never shown`); // a safety stop deliberately has no plan
      if (!beats.includes('end')) problems.push(`"${prompt.chip.slice(0, 30)}": never reached the end after a skip`);
      if (target === 'end' && log.filter(([k]) => k === 'end').length !== 1) problems.push(`"${prompt.chip.slice(0, 30)}": ${log.filter(([k]) => k === 'end').length} end cards after a skip to Done`);
      if (player.fast) problems.push(`"${prompt.chip.slice(0, 30)}": player left in fast mode after the prompt`);
    }
    report(`${scene.id} · skip with real timers (to Recover, or to Done with what-ifs)`, problems);
  }
  // 9. "Not this" on the plan stops the request there; the next request runs normally
  {
    const problems = [];
    for (const prompt of scene.prompts.filter((p) => p.steps.some((s) => s.plan))) {
      const tag = `"${prompt.chip.slice(0, 30)}"`;
      const store = createStore(init); const iv = setInterval(() => store.tick(performance.now()), 4);
      const log = [], beats = []; let atPlan = null, decline = true;
      const chat = { ...stubChat(log), plan: () => { atPlan = { state: JSON.stringify(store.state), log: log.length, beats: beats.length }; return Promise.resolve(decline ? { approved: false, alts: {} } : { approved: true, alts: {} }); } };
      const player = createPlayer({ store, chat, onBeat: (b) => beats.push(b), speed: 400 });
      try {
        await player.play(setupSteps(scene).filter((s) => !s.fn)); const base = store.snapshot();
        const res = await player.play(prompt.steps);
        if (!res?.declined) problems.push(`${tag}: play() did not return { declined: true }`);
        if (!atPlan) problems.push(`${tag}: plan card never shown`);
        else {
          if (JSON.stringify(store.state) !== atPlan.state) problems.push(`${tag}: the room changed after "Not this"`);
          if (log.length !== atPlan.log) problems.push(`${tag}: NCB kept talking after "Not this": ${log.slice(atPlan.log).map(([k, t]) => `${k} ${String(t).slice(0, 40)}`).join(' / ')}`);
          if (beats.length !== atPlan.beats) problems.push(`${tag}: beats after "Not this": ${beats.slice(atPlan.beats).join(', ')}`);
        }
        if (log.some(([k]) => k === 'end')) problems.push(`${tag}: end card after "Not this"`);
        store.restore(base); log.length = 0; beats.length = 0; decline = false;
        const again = await player.play(prompt.steps);
        if (again?.declined) problems.push(`${tag}: the next request came back declined too`);
        if (!beats.includes('end') || !log.some(([k]) => k === 'end')) problems.push(`${tag}: the next request never reached the end card`);
        if (player.fast) problems.push(`${tag}: player left in fast mode`);
      } catch (e) { problems.push(`${tag} threw: ${e.message}`); }
      clearInterval(iv);
    }
    report(`${scene.id} · "Not this" stops the request; the next one runs`, problems);
  }
}

// ---------------- the engine, on the fixture scene (15, 16) ----------------
async function engineChecks(fixture) {
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const P = fixture.prompts[0];
  // 15a. failPoint no-op; `until` stops before the first matching step, at any nesting level
  {
    const problems = [], store = createStore({ a: {} }, { headless: true }), player = createPlayer({ store, chat: stubChat([]), headless: true, autoPlan: () => ({ 0: true }), autoAsk: () => 1 });
    const ASK = { intro: 'q', options: [{ label: 'x', apply: [] }, { label: 'y', apply: [{ set: 'a.o1', to: 1 }, { failPoint: 'r' }, { set: 'a.o2', to: 2 }] }] };
    const steps = [{ set: 'a.x', to: 1 }, { failPoint: 'p' }, { set: 'a.y', to: 2 }, { parallel: [{ failPoint: 'q' }, { set: 'a.z', to: 3 }] },
      { plan: { intro: 'p', steps: [{ text: 't', alt: { text: 'u', apply: [{ set: 'a.alt', to: 1 }, { failPoint: 's' }, { set: 'a.alt2', to: 2 }] } }] } }, { ask: ASK }, { set: 'a.w', to: 4 }];
    const at = async (name) => { store.restore({ a: {} }); const r = await player.play(steps, name ? { until: (s) => s.failPoint === name } : {}); return [JSON.stringify(store.state.a), r]; };
    let [a, r] = await at(null); if (a !== '{"x":1,"y":2,"z":3,"alt":1,"alt2":2,"o1":1,"o2":2,"w":4}' || r.stopped) problems.push(`a normal run with failPoints: a = ${a}, stopped ${r.stopped}`);
    [a, r] = await at('p'); if (a !== '{"x":1}' || !r.stopped) problems.push(`until "p": a = ${a}, stopped ${r.stopped}`);
    [a, r] = await at('q'); if (a !== '{"x":1,"y":2}' || !r.stopped) problems.push(`until "q" (in a parallel): a = ${a}, stopped ${r.stopped}`);
    [a, r] = await at('s'); if (a !== '{"x":1,"y":2,"z":3,"alt":1}' || !r.stopped) problems.push(`until "s" (in a plan alt): a = ${a}, stopped ${r.stopped}`);
    [a, r] = await at('r'); if (a !== '{"x":1,"y":2,"z":3,"alt":1,"alt2":2,"o1":1}' || !r.stopped) problems.push(`until "r" (in an ask option): a = ${a}, stopped ${r.stopped}`);
    [a, r] = await at('nope'); if (r.stopped) problems.push('until that never matches: stopped');
    if (!('declined' in r && 'choices' in r && 'stopped' in r)) problems.push(`play() resolves ${JSON.stringify(Object.keys(r))}`);
    report('engine · failPoint is a no-op; until stops before the first matching step, nested ones too', problems);
  }
  // 15b. choices: encounter order through nesting, replay in that order
  {
    const problems = [];
    const A1 = { intro: 'a1', options: [{ label: 'x', apply: [{ set: 'r.a1', to: 0 }] }, { label: 'y', apply: [{ set: 'r.a1', to: 1 }] }] };
    const A3 = { intro: 'a3', options: [{ label: 'x', apply: [{ set: 'r.a3', to: 0 }] }, { label: 'y', apply: [{ set: 'r.a3', to: 1 }] }] };
    const A2 = { intro: 'a2', options: [{ label: 'x', apply: [{ set: 'r.a2', to: 0 }] }, { label: 'y', apply: [{ set: 'r.a2', to: 1 }, { ask: A3 }] }] };
    const A4 = { intro: 'a4', options: [{ label: 'x', apply: [{ set: 'r.a4', to: 0 }] }, { label: 'y', apply: [{ set: 'r.a4', to: 1 }] }] };
    const PL = { intro: 'p', steps: [{ text: 'one', alt: { text: 'one b', apply: [{ set: 'r.alt', to: true }, { ask: A1 }] } }, { text: 'two' }] };
    const steps = [{ plan: PL }, { ask: A2 }, { failPoint: 'mid' }, { parallel: [{ set: 'r.par', to: true }, { ask: A4 }] }];
    const run = async (opts, auto) => { const store = createStore({ r: {} }, { headless: true }); const player = createPlayer({ store, chat: stubChat([]), headless: true, ...auto }); const res = await player.play(steps, opts); return { store, res }; };
    const rec = await run({}, { autoPlan: () => ({ 0: true }), autoAsk: (spec) => (spec === A2 ? 1 : spec === A3 ? 0 : 1) });
    const kinds = rec.res.choices.map((c) => (c.type === 'plan' ? 'plan' : `${c.step.intro}=${c.index}`)).join(' ');
    if (kinds !== 'plan a1=1 a2=1 a3=0 a4=1') problems.push(`recorded ${kinds}, expected plan a1=1 a2=1 a3=0 a4=1`);
    if (JSON.stringify(rec.res.choices[0]) !== '{"type":"plan","approved":true,"alts":{"0":true}}') problems.push(`plan entry ${JSON.stringify(rec.res.choices[0])}`);
    const rep = await run({ replay: rec.res.choices }, { autoPlan: () => ({}), autoAsk: () => 0 });
    if (!eq(rep.store.state, rec.store.state)) problems.push(`a replay ends in ${JSON.stringify(rep.store.state.r)}, the recorded run in ${JSON.stringify(rec.store.state.r)}`);
    if (rep.res.unused.length || rep.res.choices.length !== 5 || rep.res.choices.some((c, i) => c !== rec.res.choices[i])) problems.push('a replay should consume every entry, in order');
    const part = await run({ replay: rec.res.choices, until: (s) => s.failPoint === 'mid' }, { autoPlan: () => ({}), autoAsk: () => 0 });
    if (part.res.unused.length !== 1 || part.res.unused[0] !== rec.res.choices[4]) problems.push(`a replay stopped at "mid" leaves ${part.res.unused.length} unused entries, expected the last one`);
    const hand = await run({ replay: [{ approved: true, alts: { 0: true } }, 1, 1, 0, 1] }, { autoPlan: () => ({}), autoAsk: () => 0 });
    if (!eq(hand.store.state, rec.store.state)) problems.push(`a hand-written replay ends in ${JSON.stringify(hand.store.state.r)}`);
    report('engine · choices recorded in encounter order and replayed in that order', problems);
  }
  // 15b'. cards an fn step builds anew each run (copy from the store) are replayed with the visitor's answers: by their
  //       words, else in the order fn steps opened them; static cards keep matching by identity, even with the same words
  {
    const problems = []; let runNo = 0;
    const S1 = { intro: 'same words', options: [{ label: 'a' }, { label: 'b' }] }, S2 = { intro: 'same words', options: [{ label: 'a' }, { label: 'b' }] };
    const steps = [
      { ask: S1 }, { fn: ({ store }) => store.set('r.s1', 'done') },
      { fn: async (c) => { const i = await c.chat.ask({ intro: `Water ${c.store.get('r.l') ?? 1} l?`, options: [{ label: 'Yes', primary: true }, { label: 'No' }] }); c.store.set('r.fnAsk', i); } },
      { fn: async (c) => { const v = await c.chat.plan({ intro: 'fn plan', steps: [{ text: 'a', alt: { text: 'b', apply: [] } }] }); c.store.set('r.fnAlts', v.alts); } },
      { fn: async (c) => { const i = await c.chat.ask({ intro: `Run ${++runNo}: which?`, options: [{ label: 'x' }, { label: 'y' }, { label: 'z' }] }); c.store.set('r.counter', i); } }, // words change every run
      { ask: S2 }, { failPoint: 'x' }, { set: 'r.after', to: true },
    ];
    const answers = [1, 1, { approved: true, alts: { 0: true } }, 2, 0]; // S1, fn ask, fn plan, counter ask, S2
    const q = [...answers]; const chat = { ...stubChat([]), ask: () => Promise.resolve(q.shift()), plan: () => Promise.resolve(q.shift()) };
    const store = createStore({ r: {} }); const player = createPlayer({ store, chat, speed: 1000 });
    const opts = { autoPlan: () => ({}), autoAsk: () => 0 };
    const vis = await player.play(steps); const want = JSON.stringify(store.state.r);
    store.restore({ r: {} });
    const rep = await player.play(steps, { quiet: true, replay: vis.choices, until: (s) => s.failPoint === 'x' });
    const want2 = JSON.stringify({ ...JSON.parse(want), after: undefined });
    if (JSON.stringify(store.state.r) !== want2) problems.push(`the quiet replay ends in ${JSON.stringify(store.state.r)}, the visitor's run in ${want}`);
    if (rep.unused.length) problems.push(`${rep.unused.length} recorded answers left unused`);
    if (vis.choices.map((c) => c.via).join() !== 'step,fn,fn,fn,step') problems.push(`recorded via ${vis.choices.map((c) => c.via).join()}`);
    const h = createPlayer({ store: createStore({ r: {} }, { headless: true }), chat: stubChat([]), headless: true, ...opts });
    const hr = await h.play([{ ask: S2 }, { ask: S1 }], { replay: vis.choices }); // identity, not words: S2 takes its own 0, S1 its own 1
    if (hr.choices.map((c) => c.index).join() !== '0,1') problems.push(`two static cards with the same words were answered ${hr.choices.map((c) => c.index).join()}, expected 0,1`);
    // an fn card the replay doesn't open (it opens only when not fast): the next fn card still gets its own answer, by its words
    const opt = [{ label: 'a' }, { label: 'b' }, { label: 'c' }];
    const two = [{ fn: async (c) => { if (!c.fast) c.store.set('r.x', await c.chat.ask({ intro: 'only when played', options: opt })); } }, { fn: async (c) => { c.store.set('r.y', await c.chat.ask({ intro: 'always', options: opt })); } }];
    const q2 = [1, 2]; const p2 = createPlayer({ store: createStore({ r: {} }), chat: { ...stubChat([]), ask: () => Promise.resolve(q2.shift()) }, speed: 1000 });
    const v2 = await p2.play(two); const s2 = createStore({ r: {} }, { headless: true });
    await createPlayer({ store: s2, chat: stubChat([]), headless: true, ...opts }).play(two, { replay: v2.choices });
    if (s2.get('r.y') !== 2) problems.push(`an fn card after one the replay skipped got answer ${s2.get('r.y')}, expected the visitor's 2`);
    report('engine · cards an fn step builds are replayed with the visitor\'s answers', problems);
  }
  // 15c. quiet: silent (chat, status, labels, beats), instant, plan/ask from replay or defaults; fn cards recorded
  {
    const problems = [], calls = [], statuses = [], beats = [];
    const chat = new Proxy({}, { get: (t, k) => (...a) => { calls.push(k); if (k === 'plan') return Promise.resolve({ approved: true, alts: {} }); if (k === 'ask') return Promise.resolve(1); return undefined; } });
    const store = createStore({ d: { status: 'online' }, plan: {} });
    let ends = 0, fastInFn = null;
    const player = createPlayer({ store, chat, speed: 1, onStatus: (t) => statuses.push(t), onBeat: (b) => beats.push(b), endOptions: () => { ends++; return {}; } });
    const ASK = { intro: 'q', options: [{ label: 'a', apply: [{ set: 'plan.ask', to: 0 }] }, { label: 'b', primary: true, apply: [{ set: 'plan.ask', to: 1 }] }] };
    const steps = [{ beat: 'run' }, { say: 'hello' }, { user: 'hi' }, { status: 'line' }, { status: () => 'fn line' }, { set: 'd.v', to: 1, label: 'label' }, { tween: 'd.t', to: 5, ms: 5000, label: 'tween label' }, { wait: 5000 },
      { plan: { intro: 'p', steps: [{ text: 'x', alt: { text: 'y', apply: [{ set: 'plan.alt', to: true }] } }] } }, { ask: ASK }, { replan: { intro: 'r', changes: [] } }, { fail: 'd', say: 'down', faultText: 'note' },
      { fn: async (c) => { fastInFn = c.fast; c.status('ctx status'); await c.say('ctx say'); c.chat.ncb('raw'); c.chat.typing(true); await c.chat.button('b'); await c.chat.qr(); c.chat.chips([], () => {}); c.chat.alert('a'); await c.sleep(5000); const i = await c.chat.ask(ASK); c.store.set('plan.fnAsk', i); } },
      { end: { headline: 'h', body: 'b' } }];
    const t0 = Date.now(); const r = await player.play(steps, { quiet: true }); const ms = Date.now() - t0;
    if (calls.length) problems.push(`the chat was called in a quiet play: ${[...new Set(calls)].join(', ')}`);
    if (statuses.length) problems.push(`status written in a quiet play: ${statuses.join(' / ')}`);
    if (beats.length || ends) problems.push(`beats (${beats.join(', ')}) or end options (${ends}) in a quiet play`);
    if (ms > 200) problems.push(`a quiet play with 15 s of waits took ${ms} ms`);
    if (fastInFn !== true) problems.push('ctx.fast is not true in a quiet play');
    if (store.get('d.v') !== 1 || store.get('d.t') !== 5 || store.get('d.status') !== 'fault' || store.get('d.faultNote') !== 'note') problems.push(`store writes missing in a quiet play: ${JSON.stringify(store.state.d)}`);
    if (store.get('plan.alt') || store.get('plan.ask') !== 1 || store.get('plan.fnAsk') !== 1) problems.push(`quiet defaults: plan as shown (alt ${store.get('plan.alt')}), asks their primary (${store.get('plan.ask')}, fn ${store.get('plan.fnAsk')})`);
    if (r.choices.map((c) => c.type).join() !== 'plan,ask,ask') problems.push(`quiet choices ${JSON.stringify(r.choices)}`);
    if (player.quiet || player.fast) problems.push('player left quiet or fast after a quiet play');
    // the next play is loud again, and records the chat's answers, fn-opened cards too
    calls.length = 0; const r2 = await player.play([{ ask: ASK }, { fn: async (c) => { c.store.set('plan.fn2', await c.chat.ask(ASK)); } }]);
    if (calls.join() !== 'ask,ask' || r2.choices.map((c) => c.index).join() !== '1,1') problems.push(`a loud play after a quiet one: chat calls ${calls.join()}, choices ${JSON.stringify(r2.choices)}`);
    report('engine · a quiet play is silent and instant', problems);
  }
  // 15d. fail.faultText → faultNote before the fault, in parallel and ask options too; a bare fail keeps the note
  {
    const problems = [], order = [];
    const store = createStore({ a: { status: 'online' }, b: { status: 'online' }, c: { status: 'online' } }, { headless: true });
    store.subscribe((st, path, v) => order.push(`${path}=${v}`));
    const player = createPlayer({ store, chat: stubChat([]), headless: true, autoAsk: () => 0 });
    await player.play([{ fail: 'a', faultText: 'one' }, { fail: 'a' }, { parallel: [{ wait: 10 }, { fail: 'b', faultText: 'two' }] }, { ask: { intro: 'q', options: [{ label: 'x', apply: [{ fail: 'c', faultText: 'three' }] }] } }]);
    if (order.indexOf('a.faultNote=one') !== 0 || order.indexOf('a.status=fault') !== 1) problems.push(`order of writes: ${order.slice(0, 3).join(', ')}`);
    if (store.get('a.faultNote') !== 'one') problems.push(`a bare fail changed the note to ${store.get('a.faultNote')}`);
    if (store.get('b.faultNote') !== 'two' || store.get('c.faultNote') !== 'three') problems.push(`nested fails: b ${store.get('b.faultNote')}, c ${store.get('c.faultNote')}`);
    report('engine · fail.faultText sets faultNote before the fault, nested too', problems);
  }
  // 15e. carry: a skip in progress carries into a play that continues the request, never into a new one
  {
    const problems = [], store = createStore({ a: {} }), log = [];
    const player = createPlayer({ store, chat: stubChat(log), speed: 1 });
    const p1 = player.play([{ wait: 5000 }]); player.skipTo('end'); await p1;
    let t0 = Date.now(); await player.play([{ wait: 40 }]); if (Date.now() - t0 < 30) problems.push('a new play ran fast after a skip');
    const p2 = player.play([{ wait: 5000 }]); player.skipTo('end'); await p2;
    t0 = Date.now(); await player.play([{ wait: 3000 }, { end: { headline: 'h', body: 'b' } }], { carry: true }); if (Date.now() - t0 > 500) problems.push('a carried skip did not fast-forward');
    if (player.fast) problems.push('the skip to Done did not end at the end card');
    report('engine · a skip carries only into a play that continues the request', problems);
  }
  // 16a. picker and scenario defaults
  {
    const problems = [], pk = pickerOf(fixture, P);
    if (pk.devices.map((d) => `${d.key}${d.unused ? '*' : ''}`).join() !== 'lamp,pump,fan*') problems.push(`picker devices ${JSON.stringify(pk.devices)}`);
    if (pk.specials.map((s) => `${s.key}:${s.label}`).join() !== 'dip:The power dips') problems.push(`picker specials ${JSON.stringify(pk.specials)}`);
    const s = (k) => scenarioOf(fixture, P, k) || {};
    const want = {
      lamp: ['What if the desk lamp fails?', 'Replaying this request. This time the desk lamp goes dark right after it comes on.', 'lit', true],
      pump: ['What if the water pump fails?', 'Replaying this request. This time, the water pump fails during the run.', 'watering', true],
      fan: ['What if the ceiling fan fails?', 'Replaying this request. This time, the ceiling fan fails during the run.', 'watering', false],
      dip: ['What if the power dips?', 'Replaying this request. This time: the power dips.', 'watering', true],
    };
    for (const [k, [ask, intro, at, authored]] of Object.entries(want)) { const x = s(k); if (x.ask !== ask || x.intro !== intro || x.at !== at || x.authored !== authored) problems.push(`${k}: ${JSON.stringify([x.ask, x.intro, x.at, x.authored])}`); }
    if (scenarioOf(fixture, P, 'nope') !== null || scenarioOf(fixture, { ...P, steps: P.steps.filter((x) => !isFailPoint(x)) }, 'lamp') !== null) problems.push('unknown keys and prompts without failPoints must give no scenario');
    const noRef = { devices: { a: { name: 'Water pump' }, b: { name: 'Mirror M2' }, c: { name: 'USB webcam' }, d: { name: 'Cart A' } } };
    const refs = ['a', 'b', 'c', 'd'].map((id) => refOf(noRef, id)).join(' / ');
    if (refs !== 'the water pump / Mirror M2 / the USB webcam / Cart A') problems.push(`ref fallbacks: ${refs}`);
    const gen = s('fan'); if (!gen.head || gen.head[0].say !== 'Ceiling fan stopped responding · off the network.' || gen.head[0].title !== '⚠ Device down' || gen.tail.at(-1).end.headline !== GENERIC_HEADLINE || !gen.tail.at(-1).end.body.startsWith('The ceiling fan stopped responding, but this request didn')) problems.push('generic scenario copy');
    const noted = scenarioOf(fixture, { ...P, genericTitle: '📝 Noted, not urgent' }, 'fan'); if (noted?.head?.[0]?.title !== '📝 Noted, not urgent') problems.push(`genericTitle (A9): the generic alert is titled ${JSON.stringify(noted?.head?.[0]?.title)}`);
    report('engine · picker and what-if defaults', problems);
  }
  // 16b. the what-if flow's order of events, and the generic scenario's fast-forward
  {
    const problems = [], log = [], events = [];
    const store = createStore(initialOf(fixture), { headless: true });
    const clean = createPlayer({ store, chat: stubChat([]), headless: true, autoPlan: () => ({ 0: true }), autoAsk: () => 1 });
    await clean.play(setupSteps(fixture)); const baseline = store.snapshot();
    const rec = (await clean.play(P.steps)).choices;
    const flow = async (key, extra = {}) => {
      store.restore(baseline); log.length = 0; events.length = 0;
      const player = createPlayer({ store, chat: stubChat(log), headless: true, onBeat: (b) => events.push(`beat:${b}`), onStatus: (t) => events.push(`status:${t}`) });
      const tap = (k) => (...a) => events.push(`${k}${a.length ? `:${a[0]}` : ''}`);
      const res = await runWhatIf({ player, scene: fixture, prompt: P, key, choices: rec, host: { quiet: tap('quiet'), freshRoom: () => { events.push('freshRoom'); store.restore(baseline); }, status: tap('host-status'), clearMarkers: tap('clearMarkers'), ...extra } });
      return res;
    };
    await flow('pump');
    const seq = events.join(' > ');
    if (!seq.startsWith(`beat:run > quiet:true > freshRoom > host-status:${REPLAYING} > clearMarkers > quiet:false > beat:recover > status:Watering`)) problems.push(`pump: ${seq.slice(0, 200)}`);
    if (log[0]?.[0] !== 'me' || log[1]?.[1] !== 'Replaying this request. This time, the water pump fails during the run.') problems.push(`pump opens with ${JSON.stringify(log.slice(0, 2))}`);
    if (store.get('pump.faultNote') !== 'stalled · left off' || store.get('plan.dim') !== true || store.get('plan.litres') !== 3) problems.push(`pump ends ${JSON.stringify(store.state.pump)} / plan ${JSON.stringify(store.state.plan)}: the replay should keep the recorded Edit and ask answer`);
    const res = await flow('fan');
    const gseq = events.join(' > ');
    if (!/beat:recover > quiet:true > quiet:false > beat:end$/.test(gseq)) problems.push(`fan: ${gseq}`);
    const said = log.map(([k, t]) => `${k}:${t}`);
    if (!said.includes('alert:Ceiling fan stopped responding · off the network.') || !said.includes("ncb:This request doesn't use the ceiling fan, so nothing in the plan changes. I've flagged it, and I'll tell you when it's back.") || said.at(-2) !== 'ncb:The rest of the request ran as planned.' || !said.at(-1).startsWith(`end:${GENERIC_HEADLINE}`)) problems.push(`fan says ${said.join(' / ')}`);
    if (store.get('lamp.level') !== 0.2 || store.get('fan.status') !== 'fault' || store.get('pump.litres') !== 3) problems.push(`fan: the fast-forward should use the rest of the recorded answers (lamp ${JSON.stringify(store.state.lamp)}, pump ${JSON.stringify(store.state.pump)})`);
    if (res.rest?.stopped !== true) problems.push('fan: the fast-forward should stop before the end card');
    let alive = true; const ab = await flow('lamp', { freshRoom: () => { events.push('freshRoom'); store.restore(baseline); alive = false; }, alive: () => alive });
    if (!ab.aborted || events.includes('clearMarkers') || events.includes('beat:recover')) problems.push(`leaving mid-run: ${events.join(' > ')}`);
    report('engine · the what-if flow: bubble, intro, fresh room, quiet replay, Recover, scenario; generic fast-forward', problems);
  }
  // 16c. the room's quiet flag: build() gets quiet(), and a quiet replay rings nothing
  {
    const problems = [], THREE = await import('three'), pings = [];
    let q = false; const store = createStore(initialOf(fixture), { headless: true });
    const R = { scene: new THREE.Scene(), addPickable() {}, ping: (id, text) => pings.push(`${q ? 'QUIET ' : ''}${text}`), clearMarkers() {} };
    fixture.build({ R, THREE, store, quiet: () => q });
    const player = createPlayer({ store, chat: stubChat([]), headless: true, autoAsk: () => 0 });
    await player.play(setupSteps(fixture)); const baseline = store.snapshot();
    const choices = (await player.play(P.steps)).choices; pings.length = 0;
    for (const key of ['fan', 'pump', 'dip']) { store.restore(baseline); await runWhatIf({ player, scene: fixture, prompt: P, key, choices, host: { quiet: (on) => { q = on; }, freshRoom: () => store.restore(baseline) } }); }
    if (pings.some((p) => p.startsWith('QUIET'))) problems.push(`rang during a quiet replay: ${pings.join(' / ')}`);
    if (pings.length !== 2) problems.push(`expected the pump ping in the pump and dip scenarios only, got ${pings.join(' / ')}`);
    report('engine · build({ quiet }): the room stays silent during a quiet replay', problems);
  }
  // 16d. the checks catch broken what-if data
  {
    const problems = [], clone = () => ({ ...P, whatIf: { ...P.whatIf } });
    const bad1 = clone(); bad1.whatIf.lamp = { ...P.whatIf.lamp, at: 'lt' };
    if (!dataProblems(fixture, bad1).some((m) => m.includes('"lt" is not a failPoint'))) problems.push('a misspelt `at` went unnoticed');
    const bad2 = clone(); bad2.steps = [...P.steps.slice(0, 5), { parallel: [{ failPoint: 'deep' }] }, ...P.steps.slice(5)];
    if (!dataProblems(fixture, bad2).some((m) => m.includes('"deep" is nested'))) problems.push('a nested failPoint went unnoticed');
    const bad3 = clone(); bad3.whatIf.x = { steps: [{ beat: 'recover' }, { end: { headline: 'h', body: 'b' } }] };
    const d3 = dataProblems(fixture, bad3); if (!d3.some((m) => m.includes('needs a label')) || !d3.some((m) => m.includes('{ beat'))) problems.push(`a special without label/ask, with a beat: ${d3.join(' / ')}`);
    const bad4 = { ...clone(), chip: 'Light the desk, water the plant, leave the ceiling fan.' };
    const runs4 = [await play(fixture, bad4)];
    if (!eligibilityProblems(fixture, bad4, runs4).some((m) => m.includes('names "Ceiling fan"'))) problems.push('a generic device named in the chip went unnoticed');
    const bad5 = clone(); bad5.steps = [...P.steps.slice(0, -1), { set: 'fan.on', to: true }, P.steps.at(-1)];
    if (!eligibilityProblems(fixture, bad5, [await play(fixture, bad5)]).some((m) => m.includes('writes fan.on'))) problems.push('a generic device the clean run writes went unnoticed');
    const bad6 = clone(); bad6.whatIf.lamp = { ...P.whatIf.lamp, steps: P.whatIf.lamp.steps.filter((x) => !x.fail) };
    const out6 = await whatIfProblems(fixture, bad6, 0, [{ label: 'default plan', alts: {}, askIdx: 0, run: await play(fixture, bad6) }], new Map());
    if (!out6.find(([k]) => k === 'lamp')?.[1].some((m) => m.includes('not in fault'))) problems.push('a device scenario that never faults its device went unnoticed');
    const bad7 = clone(); bad7.steps = P.steps.map((x) => (x.ask ? { ...x, ask: { ...x.ask, options: x.ask.options.map((o) => ({ ...o, apply: [...o.apply, { fn: ({ chat }) => chat.alert('Zigbee is 100% fine') }] })) } } : x));
    if (!cleanProblems(await play(fixture, bad7), bad7).some((m) => m.includes('alert')) ) problems.push('an alert (and guardrail words) in a clean run went unnoticed');
    const bad8 = clone(); bad8.steps = [...P.steps, { wait: 3000 }]; bad8.whatIf.lamp = { ...P.whatIf.lamp, steps: [...P.whatIf.lamp.steps, { wait: 3000 }] };
    const d8 = dataProblems(fixture, bad8); if (!d8.some((m) => m.startsWith('the clean steps end with wait')) || !d8.some((m) => m.startsWith("whatIf.lamp's steps end with wait"))) problems.push(`steps after an end card went unnoticed: ${d8.join(' / ')}`);
    const bad9 = clone(); bad9.whatIf.pump = { ...P.whatIf.pump, steps: [{ say: 'The pump has stopped.' }, ...P.whatIf.pump.steps] };
    const out9 = await whatIfProblems(fixture, bad9, 0, [{ label: 'default plan', alts: {}, askIdx: 0, run: await play(fixture, bad9) }], new Map());
    if (!out9.find(([k]) => k === 'pump')?.[1].some((m) => m.includes('before it updates the status line'))) problems.push('a scenario that speaks while "Replaying this request…" is up went unnoticed');
    // a scenario with a plan card: fine as it is, and "Not this" on it ends the what-if with the engine's card
    const PLAN = { plan: { intro: 'New plan: water by hand?', steps: [{ text: 'Skip the pump today' }] } };
    const ok10 = clone(); ok10.whatIf.pump = { ...P.whatIf.pump, steps: [...P.whatIf.pump.steps.slice(0, 3), PLAN, ...P.whatIf.pump.steps.slice(3)] };
    const run10 = await play(fixture, ok10), out10 = await whatIfProblems(fixture, ok10, 0, [{ label: 'default plan', alts: {}, askIdx: 0, run: run10 }], new Map());
    const p10 = out10.find(([k]) => k === 'pump')?.[1] || ['missing']; if (p10.length) problems.push(`a scenario with a plan card: ${p10.join(' / ')}`);
    const d10 = await whatIfRun(fixture, ok10, 'pump', run10.choices, 0, { declinePlans: true }), e10 = d10.log.filter(([k]) => k === 'end');
    if (!d10.res?.declined || e10.length !== 1 || e10[0][1] !== DECLINED_END.headline || d10.store.get('pump.status') !== 'fault') problems.push(`"Not this" in a scenario: declined ${d10.res?.declined}, end cards ${e10.map((e) => e[1]).join(' / ')}, pump ${d10.store.get('pump.status')}`);
    const bad11 = clone(); bad11.whatIf.dip = { ...P.whatIf.dip, steps: [...P.whatIf.dip.steps.slice(0, -1), { fn: async ({ chat }) => { await chat.plan({ intro: 'We could switch to Zigbee', steps: [{ text: 'x' }] }); } }, P.whatIf.dip.steps.at(-1)] };
    const out11 = await whatIfProblems(fixture, bad11, 0, [{ label: 'default plan', alts: {}, askIdx: 0, run: await play(fixture, bad11) }], new Map());
    if (!out11.find(([k]) => k === 'dip')?.[1].some((m) => m.includes('guardrail'))) problems.push('guardrail words on a plan card an fn step builds went unnoticed');
    const src12 = `const helper = { fn: async (ctx) => { setTimeout(() => {}, 5); ctx.store.tween('a.b', 1, 5); ctx.chat.ncb('Thread is ready'); } };\n// a comment about Zigbee and setTimeout( is fine\nexport default {\n  build({ R }) { setTimeout(() => R.ping('x', 'y'), 0); return { update() {} }; },\n  prompts: [{ steps: [helper, { say: /100%/.test('x') ? 'a' : 'b' }] }],\n};\n`;
    const s12 = sourceProblems(src12);
    if (s12.filter((m) => /setTimeout|store\.tween/.test(m)).length !== 2 || !s12.some((m) => m.includes('Thread is ready')) || s12.some((m) => /Zigbee|100%/.test(m))) problems.push(`the source scan (module-level helpers in, build() and comments and regexes out): ${s12.join(' / ')}`);
    report('engine · the what-if checks catch broken data', problems);
  }
  // 16e. the page's request flow (js/engine/flow.js), without a DOM
  {
    const problems = [];
    const mk = (scene = fixture, { autoPlan = () => ({}), autoAsk = () => 0, onEnd = null, alive = () => true } = {}) => {
      const log = [], ev = [], ends = [], pickers = [], chips = [], beats = [], noise = [];
      const chat = { ...stubChat(log), closeEnds: () => ev.push('closeEnds'), closeFailures: () => ev.push('closeFailures'),
        end: (spec, opts = {}) => { log.push(['end', spec.headline, spec.body]); ends.push({ spec, opts }); onEnd?.(opts); },
        failures: (spec, onPick) => pickers.push({ spec, onPick }), chips: (list, onPick, o = {}) => chips.push({ list, onPick, heading: o.heading }) };
      const store = createStore(initialOf(scene), { headless: true });
      const t = { log, ev, ends, pickers, chips, beats, noise, store };
      t.flow = createFlow({ scene, store, chat, player: { headless: true, autoPlan, autoAsk }, ui: {
        alive, beats: (b) => beats.push({ ...b, phase: t.flow?.phase, whatIf: !!t.flow?.running?.whatIf }), status: (s, bad) => ev.push(`status:${s}${bad ? ' (red)' : ''}`),
        ping: (id, text) => { ev.push(`ping:${id}:${text}`); if (t.flow.quiet()) noise.push(`ping ${text}`); },
        pop: (id) => { ev.push(`pop:${id}`); if (t.flow.quiet()) noise.push(`pop ${id}`); },
        focus: (id) => { if (t.flow.quiet()) noise.push(`focus ${id}`); }, unping: (id, k) => ev.push(`unping:${id}:${k}`),
      } });
      return t;
    };
    // setup → chips; a clean run → its success card; the picker; a what-if → its card; the fault line; no noise while quiet
    {
      const t = mk(); await t.flow.start();
      const pings = t.ev.filter((e) => e.startsWith('ping:')); if (pings.join() !== 'ping:hub:NeuCharBox · powered,ping:lamp:Desk lamp · connected,ping:pump:Water pump · connected,ping:fan:Ceiling fan · connected') problems.push(`setup pings: ${pings.join(' / ')}`);
      if (t.flow.phase !== 'chips' || t.chips.length !== 1 || t.beats.at(-1).current !== 'ask' || !t.beats.at(-1).recoverHidden) problems.push(`after setup: phase ${t.flow.phase}, ${t.chips.length} chip lists, beat ${JSON.stringify(t.beats.at(-1))}`);
      await t.chips[0].onPick(P);
      const atPlan = t.beats.find((b) => b.current === 'plan');
      if (!atPlan || !atPlan.recoverHidden || atPlan.skippable.join() !== 'run,end') problems.push(`beat bar at Plan in a clean run: ${JSON.stringify(atPlan)}`);
      if (t.flow.phase !== 'end' || !t.flow.lastChoices.has(P) || t.ends.length !== 1 || t.ends[0].opts.whatIfLabel !== WHATIF_LABEL || !t.ends[0].opts.onMore) problems.push(`after the clean run: phase ${t.flow.phase}, choices ${t.flow.lastChoices.has(P)}, end cards ${JSON.stringify(t.ends.map((e) => e.opts.whatIfLabel))}`);
      t.ends[0].opts.onWhatIf();
      const pk = t.pickers[0]?.spec; if (!pk || pk.devices.map((d) => `${d.key}${d.hint ? `(${d.hint})` : ''}`).join() !== 'lamp,pump,fan(not in this request)' || pk.specials.map((s) => s.key).join() !== 'dip') problems.push(`the picker: ${JSON.stringify(pk)}`);
      const ev0 = t.ev.length; await t.pickers[0].onPick('pump');
      if (t.noise.length) problems.push(`rang or popped while quiet: ${t.noise.join(' / ')}`);
      const rec = t.beats.find((b) => b.current === 'recover'); if (!rec || rec.recoverHidden || rec.skippable.join() !== 'end') problems.push(`beat bar at Recover in a what-if: ${JSON.stringify(rec)}`);
      const after = t.ev.slice(ev0); if (!after.includes(`status:${REPLAYING}`) || !after.includes('status:Water pump · stalled (red)') || !after.includes('status:Water pump · stalled · left off (red)')) problems.push(`status lines of the what-if: ${after.filter((e) => e.startsWith('status:')).join(' / ')}`);
      if (t.flow.phase !== 'end' || t.ends.length !== 2 || t.ends[1].opts.whatIfLabel !== ANOTHER_FAILURE) problems.push(`after the what-if: phase ${t.flow.phase}, end cards ${JSON.stringify(t.ends.map((e) => e.opts.whatIfLabel))}`);
      t.ends[1].opts.onMore();
      if (t.flow.phase !== 'chips' || t.chips.length !== 2 || !t.log.some(([k, s]) => k === 'ncb' && s === FRESH_START) || t.store.get('pump.status') !== 'online') problems.push(`"Another request here": phase ${t.flow.phase}, pump ${t.store.get('pump.status')}`);
      t.ends[1].opts.onWhatIf(); if (t.pickers.length !== 1) problems.push('an old end card\'s what-if button opened a picker while the chips were up');
      if (!t.beats.at(-1).recoverHidden) problems.push('Recover still shows once the chips are back');
    }
    // an end-card button pressed while its request still runs (a step after { end }): it acts once the request is over
    {
      const trailing = { ...P, steps: [...P.steps, { wait: 50 }] }; const scene = { ...fixture, prompts: [trailing] };
      const t = mk(scene, { onEnd: (opts) => { if (t.flow.phase === 'prompt') (t.clicks++ ? opts.onMore : opts.onWhatIf)?.(); } }); t.clicks = 0;
      await t.flow.start(); await t.chips[0].onPick(trailing);
      if (t.pickers.length !== 1 || t.flow.phase !== 'end') problems.push(`"What if something fails?" pressed while the request still ran: ${t.pickers.length} pickers, phase ${t.flow.phase}`);
      else {
        await t.pickers[0].onPick('lamp');
        if (t.flow.phase !== 'chips' || t.chips.length !== 2) problems.push(`"Another request here" pressed while the what-if still ran: phase ${t.flow.phase}, ${t.chips.length} chip lists`);
      }
    }
    // nothing from the store reaches the room or the dashboard while quiet, even a fault the replayed request writes
    {
      const faulty = { ...P, steps: P.steps.flatMap((s) => (s.beat === 'run' ? [s, { set: 'fan.status', to: 'fault' }, { set: 'fan.status', to: 'online' }] : [s])) };
      const t = mk({ ...fixture, prompts: [faulty] }); await t.flow.start(); await t.chips[0].onPick(faulty); t.ends[0]?.opts.onWhatIf?.();
      const e0 = t.ev.length; if (t.pickers[0]) await t.pickers[0].onPick('lamp');
      if (t.noise.length || t.ev.slice(e0).some((e) => e.startsWith('status:Ceiling fan'))) problems.push(`store writes during the quiet replay reached the page: ${[...t.noise, ...t.ev.slice(e0).filter((e) => e.startsWith('status:Ceiling fan'))].join(' / ')}`);
    }
    // "Not this" on the request's plan, and on a scenario's plan
    {
      const t = mk(fixture, { autoPlan: () => false }); await t.flow.start(); await t.chips[0].onPick(P);
      if (t.flow.phase !== 'chips' || t.flow.lastChoices.has(P) || !/^OK\. Nothing ran/.test(t.chips[1]?.heading || '') || t.chips[1]?.list.at(-1) !== P || t.ends.length) problems.push(`"Not this" on the request's plan: phase ${t.flow.phase}, chips ${JSON.stringify(t.chips[1]?.heading)}`);
      const PLAN = { plan: { intro: 'New plan?', steps: [{ text: 'Water by hand' }] } };
      const withPlan = { ...P, whatIf: { ...P.whatIf, pump: { ...P.whatIf.pump, steps: [...P.whatIf.pump.steps.slice(0, 3), PLAN, ...P.whatIf.pump.steps.slice(3)] } } };
      const u = mk({ ...fixture, prompts: [withPlan] }, { autoPlan: (spec) => (spec === PLAN.plan ? false : {}) });
      await u.flow.start(); await u.chips[0].onPick(withPlan); u.ends[0].opts.onWhatIf(); await u.pickers[0].onPick('pump');
      const last = u.ends.at(-1); if (u.flow.phase !== 'end' || last?.spec.headline !== DECLINED_END.headline || last?.opts.whatIfLabel !== ANOTHER_FAILURE || !last?.opts.onMore) problems.push(`"Not this" on a scenario's plan: phase ${u.flow.phase}, last card ${JSON.stringify(last?.spec)} ${JSON.stringify(last?.opts.whatIfLabel)}`);
    }
    // a device that drops offline mid-run (A5); a request without failPoints (legacy); a bug in a request; leaving mid-what-if
    {
      const legacy = { ...P, steps: P.steps.filter((s) => !isFailPoint(s)).map((s) => (s.beat === 'run' ? [s, { set: 'lamp.status', to: 'offline' }, { set: 'lamp.status', to: 'online' }] : s)).flat(), whatIf: undefined };
      const t = mk({ ...fixture, prompts: [legacy] }); await t.flow.start(); const e0 = t.ev.length; await t.chips[0].onPick(legacy);
      const run = t.ev.slice(e0); if (run.some((e) => e.startsWith('ping:lamp')) || !run.includes('unping:lamp:fault')) problems.push(`a device offline then online mid-run: ${run.filter((e) => /lamp/.test(e)).join(' / ')}`);
      const atPlan = t.beats.find((b) => b.current === 'plan'); if (!atPlan || atPlan.recoverHidden || atPlan.skippable.join() !== 'run,recover') problems.push(`beat bar of a request without failPoints: ${JSON.stringify(atPlan)}`);
      if (t.ends[0]?.opts.onWhatIf) problems.push('a request without failPoints offers what-ifs');
      const broken = { ...P, steps: [P.steps[0], { fn: () => { throw new Error('boom'); } }, ...P.steps.slice(1)] };
      const b = mk({ ...fixture, prompts: [broken] }); const err = console.error; console.error = () => {};
      try { await b.flow.start(); await b.chips[0].onPick(broken); } finally { console.error = err; }
      if (b.flow.phase !== 'end' || b.flow.running !== null || !b.log.some(([k, , title]) => k === 'alert' && title === '⚠ Demo error') || b.ends[0]?.opts.onWhatIf || !b.ends[0]?.opts.onMore) problems.push(`a bug mid-request: phase ${b.flow.phase}, cards ${JSON.stringify(b.ends.map((e) => e.spec.headline))}`);
      let here = true; const g = mk(fixture, { alive: () => here }); await g.flow.start(); await g.chips[0].onPick(P); g.ends[0].opts.onWhatIf();
      const orig = g.flow.player.play; g.flow.player.play = (steps, o) => { if (o?.quiet) here = false; return orig(steps, o); }; // the visitor leaves as the replay starts
      await g.pickers[0].onPick('lamp');
      if (g.ends.length !== 1 || g.flow.quiet() || g.beats.some((x) => x.current === 'recover')) problems.push(`leaving mid-what-if: ${g.ends.length} end cards, quiet ${g.flow.quiet()}`);
    }
    report('engine · the page\'s request flow: phases, beat bar, end-card buttons, picker, "Not this", quiet, faults', problems);
  }
  // 16f. check 17 (test/build.mjs) sees a replay that differs from the request played in real time: device state written
  //      only when not fast, and a plan flag written only when not fast that a scenario then reads; not a cue nothing reads
  {
    const problems = [], { realTimeProblems } = await import('./build.mjs');
    const at = P.steps.findIndex((s) => s.failPoint === 'lit');
    const variant = (fnStep, lampSteps = P.whatIf.lamp.steps) => { const p = { ...P, steps: [...P.steps.slice(0, at), fnStep, ...P.steps.slice(at)], whatIf: { ...P.whatIf, lamp: { ...P.whatIf.lamp, steps: lampSteps } } }; return [{ ...fixture, prompts: [p] }, p]; };
    const [s1, p1] = variant({ fn: ({ store, fast }) => { if (!fast) store.set('lamp.level', 0.9); } });
    const r1 = await realTimeProblems(s1, p1, { initialOf, stubChat }); if (!r1.some((m) => m.includes('lamp.level = 0.8 after the replay, 0.9 in the request played in real time'))) problems.push(`device state set only when not fast: ${r1.join(' / ') || 'not seen'}`);
    const [s2, p2] = variant({ fn: ({ store, fast }) => { if (!fast) store.set('plan.announced', true); } }, [{ status: 'Checking' }, { fn: (c) => c.say(c.store.get('plan.announced') ? 'As I said, the lamp is on.' : 'The lamp is on.') }, ...P.whatIf.lamp.steps.slice(1)]);
    const r2 = await realTimeProblems(s2, p2, { initialOf, stubChat }); if (!r2.some((m) => m.includes('plan.announced') && m.includes('says something else'))) problems.push(`a plan flag set only when not fast, read by a scenario: ${r2.join(' / ') || 'not seen'}`);
    const [s3, p3] = variant({ fn: ({ store, fast }) => { if (!fast) store.set('plan.cue', { id: 'lamp', text: 'Desk lamp · on' }); } });
    const r3 = await realTimeProblems(s3, p3, { initialOf, stubChat }); if (r3.length) problems.push(`a cue nothing reads after the failure point counted as a difference: ${r3.join(' / ')}`);
    // check 7 sees a room that pulses a device (a highlighter's focus) during the quiet replay
    const pulsing = { ...fixture, id: 'pulsing', build(o) { const room = fixture.build(o); const g = new o.THREE.Group(); o.R.scene.add(g); const hi = o.P.highlighter({ pump: [g] }); o.store.subscribe((st, path, v) => { if (path === 'pump.running' && v) hi.focus('pump'); }); return room; } };
    const seen = []; await (await import('./build.mjs')).buildChecks({ report: (tag, pr) => seen.push(...pr), initialOf, stubChat, scenes: [pulsing] });
    if (!seen.some((m) => m.includes('pulsed pump') && m.includes('during the quiet replay'))) problems.push(`a room pulsing a device during the quiet replay: ${seen.join(' / ') || 'not seen'}`);
    report('engine · checks 7 and 17 see a room that pulses while quiet, and a replay unlike the request played in real time', problems);
  }
}

// Importable, to run the checks on a scene object you build or patch in memory:
//   const { sceneChecks, buildChecks, results } = await import('./test/run.mjs'); await sceneChecks(scene); console.log(results());
export { sceneChecks, engineChecks, initialOf, stubChat, report };
export const results = () => ({ runs, failures });
export async function buildChecks(opts) { const m = await import('./build.mjs'); return m.buildChecks({ report, initialOf, stubChat, ...opts }); }

// ---------------- run ----------------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = readdirSync(new URL('../js/scenes/', import.meta.url)).filter((f) => f.endsWith('.js') && f !== 'index.js');
  const scenes = [];
  for (const f of files) { const { default: scene } = await import(`../js/scenes/${f}`); if (!ONLY || ONLY === scene.id) scenes.push({ scene, f }); }
  if (ONLY && ONLY !== 'fixture' && !scenes.length) { console.log(`No scene "${ONLY}" (have: fixture, ${files.map((f) => f.replace(/\.js$/, '')).join(', ')})`); process.exit(1); }
  for (const { scene, f } of scenes) await sceneChecks(scene, { src: readFileSync(new URL(`../js/scenes/${f}`, import.meta.url), 'utf8'), meta: SCENES.find((m) => m.id === scene.id) || {} });
  let fixture = null;
  if (!ONLY || ONLY === 'fixture') {
    ({ default: fixture } = await import('./fixtures/scene.js'));
    await sceneChecks(fixture, { src: readFileSync(new URL('./fixtures/scene.js', import.meta.url), 'utf8') });
    await engineChecks(fixture);
  }
  // 8. typed-request routing
  if (scenes.length) { const { routingChecks } = await import('./routing.mjs'); routingChecks({ report, scenes: Object.fromEntries(scenes.map(({ scene }) => [scene.id, scene])) }); }
  // 7. room builds (and every what-if through update())
  await buildChecks({ scenes: [...scenes.map(({ scene }) => scene), ...(fixture ? [fixture] : [])] });

  console.log(`\n${runs - failures}/${runs} checks pass across ${scenes.length} scene file(s)${fixture ? ' and the engine fixture' : ''}${REQUIRE_WHATIF ? ' (NCB_REQUIRE_WHATIF=1)' : ''}`);
  process.exit(failures ? 1 : 0);
}
