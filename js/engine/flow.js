// The request flow of a mounted scene, without the page: setup, the chips, a request and its end card, and the
// what-ifs of a request that has them (js/engine/whatif.js). main.js wires it to the DOM (beat bar, status line,
// room, dashboard); test/run.mjs drives it with stubs (check 16e).
//   phase    'setup' → 'chips' (the visitor picks or types a request) → 'prompt' (a request or a what-if runs) → 'end'
//            (its end card is up: "Another request here", plus "What if something fails?" / "Try another failure" for a
//            request with what-ifs). One request at a time: a chip, a pick or a what-if button outside its phase does
//            nothing, except an end-card button pressed while that request's last steps still run (after its { end }):
//            it acts as soon as they have.
//   running  the request running, or that ran last: { prompt, whatIf } (null while the chips are up, or after a bug)
//   quiet()  true while a what-if replays the request quietly (A2): main.js hands it to scene.build({ quiet }), and no
//            ping, tile pop or status line comes from store writes meanwhile.
// ui (every hook optional): alive() (false once the visitor left the scene), beats({ current, recoverHidden,
// skippable }) (the beat bar: the current beat, whether Recover shows, the beats a skip may target), status(text,
// bad), ping(id, text, opts), unping(id, kind), focus(id, hex), pop(id) (the dashboard tile), track(on) and rewind()
// (the dashboard strip), resetRoom() (after the store is back at the post-setup snapshot: room.reset and
// R.clearMarkers), clearMarkers(), error(e).
import { createPlayer, setupSteps } from './player.js';
import { hasWhatIf, pickerOf, runWhatIf } from './whatif.js';

// Recover shows only in a what-if run (and in a request that still scripts its failure: no failPoint yet).
export const BEATS = [['setup', 'Setup'], ['ask', 'Ask'], ['plan', 'Plan'], ['run', 'Run'], ['recover', 'Recover'], ['end', 'Done']];
export const FRESH_START = 'Fresh start: the room is back the way it was right after setup.';
export const DEMO_ERROR = { alert: 'That request stopped halfway because of a bug in this demo, not a device.', title: '⚠ Demo error', end: { headline: 'The simulation hit a bug.', body: 'Nothing real was touched. Use "Another request here" to try again, or pick another scene.' } };
export const WHATIF_LABEL = 'What if something fails?', ANOTHER_FAILURE = 'Try another failure';
export const quoted = (p) => `"${p.chip.replace(/[.!?]+$/, '')}"`; // the chip already ends in a full stop; the sentence adds its own

export function createFlow({ scene, store, chat, ui = {}, speed = 1, player: playerOpts = {} }) {
  const u = { alive: () => true, beats() {}, status() {}, ping() {}, unping() {}, focus() {}, pop() {}, track() {}, rewind() {}, resetRoom() {}, clearMarkers() {}, error: (e) => console.error(e), ...ui };
  const ids = scene.deviceOrder || Object.keys(scene.devices).filter((d) => d !== 'hub' && d !== 'env');
  let phase = 'setup';
  let running = null;
  let quietNow = false;
  let statusText = '';
  let baseline = null;  // the room right after setup; every request starts from it
  let dirty = false;    // a request has touched the room since the last reset
  let afterRun = null;  // an end-card button pressed while its request's last steps still ran: done when they have
  const used = new Set();
  const lastChoices = new Map(); // prompt → plan and ask answers of the visitor's last clean run of it: what a what-if replays

  const setStatus = (text, bad = false) => { statusText = text; u.status(text, bad); };
  const waiting = () => setStatus(`${ids.length} devices connected · waiting for your request`);

  // Discovery and fault effects in the room: ring + label at the device, tile pop in the dashboard (labels hold for
  // less under ?speed=, so a fault label doesn't outlast the next moment). What a fault says: the scenario's note for it
  // (fail.faultText → <id>.faultNote, and a later note rewrites the status line while it still shows that fault), else
  // the device's default. A device that drops 'offline' mid-run gets no ping (A5). Nothing here runs while quiet.
  const faultMsg = (state, id) => `${scene.devices[id].name} · ${state[id]?.faultNote || scene.devices[id].faultText || 'fault'}`;
  let faultLine = null; // { id, text }: the status line reports this fault
  store.subscribe((state, path, value) => {
    if (quietNow) return;
    const [id, key] = path.split('.');
    if (key === 'faultNote' && faultLine?.id === id && state[id]?.status === 'fault' && statusText === faultLine.text) { faultLine.text = faultMsg(state, id); setStatus(faultLine.text, true); return; }
    if (key !== 'status') return;
    if (id === 'hub' && value === 'on') { u.ping('hub', 'NeuCharBox · powered'); return; }
    if (!scene.devices[id]) return;
    if (value === 'online' && phase === 'setup') { u.focus(id); u.ping(id, `${scene.devices[id].name} · connected`, { hold: Math.max(1200, 1900 / speed) }); u.pop(id); }
    if (value === 'online' && phase === 'prompt') u.unping(id, 'fault');
    if (value === 'fault') { const msg = faultMsg(state, id); faultLine = { id, text: msg }; setStatus(msg, true); u.focus(id, 0xE0563A); u.ping(id, msg, { color: '#E0563A', hex: 0xE0563A, hold: Math.max(1200, 3200 / speed), kind: 'fault' }); u.pop(id); }
  });

  // The beat bar. Recover shows in a what-if run, and for a request that still scripts its failure (no failPoint);
  // between requests, while the scene still has such a request. Skip targets: the shown beats after this one, and Done
  // too for a request with what-ifs (a skip then runs to the end card; an ask on the way takes its primary option).
  const recoverShown = () => (running ? running.whatIf || !hasWhatIf(running.prompt) : scene.prompts.some((p) => !hasWhatIf(p)));
  function setBeat(id) {
    const recoverHidden = !recoverShown(), idx = BEATS.findIndex((b) => b[0] === id);
    if (phase === 'prompt' && id !== 'end') u.track(true); // each beat is a new chapter for the dashboard strip too
    const toDone = !!running && (running.whatIf || hasWhatIf(running.prompt));
    const skippable = BEATS.filter(([b], i) => phase === 'prompt' && i > idx && !(b === 'recover' && recoverHidden) && (i < BEATS.length - 1 || toDone)).map(([b]) => b);
    u.beats({ current: id, recoverHidden, skippable });
  }

  // End cards: "Another request here" always. A request with what-ifs adds "What if something fails?" to its success
  // card, and "Try another failure" to a what-if's card: both open the picker of failures for it.
  const endOptions = () => {
    const o = { onMore: () => another() }, p = running?.prompt;
    if (p && hasWhatIf(p)) { o.onWhatIf = () => openFailures(p); o.whatIfLabel = running.whatIf ? ANOTHER_FAILURE : WHATIF_LABEL; }
    return o;
  };
  const player = createPlayer({ store, chat, onBeat: setBeat, onStatus: (s) => setStatus(s), onPlan: () => { if (statusText === 'Request received') setStatus('Waiting for your approval'); }, endOptions, ...playerOpts });

  function freshRoom() { store.restore(baseline); u.resetRoom(); dirty = false; }
  const demoError = () => { chat.alert(DEMO_ERROR.alert, DEMO_ERROR.title); chat.end(DEMO_ERROR.end, { onMore: () => another() }); };
  const remaining = () => { const left = scene.prompts.filter((p) => !used.has(p)); return left.length ? left : scene.prompts; };
  // A request (or a what-if) is over: its end card is up. An end-card button pressed while it still ran acts now.
  function ended() { phase = 'end'; setBeat('end'); const f = afterRun; afterRun = null; if (f) f(); }

  async function start() {
    setStatus('Hub is off');
    await player.play(setupSteps(scene));
    if (!u.alive()) return;
    baseline = store.snapshot();
    offerChips();
  }
  function offerChips(heading, list = remaining()) {
    phase = 'chips'; running = null; afterRun = null; setBeat('ask'); waiting(); u.rewind(); // phones: the strip starts at the first tile again
    chat.chips(list, (p) => runPrompt(p, p.chip, false), { heading: heading || (used.size ? 'Pick another request for this room, or type your own.' : (scene.askIntro || 'What do you want this place to do? Pick one, or type your own.')) });
  }
  // "Another request here": the next request starts from the room right after setup, so show that room (and its
  // dashboard) while the visitor chooses, not the last run's end state and faults.
  function another() {
    if (phase === 'prompt') { afterRun = another; return; } // the request's end card is up while its last steps still run
    chat.closeFailures(); chat.closeEnds();
    if (dirty && baseline) { freshRoom(); chat.ncb(FRESH_START); }
    offerChips();
  }
  async function runPrompt(prompt, typed = prompt.chip, fallback = false) {
    if (phase !== 'chips') return; // one request at a time
    phase = 'prompt'; used.add(prompt); running = { prompt, whatIf: false }; afterRun = null; chat.enableInput(false); chat.closeEnds(); chat.closeChips();
    chat.user(typed);
    try {
      if (dirty && baseline) { freshRoom(); chat.ncb(FRESH_START); }
      setStatus('Request received'); dirty = true; // the prompt's own steps take the status line from here
      u.track(true); // phones: each tile the request changes scrolls into view once
      if (fallback) chat.ncb(`I'll take that as: ${quoted(prompt)}. (This demo is scripted — a real hub would take your words as they are.)`);
      else if (typed !== prompt.chip) chat.ncb(`Understood — treating that as: ${quoted(prompt)}.`);
      const res = await player.play(prompt.steps);
      u.track(false);
      if (!u.alive()) return;
      if (res?.declined) { // "Not this" on the plan: nothing ran, so put back anything the lead-up touched and ask again
        used.delete(prompt); if (baseline) freshRoom();
        const others = scene.prompts.filter((p) => p !== prompt), left = others.filter((p) => !used.has(p)); // the others first, the declined one still there last
        offerChips('OK. Nothing ran, and the room is as it was. Pick another request, or type your own.', [...(left.length ? left : others), prompt]); return;
      }
      if (hasWhatIf(prompt)) lastChoices.set(prompt, res.choices);
    } catch (e) {
      u.error(e); u.track(false);
      if (!u.alive()) return;
      running = null; demoError(); // no what-ifs from a run that broke
    }
    if (!u.alive()) return;
    ended();
  }

  // The picker of failures for the request that just ran: every connected device (one the request doesn't use carries
  // "not in this request" and gets the generic scenario), then the request's specials. One pick per card.
  function openFailures(prompt) {
    if (phase === 'prompt' && running?.prompt === prompt) { afterRun = () => openFailures(prompt); return; } // see another()
    if (phase !== 'end' || !lastChoices.has(prompt)) return;
    chat.closeFailures();
    const { devices, specials } = pickerOf(scene, prompt);
    chat.failures({
      heading: running?.whatIf ? 'Pick another one. Same request, same choices.' : "Pick what goes wrong. I'll replay this request with your choices and show you what I do.",
      devices: devices.map((d) => ({ key: d.key, icon: d.icon, name: d.name, hint: d.unused ? 'not in this request' : '' })),
      specials,
    }, (key) => whatIf(prompt, key));
  }
  // A what-if: the visitor's bubble, NCB's intro, the room back to right after setup, the request replayed quietly with
  // the visitor's recorded choices up to the failure point, then the Recover beat and the scenario.
  async function whatIf(prompt, key) {
    const choices = lastChoices.get(prompt);
    if (phase !== 'end' || !choices) return; // one request at a time
    phase = 'prompt'; running = { prompt, whatIf: true }; afterRun = null; chat.enableInput(false); chat.closeFailures(); chat.closeEnds(); chat.closeChips();
    dirty = true;
    try {
      await runWhatIf({ player, scene, prompt, key, choices, host: {
        alive: () => u.alive(),
        quiet: (on) => { quietNow = on; u.track(!on); }, // the dashboard follows the scenario, not the replay
        freshRoom: () => { if (baseline) freshRoom(); dirty = true; },
        status: (text) => setStatus(text),
        clearMarkers: () => u.clearMarkers(),
      } });
      u.track(false);
    } catch (e) {
      quietNow = false; u.error(e); u.track(false);
      if (!u.alive()) return;
      running = null; demoError();
    }
    if (!u.alive()) return;
    ended();
  }

  return {
    player, start, runPrompt, openFailures, whatIf, another, offerChips, remaining, lastChoices, used,
    quiet: () => quietNow,
    skipTo: (beat) => player.skipTo(beat),
    cancel: () => player.cancel(),
    get phase() { return phase; }, get running() { return running; }, get status() { return statusText; },
  };
}
