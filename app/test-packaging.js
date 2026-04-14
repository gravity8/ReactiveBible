#!/usr/bin/env node
/**
 * Regression test: verify every local require() in the Electron main process
 * has a matching file on disk AND is included in the electron-builder files list.
 *
 * Run: node test-packaging.js
 * Exit code 0 = pass, 1 = fail
 */

const fs = require('fs');
const path = require('path');

const APP_DIR = __dirname;
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

// Regex: require('./something') or require("./something")
const LOCAL_REQUIRE = /require\(\s*['"]\.\/([^'"]+)['"]\s*\)/g;

let failures = [];

// ── Test 1: All main-process files exist on disk ──────────────
for (const file of MAIN_PROCESS_FILES) {
  const fullPath = path.join(APP_DIR, file);
  if (!fs.existsSync(fullPath)) {
    failures.push(`MISSING FILE: ${file} does not exist on disk`);
  }
}

// ── Test 2: Scan require() calls and verify targets exist + are packaged ──
for (const file of MAIN_PROCESS_FILES) {
  const fullPath = path.join(APP_DIR, file);
  if (!fs.existsSync(fullPath)) continue;

  const src = fs.readFileSync(fullPath, 'utf8');
  let match;
  LOCAL_REQUIRE.lastIndex = 0;
  while ((match = LOCAL_REQUIRE.exec(src)) !== null) {
    const required = match[1];
    // Resolve the actual filename (try as-is, then .js, then .cjs)
    const candidates = [required, required + '.js', required + '.cjs', required + '.json'];
    const resolved = candidates.find(c => fs.existsSync(path.join(APP_DIR, c)));

    if (!resolved) {
      failures.push(`MISSING MODULE: ${file} requires './${required}' but no matching file found`);
      continue;
    }

    // Check if this file is covered by the builder files list
    const inFilesList = builderFiles.some(pattern => {
      // Exact match
      if (pattern === resolved) return true;
      // Glob patterns like "dist/**/*" — check prefix
      if (pattern.includes('*')) {
        const prefix = pattern.split('*')[0];
        return resolved.startsWith(prefix);
      }
      return false;
    });

    if (!inFilesList) {
      failures.push(`NOT PACKAGED: ${file} requires './${required}' (resolved: ${resolved}) but it is NOT in build.files`);
    }
  }
}

// ── Test 3: All entries in build.files (non-glob) exist on disk ──
for (const entry of builderFiles) {
  if (entry.includes('*')) continue; // skip globs
  const fullPath = path.join(APP_DIR, entry);
  if (!fs.existsSync(fullPath)) {
    failures.push(`STALE FILES ENTRY: build.files lists '${entry}' but it does not exist`);
  }
}

// ── Test 4: package.json "main" entry is in files list ──
if (pkg.main && !builderFiles.includes(pkg.main)) {
  failures.push(`MAIN NOT PACKAGED: package.json "main" is "${pkg.main}" but it is not in build.files`);
}

// ── Report ────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error('\n=== PACKAGING REGRESSION TEST FAILED ===\n');
  failures.forEach(f => console.error('  FAIL:', f));
  console.error(`\n${failures.length} failure(s)\n`);
  process.exit(1);
} else {
  console.log('=== PACKAGING REGRESSION TEST PASSED ===');
  console.log(`  Checked ${MAIN_PROCESS_FILES.length} main-process files`);
  console.log(`  Verified ${builderFiles.length} build.files entries`);
  console.log('  All require() targets exist and are included in build.files');
  process.exit(0);
}
