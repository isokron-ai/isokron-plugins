// isokron-setup shared library: pinned versions, process runner, idempotent
// file merges (JSON key, TOML table block, Markdown / gitignore marked block),
// backups and the install manifest that uninstall replays in reverse.
//
// Zero dependencies: node:* only. Every write goes through one of the merge
// helpers so the same three rules hold everywhere:
//   1. never overwrite a key / table the user already has (report a conflict);
//   2. back up a pre-existing file once, as <file>.bak-isokron, before the
//      first change (a second run never overwrites the original backup);
//   3. record the change in the manifest so uninstall can reverse exactly it.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SETUP_VERSION = '0.1.0';
export const PINS = {
  kronicle: '0.4.0',
  sea: '0.3.0',
  ccAnchorTag: 'v0.2.0',
  catalogSnap: '0.1.0',
};
export const SOURCES = {
  isokronMarketplace: 'rafe-walker/isokron-plugins',
  ccAnchorMarketplace: 'rafe-walker/cc-anchor',
  ccAnchorGit: 'https://github.com/rafe-walker/cc-anchor',
  catalogAction: 'rafe-walker/mcp-catalog-snap@v0.1.0',
};
export const BACKUP_SUFFIX = '.bak-isokron';
export const MANIFEST_REL = path.join('.isokron', 'setup-manifest.json');
export const MD_BEGIN = '<!-- isokron:begin -->';
export const MD_END = '<!-- isokron:end -->';
export const HASH_BEGIN = '# isokron:begin';
export const HASH_END = '# isokron:end';

// ───────────────────────────── small utils ─────────────────────────────

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
export const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
export const readText = (p, fallback = null) => { try { return fs.readFileSync(p, 'utf8'); } catch { return fallback; } };
export function readJsonSafe(p) {
  const raw = readText(p);
  if (raw === null) return { ok: false, missing: true };
  try { return { ok: true, value: JSON.parse(raw), raw }; } catch (e) { return { ok: false, missing: false, error: e.message, raw }; }
}
export function writeText(p, s) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s);
}
export function homeDir(env = process.env) {
  return env.ISOKRON_HOME || env.HOME || os.homedir();
}
export function tilde(p, home) {
  return home && p.startsWith(home + path.sep) ? '~' + p.slice(home.length) : p;
}
/** Slug safe for kronicle-lite (`^[a-z0-9][a-z0-9._-]{0,127}$`). */
export function slugify(s) {
  const out = String(s).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '').replace(/-+$/, '');
  return (out || 'project').slice(0, 100);
}

/** PATH lookup without spawning a shell. */
export function which(bin, env = process.env) {
  const exts = process.platform === 'win32' ? (env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = path.join(dir, bin + ext);
      try { fs.accessSync(p, fs.constants.X_OK); if (fs.statSync(p).isFile()) return p; } catch { /* next */ }
    }
  }
  return null;
}

/** Run a command (no shell). Returns {code, stdout, stderr, cmd}. */
export function run(cmd, args = [], { cwd, env = process.env, input, timeout = 180000 } = {}) {
  const r = spawnSync(cmd, args, { cwd, env, input, timeout, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const code = r.error ? (r.error.code === 'ETIMEDOUT' ? 124 : 127) : r.status;
  return { code, stdout: r.stdout || '', stderr: (r.stderr || '') + (r.error ? String(r.error.message) : ''), cmd: [cmd, ...args].join(' ') };
}

export function shellQuote(a) {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(a) ? a : `'${String(a).replace(/'/g, `'\\''`)}'`;
}
export const fmtCmd = (argv) => argv.map(shellQuote).join(' ');

/** The kronicle-lite CLI as argv: $ISOKRON_KRONICLE_LITE_BIN or the pinned npx package. */
export function kronicleArgv(env = process.env) {
  const b = env.ISOKRON_KRONICLE_LITE_BIN;
  if (b) return b.endsWith('.js') || b.endsWith('.mjs') ? [process.execPath, b] : [b];
  return ['npx', '-y', `kronicle-lite@${PINS.kronicle}`];
}
export function kronicleDataDir(env = process.env) {
  return env.KRONICLE_LITE_DATA_DIR || path.join(homeDir(env), '.kronicle-lite');
}
/** JSON.stringify with arrays of scalars kept on one line (readable config snippets). */
export function prettyJson(v) {
  return JSON.stringify(v, null, 2).replace(/\[\n\s+((?:(?:"[^"\n]*"|-?[\d.]+|true|false|null),?\s*)+)\]/g, (m, inner) => `[${inner.trim().split(/,\s*\n\s*/).join(', ')}]`);
}
export function catalogSnapArgv(env = process.env) {
  const b = env.ISOKRON_CATALOG_SNAP_BIN;
  if (b) return b.endsWith('.js') || b.endsWith('.mjs') ? [process.execPath, b] : [b];
  return ['npx', '-y', `mcp-catalog-snap@${PINS.catalogSnap}`];
}

// ───────────────────────────── backups ─────────────────────────────

/** Copy `file` to `file.bak-isokron` once. Returns the backup path or null when there was nothing to back up. */
export function backupOnce(file, { fresh = false } = {}) {
  if (!exists(file)) return null;
  const bak = file + BACKUP_SUFFIX;
  // `fresh`: no change in the current manifest references this file, so a
  // leftover .bak-isokron is from an earlier cycle and must not be trusted.
  if (fresh || !exists(bak)) fs.copyFileSync(file, bak);
  return bak;
}

// ───────────────────────────── JSON key merge ─────────────────────────────

function detectIndent(raw) {
  const m = raw && raw.match(/^[ \t]+(?=")/m);
  return m ? m[0] : '  ';
}
function getAt(obj, ptr) {
  let cur = obj;
  for (const k of ptr) { if (cur === null || typeof cur !== 'object' || !(k in cur)) return undefined; cur = cur[k]; }
  return cur;
}
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',')}}`;
  return JSON.stringify(v);
}
export const sameJson = (a, b) => canonical(a) === canonical(b);

/**
 * Set obj[ptr...] = value in a JSON file, only when the key is absent.
 *   added      key written (file created if needed; original backed up once)
 *   present    key already holds exactly this value: nothing written
 *   conflict   key exists with another value: nothing written (never clobber)
 *   unparseable file is not strict JSON (comments, trailing commas): nothing written
 */
export function mergeJsonKey(file, ptr, value, { dryRun = false, fresh = false, inherit } = {}) {
  const r = readJsonSafe(file);
  if (!r.ok && !r.missing) return { status: 'unparseable', file, error: r.error };
  const doc = r.ok ? r.value : {};
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return { status: 'unparseable', file, error: 'top level is not an object' };
  const cur = getAt(doc, ptr);
  if (cur !== undefined) return { status: sameJson(cur, value) ? 'present' : 'conflict', file, existing: cur };
  let parent = doc;
  for (const k of ptr.slice(0, -1)) {
    if (parent[k] === undefined) parent[k] = {};
    if (parent[k] === null || typeof parent[k] !== 'object' || Array.isArray(parent[k])) return { status: 'conflict', file, existing: parent[k] };
    parent = parent[k];
  }
  parent[ptr[ptr.length - 1]] = value;
  const out = JSON.stringify(doc, null, detectIndent(r.raw)) + '\n';
  if (dryRun) return { status: 'added', file, createdFile: r.missing, dryRun: true };
  const backup = r.missing ? null : inherit !== undefined ? inherit : backupOnce(file, { fresh });
  writeText(file, out);
  return { status: 'added', file, createdFile: !!r.missing, backup, writtenHash: sha256(out) };
}

/**
 * Remove obj[ptr...] when it still equals `value` (the user may have edited it;
 * then it is left alone). Empty parent objects that the merge created are pruned.
 */
export function unmergeJsonKey(file, ptr, value, { createdParents = [] } = {}) {
  const r = readJsonSafe(file);
  if (!r.ok) return { status: r.missing ? 'missing' : 'unparseable', file };
  const cur = getAt(r.value, ptr);
  if (cur === undefined) return { status: 'absent', file, empty: Object.keys(r.value).length === 0 };
  if (value !== undefined && !sameJson(cur, value)) return { status: 'modified', file };
  const parent = ptr.length > 1 ? getAt(r.value, ptr.slice(0, -1)) : r.value;
  delete parent[ptr[ptr.length - 1]];
  for (let i = ptr.length - 1; i > 0; i--) {
    const pp = ptr.slice(0, i);
    const o = getAt(r.value, pp);
    const empty = o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length === 0;
    if (!empty || !createdParents.includes(pp.join('.'))) break;
    const holder = i === 1 ? r.value : getAt(r.value, pp.slice(0, -1));
    delete holder[pp[pp.length - 1]];
  }
  writeText(file, JSON.stringify(r.value, null, detectIndent(r.raw)) + '\n');
  return { status: 'removed', file, empty: Object.keys(r.value).length === 0 };
}

/** Which parent objects along ptr would be created by a merge (for pruning on uninstall). */
export function missingParents(file, ptr) {
  const r = readJsonSafe(file);
  const doc = r.ok ? r.value : {};
  const out = [];
  for (let i = 1; i < ptr.length; i++) if (getAt(doc, ptr.slice(0, i)) === undefined) out.push(ptr.slice(0, i).join('.'));
  return out;
}

// ───────────────────────────── TOML table block ─────────────────────────────

const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Does a TOML document already define mcp_servers.<name> in any of the usual spellings? */
export function tomlHasServer(text, name) {
  const n = `(?:${reEsc(name)}|"${reEsc(name)}"|'${reEsc(name)}')`;
  if (new RegExp(`^\\s*\\[\\s*mcp_servers\\s*\\.\\s*${n}\\s*[\\].]`, 'm').test(text)) return true;
  if (new RegExp(`^\\s*mcp_servers\\s*\\.\\s*${n}\\s*[.=]`, 'm').test(text)) return true;
  // `name = {...}` or `name.command = ...` directly under a [mcp_servers] table
  let inTable = false;
  for (const line of text.split('\n')) {
    const h = line.match(/^\s*\[([^\]]+)\]\s*(#.*)?$/);
    if (h) { inTable = h[1].trim() === 'mcp_servers'; continue; }
    if (inTable && new RegExp(`^\\s*${n}\\s*[.=]`).test(line)) return true;
  }
  // inline: mcp_servers = { name = {...} }
  if (new RegExp(`^\\s*mcp_servers\\s*=\\s*\\{[^\\n]*\\b${reEsc(name)}\\b`, 'm').test(text)) return true;
  return false;
}

const tomlBlockRe = (id) => new RegExp(`(?:^|\\n)${reEsc(HASH_BEGIN)} ${reEsc(id)}\\b[^\\n]*\\n[\\s\\S]*?\\n${reEsc(HASH_END)} ${reEsc(id)}\\n?`);

/**
 * Append `body` (one or more complete TOML tables) as a marked block, unless
 * the server name is already defined. Appending whole tables at the end of a
 * document is always valid TOML, so unknown keys elsewhere are never touched.
 */
export function mergeTomlBlock(file, id, serverName, body, { dryRun = false, fresh = false, inherit } = {}) {
  const raw = readText(file);
  const text = raw ?? '';
  if (tomlBlockRe(id).test(text)) return { status: 'present', file };
  if (tomlHasServer(text, serverName)) return { status: 'conflict', file };
  const block = `${HASH_BEGIN} ${id} (added by isokron-setup; its uninstall removes this block)\n${body.trimEnd()}\n${HASH_END} ${id}\n`;
  const sep = text.length === 0 ? '' : text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  const out = text + sep + block;
  if (dryRun) return { status: 'added', file, createdFile: raw === null, dryRun: true };
  const backup = raw === null ? null : inherit !== undefined ? inherit : backupOnce(file, { fresh });
  writeText(file, out);
  return { status: 'added', file, createdFile: raw === null, backup, writtenHash: sha256(out) };
}
export function unmergeTomlBlock(file, id) {
  const raw = readText(file);
  if (raw === null) return { status: 'missing', file };
  const re = tomlBlockRe(id);
  if (!re.test(raw)) return { status: 'absent', file };
  const out = cutBlock(raw, re);
  writeText(file, out);
  return { status: 'removed', file, empty: out.trim() === '' };
}

/**
 * Cut a marked block out of `raw`, undoing the blank-line separator the
 * insert added: a block at the end of the file leaves the text before it
 * ending in exactly one newline; a block in the middle leaves one blank line.
 */
export function cutBlock(raw, re) {
  const m = raw.match(re);
  if (!m) return raw;
  const before = raw.slice(0, m.index);
  const after = raw.slice(m.index + m[0].length);
  if (after.trim() === '') return before.trim() === '' ? '' : before.replace(/\n*$/, '\n');
  return (before.replace(/\n*$/, '\n') + '\n' + after.replace(/^\n+/, '')).replace(/^\n+/, '');
}

// ───────────────────────────── marked text blocks (Markdown, .gitignore) ─────────────────────────────

function markers(style) {
  return style === 'hash' ? [HASH_BEGIN, HASH_END] : [MD_BEGIN, MD_END];
}
function blockRe(style) {
  const [b, e] = markers(style);
  // begin marker may carry a trailing note inside the comment (`<!-- isokron:begin … -->`)
  const bRe = style === 'hash' ? `${reEsc(b)}(?: [^\\n]*)?` : `<!-- isokron:begin(?: [^\\n]*?)? -->`;
  return new RegExp(`\\n?${bRe}\\n[\\s\\S]*?\\n${reEsc(e)}\\n?`);
}
export function hasMarkedBlock(text, style = 'md') {
  return blockRe(style).test(text || '');
}

/**
 * Insert or refresh a marked block at the end of `file`. Re-running with the
 * same body is a no-op; with a new body the block is replaced in place.
 */
export function upsertMarkedBlock(file, body, { style = 'md', dryRun = false, fresh = false, inherit } = {}) {
  const raw = readText(file);
  const text = raw ?? '';
  const [b, e] = markers(style);
  const block = `${b}\n${body.trimEnd()}\n${e}\n`;
  const re = blockRe(style);
  let out;
  let status;
  if (re.test(text)) {
    const m = text.match(re)[0];
    const current = m.replace(/^\n/, '');
    if (current.trimEnd() === block.trimEnd()) return { status: 'present', file };
    out = text.replace(re, (mm) => (mm.startsWith('\n') ? '\n' : '') + block);
    status = 'updated';
  } else {
    const sep = text.length === 0 ? '' : text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
    out = text + sep + block;
    status = 'added';
  }
  if (dryRun) return { status, file, createdFile: raw === null, dryRun: true };
  const backup = raw === null ? null : inherit !== undefined ? inherit : backupOnce(file, { fresh });
  writeText(file, out);
  return { status, file, createdFile: raw === null, backup, writtenHash: sha256(out) };
}
export function removeMarkedBlock(file, { style = 'md' } = {}) {
  const raw = readText(file);
  if (raw === null) return { status: 'missing', file };
  const re = blockRe(style);
  if (!re.test(raw)) return { status: 'absent', file };
  const out = cutBlock(raw, re);
  writeText(file, out);
  return { status: 'removed', file, empty: out.trim() === '' };
}

// ───────────────────────────── manifest ─────────────────────────────

export function manifestPath(root) {
  return path.join(root, MANIFEST_REL);
}
export function loadManifest(root) {
  const r = readJsonSafe(manifestPath(root));
  if (r.ok && r.value && Array.isArray(r.value.changes)) return r.value;
  return { schema: 'isokron-setup/manifest@1', setupVersion: SETUP_VERSION, root, createdAt: new Date().toISOString(), runs: [], changes: [] };
}
export function saveManifest(root, m) {
  m.updatedAt = new Date().toISOString();
  writeText(manifestPath(root), JSON.stringify(m, null, 2) + '\n');
}
/** Record a change unless an identical one is already recorded (re-runs stay idempotent). */
export function recordChange(m, change) {
  const key = changeKey(change);
  if (m.changes.some((c) => changeKey(c) === key)) return false;
  m.changes.push({ ...change, at: new Date().toISOString() });
  return true;
}
function changeKey(c) {
  switch (c.type) {
    case 'json-key': return `json|${c.file}|${c.ptr.join('.')}`;
    case 'toml-block': return `toml|${c.file}|${c.id}`;
    case 'md-block': return `md|${c.file}|${c.style}`;
    case 'file': return `file|${c.file}`;
    case 'dir': return `dir|${c.dir}`;
    case 'claude-marketplace': return `cmp|${c.name}|${c.scope}`;
    case 'claude-plugin': return `cpl|${c.id}|${c.scope}`;
    case 'cursor-hooks': return `cur|${c.base}`;
    case 'anchor-card': return `anchor|${c.card}`;
    case 'kronicle-doc': return `kdoc|${c.slug}|${c.sha256}`;
    case 'kronicle-store': return `kstore|${c.dir}`;
    default: return JSON.stringify(c);
  }
}
