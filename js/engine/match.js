// Typed requests → authored prompts. The demo is scripted, so it never guesses: a request is run only when it
// clearly matches a chip; a negated request ("don't go live") is refused rather than turned into its opposite;
// vague text or a question it can't answer gets the chips back. main.js and the tests both use interpret().

const STOP = new Set('a an the i my me it is to and or of in on at for with be please can you make let while when if do dont not this that its im keep like she her'.split(' '));

export function tokens(text) {
  return String(text).toLowerCase()
    .replace(/[’']/g, '')
    .replace(/(^|[^\d.])\.(\d)/g, '$10.$2').replace(/°[cf]\b/g, '°')          // ".05" → "0.05", "21°C" → "21°"
    .replace(/[^a-z0-9°.\s]/g, ' ')
    .replace(/\.(?!\d)/g, ' ').replace(/(^|\s)\./g, ' ')                        // sentence dots, keep decimals
    .replace(/\b(turn|switch|shut)\s+((?:[a-z0-9]+\s+){0,2}?)(on|off)\b/g, '$1$3 $2') // "turn the sign off" → "turnoff sign"
    .replace(/\bgo\s+live\b/g, 'golive')
    .split(/\s+/).filter((w) => w && !STOP.has(w));
}

export function matchPrompt(text, prompts) {
  const q = new Set(tokens(text));
  if (q.size === 0) return { prompt: prompts[0], score: 0 };
  let best = null, bestScore = 0;
  for (const p of prompts) {
    const bag = new Set([...tokens(p.chip), ...(p.keywords || []).flatMap(tokens)]);
    let score = 0;
    for (const w of q) {
      if (bag.has(w)) score += 1;
      else for (const b of bag) if (b.length > 4 && ((w.length > 3 && b.startsWith(w)) || w.startsWith(b))) { score += 0.5; break; }
    }
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return { prompt: best || prompts[0], score: bestScore };
}

const norm = (t) => String(t).trim().toLowerCase().replace(/’/g, "'");
const CHIP_NEG = /\b(?:not|never|dont|don't|do not|no longer|without)\b/;
const SKIP = new Set(['be', 'been', 'being', 'to', 'a', 'an', 'the', 'it', 'so', 'too', 'even', 'ever', 'really', 'yet', 'just']);
const COND = new Set(['if', 'when', 'whenever', 'unless', 'whether', 'until']);
const LEAD = new Set(['please', 'i', 'we', "i'm", "we're", 'im', 'were', 'just', 'really', 'and', 'so', 'then', 'actually', 'but', 'no', 'ok', 'okay', 'oh', 'hey', 'wait']);
// Chip verb → words that ask for the opposite (unless the text also asks for the verb: "open it, then close it").
const OPPOSITE = [[/\bopen\b/, /\b(?:close|closed|shut|block|off)\b/, /\bopen\b/]];

// True when the text asks for the opposite of `chip`: a negation at the start ("don't go live", "do not open…"),
// before want/need ("I really don't want to go live"), or right before one of the chip's own words ("we're not
// going live"). Not after if/when ("tell me if she's not up"), not before let/forget/allow ("don't let my plants
// die"), and never when the chip itself carries a negation ("…without a camera"). With chip = '' only the first
// two forms count (used when nothing matched).
export function negates(text, chip) {
  const c = norm(chip), t = norm(text);
  for (const [verb, opp, same] of OPPOSITE) if (verb.test(c) && opp.test(t) && !same.test(t)) return true;
  if (c && CHIP_NEG.test(c)) return false;
  const w = t.replace(/\bdo\s+not\b/g, 'dont').replace(/\bdon'?t\b/g, 'dont').split(/[^a-z0-9']+/).filter(Boolean);
  const chipWords = c.replace(/['’]/g, '').split(/[^a-z0-9]+/).filter((x) => x && !STOP.has(x)); // plain words ("go", "live"), not merged tokens
  for (let i = 0; i < w.length; i++) {
    if (!/^(?:not|never|dont)$/.test(w[i]) || /^(?:let|forget|allow)$/.test(w[i + 1] || '')) continue;
    if (w.slice(0, i).every((x) => LEAD.has(x))) return true;
    if (w.slice(0, i).some((x) => COND.has(x))) continue;
    const next = w.slice(i + 1).find((x) => !SKIP.has(x)) || ''; const tk = tokens(next)[0];
    if (/^(?:want|need|wanna)$/.test(next) || (tk && chipWords.some((b) => b === tk || (b.length > 1 && tk.startsWith(b))))) return true;
  }
  return false;
}

const QUESTION = /^(?:what(?!\s+if\b)|what's|whats|how|why|is|are|does|who|where|which)\b/; // "what if she…" is a request
const CLAUSE = /\s*(?:[,;.!?—–]|\b(?:just|but|instead|rather)\b)\s*/;

// Decide what to do with typed text: { action: 'run' | 'refuse' | 'clarify', prompt, score, via? }.
export function interpret(text, prompts) {
  const m = matchPrompt(text, prompts);
  if (negates(text, m.score > 0 ? m.prompt.chip : '')) {
    // "I don't want to stream tonight, just record": act on a later clause that isn't itself negated
    const parts = norm(text).split(CLAUSE).filter(Boolean);
    for (let i = parts.length - 1; i > 0; i--) { const mm = matchPrompt(parts[i], prompts); if (mm.score >= 1 && !negates(parts[i], mm.prompt.chip)) return { action: 'run', prompt: mm.prompt, score: mm.score, via: 'clause' }; }
    return { action: 'refuse', prompt: m.prompt, score: m.score };
  }
  if (m.score < 1 || (QUESTION.test(norm(text)) && m.score < 2)) return { action: 'clarify', prompt: m.prompt, score: m.score };
  return { action: 'run', prompt: m.prompt, score: m.score };
}
