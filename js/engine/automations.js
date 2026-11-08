// The Automations section (live mode, below the device cards; spec docs/superpowers/specs/2026-11-08-automations-design.md
// §1): one card per rule or schedule the AI set up in this session's room, in creation order, each with an on/off switch.
// It shows what render() is given and reports a flipped switch to onToggle(id, on): js/engine/live.js keeps the visitor's
// value until the server agrees, and puts it back when the server refuses it.
//   createAutomations(root, { onToggle, emptyText, collapsed, doc })
//     render(items | null)     items: [{ id, kind: 'rule'|'schedule', text, enabled, firedToday }]; null: not in live mode
//                              (guided, or live mode over), the section hides
//     flash(id, 'ran'|'held')  the card's JUST RAN / HELD badge for 2 s (folded, the summary line's too)
//     open(on)                 unfold or fold the list. collapsed: start folded, as one summary line ("Automations · 2 on");
//                              phones do (css/app.css then drops the list over the chat instead of pushing the chat down)
// Built with createElement and textContent only (the server's text is never parsed as HTML), so the Node tests run it on a
// small stand-in document (test/automations.mjs).
import { LIVE_COPY as C } from './live.js';

const ICON = { rule: '⚡', schedule: '🕓' };
const FLASH_MS = 2000; // as a device card's JUST SET
let sections = 0;

// The card's small line: its kind, then "Off", or how often it ran today.
export const subLine = (a) => `${a.kind === 'schedule' ? C.autoSchedule : C.autoRule}${a.enabled === false ? ` · ${C.autoOff}` : a.firedToday > 0 ? ` · ${C.autoRan(a.firedToday)}` : ''}`;
// The summary beside the heading: "2 on", "all off", "none yet".
export const summaryOf = (items) => { const on = items.filter((a) => a.enabled !== false).length; return items.length ? (on ? C.autosOn(on) : C.autosAllOff) : C.autosNone; };
// The pages' `collapsed`: folded on phones (where the list drops over the chat) and on short desktop windows (where it
// would push the chat up); elsewhere open, under the device cards. Same breakpoint as css/app.css's phone layout.
export const startFolded = (mm = globalThis.matchMedia?.bind(globalThis)) => typeof mm === 'function' && !!mm('(max-width: 959px), (max-height: 760px)').matches;

export function createAutomations(root, { onToggle = () => {}, emptyText = C.autosEmptyAny, collapsed = false, doc = globalThis.document } = {}) {
  const k = ++sections;
  let nSub = 0, open = !collapsed, headTimer = 0;
  const mk = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  root.replaceChildren();
  root.classList.add('autos'); root.setAttribute('role', 'region'); root.setAttribute('aria-label', C.autosTitle); root.hidden = true;
  const head = mk('button', 'autos-head'); head.type = 'button';
  const count = mk('span', 'autos-count'), badge = mk('span', 'autos-badge'), chev = mk('span', 'autos-chev', '▾');
  chev.setAttribute('aria-hidden', 'true');
  head.append(mk('span', 'autos-title', C.autosTitle), count, badge, chev);
  const body = mk('div', 'autos-body'); body.id = `autos-${k}`; head.setAttribute('aria-controls', body.id);
  const list = mk('ul', 'alist'), empty = mk('p', 'aempty', emptyText);
  body.append(list, empty); root.append(head, body);

  function setOpen(on) { open = !!on; body.hidden = !open; head.setAttribute('aria-expanded', String(open)); root.classList.toggle('open', open); }
  head.onclick = () => setOpen(!open);
  // Folded by default (a phone), the list lies over the chat: Escape folds it again and gives focus back to the heading.
  root.onkeydown = (e) => { if (e.key === 'Escape' && collapsed && open) { setOpen(false); head.focus(); } };
  setOpen(open);

  const cards = new Map(); // id → { li, ico, text, sub, sw, badge, timer }
  function cardFor(a) {
    let c = cards.get(a.id);
    if (!c) {
      const li = mk('li', 'auto'); li.dataset.id = a.id;
      const ico = mk('span', 'aico'); ico.setAttribute('aria-hidden', 'true');
      const txt = mk('span', 'atxt'), text = mk('span', 'atext'), sub = mk('span', 'asub'); sub.id = `autos-${k}-${++nSub}`;
      // A real switch: a button with role="switch" and aria-checked (Enter and Space press it), named by the automation's text.
      const sw = mk('button', 'sw auto-sw'); sw.type = 'button'; sw.setAttribute('role', 'switch'); sw.setAttribute('aria-describedby', sub.id);
      const id = a.id; sw.onclick = () => onToggle(id, sw.getAttribute('aria-checked') !== 'true');
      const b = mk('span', 'badge');
      txt.append(text, sub); li.append(ico, txt, sw, b);
      c = { li, ico, text, sub, sw, badge: b, timer: 0 }; cards.set(id, c);
    }
    const on = a.enabled !== false;
    c.li.dataset.kind = a.kind; c.li.classList.toggle('off', !on);
    c.ico.textContent = ICON[a.kind] || ICON.rule;
    c.text.textContent = a.text; c.sub.textContent = subLine(a);
    c.sw.setAttribute('aria-label', a.text); c.sw.setAttribute('aria-checked', String(on)); c.sw.classList.toggle('on', on);
    return c;
  }
  const unflashHead = () => { clearTimeout(headTimer); headTimer = 0; badge.textContent = ''; head.classList.remove('flash-ran', 'flash-held'); };

  function render(items) {
    if (items == null) { // live mode is over: the section goes, and opens as it started next time
      for (const c of cards.values()) clearTimeout(c.timer);
      cards.clear(); list.replaceChildren(); unflashHead(); setOpen(!collapsed); root.hidden = true;
      return;
    }
    const keep = new Set(items.map((a) => a.id));
    for (const [id, c] of cards) {
      if (keep.has(id)) continue;
      if (c.li.contains(doc.activeElement)) head.focus(); // a re-plan dropped the card under the visitor's focus
      clearTimeout(c.timer); c.li.remove(); cards.delete(id);
    }
    // In place: a card that stays keeps its node (and the focus on its switch); only an order change moves one.
    items.forEach((a, i) => { const c = cardFor(a); if (list.children[i] !== c.li) list.insertBefore(c.li, list.children[i] ?? null); });
    list.hidden = !items.length; empty.hidden = items.length > 0;
    count.textContent = ` · ${summaryOf(items)}`;
    root.hidden = false;
  }

  function flash(id, kind) {
    const c = cards.get(id); if (!c) return;
    const word = kind === 'held' ? C.autoHeldBadge : C.autoJustRan;
    clearTimeout(c.timer);
    c.li.classList.toggle('flash-ran', kind !== 'held'); c.li.classList.toggle('flash-held', kind === 'held'); c.badge.textContent = word;
    c.timer = setTimeout(() => { c.timer = 0; c.li.classList.remove('flash-ran', 'flash-held'); c.badge.textContent = ''; }, FLASH_MS);
    unflashHead(); // the summary line carries it too (css/app.css shows it only while the list is folded)
    badge.textContent = word; head.classList.add(kind === 'held' ? 'flash-held' : 'flash-ran');
    headTimer = setTimeout(unflashHead, FLASH_MS);
  }

  return { render, flash, open: setOpen, get isOpen() { return open; } };
}
