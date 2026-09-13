// Reading a scene's source for the static checks (test/run.mjs check 6): a small JavaScript lexer that knows comments,
// strings, template literals (with ${…} inside) and regular expressions, enough to find the scene's build() method
// and every piece of text the scene could show.

// Tokens: { t: 'word' | 'punct' | 'str' | 'tpl' | 're' | 'num', v, a, b } (v: the text; for str/tpl the literal's
// characters, template parts joined by a space where the ${…} were; a..b: the source range).
export function lex(src) {
  const out = []; let i = 0; const n = src.length;
  const KW = /^(?:return|typeof|case|do|else|in|of|void|yield|await|new|delete|throw|instanceof)$/;
  const regexCan = () => { const p = out[out.length - 1]; return !p || (p.t === 'punct' && !/^[)\]}]$/.test(p.v)) || (p.t === 'word' && KW.test(p.v)); };
  function template() { // at the opening backtick; returns the literal text, i past the closing one
    let s = ''; i++;
    while (i < n && src[i] !== '`') {
      if (src[i] === '\\') { s += src[i + 1] ?? ''; i += 2; continue; }
      if (src[i] === '$' && src[i + 1] === '{') { i += 2; s += ' '; code(true); i++; continue; }
      s += src[i++];
    }
    i++; return s;
  }
  function code(inBraces = false) { // tokens until the matching '}' (inBraces) or the end
    let depth = 0;
    while (i < n) {
      const c = src[i];
      if (c === '/' && src[i + 1] === '/') { const j = src.indexOf('\n', i); i = j < 0 ? n : j; continue; }
      if (c === '/' && src[i + 1] === '*') { const j = src.indexOf('*/', i + 2); i = j < 0 ? n : j + 2; continue; }
      if (c === '"' || c === "'") { const a = i; let s = ''; i++; while (i < n && src[i] !== c && src[i] !== '\n') { if (src[i] === '\\') { s += src[i + 1] ?? ''; i += 2; } else s += src[i++]; } i++; out.push({ t: 'str', v: s, a, b: i }); continue; }
      if (c === '`') { const a = i; const s = template(); out.push({ t: 'tpl', v: s, a, b: i }); continue; }
      if (c === '/' && regexCan()) { const a = i; let cls = false; i++; while (i < n && src[i] !== '\n') { const ch = src[i]; if (ch === '\\') { i += 2; continue; } if (ch === '[') cls = true; else if (ch === ']') cls = false; else if (ch === '/' && !cls) break; i++; } i++; while (i < n && /[a-z]/i.test(src[i])) i++; out.push({ t: 're', v: src.slice(a, i), a, b: i }); continue; }
      if (/\s/.test(c)) { i++; continue; }
      if (/[A-Za-z_$]/.test(c)) { const a = i; while (i < n && /[\w$]/.test(src[i])) i++; out.push({ t: 'word', v: src.slice(a, i), a, b: i }); continue; }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1]))) { const a = i; while (i < n && /[\w.]/.test(src[i])) i++; out.push({ t: 'num', v: src.slice(a, i), a, b: i }); continue; }
      if (inBraces) { if (c === '{') depth++; else if (c === '}') { if (depth === 0) return; depth--; } }
      out.push({ t: 'punct', v: c, a: i, b: i + 1 }); i++;
    }
  }
  code(false);
  return out;
}

// The source range of the scene's build() method (the room: it may use timers and store hooks of its own), or null.
function buildRange(toks) {
  for (let k = 0; k < toks.length - 1; k++) {
    if (!(toks[k].t === 'word' && toks[k].v === 'build' && toks[k + 1].v === '(')) continue;
    const prev = toks[k - 1]; if (prev && prev.v === '.') continue; // a call, not the method
    let d = 0, j = k + 1; for (; j < toks.length; j++) { if (toks[j].v === '(') d++; else if (toks[j].v === ')' && --d === 0) break; }
    if (toks[j + 1]?.v !== '{') continue;
    d = 0; let e = j + 1; for (; e < toks.length; e++) { if (toks[e].v === '{') d++; else if (toks[e].v === '}' && --d === 0) break; }
    return [toks[k].a, toks[e]?.b ?? toks[toks.length - 1].b];
  }
  return null;
}

// What check 6 reads of a scene file: everything but its build() method, as tokens.
export function sceneSource(src) {
  const toks = lex(src), r = buildRange(toks);
  const keep = r ? toks.filter((x) => x.b <= r[0] || x.a >= r[1]) : toks;
  // Raw timers and store tweens: setTimeout( … ), store.tween( … ) (ctx.store.tween too).
  const raw = [];
  keep.forEach((x, k) => {
    if (x.t === 'word' && x.v === 'setTimeout' && keep[k + 1]?.v === '(' && keep[k - 1]?.v !== '.') raw.push('setTimeout(');
    if (x.t === 'word' && x.v === 'store' && keep[k + 1]?.v === '.' && keep[k + 2]?.v === 'tween' && keep[k + 3]?.v === '(') raw.push('store.tween(');
  });
  return { raw, texts: keep.filter((x) => x.t === 'str' || x.t === 'tpl').map((x) => x.v), build: !!r };
}
