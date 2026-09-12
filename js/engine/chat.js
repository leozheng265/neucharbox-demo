// The NeuCharBox conversation column. All wording comes from the scene.
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
  let pending = [];   // resolvers for interactive cards, so skip-ahead can release them
  let typingEl = null;

  form.addEventListener('submit', (e) => { e.preventDefault(); const t = input.value.trim(); if (!t) return; input.value = ''; onPromptText && onPromptText(t); });

  const el = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; };
  const scrollDown = () => requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
  const push = (node) => { if (typingEl) typingEl.remove(); log.appendChild(node); scrollDown(); return node; };
  new MutationObserver(scrollDown).observe(log, { childList: true, subtree: true, characterData: true });
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const wait = () => new Promise((res) => pending.push(res));
  const release = (value) => { const p = pending; pending = []; p.forEach((r) => r(value)); };

  return {
    enableInput(on) { input.disabled = !on; },
    typing(on) { if (on) { typingEl = push(el('<div class="msg ncb typing"><span></span><span></span><span></span></div>')); } else if (typingEl) { typingEl.remove(); typingEl = null; } },
    ncb(text) { push(el(`<div class="msg ncb">${esc(text)}</div>`)); },
    user(text) { push(el(`<div class="msg me">${esc(text)}</div>`)); },
    alert(text) { push(el(`<div class="msg ncb alert"><b>⚠ Something changed</b>${esc(text)}</div>`)); },
    resolvePending() { release({ approved: true, alts: {} }); },

    button(label) {
      const node = push(el(`<div class="card action"><button class="btn primary">${esc(label)}</button></div>`));
      return new Promise((res) => { pending.push(res); node.querySelector('button').onclick = () => { node.classList.add('done'); release(); }; });
    },
    qr() {
      const node = push(el(`<div class="card qr"><div class="qr-code" aria-hidden="true"></div><div><b>Scan to pair</b><p>Point your phone at the code on the hub.</p><button class="btn primary">Scan QR</button></div></div>`));
      const q = node.querySelector('.qr-code'); for (let i = 0; i < 49; i++) { const c = document.createElement('i'); if (Math.random() < 0.45 || i < 3 || i % 7 === 0) c.className = 'on'; q.appendChild(c); }
      return new Promise((res) => { pending.push(res); node.querySelector('button').onclick = () => { node.classList.add('done'); release(); }; });
    },
    chips(list, onPick) {
      const node = push(el(`<div class="chips"></div>`));
      for (const p of list) { const b = el(`<button class="chip">${esc(p.chip)}</button>`); b.onclick = () => { node.remove(); onPick(p); }; node.appendChild(b); }
      input.disabled = false; input.focus({ preventScroll: true });
      return node;
    },
    plan(spec) {
      const alts = {};
      const node = push(el(`<div class="card plan"><p class="intro">${esc(spec.intro || 'Here\'s the plan. Nothing runs until you approve it.')}</p><ol></ol><div class="row"><button class="btn approve">${esc(spec.approve || 'Approve')}</button></div></div>`));
      const ol = node.querySelector('ol');
      spec.steps.forEach((s, i) => {
        const li = el(`<li><span class="txt">${esc(s.text)}</span>${s.alt ? `<button class="link">Edit</button>` : ''}</li>`);
        if (s.alt) li.querySelector('.link').onclick = (e) => { alts[i] = !alts[i]; li.querySelector('.txt').textContent = alts[i] ? s.alt.text : s.text; e.target.textContent = alts[i] ? 'Undo' : 'Edit'; };
        ol.appendChild(li);
      });
      return new Promise((res) => { pending.push(res); node.querySelector('.approve').onclick = () => { node.classList.add('done'); node.querySelector('.approve').textContent = 'Approved ✓'; release({ approved: true, alts }); }; });
    },
    ask(spec) {
      const node = push(el(`<div class="card plan halt"><p class="intro">${esc(spec.intro)}</p><div class="row col"></div></div>`));
      const row = node.querySelector('.row');
      return new Promise((res) => {
        pending.push(res);
        spec.options.forEach((o, i) => { const b = el(`<button class="btn ${i === 0 ? 'approve' : ''}">${esc(o.label)}</button>`); b.onclick = () => { node.classList.add('done'); row.querySelectorAll('button').forEach((x) => (x.disabled = true)); b.textContent += ' ✓'; release(i); }; row.appendChild(b); });
      });
    },
    replan(spec) {
      push(el(`<div class="card replan"><p class="intro">${esc(spec.intro)}</p><ul>${(spec.changes || []).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>${spec.needsYou ? `<p class="needs"><b>Needs you:</b> ${esc(spec.needsYou)}</p>` : ''}</div>`));
    },
    end(spec) {
      input.disabled = true;
      push(el(`<div class="card end"><h3>${esc(spec.headline)}</h3><p>${esc(spec.body)}</p><div class="row"><a class="btn" href="#">Try another scene</a><a class="btn primary" href="${spec.cta || 'https://www.kickstarter.com/projects/neucharbox/neucharbox-ai-operating-system-for-the-physical-world?ref=demo'}" target="_blank" rel="noopener">Back on Kickstarter</a></div></div>`));
    },
  };
}
