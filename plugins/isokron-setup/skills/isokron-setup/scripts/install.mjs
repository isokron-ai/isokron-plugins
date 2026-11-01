#!/usr/bin/env node
// isokron-setup install: apply the plan detect.mjs prints. Refuses to write
// anything without --yes, and refuses user-global config changes without
// --user-global-ok as well (the agent passes these only after the user said
// yes to the plan it showed). Every change is recorded in
// .isokron/setup-manifest.json as it happens, so uninstall.mjs can reverse a
// partial run too.
//
//   node install.mjs [detect.mjs plan flags] --yes [--user-global-ok] [--json]
//
// Exit: 0 ok · 1 some action failed · 3 not confirmed (nothing written) · 4 user-global changes not confirmed

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PINS, SOURCES, exists, isDir, readText, readJsonSafe, writeText, which, run, homeDir, sha256, tilde,
  kronicleArgv, kronicleDataDir, catalogSnapArgv, backupOnce, mergeJsonKey, mergeTomlBlock, upsertMarkedBlock, missingParents,
  loadManifest, saveManifest, recordChange,
} from './lib.mjs';
import { detect, plan, planText, parseArgs, choicesFromFlags } from './detect.mjs';

// ───────────────────────────── helpers ─────────────────────────────

/** Record every directory between `root`/`home` and `dir` that does not exist yet (outermost first). */
function noteNewDirs(m, dir, stops) {
  const missing = [];
  let cur = path.resolve(dir);
  while (!exists(cur) && !stops.includes(cur) && path.dirname(cur) !== cur) { missing.unshift(cur); cur = path.dirname(cur); }
  for (const d of missing) recordChange(m, { type: 'dir', dir: d });
}
/**
 * Backup options for a file write. The first change to a file backs up the
 * user's original; later changes (same run or a re-run) must not back up our
 * own output, so they inherit the original backup path instead.
 */
function backupOpts(m, file) {
  const prior = m.changes.find((c) => (c.file === file || c.hooksFile === file || c.card === file));
  if (!prior) return { fresh: true };
  const bak = m.changes.map((c) => (c.file === file || c.hooksFile === file || c.card === file) && c.backup).find(Boolean);
  return { inherit: bak || null };
}

/** Locate cc-anchor's anchor.mjs: env override, the Claude Code plugin cache, or the copy the Cursor port made. */
export function findAnchorScript({ root, env = process.env, claudeBin } = {}) {
  if (env.ISOKRON_CC_ANCHOR_DIR) {
    const p = path.join(env.ISOKRON_CC_ANCHOR_DIR, 'scripts', 'anchor.mjs');
    if (exists(p)) return p;
  }
  const bin = claudeBin === undefined ? which('claude', env) : claudeBin;
  if (bin) {
    const r = run(bin, ['plugin', 'list', '--json'], { env, timeout: 30000 });
    try {
      const hit = JSON.parse(r.stdout).find((p) => p.id === 'cc-anchor@cc-anchor');
      const p = hit && path.join(hit.installPath, 'scripts', 'anchor.mjs');
      if (p && exists(p)) return p;
    } catch { /* fall through */ }
  }
  const cur = root && path.join(root, '.cursor', 'hooks', 'cc-anchor', 'scripts', 'anchor.mjs');
  if (cur && exists(cur)) return cur;
  return null;
}

function kronicleEnv(env) {
  // ISOKRON_HOME (tests) also moves the kronicle-lite default store.
  return env.ISOKRON_HOME && !env.KRONICLE_LITE_DATA_DIR ? { ...env, HOME: env.ISOKRON_HOME } : env;
}

// ───────────────────────────── apply ─────────────────────────────

/**
 * Execute a plan. `opts.log(line)` receives human progress lines.
 * Returns { ok, results: [{action, status, detail}], orient, manifest }.
 */
export function applyPlan(p, { env = process.env, log = () => {}, claudeBin } = {}) {
  const root = p.root;
  const home = homeDir(env);
  const stops = [root, home, path.dirname(root)];
  const m = loadManifest(root);
  const cbin = claudeBin === undefined ? which('claude', env) : claudeBin;
  m.runs.push({ at: new Date().toISOString(), profile: p.profile, clients: p.clients, scopeMode: p.scopeMode });
  noteNewDirs(m, path.join(root, '.isokron'), stops);
  saveManifest(root, m);
  const results = [];
  let orient = null;
  const done = (a, status, detail = '') => {
    results.push({ kind: a.kind, target: a.target, status, detail });
    log(`${status.padEnd(9)} ${a.kind.padEnd(18)} ${a.target}${detail ? ` — ${detail}` : ''}`);
    saveManifest(root, m);
  };

  for (const a of p.actions) {
    try {
      switch (a.kind) {
        case 'claude-marketplace': {
          if (!cbin) { done(a, 'failed', 'claude CLI not found'); break; }
          const list = run(cbin, ['plugin', 'marketplace', 'list', '--json'], { env, timeout: 30000 });
          let have = false;
          try { have = JSON.parse(list.stdout).some((x) => x.name === a.name); } catch { /* treat as absent */ }
          if (have) { done(a, 'present'); break; }
          const r = run(cbin, ['plugin', 'marketplace', 'add', a.source, '--scope', a.claudeScope], { env, timeout: 300000 });
          if (r.code !== 0) { done(a, 'failed', (r.stderr || r.stdout).trim().split('\n').slice(-2).join(' ')); break; }
          recordChange(m, { type: 'claude-marketplace', name: a.name, source: a.source, scope: a.claudeScope });
          done(a, 'added');
          break;
        }
        case 'claude-plugin': {
          if (!cbin) { done(a, 'failed', 'claude CLI not found'); break; }
          const list = run(cbin, ['plugin', 'list', '--json'], { env, timeout: 30000 });
          let have = null;
          try { have = JSON.parse(list.stdout).find((x) => x.id === a.id && x.enabled); } catch { /* absent */ }
          if (have) { done(a, 'present', `${have.version} (${have.scope})`); break; }
          const r = run(cbin, ['plugin', 'install', a.id, '--scope', a.claudeScope], { env, timeout: 600000 });
          if (r.code !== 0) { done(a, 'failed', (r.stderr || r.stdout).trim().split('\n').slice(-2).join(' ')); break; }
          recordChange(m, { type: 'claude-plugin', id: a.id, scope: a.claudeScope });
          done(a, 'added');
          break;
        }
        case 'json-key': {
          const parents = missingParents(a.file, a.ptr);
          const bo = backupOpts(m, a.file);
          noteNewDirs(m, path.dirname(a.file), stops);
          const r = mergeJsonKey(a.file, a.ptr, a.value, bo);
          if (r.status === 'added') recordChange(m, { type: 'json-key', file: a.file, ptr: a.ptr, value: a.value, createdFile: r.createdFile, createdParents: parents, backup: r.backup, writtenHash: r.writtenHash });
          done(a, r.status, r.status === 'conflict' ? `${a.ptr.join('.')} already set to something else; left as is` : r.status === 'unparseable' ? `not strict JSON (${r.error}); add ${a.ptr.join('.')} by hand: ${JSON.stringify(a.value)}` : a.summary);
          break;
        }
        case 'toml-block': {
          const bo = backupOpts(m, a.file);
          noteNewDirs(m, path.dirname(a.file), stops);
          const r = mergeTomlBlock(a.file, a.id, a.server, a.body, bo);
          if (r.status === 'added') recordChange(m, { type: 'toml-block', file: a.file, id: a.id, createdFile: r.createdFile, backup: r.backup, writtenHash: r.writtenHash });
          done(a, r.status, r.status === 'conflict' ? `mcp_servers.${a.server} already defined; left as is` : a.summary);
          break;
        }
        case 'file': {
          const content = a.content ?? fs.readFileSync(a.from, 'utf8');
          const cur = readText(a.file);
          if (cur !== null) { done(a, cur === content ? 'present' : 'conflict', cur === content ? '' : 'exists with other content; left as is'); break; }
          noteNewDirs(m, path.dirname(a.file), stops);
          writeText(a.file, content);
          recordChange(m, { type: 'file', file: a.file, sha256: sha256(content) });
          done(a, 'added', a.summary);
          break;
        }
        case 'cursor-hooks': {
          const base = path.join(root, '.cursor');
          const hooksFile = path.join(base, 'hooks.json');
          let script = findAnchorScript({ root, env, claudeBin: cbin });
          let tmp = null;
          if (!script) {
            tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'isokron-cc-anchor-'));
            const src = env.ISOKRON_CC_ANCHOR_GIT || SOURCES.ccAnchorGit;
            const dest = path.join(tmp, 'cc-anchor');
            const r = run('git', ['clone', '--quiet', '--depth', '1', '--branch', PINS.ccAnchorRef, src, dest], { env, timeout: 120000 });
            if (r.code !== 0) { fs.rmSync(tmp, { recursive: true, force: true }); done(a, 'failed', `git clone ${src}@${PINS.ccAnchorRef}: ${r.stderr.trim()}`); break; }
            if (PINS.ccAnchorSha) {
              // A branch moves: end on the pinned commit (fetch it by id if the branch has moved on).
              let head = run('git', ['-C', dest, 'rev-parse', 'HEAD'], { env }).stdout.trim();
              if (head !== PINS.ccAnchorSha) {
                const f = run('git', ['-C', dest, 'fetch', '--quiet', '--depth', '1', 'origin', PINS.ccAnchorSha], { env, timeout: 120000 });
                if (f.code === 0) run('git', ['-C', dest, 'checkout', '--quiet', 'FETCH_HEAD'], { env });
                head = run('git', ['-C', dest, 'rev-parse', 'HEAD'], { env }).stdout.trim();
              }
              if (head !== PINS.ccAnchorSha) { fs.rmSync(tmp, { recursive: true, force: true }); done(a, 'failed', `cc-anchor ${PINS.ccAnchorRef}: pinned commit ${PINS.ccAnchorSha.slice(0, 12)} not reachable (got ${head.slice(0, 12) || 'nothing'})`); break; }
            }
            script = path.join(tmp, 'cc-anchor', 'scripts', 'anchor.mjs');
          }
          const hadFile = exists(hooksFile);
          const hadDir = isDir(path.join(base, 'hooks', 'cc-anchor'));
          const hbo = backupOpts(m, hooksFile);
          const backup = !hadFile ? null : hbo.fresh ? backupOnce(hooksFile, { fresh: true }) : hbo.inherit;
          noteNewDirs(m, path.join(base, 'hooks'), stops);
          const r = run(process.execPath, [script, 'cursor', 'install', '--root', root], { cwd: root, env, timeout: 60000 });
          if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
          if (r.code !== 0) { done(a, 'failed', r.stderr.trim()); break; }
          recordChange(m, { type: 'cursor-hooks', base, hooksFile, createdFile: !hadFile, createdDir: !hadDir, backup });
          done(a, 'added', a.summary);
          break;
        }
        case 'catalog-snapshot': {
          const dir = path.join(root, '.mcp-catalog');
          const snap = path.join(dir, `${a.name}.json`);
          if (exists(snap)) { done(a, 'present', 'baseline exists; run `check` instead'); break; }
          noteNewDirs(m, dir, stops);
          const argv = catalogSnapArgv(env);
          const r = run(argv[0], [...argv.slice(1), 'snapshot'], { cwd: root, env, timeout: 300000 });
          if (r.code !== 0 || !exists(snap)) { done(a, 'failed', `${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ')} (build the server, then: ${a.command})`); break; }
          recordChange(m, { type: 'file', file: snap, sha256: sha256(readText(snap)) });
          done(a, 'added', a.summary);
          break;
        }
        case 'md-block': {
          const r = upsertMarkedBlock(a.file, a.body, { style: a.style, ...backupOpts(m, a.file) });
          if (r.status === 'added' || r.status === 'updated') {
            const prev = m.changes.find((c) => c.type === 'md-block' && c.file === a.file);
            if (prev) prev.writtenHash = r.writtenHash;
            else recordChange(m, { type: 'md-block', file: a.file, style: a.style, createdFile: r.createdFile, backup: r.backup, writtenHash: r.writtenHash });
          }
          done(a, r.status, a.summary);
          break;
        }
        case 'kronicle-put': {
          if (!exists(a.file)) { done(a, 'skipped', 'file not found'); break; }
          const content = fs.readFileSync(a.file, 'utf8');
          const h = sha256(content);
          if (m.changes.some((c) => c.type === 'kronicle-doc' && c.slug === a.slug && c.sha256 === h)) { done(a, 'present', 'unchanged since last seed'); break; }
          const dataDir = kronicleDataDir(env);
          recordChange(m, { type: 'kronicle-store', dir: dataDir, created: !exists(dataDir) });
          const argv = kronicleArgv(env);
          const r = run(argv[0], [...argv.slice(1), 'put', a.slug, a.file, '--title', a.title], { cwd: root, env: kronicleEnv(env), timeout: 300000 });
          if (r.code !== 0) { done(a, 'failed', r.stderr.trim().split('\n').slice(-2).join(' ')); break; }
          let rev = '?';
          try { const j = JSON.parse(r.stdout); rev = `rev ${j.revision}, chain seq ${j.head?.seq}`; } catch { /* keep going */ }
          recordChange(m, { type: 'kronicle-doc', slug: a.slug, file: path.relative(root, a.file), sha256: h });
          done(a, 'added', rev);
          break;
        }
        case 'anchor-set': {
          const script = findAnchorScript({ root, env, claudeBin: cbin });
          if (!script) { done(a, 'skipped', 'cc-anchor not found (install it, then /cc-anchor:anchor set project …)'); break; }
          const paths = run(process.execPath, [script, 'paths', '--json', '--root', root], { cwd: root, env, timeout: 30000 });
          let card;
          try { card = JSON.parse(paths.stdout).card; } catch { done(a, 'failed', 'anchor.mjs paths --json'); break; }
          const had = exists(card);
          const cbo = backupOpts(m, card);
          const backup = !had ? null : cbo.fresh ? backupOnce(card, { fresh: true }) : cbo.inherit;
          noteNewDirs(m, path.dirname(card), stops);
          recordChange(m, { type: 'anchor-card', card, createdFile: !had, backup, script });
          const r1 = run(process.execPath, [script, 'set', 'project', a.project, '--root', root], { cwd: root, env, timeout: 30000 });
          const r2 = a.goal ? run(process.execPath, [script, 'set', 'goal', a.goal, '--root', root], { cwd: root, env, timeout: 30000 }) : { code: 0 };
          if (r1.code !== 0 || r2.code !== 0) { done(a, 'failed', (r1.stderr || r2.stderr || '').trim()); break; }
          done(a, had ? 'updated' : 'added', a.summary);
          break;
        }
        case 'orient': {
          const argv = kronicleArgv(env);
          const r = run(argv[0], [...argv.slice(1), 'orient', '--actor', a.actor || 'local-agent'], { cwd: root, env: kronicleEnv(env), timeout: 300000 });
          if (r.code !== 0) { done(a, 'failed', r.stderr.trim()); break; }
          orient = r.stdout;
          const cm = r.stdout.match(/cursor_compact:\*\*\s*`(sxt1c\.[^`]+)`/);
          const script = p.actions.some((x) => x.kind === 'anchor-set') && findAnchorScript({ root, env, claudeBin: cbin });
          if (cm && script) {
            const paths = run(process.execPath, [script, 'paths', '--json', '--root', root], { cwd: root, env, timeout: 30000 });
            try {
              const cf = JSON.parse(paths.stdout).cursorFile;
              noteNewDirs(m, path.dirname(cf), stops);
              writeText(cf, cm[1] + '\n');
              recordChange(m, { type: 'file', file: cf, sha256: null });
            } catch { /* cursor is a convenience */ }
          }
          done(a, 'ran', cm ? `cursor ${cm[1]}` : '');
          break;
        }
        default:
          done(a, 'skipped', `unknown action kind ${a.kind}`);
      }
    } catch (e) {
      done(a, 'failed', e.message);
    }
  }
  saveManifest(root, m);
  return { ok: !results.some((r) => r.status === 'failed'), results, orient, manifest: m };
}

// ───────────────────────────── CLI ─────────────────────────────

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const f = parseArgs(process.argv.slice(2));
  let d;
  let p;
  try {
    d = detect({ cwd: f.cwd || process.cwd(), probe: !f['no-probe'] });
    p = plan(d, choicesFromFlags(f));
  } catch (e) {
    console.error(`isokron-setup install: ${e.message}`);
    process.exit(2);
  }
  if (!f.yes) {
    console.log(planText(p, d));
    console.log('\nNothing written. Re-run with --yes after the user approves this plan.');
    process.exit(3);
  }
  if (p.userGlobal.length && !f['user-global-ok']) {
    console.log(planText(p, d));
    console.log(`\nRefusing: the plan edits user-global config (${p.userGlobal.join(', ')}). Re-run with --user-global-ok only if the user said yes to that, or with --scope-mode project.`);
    process.exit(4);
  }
  const out = applyPlan(p, { log: f.json ? () => {} : (l) => console.log(l) });
  if (f.json) console.log(JSON.stringify({ ok: out.ok, results: out.results, orient: out.orient }, null, 2));
  else {
    if (out.orient) console.log(`\n── first orient ─────────────────────────────\n${out.orient.trim()}\n`);
    if (p.manual.length) { console.log('── still to do by hand ──'); for (const m of p.manual) console.log(`[${m.client}] ${m.text}\n`); }
    console.log(out.ok ? 'install: done. Next: node verify.mjs' : 'install: finished with failures (see above). uninstall.mjs reverses what was done.');
  }
  process.exit(out.ok ? 0 : 1);
}
