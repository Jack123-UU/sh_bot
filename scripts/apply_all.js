// Node script to apply all patches safely
// Usage: node scripts/apply_all.js [repoRoot]
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(process.argv[2] || process.cwd());
const log = (...args) => console.log('[fix]', ...args);

function backupFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const bak = filePath + '.bak';
  if (!fs.existsSync(bak)) {
    fs.copyFileSync(filePath, bak);
    log('Backup created:', bak);
  }
}

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  log('Wrote', path.relative(repoRoot, filePath));
}

function patchPackageJson() {
  const p = path.join(repoRoot, 'package.json');
  if (!fs.existsSync(p)) {
    log('package.json not found, skip.');
    return;
  }
  backupFile(p);
  const raw = fs.readFileSync(p, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    log('ERROR: package.json is not valid JSON, skip.');
    return;
  }
  data.scripts = data.scripts || {};
  data.scripts.dev = "mastra dev";
  data.scripts.build = "mastra build";
  data.scripts.start = "node .mastra/output/index.mjs";
  data.scripts.check = data.scripts.check || "tsc";
  data.scripts["check:format"] = 'prettier --check "**/*.ts"';
  data.scripts.format = 'prettier --write "**/*.ts"';

  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
  log('package.json patched.');
}

function findFileUpToDepth(dir, filename, maxDepth = 3) {
  // Search dir for filename (non-recursive) and then breadth-first down to maxDepth
  function* walk(currentDir, depth) {
    if (depth > maxDepth) return;
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(currentDir, e.name);
      if (e.isFile() && e.name === filename) yield full;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        yield* walk(path.join(currentDir, e.name), depth + 1);
      }
    }
  }
  for (const f of walk(dir, 0)) return f;
  return null;
}

function patchRenderYaml() {
  const p = findFileUpToDepth(repoRoot, 'render.yaml', 2) || path.join(repoRoot, 'render.yaml');
  if (!fs.existsSync(p)) {
    // create from replacement
    const repl = path.join(__dirname, '..', 'replacements', 'render.yaml');
    const content = fs.readFileSync(repl, 'utf8');
    writeText(p, content);
    log('render.yaml created from template.');
    return;
  }
  backupFile(p);
  let txt = fs.readFileSync(p, 'utf8');

  // Replace buildCommand and startCommand lines (simple line-based approach)
  const setLine = (key, value) => {
    const re = new RegExp(`(^\\s*${key}\\s*:\\s*).*$`, 'm');
    if (re.test(txt)) {
      txt = txt.replace(re, `$1${value}`);
    } else {
      // append if not exists
      txt += `\n${key}: ${value}\n`;
    }
  };

  setLine('buildCommand', 'npm ci && npm run build');
  setLine('startCommand', 'node .mastra/output/index.mjs');
  setLine('healthCheckPath', '/api');

  fs.writeFileSync(p, txt, 'utf8');
  log('render.yaml patched.');
}

function findInngestIndexTs() {
  // Common path
  const p1 = path.join(repoRoot, 'src', 'mastra', 'inngest', 'index.ts');
  if (fs.existsSync(p1)) return p1;

  // Recursive search for index.ts under any 'mastra/inngest' dir within depth 6
  function* walk(currentDir, depth) {
    if (depth > 6) return;
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(currentDir, e.name);
      if (e.isDirectory()) {
        // Heuristic: prefer dirs named 'src' or 'mastra'
        if (['node_modules', '.git'].includes(e.name)) continue;
        yield* walk(full, depth + 1);
      } else if (e.isFile() && e.name === 'index.ts' && full.includes(path.join('mastra', 'inngest'))) {
        yield full;
      }
    }
  }
  for (const f of walk(repoRoot, 0)) return f;
  return null;
}

function patchInngestIndexTs() {
  const p = findInngestIndexTs();
  if (!p) {
    log('src/mastra/inngest/index.ts not found, skip.');
    return;
  }
  backupFile(p);
  let txt = fs.readFileSync(p, 'utf8');

  // Inject baseInternalUrl if not present
  if (!txt.includes('baseInternalUrl')) {
    const inject = [
      'const baseInternalUrl =',
      '  process.env.MASTRA_INTERNAL_URL ||',
      '  `http://127.0.0.1:${process.env.PORT || 5000}`;'
    ].join('\n') + '\n\n';

    // insert after first import block if any
    const importBlock = txt.match(/^(import .*?\n)+/m);
    if (importBlock) {
      const idx = importBlock.index + importBlock[0].length;
      txt = txt.slice(0, idx) + inject + txt.slice(idx);
    } else {
      txt = inject + txt;
    }
  }

  // Replace `http://localhost:5000${path}` within template strings
  txt = txt.replace(/`http:\/\/localhost:5000\$\{path\}`/g, '`${baseInternalUrl}${path}`');

  // Replace plain "http://localhost:5000" (single or double quotes) with baseInternalUrl
  // When used inside a template string or concatenation, developer can adapt; this at least removes the hardcode.
  txt = txt.replace(/['"]http:\/\/localhost:5000['"]/g, 'baseInternalUrl');

  fs.writeFileSync(p, txt, 'utf8');
  log('inngest/index.ts patched.');
}

(function main() {
  log('Repo root:', repoRoot);
  try {
    patchPackageJson();
    patchRenderYaml();
    patchInngestIndexTs();
    log('All done ✅');
  } catch (e) {
    console.error('ERROR:', e);
    process.exit(1);
  }
})();
