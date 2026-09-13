# NeuCharBox live simulation demo — design

Date: 2026-09-10. Status: approved by Leo (build without further approval).
Updated 2026-09-13: failures are opt-in. Every request runs clean by default; the
visitor picks what fails from its end card (see "Visitor flow" and "What-ifs").

## Purpose

An interactive, browser-based simulation that lets Kickstarter visitors go
through the NeuCharBox workflow themselves: plug in the hub, discover devices,
tell it what they want (or give it exact instructions), approve a plan, watch it
run in a 3D room and in a control panel at the same time, and then, if they
choose, make any connected device fail and see how it handles that. Audience:
Kickstarter visitors during the live campaign
(ends ≈ 2026-10-01). Mobile-first, works cold from a link, ~3 minutes per scene,
ends on a "Back on Kickstarter" CTA.

## Decisions taken

| Question | Decision |
|---|---|
| AI behind it | Scripted simulation. Every prompt is pre-authored; typed text fuzzy-matches to the nearest authored prompt. No LLM calls, no backend. |
| Scenes | Five: Home (away a week), Laser lab (illustrative), Elder care, Warehouse, Creator desk. Each proves one distinct capability. |
| Layout | Room on top, entity panel strip, NCB conversation below. Desktop: conversation to the right of the room. |
| Visual style | "Option C": procedural Three.js, towards photoreal — real window openings with sun, ambient occlusion, bloom, bump-mapped materials, rounded furniture. No downloaded models unless a scene truly needs one. |
| Interaction | Guided prompt chips + free text box (matched to chips). Plan card with Approve / Edit. Tap a device in the room to highlight its panel card. |
| Stack | One static page, plain ES modules, Three.js 0.186 from jsdelivr via import map, no build step. |
| Hosting | Static host (Vercel/Netlify/GitHub Pages) immediately; move behind demo.neucharbox.com when DNS is available. |

## Visitor flow (every scene)

1. **Setup (~20 s).** Hub on a surface, LED breathing. "Plug in" → LED steady.
   "Scan QR" → devices discovered one by one; each pulses in the room as its
   card appears in the panel.
2. **Ask.** 3–4 prompt chips + text box. Lab/warehouse chips are precise
   instructions; home/elder/creator chips are intents.
3. **Plan.** NCB lists what it found and a numbered plan. "Nothing runs until
   you approve." Approve, or Edit to swap one authored alternative step.
4. **Run.** Steps execute visibly in the room and the panel together. A beat bar
   (Setup · Ask · Plan · Run · Done) lets the visitor skip ahead.
5. **Done.** The request finishes as asked: nothing fails unless the visitor
   asks for it. A success end card: "What if something fails?", "Another
   request here", "Try another scene", "Back on Kickstarter".
6. **What if something fails? (opt-in).** A picker lists every connected device
   (icon and name; one the request doesn't use says "not in this request"), then,
   under "Or", the request's other what-ifs (a soft limit, a disturbance on the
   beam, mum not up by 09:30, an unreadable label, a power cut). The pick replays
   the same request quietly, with the visitor's own plan edits and answers, up to
   the moment that thing matters; then it fails in the room, NCB says what it
   sees and does, puts things in a safe state or works around it, shows a
   re-plan card with what needs a human, and ends on the scenario's own end card
   ("Try another failure", "Another request here", …). A Recover beat shows in
   the beat bar only during a what-if.

## What-ifs

- Every request has at least one failure point (`{ failPoint }` in its steps,
  a no-op in the clean run). A device the request uses has its own authored
  story; a device it doesn't use gets the engine's story: it fails, NCB flags
  it, says the plan doesn't need it, skips ahead to the end of the request, and
  closes on "It knew what mattered.".
- Safe direction first in every story: the lab closes the shutter and stops
  motion when safety is in doubt, the warehouse stops and holds and never
  guesses a sort, elder care tells the family and never alarms mum (no
  cameras), the home never forces a motor or retries a dead pump, the creator
  desk never lets the audience see or hear a broken feed.
- Honest: NCB separates "commanded" from "confirmed", trusts a measurement over
  a device's own claim, and never says a dead device did something.
- A typed "what if the hall light stops working?" is not run as a request: NCB
  says how to pick a failure, with the closest request first.

## Engine

- `store.js` — one plain state object per scene; `get/set/tween/subscribe`.
  Only the step player writes; room, panel, chat read.
- `renderer.js` — Three.js setup, sun/lamp, PCF soft shadows, GTAO, bloom,
  ACES tone mapping, OrbitControls, quality tiers (phone / <40 fps → AO off,
  shadow map halved), raycast device picking.
- `parts.js` — procedural textures (wood, plaster, fabric, rug, hole-grid
  plate, concrete) and builders (room shell with openings, hub, plant, lamp,
  sofa, tables, optical parts, conveyor, shelving, AGV, desk kit).
- `panel.js` — one card per device from the store; unavailable = red; sync
  highlight with room picking.
- `chat.js` — NCB messages, user messages, chips, plan/ask/re-plan cards, end
  card, the picker of failures, text input.
- `player.js` — runs a scene's step list: `say`, `user`, `plan` (waits for
  approve), `ask`, `set`/`tween` with duration and label, `wait`, `fail`,
  `replan`, `failPoint`, `end`. Supports skip-to-beat, quiet replays with the
  visitor's recorded answers, and a headless mode for tests.
- `whatif.js` — the picker's list, each pick's scenario (authored, or the
  engine's for an unused device), and the what-if run itself.
- `flow.js` — the request flow without a DOM: phases, beat bar, end cards,
  what-ifs, fault lines; `main.js` wires it to the page.
- `match.js` — typed text to run / refuse / clarify; it never guesses.
- `scenes/<name>.js` — exports `{ id, title, devices, deviceOrder, build(ctx),
  prompts: [{ chip, keywords, expect, steps, whatIf }] }`.

## Scenes

Every request runs clean by default. The last column is what the visitor can
pick from its end card.

| Scene | Devices | Proves | What-ifs, on request |
|---|---|---|---|
| Home, away a week | floor lamp, blinds, soil sensor, water pump, door camera, thermostat | Say what you want, never name a device | Any of the six devices fails (the pump stops mid-watering: watering paused, the soil keeps watch); plus a power cut overnight (the away plan) and heating that can't keep up (hold 19 °C) |
| Laser lab (illustrative) | laser + shutter, beam camera, mirror mounts M1/M2 (tip/tilt), stage X, power meter | Exact instructions, executed and verified step by step | Any device fails (when safety is in doubt, the shutter closes and motion stops first); plus a soft limit short of the target (NCB halts and asks, never guesses), something crossing the beam mid-walk, and "what if you wanted more power" |
| Elder care | bed sensor, bedroom door, hallway motion, kettle plug, night light, hall light | Sensing without cameras — "Mum's up · 7:12" | Any sensor or light fails (the family is told, mum is never alarmed); plus mum not up by 09:30 (one message, not an alarm) |
| Warehouse (illustrative) | conveyors C1–C3, scanner arch, sorter gate, carts A/B, dock 2 | Coordination and re-routing when a unit drops out | Any unit fails (it stops and holds safely; C2 tripping mid-run is re-routed around, every parcel still scanned); plus a label that can't be read |
| Creator desk | key light, main camera, mic, capture card, overlay app, on-air sign, LED strip | One command, whole setup | Any device fails (the audience never sees or hears a broken feed; a main camera with no picture goes live on the backup, and says so) |

## Copy guardrails (from campaign materials)

No protocol names (Zigbee/Matter/etc.), no success percentages, no "100%"
claims. Home Assistant only as "bridge in progress" if mentioned at all. Lab and
warehouse scenes labelled "illustrative scenario". Hub depicted as a rounded
slab with four USB ports. Light brand: white/aqua canvas, cyan→green LED.

## Performance, deployment, testing

- Page < ~2 MB; textures generated at runtime.
- Static folder `demo/`; `python -m http.server` for local preview.
- `test/run.mjs`: headless play of every prompt in every scene: each runs
  clean to its expected final state, and every what-if of every request runs to
  one end card with its device in fault (see the README's Test section).
- Manual pass on a phone and a laptop before each scene is linked.
- Delivery order: Home (with engine) → Lab → Elder care → Warehouse → Creator.
