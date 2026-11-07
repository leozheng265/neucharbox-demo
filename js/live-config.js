// Live AI demo: where the live API lives. Empty apiBase = live mode isn't offered at all.
export const LIVE_CONFIG = { apiBase: '' };

// The API base for this page. `?liveApi=` overrides it only for http://localhost:* and http://127.0.0.1:*, so a
// crafted link can't point a stored invite code at another host. A trailing "/" is dropped.
export function liveApiBase(loc = globalThis.location) {
  try {
    const raw = new URLSearchParams(loc?.search || '').get('liveApi');
    if (raw) {
      const u = new URL(raw);
      if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return u.origin + u.pathname.replace(/\/+$/, '');
    }
  } catch { /* not a URL: ignore */ }
  return String(LIVE_CONFIG.apiBase || '').replace(/\/+$/, '');
}
