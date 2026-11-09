#!/usr/bin/env node
// isokron-setup verify: prove the install works, then print a one-screen
// "you're set up" summary.
//
//   kronicle-lite   `doctor` when the CLI has it (0.4.0+); otherwise
//                   `verify-chain` + a real recall over MCP stdio against the
//                   seeded documents (initialize → tools/call recall).
//   Claude Code     `claude plugin list --json` shows each plugin enabled.
//   Cursor/Codex/Copilot  the merged config holds our servers; Codex TOML parses
//                   (python3 tomllib when available).
//   wake contract   the isokron block is in CLAUDE.md / AGENTS.md.
//   cc-anchor       the card exists and `anchor.mjs doctor` runs.
//
//   node verify.mjs [--cwd DIR] [--json]        exit 0 all green · 1 something failed

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exists, readText, readJsonSafe, which, run, homeDir, kronicleArgv, kronicleDataDir, hasMarkedBlock, loadManifest, manifestPath, tilde } from './lib.mjs';
import { parseArgs } from './detect.mjs';
import { findAnchorScript } from './install.mjs';

/** Minimal MCP stdio client: initialize, then one tools/call. No dependencies. */
export function mcpToolCall(argv, { env = process.env, cwd, tool, args, timeoutMs = 120000 }) {
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    let err = '';
    const finish = (res) => { clearTimeout(t); try { child.kill(); } catch { /* gone */ } resolve(res); };
    const t = setTimeout(() => finish({ ok: false, error: `timeout after ${timeoutMs} ms; stderr: ${err.slice(-300)}` }), timeoutMs);
    const send = (o) => child.stdin.write(JSON.stringify(o) + '\n');
    child.on('error', (e) => finish({ ok: false, error: e.message }));
    child.on('exit', (code) => finish({ ok: false, error: `server exited ${code}: ${err.slice(-300)}` }));
    child.stderr.on('data', (d) => { err += d; });
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 1) {
          if (msg.error) return finish({ ok: false, error: `initialize: ${msg.error.message}` });
          send({ jsonrpc: '2.0', method: 'notifications/initialized' });
          send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: args } });
        } else if (msg.id === 2) {
          if (msg.error) return finish({ ok: false, error: msg.error.message });
          const sc = msg.result?.structuredContent;
          let parsed = sc;
          if (!parsed) { try { parsed = JSON.parse(msg.result?.content?.[0]?.text || 'null'); } catch { parsed = null; } }
          return finish({ ok: !msg.result?.isError, result: parsed, server: null });
        }
      }
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'isokron-setup-verify', version: '0.1.0' } } });
  });
}

export async function verify({ root, env = process.env, claudeBin } = {}) {
  const home = homeDir(env);
  const m = loadManifest(root);
  const last = m.runs[m.runs.length - 1] || { profile: 'memory', clients: [] };
  const team = last.profile === 'team' || last.profile === 'ci';
  const checks = [];
  const ok = (name, pass, detail = '') => checks.push({ name, ok: !!pass, detail });
  const kEnv = env.ISOKRON_HOME && !env.KRONICLE_LITE_DATA_DIR ? { ...env, HOME: env.ISOKRON_HOME } : env;
  const kl = kronicleArgv(env);

  // ── kronicle-lite
  const help = run(kl[0], [...kl.slice(1), '--help'], { cwd: root, env: kEnv, timeout: 300000 });
  const version = (help.stdout.match(/kronicle-lite (\d+\.\d+\.\d+)/) || [])[1] || '?';
  if (/\bdoctor\b/.test(help.stdout)) {
    const r = run(kl[0], [...kl.slice(1), 'doctor'], { cwd: root, env: kEnv, timeout: 300000 });
    ok(`kronicle-lite ${version} doctor`, r.code === 0, r.stdout.trim().split('\n').slice(-1)[0]);
  } else {
    const r = run(kl[0], [...kl.slice(1), 'verify-chain'], { cwd: root, env: kEnv, timeout: 300000 });
    let j = null;
    try { j = JSON.parse(r.stdout); } catch { /* reported below */ }
    ok(`kronicle-lite ${version} verify-chain (no doctor before 0.4.0)`, r.code === 0 && j?.ok, j ? `${j.events_checked} events, head seq ${j.head?.seq}` : r.stderr.trim().slice(0, 200));
    const docs = m.changes.filter((c) => c.type === 'kronicle-doc');
    // Query with words that must be in the chain: the first heading of the first seeded document.
    const firstDoc = docs[0] && readText(path.join(root, docs[0].file), '');
    const heading = firstDoc && (firstDoc.match(/^#+\s+(.+)$/m) || [])[1];
    const query = (heading || path.basename(root)).replace(/[^\p{L}\p{N}\s-]/gu, ' ').trim().split(/\s+/).slice(0, 4).join(' ') || 'README';
    const rc = await mcpToolCall([...kl, 'serve', '--actor', 'isokron-setup-verify'], { env: kEnv, cwd: root, tool: 'recall', args: { query, top_k: 3 } });
    const hits = rc.result?.hits ?? rc.result?.results ?? [];
    const withReceipt = hits.filter((h) => h.receipt).length;
    ok('recall over MCP stdio (test query)', rc.ok && (docs.length === 0 || hits.length > 0),
      rc.ok ? `"${query}" → ${hits.length} hit(s), ${withReceipt} with signed receipt${hits[0] ? `; top: ${hits[0].doc_slug || hits[0].slug || ''}` : ''}` : rc.error);
  }
  ok('kronicle-lite store', exists(kronicleDataDir(env)), tilde(kronicleDataDir(env), home));

  // ── Claude Code
  const cbin = claudeBin === undefined ? which('claude', env) : claudeBin;
  if (last.clients.includes('claude-code') && cbin) {
    const r = run(cbin, ['plugin', 'list', '--json'], { env, timeout: 30000 });
    let list = [];
    try { list = JSON.parse(r.stdout); } catch { /* reported */ }
    for (const id of ['kronicle-lite@isokron-plugins', 'cc-anchor@cc-anchor', ...(team ? ['sea-lite@isokron-plugins'] : [])]) {
      const p = list.find((x) => x.id === id);
      ok(`claude plugin ${id}`, p && p.enabled !== false, p ? `${p.version} (${p.scope})` : 'not installed');
    }
  }
  // ── Cursor
  if (last.clients.includes('cursor')) {
    const j = readJsonSafe(path.join(root, '.cursor', 'mcp.json'));
    ok('.cursor/mcp.json kronicle-lite', j.ok && j.value.mcpServers?.['kronicle-lite']);
    if (team) ok('.cursor/mcp.json sea-lite', j.ok && j.value.mcpServers?.['sea-lite']);
    const h = readJsonSafe(path.join(root, '.cursor', 'hooks.json'));
    const n = h.ok ? Object.values(h.value.hooks || {}).flat().filter((x) => /cc-anchor\/adapter\.sh/.test(x.command || '')).length : 0;
    ok('.cursor/hooks.json cc-anchor port', n >= 6, `${n} hook entries`);
  }
  // ── Codex
  if (last.clients.includes('codex')) {
    const files = [path.join(home, '.codex', 'config.toml'), path.join(root, '.codex', 'config.toml')].filter(exists);
    const f = files.find((x) => /isokron:begin kronicle-lite/.test(readText(x, ''))) || files[0];
    const t = f ? readText(f, '') : '';
    ok(`codex ${f ? tilde(f, home) : 'config.toml'} [mcp_servers.kronicle-lite]`, /\[mcp_servers\.kronicle-lite\]/.test(t));
    if (team) ok('codex [mcp_servers.sea_lite]', /\[mcp_servers\.sea_lite\]/.test(t));
    const py = which('python3', env);
    if (f && py) {
      const r = run(py, ['-I', '-c', 'import sys,tomllib; tomllib.load(open(sys.argv[1],"rb")); print("ok")', f], { env, timeout: 20000 });
      ok('codex config.toml parses (tomllib)', r.code === 0, r.code === 0 ? '' : r.stderr.trim().split('\n').pop());
    }
  }
  // ── Copilot
  if (last.clients.includes('copilot')) {
    const j = readJsonSafe(path.join(root, '.vscode', 'mcp.json'));
    ok('.vscode/mcp.json servers.kronicle-lite', j.ok && j.value.servers?.['kronicle-lite']);
  }
  // ── wake contract
  const mdFiles = ['CLAUDE.md', 'AGENTS.md'].map((f) => path.join(root, f)).filter((f) => hasMarkedBlock(readText(f, '')));
  const pre = /get_system_state/.test(readText(path.join(root, 'CLAUDE.md'), '') + readText(path.join(root, 'AGENTS.md'), ''));
  ok('wake contract in CLAUDE.md / AGENTS.md', mdFiles.length > 0 || pre, mdFiles.map((f) => path.basename(f)).join(', ') || 'pre-existing contract');
  // ── cc-anchor
  if (last.clients.includes('claude-code') || last.clients.includes('cursor')) {
    const script = findAnchorScript({ root, env, claudeBin: cbin });
    if (script) {
      const r = run(process.execPath, [script, 'doctor', '--json', '--root', root], { cwd: root, env, timeout: 30000 });
      let dj = null;
      try { dj = JSON.parse(r.stdout); } catch { /* reported */ }
      ok('cc-anchor card', dj && /present/.test(dj.card || ''), dj ? `${dj.card}` : r.stderr.trim());
      if (dj) ok('cc-anchor sees kronicle-lite cursor', dj.cursor && dj.cursor !== 'none', dj.cursor);
      if (dj && team) ok('cc-anchor guards (claim_guard, scope_guard)', /claim_guard=true/.test(dj.config) && /scope_guard=true/.test(dj.config), dj.config);
    } else ok('cc-anchor', false, 'anchor.mjs not found');
  }
  return { ok: checks.every((c) => c.ok), checks, profile: last.profile, clients: last.clients, team };
}

export function summary(v) {
  const L = ['', "You're set up. What changes in your next session:"];
  const c = v.clients;
  if (c.includes('claude-code')) {
    L.push('  Claude Code  start a new session (plugins load at startup):');
    L.push('               - kronicle-lite tools (get_system_state, recall, verify, put_document …); type `orient` to re-ground');
    L.push('               - the ANCHOR card is injected at session start and verbatim after every /compact; type `anchor` to re-show it');
    L.push('               - optional: /cc-anchor:anchor statusline install  (edits ~/.claude/settings.json; asks first)');
    if (v.team) L.push('               - sea-lite tools + work-queue skill; Stop is blocked once while you hold a claim; edits inside another agent\'s claimed paths are denied');
  }
  if (c.includes('cursor')) L.push('  Cursor       reload the window; enable kronicle-lite' + (v.team ? ' / sea-lite' : '') + ' under Settings > MCP; hooks (.cursor/hooks.json) and .agents/skills/orient are live');
  if (c.includes('codex')) L.push('  Codex        new `codex` session; `/mcp` lists kronicle-lite' + (v.team ? ' and sea_lite (writes prompt for approval)' : '') + '; the orient skill is in .agents/skills');
  if (c.includes('copilot')) L.push('  Copilot      VS Code agent mode: start the servers from .vscode/mcp.json; coding agent: paste the JSON shown at install into repo Settings > Copilot > MCP servers');
  if (c.includes('cowork')) L.push('  Cowork       Customize > Plugins > Add marketplace (isokron-ai/isokron-plugins) > Install');
  L.push('  Every agent  reads the wake contract: get_system_state with your last cursor before material work.');
  L.push('  Undo         node uninstall.mjs --yes  (reverses every recorded change; backups are *.bak-isokron)');
  return L.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const f = parseArgs(process.argv.slice(2));
  const cwd = f.cwd || process.cwd();
  const g = run('git', ['rev-parse', '--show-toplevel'], { cwd, timeout: 10000 });
  const root = g.code === 0 ? g.stdout.trim() : path.resolve(cwd);
  if (!exists(manifestPath(root))) console.error('note: no .isokron/setup-manifest.json; checking kronicle-lite only');
  const v = await verify({ root });
  if (f.json) console.log(JSON.stringify(v, null, 2));
  else {
    for (const c of v.checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
    if (v.ok) console.log(summary(v));
    else console.log('\nSome checks failed. Fix them or run uninstall.mjs --yes to roll back.');
  }
  process.exit(v.ok ? 0 : 1);
}
