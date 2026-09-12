# NeuCharBox live demo

Interactive, scripted simulation of NeuCharBox for Kickstarter visitors: five
3D scenes (home, laser lab, elder care, warehouse, creator desk), each walking
through plug in → discover devices → ask → plan → approve → run → failure and
recovery. Everything runs in the browser; no backend, no keys, no analytics.

Design spec: `docs/design.md`.

## Run locally

```bash
python serve.py
```

Open http://localhost:8765/ (a picker) or http://localhost:8765/#home to jump to
a scene. Add `?speed=4` to run the scripts four times faster while reviewing.
The server sends no-cache headers, so a plain refresh picks up code changes.
(With a generic static server you'd need Ctrl+F5 — browsers cache the modules.)

Camera: drag to orbit, scroll to zoom, right-drag (or arrow keys) to pan, and
the ⟲ button resets the view. Walls are single-sided, so any angle looks in.

## Test

```bash
node test/run.mjs
```

Plays every prompt of every scene headlessly through the real step player and
asserts the expected end state, that every beat is reached, that every device a
script touches exists, and that campaign copy guardrails hold.

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
js/main.js            picker, routing, scene mount, beat bar
js/engine/store.js    single device-state store (get/set/tween/subscribe)
js/engine/player.js   runs authored steps; setup beat generator
js/engine/chat.js     conversation UI: messages, chips, plan/ask/replan/end cards
js/engine/panel.js    device dashboard tiles from the store
js/engine/icons.js    line icons for the tiles
js/engine/match.js    free text → nearest authored prompt
js/engine/renderer.js Three.js setup, effects, quality tiers, picking, daylight
js/engine/parts.js    procedural textures, materials and builders
js/scenes/*.js        one file per scene: devices, room geometry, prompts
test/run.mjs          headless script test
```

## Adding a prompt or a scene

A prompt is `{ chip, keywords, expect, steps }`. Steps are plain objects
(`say`, `plan`, `tween`, `set`, `fail`, `replan`, `ask`, `end`, …) documented at
the top of `js/engine/player.js`. A scene exports `{ id, title, camera, devices,
deviceOrder, build(ctx), prompts }` and is registered in `js/scenes/index.js`.
Run the test after editing.

## Copy guardrails

No protocol names, no success percentages, Home Assistant only as a bridge in
progress, lab and warehouse labelled illustrative. The test checks the obvious
ones; the rest is on the author.
