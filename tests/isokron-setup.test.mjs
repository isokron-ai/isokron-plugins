// node --test tests/
// Hermetic tests for skills/isokron-setup: every case runs in fresh temp
// dirs with a fake HOME, a PATH holding only node + git (+ a fake `claude`),
// a fake kronicle-lite CLI and a fake cc-anchor, against fixture configs for
// each client. One optional case runs the real kronicle-lite / cc-anchor
// checkouts when they are present next to this repo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const S = path.join(repo, 'skills', 'isokron-setup', 'scripts');
const FX = path.join(here, 'fixtures');
const lib = await import(path.join(S, 'lib.mjs'));
const det = await import(path.join(S, 'detect.mjs'));
const ins = await import(path.join(S, 'install.mjs'));
const uni = await import(path.join(S, 'uninstall.mjs'));
const ver = await import(path.join(S, 'verify.mjs'));

const realBin = (b) => spawnSync('bash', ['-c', `command -v ${b}`], { encoding: 'utf8' }).stdout.trim();
const NODE = process.execPath;
const GIT = realBin('git');
const PY = realBin('python3');

/** A sandbox: temp home + git repo + bin dir (node, git, optional fake claude). */
function sandbox({ claude = false, files = {}, homeFiles = {}, git = true } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'isokron-setup-test-'));
  const home = path.join(base, 'home');
  const root = path.join(base, 'repo');
  const bin = path.join(base, 'bin');
  for (const d of [home, root, bin]) fs.mkdirSync(d, { recursive: true });
  fs.symlinkSync(NODE, path.join(bin, 'node'));
  fs.symlinkSync(GIT, path.join(bin, 'git'));
  if (PY) fs.symlinkSync(PY, path.join(bin, 'python3'));
  if (claude) fs.symlinkSync(path.join(FX, 'bin', 'claude'), path.join(bin, 'claude'));
  if (git) spawnSync(GIT, ['init', '-q', root]);
  for (const [rel, src] of Object.entries(files)) put(path.join(root, rel), src);
  for (const [rel, src] of Object.entries(homeFiles)) put(path.join(home, rel), src);
  const env = {
    PATH: bin,
    HOME: home,
    ISOKRON_HOME: home,
    KRONICLE_LITE_DATA_DIR: path.join(home, '.kronicle-lite'),
    ISOKRON_KRONICLE_LITE_BIN: path.join(FX, 'fake-kronicle.mjs'),
    FAKE_CLAUDE_STATE: path.join(base, 'claude-state.json'),
    FAKE_CC_ANCHOR_DIR: path.join(FX, 'fake-cc-anchor'),
    GIT_CONFIG_NOSYSTEM: '1',
  };
  return { base, home, root, bin, env, claudeState: () => JSON.parse(fs.readFileSync(env.FAKE_CLAUDE_STATE, 'utf8')) };
}
function put(file, src) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (src.startsWith('@')) fs.copyFileSync(path.join(FX, src.slice(1)), file);
  else fs.writeFileSync(file, src);
}
const read = (f) => fs.readFileSync(f, 'utf8');
/** Snapshot every file under dirs (path → content) for byte-exact before/after comparisons. */
function snapshot(...dirs) {
  const out = {};
  const walk = (d) => { if (!fs.existsSync(d)) return; for (const n of fs.readdirSync(d)) { const p = path.join(d, n); if (n === '.git') continue; const st = fs.lstatSync(p); if (st.isDirectory()) { out[p + '/'] = ''; walk(p); } else out[p] = fs.readFileSync(p, 'utf8'); } };
  for (const d of dirs) walk(d);
  return out;
}
function setup(sb, choices = {}) {
  const d = det.detect({ cwd: sb.root, env: sb.env });
  const p = det.plan(d, choices);
  return { d, p };
}
const apply = (sb, p) => ins.applyPlan(p, { env: sb.env });
const cli = (sb, script, args) => spawnSync(NODE, [path.join(S, script), ...args], { cwd: sb.root, env: sb.env, encoding: 'utf8' });

// ───────────────────────────── lib: JSON merge ─────────────────────────────

test('mergeJsonKey creates a missing file with only our key', () => {
  const sb = sandbox();
  const f = path.join(sb.root, '.cursor', 'mcp.json');
  const r = lib.mergeJsonKey(f, ['mcpServers', 'kronicle-lite'], { command: 'npx' });
  assert.equal(r.status, 'added');
  assert.equal(r.createdFile, true);
  assert.equal(r.backup, null);
  assert.deepEqual(JSON.parse(read(f)), { mcpServers: { 'kronicle-lite': { command: 'npx' } } });
});

test('mergeJsonKey keeps unknown keys and the file\'s 4-space indent, and backs up the original', () => {
  const sb = sandbox({ files: { '.cursor/mcp.json': '@clients/cursor/mcp.json' } });
  const f = path.join(sb.root, '.cursor', 'mcp.json');
  const orig = read(f);
  const r = lib.mergeJsonKey(f, ['mcpServers', 'kronicle-lite'], { command: 'npx', args: ['-y'] });
  assert.equal(r.status, 'added');
  const j = JSON.parse(read(f));
  assert.deepEqual(j['x-unknown-top-level'], { keep: true });
  assert.ok(j.mcpServers.github.env.GITHUB_TOKEN);
  assert.match(read(f), /^ {4}"mcpServers"/m);
  assert.equal(read(f + '.bak-isokron'), orig);
});

test('mergeJsonKey is idempotent: identical value → present, nothing rewritten', () => {
  const sb = sandbox();
  const f = path.join(sb.root, 'x.json');
  lib.mergeJsonKey(f, ['a', 'b'], { k: [1, 2] });
  const before = read(f);
  const r = lib.mergeJsonKey(f, ['a', 'b'], { k: [1, 2] });
  assert.equal(r.status, 'present');
  assert.equal(read(f), before);
  assert.equal(fs.existsSync(f + '.bak-isokron'), false);
});

test('mergeJsonKey never clobbers a key the user already set', () => {
  const sb = sandbox({ files: { 'x.json': '{ "mcpServers": { "kronicle-lite": { "command": "mine" } } }\n' } });
  const f = path.join(sb.root, 'x.json');
  const before = read(f);
  const r = lib.mergeJsonKey(f, ['mcpServers', 'kronicle-lite'], { command: 'npx' });
  assert.equal(r.status, 'conflict');
  assert.equal(read(f), before);
});

test('mergeJsonKey refuses JSONC (comments, trailing commas) instead of rewriting it', () => {
  const sb = sandbox({ files: { '.cursor/mcp.json': '@clients/cursor/mcp.jsonc' } });
  const f = path.join(sb.root, '.cursor', 'mcp.json');
  const before = read(f);
  const r = lib.mergeJsonKey(f, ['mcpServers', 'kronicle-lite'], { command: 'npx' });
  assert.equal(r.status, 'unparseable');
  assert.equal(read(f), before);
});

test('backupOnce never overwrites the first backup unless asked for a fresh one', () => {
  const sb = sandbox({ files: { 'a.txt': 'v1' } });
  const f = path.join(sb.root, 'a.txt');
  lib.backupOnce(f);
  fs.writeFileSync(f, 'v2');
  lib.backupOnce(f);
  assert.equal(read(f + '.bak-isokron'), 'v1');
  lib.backupOnce(f, { fresh: true });
  assert.equal(read(f + '.bak-isokron'), 'v2');
});

test('unmergeJsonKey removes our key, prunes parents we created, and leaves edited values alone', () => {
  const sb = sandbox({ files: { 'x.json': '{ "keep": 1 }\n' } });
  const f = path.join(sb.root, 'x.json');
  const parents = lib.missingParents(f, ['servers', 'k']);
  assert.deepEqual(parents, ['servers']);
  lib.mergeJsonKey(f, ['servers', 'k'], { a: 1 });
  assert.equal(lib.unmergeJsonKey(f, ['servers', 'k'], { a: 2 }).status, 'modified');
  assert.equal(lib.unmergeJsonKey(f, ['servers', 'k'], { a: 1 }, { createdParents: parents }).status, 'removed');
  assert.deepEqual(JSON.parse(read(f)), { keep: 1 });
});

// ───────────────────────────── lib: TOML ─────────────────────────────

test('tomlHasServer sees every spelling of an existing server', () => {
  assert.ok(lib.tomlHasServer('[mcp_servers.kronicle-lite]\ncommand="x"\n', 'kronicle-lite'));
  assert.ok(lib.tomlHasServer('[mcp_servers."kronicle-lite"]\n', 'kronicle-lite'));
  assert.ok(lib.tomlHasServer('[mcp_servers.sea_lite.tools.x]\n', 'sea_lite'));
  assert.ok(lib.tomlHasServer('mcp_servers.sea_lite.command = "x"\n', 'sea_lite'));
  assert.ok(lib.tomlHasServer('[mcp_servers]\nsea_lite = { command = "x" }\n', 'sea_lite'));
  assert.ok(lib.tomlHasServer('mcp_servers = { sea_lite = { command = "x" } }\n', 'sea_lite'));
  assert.ok(!lib.tomlHasServer('[mcp_servers.github]\n# sea_lite later\n', 'sea_lite'));
  assert.ok(!lib.tomlHasServer('[profiles.x]\nsea_lite = 1\n', 'sea_lite'));
});

test('mergeTomlBlock appends marked tables, keeps every other table, and is idempotent', () => {
  const sb = sandbox({ homeFiles: { '.codex/config.toml': '@clients/codex/config.toml' } });
  const f = path.join(sb.home, '.codex', 'config.toml');
  const orig = read(f);
  const [e] = det.clientEntries('codex', 'memory');
  assert.equal(lib.mergeTomlBlock(f, e.id, e.server, e.body).status, 'added');
  const after = read(f);
  assert.ok(after.startsWith(orig));
  assert.match(after, /# isokron:begin kronicle-lite[^\n]*\n\[mcp_servers\.kronicle-lite\]\ncommand = "npx"\nargs = \["-y", "kronicle-lite@0\.10\.0", "serve", "--actor", "codex"\]\n# isokron:end kronicle-lite\n$/);
  assert.equal(lib.mergeTomlBlock(f, e.id, e.server, e.body).status, 'present');
  assert.equal(read(f), after);
});

test('mergeTomlBlock leaves an already-configured server alone', () => {
  const sb = sandbox({ homeFiles: { '.codex/config.toml': '@clients/codex/config-has-kronicle.toml' } });
  const f = path.join(sb.home, '.codex', 'config.toml');
  const before = read(f);
  const [e] = det.clientEntries('codex', 'memory');
  assert.equal(lib.mergeTomlBlock(f, e.id, e.server, e.body).status, 'conflict');
  assert.equal(read(f), before);
});

test('unmergeTomlBlock restores the original text exactly', () => {
  const sb = sandbox({ homeFiles: { '.codex/config.toml': '@clients/codex/config.toml' } });
  const f = path.join(sb.home, '.codex', 'config.toml');
  const orig = read(f);
  for (const e of det.clientEntries('codex', 'team')) lib.mergeTomlBlock(f, e.id, e.server, e.body);
  lib.unmergeTomlBlock(f, 'sea-lite');
  lib.unmergeTomlBlock(f, 'kronicle-lite');
  assert.equal(read(f), orig);
});

test('the merged Codex config parses as TOML (python tomllib)', { skip: !PY && 'python3 not available' }, () => {
  const sb = sandbox({ homeFiles: { '.codex/config.toml': '@clients/codex/config.toml' } });
  const f = path.join(sb.home, '.codex', 'config.toml');
  for (const e of det.clientEntries('codex', 'team')) lib.mergeTomlBlock(f, e.id, e.server, e.body);
  const r = spawnSync(PY, ['-I', '-c', 'import sys,tomllib,json; print(json.dumps(tomllib.load(open(sys.argv[1],"rb"))["mcp_servers"]))', f], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const s = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(s).sort(), ['github', 'kronicle-lite', 'sea_lite']);
  assert.equal(s.sea_lite.tools.sea_transition.approval_mode, 'prompt');
  assert.equal(s.github.env.GITHUB_TOKEN, 'x');
});

// ───────────────────────────── lib: marked blocks ─────────────────────────────

test('upsertMarkedBlock adds, is a no-op on re-run, and updates in place', () => {
  const sb = sandbox({ files: { 'AGENTS.md': '@clients/claude/AGENTS.md' } });
  const f = path.join(sb.root, 'AGENTS.md');
  assert.equal(lib.upsertMarkedBlock(f, 'one').status, 'added');
  assert.equal(lib.upsertMarkedBlock(f, 'one').status, 'present');
  assert.equal(lib.upsertMarkedBlock(f, 'two').status, 'updated');
  const t = read(f);
  assert.equal((t.match(/isokron:begin/g) || []).length, 1);
  assert.match(t, /<!-- isokron:begin -->\ntwo\n<!-- isokron:end -->\n$/);
});

test('removeMarkedBlock gives back the original Markdown and .gitignore byte for byte', () => {
  const sb = sandbox({ files: { 'AGENTS.md': '@clients/claude/AGENTS.md', '.gitignore': 'node_modules/\n' } });
  for (const [rel, style] of [['AGENTS.md', 'md'], ['.gitignore', 'hash']]) {
    const f = path.join(sb.root, rel);
    const orig = read(f);
    lib.upsertMarkedBlock(f, 'a\nb', { style });
    assert.ok(lib.hasMarkedBlock(read(f), style));
    assert.equal(lib.removeMarkedBlock(f, { style }).status, 'removed');
    assert.equal(read(f), orig);
  }
});

test('slugify yields kronicle-lite-safe slugs', () => {
  assert.equal(lib.slugify('My Repo!'), 'my-repo');
  assert.equal(lib.slugify('@scope/pkg.name'), 'scope-pkg.name');
  assert.match(lib.slugify('___'), /^[a-z0-9][a-z0-9._-]*$/);
});

// ───────────────────────────── detect ─────────────────────────────

test('detect finds Claude Code through the CLI and ~/.claude, with its plugins and marketplaces', () => {
  const sb = sandbox({ claude: true, homeFiles: { '.claude/settings.json': '{}' } });
  fs.writeFileSync(sb.env.FAKE_CLAUDE_STATE, JSON.stringify({ marketplaces: [{ name: 'isokron-plugins', repo: 'rafe-walker/isokron-plugins' }], plugins: [{ id: 'kronicle-lite@isokron-plugins', version: '0.3.0', scope: 'user', enabled: true }], calls: [] }));
  const d = det.detect({ cwd: sb.root, env: sb.env });
  const c = d.clients['claude-code'];
  assert.equal(c.detected, true);
  assert.equal(c.version, '2.1.316');
  assert.deepEqual(c.marketplaces.map((m) => m.name), ['isokron-plugins']);
  assert.ok(c.plugins.some((p) => p.id === 'kronicle-lite@isokron-plugins'));
});

test('detect finds Cursor, Codex and Copilot from their fixture configs', () => {
  const sb = sandbox({
    files: { '.cursor/mcp.json': '@clients/cursor/mcp.json', '.github/copilot-instructions.md': '@clients/copilot/copilot-instructions.md' },
    homeFiles: { '.codex/config.toml': '@clients/codex/config.toml' },
  });
  const d = det.detect({ cwd: sb.root, env: sb.env });
  assert.equal(d.clients.cursor.detected, true);
  assert.equal(d.clients.codex.detected, true);
  assert.ok(d.clients.codex.signals.includes('~/.codex/config.toml'));
  assert.equal(d.clients.copilot.detected, true);
  assert.ok(d.clients.copilot.signals.includes('.github/copilot-instructions.md'));
  assert.equal(d.clients['claude-code'].detected, false);
  assert.deepEqual(det.defaultClients(d), ['cursor', 'codex', 'copilot']);
});

test('detect with no client signals defaults to Claude Code; Cowork is detected but not scriptable', () => {
  const sb = sandbox();
  assert.deepEqual(det.defaultClients(det.detect({ cwd: sb.root, env: sb.env })), ['claude-code']);
  fs.mkdirSync(path.join(sb.home, '.config', 'Claude'), { recursive: true });
  const d = det.detect({ cwd: sb.root, env: sb.env });
  if (process.platform === 'linux') assert.equal(d.clients.cowork.detected, true);
  assert.equal(d.clients.cowork.scriptable, false);
});

test('detect reports git root from a subdirectory, monorepo signals, README, ADRs and a CLAUDE.md that imports AGENTS.md', () => {
  const sb = sandbox({
    files: {
      'package.json': '{ "name": "mono", "workspaces": ["packages/*"] }',
      'pnpm-workspace.yaml': 'packages: ["packages/*"]\n',
      'packages/a/index.js': '',
      'README.md': '# Mono\n',
      'docs/adr/0002-b.md': '# B\n',
      'docs/adr/0001-a.md': '# A\n',
      'CLAUDE.md': '@clients/claude/CLAUDE.md',
      'AGENTS.md': '@clients/claude/AGENTS.md',
    },
  });
  const d = det.detect({ cwd: path.join(sb.root, 'packages', 'a'), env: sb.env });
  assert.equal(fs.realpathSync(d.project.root), fs.realpathSync(sb.root));
  assert.equal(d.project.subdir, path.join('packages', 'a'));
  assert.deepEqual(d.project.monorepo, ['package.json workspaces', 'pnpm-workspace.yaml']);
  assert.deepEqual(d.project.adrs, ['docs/adr/0001-a.md', 'docs/adr/0002-b.md']);
  assert.equal(d.project.claudeMdImportsAgents, true);
  assert.ok(d.project.readme.endsWith('README.md'));
});

test('detect spots a repo that ships an MCP server and guesses its launch command', () => {
  const sb = sandbox({ files: { 'package.json': JSON.stringify({ name: '@acme/weather-mcp', bin: { 'weather-mcp': './dist/cli.js' }, dependencies: { '@modelcontextprotocol/sdk': '^1.0.0' } }) } });
  const ms = det.detect({ cwd: sb.root, env: sb.env }).project.mcpServer;
  assert.equal(ms.ships, true);
  assert.deepEqual(ms.guessCommand, ['node', 'dist/cli.js']);
  assert.equal(ms.guessName, 'weather-mcp');
});

// ───────────────────────────── plan ─────────────────────────────

test('plan(memory, claude-code) adds both marketplaces and the two plugins at user scope', () => {
  const sb = sandbox({ claude: true });
  const { p } = setup(sb, { clients: ['claude-code'] });
  const cmds = p.actions.filter((a) => a.kind.startsWith('claude-')).map((a) => a.command);
  assert.deepEqual(cmds, [
    'claude plugin marketplace add rafe-walker/isokron-plugins --scope user',
    "claude plugin marketplace add 'rafe-walker/cc-anchor#v0.6.0' --scope user",
    'claude plugin install kronicle-lite@isokron-plugins --scope user',
    'claude plugin install cc-anchor@cc-anchor --scope user',
  ]);
  assert.ok(p.userGlobal.includes('~/.claude/settings.json'));
});

test('plan skips what Claude Code already has and uses project scope for team', () => {
  const sb = sandbox({ claude: true });
  fs.writeFileSync(sb.env.FAKE_CLAUDE_STATE, JSON.stringify({ marketplaces: [{ name: 'isokron-plugins', repo: 'x' }], plugins: [{ id: 'kronicle-lite@isokron-plugins', version: '0.3.0', scope: 'user', enabled: true }], calls: [] }));
  const { p } = setup(sb, { clients: ['claude-code'], profile: 'team' });
  const ids = p.actions.filter((a) => a.kind === 'claude-plugin').map((a) => a.id);
  assert.deepEqual(ids, ['cc-anchor@cc-anchor', 'sea-lite@isokron-plugins']);
  assert.ok(p.actions.filter((a) => a.kind.startsWith('claude-')).every((a) => a.claudeScope === 'project'));
  assert.ok(p.skipped.some((s) => /plugin kronicle-lite/.test(s.what)));
  const guards = p.actions.filter((a) => a.file?.endsWith('cc-anchor.json')).map((a) => a.ptr[0]);
  assert.deepEqual(guards, ['claim_guard', 'scope_guard']);
});

test('plan marks ~/.codex/config.toml user-global; --scope-mode project moves it into the repo', () => {
  const sb = sandbox();
  const a = setup(sb, { clients: ['codex'] }).p;
  assert.deepEqual(a.userGlobal, ['~/.codex/config.toml']);
  const b = setup(sb, { clients: ['codex'], scopeMode: 'project' }).p;
  assert.deepEqual(b.userGlobal, []);
  assert.ok(b.actions.some((x) => x.file === path.join(sb.root, '.codex', 'config.toml')));
  assert.ok(b.manual.some((m) => /trusted project/.test(m.text)));
});

test('plan puts the wake block in AGENTS.md only when CLAUDE.md just imports it, and skips an existing contract', () => {
  const sb = sandbox({ files: { 'CLAUDE.md': '@clients/claude/CLAUDE.md', 'AGENTS.md': '@clients/claude/AGENTS.md' } });
  const blocks = setup(sb, { clients: ['claude-code', 'cursor'] }).p.actions.filter((a) => a.kind === 'md-block' && a.style === 'md').map((a) => a.target);
  assert.deepEqual(blocks, ['AGENTS.md']);
  const sb2 = sandbox({ files: { 'CLAUDE.md': '# x\nBefore material work: call `get_system_state` …\n' } });
  const p2 = setup(sb2, { clients: ['claude-code'] }).p;
  assert.equal(p2.actions.filter((a) => a.kind === 'md-block' && a.style === 'md').length, 0);
  assert.ok(p2.skipped.some((s) => s.what === 'wake contract block'));
});

test('plan for Cowork is manual only, and per-client entries match the READMEs', () => {
  const sb = sandbox();
  const p = setup(sb, { clients: ['cowork'] }).p;
  assert.equal(p.actions.filter((a) => a.phase === 'install').length, 0);
  assert.match(p.manual[0].text, /Customize > Plugins > Add marketplace/);
  const cur = det.clientEntries('cursor', 'team');
  assert.deepEqual(cur['kronicle-lite'].args, ['-y', 'kronicle-lite@0.10.0', 'serve', '--actor', 'cursor']);
  // sea-lite README's Cursor entry (tested): --actor cursor, store pinned to the default dir
  assert.deepEqual(cur['sea-lite'].args, ['-y', 'sea-lite@0.7.1', 'serve', '--actor', 'cursor']);
  assert.equal(cur['sea-lite'].env.KRONICLE_LITE_DATA_DIR, '${userHome}/.kronicle-lite');
  assert.equal(det.clientEntries('copilot', 'memory')['kronicle-lite'].type, 'stdio');
  assert.deepEqual(det.copilotCodingAgentJson('memory').mcpServers['kronicle-lite'].tools, ['get_system_state', 'audit_assumptions', 'recall', 'verify', 'verify_chain']);
});

test('no client entry moves the store with --data-dir (the exec-time pulse shims only see the default store, P2-01)', () => {
  const entries = [];
  for (const profile of ['memory', 'team', 'ci']) {
    for (const client of ['cursor', 'copilot']) entries.push(...Object.values(det.clientEntries(client, profile)).map((e) => e.args));
    for (const block of det.clientEntries('codex', profile)) entries.push([block.body]);
    entries.push(...Object.values(det.copilotCodingAgentJson(profile).mcpServers).map((e) => e.args));
  }
  assert.ok(entries.length >= 12);
  for (const args of entries) assert.ok(!args.some((a) => /--data-dir/.test(a)), `unexpected --data-dir in ${JSON.stringify(args)}`);
  // and the reference doc the skill points users at says the same
  const doc = fs.readFileSync(path.join(repo, 'skills', 'isokron-setup', 'references', 'clients.md'), 'utf8');
  assert.ok(!/"--data-dir"|--data-dir\s+\S/.test(doc.replace(/`--data-dir`/g, '')), 'clients.md snippets must not pass --data-dir');
});

test('clients.md Hermes snippet: pinned versions, stdio via npx, data dir forwarded not overridden', () => {
  const doc = fs.readFileSync(path.join(repo, 'skills', 'isokron-setup', 'references', 'clients.md'), 'utf8');
  const sec = doc.slice(doc.indexOf('## Hermes Agent'));
  const yaml = (sec.match(/```yaml\n([\s\S]*?)```/) || [])[1];
  assert.ok(yaml && /^mcp_servers:\n/.test(yaml), 'Hermes section has a mcp_servers YAML block');
  assert.ok(yaml.includes(`args: ["-y", "kronicle-lite@${lib.PINS.kronicle}", "serve", "--actor", "hermes"]`));
  assert.ok(yaml.includes(`args: ["-y", "sea-lite@${lib.PINS.sea}", "serve", "--actor", "hermes"]`));
  assert.equal((yaml.match(/command: "npx"/g) || []).length, 2);
  assert.equal((yaml.match(/KRONICLE_LITE_DATA_DIR: "\$\{KRONICLE_LITE_DATA_DIR\}"/g) || []).length, 2);
  assert.ok(!yaml.includes('--data-dir'));
});

test('first orient runs as the actor the agent\'s server will use (compact cursors are actor-bound)', () => {
  const sb = sandbox();
  const actor = (clients) => setup(sb, { clients }).p.actions.find((a) => a.kind === 'orient').actor;
  assert.equal(actor(['claude-code', 'cursor']), 'local-agent');
  assert.equal(actor(['cursor', 'codex']), 'cursor');
  assert.equal(actor(['codex']), 'codex');
  assert.equal(actor(['copilot']), 'copilot');
});

test('plan(ci) adds the catalog baseline only for MCP-server repos', () => {
  const sb = sandbox();
  const p = setup(sb, { clients: ['claude-code'], profile: 'ci' }).p;
  assert.ok(p.skipped.some((s) => /no MCP server detected/.test(s.why)));
  const sb2 = sandbox({ files: { 'package.json': JSON.stringify({ name: 'srv', bin: 'cli.js', dependencies: { '@modelcontextprotocol/sdk': '1' } }) } });
  const p2 = setup(sb2, { clients: ['claude-code'], profile: 'ci' }).p;
  assert.deepEqual(p2.actions.filter((a) => a.file?.includes('mcp-catalog') || a.kind === 'catalog-snapshot').map((a) => a.target), ['.mcp-catalog.json', '.mcp-catalog/srv.json', '.github/workflows/mcp-catalog.yml']);
  const wf = p2.actions.find((a) => a.target === '.github/workflows/mcp-catalog.yml').content;
  assert.match(wf, /uses: rafe-walker\/mcp-catalog-snap@v0\.1\.0/);
});

// ───────────────────────────── install / uninstall ─────────────────────────────

const ALL = ['claude-code', 'cursor', 'codex', 'copilot'];
function fullSandbox() {
  return sandbox({
    claude: true,
    files: {
      'README.md': '# Widget Service\n\nServes widgets.\n',
      '.cursor/mcp.json': '@clients/cursor/mcp.json',
      '.cursor/hooks.json': '@clients/cursor/hooks.json',
      '.vscode/mcp.json': '@clients/copilot/mcp.json',
      '.gitignore': 'node_modules/\n',
      'CLAUDE.md': '# Project rules\n\nUse tabs.\n',
      'docs/adr/0001-use-sqlite.md': '# Use SQLite\n',
    },
    homeFiles: { '.codex/config.toml': '@clients/codex/config.toml' },
  });
}

test('install.mjs writes nothing without --yes (exit 3) and refuses user-global edits without --user-global-ok (exit 4)', () => {
  const sb = fullSandbox();
  const before = snapshot(sb.root, sb.home);
  const r = cli(sb, 'install.mjs', ['--clients', 'cursor,codex', '--no-probe']);
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stdout, /Nothing written/);
  const r2 = cli(sb, 'install.mjs', ['--clients', 'cursor,codex', '--no-probe', '--yes']);
  assert.equal(r2.status, 4, r2.stderr);
  assert.match(r2.stdout, /Refusing: the plan edits user-global config \(~\/\.codex\/config\.toml\)/);
  assert.deepEqual(snapshot(sb.root, sb.home), before);
});

test('install (team, all clients) merges every fixture config without losing a key and seeds the project', () => {
  const sb = fullSandbox();
  const { p } = setup(sb, { clients: ALL, profile: 'team', adr: 'all', goal: 'Ship v2' });
  const out = apply(sb, p);
  assert.equal(out.ok, true, JSON.stringify(out.results.filter((r) => r.status === 'failed')));
  const cur = JSON.parse(read(path.join(sb.root, '.cursor', 'mcp.json')));
  assert.deepEqual(Object.keys(cur.mcpServers), ['github', 'kronicle-lite', 'sea-lite']);
  assert.deepEqual(cur['x-unknown-top-level'], { keep: true });
  const hooks = JSON.parse(read(path.join(sb.root, '.cursor', 'hooks.json')));
  assert.deepEqual(hooks.hooks.afterFileEdit, [{ command: './hooks/format.sh' }]);
  assert.equal(hooks.hooks.stop.length, 2);
  const vs = JSON.parse(read(path.join(sb.root, '.vscode', 'mcp.json')));
  assert.deepEqual(Object.keys(vs.servers), ['playwright', 'kronicle-lite', 'sea-lite']);
  assert.equal(vs.inputs[0].id, 'token');
  assert.match(read(path.join(sb.home, '.codex', 'config.toml')), /\[profiles\.fast\][\s\S]*\[mcp_servers\.kronicle-lite\][\s\S]*\[mcp_servers\.sea_lite\]/);
  assert.match(read(path.join(sb.root, 'CLAUDE.md')), /^# Project rules\n\nUse tabs\.\n\n<!-- isokron:begin -->\n## IsoKron wake contract/);
  assert.match(read(path.join(sb.root, 'AGENTS.md')), /get_system_state/);
  assert.match(read(path.join(sb.root, '.gitignore')), /^node_modules\/\n\n# isokron:begin\n\.isokron\/\n\*\.bak-isokron\n\.claude\/cc-anchor\//);
  assert.ok(fs.existsSync(path.join(sb.root, '.agents', 'skills', 'work-queue', 'SKILL.md')));
  assert.match(read(path.join(sb.root, '.claude', 'anchor.md')), /Project: repo — Widget Service\nGoal: Ship v2/);
  assert.equal(read(path.join(sb.root, '.claude', 'cc-anchor', 'cursor')).trim(), 'sxt1c.4.FAKE');
  const docs = Object.keys(JSON.parse(read(path.join(sb.env.KRONICLE_LITE_DATA_DIR, 'fake.json'))).docs).sort();
  assert.deepEqual(docs, ['repo-adr-0001-use-sqlite', 'repo-agents-md', 'repo-claude-md', 'repo-readme']);
  for (const f of ['.cursor/mcp.json', '.cursor/hooks.json', '.vscode/mcp.json', 'CLAUDE.md', '.gitignore']) assert.ok(fs.existsSync(path.join(sb.root, f + '.bak-isokron')), f);
  assert.match(out.orient, /cursor_compact/);
});

test('parsePutOutput reads the put --json object and the plain-text line', () => {
  const json = JSON.stringify({ slug: 'repo-readme', revision: 2, blocks: [], head: { seq: 7, hash: 'ab' }, stale_write_advisory: { advisory: false } }, null, 2);
  assert.deepEqual(lib.parsePutOutput(json + '\n'), { revision: 2, seq: 7 });
  assert.deepEqual(lib.parsePutOutput('runbook rev 1: 1 new, 0 changed, 0 removed, 0 unchanged block(s); head seq 2\n'), { revision: 1, seq: 2 });
  assert.deepEqual(lib.parsePutOutput('repo-readme rev 3: 0 new, 1 changed, 0 removed, 4 unchanged block(s); head seq 41 (bound to README.md @ 0123456789ab)\n'), { revision: 3, seq: 41 });
  assert.equal(lib.parsePutOutput(''), null);
  assert.equal(lib.parsePutOutput('{"ok": true}'), null);
  assert.equal(lib.parsePutOutput('warning: something else'), null);
});

test('install reports the revision and chain seq of each seeded document, from JSON or plain-text put output', () => {
  for (const plain of [false, true]) {
    const sb = fullSandbox();
    if (plain) sb.env.FAKE_KRONICLE_PUT_PLAIN = '1';
    const out = apply(sb, setup(sb, { clients: ['cursor'] }).p);
    const puts = out.results.filter((r) => r.kind === 'kronicle-put');
    assert.ok(puts.length > 0);
    for (const r of puts) assert.match(r.detail, /^rev 1, chain seq \d+$/, `plain=${plain}: ${JSON.stringify(r)}`);
  }
});

test('install runs the exact claude plugin commands, in order', () => {
  const sb = fullSandbox();
  apply(sb, setup(sb, { clients: ['claude-code'], profile: 'team' }).p);
  const calls = sb.claudeState().calls.filter((c) => ['add', 'install'].includes(c[1]) || c[2] === 'add').map((c) => c.join(' '));
  assert.deepEqual(calls, [
    'plugin marketplace add rafe-walker/isokron-plugins --scope project',
    'plugin marketplace add rafe-walker/cc-anchor#v0.6.0 --scope project',
    'plugin install kronicle-lite@isokron-plugins --scope project',
    'plugin install cc-anchor@cc-anchor --scope project',
    'plugin install sea-lite@isokron-plugins --scope project',
  ]);
});

test('a second install is a no-op: everything present, no new manifest entries, no new backups', () => {
  const sb = fullSandbox();
  const choices = { clients: ALL, profile: 'team', adr: 'all', goal: 'Ship v2' };
  apply(sb, setup(sb, choices).p);
  const m1 = JSON.parse(read(lib.manifestPath(sb.root)));
  const files1 = snapshot(sb.root, sb.home);
  const out = apply(sb, setup(sb, choices).p);
  const statuses = new Set(out.results.map((r) => r.status));
  assert.ok(!statuses.has('added') || out.results.filter((r) => r.status === 'added').every((r) => r.kind === 'cursor-hooks'), JSON.stringify(out.results.filter((r) => r.status === 'added')));
  const m2 = JSON.parse(read(lib.manifestPath(sb.root)));
  assert.equal(m2.changes.length, m1.changes.length);
  const backups = (s) => Object.keys(s).filter((k) => k.endsWith('.bak-isokron')).sort();
  assert.deepEqual(backups(snapshot(sb.root, sb.home)), backups(files1));
  assert.equal(sb.claudeState().plugins.length, 3);
});

test('uninstall restores every fixture file byte for byte and removes what install created', () => {
  const sb = fullSandbox();
  const before = snapshot(sb.root, sb.home);
  apply(sb, setup(sb, { clients: ALL, profile: 'team', adr: 'all', goal: 'Ship v2' }).p);
  const out = uni.uninstall({ root: sb.root, env: sb.env });
  assert.equal(out.ok, true, JSON.stringify(out.results));
  const after = snapshot(sb.root, sb.home);
  delete before[path.join(sb.home, '.kronicle-lite') + '/'];
  for (const k of Object.keys(after)) if (k.startsWith(path.join(sb.home, '.kronicle-lite'))) delete after[k];
  assert.deepEqual(after, before);
  const st = sb.claudeState();
  assert.deepEqual(st.plugins, []);
  assert.deepEqual(st.marketplaces, []);
});

test('uninstall keeps edits the user made after install and keeps the backup for them', () => {
  const sb = fullSandbox();
  apply(sb, setup(sb, { clients: ['cursor'], profile: 'memory' }).p);
  const f = path.join(sb.root, '.cursor', 'mcp.json');
  const j = JSON.parse(read(f));
  j.mcpServers.mine = { command: 'mine' };
  fs.writeFileSync(f, JSON.stringify(j, null, 2));
  uni.uninstall({ root: sb.root, env: sb.env });
  const k = JSON.parse(read(f));
  assert.deepEqual(Object.keys(k.mcpServers), ['github', 'mine']);
  assert.ok(fs.existsSync(f + '.bak-isokron'));
});

test('uninstall only removes plugins and marketplaces that install added', () => {
  const sb = fullSandbox();
  fs.writeFileSync(sb.env.FAKE_CLAUDE_STATE, JSON.stringify({ marketplaces: [{ name: 'isokron-plugins', repo: 'rafe-walker/isokron-plugins' }], plugins: [{ id: 'kronicle-lite@isokron-plugins', version: '0.3.0', scope: 'user', enabled: true }], calls: [] }));
  apply(sb, setup(sb, { clients: ['claude-code'] }).p);
  uni.uninstall({ root: sb.root, env: sb.env });
  const st = sb.claudeState();
  assert.deepEqual(st.plugins.map((p) => p.id), ['kronicle-lite@isokron-plugins']);
  assert.deepEqual(st.marketplaces.map((m) => m.name), ['isokron-plugins']);
});

test('uninstall keeps what it could not reverse in the manifest so a re-run can finish', () => {
  const sb = fullSandbox();
  apply(sb, setup(sb, { clients: ['claude-code', 'cursor'] }).p);
  const out = uni.uninstall({ root: sb.root, env: { ...sb.env, PATH: path.join(sb.base, 'nowhere') }, claudeBin: null });
  assert.equal(out.ok, false);
  const left = JSON.parse(read(lib.manifestPath(sb.root))).changes.map((c) => c.type);
  assert.deepEqual([...new Set(left)], ['claude-marketplace', 'claude-plugin']);
  const again = uni.uninstall({ root: sb.root, env: sb.env });
  assert.equal(again.ok, true);
  assert.deepEqual(sb.claudeState().plugins, []);
  assert.equal(fs.existsSync(lib.manifestPath(sb.root)), false);
});

test('uninstall.mjs without --yes is a dry run', () => {
  const sb = fullSandbox();
  apply(sb, setup(sb, { clients: ['cursor', 'codex'] }).p);
  const before = snapshot(sb.root, sb.home);
  const r = cli(sb, 'uninstall.mjs', []);
  assert.equal(r.status, 3);
  assert.match(r.stdout, /Would reverse \d+ change\(s\)/);
  assert.deepEqual(snapshot(sb.root, sb.home), before);
});

test('uninstall --no-manifest strips the marked blocks and restores backups', () => {
  const sb = fullSandbox();
  const before = snapshot(sb.root, sb.home);
  apply(sb, setup(sb, { clients: ['cursor', 'codex'] }).p);
  fs.rmSync(lib.manifestPath(sb.root));
  const out = uni.uninstallNoManifest({ root: sb.root, env: sb.env });
  assert.ok(out.results.some((r) => /restored/.test(r.status)));
  assert.equal(read(path.join(sb.home, '.codex', 'config.toml')), before[path.join(sb.home, '.codex', 'config.toml')]);
  assert.equal(read(path.join(sb.root, 'CLAUDE.md')), before[path.join(sb.root, 'CLAUDE.md')]);
  assert.equal(read(path.join(sb.root, '.cursor', 'mcp.json')), before[path.join(sb.root, '.cursor', 'mcp.json')]);
});

test('a JSONC config is reported as manual, not rewritten, and the rest of the install proceeds', () => {
  const sb = sandbox({ files: { '.cursor/mcp.json': '@clients/cursor/mcp.jsonc', 'README.md': '# R\n' } });
  const f = path.join(sb.root, '.cursor', 'mcp.json');
  const before = read(f);
  sb.env.ISOKRON_CC_ANCHOR_DIR = path.join(FX, 'fake-cc-anchor');
  const out = apply(sb, setup(sb, { clients: ['cursor'] }).p);
  assert.equal(read(f), before);
  assert.ok(out.results.some((r) => r.status === 'unparseable'));
  assert.ok(out.results.some((r) => r.kind === 'cursor-hooks' && r.status === 'added'));
});

test('verify passes after install and its summary names each configured client', async () => {
  const sb = fullSandbox();
  apply(sb, setup(sb, { clients: ALL, profile: 'team', adr: 'all' }).p);
  const v = await ver.verify({ root: sb.root, env: sb.env });
  assert.equal(v.ok, true, JSON.stringify(v.checks.filter((c) => !c.ok)));
  assert.ok(v.checks.some((c) => /recall over MCP stdio/.test(c.name) && /hit/.test(c.detail)));
  const s = ver.summary(v);
  for (const k of ['Claude Code', 'Cursor', 'Codex', 'Copilot', 'Undo']) assert.match(s, new RegExp(k));
});

// ───────────────────────────── optional: real tools ─────────────────────────────

const REAL_K = path.resolve(repo, '..', 'kronicle-lite', 'dist', 'cli.js');
const REAL_A = path.resolve(repo, '..', 'cc-anchor');
test('end to end with the real kronicle-lite and cc-anchor checkouts (Cursor + Codex)', { skip: !(fs.existsSync(REAL_K) && fs.existsSync(path.join(REAL_A, 'scripts', 'anchor.mjs'))) && 'sibling checkouts not present', timeout: 120000 }, async () => {
  const sb = fullSandbox();
  sb.env.PATH = `${sb.bin}:/usr/bin:/bin`; // cc-anchor's shell renderer needs coreutils + jq
  sb.env.ISOKRON_KRONICLE_LITE_BIN = REAL_K;
  sb.env.ISOKRON_CC_ANCHOR_DIR = REAL_A;
  const before = snapshot(sb.root);
  const out = apply(sb, setup(sb, { clients: ['cursor', 'codex'], profile: 'team', goal: 'Real run' }).p);
  assert.equal(out.ok, true, JSON.stringify(out.results.filter((r) => r.status === 'failed')));
  assert.match(out.orient, /kronicle-lite orient — head seq \d+/);
  for (const r of out.results.filter((x) => x.kind === 'kronicle-put')) assert.match(r.detail, /^rev \d+, chain seq \d+$/, JSON.stringify(r));
  const v = await ver.verify({ root: sb.root, env: sb.env });
  assert.equal(v.ok, true, JSON.stringify(v.checks.filter((c) => !c.ok)));
  uni.uninstall({ root: sb.root, env: sb.env });
  assert.deepEqual(snapshot(sb.root), before);
});

// The Cursor port clones cc-anchor when no checkout / plugin is found. It must
// end on the pinned commit (PINS.ccAnchorSha), not wherever the ref points now.
const pinnedRepo = () => {
  if (!fs.existsSync(path.join(REAL_A, '.git'))) return null;
  const has = spawnSync('git', ['-C', REAL_A, 'cat-file', '-e', `${lib.PINS.ccAnchorSha}^{commit}`]).status === 0;
  const ref = spawnSync('git', ['-C', REAL_A, 'rev-parse', '--verify', '--quiet', lib.PINS.ccAnchorRef]).status === 0;
  return has && ref ? `file://${REAL_A}` : null;
};
test('Cursor port: the cc-anchor clone ends on the pinned commit (and ships the push/pulse scripts)', { skip: !(lib.PINS.ccAnchorSha && pinnedRepo()) && 'sibling cc-anchor git checkout with the pinned ref/commit not present', timeout: 120000 }, () => {
  const sb = sandbox({ files: { 'README.md': '# R\n' } });
  sb.env.ISOKRON_CC_ANCHOR_GIT = pinnedRepo();
  sb.env.PATH = `${sb.bin}:/usr/bin:/bin`;
  const out = apply(sb, setup(sb, { clients: ['cursor'] }).p);
  const r = out.results.find((x) => x.kind === 'cursor-hooks');
  assert.equal(r?.status, 'added', JSON.stringify(r));
  for (const f of ['pulse.sh', 'readonly.jq', 'owed.jq', 'retractions.jq']) assert.ok(fs.existsSync(path.join(sb.root, '.cursor', 'hooks', 'cc-anchor', 'scripts', f)), f);
});

test('Cursor port: an unreachable pinned commit fails the action instead of installing another version', { skip: !pinnedRepo() && 'sibling cc-anchor git checkout not present', timeout: 120000 }, () => {
  const saved = lib.PINS.ccAnchorSha;
  lib.PINS.ccAnchorSha = '0'.repeat(40);
  try {
    const sb = sandbox({ files: { 'README.md': '# R\n' } });
    sb.env.ISOKRON_CC_ANCHOR_GIT = pinnedRepo();
    sb.env.PATH = `${sb.bin}:/usr/bin:/bin`;
    const out = apply(sb, setup(sb, { clients: ['cursor'] }).p);
    const r = out.results.find((x) => x.kind === 'cursor-hooks');
    assert.equal(r?.status, 'failed');
    assert.match(r.detail || r.note || JSON.stringify(r), /pinned commit 000000000000 not reachable/);
    assert.ok(!fs.existsSync(path.join(sb.root, '.cursor', 'hooks', 'cc-anchor')));
  } finally { lib.PINS.ccAnchorSha = saved; }
});
