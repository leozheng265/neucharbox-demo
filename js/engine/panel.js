// Device dashboard: one tile per device (icon + name + state), rendered from the store.
// Tone: offline (grey, dimmed) · idle (grey icon) · on (amber) · busy (blue) · bad (red).
// On phones it is a horizontal strip, on desktop a two-column grid; either way only the panel scrolls, never the page.
import { icon } from './icons.js';

const looksActive = (s) => !!(s.on || s.running || s.armed || s.active || s.pressed || s.moving || s.state === 'moving' || (s.open > 0.5) || (s.brightness > 0.02) || s.shutter === 'open' || s.light === 'green' || s.scene === 'live' || s.scene === 'recording' || (s.muted === false));
const now = () => performance.now();
const shape = (v) => v.replace(/[+\-−]?\d[\d.,:]*/g, '#'); // a value's kind, numbers aside: "14 scanned" ~ "15 scanned"
const qs = typeof location !== 'undefined' ? Number(new URLSearchParams(location.search).get('speed')) : NaN;
const DWELL = Math.max(450, 900 / (Number.isFinite(qs) && qs > 0 ? Math.min(qs, 6) : 1)); // the strip holds still this long before its next jump (?speed= as in the player)
const PAD = 12; // margin kept around a tile brought into view: the panel's own padding

export function createPanel(root, scene, store, { onSelect } = {}) {
  const ids = scene.deviceOrder || Object.keys(scene.devices).filter((d) => d !== 'hub' && d !== 'env');
  root.innerHTML = '';
  const cards = {};
  for (const id of ids) {
    const d = scene.devices[id];
    const card = document.createElement('button');
    card.className = 'ent offline'; card.dataset.id = id; card.type = 'button';
    card.innerHTML = `<span class="ico">${icon(d.icon)}</span><span class="txt"><b>${d.name}</b><span class="val"></span></span>`;
    card.onclick = () => { select(id); onSelect && onSelect(id); };
    root.appendChild(card); cards[id] = card;
  }

  // The visitor's hand wins: while they touch, and for 3 s after they last drag, wheel or key through the dashboard,
  // nothing scrolls it for them (a tile they tap is still brought fully into view).
  let handAt = -Infinity, handDown = false, lastMove = -Infinity, focus = []; // focus: the tiles last brought into view
  root.addEventListener('scroll', () => { lastMove = now(); }, { passive: true }); // a smooth scroll moves for a while: the dwell counts from its end
  const hand = () => { handAt = now(); focus = []; };
  for (const ev of ['pointerdown', 'touchstart']) root.addEventListener(ev, () => { handDown = true; hand(); }, { passive: true });
  for (const ev of ['pointerup', 'pointercancel', 'touchend', 'touchcancel']) root.addEventListener(ev, () => { handDown = false; hand(); }, { passive: true });
  for (const ev of ['touchmove', 'wheel', 'keydown']) root.addEventListener(ev, hand, { passive: true });
  const handBusy = () => handDown || now() - handAt < 3000;

  // A tile's box in the panel's scroll coordinates, from its layout size around its on-screen centre: a tile mid-pop
  // is scaled (.85 to 1.06), and aligning to that box once left the last tile cut at the screen edge.
  function box(c) {
    const r = c.getBoundingClientRect(), p = root.getBoundingClientRect();
    const cx = (r.left + r.right) / 2 - p.left - root.clientLeft + root.scrollLeft, cy = (r.top + r.bottom) / 2 - p.top - root.clientTop + root.scrollTop;
    return { l: cx - c.offsetWidth / 2, r: cx + c.offsetWidth / 2, t: cy - c.offsetHeight / 2, b: cy + c.offsetHeight / 2 };
  }
  const shown = (id) => { const c = cards[id]; if (!c || c.offsetParent === null) return true; const b = box(c); return b.l >= root.scrollLeft - 1 && b.r <= root.scrollLeft + root.clientWidth + 1 && b.t >= root.scrollTop - 1 && b.b <= root.scrollTop + root.clientHeight + 1; };
  // Scroll the panel so these tiles show, nearest edge, as many as fit together in order. Returns the ids it covered
  // ([] while the visitor's hand is on the panel).
  function reveal(list, { force = false, smooth = true } = {}) {
    if (!force && handBusy()) return [];
    const items = list.filter((id) => cards[id] && cards[id].offsetParent !== null).map((id) => ({ id, b: box(cards[id]) }));
    if (!items.length) return [];
    const w = root.clientWidth, h = root.clientHeight; let u = items[0].b; const got = [items[0].id];
    for (const { id, b } of items.slice(1)) {
      const n = { l: Math.min(u.l, b.l), r: Math.max(u.r, b.r), t: Math.min(u.t, b.t), b: Math.max(u.b, b.b) };
      if (n.r - n.l > w - 2 * PAD || n.b - n.t > h - 2 * PAD) break;
      u = n; got.push(id);
    }
    const x = root.scrollLeft, y = root.scrollTop;
    const nx = u.l - PAD < x ? u.l - PAD : u.r + PAD > x + w ? u.r + PAD - w : x;
    const ny = u.t - PAD < y ? u.t - PAD : u.b + PAD > y + h ? u.b + PAD - h : y;
    const tx = Math.max(0, Math.min(root.scrollWidth - w, Math.round(nx))), ty = Math.max(0, Math.min(root.scrollHeight - h, Math.round(ny)));
    if (Math.abs(tx - x) > 1 || Math.abs(ty - y) > 1) { root.scrollTo({ left: tx, top: ty, behavior: smooth ? 'smooth' : 'auto' }); lastMove = now(); }
    focus = got;
    return got;
  }
  // Back to the first tile (when the chips are offered); drops any reveal still waiting.
  function rewind() { queue = []; clearTimeout(timer); timer = 0; clearTimeout(popTimer); popTimer = 0; focus = []; if (!handBusy() && (root.scrollLeft > 0 || root.scrollTop > 0)) root.scrollTo({ left: 0, top: 0, behavior: 'smooth' }); }

  // Following a request (the host turns this on at its start and again at each beat, and off at its end): a tile is
  // brought into view the first time it changes in the request, and after that when its state changes kind (a new
  // tone, or a new kind of value: "15 scanned" to "15 scanned · 1 unreadable", not 14 to 15 scanned) to one it hasn't
  // shown in this beat. So a tween or a counter moves the strip once, not every frame, and a device toggling between
  // two states moves it at most twice a beat. The strip holds still for DWELL before each jump (a change that happens
  // in view holds it too), then shows the oldest waiting tiles (of tiles that changed together, the nearest first), as
  // many as fit together; what is still waiting when the request ends is shown after it. The tile in view is kept
  // fully in view while its value grows.
  let changed = null, beatKeys = null, queue = [], timer = 0, batch = 0;
  function track(on) {
    if (!on) { changed = beatKeys = null; return; }
    if (!changed) { changed = new Set(); queue = []; clearTimeout(timer); timer = 0; }
    beatKeys = new Map(ids.map((id) => [id, new Set()]));
  }
  function note(id, key, prev) {
    const first = !changed.has(id); changed.add(id);
    const ks = beatKeys.get(id); const fresh = key !== prev && !ks.has(key); if (key !== prev) ks.add(key);
    if (!first && !fresh) { if (focus.includes(id) && !queue.length && !shown(id)) reveal([id]); return; }
    const q = queue.find((e) => e.id === id); if (q) { if (fresh) q.keys.push(key); q.first ||= first; } else queue.push({ id, keys: fresh ? [key] : [], first, batch });
    if (!timer) timer = setTimeout(flush, 0);
  }
  function flush() {
    timer = 0; batch++; if (!queue.length) return;
    if (handBusy()) { if (changed) for (const e of queue) { for (const k of e.keys) beatKeys.get(e.id).delete(k); if (e.first) changed.delete(e.id); } queue = []; return; } // a later change brings them up
    const quiet = now() - lastMove; if (quiet < DWELL) { timer = setTimeout(flush, DWELL - quiet + 20); return; }
    const vis = queue.filter((e) => shown(e.id)).map((e) => e.id);
    if (vis.length) { queue = queue.filter((e) => !vis.includes(e.id)); focus = vis; lastMove = now(); }
    else {
      const x = root.scrollLeft, y = root.scrollTop, w = root.clientWidth, h = root.clientHeight;
      const away = (e) => { const b = box(cards[e.id]); return Math.max(0, x - b.l, b.r - x - w) + Math.max(0, y - b.t, b.b - y - h); };
      const head = queue.filter((e) => e.batch === queue[0].batch).map((e) => [away(e), e]).sort((a, b) => a[0] - b[0]).map(([, e]) => e.id);
      const got = reveal(head); queue = queue.filter((e) => !got.includes(e.id));
    }
    if (queue.length) timer = setTimeout(flush, DWELL);
  }

  function render(state) {
    for (const id of ids) {
      const s = state[id], d = scene.devices[id], c = cards[id];
      const tone = s.status === 'offline' ? 'offline' : s.status === 'fault' ? 'bad' : s.status === 'busy' ? 'busy' : (d.active ? d.active(s, state) : looksActive(s)) ? 'on' : 'idle';
      // A fault shows the scenario's note for it (fail.faultText → <id>.faultNote, rewritten later if the scene says so;
      // every store write re-renders), else the device's default fault text.
      const v = s.status === 'offline' ? 'not connected' : s.status === 'fault' ? (s.faultNote || d.faultText || 'unavailable') : d.format(s, state);
      if (c._tone === tone && c._v === v) continue;
      if (c._tone !== tone) { c._tone = tone; for (const t of ['offline', 'bad', 'busy', 'on', 'idle']) c.classList.toggle(t, t === tone); }
      if (c._v !== v) { c._v = v; c.querySelector('.val').textContent = v; c.title = `${d.name}: ${v}`; } // title: the full value if the tile cuts it
      const prev = c._key; c._key = `${tone}|${shape(v)}`;
      if (changed) note(id, c._key, prev);
    }
  }
  function select(id) {
    for (const c of Object.values(cards)) c.classList.toggle('selected', c.dataset.id === id);
    if (id && cards[id]) { reveal([id], { force: true }); clearTimeout(select.t); select.t = setTimeout(() => cards[id]?.classList.remove('selected'), 2500); }
  }
  // Discovery and faults: the tile pops and comes into view at once (no dwell), or, while the visitor's hand is on
  // the panel, once it has been off it for 3 s (the latest pop only). Reveals still waiting from before are dropped, so
  // they don't scroll the strip away from a faulted tile while NCB asks what to do about it.
  let popTimer = 0;
  function pop(id) {
    const c = cards[id]; if (!c) return; c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop');
    queue = []; clearTimeout(timer); timer = 0; clearTimeout(popTimer);
    const show = () => { popTimer = 0; if (handBusy()) popTimer = setTimeout(show, Math.max(100, handAt + 3050 - now())); else reveal([id]); };
    show();
  }
  store.subscribe(render); render(store.state);
  return { select, render, pop, reveal, rewind, track };
}
