#!/usr/bin/env node
// Refresh each plugin's bundled skill from the npm package version pinned in
// its .mcp.json. Both upstream packages ship `skills/` in their npm tarball,
// so the pinned package is the source of truth and the copy can't drift from
// the server version the plugin actually launches.
//
//   node scripts/sync-skills.mjs            # rewrite skills/ in every plugin
//   node scripts/sync-skills.mjs --check    # exit 1 if any copy differs
//
// Needs `npm` on PATH and network access to the npm registry.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, cpSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const LAUNCHERS = new Set(['npx', 'bunx']);
let drift = 0;

function pinnedPackages(pluginDir) {
  const mcpPath = join(pluginDir, '.mcp.json');
  if (!existsSync(mcpPath)) return [];
  const { mcpServers = {} } = JSON.parse(readFileSync(mcpPath, 'utf8'));
  return Object.values(mcpServers)
    .filter((s) => LAUNCHERS.has(s.command))
    .map((s) => (s.args ?? []).find((a) => !a.startsWith('-')))
    .filter(Boolean);
}

function listFiles(dir, base = dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) listFiles(p, base, out);
    else out.push(p.slice(base.length + 1));
  }
  return out.sort();
}

for (const name of readdirSync(join(root, 'plugins'))) {
  const pluginDir = join(root, 'plugins', name);
  for (const spec of pinnedPackages(pluginDir)) {
    const work = mkdtempSync(join(tmpdir(), 'isokron-sync-'));
    try {
      const tarball = execFileSync('npm', ['pack', spec, '--pack-destination', work, '--silent'], { encoding: 'utf8' }).trim().split('\n').pop();
      execFileSync('tar', ['-xzf', join(work, tarball), '-C', work]);
      const upstream = join(work, 'package', 'skills');
      if (!existsSync(upstream)) { console.log(`${name}: ${spec} ships no skills/, skipped`); continue; }
      const local = join(pluginDir, 'skills');
      const want = listFiles(upstream);
      const have = existsSync(local) ? listFiles(local) : [];
      const differs = want.join('\n') !== have.join('\n') || want.some((f) => readFileSync(join(upstream, f), 'utf8') !== readFileSync(join(local, f), 'utf8'));
      if (!differs) { console.log(`${name}: skills in sync with ${spec}`); continue; }
      drift++;
      if (check) { console.log(`${name}: skills DIFFER from ${spec}`); continue; }
      rmSync(local, { recursive: true, force: true });
      cpSync(upstream, local, { recursive: true });
      console.log(`${name}: skills refreshed from ${spec} (${want.join(', ')})`);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
}

if (check && drift) process.exit(1);
