#!/usr/bin/env node
// Fake cc-anchor anchor.mjs for tests: paths / set / cursor install / doctor.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const args = process.argv.slice(2);
const ri = args.indexOf('--root');
const root = ri >= 0 ? args[ri + 1] : process.cwd();
const pos = args.filter((a, i) => !a.startsWith('--') && !(ri >= 0 && i === ri + 1));
const card = path.join(root, '.claude', 'anchor.md');
const cursorFile = path.join(root, '.claude', 'cc-anchor', 'cursor');
const EVENTS = ['sessionStart', 'preCompact', 'postToolUse', 'preToolUse', 'stop', 'subagentStop'];
const [cmd, a, ...rest] = pos;
if (cmd === 'paths') { console.log(JSON.stringify({ root, card, cursorFile })); process.exit(0); }
if (cmd === 'set') {
  fs.mkdirSync(path.dirname(card), { recursive: true });
  const cur = fs.existsSync(card) ? fs.readFileSync(card, 'utf8') : '# ANCHOR\nProject: (unset)\nGoal: (unset)\n';
  const key = a === 'goal' ? 'Goal' : 'Project';
  fs.writeFileSync(card, cur.replace(new RegExp(`^${key}: .*$`, 'm'), `${key}: ${rest.join(' ')}`));
  process.exit(0);
}
if (cmd === 'cursor' && a === 'install') {
  const base = path.join(root, '.cursor');
  const dest = path.join(base, 'hooks', 'cc-anchor', 'scripts');
  fs.mkdirSync(dest, { recursive: true });
  fs.copyFileSync(fileURLToPath(import.meta.url), path.join(dest, 'anchor.mjs'));
  fs.writeFileSync(path.join(base, 'hooks', 'cc-anchor', 'adapter.sh'), '#!/bin/sh\n');
  const hf = path.join(base, 'hooks.json');
  const j = fs.existsSync(hf) ? JSON.parse(fs.readFileSync(hf, 'utf8')) : { version: 1, hooks: {} };
  j.hooks = j.hooks || {};
  for (const ev of EVENTS) j.hooks[ev] = (j.hooks[ev] || []).filter((h) => !/cc-anchor\/adapter\.sh/.test(h.command)).concat([{ command: `bash .cursor/hooks/cc-anchor/adapter.sh ${ev}` }]);
  fs.writeFileSync(hf, JSON.stringify(j, null, 2) + '\n');
  process.exit(0);
}
if (cmd === 'doctor') {
  const cfg = path.join(root, '.claude', 'cc-anchor.json');
  const c = fs.existsSync(cfg) ? JSON.parse(fs.readFileSync(cfg, 'utf8')) : {};
  const cur = fs.existsSync(cursorFile) ? fs.readFileSync(cursorFile, 'utf8').trim() : 'none';
  console.log(JSON.stringify({ card: `${card} ${fs.existsSync(card) ? '(present)' : '(missing)'}`, cursor: cur, config: Object.entries(c).map(([k, v]) => `${k}=${v}`).join(' ') || 'all defaults' }));
  process.exit(0);
}
console.error(`fake anchor: ${args.join(' ')}`); process.exit(2);
