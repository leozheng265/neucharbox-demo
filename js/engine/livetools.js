// Live mode's device interface, without the model: each device card's action controls, and the section under the cards
// with fault planting (per device, from its faultModes), Clear faults, Reset room and the event log.
//   createLiveTools(root, { doc, slotFor, onRun, onPlant, onClearFaults, onReset, folded }) → { show, devices, controls,
//     result, faults, log, open, lines, dispose }
//     root          the section's element (#ltools); hidden until show(true)
//     slotFor(id)   the element on a device's card that takes its action controls (panel.slot(id)), or null
//     onRun(id, verb, args)   an action's button; args from its controls, one per JSON-schema parameter
//     onPlant(device, mode) · onClearFaults() · onReset()
//     folded        start with the section folded to its head line (phones)
// Controls per parameter (parameters.properties): an enum → a select; a boolean → a switch; a number or integer with
// a minimum and a maximum → a slider with its value, without them → a number field; a string → a text field. An action
// with no parameters is just its button. Everything is built with createElement and textContent: the server's text
// (names, descriptions, results, event lines) is never parsed as HTML.
import { LIVE_COPY as C, actionLabel } from './live.js';

const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const words = (k) => String(k).replace(/_/g, ' ');
// A slider step: the smallest of these that gives at most about 100 steps across the range.
const STEPS = [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 50, 100];
const stepFor = (p, min, max) => (p.type === 'integer' ? 1 : finite(p.multipleOf) ? p.multipleOf : STEPS.find((s) => (max - min) / s <= 100) ?? 1);
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const round = (v, step) => Math.round(Math.round(v / step) * step * 1e6) / 1e6;

export function createLiveTools(root, { doc = globalThis.document, slotFor = () => null, onRun = () => {}, onPlant = () => {}, onClearFaults = () => {}, onReset = () => {}, folded = false, maxLines = 200 } = {}) {
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const btn = (cls, text) => { const b = el('button', cls, text); b.type = 'button'; return b; };

  // ---- the section ----
  root.classList.add('ltools');
  root.textContent = '';
  const head = btn('lt-head'), title = el('span', 'lt-title', C.toolsTitle), count = el('span', 'lt-count'), chev = el('span', 'lt-chev', '▾');
  chev.setAttribute('aria-hidden', 'true');
  head.append(title, count, chev);
  const body = el('div', 'lt-body'); body.id = 'ltoolsBody'; head.setAttribute('aria-controls', body.id);
  const fSec = el('section', 'lt-sec lt-faults'), fHead = el('h3', 'lt-h', C.faultsTitle);
  const plantRow = el('div', 'lt-plant'), devSel = el('select', 'lt-dev'), modeSel = el('select', 'lt-mode'), plantBtn = btn('btn small lt-go', C.plant);
  devSel.setAttribute('aria-label', C.faultDevice); modeSel.setAttribute('aria-label', C.faultMode);
  plantRow.append(devSel, modeSel, plantBtn);
  const planted = el('ul', 'lt-planted'), none = el('p', 'lt-none', C.noFaults);
  const actRow = el('div', 'lt-row'), clearBtn = btn('btn small lt-clear', C.clearFaults), resetBtn = btn('btn small lt-reset', C.reset);
  actRow.append(clearBtn, resetBtn);
  fSec.append(fHead, plantRow, planted, none, actRow);
  const lSec = el('section', 'lt-sec lt-log'), lHead = el('h3', 'lt-h', C.logTitle), empty = el('p', 'lt-empty', C.logEmpty), lines = el('ol', 'lt-lines');
  lines.setAttribute('aria-label', C.logTitle);
  lSec.append(lHead, empty, lines);
  body.append(fSec, lSec);
  root.append(head, body);

  let isOpen = !folded, enabled = false, acting = null, devs = [], planted0 = [], events = 0;
  const open = (on) => { isOpen = !!on; body.hidden = !isOpen; head.setAttribute('aria-expanded', String(isOpen)); root.classList.toggle('open', isOpen); };
  head.onclick = () => open(!isOpen);
  open(isOpen);
  const nameOf = (id) => devs.find((d) => d.id === id)?.name ?? id;
  const showCount = () => { count.textContent = C.toolsCount(planted0.length, events); };

  // the plant row: devices that can fail, then the modes of the one picked
  const faultable = () => devs.filter((d) => d.faultModes.length);
  function fillModes() {
    const d = devs.find((x) => x.id === devSel.value);
    const keep = modeSel.value; modeSel.textContent = '';
    for (const m of d?.faultModes ?? []) { const o = el('option', null, C.faultWord(m)); o.value = m; modeSel.appendChild(o); }
    if (d?.faultModes.includes(keep)) modeSel.value = keep;
    sync();
  }
  function fillDevices() {
    const keep = devSel.value; devSel.textContent = '';
    for (const d of faultable()) { const o = el('option', null, d.name); o.value = d.id; devSel.appendChild(o); }
    if (faultable().some((d) => d.id === keep)) devSel.value = keep;
    fillModes();
  }
  devSel.onchange = fillModes;
  modeSel.onchange = sync;
  plantBtn.onclick = () => { if (!plantBtn.disabled && devSel.value) onPlant(devSel.value, modeSel.value || 'offline'); };
  clearBtn.onclick = () => { if (!clearBtn.disabled) onClearFaults(); };
  resetBtn.onclick = () => { if (!resetBtn.disabled) onReset(); };

  // ---- action controls on the cards ----
  const cards = new Map(); // id → { slot, rows: Map(verb → { go, res, label }) }
  function paramControl(key, p, required) {
    const row = el('span', `ap ap-${p.enum ? 'enum' : p.type || 'any'}`), lab = el('span', 'ap-lab', words(key));
    row.dataset.param = key;
    if (required) row.dataset.required = 'true';
    if (Array.isArray(p.enum) && p.enum.length) {
      const s = el('select', 'ap-sel');
      p.enum.forEach((v, i) => { const o = el('option', null, String(v)); o.value = String(i); s.appendChild(o); });
      const at = p.enum.findIndex((v) => v === p.default); s.value = String(at >= 0 ? at : 0);
      s.setAttribute('aria-label', words(key));
      row.append(lab, s);
      return { row, value: () => p.enum[Number(s.value)] };
    }
    if (p.type === 'boolean') {
      const sw = btn('sw ap-sw'); sw.setAttribute('role', 'switch'); sw.setAttribute('aria-label', words(key));
      let on = p.default === true;
      const show = () => { sw.setAttribute('aria-checked', String(on)); sw.classList.toggle('on', on); };
      sw.onclick = () => { on = !on; show(); };
      show(); row.append(sw, lab);
      return { row, value: () => on };
    }
    if (p.type === 'number' || p.type === 'integer') {
      const min = finite(p.minimum) ? p.minimum : finite(p.exclusiveMinimum) ? p.exclusiveMinimum : null;
      const max = finite(p.maximum) ? p.maximum : finite(p.exclusiveMaximum) ? p.exclusiveMaximum : null;
      const input = el('input', 'ap-num'); input.setAttribute('aria-label', words(key));
      const start = finite(p.default) ? p.default : min ?? 0;
      if (min != null && max != null && max > min) {
        const step = stepFor(p, min, max), val = el('span', 'ap-val');
        input.type = 'range'; input.className = 'ap-range edit-range'; input.min = String(min); input.max = String(max); input.step = String(step);
        input.value = String(clamp(round(start, step), min, max));
        const show = () => { val.textContent = String(Number(input.value)); input.setAttribute('aria-valuetext', val.textContent); input.style?.setProperty?.('--fill', `${((Number(input.value) - min) / (max - min)) * 100}%`); };
        input.oninput = show; show();
        row.append(lab, input, val);
      } else {
        input.type = 'number'; if (min != null) input.min = String(min); if (max != null) input.max = String(max);
        input.step = p.type === 'integer' ? '1' : 'any'; input.value = String(start);
        row.append(lab, input);
      }
      return { row, value: () => { const v = Number(input.value); return p.type === 'integer' ? Math.round(v) : v; } };
    }
    if (p.type === 'string') {
      const input = el('input', 'ap-text'); input.type = 'text'; input.maxLength = 80; input.setAttribute('aria-label', words(key));
      input.value = typeof p.default === 'string' ? p.default : '';
      row.append(lab, input);
      return { row, value: () => input.value };
    }
    return null; // a kind of parameter the page can't offer: the server's validator says what it needs
  }
  function buildCard(d) {
    const slot = slotFor(d.id);
    if (!slot) return;
    slot.textContent = '';
    const rows = new Map();
    for (const a of d.actions) {
      const row = el('span', `act act-${a.kind}`); row.dataset.verb = a.verb;
      const props = a.parameters?.properties && typeof a.parameters.properties === 'object' ? a.parameters.properties : {};
      const req = new Set(Array.isArray(a.parameters?.required) ? a.parameters.required : []);
      const ctls = [];
      const params = el('span', 'act-params');
      for (const [k, p] of Object.entries(props)) { const c = p && typeof p === 'object' ? paramControl(k, p, req.has(k)) : null; if (c) { ctls.push([k, c]); params.appendChild(c.row); } }
      const label = actionLabel(a), go = btn('btn small act-go', label), res = el('span', 'act-res');
      if (a.description) go.title = a.description;
      go.setAttribute('aria-label', `${d.name}: ${label}`);
      res.hidden = true; res.setAttribute('aria-live', 'polite');
      go.onclick = () => { if (go.disabled) return; const args = {}; for (const [k, c] of ctls) args[k] = c.value(); onRun(d.id, a.verb, args); };
      if (ctls.length) row.appendChild(params);
      row.append(go, res);
      slot.appendChild(row);
      rows.set(a.verb, { go, res, label });
    }
    cards.set(d.id, { slot, rows });
  }
  function dropCards() { for (const { slot } of cards.values()) slot.textContent = ''; cards.clear(); }

  // Enabled: every action button, Plant, Clear faults and Reset room. The action playing says so on its button.
  function sync() {
    for (const [id, c] of cards) for (const [verb, r] of c.rows) {
      const mine = !!acting && acting.id === id && acting.verb === verb;
      r.go.disabled = !enabled; r.go.classList.toggle('running', mine); r.go.textContent = mine ? C.running : r.label;
      if (mine) r.go.setAttribute('aria-busy', 'true'); else r.go.removeAttribute('aria-busy');
    }
    plantBtn.disabled = !enabled || !devSel.value || !modeSel.value;
    devSel.disabled = modeSel.disabled = !faultable().length;
    clearBtn.disabled = !enabled || !planted0.length;
    resetBtn.disabled = !enabled;
  }

  return {
    show(on) { root.hidden = !on; },
    open,
    get isOpen() { return isOpen; },
    // The room's devices (live.js liveDevicesOf), or null when live mode's session ends.
    devices(list) {
      dropCards();
      devs = Array.isArray(list) ? list : [];
      for (const d of devs) buildCard(d);
      fillDevices();
    },
    controls({ enabled: on = false, acting: a = null } = {}) { enabled = !!on; acting = a; sync(); },
    // An action's answer under its button: the device's text, red when it failed.
    result(id, verb, { ok = true, text = '' } = {}) {
      const r = cards.get(id)?.rows.get(verb); if (!r) return;
      r.res.textContent = String(text); r.res.hidden = !text; r.res.classList.toggle('bad', !ok);
    },
    faults(list) {
      planted0 = Array.isArray(list) ? list : [];
      planted.textContent = '';
      for (const f of planted0) { const li = el('li', 'lt-fault', `${nameOf(f.device)} · ${C.faultWord(f.mode)}`); li.dataset.device = f.device; li.dataset.mode = f.mode; planted.appendChild(li); }
      planted.hidden = !planted0.length; none.hidden = !!planted0.length;
      showCount(); sync();
    },
    // One event line ({ kind, text, ok, src }), or null for a fresh log. The newest is last; the oldest go past maxLines.
    log(line) {
      if (!line) { lines.textContent = ''; events = 0; empty.hidden = false; showCount(); return; }
      const atEnd = !(lines.scrollHeight > 0) || lines.scrollHeight - lines.scrollTop - lines.clientHeight < 8;
      const li = el('li', 'lt-line', String(line.text ?? ''));
      li.dataset.kind = String(line.kind ?? ''); li.dataset.ok = String(line.ok !== false); if (line.src) li.dataset.src = String(line.src);
      lines.appendChild(li); events++;
      while (lines.children.length > maxLines) lines.children[0].remove();
      empty.hidden = true; showCount();
      if (atEnd && lines.scrollHeight > 0) lines.scrollTop = lines.scrollHeight;
    },
    get lines() { return [...lines.children].map((li) => li.textContent); },
    dispose() { dropCards(); root.textContent = ''; },
  };
}
