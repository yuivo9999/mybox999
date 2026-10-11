import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, test } from 'node:test';
import { ensureVite, runVite } from './run-vite.mjs';

const temporaryRoots = [];
afterEach(() => { for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function makeProject({ withLock = true, withVite = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'mybox-vite-bundle-'));
  temporaryRoots.push(root);
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: 'mybox-vite-bundle-test', private: true, type: 'module', engines: { node: '>=22.12.0' },
    devDependencies: { vite: '8.3.2' },
  }, null, 2));
  if (withLock) writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/vite': { version: '8.3.2' } } }));
  if (withVite) writeFakeVite(root);
  return root;
}

function writeFakeVite(root) {
  const viteDir = join(root, 'node_modules', 'vite');
  mkdirSync(join(viteDir, 'bin'), { recursive: true });
  writeFileSync(join(viteDir, 'package.json'), JSON.stringify({ name: 'vite', version: '8.3.2', bin: { vite: 'bin/vite.js' } }));
  writeFileSync(join(viteDir, 'bin', 'vite.js'), [
    "import { writeFileSync } from 'node:fs';",
    "writeFileSync(process.env.MYBOX_VITE_TEST_MARKER, JSON.stringify(process.argv.slice(2)));",
  ].join('\n'));
}

test('uses an installed local Vite CLI without restoring any bundle', () => {
  const root = makeProject({ withVite: true });
  let restoreCalled = false;
  const marker = join(root, 'vite-args.json');
  const previousMarker = process.env.MYBOX_VITE_TEST_MARKER;
  process.env.MYBOX_VITE_TEST_MARKER = marker;
  try {
    const status = runVite(root, ['build', '--mode', 'test'], { restoreDependencies: () => { restoreCalled = true; return 1; } });
    assert.equal(status, 0);
    assert.equal(restoreCalled, false);
    assert.deepEqual(JSON.parse(readFileSync(marker, 'utf8')), ['build', '--mode', 'test']);
  } finally {
    if (previousMarker === undefined) delete process.env.MYBOX_VITE_TEST_MARKER;
    else process.env.MYBOX_VITE_TEST_MARKER = previousMarker;
  }
});

test('recovers missing dependencies exactly once from the configured local bundle provider', () => {
  const root = makeProject();
  let restoreCalls = 0;
  const cli = ensureVite(root, (restoreRoot) => { restoreCalls += 1; writeFakeVite(restoreRoot); return 0; });
  assert.equal(restoreCalls, 1);
  assert.equal(cli, resolve(root, 'node_modules', 'vite', 'bin', 'vite.js'));
});

test('restores missing Vite then runs the requested command', () => {
  const root = makeProject();
  let restoreCalls = 0;
  const marker = join(root, 'vite-args.json');
  const previousMarker = process.env.MYBOX_VITE_TEST_MARKER;
  process.env.MYBOX_VITE_TEST_MARKER = marker;
  try {
    const status = runVite(root, ['build', '--mode', 'bundle-test'], {
      restoreDependencies: (restoreRoot) => { restoreCalls += 1; writeFakeVite(restoreRoot); return 0; },
    });
    assert.equal(status, 0);
    assert.equal(restoreCalls, 1);
    assert.deepEqual(JSON.parse(readFileSync(marker, 'utf8')), ['build', '--mode', 'bundle-test']);
  } finally {
    if (previousMarker === undefined) delete process.env.MYBOX_VITE_TEST_MARKER;
    else process.env.MYBOX_VITE_TEST_MARKER = previousMarker;
  }
});

test('refuses a missing Vite CLI when lockfile is absent', () => {
  const root = makeProject({ withLock: false });
  let restoreCalled = false;
  assert.throws(() => ensureVite(root, () => { restoreCalled = true; return 0; }), /package-lock\.json\/npm-shrinkwrap\.json/i);
  assert.equal(restoreCalled, false);
});

test('reports a missing/offline bundle provider failure instead of trying npm download', () => {
  const root = makeProject();
  assert.throws(() => ensureVite(root, () => { throw new Error('No pre-provisioned dependency archive'); }), /No pre-provisioned dependency archive/);
});

test('reports when local bundle restoration does not succeed', () => {
  const root = makeProject();
  assert.throws(() => ensureVite(root, () => 2), /依赖包恢复未成功/);
});
