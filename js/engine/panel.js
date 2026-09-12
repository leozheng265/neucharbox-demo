// Device dashboard: one tile per device (icon + name + state), rendered from the store.
// Tone: offline (grey, dimmed) · idle (grey icon) · on (amber) · busy (blue) · bad (red).
import { icon } from './icons.js';

const looksActive = (s) => !!(s.on || s.running || s.armed || s.active || s.pressed || s.moving || s.state === 'moving' || (s.open > 0.5) || (s.brightness > 0.02) || s.shutter === 'open' || s.light === 'green' || s.scene === 'live' || s.scene === 'recording' || (s.muted === false));

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
  function render(state) {
    for (const id of ids) {
      const s = state[id], d = scene.devices[id], c = cards[id];
      const tone = s.status === 'offline' ? 'offline' : s.status === 'fault' ? 'bad' : s.status === 'busy' ? 'busy' : (d.active ? d.active(s, state) : looksActive(s)) ? 'on' : 'idle';
      for (const t of ['offline', 'bad', 'busy', 'on', 'idle']) c.classList.toggle(t, t === tone);
      c.querySelector('.val').textContent = s.status === 'offline' ? 'not connected' : s.status === 'fault' ? (d.faultText || 'unavailable') : d.format(s, state);
    }
  }
  function select(id) { for (const c of Object.values(cards)) c.classList.toggle('selected', c.dataset.id === id); if (id) { cards[id]?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); clearTimeout(select.t); select.t = setTimeout(() => cards[id]?.classList.remove('selected'), 2500); } }
  function pop(id) { const c = cards[id]; if (!c) return; c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop'); c.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); }
  store.subscribe(render); render(store.state);
  return { select, render, pop };
}
