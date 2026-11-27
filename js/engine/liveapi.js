// Live demo: the API client (wire contract: the NeuCharBox Live module's docs/live-api-contract.md, interface-only
// version of 2026-11-24: no model, no requests; device actions, fault planting, hand edits and the clock).
// Every request sends ngrok-skip-browser-warning. No route needs an Authorization header: live mode is open to anyone
// the server lets in (it answers 429 global_limit when it is full).

export class LiveError extends Error {
  constructor(status, kind, message, detail) {
    super(message || 'The live server hit a problem. Please try again.');
    this.name = 'LiveError'; this.status = status; this.kind = kind;
    if (detail !== undefined) this.detail = detail; // bad_value: the arg validator's sentence
  }
}

export function createLiveApi({ base, fetch: doFetch = globalThis.fetch, timeoutMs = 10000 } = {}) {
  const root = `${String(base || '').replace(/\/+$/, '')}/live/api/`;
  const isJson = (res) => /^application\/json\s*(;|$)/i.test(res.headers.get('content-type') || '');

  // One call: its own AbortController and timer (setTimeout, so test clocks apply). Throws LiveError.
  async function call(method, path, { body, ms = timeoutMs } = {}) {
    const ctl = new AbortController();
    let timer, timedOut = false;
    const timeout = new Promise((_, rej) => { timer = setTimeout(() => { timedOut = true; ctl.abort(); rej(new LiveError(0, 'network')); }, ms); });
    const headers = { 'ngrok-skip-browser-warning': '1' };
    const init = { method, headers, signal: ctl.signal };
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    try {
      const run = (async () => {
        let res;
        try { res = await doFetch(root + path, init); } catch { throw new LiveError(0, 'network'); }
        if (!isJson(res)) throw new LiveError(res.status, 'bad_response');
        let data;
        try { data = await res.json(); } catch { throw new LiveError(res.status, 'bad_response'); }
        if (!res.ok) {
          throw new LiveError(res.status, typeof data?.error === 'string' ? data.error : 'bad_response', typeof data?.message === 'string' ? data.message : undefined,
            typeof data?.detail === 'string' ? data.detail : undefined);
        }
        return data;
      })();
      run.catch(() => {}); // a late failure after a timeout is not unhandled
      return await Promise.race([run, timeout]);
    } catch (e) {
      if (timedOut) throw new LiveError(0, 'network');
      throw e;
    } finally { clearTimeout(timer); }
  }
  const enc = encodeURIComponent;
  const sess = (sid, rest) => `sessions/${enc(sid)}/${rest}`;

  return {
    async health() {
      const off = { ok: false, liveEnabled: false, scenes: [] };
      try {
        const d = await call('GET', 'health', { ms: 4000 });
        if (d?.ok !== true) return off;
        return { ok: true, liveEnabled: d.liveEnabled === true, scenes: Array.isArray(d.scenes) ? d.scenes : [] };
      } catch { return off; }
    },
    createSession: (scene, extra = {}) => call('POST', 'sessions', { body: { scene, ...extra } }),
    devices: (sid) => call('GET', sess(sid, 'devices')),
    // Watch a room: every live session on the server (most recently active first) and one session's current room with
    // the event id to stream from.
    listSessions: (scene) => call('GET', `sessions${scene ? `?scene=${enc(scene)}` : ''}`),
    session: (sid) => call('GET', `sessions/${enc(sid)}`),
    // An action answers once its frames have played (paced like the device), so it gets the advance's long timeout.
    action: (sid, id, verb, args = {}) => call('POST', sess(sid, `devices/${enc(id)}/actions/${enc(verb)}`), { body: args ?? {}, ms: 40000 }),
    plantFault: (sid, device, mode) => call('POST', sess(sid, 'faults'), { body: mode ? { device, mode } : { device } }),
    clearFaults: (sid) => call('POST', sess(sid, 'faults/clear')),
    set: (sid, path, value) => call('POST', sess(sid, 'set'), { body: { path, value } }),
    advance: (sid, hours) => call('POST', sess(sid, 'advance'), { body: { hours }, ms: 40000 }),
    reset: (sid) => call('POST', sess(sid, 'reset'), { body: {} }),
    eventsUrl: (sid, after) => `${root}sessions/${enc(sid)}/events${after ? `?after=${Number(after)}` : ''}`,
    headers: () => ({ 'ngrok-skip-browser-warning': '1', Accept: 'text/event-stream' }),
  };
}
