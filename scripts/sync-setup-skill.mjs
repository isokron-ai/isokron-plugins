#!/usr/bin/env node
// The isokron-setup skill has one source of truth, `skills/isokron-setup/`
// (the standalone Agent Skill that `npx skills add` installs). The plugin
// bundles a byte-identical copy at `plugins/isokron-setup/skills/isokron-setup/`
// because the directory refuses symlinks. Its two bundled skill assets are in
// turn copies of the kronicle-lite / sea-lite plugin skills.
//
//   node scripts/sync-setup-skill.mjs           # refresh the copies
//   node scripts/sync-setup-skill.mjs --check   # exit 1 on any drift

import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const pairs = [
  [join(root, 'plugins/kronicle-lite/skills/orient/SKILL.md'), join(root, 'skills/isokron-setup/assets/orient-SKILL.md')],
  [join(root, 'plugins/sea-lite/skills/work-queue/SKILL.md'), join(root, 'skills/isokron-setup/assets/work-queue-SKILL.md')],
  [join(root, 'skills/isokron-setup'), join(root, 'plugins/isokron-setup/skills/isokron-setup')],
];

function files(dir, base = dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) files(p, base, out);
    else out.push(p.slice(base.length + 1));
  }
  return out.sort();
}
function differs(src, dst) {
  if (!existsSync(dst)) return ['(missing)'];
  if (statSync(src).isFile()) return readFileSync(src).equals(readFileSync(dst)) ? [] : [dst];
  const a = files(src);
  const b = files(dst);
  const out = [...a.filter((f) => !b.includes(f)).map((f) => `missing ${f}`), ...b.filter((f) => !a.includes(f)).map((f) => `extra ${f}`)];
  for (const f of a) if (b.includes(f) && !readFileSync(join(src, f)).equals(readFileSync(join(dst, f)))) out.push(`differs ${f}`);
  return out;
}

let drift = 0;
for (const [src, dst] of pairs) {
  const d = differs(src, dst);
  if (!d.length) { console.log(`ok     ${dst.slice(root.length + 1)}`); continue; }
  if (check) { drift++; console.log(`DRIFT  ${dst.slice(root.length + 1)}: ${d.join(', ')}`); continue; }
  if (statSync(src).isDirectory()) rmSync(dst, { recursive: true, force: true });
  cpSync(src, dst, { recursive: true });
  console.log(`synced ${dst.slice(root.length + 1)}`);
}
if (drift) { console.log(`\n${drift} copy(ies) drifted; run node scripts/sync-setup-skill.mjs`); process.exit(1); }
