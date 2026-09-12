# NeuCharBox live simulation demo — design

Date: 2026-09-10. Status: approved by Leo (build without further approval).

## Purpose

An interactive, browser-based simulation that lets Kickstarter visitors go
through the NeuCharBox workflow themselves: plug in the hub, discover devices,
tell it what they want (or give it exact instructions), approve a plan, watch it
run in a 3D room and in a control panel at the same time, and see how it
handles a failure. Audience: Kickstarter visitors during the live campaign
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
   (Setup · Ask · Plan · Run · Recover) lets the visitor skip ahead.
5. **Failure & recovery.** One device fails. NCB re-plans, keeps the rest
   running, says exactly what needs a human. Lab scene halts and asks instead.
6. **End card.** "Try another scene" + "Back on Kickstarter".

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
- `chat.js` — NCB messages, user messages, chips, plan card, failure card,
  end card, text input.
- `player.js` — runs a scene's step list: `say`, `user`, `plan` (waits for
  approve), `set`/`tween` with duration and label, `delay`, `fail`, `replan`,
  `end`. Supports skip-to-next-beat. Headless mode for tests.
- `match.js` — keyword-overlap matcher from typed text to a chip; fallback chip.
- `scenes/<name>.js` — exports `{ id, title, promise, devices, build(ctx),
  update(state, t), prompts: [{ chip, keywords, steps }] }`.

## Scenes

| Scene | Devices | Proves | Failure beat |
|---|---|---|---|
| Home, away a week | lamp, blinds, soil sensor, pump, door camera, thermostat | Say what you want, never name a device | Pump drops out; re-plans, pauses watering, flags the hose |
| Laser lab (illustrative) | laser + shutter, mirror mounts M1/M2 (tip/tilt), translation stage, power meter, beam camera | Exact instructions, executed and verified step by step | Stage reaches its soft limit; NCB halts and asks, never guesses |
| Elder care | hallway motion, bedroom door contact, kettle plug, bed pressure mat, night light | Sensing without cameras — "Mum's up · 7:12" | No motion by 09:30; escalates by message, not alarm |
| Warehouse | conveyors C1–C3, scanner arch, sorter gate, AGV carts A/B, dock light | Coordination and re-routing when a unit drops out | C2 faults; reroutes via carts, keeps the line moving |
| Creator desk | key light, main camera, mic, capture card, overlay display, on-air sign | One command, whole setup | Main camera won't initialise; goes live on the backup, says so |

## Copy guardrails (from campaign materials)

No protocol names (Zigbee/Matter/etc.), no success percentages, no "100%"
claims. Home Assistant only as "bridge in progress" if mentioned at all. Lab and
warehouse scenes labelled "illustrative scenario". Hub depicted as a rounded
slab with four USB ports. Light brand: white/aqua canvas, cyan→green LED.

## Performance, deployment, testing

- Page < ~2 MB; textures generated at runtime.
- Static folder `demo/`; `python -m http.server` for local preview.
- `test/run.mjs`: headless play of every prompt in every scene; asserts the
  store reaches each prompt's expected final state.
- Manual pass on a phone and a laptop before each scene is linked.
- Delivery order: Home (with engine) → Lab → Elder care → Warehouse → Creator.
