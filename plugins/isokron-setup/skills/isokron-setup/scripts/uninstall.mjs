#!/usr/bin/env node
// isokron-setup uninstall: reverse every change recorded in
// .isokron/setup-manifest.json, newest first.
//
// For each changed file: if it is byte-identical to what install last wrote,
// the .bak-isokron original is restored verbatim; otherwise only our key /
// table / marked block is removed surgically and the user's later edits stay.
// Files and directories install created are deleted only when nothing else
// is left in them. Without a manifest (--no-manifest) it strips the
// isokron:begin/end blocks it can find and restores *.bak-isokron files.
//
//   node uninstall.mjs [--cwd DIR] --yes [--purge-store] [--json]
//
// The kronicle-lite chain is append-only: seeded documents stay in
// ~/.kronicle-lite unless --purge-store is given AND install created the store.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BACKUP_SUFFIX, exists, isDir, readText, readJsonSafe, writeText, which, run, sha256, homeDir, sameJson,
  unmergeJsonKey, unmergeTomlBlock, removeMarkedBlock, manifestPath, loadManifest, saveManifest,
} from './lib.mjs';
import { parseArgs } from './detect.mjs';

const rmEmptyDir = (d) => { try { if (isDir(d) && fs.readdirSync(d).length === 0) { fs.rmdirSync(d); return true; } } catch { /* keep */ } return false; };

/** Restore-or-surgery epilogue shared by every file-level change. */
function finishFile(c, surgery) {
  const cur = readText(c.file ?? c.hooksFile);
  const file = c.file ?? c.hooksFile;
  if (cur !== null && c.backup && exists(c.backup) && c.writtenHash && sha256(cur) === c.writtenHash) {
    fs.copyFileSync(c.backup, file);
    fs.rmSync(c.backup, { force: true });
    return 'restored';
  }
  const r = surgery();
  if (c.createdFile && r.empty) { fs.rmSync(file, { force: true }); return 'deleted'; }
  if (c.backup && exists(c.backup)) {
    const now = readText(file);
    const orig = readText(c.backup) || '';
    let same = now !== null && now.trimEnd() === orig.trimEnd();
    if (!same && now !== null) { try { same = sameJson(JSON.parse(now), JSON.parse(orig)); } catch { /* not JSON */ } }
    if (same) { fs.copyFileSync(c.backup, file); fs.rmSync(c.backup, { force: true }); return `${r.status}; original restored`; }
    return `${r.status}; kept ${path.basename(c.backup)} (file changed since install)`;
  }
  return r.status;
}

function removeCursorHooks(c) {
  const j = readJsonSafe(c.hooksFile);
  let empty = false;
  if (j.ok && j.value?.hooks) {
    for (const ev of Object.keys(j.value.hooks)) {
      j.value.hooks[ev] = (j.value.hooks[ev] || []).filter((h) => !/cc-anchor\/adapter\.sh/.test(h.command || ''));
      if (!j.value.hooks[ev].length) delete j.value.hooks[ev];
    }
    empty = Object.keys(j.value.hooks).length === 0 && Object.keys(j.value).every((k) => k === 'hooks' || k === 'version');
    writeText(c.hooksFile, JSON.stringify(j.value, null, 2) + '\n');
  }
  fs.rmSync(path.join(c.base, 'hooks', 'cc-anchor'), { recursive: true, force: true });
  return { status: 'removed', empty };
}

export function uninstall({ root, env = process.env, purgeStore = false, claudeBin, log = () => {} } = {}) {
  const mp = manifestPath(root);
  if (!exists(mp)) return { ok: false, results: [], error: `no manifest at ${mp}; use --no-manifest` };
  const m = loadManifest(root);
  const cbin = claudeBin === undefined ? which('claude', env) : claudeBin;
  const results = [];
  const failed = [];
  const note = (c, status) => { if (String(status).startsWith('failed') || String(status).startsWith('manual')) failed.push(c); results.push({ type: c.type, target: c.file || c.dir || c.id || c.name || c.slug || c.card || c.hooksFile, status }); log(`${String(status).padEnd(10)} ${c.type.padEnd(18)} ${c.file || c.dir || c.id || c.name || c.slug || c.card || c.hooksFile}`); };
  const seenFiles = new Set();

  for (const c of [...m.changes].reverse()) {
    try {
      switch (c.type) {
        case 'claude-plugin': {
          if (!cbin) { note(c, 'manual: claude CLI not found'); break; }
          const r = run(cbin, ['plugin', 'uninstall', c.id, '--scope', c.scope], { env, timeout: 120000 });
          note(c, r.code === 0 ? 'removed' : `failed: ${(r.stderr || r.stdout).trim().split('\n').pop()}`);
          break;
        }
        case 'claude-marketplace': {
          if (!cbin) { note(c, 'manual: claude CLI not found'); break; }
          const r = run(cbin, ['plugin', 'marketplace', 'remove', c.name, '--scope', c.scope], { env, timeout: 120000 });
          note(c, r.code === 0 ? 'removed' : `failed: ${(r.stderr || r.stdout).trim().split('\n').pop()}`);
          break;
        }
        case 'json-key': {
          // Several keys in one file: only the newest change may restore the backup;
          // older ones fall through to surgery (and find their key already gone).
          const first = !seenFiles.has(c.file); seenFiles.add(c.file);
          note(c, finishFile(first ? c : { ...c, writtenHash: null }, () => unmergeJsonKey(c.file, c.ptr, c.value, { createdParents: c.createdParents || [] })));
          break;
        }
        case 'toml-block': {
          const first = !seenFiles.has(c.file); seenFiles.add(c.file);
          note(c, finishFile(first ? c : { ...c, writtenHash: null }, () => unmergeTomlBlock(c.file, c.id)));
          break;
        }
        case 'md-block': {
          note(c, finishFile(c, () => removeMarkedBlock(c.file, { style: c.style })));
          break;
        }
        case 'cursor-hooks': {
          note(c, finishFile({ ...c, file: c.hooksFile, writtenHash: null }, () => removeCursorHooks(c)));
          break;
        }
        case 'file': {
          const cur = readText(c.file);
          if (cur === null) { note(c, 'absent'); break; }
          if (c.sha256 && sha256(cur) !== c.sha256) { note(c, 'kept (modified since install)'); break; }
          fs.rmSync(c.file, { force: true });
          note(c, 'deleted');
          break;
        }
        case 'anchor-card': {
          if (c.createdFile) {
            fs.rmSync(c.card, { force: true });
            fs.rmSync(path.join(path.dirname(c.card), 'cc-anchor'), { recursive: true, force: true });
            note(c, 'deleted');
          } else if (c.backup && exists(c.backup)) {
            fs.copyFileSync(c.backup, c.card); fs.rmSync(c.backup, { force: true });
            note(c, 'restored');
          } else note(c, 'kept');
          break;
        }
        case 'dir': {
          note(c, rmEmptyDir(c.dir) ? 'deleted' : exists(c.dir) ? 'kept (not empty)' : 'absent');
          break;
        }
        case 'kronicle-doc':
          note(c, 'kept (append-only chain)');
          break;
        case 'kronicle-store': {
          if (purgeStore && c.created) { fs.rmSync(c.dir, { recursive: true, force: true }); note(c, 'purged'); }
          else note(c, c.created ? 'kept (pass --purge-store to delete it)' : 'kept (existed before install)');
          break;
        }
        default:
          note(c, 'unknown change type; skipped');
      }
    } catch (e) {
      note(c, `failed: ${e.message}`);
    }
  }
  if (failed.length) {
    // Keep what could not be reversed so a re-run (after fixing the cause) can finish the job.
    m.changes = failed.reverse();
    saveManifest(root, m);
    return { ok: false, results, remaining: m.changes.length };
  }
  fs.rmSync(mp, { force: true });
  for (const c of [...m.changes].reverse()) if (c.type === 'dir') rmEmptyDir(c.dir);
  rmEmptyDir(path.dirname(mp));
  return { ok: true, results };
}

/** Best effort without a manifest: strip marked blocks, restore backups found in the usual places. */
export function uninstallNoManifest({ root, env = process.env, log = () => {} } = {}) {
  const home = homeDir(env);
  const results = [];
  for (const f of ['CLAUDE.md', 'AGENTS.md'].map((x) => path.join(root, x))) {
    const r = removeMarkedBlock(f, { style: 'md' });
    if (r.status === 'removed') { results.push({ file: f, status: 'block removed' }); log(`block removed ${f}`); }
  }
  const gi = removeMarkedBlock(path.join(root, '.gitignore'), { style: 'hash' });
  if (gi.status === 'removed') results.push({ file: path.join(root, '.gitignore'), status: 'block removed' });
  const tomlFiles = [path.join(home, '.codex', 'config.toml'), path.join(root, '.codex', 'config.toml')];
  for (const f of tomlFiles) for (const id of ['kronicle-lite', 'sea-lite']) {
    const r = unmergeTomlBlock(f, id);
    if (r.status === 'removed') results.push({ file: f, status: `block ${id} removed` });
  }
  for (const f of [path.join(root, '.cursor', 'mcp.json'), path.join(root, '.cursor', 'hooks.json'), path.join(root, '.vscode', 'mcp.json'), path.join(root, '.claude', 'cc-anchor.json')]) {
    if (exists(f + BACKUP_SUFFIX)) { fs.copyFileSync(f + BACKUP_SUFFIX, f); fs.rmSync(f + BACKUP_SUFFIX); results.push({ file: f, status: 'restored from backup' }); }
  }
  return { ok: true, results, note: 'Claude Code plugins are not removed without a manifest: claude plugin uninstall kronicle-lite@isokron-plugins / cc-anchor@cc-anchor / sea-lite@isokron-plugins' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const f = parseArgs(process.argv.slice(2));
  const cwd = f.cwd || process.cwd();
  const g = run('git', ['rev-parse', '--show-toplevel'], { cwd, timeout: 10000 });
  const root = g.code === 0 ? g.stdout.trim() : path.resolve(cwd);
  if (!f.yes) {
    const m = exists(manifestPath(root)) ? loadManifest(root) : null;
    if (!m) console.log(`No manifest at ${manifestPath(root)}. --no-manifest --yes strips isokron blocks and restores *.bak-isokron files.`);
    else { console.log(`Would reverse ${m.changes.length} change(s), newest first:`); for (const c of [...m.changes].reverse()) console.log(`  ${c.type.padEnd(18)} ${c.file || c.dir || c.id || c.name || c.slug || c.card || c.hooksFile}`); }
    console.log('\nNothing changed. Re-run with --yes after the user approves.');
    process.exit(3);
  }
  const out = f['no-manifest'] ? uninstallNoManifest({ root, log: console.log }) : uninstall({ root, purgeStore: !!f['purge-store'], log: f.json ? () => {} : console.log });
  if (f.json) console.log(JSON.stringify(out, null, 2));
  else console.log(out.error ? out.error : out.ok ? 'uninstall: done.' : `uninstall: ${out.remaining ?? 'some'} change(s) could not be reversed and stay in the manifest; fix the cause and re-run.`);
  process.exit(out.ok ? 0 : 1);
}
