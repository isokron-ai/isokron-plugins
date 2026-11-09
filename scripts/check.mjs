#!/usr/bin/env node
// Static checks for this marketplace, mirroring what the Claude directory's
// pre-submission checklist says validation refuses or warns on. Run from any
// cwd: `node scripts/check.mjs`. Exit 1 on any blocking finding.
//
// `claude plugin validate --strict --profile directory ./plugins/<name>` is
// the authoritative check; this script exists so CI without the Claude CLI
// still catches the obvious regressions (bad JSON, unpinned npx, missing
// directory fields, skill drift from the pinned npm version).

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const warnings = [];
const fail = (m) => problems.push(m);
const warn = (m) => warnings.push(m);

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    fail(`${path}: not valid JSON (${e.message})`);
    return null;
  }
}

const NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const HTTPS_RE = /^https:\/\/\S+$/;
const PIN_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*@\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const LAUNCHERS = new Set(['npx', 'bunx', 'uvx', 'pipx']);

// ---- marketplace.json ------------------------------------------------------
const mpPath = join(root, '.claude-plugin', 'marketplace.json');
const mp = existsSync(mpPath) ? readJson(mpPath) : (fail(`${mpPath}: missing`), null);
const entries = [];
if (mp) {
  if (typeof mp.name !== 'string' || !mp.name) fail('marketplace.json: name is required');
  if (!mp.owner || typeof mp.owner.name !== 'string') fail('marketplace.json: owner.name is required');
  if (!Array.isArray(mp.plugins) || mp.plugins.length === 0) fail('marketplace.json: plugins[] is required');
  if (!mp.description && !mp.metadata?.description) warn('marketplace.json: no description');
  for (const e of mp.plugins ?? []) {
    if (typeof e.name !== 'string' || !e.name) { fail('marketplace.json: a plugin entry has no name'); continue; }
    if (typeof e.source !== 'string' || !e.source.startsWith('./')) fail(`marketplace.json[${e.name}]: source must be a ./relative path into this repo`);
    if (e.source?.includes('..')) fail(`marketplace.json[${e.name}]: source contains ".."`);
    if ('version' in e) warn(`marketplace.json[${e.name}]: entry sets version; plugin.json wins and the CLI warns`);
    for (const k of ['icon', 'documentationUrl', 'supportUrl', 'privacyPolicyUrl', 'termsOfServiceUrl']) {
      if (k in e) fail(`marketplace.json[${e.name}]: ${k} belongs in plugin.json, not the entry`);
    }
    entries.push(e);
  }
}

// ---- each plugin -----------------------------------------------------------
function wordsOutsideCode(md) {
  return md.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ').split(/\s+/).filter(Boolean).length;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push({ path: p, size: st.size, name });
  }
  return out;
}

for (const e of entries) {
  const dir = resolve(root, e.source);
  const tag = `plugins/${e.name}`;
  if (!existsSync(dir)) { fail(`${tag}: source dir ${e.source} does not exist`); continue; }

  const pjPath = join(dir, '.claude-plugin', 'plugin.json');
  const pj = existsSync(pjPath) ? readJson(pjPath) : (fail(`${tag}: .claude-plugin/plugin.json missing`), null);
  if (pj) {
    if (pj.name !== e.name) fail(`${tag}: plugin.json name "${pj.name}" != marketplace entry "${e.name}"`);
    if (!NAME_RE.test(pj.name ?? '')) fail(`${tag}: name must be lowercase letters, digits, hyphens, <= 64 chars`);
    for (const k of ['description', 'version', 'author']) if (!(k in pj)) warn(`${tag}: plugin.json has no ${k} (directory warns)`);
    if (pj.author && typeof pj.author.name !== 'string') fail(`${tag}: author.name is required when author is set`);
    if (!pj.license && !existsSync(join(dir, 'LICENSE'))) fail(`${tag}: no license (LICENSE file or plugin.json license)`);
    for (const k of ['homepage', 'documentationUrl', 'supportUrl', 'privacyPolicyUrl', 'termsOfServiceUrl']) {
      if (k in pj && !HTTPS_RE.test(pj[k])) fail(`${tag}: ${k} must be an https:// URL`);
    }
    for (const k of ['documentationUrl', 'supportUrl', 'privacyPolicyUrl']) if (!(k in pj)) warn(`${tag}: no ${k} (directory listing field)`);
    if (!pj.icon && !existsSync(join(dir, '.claude-plugin', 'icon.png'))) warn(`${tag}: no icon; the listing icon can only be set on the FIRST portal save`);
    if ('mcpServers' in pj && 'experimental' in pj && 'mcpServers' in pj.experimental) fail(`${tag}: mcpServers must not live under experimental`);
  }

  // README: >= 40 words outside code blocks
  const readme = join(dir, 'README.md');
  if (!existsSync(readme)) fail(`${tag}: README.md missing`);
  else if (wordsOutsideCode(readFileSync(readme, 'utf8')) < 40) fail(`${tag}: README.md under 40 words outside code blocks`);

  // .mcp.json: valid, stdio via launcher pinned to exact version, no shell
  const mcpPath = join(dir, '.mcp.json');
  if (existsSync(mcpPath)) {
    const mcp = readJson(mcpPath);
    const servers = mcp?.mcpServers;
    if (!servers || typeof servers !== 'object') fail(`${tag}: .mcp.json needs a top-level mcpServers object`);
    for (const [sname, s] of Object.entries(servers ?? {})) {
      if (s.url) {
        if (!/^(https|wss):\/\//.test(s.url)) fail(`${tag}/${sname}: remote url must be https:// or wss://`);
        continue;
      }
      if (typeof s.command !== 'string') { fail(`${tag}/${sname}: command or url required`); continue; }
      if (/\b(sh|bash|zsh|cmd|powershell)\b/.test(s.command) || (s.args ?? []).includes('-c')) warn(`${tag}/${sname}: runs through a shell; directory holds it for a reviewer`);
      if (LAUNCHERS.has(s.command)) {
        const pkg = (s.args ?? []).find((a) => !a.startsWith('-'));
        if (!pkg || !PIN_RE.test(pkg)) fail(`${tag}/${sname}: launcher package must be pinned to an exact version (got "${pkg}")`);
        for (const a of s.args ?? []) if (/\$\{(?!CLAUDE_PLUGIN_ROOT\}|user_config\.)/.test(a)) fail(`${tag}/${sname}: only \${CLAUDE_PLUGIN_ROOT} / \${user_config.*} allowed in args`);
      }
      for (const [k, v] of Object.entries(s.env ?? {})) {
        if (/(token|secret|key|password)/i.test(k) && !/^\$\{user_config\./.test(String(v))) fail(`${tag}/${sname}: env ${k} looks like a literal credential`);
      }
    }
  }

  // files: no OS junk, no package-manager config, size limits, lockfiles
  for (const f of walk(dir)) {
    const rel = f.path.slice(dir.length + 1);
    if (['.DS_Store', 'Thumbs.db', 'desktop.ini'].includes(f.name) || rel.includes('__MACOSX')) fail(`${tag}: remove ${rel}`);
    if (['.npmrc', 'bunfig.toml', 'uv.toml', 'pip.conf'].includes(f.name)) fail(`${tag}: ${rel} sets a package source; not allowed with a launcher`);
    if (['package-lock.json', 'npm-shrinkwrap.json', 'bun.lock', 'bun.lockb'].includes(f.name) && !rel.includes('/')) warn(`${tag}: ${rel} triggers a lockfile-install reviewer hold`);
    if (f.size > 256 * 1024 && !/\.(png|jpe?g|gif|webp|woff2?|ttf|otf)$/i.test(f.name)) warn(`${tag}: ${rel} is over 256 KiB; held for a reviewer`);
    if (f.size > 5 * 1024 * 1024) fail(`${tag}: ${rel} is over 5 MiB`);
    if (/\.(ico|pdf|zip|tgz|gz|exe|dll|so|dylib|node)$/i.test(f.name)) warn(`${tag}: ${rel} is a binary the validator cannot inspect; held for a reviewer`);
  }

  // skills: SKILL.md with text front matter including description
  const skillsDir = join(dir, 'skills');
  if (existsSync(skillsDir)) {
    for (const name of readdirSync(skillsDir)) {
      const sk = join(skillsDir, name, 'SKILL.md');
      if (!existsSync(sk)) { fail(`${tag}: skills/${name}/SKILL.md missing (exact spelling)`); continue; }
      const text = readFileSync(sk, 'utf8');
      const m = text.match(/^---\n([\s\S]*?)\n---/);
      if (!m) { warn(`${tag}: skills/${name}/SKILL.md has no YAML front matter`); continue; }
      const desc = m[1].match(/^description:\s*(.*)$/m);
      if (!desc) warn(`${tag}: skills/${name}/SKILL.md front matter has no description`);
      else if (/^\s*[-\[]/.test(desc[1])) fail(`${tag}: skills/${name}/SKILL.md description must be a single text value`);
    }
  }
}

// ---- standalone Agent Skills (skills/<name>/SKILL.md, agentskills.io spec) --
// `npx skills add isokron-ai/isokron-plugins` discovers skills/ first. The
// spec: name 1-64 chars [a-z0-9-], no leading/trailing/double hyphen, equal to
// the folder name; description 1-1024 chars; compatibility <= 500 chars;
// metadata a map of string -> string.
const SPEC_NAME_RE = /^[a-z0-9](?:[a-z0-9]|-(?!-)){0,62}[a-z0-9]$|^[a-z0-9]$/;
const standalone = join(root, 'skills');
if (existsSync(standalone)) {
  for (const name of readdirSync(standalone)) {
    const sk = join(standalone, name, 'SKILL.md');
    const tag = `skills/${name}`;
    if (!existsSync(sk)) { fail(`${tag}: SKILL.md missing`); continue; }
    const m = readFileSync(sk, 'utf8').match(/^---\n([\s\S]*?)\n---/);
    if (!m) { fail(`${tag}: SKILL.md has no YAML front matter`); continue; }
    const fm = m[1];
    const scalar = (k) => { const mm = fm.match(new RegExp(`^${k}:\\s*(.*)$`, 'm')); return mm ? mm[1].trim().replace(/^(["'])(.*)\1$/, '$2') : null; };
    const n = scalar('name');
    if (!n || !SPEC_NAME_RE.test(n)) fail(`${tag}: name "${n}" violates the Agent Skills name rules`);
    if (n !== name) fail(`${tag}: name "${n}" must equal the folder name`);
    const desc = scalar('description');
    if (!desc || desc.length > 1024) fail(`${tag}: description must be 1-1024 characters (got ${desc ? desc.length : 0})`);
    const compat = scalar('compatibility');
    if (compat !== null && (compat.length < 1 || compat.length > 500)) fail(`${tag}: compatibility must be 1-500 characters`);
    const meta = fm.match(/^metadata:\s*\n((?:[ \t]+.*\n?)*)/m);
    if (meta) for (const line of meta[1].split('\n').filter((l) => l.trim())) {
      if (!/^\s+[A-Za-z0-9_.-]+:\s*("[^"]*"|'[^']*'|[^\s\[{].*)$/.test(line) || /:\s*(\d+(\.\d+)?|true|false)\s*$/.test(line)) fail(`${tag}: metadata values must be strings (quote "${line.trim()}")`);
    }
    for (const k of fm.split('\n').filter((l) => /^[A-Za-z]/.test(l)).map((l) => l.split(':')[0])) {
      if (!['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'].includes(k)) warn(`${tag}: front matter key "${k}" is not in the Agent Skills spec`);
    }
    const lines = readFileSync(sk, 'utf8').split('\n').length;
    if (lines > 500) warn(`${tag}: SKILL.md is ${lines} lines; the spec recommends < 500`);
  }
}

// ---- bundled copies must not drift -------------------------------------------
{
  const sync = join(root, 'scripts', 'sync-setup-skill.mjs');
  if (existsSync(sync)) {
    const r = spawnSync(process.execPath, [sync, '--check'], { encoding: 'utf8' });
    if (r.status !== 0) fail(`skill copies drifted (run node scripts/sync-setup-skill.mjs):\n${r.stdout.split('\n').filter((l) => l.startsWith('DRIFT')).join('\n')}`);
  }
}

// ---- report ----------------------------------------------------------------
for (const w of warnings) console.log(`warning  ${w}`);
for (const p of problems) console.log(`BLOCKS   ${p}`);
if (problems.length) {
  console.log(`\n${problems.length} blocking finding(s), ${warnings.length} warning(s)`);
  process.exit(1);
}
console.log(`\nOK: ${entries.length} plugin(s) checked, ${warnings.length} warning(s)`);
