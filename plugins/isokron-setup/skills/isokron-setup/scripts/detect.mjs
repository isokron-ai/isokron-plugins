#!/usr/bin/env node
// isokron-setup detect: find the coding agent(s) and the project, then print
// the install plan as JSON (default) or as a one-screen text summary.
// Read-only: this script never writes a file.
//
//   node detect.mjs [--cwd DIR] [--profile memory|team|ci] [--clients a,b]
//                   [--scope-mode all|project] [--goal "…"] [--adr a.md,b.md|all|none]
//                   [--server-cmd "node dist/cli.js serve"] [--server-name NAME]
//                   [--text] [--no-probe]
//
// Clients: claude-code, cowork, cursor, codex, copilot.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PINS, SOURCES, MANIFEST_REL, exists, isDir, readText, readJsonSafe, which, run, homeDir, slugify, tilde, fmtCmd,
  kronicleArgv, kronicleDataDir, catalogSnapArgv, hasMarkedBlock, prettyJson,
} from './lib.mjs';

export const PROFILES = ['memory', 'team', 'ci'];
export const CLIENTS = ['claude-code', 'cowork', 'cursor', 'codex', 'copilot'];
const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ───────────────────────────── detection ─────────────────────────────

function gitRoot(cwd, env) {
  const r = run('git', ['rev-parse', '--show-toplevel'], { cwd, env, timeout: 10000 });
  return r.code === 0 ? r.stdout.trim() : null;
}
function gitRemoteName(root, env) {
  const r = run('git', ['config', '--get', 'remote.origin.url'], { cwd: root, env, timeout: 10000 });
  if (r.code !== 0) return null;
  const m = r.stdout.trim().match(/([^/:]+?)(?:\.git)?\/?$/);
  return m ? m[1] : null;
}

function monorepoSignals(root) {
  const s = [];
  const pj = readJsonSafe(path.join(root, 'package.json'));
  if (pj.ok && pj.value.workspaces) s.push('package.json workspaces');
  for (const f of ['pnpm-workspace.yaml', 'lerna.json', 'nx.json', 'turbo.json', 'rush.json', 'go.work']) if (exists(path.join(root, f))) s.push(f);
  if (/^\s*\[workspace\]/m.test(readText(path.join(root, 'Cargo.toml'), ''))) s.push('Cargo.toml [workspace]');
  return s;
}

/** Signals that this repository ships an MCP server (relevant for the ci profile). */
function mcpServerSignals(root) {
  const s = [];
  let guess = null;
  let name = null;
  const pj = readJsonSafe(path.join(root, 'package.json'));
  if (pj.ok) {
    const deps = { ...pj.value.dependencies, ...pj.value.devDependencies, ...pj.value.peerDependencies };
    for (const d of ['@modelcontextprotocol/sdk', '@modelcontextprotocol/server', 'fastmcp', 'mcp-framework', 'mcp-handler']) if (deps && d in deps) s.push(`package.json depends on ${d}`);
    if (s.length) {
      name = String(pj.value.name || '').replace(/^@[^/]+\//, '') || null;
      const bin = typeof pj.value.bin === 'string' ? pj.value.bin : pj.value.bin ? Object.values(pj.value.bin)[0] : null;
      if (bin) guess = ['node', bin.replace(/^\.\//, '')];
      else if (pj.value.main) guess = ['node', String(pj.value.main).replace(/^\.\//, '')];
    }
  }
  const py = readText(path.join(root, 'pyproject.toml'), '');
  if (/["'\s](mcp|fastmcp)(\[[^\]]*\])?\s*([<>=~!]|["'])/m.test(py)) s.push('pyproject.toml depends on mcp/fastmcp');
  const gomod = readText(path.join(root, 'go.mod'), '');
  if (/modelcontextprotocol\/go-sdk|mark3labs\/mcp-go/.test(gomod)) s.push('go.mod requires an MCP SDK');
  if (exists(path.join(root, 'server.json'))) s.push('server.json (MCP registry manifest)');
  if (exists(path.join(root, '.mcp-catalog.json'))) s.push('.mcp-catalog.json already present');
  return { ships: s.length > 0, signals: s, guessCommand: guess, guessName: name };
}

function claudeState(env, probe) {
  const bin = which('claude', env);
  const out = { cli: bin, version: null, plugins: [], marketplaces: [], probed: false };
  if (!bin || !probe) return out;
  const v = run(bin, ['--version'], { env, timeout: 15000 });
  if (v.code === 0) out.version = v.stdout.trim().split(/\s+/)[0];
  const pl = run(bin, ['plugin', 'list', '--json'], { env, timeout: 30000 });
  try { out.plugins = JSON.parse(pl.stdout).map((p) => ({ id: p.id, version: p.version, scope: p.scope, enabled: p.enabled, installPath: p.installPath })); } catch { /* old CLI */ }
  const ml = run(bin, ['plugin', 'marketplace', 'list', '--json'], { env, timeout: 30000 });
  try { out.marketplaces = JSON.parse(ml.stdout).map((m) => ({ name: m.name, source: m.repo || m.path || m.url || m.source })); } catch { /* old CLI */ }
  out.probed = true;
  return out;
}

function desktopConfigDir(home, env) {
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Claude');
  if (process.platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Claude');
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Claude');
}

export function detect({ cwd = process.cwd(), env = process.env, probe = true } = {}) {
  const home = homeDir(env);
  const start = path.resolve(cwd);
  const groot = gitRoot(start, env);
  const root = groot || start;
  const name = gitRemoteName(root, env) || path.basename(root);
  const claudeMd = path.join(root, 'CLAUDE.md');
  const agentsMd = path.join(root, 'AGENTS.md');
  const claudeText = readText(claudeMd);
  const agentsText = readText(agentsMd);
  const readme = ['README.md', 'readme.md', 'Readme.md', 'README'].map((f) => path.join(root, f)).find(exists) || null;
  const adrDir = ['docs/adr', 'doc/adr', 'docs/decisions', 'adr'].map((d) => path.join(root, d)).find(isDir) || null;
  const adrs = adrDir ? fs.readdirSync(adrDir).filter((f) => /\.md$/i.test(f)).sort().map((f) => path.relative(root, path.join(adrDir, f))) : [];
  const wakeOutsideBlock = (t) => !!t && /get_system_state/.test(t.replace(/<!-- isokron:begin[\s\S]*?<!-- isokron:end -->/g, ''));

  const claude = claudeState(env, probe);
  const tools = {
    node: process.versions.node,
    npx: which('npx', env),
    git: which('git', env),
    jq: which('jq', env),
    bash: which('bash', env),
    claude: claude.cli,
    codex: which('codex', env),
    cursor: which('cursor', env) || which('cursor-agent', env),
    code: which('code', env),
    python3: which('python3', env),
  };

  const sig = (cond, label, out) => { if (cond) out.push(label); };
  const c = {};
  {
    const s = [];
    sig(!!claude.cli, `claude CLI ${claude.version || ''}`.trim(), s);
    sig(isDir(path.join(home, '.claude')), '~/.claude', s);
    sig(isDir(path.join(root, '.claude')), '.claude/ in project', s);
    sig(env.CLAUDECODE === '1', 'running inside Claude Code (CLAUDECODE=1)', s);
    c['claude-code'] = { detected: s.length > 0, signals: s, scriptable: !!claude.cli, running: env.CLAUDECODE === '1', ...claude };
  }
  {
    const s = [];
    const d = desktopConfigDir(home, env);
    sig(isDir(d), `Claude desktop config (${tilde(d, home)})`, s);
    c.cowork = { detected: s.length > 0, signals: s, scriptable: false };
  }
  {
    const s = [];
    sig(isDir(path.join(root, '.cursor')), '.cursor/ in project', s);
    sig(isDir(path.join(home, '.cursor')), '~/.cursor', s);
    sig(!!tools.cursor, 'cursor CLI', s);
    c.cursor = { detected: s.length > 0, signals: s, scriptable: true };
  }
  {
    const s = [];
    sig(exists(path.join(home, '.codex', 'config.toml')), '~/.codex/config.toml', s);
    sig(isDir(path.join(home, '.codex')), '~/.codex', s);
    sig(exists(path.join(root, '.codex', 'config.toml')), '.codex/config.toml in project', s);
    sig(!!tools.codex, 'codex CLI', s);
    c.codex = { detected: s.length > 0, signals: [...new Set(s)], scriptable: true };
  }
  {
    const s = [];
    sig(isDir(path.join(root, '.vscode')), '.vscode/ in project', s);
    const gh = path.join(root, '.github');
    const copilotFiles = isDir(gh) ? fs.readdirSync(gh).filter((f) => /^copilot-/.test(f)) : [];
    for (const f of copilotFiles) s.push(`.github/${f}`);
    sig(exists(path.join(root, '.vscode', 'mcp.json')), '.vscode/mcp.json', s);
    c.copilot = { detected: s.length > 0, signals: [...new Set(s)], scriptable: true };
  }

  return {
    schema: 'isokron-setup/detect@1',
    home,
    cwd: start,
    project: {
      root,
      isGit: !!groot,
      name,
      slug: slugify(name),
      subdir: groot && start !== groot ? path.relative(groot, start) : null,
      claudeMd: claudeText !== null ? claudeMd : null,
      agentsMd: agentsText !== null ? agentsMd : null,
      claudeMdImportsAgents: !!claudeText && /^@AGENTS\.md\s*$/m.test(claudeText),
      wakeContractPresent: wakeOutsideBlock(claudeText) || wakeOutsideBlock(agentsText),
      isokronBlockPresent: hasMarkedBlock(claudeText) || hasMarkedBlock(agentsText),
      readme,
      adrs,
      monorepo: monorepoSignals(root),
      mcpServer: mcpServerSignals(root),
      manifest: exists(path.join(root, MANIFEST_REL)) ? path.join(root, MANIFEST_REL) : null,
    },
    tools,
    clients: c,
  };
}

// ───────────────────────────── plan ─────────────────────────────

/** Clients to configure when the caller does not say: every detected, scriptable one. */
export function defaultClients(d) {
  const out = CLIENTS.filter((k) => d.clients[k].detected);
  return out.length ? out : ['claude-code'];
}

const serverArgs = (pkg, client) => ['-y', pkg, 'serve', '--actor', client];

/** The exact per-client MCP entries (README-documented shapes, versions pinned). */
export function clientEntries(client, profile) {
  const team = profile === 'team' || profile === 'ci';
  const k = `kronicle-lite@${PINS.kronicle}`;
  const s = `sea-lite@${PINS.sea}`;
  if (client === 'cursor') {
    const out = { 'kronicle-lite': { command: 'npx', args: serverArgs(k, 'cursor') } };
    // No --actor: the cc-anchor scope guard hook calls `sea-lite scope-check`
    // without one, so the server must run as the same (default) actor or the
    // agent's own claimed paths would read as someone else's.
    if (team) out['sea-lite'] = { type: 'stdio', command: 'npx', args: ['-y', s, 'serve'], env: { KRONICLE_LITE_DATA_DIR: '${userHome}/.kronicle-lite' } };
    return out;
  }
  if (client === 'copilot') {
    const out = { 'kronicle-lite': { type: 'stdio', command: 'npx', args: serverArgs(k, 'copilot') } };
    if (team) out['sea-lite'] = { type: 'stdio', command: 'npx', args: serverArgs(s, 'copilot') };
    return out;
  }
  if (client === 'codex') {
    const out = [{
      id: 'kronicle-lite', server: 'kronicle-lite',
      body: `[mcp_servers.kronicle-lite]\ncommand = "npx"\nargs = ["-y", "${k}", "serve", "--actor", "codex"]\n`,
    }];
    if (team) out.push({
      id: 'sea-lite', server: 'sea_lite',
      body: `[mcp_servers.sea_lite]\ncommand = "npx"\nargs = ["-y", "${s}", "serve", "--actor", "codex"]\nenv_vars = ["KRONICLE_LITE_DATA_DIR"]\nstartup_timeout_sec = 20\ndefault_tools_approval_mode = "writes"\n\n[mcp_servers.sea_lite.tools.sea_transition]\napproval_mode = "prompt"\n`,
    });
    return out;
  }
  return null;
}

export function copilotCodingAgentJson(profile) {
  const team = profile === 'team' || profile === 'ci';
  const servers = {
    'kronicle-lite': {
      type: 'local', command: 'npx',
      args: ['-y', `kronicle-lite@${PINS.kronicle}`, 'serve', '--data-dir', './.kronicle-lite', '--actor', 'copilot'],
      tools: ['get_system_state', 'audit_assumptions', 'recall', 'verify', 'verify_chain'],
    },
  };
  if (team) servers['sea-lite'] = {
    type: 'local', command: 'npx',
    args: ['-y', `sea-lite@${PINS.sea}`, 'serve', '--actor', 'copilot', '--data-dir', '/tmp/sea-lite'],
    env: { SEA_LITE_ROLE: 'agent' },
    tools: ['sea_get', 'sea_list', 'sea_history', 'sea_scope_check'],
  };
  return { mcpServers: servers };
}

export function wakeBlockBody({ profile, anchor }) {
  const lines = [
    '## IsoKron wake contract',
    '',
    'Before material work: call `get_system_state` with your previous `cursor` as',
    '`since_cursor`. Honor the drift banner; reconcile retractions BEFORE acting.',
    'Trust the chain over your own memory or a compaction summary.',
    '',
    'Manual re-ground: type the bare word `orient` to fire the orient skill.',
    '',
    'Keep receipts from `recall()` with any claim you derive; `verify()` them before',
    'building on the claim again.',
  ];
  if (anchor) lines.push('', 'After a compaction the `ANCHOR` card at the top of context is authoritative over', 'the summary; mark conflicting summary claims RETRACTED. Type `anchor` to re-inject it.');
  if (profile === 'team' || profile === 'ci') lines.push('', 'Take work from sea-lite (`sea_next` / `sea_claim`) with `scope.paths` for the files you', 'will edit; `sea_scope_check` before touching anything else; release or resolve before', 'you stop (work-queue skill).');
  return lines.join('\n');
}

const workflowYaml = () => `name: mcp-catalog
on: [push, pull_request]
jobs:
  catalog:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci --ignore-scripts=false
        if: hashFiles('package-lock.json') != ''
      - run: npm run build --if-present
        if: hashFiles('package.json') != ''
      - uses: ${SOURCES.catalogAction}
        with:
          servers-config: .mcp-catalog.json
`;

/**
 * Build the plan. Pure function of the detection result + choices; it lists
 * every file it would write and every command it would run, so the agent can
 * show it and ask once.
 */
export function plan(d, choices = {}) {
  const profile = choices.profile || 'memory';
  if (!PROFILES.includes(profile)) throw new Error(`unknown profile ${profile} (memory|team|ci)`);
  const clients = (choices.clients && choices.clients.length ? choices.clients : defaultClients(d));
  for (const k of clients) if (!CLIENTS.includes(k)) throw new Error(`unknown client ${k} (${CLIENTS.join('|')})`);
  const scopeMode = choices.scopeMode || 'all';
  const root = d.project.root;
  const home = d.home;
  const team = profile === 'team' || profile === 'ci';
  const P = (...a) => path.join(root, ...a);
  const actions = [];
  const manual = [];
  const skipped = [];
  const add = (a) => actions.push({ phase: 'install', scope: 'project', ...a });

  const cc = clients.includes('claude-code');
  const usesAnchor = cc || clients.includes('cursor');

  // ── Claude Code: marketplaces + plugins through the claude CLI
  if (cc) {
    const st = d.clients['claude-code'];
    if (!st.cli) {
      manual.push({ client: 'claude-code', text: 'Claude Code CLI not on PATH. Inside Claude Code run:\n  /plugin marketplace add rafe-walker/isokron-plugins\n  /plugin marketplace add rafe-walker/cc-anchor\n  /plugin install kronicle-lite@isokron-plugins\n  /plugin install cc-anchor@cc-anchor' + (team ? '\n  /plugin install sea-lite@isokron-plugins' : '') });
    } else {
      const cscope = choices.claudeScope || (scopeMode === 'project' || team ? 'project' : 'user');
      const mk = [
        { name: 'isokron-plugins', source: choices.marketplaceSource || process.env.ISOKRON_MARKETPLACE_SOURCE || SOURCES.isokronMarketplace },
        { name: 'cc-anchor', source: choices.ccAnchorSource || process.env.ISOKRON_CC_ANCHOR_SOURCE || SOURCES.ccAnchorMarketplace },
      ];
      for (const m of mk) {
        const have = st.marketplaces.find((x) => x.name === m.name);
        const argv = ['claude', 'plugin', 'marketplace', 'add', m.source, '--scope', cscope];
        if (have) skipped.push({ what: `marketplace ${m.name}`, why: `already configured (${have.source})` });
        else add({ kind: 'claude-marketplace', scope: cscope === 'user' ? 'user' : 'project', name: m.name, source: m.source, claudeScope: cscope, command: fmtCmd(argv), target: cscope === 'user' ? '~/.claude/settings.json' : '.claude/settings.json' });
      }
      const ids = ['kronicle-lite@isokron-plugins', 'cc-anchor@cc-anchor', ...(team ? ['sea-lite@isokron-plugins'] : [])];
      for (const id of ids) {
        const have = st.plugins.find((p) => p.id === id);
        if (have && have.enabled) { skipped.push({ what: `plugin ${id}`, why: `already installed ${have.version} (${have.scope})` }); continue; }
        add({ kind: 'claude-plugin', scope: cscope === 'user' ? 'user' : 'project', id, claudeScope: cscope, command: fmtCmd(['claude', 'plugin', 'install', id, '--scope', cscope]), target: cscope === 'user' ? '~/.claude/settings.json' : '.claude/settings.json', summary: `${id} (files go to the plugin cache under ~/.claude/plugins)` });
      }
    }
  }

  // ── Cowork: cannot be scripted
  if (clients.includes('cowork')) {
    manual.push({ client: 'cowork', text: 'Cowork (Claude desktop) cannot be scripted. In the app: Customize > Plugins > Add marketplace, enter rafe-walker/isokron-plugins; then select kronicle-lite and click Install' + (team ? ' (and sea-lite)' : '') + '. Repeat Add marketplace with rafe-walker/cc-anchor and install cc-anchor.' });
  }

  // ── Cursor: .cursor/mcp.json + cc-anchor hooks port
  if (clients.includes('cursor')) {
    const file = P('.cursor', 'mcp.json');
    for (const [name, value] of Object.entries(clientEntries('cursor', profile))) {
      add({ kind: 'json-key', file, ptr: ['mcpServers', name], value, target: '.cursor/mcp.json', summary: `mcpServers.${name}` });
    }
    add({ kind: 'cursor-hooks', target: '.cursor/hooks.json + .cursor/hooks/cc-anchor/', summary: `cc-anchor ${PINS.ccAnchorTag} Cursor hooks port (sessionStart, preCompact, postToolUse, preToolUse, stop, subagentStop)`, command: 'node <cc-anchor>/scripts/anchor.mjs cursor install --root <project>' });
  }

  // ── Codex: TOML tables
  if (clients.includes('codex')) {
    const user = scopeMode !== 'project' && choices.codexScope !== 'project';
    const file = user ? path.join(home, '.codex', 'config.toml') : P('.codex', 'config.toml');
    for (const e of clientEntries('codex', profile)) {
      add({ kind: 'toml-block', scope: user ? 'user' : 'project', file, id: e.id, server: e.server, body: e.body, target: user ? '~/.codex/config.toml' : '.codex/config.toml', summary: `[mcp_servers.${e.server}]` });
    }
    if (!user) manual.push({ client: 'codex', text: 'Codex reads .codex/config.toml only in a trusted project: approve the trust prompt the first time you run codex here.' });
  }

  // ── Copilot: .vscode/mcp.json (VS Code agent mode) + manual coding-agent JSON
  if (clients.includes('copilot')) {
    const file = P('.vscode', 'mcp.json');
    for (const [name, value] of Object.entries(clientEntries('copilot', profile))) {
      add({ kind: 'json-key', file, ptr: ['servers', name], value, target: '.vscode/mcp.json', summary: `servers.${name}` });
    }
    manual.push({ client: 'copilot', text: 'Copilot coding agent / code review read MCP config from GitHub, not from the repo. Repository Settings > Copilot > MCP servers, paste:\n' + prettyJson(copilotCodingAgentJson(profile)) });
  }

  // ── Agent Skills for non-Claude clients (.agents/skills is read by Cursor, Codex and Copilot)
  if (clients.some((k) => ['cursor', 'codex', 'copilot'].includes(k))) {
    add({ kind: 'file', file: P('.agents', 'skills', 'orient', 'SKILL.md'), from: path.join(SKILL_DIR, 'assets', 'orient-SKILL.md'), target: '.agents/skills/orient/SKILL.md', summary: 'orient skill (kronicle-lite wake protocol)' });
    if (team) add({ kind: 'file', file: P('.agents', 'skills', 'work-queue', 'SKILL.md'), from: path.join(SKILL_DIR, 'assets', 'work-queue-SKILL.md'), target: '.agents/skills/work-queue/SKILL.md', summary: 'work-queue skill (sea-lite claim loop)' });
  }

  // ── team: claim / stop / scope guards through cc-anchor's lifecycle pack
  if (team && usesAnchor) {
    for (const key of ['claim_guard', 'scope_guard']) {
      add({ kind: 'json-key', file: P('.claude', 'cc-anchor.json'), ptr: [key], value: true, target: '.claude/cc-anchor.json', summary: `${key}: true (${key === 'claim_guard' ? 'Stop is blocked once while a sea-lite claim is live' : 'Edit/Write inside another actor\'s claimed paths is denied'})` });
    }
  }
  if (team && clients.some((k) => k === 'codex' || k === 'copilot')) {
    manual.push({ client: clients.filter((k) => k === 'codex' || k === 'copilot').join(', '), text: 'No hook surface for the scope / claim guards here: the work-queue skill and sea_scope_check carry the discipline. Run `npx -y sea-lite@' + PINS.sea + ' scope-check <path>` in CI if you want a hard gate.' });
  }

  // ── ci: mcp-catalog-snap baseline + workflow (only for repos that ship an MCP server)
  if (profile === 'ci') {
    const ms = d.project.mcpServer;
    const cmd = choices.serverCmd || ms.guessCommand;
    if (!ms.ships && !choices.serverCmd) {
      skipped.push({ what: 'ci profile: catalog baseline', why: 'no MCP server detected in this repo (pass --server-cmd to force)' });
    } else if (!cmd) {
      skipped.push({ what: 'ci profile: catalog baseline', why: 'MCP server detected but its launch command is unknown; pass --server-cmd "…"' });
    } else {
      const argv = Array.isArray(cmd) ? cmd : String(cmd).split(/\s+/).filter(Boolean);
      const sname = slugify(choices.serverName || ms.guessName || d.project.name);
      add({ kind: 'file', file: P('.mcp-catalog.json'), content: JSON.stringify({ snapshotDir: '.mcp-catalog', servers: [{ name: sname, command: argv }] }, null, 2) + '\n', target: '.mcp-catalog.json', summary: `server "${sname}": ${argv.join(' ')}` });
      add({ kind: 'catalog-snapshot', target: `.mcp-catalog/${sname}.json`, name: sname, command: fmtCmd([...catalogSnapArgv({}), 'snapshot']), summary: 'capture the baseline tools/list (build the server first)' });
      add({ kind: 'file', file: P('.github', 'workflows', 'mcp-catalog.yml'), content: workflowYaml(), target: '.github/workflows/mcp-catalog.yml', summary: `${SOURCES.catalogAction} on push / pull_request` });
    }
  }

  // ── seed
  const seed = (a) => actions.push({ phase: 'seed', scope: 'project', ...a });
  const body = wakeBlockBody({ profile, anchor: usesAnchor });
  if (d.project.wakeContractPresent && !d.project.isokronBlockPresent) {
    skipped.push({ what: 'wake contract block', why: 'CLAUDE.md / AGENTS.md already mention get_system_state' });
  } else {
    // AGENTS.md is read by Cursor, Codex and Copilot; CLAUDE.md by Claude Code / Cowork.
    // A CLAUDE.md that only imports @AGENTS.md gets the block through the import.
    const claudeSide = cc || clients.includes('cowork');
    const otherSide = clients.some((k) => ['cursor', 'codex', 'copilot'].includes(k));
    const targets = [];
    if (d.project.agentsMd || otherSide) targets.push(d.project.agentsMd || P('AGENTS.md'));
    if (d.project.claudeMd ? !d.project.claudeMdImportsAgents : claudeSide) targets.push(d.project.claudeMd || P('CLAUDE.md'));
    if (!targets.length) targets.push(P('CLAUDE.md'));
    for (const f of targets) seed({ kind: 'md-block', file: f, style: 'md', body, target: path.relative(root, f), summary: exists(f) ? 'append <!-- isokron:begin/end --> wake contract' : 'create with the wake contract block' });
  }
  const ignore = ['.isokron/', '*.bak-isokron'];
  if (usesAnchor) ignore.push('.claude/cc-anchor/');
  if (clients.includes('copilot')) ignore.push('.kronicle-lite/');
  seed({ kind: 'md-block', file: P('.gitignore'), style: 'hash', body: ignore.join('\n'), target: '.gitignore', summary: `ignore ${ignore.join(' ')}` });

  const docs = [];
  if (d.project.readme) docs.push({ slug: `${d.project.slug}-readme`, file: d.project.readme, title: `${d.project.name} README` });
  // CLAUDE.md / AGENTS.md are put AFTER the block is written, so the chain holds the contract too.
  for (const f of new Set([d.project.claudeMd, d.project.agentsMd, ...actions.filter((a) => a.kind === 'md-block' && a.style === 'md').map((a) => a.file)].filter(Boolean))) {
    docs.push({ slug: `${d.project.slug}-${slugify(path.basename(f, '.md'))}-md`, file: f, title: `${d.project.name} ${path.basename(f)}` });
  }
  let adrs = [];
  if (choices.adr === 'all') adrs = d.project.adrs;
  else if (Array.isArray(choices.adr)) adrs = choices.adr.map((a) => path.relative(root, path.resolve(root, a)));
  for (const a of adrs) docs.push({ slug: `${d.project.slug}-adr-${slugify(path.basename(a, '.md'))}`, file: P(a), title: `${d.project.name} ADR ${path.basename(a, '.md')}` });
  const kl = fmtCmd(kronicleArgv({}));
  const store = tilde(kronicleDataDir({ ...process.env, ISOKRON_HOME: home }), home);
  for (const doc of docs) seed({ kind: 'kronicle-put', scope: 'user-data', ...doc, target: `${store} (doc ${doc.slug})`, command: `${kl} put ${doc.slug} ${path.relative(root, doc.file) || doc.file} --title ${JSON.stringify(doc.title)}` });

  if (usesAnchor) {
    const title = d.project.readme && (readText(d.project.readme, '').match(/^#\s+(.+)$/m) || [])[1];
    const project = title && slugify(title) !== d.project.slug ? `${d.project.name} — ${title.trim()}` : d.project.name;
    seed({ kind: 'anchor-set', project, goal: choices.goal || null, target: '.claude/anchor.md', summary: `project="${project}"${choices.goal ? `, goal="${choices.goal}"` : ' (goal left unset)'}`, command: `node <cc-anchor>/scripts/anchor.mjs set project … / set goal …` });
  }
  // Compact cursors are HMAC-bound to the actor, so orient as the actor the
  // agent's own server will run as: the Claude Code plugin starts kronicle-lite
  // without --actor (server default "local-agent"); the other clients pass
  // their name. Otherwise the agent's first get_system_state rejects the cursor.
  const orientActor = cc ? 'local-agent' : clients.includes('cursor') ? 'cursor' : clients.includes('codex') ? 'codex' : clients.includes('copilot') ? 'copilot' : 'local-agent';
  seed({ kind: 'orient', actor: orientActor, target: 'stdout', command: `${kl} orient --actor ${orientActor}`, summary: 'first orient, shown to you; cursor saved for cc-anchor' });

  const userGlobal = actions.filter((a) => a.scope === 'user').map((a) => a.target);
  return {
    schema: 'isokron-setup/plan@1',
    profile,
    clients,
    scopeMode,
    root,
    project: d.project.name,
    actions,
    manual,
    skipped,
    userGlobal: [...new Set(userGlobal)],
    userData: actions.some((a) => a.scope === 'user-data') ? [`${store} (kronicle-lite store; append-only chain)`] : [],
    commands: actions.filter((a) => a.command).map((a) => a.command),
    files: [...new Set(actions.filter((a) => a.file).map((a) => tilde(a.file, home)))],
  };
}

export function planText(p, d) {
  const L = [];
  L.push(`isokron-setup plan — profile ${p.profile}, clients ${p.clients.join(', ')}, project ${p.project} (${p.root})`);
  if (d?.project?.monorepo?.length) L.push(`monorepo (${d.project.monorepo.join(', ')}): installing at the repository root`);
  const by = (ph) => p.actions.filter((a) => a.phase === ph);
  const line = (a) => {
    const s = a.scope === 'user' ? ' [USER-GLOBAL]' : a.scope === 'user-data' ? ' [user data]' : '';
    if (a.command && /^claude|^npx|^node /.test(a.command) && a.kind !== 'kronicle-put') return `  run   ${a.command}${s}`;
    return `  ${a.kind === 'kronicle-put' ? 'put  ' : a.kind === 'orient' ? 'run  ' : 'write'} ${a.target}${a.summary ? ` — ${a.summary}` : ''}${s}`;
  };
  L.push('', 'Install:'); for (const a of by('install')) L.push(line(a));
  L.push('', 'Seed:'); for (const a of by('seed')) L.push(line(a));
  if (p.skipped.length) { L.push('', 'Skipped:'); for (const s of p.skipped) L.push(`  - ${s.what}: ${s.why}`); }
  if (p.manual.length) { L.push('', 'You do by hand:'); for (const m of p.manual) L.push(`  [${m.client}] ${m.text.split('\n').join('\n    ')}`); }
  L.push('', p.userGlobal.length ? `User-global changes needing your yes: ${p.userGlobal.join(', ')}` : 'No user-global config changes.');
  L.push('Every changed file is backed up once as <file>.bak-isokron; every change is recorded in .isokron/setup-manifest.json for uninstall.');
  return L.join('\n');
}

// ───────────────────────────── CLI ─────────────────────────────

export function parseArgs(argv) {
  const f = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { f._.push(a); continue; }
    const [k, v] = a.slice(2).split(/=(.*)/s);
    const takes = ['cwd', 'profile', 'clients', 'scope-mode', 'goal', 'adr', 'server-cmd', 'server-name', 'claude-scope', 'codex-scope', 'marketplace-source', 'cc-anchor-source'];
    if (v !== undefined) f[k] = v;
    else if (takes.includes(k)) f[k] = argv[++i];
    else f[k] = true;
  }
  return f;
}
export function choicesFromFlags(f) {
  return {
    profile: f.profile,
    clients: f.clients ? String(f.clients).split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    scopeMode: f['scope-mode'],
    goal: typeof f.goal === 'string' ? f.goal : undefined,
    adr: f.adr === undefined || f.adr === 'none' ? undefined : f.adr === 'all' ? 'all' : String(f.adr).split(',').filter(Boolean),
    serverCmd: f['server-cmd'],
    serverName: f['server-name'],
    claudeScope: f['claude-scope'],
    codexScope: f['codex-scope'],
    marketplaceSource: f['marketplace-source'],
    ccAnchorSource: f['cc-anchor-source'],
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const f = parseArgs(process.argv.slice(2));
  try {
    const d = detect({ cwd: f.cwd || process.cwd(), probe: !f['no-probe'] });
    const p = plan(d, choicesFromFlags(f));
    if (f.text) console.log(planText(p, d));
    else console.log(JSON.stringify({ detected: d, plan: p }, null, 2));
  } catch (e) {
    console.error(`isokron-setup detect: ${e.message}`);
    process.exit(2);
  }
}
