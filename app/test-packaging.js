#!/usr/bin/env node
/**
 * Pre-deployment smoke test: verify everything the app needs to run is present.
 *
 * Checks:
 *   1. All main-process JS files exist on disk
 *   2. All local require() targets exist and are in build.files
 *   3. All npm package requires are installed (not builtin, not electron)
 *   4. All build.files entries exist on disk
 *   5. package.json "main" is in build.files
 *   6. C++ binary exists and runs (exit 0 with empty stdin)
 *   7. Whisper model exists
 *   8. Bible translation files exist for configured translations
 *   9. Config file is valid JSON with required fields
 *  10. Vite build output exists (dist/)
 *  11. display.html exists (projector window)
 *
 * Run: node test-packaging.js
 * Exit code 0 = pass, 1 = fail
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const APP_DIR = __dirname;
const PROJECT_DIR = path.join(APP_DIR, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8'));
const builderFiles = pkg.build && pkg.build.files ? pkg.build.files : [];

// Main-process JS files that get packaged (not React/Vite sources).
const MAIN_PROCESS_FILES = [
  'main.js',
  'preload.js',
  'bible-fetcher.js',
  'sync-server.js',
  'sync-client.js',
  'profile-manager.js',
  'profile-analyzer.js',
  'calibration-worker.js',
  'themes.cjs',
];

// Regex patterns
const LOCAL_REQUIRE = /require\(\s*['"]\.\/([^'"]+)['"]\s*\)/g;
const NPM_REQUIRE = /require\(\s*['"]([^./][^'"]*)['"]\s*\)/g;

// Node.js builtin modules — no need to check these
const BUILTINS = new Set(require('module').builtinModules.flatMap(m => [m, `node:${m}`]));

// Electron modules are provided by the runtime, not node_modules
const ELECTRON_MODULES = new Set(['electron', 'electron/main', 'electron/renderer']);

let failures = [];
let checks = 0;

function check(name, pass, failMsg) {
  checks++;
  if (!pass) failures.push(`${name}: ${failMsg}`);
}

// ══════════════════════════════════════════════════════════
// Test 1: All main-process files exist on disk
// ══════════════════════════════════════════════════════════
for (const file of MAIN_PROCESS_FILES) {
  check('MAIN_FILE', fs.existsSync(path.join(APP_DIR, file)),
    `${file} does not exist on disk`);
}

// ══════════════════════════════════════════════════════════
// Test 2: Local require() targets exist and are in build.files
// ══════════════════════════════════════════════════════════
for (const file of MAIN_PROCESS_FILES) {
  const fullPath = path.join(APP_DIR, file);
  if (!fs.existsSync(fullPath)) continue;

  const src = fs.readFileSync(fullPath, 'utf8');
  let match;
  LOCAL_REQUIRE.lastIndex = 0;
  while ((match = LOCAL_REQUIRE.exec(src)) !== null) {
    const required = match[1];
    const candidates = [required, required + '.js', required + '.cjs', required + '.json'];
    const resolved = candidates.find(c => fs.existsSync(path.join(APP_DIR, c)));

    check('LOCAL_REQUIRE', !!resolved,
      `${file} requires './${required}' but no matching file found`);

    if (resolved) {
      const inFilesList = builderFiles.some(pattern => {
        if (pattern === resolved) return true;
        if (pattern.includes('*')) {
          const prefix = pattern.split('*')[0];
          return resolved.startsWith(prefix);
        }
        return false;
      });
      check('BUILD_FILES', inFilesList,
        `${file} requires './${required}' (resolved: ${resolved}) but it is NOT in build.files`);
    }
  }
}

// ══════════════════════════════════════════════════════════
// Test 3: npm package requires are installed
// ══════════════════════════════════════════════════════════
for (const file of MAIN_PROCESS_FILES) {
  const fullPath = path.join(APP_DIR, file);
  if (!fs.existsSync(fullPath)) continue;

  const src = fs.readFileSync(fullPath, 'utf8');
  let match;
  NPM_REQUIRE.lastIndex = 0;
  while ((match = NPM_REQUIRE.exec(src)) !== null) {
    const pkg_name = match[1];

    // Skip builtins and electron
    if (BUILTINS.has(pkg_name) || ELECTRON_MODULES.has(pkg_name)) continue;

    // Get the top-level package name (e.g. '@scope/pkg' or 'pkg')
    const topLevel = pkg_name.startsWith('@')
      ? pkg_name.split('/').slice(0, 2).join('/')
      : pkg_name.split('/')[0];

    const modulePath = path.join(APP_DIR, 'node_modules', topLevel);
    check('NPM_MODULE', fs.existsSync(modulePath),
      `${file} requires '${pkg_name}' but '${topLevel}' is not installed in node_modules`);
  }
}

// ══════════════════════════════════════════════════════════
// Test 4: All entries in build.files (non-glob) exist on disk
// ══════════════════════════════════════════════════════════
for (const entry of builderFiles) {
  if (entry.includes('*')) continue;
  check('BUILD_FILES_EXIST', fs.existsSync(path.join(APP_DIR, entry)),
    `build.files lists '${entry}' but it does not exist`);
}

// ══════════════════════════════════════════════════════════
// Test 5: package.json "main" entry is in files list
// ══════════════════════════════════════════════════════════
if (pkg.main) {
  check('PKG_MAIN', builderFiles.includes(pkg.main),
    `package.json "main" is "${pkg.main}" but it is not in build.files`);
}

// ══════════════════════════════════════════════════════════
// Test 6: C++ binary exists and starts without crashing
// ══════════════════════════════════════════════════════════
const binaryName = process.platform === 'win32' ? 'sermon-verse-detector.exe' : 'sermon-verse-detector';
const binaryPath = path.join(PROJECT_DIR, 'build', binaryName);
check('BINARY_EXISTS', fs.existsSync(binaryPath),
  `C++ binary not found at ${binaryPath} — run: cmake --build build/`);

if (fs.existsSync(binaryPath)) {
  const configPath = path.join(PROJECT_DIR, 'config.json');
  try {
    // Run with /dev/null as stdin — should load config, init whisper, then exit cleanly on EOF.
    execFileSync(binaryPath, [configPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: PROJECT_DIR,
      timeout: 30000,
    });
    check('BINARY_RUNS', true, '');
  } catch (err) {
    // Exit code 0 is success. Non-zero or signal means crash.
    if (err.status === 0) {
      check('BINARY_RUNS', true, '');
    } else {
      const stderr = err.stderr ? err.stderr.toString().split('\n').slice(-3).join(' ') : '';
      check('BINARY_RUNS', false,
        `binary exited with code ${err.status || err.signal}. ${stderr}`);
    }
  }
}

// ══════════════════════════════════════════════════════════
// Test 7: Whisper model exists
// ══════════════════════════════════════════════════════════
const configPath = path.join(PROJECT_DIR, 'config.json');
let config = {};
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch {}

const modelPath = path.join(PROJECT_DIR, config.whisper_model_path || 'models/ggml-base.en.bin');
check('WHISPER_MODEL', fs.existsSync(modelPath),
  `Whisper model not found at ${modelPath}`);

// ══════════════════════════════════════════════════════════
// Test 8: Bible translation files exist
// ══════════════════════════════════════════════════════════
const translations = config.l1_translations || [];
for (const trans of translations) {
  const lower = trans.toLowerCase();
  const biblePath = path.join(PROJECT_DIR, 'bibles', `${lower}.json`);
  check('BIBLE_FILE', fs.existsSync(biblePath),
    `Bible translation ${trans} not found at bibles/${lower}.json`);

  // Verify it's valid JSON with actual content
  if (fs.existsSync(biblePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(biblePath, 'utf8'));
      const books = Object.keys(data);
      check('BIBLE_CONTENT', books.length > 0,
        `bibles/${lower}.json is empty (no books)`);
    } catch (e) {
      check('BIBLE_PARSE', false,
        `bibles/${lower}.json is not valid JSON: ${e.message}`);
    }
  }
}

// ══════════════════════════════════════════════════════════
// Test 9: Config file is valid JSON with required fields
// ══════════════════════════════════════════════════════════
check('CONFIG_EXISTS', fs.existsSync(configPath),
  `config.json not found at project root`);

if (fs.existsSync(configPath)) {
  try {
    const c = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    check('CONFIG_MODE', ['online', 'offline'].includes(c.mode),
      `config.json "mode" must be "online" or "offline", got "${c.mode}"`);
    check('CONFIG_TRANSLATIONS', Array.isArray(c.l1_translations) && c.l1_translations.length > 0,
      `config.json "l1_translations" is missing or empty`);
    check('CONFIG_DEFAULT_TRANS', typeof c.default_translation === 'string',
      `config.json "default_translation" is missing`);
  } catch (e) {
    check('CONFIG_PARSE', false,
      `config.json is not valid JSON: ${e.message}`);
  }
}

// ══════════════════════════════════════════════════════════
// Test 10: Vite build output exists
// ══════════════════════════════════════════════════════════
const distDir = path.join(APP_DIR, 'dist');
check('VITE_BUILD', fs.existsSync(distDir) && fs.existsSync(path.join(distDir, 'index.html')),
  `dist/index.html not found — run: npm run build (or vite build)`);

// ══════════════════════════════════════════════════════════
// Test 11: display.html exists (projector window)
// ══════════════════════════════════════════════════════════
check('DISPLAY_HTML', fs.existsSync(path.join(APP_DIR, 'display.html')),
  `display.html not found — needed for projector window`);

// ══════════════════════════════════════════════════════════
// Report
// ══════════════════════════════════════════════════════════
console.log('');
if (failures.length > 0) {
  console.error('=== PRE-DEPLOYMENT TEST FAILED ===\n');
  failures.forEach(f => console.error('  FAIL:', f));
  console.error(`\n${failures.length} failure(s) out of ${checks} checks\n`);
  process.exit(1);
} else {
  console.log('=== PRE-DEPLOYMENT TEST PASSED ===');
  console.log(`  ${checks} checks passed`);
  console.log(`  ${MAIN_PROCESS_FILES.length} main-process files verified`);
  console.log(`  ${translations.length} Bible translations verified`);
  console.log('  All require() targets (local + npm) present');
  console.log('  C++ binary starts and exits cleanly');
  console.log('  Config, model, and build assets verified');
  process.exit(0);
}
