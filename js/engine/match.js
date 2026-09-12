// Map free text to the nearest authored prompt by keyword overlap.
const STOP = new Set('a an the i my me it is to and or of in on at for with be please can you make let while when if do dont don\'t not this that its im i\'m'.split(' '));

export function tokens(text) {
  return String(text).toLowerCase().replace(/(^|[^\d.])\.(\d)/g, '$10.$2').replace(/°[cf]\b/g, '°').replace(/[’']/g, '').replace(/[^a-z0-9°.\s]/g, ' ').replace(/\.(?!\d)/g, ' ').replace(/(^|\s)\./g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));
}

export function matchPrompt(text, prompts) {
  const q = new Set(tokens(text));
  if (q.size === 0) return { prompt: prompts[0], score: 0 };
  let best = null, bestScore = 0;
  for (const p of prompts) {
    const bag = new Set([...tokens(p.chip), ...(p.keywords || []).flatMap(tokens)]);
    let score = 0;
    for (const w of q) { if (bag.has(w)) score += 1; else for (const b of bag) if (b.length > 4 && (b.startsWith(w) || w.startsWith(b))) { score += 0.5; break; } }
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return { prompt: best || prompts[0], score: bestScore };
}

// True when the visitor's text negates something the chip does not (e.g. "don't go live" vs "Go live.").
const NEG = /\b(?:not|never|dont|don't|do not|stop not|no longer|without)\b/;
const norm = (t) => String(t).toLowerCase().replace(/’/g, "'");
export function negates(text, chip) { return /\b(?:not|never|dont|don't)\b/.test(norm(text)) && !NEG.test(norm(chip)); }
