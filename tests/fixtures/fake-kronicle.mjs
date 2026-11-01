#!/usr/bin/env node
// Fake kronicle-lite CLI for tests: put / orient / verify-chain / --help and a
// minimal MCP stdio `serve` that answers initialize and tools/call recall.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const argv = process.argv.slice(2);
const dir = process.env.KRONICLE_LITE_DATA_DIR || path.join(os.homedir(), '.kronicle-lite');
const db = path.join(dir, 'fake.json');
const load = () => (fs.existsSync(db) ? JSON.parse(fs.readFileSync(db, 'utf8')) : { seq: 0, docs: {} });
const save = (s) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(db, JSON.stringify(s)); };
const cmd = argv[0];
if (cmd === '--help') { console.log('kronicle-lite 0.3.0 — fake\n  put\n  orient\n  verify-chain'); process.exit(0); }
if (cmd === 'put') {
  const s = load(); s.seq += 1;
  const [slug, file] = [argv[1], argv[2]];
  const prev = s.docs[slug];
  s.docs[slug] = { content: fs.readFileSync(file, 'utf8'), revision: (prev?.revision || 0) + 1 };
  save(s);
  console.log(JSON.stringify({ slug, revision: s.docs[slug].revision, head: { seq: s.seq } }));
  process.exit(0);
}
if (cmd === 'orient') {
  const s = load();
  console.log(`# kronicle-lite orient — head seq ${s.seq}\n\n**cursor_compact:** \`sxt1c.${s.seq}.FAKE\`  \n\n## Digest\n${Object.keys(s.docs).length} document(s)`);
  process.exit(0);
}
if (cmd === 'verify-chain') { const s = load(); console.log(JSON.stringify({ ok: true, events_checked: s.seq, head: { seq: s.seq } })); process.exit(0); }
if (cmd === 'serve') {
  let buf = '';
  process.stdin.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
      if (msg.method === 'initialize') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'kronicle-lite', version: '0.3.0' } } }) + '\n');
      if (msg.method === 'tools/call') {
        const q = msg.params.arguments.query.toLowerCase().split(/\s+/);
        const s = load();
        const hits = Object.entries(s.docs).filter(([, d]) => q.some((w) => d.content.toLowerCase().includes(w))).map(([slug]) => ({ doc_slug: slug, receipt: { sig: 'x' } }));
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { structuredContent: { hits }, content: [{ type: 'text', text: JSON.stringify({ hits }) }] } }) + '\n');
      }
    }
  });
  process.stdin.on('end', () => process.exit(0));
} else { console.error(`fake kronicle: ${argv.join(' ')}`); process.exit(2); }
