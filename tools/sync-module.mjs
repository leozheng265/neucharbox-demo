// Copies the demo into the NCF module that serves it: node tools/sync-module.mjs [--check] <module dir>
//   <module dir> is Senparc.Xncf.NeuCharBoxLive in NcfPackageSources; the copy goes to its LiveDemo/ folder (embedded in
//   the module and served at /live/demo/ on the NCF site). Only what the page loads is copied: index.html, css/, js/ and
//   vendor/. js/live-config.js gets the module's API base (the site the page came from) in place of the public page's
//   empty one. Files no longer in the demo are removed. With --check it writes nothing and exits 1 if the copy differs.
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const check = args.includes('--check');
const moduleDir = args.find((a) => !a.startsWith('--'));
if (!moduleDir) { console.error('usage: node tools/sync-module.mjs [--check] <module dir>'); process.exit(2); }
if (!existsSync(join(moduleDir, 'Senparc.Xncf.NeuCharBoxLive.csproj'))) { console.error(`${moduleDir} is not the Senparc.Xncf.NeuCharBoxLive module folder`); process.exit(2); }

const root = fileURLToPath(new URL('..', import.meta.url));
const dest = join(moduleDir, 'LiveDemo');
const PARTS = ['index.html', 'css', 'js', 'vendor'];
const CONFIG = 'js/live-config.js';
const PUBLIC_LINE = "export const LIVE_CONFIG = { apiBase: '' };";
// The page is at <site>/live/demo/, the API at <site>/live/api: two folders up is the site, under any path base.
export const MODULE_LINE = "export const LIVE_CONFIG = { apiBase: new URL('../../', globalThis.location.href).href };";

const walk = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const rel = (base, p) => relative(base, p).split(sep).join('/');
const files = PARTS.flatMap((p) => { const full = join(root, p); return statSync(full).isDirectory() ? walk(full) : [full]; }).map((p) => rel(root, p)).sort();

function content(name) {
  const buf = readFileSync(join(root, name));
  if (name !== CONFIG) return buf;
  const text = buf.toString('utf8');
  if (!text.includes(PUBLIC_LINE)) { console.error(`${CONFIG} has no line "${PUBLIC_LINE}": update tools/sync-module.mjs`); process.exit(2); }
  return Buffer.from(text.replace(PUBLIC_LINE, MODULE_LINE), 'utf8');
}

const have = existsSync(dest) ? walk(dest).map((p) => rel(dest, p)).sort() : [];
const stale = have.filter((n) => !files.includes(n));
const changed = files.filter((n) => { const d = join(dest, n); return !existsSync(d) || !readFileSync(d).equals(content(n)); });

if (check) {
  if (stale.length || changed.length) {
    console.error(`the module's LiveDemo copy differs from the demo (${changed.length} to write, ${stale.length} to remove): run node tools/sync-module.mjs <module dir>`);
    for (const n of [...changed, ...stale].slice(0, 20)) console.error(`  ${n}`);
    process.exit(1);
  }
  console.log(`module copy matches (${files.length} files)`);
} else {
  for (const n of stale) rmSync(join(dest, n));
  for (const n of changed) { const d = join(dest, n); mkdirSync(dirname(d), { recursive: true }); writeFileSync(d, content(n)); }
  console.log(`LiveDemo: ${files.length} files, ${changed.length} written, ${stale.length} removed`);
}
