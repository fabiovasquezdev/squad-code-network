'use strict';
/*
 * Repositories of a project and its GitNexus scope.
 *
 * Each project lists the repositories its agents work on (existing ones to continue, new ones to create). From that list the bridge:
 *   - creates the folder (and `git init`) of a "new" repository;
 *   - gives the project its own GitNexus registry (projects/<folder>/.gitnexus-home) holding only those repositories, so the agents
 *     query nothing else;
 *   - writes projects/<folder>/.mcp.json and .claude/settings.json so Claude Code starts the GitNexus MCP for that registry
 *     (read-only; the `api_impact` tool is denied because its schema is rejected by the API).
 * `index` runs `gitnexus analyze` for one repository on demand (it writes <repo>/.gitnexus).
 *
 * Environment: SQUAD_GITNEXUS_BIN overrides the gitnexus executable (default: "gitnexus" on the PATH).
 */
const fs = require('node:fs');
const path = require('node:path');

const KINDS = ['existing', 'new'];
const ROLES = ['backend', 'frontend', 'mobile', 'fullstack', 'reference'];
const MAX_REPOS = 20;
const IS_WIN = process.platform === 'win32';

const clean = v => (typeof v === 'string' ? v.trim() : '');
const statSafe = p => { try { return fs.statSync(p); } catch { return null; } };
const real = p => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const tail = (text, n) => { const t = String(text || '').trim(); return t.length > n ? '…' + t.slice(-n) : t; };

/** Absolute path of a repository; it cannot be shallow (the root, a top-level folder) or live inside this app's own folder. */
function repoPath(raw, appRoot) {
  const p = clean(raw);
  if (!p || p.length > 500 || /[\u0000-\u001f]/.test(p)) throw new Error('Caminho inválido.');
  if (!path.isAbsolute(p)) throw new Error(`Informe o caminho completo, começando na raiz: ${p.slice(0, 120)}`);
  const full = path.resolve(p);
  if (full.split(path.sep).filter(Boolean).length < 2) throw new Error('Caminho raso demais: informe a pasta do repositório, não uma pasta do sistema.');
  const rel = path.relative(appRoot, full);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) throw new Error('O repositório não pode ficar dentro da pasta do próprio SQUAD/CODE.');
  return full;
}

function createRepoTools({ appRoot, projectDir, resolveBin, spawnBin }) {
  const indexing = new Set();

  /** Runs a program (no shell) and resolves with its exit code and output; never rejects. */
  function run(bin, args, { cwd, env, timeout = 20000 } = {}) {
    return new Promise(resolve => {
      let child, out = '', done = false;
      const finish = r => { if (!done) { done = true; clearTimeout(timer); resolve({ out, ...r }); } };
      let timer = null;
      try { child = spawnBin(bin, args, { cwd, env: env ? { ...process.env, ...env } : process.env, windowsHide: true }); }
      catch (e) { return resolve({ code: -1, out: e.message, missing: e.code === 'ENOENT' }); }
      const cap = d => { if (out.length < 200000) out += d; };
      child.stdout?.on('data', cap); child.stderr?.on('data', cap);
      timer = setTimeout(() => { try { child.kill(); } catch {} finish({ code: -1, timeout: true }); }, timeout);
      child.on('error', e => finish({ code: -1, out: out + e.message, missing: e.code === 'ENOENT' }));
      child.on('close', code => finish({ code }));
    });
  }

  /** gitnexus executable, followed through symlinks (npm links bin/gitnexus to dist/cli/index.js). null when not installed. */
  async function findGitnexus() {
    const resolved = await resolveBin(process.env.SQUAD_GITNEXUS_BIN || 'gitnexus');
    if (!resolved) return null;
    const bin = real(resolved);
    // How a Claude Code MCP entry must start it.
    let command = bin, args = ['mcp'];
    if (/\.(mjs|cjs|js)$/i.test(bin)) { command = process.execPath; args = [bin, 'mcp']; }
    else if (IS_WIN && /\.(cmd|bat)$/i.test(bin)) { command = 'cmd'; args = ['/c', bin, 'mcp']; }
    return { bin, command, args };
  }

  async function insideGit(dir) {
    const r = await run('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir });
    return r.code === 0 && r.out.trim() === 'true';
  }

  const registryFile = home => path.join(home, 'registry.json');
  function readRegistry(home) {
    try { const a = JSON.parse(fs.readFileSync(registryFile(home), 'utf8')); return Array.isArray(a) ? a.filter(e => e && typeof e.path === 'string') : []; }
    catch { return []; }
  }

  /** Merges into a JSON config file; an invalid existing file is left untouched (returns an explanation). */
  function mergeJson(file, mutate) {
    let cfg = {};
    if (fs.existsSync(file)) {
      try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return `${path.basename(file)} existente não é um JSON válido; não foi alterado.`; }
      if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return `${path.basename(file)} existente não é um objeto; não foi alterado.`;
    }
    const before = JSON.stringify(cfg);
    mutate(cfg);
    if (JSON.stringify(cfg) === before && fs.existsSync(file)) return '';
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    return '';
  }
  const addTo = (obj, key, value) => { obj[key] = Array.isArray(obj[key]) ? obj[key] : []; if (!obj[key].includes(value)) obj[key].push(value); };

  /** Prepares the project's repositories and GitNexus scope; reports the state of each repository. */
  async function sync(folder, rawRepos) {
    const dir = projectDir(folder);
    fs.mkdirSync(dir, { recursive: true });
    const home = path.join(dir, '.gitnexus-home');
    const gn = await findGitnexus();
    const seen = new Set(), repos = [], warnings = [];
    for (const r of (Array.isArray(rawRepos) ? rawRepos : []).slice(0, MAX_REPOS)) {
      const item = { path: clean(r?.path), kind: r?.kind === 'new' ? 'new' : 'existing', role: ROLES.includes(r?.role) ? r.role : 'reference', exists: false, isGit: false, created: false, indexed: false, registered: false, error: '', warning: '' };
      try {
        const full = repoPath(item.path, appRoot);
        item.path = full;
        if (seen.has(real(full))) throw new Error('Repositório repetido na lista.');
        seen.add(real(full));
        let st = statSafe(full);
        if (!st && item.kind === 'new') { fs.mkdirSync(full, { recursive: true }); item.created = true; st = statSafe(full); }
        if (!st) throw new Error('A pasta não existe. Marque como "novo" para criá-la.');
        if (!st.isDirectory()) throw new Error('O caminho não é uma pasta.');
        item.exists = true;
        item.isGit = await insideGit(full);
        if (item.kind === 'new' && !item.isGit) {
          const g = await run('git', ['init', '-q'], { cwd: full });
          if (g.code === 0) item.isGit = true;
          else item.warning = g.missing ? 'Git não encontrado: a pasta foi criada sem repositório git.' : 'git init falhou: ' + tail(g.out, 200);
        }
        item.indexed = fs.existsSync(path.join(full, '.gitnexus'));
      } catch (e) { item.error = e.message; }
      repos.push(item);
    }

    const usable = repos.filter(r => r.exists);
    let configured = false;
    if (!gn) { if (usable.length) warnings.push('GitNexus não encontrado no PATH. Instale com "npm i -g gitnexus" ou defina SQUAD_GITNEXUS_BIN.'); }
    else if (usable.length) {
      fs.mkdirSync(home, { recursive: true });
      const known = new Set(readRegistry(home).map(e => real(e.path)));
      for (const r of usable) {
        if (r.indexed && !known.has(real(r.path))) await run(gn.bin, ['index', ...(r.isGit ? [] : ['--allow-non-git']), r.path], { env: { GITNEXUS_HOME: home }, timeout: 60000 });
      }
      // The registry keeps only this project's repositories.
      const want = new Set(usable.map(r => real(r.path)));
      const reg = readRegistry(home), kept = reg.filter(e => want.has(real(e.path)));
      if (kept.length !== reg.length) fs.writeFileSync(registryFile(home), JSON.stringify(kept, null, 2) + '\n', 'utf8');
      const regSet = new Set(kept.map(e => real(e.path)));
      for (const r of usable) r.registered = regSet.has(real(r.path));

      const problems = [
        mergeJson(path.join(dir, '.mcp.json'), cfg => { cfg.mcpServers = { ...(cfg.mcpServers || {}), gitnexus: { type: 'stdio', command: gn.command, args: gn.args, env: { GITNEXUS_HOME: home } } }; }),
        mergeJson(path.join(dir, '.claude', 'settings.json'), cfg => {
          addTo(cfg, 'enabledMcpjsonServers', 'gitnexus');
          cfg.permissions = cfg.permissions && typeof cfg.permissions === 'object' ? cfg.permissions : {};
          addTo(cfg.permissions, 'allow', 'mcp__gitnexus');
          addTo(cfg.permissions, 'deny', 'mcp__gitnexus__api_impact');
        }),
      ].filter(Boolean);
      warnings.push(...problems);
      configured = !problems.length;
    }
    return { project: folder, gitnexus: gn ? { path: gn.bin } : null, configured, warnings, repos };
  }

  /** `gitnexus analyze` for one repository, registered in the project's registry (never in the global one). */
  async function index(folder, rawPath) {
    const dir = projectDir(folder);
    const full = repoPath(rawPath, appRoot);
    const st = statSafe(full);
    if (!st || !st.isDirectory()) throw new Error('A pasta do repositório não existe.');
    const gn = await findGitnexus();
    if (!gn) throw new Error('GitNexus não encontrado no PATH. Instale com "npm i -g gitnexus" ou defina SQUAD_GITNEXUS_BIN.');
    if (indexing.has(real(full))) throw Object.assign(new Error('Este repositório já está sendo indexado.'), { status: 409 });
    indexing.add(real(full));
    try {
      const home = path.join(dir, '.gitnexus-home');
      fs.mkdirSync(home, { recursive: true });
      const isGit = await insideGit(full);
      const r = await run(gn.bin, ['analyze', '--skip-agents-md', ...(isGit ? [] : ['--skip-git']), '.'], { cwd: full, env: { GITNEXUS_HOME: home }, timeout: 10 * 60 * 1000 });
      return { ok: r.code === 0, timeout: !!r.timeout, output: tail(r.out, 1500) };
    } finally { indexing.delete(real(full)); }
  }

  return { sync, index, findGitnexus };
}

module.exports = { createRepoTools, repoPath, KINDS, ROLES, MAX_REPOS };
