// Live demo: the chat side of live mode (the LiveView js/engine/live.js is written against): the access card (invite
// code, application, or offline), short NCB lines, the lost-connection card, and the input bar, which in live mode is a
// disabled placeholder for a future NCB terminal: nothing typed there goes anywhere. Server text is inserted as text.
import { LIVE_COPY } from './live.js';
import { socialLinks } from './social.js';

const INTERESTS = [['home', 'Home'], ['lab', 'Lab'], ['warehouse', 'Warehouse'], ['business', 'Business'], ['other', 'Something else']];

const parse = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const mk = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

export function createLiveView({ chat, scene }) {
  const { esc } = chat;
  const mount = (node, opts) => chat.mount(node, opts);

  // ---- access: invite code, application, or offline ----
  function access({ mode, note, backLabel, offlineText }, { onCode, onApply, onBack }) {
    const offline = mode === 'offline';
    const labelled = (text, control) => `<label class="fld"><span>${esc(text)}</span>${control}</label>`;
    const body = offline
      ? `<p class="intro">${esc(offlineText ?? LIVE_COPY.offline)}</p><div class="follow">${socialLinks({ labels: true })}</div>`
      : `<p class="intro">${esc(LIVE_COPY.accessIntro)}</p>${note ? `<p class="anote">${esc(note)}</p>` : ''}
         <form class="code" novalidate><input name="code" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="40" aria-label="Invite code" placeholder="Invite code"><button class="btn primary go" type="submit">Enter</button></form>
         <button class="lnk apply-open" type="button" aria-expanded="false">Apply for access</button>
         <form class="apply" hidden>
           ${labelled('Email', '<input name="email" type="email" required maxlength="200" autocomplete="email" aria-describedby="apply-use">')}
           <p class="use" id="apply-use">${esc(LIVE_COPY.applyEmailUse)}</p>
           ${labelled('Name (optional)', '<input name="name" type="text" maxlength="100" autocomplete="name">')}
           ${labelled("I'm interested in", `<select name="interest">${INTERESTS.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('')}</select>`)}
           ${labelled('What would you try?', '<textarea name="wouldTry" rows="2" required maxlength="400"></textarea>')}
           <div class="hp" aria-hidden="true"><label>Website<input name="website" type="text" tabindex="-1" autocomplete="off"></label></div>
           <button class="btn primary send" type="submit">Send application</button>
         </form>`;
    let codeInput = null;
    const node = parse(`<div class="card access${offline ? ' offline' : ''}">${body}${offline ? '' : '<p class="err" role="alert" hidden></p>'}<button class="lnk back" type="button">${esc(backLabel ?? LIVE_COPY.back)}</button></div>`);
    node.querySelector('.back').onclick = () => onBack();
    if (!offline) {
      const err = node.querySelector('.err'), codeForm = node.querySelector('form.code'), applyForm = node.querySelector('form.apply');
      codeInput = codeForm.elements.code;
      const say = (t) => { err.textContent = t || ''; err.hidden = !t; };
      // One answer in flight per form; a rejected handler reads as offline.
      const run = async (form, fn) => {
        if (form.dataset.busy || node.classList.contains('done')) return;
        form.dataset.busy = '1'; form.querySelectorAll('button[type=submit]').forEach((b) => (b.disabled = true)); say('');
        let r = null;
        try { r = await fn(); } catch { r = LIVE_COPY.offline; }
        delete form.dataset.busy;
        if (node.classList.contains('done')) return;
        form.querySelectorAll('button[type=submit]').forEach((b) => (b.disabled = false));
        return r;
      };
      codeForm.onsubmit = async (e) => {
        e.preventDefault();
        const r = await run(codeForm, () => onCode(codeForm.elements.code.value));
        if (r) say(r); else codeInput.value = ''; // the code never stays on the page
      };
      node.querySelector('.apply-open').onclick = (e) => {
        applyForm.hidden = !applyForm.hidden; e.currentTarget.setAttribute('aria-expanded', String(!applyForm.hidden));
        if (!applyForm.hidden) applyForm.elements.email.focus({ preventScroll: true });
      };
      const pre = ['home', 'lab', 'warehouse'].includes(scene.id) ? scene.id : 'other';
      applyForm.elements.interest.value = pre;
      applyForm.onsubmit = async (e) => {
        e.preventDefault();
        if (!applyForm.reportValidity()) return;
        const f = applyForm.elements;
        const r = await run(applyForm, () => onApply({ email: f.email.value.trim(), name: f.name.value.trim(), interest: f.interest.value, wouldTry: f.wouldTry.value.trim(), website: f.website.value }));
        if (r === LIVE_COPY.applied) { const p = mk('p', 'applied', r); p.setAttribute('role', 'status'); applyForm.replaceWith(p); node.querySelector('.apply-open').hidden = true; say(''); }
        else if (r) say(r);
      };
    }
    mount(node);
    return {
      close() {
        node.classList.add('done');
        if (codeInput) codeInput.value = '';
        if (node.contains(document.activeElement)) node.closest('.chat-log')?.focus({ preventScroll: true });
        node.querySelectorAll('button, input, select, textarea').forEach((x) => (x.disabled = true));
      },
    };
  }

  return {
    ncb: (text) => chat.ncb(text),
    access,
    lost(onReconnect) {
      chat.ncb(LIVE_COPY.lost);
      chat.button(LIVE_COPY.reconnect).then(() => onReconnect());
    },
    // Live mode on: the input bar becomes the NCB terminal's placeholder, disabled (chat.js keeps it off while live).
    live(on) {
      chat.live(on, { placeholder: LIVE_COPY.terminal, label: LIVE_COPY.terminalLabel });
      chat.enableInput(false);
    },
  };
}
