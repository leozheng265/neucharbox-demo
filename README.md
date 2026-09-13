# NeuCharBox live demo

Interactive, scripted simulation of NeuCharBox for Kickstarter visitors: five
3D scenes (home, laser lab, elder care, warehouse, creator desk), each walking
through plug in → discover devices → ask → plan → approve → run → done. Every
request finishes as asked; the visitor can then pick something to fail and
watch NeuCharBox notice it, keep things safe and re-plan. Everything runs in
the browser; no backend, no keys, no analytics.

Design spec: `docs/design.md`.

## Run locally

```bash
python serve.py
```

Open http://localhost:8765/ (a picker) or http://localhost:8765/#home to jump to
a scene. Review options: `?speed=4` runs the scripts four times faster (up to
6), and `?q=high` or `?q=low` locks the 3D quality tier (no automatic
switching; for screenshots), e.g. `/?speed=3&q=low#lab`.
The server sends no-cache headers, so a plain refresh picks up code changes.
(With a generic static server you'd need Ctrl+F5 — browsers cache the modules.)

Camera: drag to orbit, scroll to zoom, right-drag to pan (or click the room and
use the arrow keys), and the ⟲ button resets the view (a glide in progress
stops there). Panning keeps the view around the room. Walls are single-sided, so
any angle looks in; what hangs on a wall hides with it (and can't be tapped
while hidden). Every request after the first starts from the room as it was
right after setup. A plan card runs nothing until it is approved; its "Not this"
button ends the request with nothing run and offers the other requests first.

## What if something fails? (opt-in failures)

The default run of every request is clean: Setup · Ask · Plan · Run · Done, and
a success end card. Failures are the visitor's choice:

1. The success end card has **What if something fails?**. It opens a picker:
   every connected device of the scene (icon and name, in scene order; a device
   the request doesn't use carries a grey "not in this request"), then, under
   "Or", the request's special what-ifs (a problem that isn't a device, like a
   disturbance on the beam). One pick per picker.
2. The visitor's bubble asks it ("What if the water pump fails?"), and NCB says
   what it will replay ("Replaying this request. This time, the water pump
   fails during the run.").
3. The room goes back to right after setup and the request replays instantly
   and silently (no chat, status line, pings or room marks), with the plan Edits
   and ask answers of the visitor's last clean run of it, up to the scenario's
   failure point.
4. A **Recover** beat appears before Done and the scenario plays at normal
   speed: the device fails in the room (red cue, tile, status line), NCB says
   what it sees and does, puts things in a safe state or works around it,
   shows a re-plan card, and ends with the scenario's end card. If a scenario
   shows a plan card and the visitor answers "Not this", nothing more of it
   runs: NCB says it will leave everything as it is, and the engine's end card ("You
   said no, so it waited.") closes the what-if with the same buttons.
5. The scenario end card has **Try another failure** (the picker again, same
   request, same choices), **Another request here**, **Try another scene** and
   the Kickstarter button.

The beat bar shows Recover only during a what-if. A beat skip goes to any later
beat, Done included (it runs to the end card; an ask card on the way takes its
primary, safe option). Typed requests are off during a what-if. A typed "what if
the hall light stops working?" while the chips are up is not run as a request:
NCB says how to pick a failure, with the closest request first
(`asksWhatIfFails()` in `js/engine/match.js`).

A device a request doesn't use gets an engine-made scenario: it fails at the
prompt's `genericAt` point, NCB says the request doesn't use it and flags it,
says it is skipping ahead, the rest of the request runs quietly as planned (the
room jumps to its end), the status line becomes "<Device> flagged · the rest ran
as planned", and the end card reads "It knew what mattered."

On a phone the dashboard is a strip that follows the request. A what-if starts
it again from the first tile, a device in fault stays in view while NCB talks
about it (other changes show beside it when they fit), and the end card leaves
the strip on the device(s) left in fault.

The page's side of all this (phases, the beat bar's state, end-card buttons,
the picker, what-ifs) lives in `js/engine/flow.js`, which has no DOM in it:
`js/main.js` wires it to the page, and the tests drive it with stubs. An
end-card button pressed while its request's last steps still run acts as soon
as they have.

## Test

```bash
node test/run.mjs                 # everything
node test/run.mjs --scene lab     # one scene (its checks, typed requests and room)
node test/run.mjs --scene fixture # just the engine's own checks
```

Runs in Node, no browser needed:

- every prompt's default path, every plan Edit choice and every ask option runs
  to the end card in the prompt's `expect` state; an Edit must change what NCB
  says or does. Every request must have a failPoint and run clean: no fault, no
  alert, no Recover beat, exactly one end card (headline of at most 8 words, body
  of at most 2 sentences);
- what-if data: failPoints only at the top level of `steps`, every `at` and
  `genericAt` names one, specials have a `label` and an `ask`, scenarios have no
  `beat` steps, the clean steps and every scenario end with their `end` card
  (nothing after it), `genericTitle` is text, every device has a `ref` (and
  `plural`, if set, is true or false);
- every connected device and every special of every request with what-ifs, after
  the clean run of every Edit and ask-option combination and under every option
  of the scenario's own asks, runs through the same `runWhatIf()` as the page:
  one end card, a silent replay that leaves the room exactly as the (fast)
  clean run had it at the failure point, the scenario changes the status line
  before NCB speaks, the device ends in fault and no other device does (unless
  listed in `alsoFaults`); "Not this" on every plan card a scenario shows still
  ends it with one end card;
- the replay against the request played in real time: the clean run plays on a
  virtual clock (`test/clock.mjs`) at normal speed with its room updated every
  frame, and at each failure point the replay must leave the devices as it did.
  A step that writes device state differently when fast (`ctx.fast`: a skip, or
  the replay) needs a fallback that lands where the played run does. A
  difference in `plan.*` (the scene's bookkeeping, like a cue that pings the
  room) only counts if a scenario starting there says something else. No tween
  may still be moving when the played run reaches a failure point (the replay
  lands it at once, so the scenario would start from a room nobody saw);
- a device on the generic path is really unused: the clean run writes none of its
  state (other than status) and no chip, plan line, NCB line, status line or end
  card names it (its name or `ref`, as a whole phrase);
- end-card headlines differ across a scene's success and scenario cards;
- all prompts back-to-back in one room with the reset between them;
- skips: to Done once the plan card is up (real timers); and, on the virtual
  clock at normal speed, to Done during a what-if's intro, its hold, or at
  Recover (the end card comes at once), and to Recover during the intro (the
  scenario then plays at normal speed);
- "Not this" on a plan stops the request there (nothing after the plan runs,
  no end card) and the next request runs normally;
- device formatters, copy guardrails (scene copy, every prompt including its
  `whatIf`, everything said or shown at run time, plan and ask cards an `fn`
  builds too, and every string in the scene file outside `build()`), and no raw
  `store.tween`/`setTimeout` outside `build()` (fn steps and their module-level
  helpers alike);
- every scene's 3D room builds and animates through every prompt and every
  what-if (fake canvas, `test/build.mjs`; `test/loader.mjs` maps `three` to the
  vendored copy); a room that rings (`R.ping`) or pulses (a highlighter's
  `focus`) during a quiet replay fails; in the home, the soil probe knocked out
  of its pot must lie outside the pot and above the floor;
- the engine itself, on `test/fixtures/scene.js` (three devices, one request
  with what-ifs): player (failPoint, `until` at any depth, recorded and replayed
  choices, cards an `fn` builds, quiet plays, `faultText`), the what-if flow, the
  page's request flow (`js/engine/flow.js` without a DOM), and that the checks
  above catch broken data;
- typed requests route correctly (`test/routing.mjs`): dozens of realistic
  phrasings must run the intended request, or get an answer and the chips back.
  Typed text runs a request only when it clearly is one; NCB clarifies instead
  when the text is vague or fits two requests, asks for other numbers or
  another device, axis or lane, asks for something the chip rules out or that
  its plan does ("don't open the shutter"), asks for a stop no chip does, asks
  for the opposite of a chip ("don't go live", "close the shutter"), or asks a
  question, asks for a check or states a fact ("is the shutter open?", "tell me
  if the shutter is open", "the shutter is open") rather than a request. The
  page uses the same `interpret()` (`js/engine/match.js`), so add a case to
  `test/routing.mjs` when you add a prompt. A typed "what if <device> fails?"
  must be told how to pick a failure (and "what if mum falls" must not).

`test/run.mjs` can also be imported to run the checks on a scene object built or
patched in memory: `const { sceneChecks, buildChecks, results } = await
import('./test/run.mjs')`.

## Deploy

See **DEPLOY.md** (English + 中文) for the hosting requirements. In short: this
folder is a static site with no build step and no external requests (Three.js
is vendored in `vendor/`), to be served over HTTPS from a host outside mainland
China, with a CNAME for `demo.neucharbox.com`. Any of these works in minutes:

- **Vercel / Netlify / Cloudflare Pages:** point it at this repository, no
  build command, output directory `/`.
- **GitHub Pages:** Settings → Pages → deploy from the `main` branch, root.
- **Alibaba Cloud OSS + CDN (Hong Kong or Singapore):** upload the folder as a
  static website, enable HTTPS.

The Kickstarter CTA links carry `?ref=demo`.

## Structure

```
index.html            page shell + import map (→ vendor/three)
vendor/three/         Three.js 0.186 (MIT): core + only the addons used
DEPLOY.md             hosting requirements, bilingual
css/app.css           light NCB brand, mobile-first layout
js/main.js            picker, routing, scene mount: wires the request flow to the page
js/engine/flow.js     the request flow without a DOM: phases, beat bar state, end cards, what-ifs, fault lines
js/engine/store.js    single device-state store (get/set/tween/subscribe)
js/engine/player.js   runs authored steps (quiet replays, recorded choices); setup beat generator
js/engine/whatif.js   what-ifs: the picker's list, scenario defaults, the generic scenario, runWhatIf()
js/engine/chat.js     conversation UI: messages, chips, plan/ask/replan/end cards, the picker of failures
js/engine/panel.js    device dashboard tiles from the store (on phones the strip follows the request, a fault stays in view)
js/engine/icons.js    line icons for the tiles
js/engine/match.js    typed text → run / refuse / clarify (interpret)
js/engine/renderer.js Three.js setup, effects, quality tiers, picking, ping labels, daylight
js/engine/compat.js   small browser fallbacks (canvas roundRect for iOS 15)
js/engine/parts.js    procedural textures, materials and builders
js/scenes/*.js        one file per scene: devices, room geometry, prompts
test/run.mjs          headless tests (see Test)
test/build.mjs        builds and animates every room in Node; the replay against the request played in real time
test/clock.mjs        a virtual clock: real-time runs in Node without waiting
test/source.mjs       reads a scene file for the static checks (outside build())
test/loader.mjs       resolves 'three' to vendor/three for Node
test/routing.mjs      typed-request routing cases
test/fixtures/        a small scene for the engine's own checks
```

## Adding a prompt or a scene

A prompt is `{ chip, keywords, expect, steps, whatIf }`, with at least one
`{ failPoint }` in its steps (see below). Steps are plain objects
(`say`, `plan`, `tween`, `set`, `fail`, `replan`, `ask`, `end`, …) documented at
the top of `js/engine/player.js`. In `fn` steps use `ctx.tween`, `ctx.sleep`,
`ctx.status` and `ctx.say`, so skips, quiet replays and `?speed=` work. A scene
exports `{ id, title, camera, devices, deviceOrder, build(ctx), prompts }` and is
registered in `js/scenes/index.js`; `build()` returns `{ update, focus, reset? }`
(implement `reset()` if the room keeps state outside the store; `focus(id, hex)`
gets red for a fault, so pass `hex` on if you wrap it). A scene may also export
`already(r, text, state)`: the answer to a typed request that doesn't run, when
the room can answer it ("is the shutter open?"). Camera options include
`azimuth` (auto-sway arc), `fitAspect` (keep horizontal framing on narrow
screens) and `panBounds` (how far panning may take the view; by default 2.5 m
around the target). Run the test after editing, and bump `V` in
`js/scenes/index.js` when scene files change.

### What-ifs in the scene data

```js
devices: {
  pump: { name: 'Water pump', ref: 'the water pump', icon: 'pump', faultText: 'not responding', initial, format },
},
prompts: [{
  chip, keywords, expect,            // expect: the end state of the CLEAN run (under every Edit and ask answer)
  steps: [ …, { failPoint: 'watering' }, …, { end: { headline, body } } ],
  genericAt: 'watering',             // where a device the request doesn't use fails (default: the first failPoint)
  genericTitle: '📝 Noted, not urgent', // optional: that failure's alert title (default '⚠ Device down')
  whatIf: {
    pump: { at: 'pumping', intro, ask, steps: [ …, { fail: 'pump', faultText: 'stopped answering', say }, …, { end } ], alsoFaults: [] },
    powerCut: { label: 'The power goes out overnight', ask: 'What if the power goes out overnight?', at: 'night', steps: [ … ] },
  },
}],
```

- `ref`: how NCB names the device mid-sentence ("the floor lamp", "Mirror M2").
  The picker's bubble and the generic scenario use it. `plural: true` for a
  name that takes a plural verb ("the blinds"): "What if the blinds fail?",
  "I've flagged them, and I'll tell you when they're back."
- `{ failPoint: name }`: a marker at the top level of `steps`, a no-op in a
  normal run. A what-if replays the clean steps up to (not including) its `at`.
- `whatIf[deviceId]`: the scenario when that device stops working. Every device
  the request uses (writes any of its state other than status, or names it in
  the chip, plan or NCB copy) needs one; the others get the generic scenario.
- `whatIf[key]` where `key` is not a device: a special. `label` is its picker
  button, `ask` the visitor's question.
- `at`: the failPoint to stop the replay at (default: the first failPoint).
  `intro`: NCB's opening line (default "Replaying this request. This time,
  <ref> fails during the run." for a device, "Replaying this request. This time:
  <label>." for a special). `ask` on a device entry replaces the default bubble
  "What if <ref> fails?". `alsoFaults`: other devices the scenario may leave in
  fault.
- `steps`: the step DSL; no `beat` steps (the engine adds Recover before them);
  the last one is the `end` card (the clean `steps` too). The first thing a
  scenario does is update the status line (a `status` step, a `fail`, a label or
  `ctx.status`), before NCB says anything, so "Replaying this request…" goes. The
  state at the failure point may depend on the visitor's Edits and answers
  (`plan.*` flags): use `fn` steps where the copy differs. A `plan` card in a
  scenario is allowed: "Not this" on it ends the what-if there (see above).
- `genericTitle`: the alert title of the engine-made failure of an unused
  device. A title starting with 📝 (here, or in any `chat.alert`) shows as a
  calm note: neutral border and title, `role="status"`, where every other alert
  is red.
- Plan and ask cards an `fn` step opens through `ctx.chat` are recorded and
  replayed like `plan`/`ask` steps, even when the fn builds them anew each run:
  a card is matched by its object, then by its words, then in the order fn
  steps opened them.
- Write device state the same way whether or not `ctx.fast` is true, or give
  the fast path (a skip, and every replay) a fallback that lands where the
  played run does: the replay must leave the room as the visitor saw it.
- `fail.faultText`: this scenario's fault text for the device (the status
  line, the red ping and the tile show it instead of the device's default). It
  writes `<id>.faultNote` before the fault; a later bare `{ fail: id }` keeps
  it; a plain `set` of `<id>.faultNote` rewrites it; the reset after a request
  clears it. A device dropping `offline` mid-run (not a fault) gets no ping.
- The quiet flag: `build({ …, quiet })` gets `quiet()`, true while a what-if
  replays silently. Store hooks in `build()` that ring or pulse the room must
  return early while it is true:
  `const isQuiet = typeof quiet === 'function' ? quiet : () => false;`. The host
  also clears the room's markers after the replay. In a quiet replay `ctx.fast`
  is true, `ctx.chat` is a silent stand-in, and status lines and labels write
  nothing.

Every prompt needs at least one failPoint: the tests fail without one. (The page
would still run such a prompt clean, with no what-if button, rather than break.)

## Copy guardrails

No protocol names, no success percentages, no guarantees, Home Assistant only as
a bridge in progress, lab and warehouse labelled illustrative. The test checks
the obvious ones, on static copy and on everything said at run time; the rest is
on the author.
