// Check 18b: the Automations section (js/engine/automations.js) on a small stand-in document, and the page wiring around
// it and the header's Live AI button (static checks of main.js, the custom page and the CSS: no browser here).
//   automationChecks({ report }) runs them (test/run.mjs, in the `live` group).
import { readFileSync } from 'node:fs';
import { virtualTime } from './clock.mjs';
import { createAutomations, subLine, summaryOf, startFolded } from '../js/engine/automations.js';
import { LIVE_COPY as C, automationsOf } from '../js/engine/live.js';
import { RULE1, SCHED1 } from './fixtures/live-mock.mjs';

// Just what the section uses: createElement, children, attributes, classList, textContent, hidden, focus. innerHTML
// throws: the server's text must never be parsed as HTML. A removed element loses focus, as in a browser.
export function fakeDoc() {
  const doc = { activeElement: null };
  class El {
    constructor(tag) {
      Object.assign(this, { tagName: tag.toUpperCase(), children: [], parentNode: null, attrs: new Map(), dataset: {}, _text: '', hidden: false, id: '', type: '', onclick: null, onkeydown: null, _cls: new Set() });
      const cls = this._cls;
      this.classList = {
        add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)), contains: (c) => cls.has(c),
        toggle: (c, on) => { const v = on === undefined ? !cls.has(c) : !!on; if (v) cls.add(c); else cls.delete(c); return v; },
      };
    }
    get className() { return [...this._cls].join(' '); }
    set className(v) { this._cls.clear(); for (const c of String(v).split(/\s+/).filter(Boolean)) this._cls.add(c); }
    get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join('') : this._text; }
    set textContent(v) { for (const c of [...this.children]) this._drop(c); this._text = String(v); }
    get innerHTML() { throw new Error('innerHTML read'); }
    set innerHTML(v) { throw new Error('innerHTML written'); }
    setAttribute(k, v) { this.attrs.set(k, String(v)); }
    getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
    hasAttribute(k) { return this.attrs.has(k); }
    removeAttribute(k) { this.attrs.delete(k); }
    append(...ns) { for (const n of ns) this.insertBefore(n, null); }
    appendChild(n) { return this.insertBefore(n, null); }
    insertBefore(n, ref) {
      if (n.parentNode) n.parentNode._drop(n);
      const i = ref ? this.children.indexOf(ref) : -1;
      if (i >= 0) this.children.splice(i, 0, n); else this.children.push(n);
      n.parentNode = this; this._text = ''; return n;
    }
    _drop(n) { const i = this.children.indexOf(n); if (i >= 0) this.children.splice(i, 1); n.parentNode = null; if (n.contains(doc.activeElement)) doc.activeElement = null; }
    remove() { this.parentNode?._drop(this); }
    replaceChildren(...ns) { for (const c of [...this.children]) this._drop(c); this.append(...ns); }
    contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
    focus() { doc.activeElement = this; }
    click() { this.onclick?.({ currentTarget: this, detail: 1 }); }
    // every descendant with this class, in order
    all(cls) { const out = []; const walk = (e) => { for (const c of e.children) { if (c._cls.has(cls)) out.push(c); walk(c); } }; walk(this); return out; }
    one(cls) { return this.all(cls)[0] ?? null; }
  }
  doc.createElement = (t) => new El(t);
  return doc;
}

export async function automationChecks({ report }) {
  let cur = [];
  const eq = (got, want, what = '') => { if (JSON.stringify(got) !== JSON.stringify(want)) cur.push(`${what ? `${what}: ` : ''}got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); };
  const ok = (cond, what = 'check failed') => { if (!cond) cur.push(what); };
  async function check(tag, fn) {
    const problems = cur = [];
    try { await virtualTime(fn); } catch (e) { problems.push(`threw: ${String(e.stack || e.message || e).split('\n').slice(0, 2).join(' | ')}`); }
    report(tag, problems);
  }
  const R1 = automationsOf([RULE1])[0], S1 = automationsOf([SCHED1])[0];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const make = (opts = {}) => {
    const doc = fakeDoc(), root = doc.createElement('div'), toggles = [];
    root.hidden = true;
    const a = createAutomations(root, { onToggle: (id, on) => toggles.push([id, on]), doc, ...opts });
    const head = root.one('autos-head'), body = root.one('autos-body');
    const card = (id) => root.all('auto').find((li) => li.dataset.id === id);
    const sw = (id) => card(id)?.one('auto-sw');
    return { doc, root, a, toggles, head, body, card, sw, list: root.one('alist'), empty: root.one('aempty'), count: root.one('autos-count'), badge: root.one('autos-badge') };
  };

  await check('automations ui · hidden until live mode; an empty section says how to get one; hidden again after', () => {
    const t = make({ emptyText: C.autosEmpty });
    eq(t.root.hidden, true, 'hidden at first (guided mode)');
    eq([t.root.getAttribute('role'), t.root.getAttribute('aria-label')], ['region', 'Automations'], 'a labelled region');
    t.a.render([]);
    eq([t.root.hidden, t.list.hidden, t.empty.hidden, t.empty.textContent], [false, true, false, C.autosEmpty], 'shown: the empty line, no list');
    eq(t.head.textContent, `${C.autosTitle} · ${C.autosNone}▾`, 'the summary line');
    t.a.render(null); eq(t.root.hidden, true, 'render(null): hidden');
  });

  await check('automations ui · one card per automation, in order: icon, text, sub-line, a labelled switch', () => {
    const t = make();
    t.a.render([R1, { ...S1, firedToday: 2 }]);
    eq(t.root.all('auto').map((li) => li.dataset.id), ['rule1', 'sched1'], 'creation order');
    eq(t.root.all('aico').map((i) => [i.textContent, i.getAttribute('aria-hidden')]), [['⚡', 'true'], ['🕓', 'true']], 'kind icons, hidden from screen readers');
    eq(t.card('rule1').one('atext').textContent, RULE1.text); eq(t.card('rule1').one('asub').textContent, C.autoRule, 'a rule that never ran');
    eq(t.card('sched1').one('asub').textContent, `${C.autoSchedule} · ${C.autoRan(2)}`, 'ran 2× today');
    const s = t.sw('rule1');
    eq([s.tagName, s.type, s.getAttribute('role'), s.getAttribute('aria-checked'), s.getAttribute('aria-label')], ['BUTTON', 'button', 'switch', 'true', RULE1.text], 'a real button with switch semantics, named by its text');
    eq(s.getAttribute('aria-describedby'), t.card('rule1').one('asub').id, 'described by its sub-line'); ok(!!t.card('rule1').one('asub').id, 'the sub-line has an id');
    eq(t.count.textContent, ` · ${C.autosOn(2)}`, '2 on');
    eq([t.list.hidden, t.empty.hidden], [false, true]);
  });

  await check('automations ui · a switch reports the flip; off shows as off (sub-line, summary, class); the same nodes stay', () => {
    const t = make(); t.a.render([R1, S1]);
    const li = t.card('rule1'), s = t.sw('rule1'); s.focus();
    s.click(); eq(t.toggles, [['rule1', false]], 'on → asks for off');
    t.a.render([{ ...R1, enabled: false }, S1]);
    eq([s.getAttribute('aria-checked'), s.classList.contains('on'), li.classList.contains('off'), li.one('asub').textContent], ['false', false, true, `${C.autoRule} · ${C.autoOff}`], 'off');
    eq(t.count.textContent, ` · ${C.autosOn(1)}`, '1 on');
    ok(t.card('rule1') === li && t.doc.activeElement === s, 'the card and the focused switch are the same nodes (keyboard focus stays)');
    s.click(); eq(t.toggles.at(-1), ['rule1', true], 'off → asks for on');
    t.a.render([{ ...R1, enabled: false }, { ...S1, enabled: false, firedToday: 3 }]);
    eq(t.count.textContent, ` · ${C.autosAllOff}`, 'all off'); eq(t.card('sched1').one('asub').textContent, `${C.autoSchedule} · ${C.autoOff}`, 'off wins over the count');
  });

  await check('automations ui · a dropped card goes (focus back to the heading); a new one joins in order; text is never HTML', () => {
    const t = make(); t.a.render([R1, S1]); t.sw('sched1').focus();
    t.a.render([R1]); eq(t.root.all('auto').map((li) => li.dataset.id), ['rule1'], 'sched1 dropped'); ok(t.doc.activeElement === t.head, 'focus on the heading, not lost');
    const R2 = { ...R1, id: 'rule2', text: '<b>When</b> & "now"' };
    t.a.render([R1, R2, S1]); eq(t.root.all('auto').map((li) => li.dataset.id), ['rule1', 'rule2', 'sched1']);
    eq(t.card('rule2').one('atext').textContent, '<b>When</b> & "now"', 'shown as typed (textContent; innerHTML would have thrown)');
    t.a.render([S1, R1]); eq(t.root.all('auto').map((li) => li.dataset.id), ['sched1', 'rule1'], 'a new order is followed');
  });

  await check('automations ui · JUST RAN and HELD flash for 2 s, on the card and the folded summary line', async () => {
    const t = make({ collapsed: true }); t.a.render([R1, S1]);
    t.a.flash('sched1', 'ran');
    eq([t.card('sched1').classList.contains('flash-ran'), t.card('sched1').one('badge').textContent, t.badge.textContent], [true, C.autoJustRan, C.autoJustRan], 'JUST RAN');
    await sleep(1500); t.a.flash('rule1', 'held');
    eq([t.card('rule1').classList.contains('flash-held'), t.card('rule1').one('badge').textContent, t.badge.textContent, t.head.classList.contains('flash-held')], [true, C.autoHeldBadge, C.autoHeldBadge, true], 'HELD');
    await sleep(600); eq([t.card('sched1').classList.contains('flash-ran'), t.card('sched1').one('badge').textContent], [false, ''], 'the first one ends after 2 s');
    eq(t.badge.textContent, C.autoHeldBadge, 'the summary shows the latest');
    await sleep(1500); eq([t.card('rule1').one('badge').textContent, t.badge.textContent, t.head.classList.contains('flash-held')], ['', '', false], 'all gone');
    t.a.flash('nope', 'ran'); eq(t.badge.textContent, '', 'an unknown id flashes nothing');
    t.a.flash('rule1', 'ran'); t.a.flash('rule1', 'ran'); await sleep(1900); eq(t.card('rule1').one('badge').textContent, C.autoJustRan, 'a second flash restarts the 2 s');
    await sleep(200); eq(t.card('rule1').one('badge').textContent, '');
  });

  await check('automations ui · folded (phones): the summary line opens and folds it; Escape folds and gives focus back; open on desktop', () => {
    const t = make({ collapsed: true }); t.a.render([R1]);
    eq([t.body.hidden, t.head.getAttribute('aria-expanded'), t.head.getAttribute('aria-controls')], [true, 'false', t.body.id], 'folded, controls the list');
    t.head.click(); eq([t.body.hidden, t.head.getAttribute('aria-expanded'), t.root.classList.contains('open')], [false, 'true', true], 'open');
    t.sw('rule1').focus(); t.root.onkeydown({ key: 'Escape' }); ok(t.body.hidden === true && t.doc.activeElement === t.head, 'Escape: folded, focus on the summary line');
    t.root.onkeydown({ key: 'Enter' }); eq(t.body.hidden, true, 'another key does nothing');
    t.head.click(); t.a.render(null); t.a.render([]); eq(t.body.hidden, true, 'a new live session starts folded again');
    const d = make(); d.a.render([R1]); eq([d.body.hidden, d.head.getAttribute('aria-expanded')], [false, 'true'], 'desktop: open');
    d.root.onkeydown({ key: 'Escape' }); eq(d.body.hidden, false, 'Escape leaves the desktop list open (it pushes nothing over the chat)');
    d.head.click(); eq(d.body.hidden, true, 'the heading folds it on desktop too');
  });

  await check('automations ui · helpers: sub-line, summary, startFolded()', () => {
    eq([subLine({ kind: 'rule', enabled: true, firedToday: 0 }), subLine({ kind: 'schedule', enabled: true, firedToday: 1 }), subLine({ kind: 'rule', enabled: false, firedToday: 4 })],
      ['Rule', 'Schedule · ran 1× today', 'Rule · Off']);
    eq([summaryOf([]), summaryOf([R1]), summaryOf([{ ...R1, enabled: false }])], ['none yet', '1 on', 'all off']);
    const seen = []; const mm = (q) => { seen.push(q); return { matches: q.includes('959') }; };
    eq([startFolded(mm), startFolded(() => ({ matches: false })), startFolded(null)], [true, false, false]);
    eq(seen[0], '(max-width: 959px), (max-height: 760px)', 'phones (the CSS phone breakpoint) and short windows');
  });

  // ---- the pages around it (no browser: read the markup and the CSS) ----
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const main = read('../js/main.js'), mount = read('../js/custom/mount.js'), css = read('../css/app.css').replace(/\r\n/g, '\n'), ccss = read('../css/custom.css');
  await check('page · the header Live AI button: after "‹ Scenes", hidden until shown, no public-site path; the custom scene has none', () => {
    ok(/Scenes<\/a><button class="btn small primary live-top" id="liveTop" type="button"[^>]* hidden>/.test(main), 'main.js: the button sits right after Scenes, hidden at first');
    ok(/\.top \.live-top\[hidden\] \{ display: none; \}/.test(css), 'css: [hidden] beats .btn\'s inline-block');
    ok(/createLiveEntry\(\{ live, flow, show: \(on\) => \{ liveTop\.hidden = !on; \}/.test(main) && /liveTop\.onclick = \(\) => entry\.open\(\)/.test(main), 'main.js: wired through liveentry.js');
    ok(/onLive: \(\) => entry\?\.open\(\)/.test(main), 'the end card\'s live button takes the same path');
    ok(/live = base \? createLive\(/.test(main), 'no API base: no live, so the entry never shows the button');
    ok(!/live-top|createLiveEntry/.test(mount), 'the custom page has no header button (its gate and Done building → are its entry)');
  });
  await check('page · the Automations section: between the cards and the chat, live mode only, phones keep the chat\'s height', () => {
    ok(/<div class="panel" id="panel"><\/div>\s*<div class="autos" id="autos" hidden><\/div>\s*<div class="chat" id="chat"><\/div>/.test(main), 'main.js: #autos between #panel and #chat, hidden');
    ok(/<div class="panel" id="panel" hidden><\/div>\s*<div class="autos" id="autos" hidden><\/div>\s*<div class="chat" id="chat"><\/div>/.test(mount), 'custom page: the same');
    ok(/const autos = base \? createAutomations\(/.test(main), 'main.js: no section without an API base');
    ok(/automations: \(list\) => autos\?\.render\(list\)/.test(main) && /automationFlash: \(id, kind\) => autos\?\.flash\(id, kind\)/.test(main), 'main.js: live\'s hooks reach it');
    ok(/\.autos\[hidden\][^{]*\{ display: none; \}/.test(css), 'css: hidden means hidden');
    ok(/\.stage \{[^}]*grid-template-rows: auto auto auto auto minmax\(0, 1fr\); \}/.test(css) && /\.stage \.chat \{ grid-row: -2 \/ -1; \}/.test(css), 'css: a row for it, the chat stays in the last (1fr) row');
    ok(/\.app\.live-edit \.room canvas \{ height: max\(110px, calc\(clamp\(140px, calc\(100dvh - 420px\), min\(75vw, 42dvh\)\) - 110px\)\); \}/.test(css), 'css: on phones the room gives up the summary line\'s 36 px (74 + 36)');
    const phone = css.slice(css.indexOf('/* Phones: one 36 px summary line'));
    ok(/\.autos \.autos-body \{ position: absolute;/.test(phone), 'css: unfolded on a phone, the list lies over the chat (no height taken from it)');
    ok(/\.autos-head \{[^}]*min-height: 35px;/.test(css) && /\.autos \{[^}]*border-top: 1px solid/.test(css), 'css: 35 px + a 1 px border = the 36 px the room gave up');
    ok(/\.stage\.custom:not\(\[data-mode="run"\]\) \.autos \{ display: none; \}/.test(ccss), 'custom.css: run mode only');
  });
}
