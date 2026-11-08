// Check 18b: the Automations section (js/engine/automations.js) on a small stand-in document, and the page wiring around
// it and the header's Live AI button (static checks of main.js, the custom page and the CSS: no browser here).
//   automationChecks({ report }) runs them (test/run.mjs, in the `live` group).
import { readFileSync } from 'node:fs';
import { virtualTime } from './clock.mjs';
import { createAutomations, subLine, summaryOf, foldMedia, FOLD_QUERY, OVERLAY_QUERY } from '../js/engine/automations.js';
import { LIVE_COPY as C, automationsOf } from '../js/engine/live.js';
import { RULE1, SCHED1, RULE2, ONCE1 } from './fixtures/live-mock.mjs';

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
  // document listeners (the section folds its overlay on a tap elsewhere): add, remove, and fire one by hand
  const on = [];
  doc.addEventListener = (type, fn) => on.push([type, fn]);
  doc.removeEventListener = (type, fn) => { const i = on.findIndex(([t, f]) => t === type && f === fn); if (i >= 0) on.splice(i, 1); };
  doc.fire = (type, e) => { for (const [t, f] of [...on]) if (t === type) f(e); };
  doc.listeners = (type) => on.filter(([t]) => t === type).length;
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
  const R1 = automationsOf([RULE1])[0], S1 = automationsOf([SCHED1])[0], R2 = automationsOf([RULE2])[0], O1 = automationsOf([ONCE1])[0];
  // a MediaQueryList stand-in: set(v) changes it and tells its listeners
  const media = (matches) => { const fns = new Set(); return { matches, addEventListener: (t, f) => fns.add(f), removeEventListener: (t, f) => fns.delete(f), set(v) { this.matches = v; for (const f of fns) f({ matches: v }); }, get n() { return fns.size; } }; };
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
    const t = make({ fold: true }); t.a.render([R1, S1]);
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

  await check('automations ui · folded (phones): the summary line opens and folds it; Escape folds and gives focus back, on desktop too', () => {
    const t = make({ fold: true }); t.a.render([R1]);
    eq([t.body.hidden, t.head.getAttribute('aria-expanded'), t.head.getAttribute('aria-controls')], [true, 'false', t.body.id], 'folded, controls the list');
    t.head.click(); eq([t.body.hidden, t.head.getAttribute('aria-expanded'), t.root.classList.contains('open')], [false, 'true', true], 'open');
    t.sw('rule1').focus(); t.root.onkeydown({ key: 'Escape' }); ok(t.body.hidden === true && t.doc.activeElement === t.head, 'Escape: folded, focus on the summary line');
    t.root.onkeydown({ key: 'Enter' }); eq(t.body.hidden, true, 'another key does nothing');
    t.head.click(); t.a.render(null); t.a.render([]); eq(t.body.hidden, true, 'a new live session starts folded again');
    const d = make(); d.a.render([R1]); eq([d.body.hidden, d.head.getAttribute('aria-expanded')], [false, 'true'], 'desktop: open');
    d.sw('rule1').focus(); d.root.onkeydown({ key: 'Escape' }); ok(d.body.hidden === true && d.doc.activeElement === d.head, 'Escape folds it on desktop too, focus on the summary line');
    d.head.click(); eq(d.body.hidden, false, 'and the heading opens it again');
    d.sw('rule1').focus(); d.head.click(); ok(d.body.hidden && d.doc.activeElement === d.head, 'folding with focus inside the list keeps focus (on the summary line)');
  });

  await check('automations ui · the layout can change under it: entering a folding layout folds it; over the page, a tap elsewhere or attention() folds it', () => {
    const fold = media(false), overlay = media(false), t = make({ fold, overlay }); t.a.render([R1, S1]);
    eq(t.body.hidden, false, 'a desktop start: open');
    t.a.attention(); t.doc.fire('pointerdown', { target: t.doc.createElement('div') }); eq(t.body.hidden, false, 'in the flow (desktop): attention() and a tap elsewhere leave it open');
    fold.set(true); overlay.set(true); eq(t.body.hidden, true, 'rotated into the phone layout: folded');
    fold.set(false); eq(t.body.hidden, true, 'leaving it does not open it by itself');
    t.head.click(); t.doc.fire('pointerdown', { target: t.sw('rule1') }); eq(t.body.hidden, false, 'a tap inside it leaves it open');
    t.doc.fire('pointerdown', { target: t.doc.createElement('div') }); eq(t.body.hidden, true, 'a tap elsewhere folds it (it lies over the chat)');
    t.head.click(); t.sw('sched1').focus(); t.a.attention(); ok(t.body.hidden && t.doc.activeElement === t.head, 'a plan waiting for approval folds it, focus on the summary line');
    eq([fold.n, t.doc.listeners('pointerdown')], [1, 1], 'one listener each'); t.a.dispose(); eq([fold.n, t.doc.listeners('pointerdown')], [0, 0], 'dispose() takes them off');
    const p = make({ fold: true, overlay: true }); p.a.render([R1]); p.head.click(); p.a.attention(); eq(p.body.hidden, true, 'booleans work too');
  });

  await check('automations ui · a done one-off: "Done", no switch, not counted as on; never an unnamed switch', () => {
    const t = make(); t.a.render([R1, O1, R2]);
    eq(t.count.textContent, ` · ${C.autosOn(3)}`, '3 on');
    t.sw('sched2').focus(); t.a.render([R1, { ...O1, done: true, firedToday: 1 }, R2]);
    const c = t.card('sched2');
    eq([c.one('asub').textContent, c.classList.contains('done'), c.classList.contains('off'), t.sw('sched2').hidden], [`${C.autoSchedule} · ${C.autoDone}`, true, false, true], 'Done, its switch gone');
    ok(t.doc.activeElement === t.head, 'its focused switch went: focus on the summary line, not lost');
    eq(t.count.textContent, ` · ${C.autosOn(2)}`, 'a done one-off is not on');
    t.a.render([{ ...O1, done: true }, { ...O1, id: 'sched3', done: true, enabled: false }]); eq(t.count.textContent, ` · ${C.autosAllDone}`, 'all done');
    t.a.render([{ ...O1, done: true }, { ...R1, enabled: false }]); eq(t.count.textContent, ` · ${C.autosAllOff}`, 'one done, one off: all off');
    t.a.render([{ ...R1, text: '' }]); eq(t.sw('rule1').getAttribute('aria-label'), C.autoRule, 'no text: the switch is named by its sub-line');
    eq(t.card('rule2'), undefined, 'gone from the list');
    eq(t.card('rule1').one('atext').textContent, '', 'and shows no text of its own');
  });

  await check('automations ui · helpers: sub-line, summary, foldMedia()', () => {
    eq([subLine({ kind: 'rule', enabled: true, firedToday: 0 }), subLine({ kind: 'schedule', enabled: true, firedToday: 1 }), subLine({ kind: 'rule', enabled: false, firedToday: 4 }), subLine({ kind: 'schedule', enabled: false, firedToday: 1, done: true })],
      ['Rule', 'Schedule · ran 1× today', 'Rule · Off', 'Schedule · Done']);
    eq([summaryOf([]), summaryOf([R1]), summaryOf([{ ...R1, enabled: false }]), summaryOf([{ ...O1, done: true }])], ['none yet', '1 on', 'all off', 'all done']);
    const seen = []; const mm = (q) => { seen.push(q); return { matches: q === OVERLAY_QUERY }; };
    const fm = foldMedia(mm); eq([fm.fold.matches, fm.overlay.matches, seen], [false, true, [FOLD_QUERY, OVERLAY_QUERY]]);
    eq(foldMedia(null), { fold: false, overlay: false }, 'no matchMedia: open, in the flow');
    eq([FOLD_QUERY, OVERLAY_QUERY], ['(max-width: 959px), (max-height: 899px)', '(max-width: 959px)'], 'phones (the CSS phone breakpoint) and windows under 900 px tall');
  });

  // ---- the pages around it (no browser: read the markup and the CSS) ----
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const main = read('../js/main.js'), mount = read('../js/custom/mount.js'), css = read('../css/app.css').replace(/\r\n/g, '\n'), ccss = read('../css/custom.css');
  await check('page · the header Live AI button: before "‹ Scenes" (a double-click lands on nothing), hidden until shown, focus kept; no public-site path; the custom scene has none', () => {
    ok(/<div class="spacer"><\/div><button class="btn small primary live-top" id="liveTop" type="button"[^>]* hidden>.*?<\/button><a class="btn small secondary" href="#"><span class="back"/.test(main), 'main.js: the button sits between the spacer and Scenes, hidden at first');
    ok(/\.top \.live-top\[hidden\] \{ display: none; \}/.test(css), 'css: [hidden] beats the inline-block of .btn');
    ok(/\.top \.spacer \+ \.live-top\[hidden\] \+ \.btn \{ margin-left: auto; \}/.test(css), 'css (phones): hidden, it hands its margin to Scenes, which stays where it was');
    ok(/createLiveEntry\(\{ live, flow,/.test(main) && /if \(!on && document\.activeElement === liveTop\) chatLog\?\.focus\(/.test(main) && /liveTop\.hidden = !on;/.test(main), 'main.js: wired through liveentry.js; focus goes to the conversation when it hides');
    ok(/liveTop\.onclick = \(\) => entry\.open\(\)/.test(main) && /onLive: \(\) => entry\?\.open\(\)/.test(main), 'the live button of the end card takes the same path');
    ok(/live = base \? createLive\(/.test(main), 'no API base: no live, so the entry never shows the button');
    ok(/const top = document\.getElementById\('liveTop'\); if \(top\) top\.hidden = true;/.test(main), 'a scene that failed to start hides it (its live is closed)');
    ok(!/live-top|createLiveEntry/.test(mount), 'the custom page has no header button (its gate and Done building → are its entry)');
  });
  await check('page · the Automations section: between the cards and the chat, live mode only; phones and desktops keep the chat height', () => {
    ok(/<div class="panel" id="panel"><\/div>\s*<div class="autos" id="autos" hidden><\/div>\s*<div class="chat" id="chat"><\/div>/.test(main), 'main.js: #autos between #panel and #chat, hidden');
    ok(/<div class="panel" id="panel" hidden><\/div>\s*<div class="autos" id="autos" hidden><\/div>\s*<div class="chat" id="chat"><\/div>/.test(mount), 'custom page: the same');
    ok(/autos = base \? createAutomations\(/.test(main) && /\.\.\.foldMedia\(\)/.test(main) && /\.\.\.foldMedia\(\)/.test(mount), 'main.js: no section without an API base; both pages pass the live media');
    ok(/automations: \(list\) => autos\?\.render\(list\)/.test(main) && /automationFlash: \(id, kind\) => autos\?\.flash\(id, kind\)/.test(main) && /attention: \(\) => autos\?\.attention\(\)/.test(main), 'main.js: the hooks of live reach it');
    ok(/autos\?\.dispose\(\)/.test(main) && /autos\?\.dispose\(\)/.test(mount), 'both pages dispose it at teardown');
    ok(/\.autos\[hidden\][^{]*\{ display: none; \}/.test(css), 'css: hidden means hidden');
    ok(/\.stage \{[^}]*grid-template-rows: auto auto auto auto minmax\(0, 1fr\); \}/.test(css) && /\.stage \.chat \{ grid-row: -2 \/ -1; \}/.test(css), 'css: a row for it, the chat stays in the last (1fr) row');
    ok(/\.app\.live-edit \.room canvas \{ height: max\(110px, calc\(clamp\(140px, calc\(100dvh - 420px\), min\(75vw, 42dvh\)\) - 110px\)\); \}/.test(css), 'css: on portrait phones the room gives up the 36 px of the summary line (74 + 36)');
    const phone = css.slice(css.indexOf('/* Phones: one 36 px summary line'));
    ok(/\.autos \.autos-body \{ position: absolute;[^}]*var\(--autos-below, 340px\)/.test(phone), 'css: unfolded on a phone, the list lies over the chat, inside the window');
    ok(/\.autos-head \{[^}]*min-height: 35px;/.test(css) && /\.autos \{[^}]*border-top: 1px solid/.test(css), 'css: 35 px + a 1 px border = the 36 px the room gave up');
    const land = css.slice(css.indexOf('/* Phones held sideways (live mode)'));
    ok(/\.app\.live-edit \.side \{ display: contents; \}/.test(land) && /\.app\.live-edit \.autos \{ grid-column: 1; grid-row: 3; \}/.test(land) && /\.app\.live-edit \.stage \.chat \{ grid-column: 2; grid-row: 2 \/ -1;/.test(land) && /\.app\.live-edit \.room \{ grid-column: 1; grid-row: 1 \/ 3; \}/.test(land), 'css (landscape phones): the line sits under the room; the chat keeps the side column below the cards');
    const desk = css.slice(css.indexOf('/* Desktop: open under the device cards'));
    ok(/max-height: min\(30%, 220px\)/.test(desk) && /\.app\.live-edit \.chat \{ min-height: min\(45%, 280px\); \}/.test(desk) && /\.autos \{ flex: 0 1 auto;/.test(desk), 'css (desktop): the section is capped in px and gives way to the floor of the chat');
    ok(/\.auto\.off \.atext, \.auto\.done \.atext \{ color: var\(--ink-2\); \}/.test(css), 'css: off and done text stays readable (ink-2, about 4.6:1 on white)');
    ok(/\.stage\.custom:not\(\[data-mode="run"\]\) \.autos \{ display: none; \}/.test(ccss), 'custom.css: run mode only');
  });
}
