#!/usr/bin/env node
// Stand-in for the gitnexus CLI in the bridge tests (no indexing, no network).
//   index <path>          registers <path> in $GITNEXUS_HOME/registry.json (needs <path>/.gitnexus, like the real one)
//   analyze [...] <path>  creates <path>/.gitnexus and registers it
//   mcp                   not used by the tests
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const cmd = args[0];
const home = process.env.GITNEXUS_HOME;
const given = args.slice(1).filter(a => !a.startsWith('--')).at(-1) || '.';
const target = fs.realpathSync(path.resolve(given));

function register(p) {
  fs.mkdirSync(home, { recursive: true });
  const file = path.join(home, 'registry.json');
  let reg = [];
  try { reg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  if (!reg.some(e => e.path === p)) reg.push({ name: path.basename(p), path: p });
  fs.writeFileSync(file, JSON.stringify(reg));
}

if (!home) { console.error('GITNEXUS_HOME missing'); process.exit(2); }
if (cmd === 'index') {
  if (!fs.existsSync(path.join(target, '.gitnexus'))) { console.error('not indexed'); process.exit(1); }
  register(target);
  console.log('Repository registered:', path.basename(target));
} else if (cmd === 'analyze') {
  fs.mkdirSync(path.join(target, '.gitnexus'), { recursive: true });
  register(target);
  console.log('Repository indexed successfully', args.includes('--skip-git') ? '(skip-git)' : '');
} else { console.error('unknown command', cmd); process.exit(2); }
