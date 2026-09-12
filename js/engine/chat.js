// The NeuCharBox conversation column. All wording comes from the scene.
// Every interactive card owns its resolver. A beat skip (resolvePending) settles each open card with the
// visitor's current choices, marks it done and disables its buttons, so a stale card can't answer a later one.
export function createChat(root, { onPromptText } = {}) {
  root.innerHTML = `
    <div class="chat-log" id="chatLog"></div>
    <form class="chat-input" id="chatForm" autocomplete="off">
      <input id="chatText" type="text" placeholder="Or type what you want…" aria-label="Your request" disabled>
      <button type="submit" aria-label="Send">➤</button>
    </form>`;
  const log = root.querySelector('#chatLog');
  const form = root.querySelector('#chatForm');
  const input = root.querySelector('#chatText');
  let pending = [];   // [{ node, settle(value), skipValue() }]
  let typingEl = null;
  const finePointer = typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;

  form.addEventListener('submit', (e) => { e.preventDefault(); const t = input.value.trim(); if (!t) return; input.value = ''; onPromptText && onPromptText(t); });

  const el = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; };
  const scrollDown = () => requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
  const push = (node) => { if (typingEl) { typingEl.remove(); typingEl = null; } log.appendChild(node); scrollDown(); return node; };
  new MutationObserver(scrollDown).observe(log, { childList: true, subtree: true, characterData: true });
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const closeCard = (node) => { node.classList.add('done'); node.querySelectorAll('button').forEach((b) => (b.disabled = true)); };

  // Register an interactive card; returns a promise settled by the card itself or by a skip.
  function interactive(node, skipValue) {
    return new Promise((res) => {
      const rec = { node, skipValue, settle: (v) => { pending = pending.filter((p) => p !== rec); closeCard(node); res(v); } };
      pending.push(rec);
      node._settle = rec.settle;
    });
  }

  return {
    enableInput(on) { input.disabled = !on; },
    typing(on) { if (on) { if (!typingEl) typingEl = push(el('<div class="msg ncb typing"><span></span><span></span><span></span></div>')); } else if (typingEl) { typingEl.remove(); typingEl = null; } },
    ncb(text) { push(el(`<div class="msg ncb">${esc(text)}</div>`)); },
    user(text) { push(el(`<div class="msg me">${esc(text)}</div>`)); },
    alert(text, title = '⚠ Something changed') { push(el(`<div class="msg ncb alert"><b>${esc(title)}</b>${esc(text)}</div>`)); },
    resolvePending() { for (const p of [...pending]) p.settle(p.skipValue()); },

    button(label) {
      const node = push(el(`<div class="card action"><button class="btn primary">${esc(label)}</button></div>`));
      const done = interactive(node, () => undefined);
      node.querySelector('button').onclick = () => node._settle();
      return done;
    },
    qr() {
      const node = push(el(`<div class="card qr"><div class="qr-code" aria-hidden="true"></div><div><b>Scan to pair</b><p>Point your phone at the code on the hub.</p><button class="btn primary">Scan QR</button></div></div>`));
      const q = node.querySelector('.qr-code'); for (let i = 0; i < 49; i++) { const c = document.createElement('i'); if (Math.random() < 0.45 || i < 3 || i % 7 === 0) c.className = 'on'; q.appendChild(c); }
      const done = interactive(node, () => undefined);
      node.querySelector('button').onclick = () => node._settle();
      return done;
    },
    chips(list, onPick, { heading } = {}) {
      if (heading) this.ncb(heading);
      const node = push(el(`<div class="chips"></div>`));
      for (const p of list) { const b = el(`<button class="chip">${esc(p.chip)}</button>`); b.onclick = () => { node.remove(); onPick(p); }; node.appendChild(b); }
      input.disabled = false; if (finePointer) input.focus({ preventScroll: true });
      return node;
    },
    // skipped: the visitor fast-forwarded past this card, so it is shown and settled at once, labelled as skipped.
    plan(spec, { skipped = false } = {}) {
      const alts = {}; let clicked = false;
      const node = push(el(`<div class="card plan"><p class="intro">${esc(spec.intro || 'Here\'s the plan. Nothing runs until you approve it.')}</p><ol></ol><div class="row"><button class="btn approve">${esc(spec.approve || 'Approve')}</button></div></div>`));
      const ol = node.querySelector('ol');
      spec.steps.forEach((s, i) => {
        const li = el(`<li><span class="txt">${esc(s.text)}</span>${s.alt ? `<button class="link">Edit</button>` : ''}</li>`);
        if (s.alt) li.querySelector('.link').onclick = (e) => { alts[i] = !alts[i]; li.querySelector('.txt').textContent = alts[i] ? s.alt.text : s.text; e.target.textContent = alts[i] ? 'Undo' : 'Edit'; };
        ol.appendChild(li);
      });
      const approveBtn = node.querySelector('.approve');
      const done = interactive(node, () => ({ approved: true, alts: { ...alts } }));
      approveBtn.onclick = () => { clicked = true; node._settle({ approved: true, alts: { ...alts } }); };
      if (skipped) node._settle({ approved: true, alts: {} });
      return done.then((v) => { approveBtn.textContent = clicked ? 'Approved ✓' : 'Skipped ahead · ran as shown'; if (!clicked) node.classList.add('skipped'); return v; });
    },
    ask(spec, { skipped = false } = {}) {
      const node = push(el(`<div class="card plan halt"><p class="intro">${esc(spec.intro)}</p><div class="row col"></div></div>`));
      const row = node.querySelector('.row');
      const done = interactive(node, () => 0);
      spec.options.forEach((o, i) => { const b = el(`<button class="btn ${i === 0 ? 'approve' : ''}">${esc(o.label)}</button>`); b.onclick = () => { b.classList.add('chosen'); b.textContent += ' ✓'; node._settle(i); }; row.appendChild(b); });
      if (skipped) node._settle(0);
      return done.then((i) => { const b = row.children[i]; if (b) { b.classList.add('chosen'); if (!b.textContent.includes('✓')) b.textContent += skipped ? ' ✓ (skipped ahead)' : ' ✓'; } return i; });
    },
    replan(spec) {
      push(el(`<div class="card replan"><p class="intro">${esc(spec.intro)}</p><ul>${(spec.changes || []).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>${spec.needsYou ? `<p class="needs"><b>Needs you:</b> ${esc(spec.needsYou)}</p>` : ''}</div>`));
    },
    // End card. `onMore` (optional) adds "Another request here", which the host uses to re-offer prompts.
    end(spec, { onMore } = {}) {
      input.disabled = true;
      const node = push(el(`<div class="card end"><h3>${esc(spec.headline)}</h3><p>${esc(spec.body)}</p><div class="row">${onMore ? '<button class="btn more" type="button">Another request here</button>' : ''}<a class="btn" href="#">Try another scene</a><a class="btn primary" href="${spec.cta || 'https://www.kickstarter.com/projects/neucharbox/neucharbox-ai-operating-system-for-the-physical-world?ref=demo'}" target="_blank" rel="noopener">Back on Kickstarter</a></div></div>`));
      if (onMore) { const b = node.querySelector('.more'); b.onclick = () => { b.disabled = true; onMore(); }; }
      return node;
    },
  };
}
