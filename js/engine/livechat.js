// Live demo: the chat side of live mode (the LiveView js/engine/live.js is written against): the offline card, short
// NCB lines, the lost-connection card, and the input bar, which in live mode is a disabled placeholder for a future NCB
// terminal: nothing typed there goes anywhere. Server text is inserted as text.
import { LIVE_COPY } from './live.js';
import { socialLinks } from './social.js';

const parse = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

export function createLiveView({ chat }) {
  const { esc } = chat;
  const mount = (node, opts) => chat.mount(node, opts);

  // ---- the offline card: why live mode can't open here, the follow links, and Back ----
  function offline({ text, backLabel }, { onBack }) {
    const node = parse(`<div class="card live-off"><p class="intro">${esc(text ?? LIVE_COPY.offline)}</p><div class="follow">${socialLinks({ labels: true })}</div><button class="lnk back" type="button">${esc(backLabel ?? LIVE_COPY.back)}</button></div>`);
    node.querySelector('.back').onclick = () => onBack();
    mount(node);
    return {
      close() {
        node.classList.add('done');
        if (node.contains(document.activeElement)) node.closest('.chat-log')?.focus({ preventScroll: true });
        node.querySelectorAll('button').forEach((x) => (x.disabled = true));
      },
    };
  }

  return {
    ncb: (text) => chat.ncb(text),
    offline,
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
