import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, test } from 'node:test';
import { ensureVite, runVite } from './run-vite.mjs';

const temporaryRoots = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeProject({ withLock = true, withVite = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'mybox-vite-bootstrap-'));
  temporaryRoots.push(root);
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: 'mybox-vite-bootstrap-test',
    private: true,
    type: 'module',
    engines: { node: '>=22.0.0' },
    devDependencies: { vite: '8.3.2' },
  }, null, 2));
  if (withLock) writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: {} }));
  if (withVite) writeFakeVite(root);
  return root;
}

function writeFakeVite(root) {
  const viteDir = join(root, 'node_modules', 'vite');
  mkdirSync(join(viteDir, 'bin'), { recursive: true });
  writeFileSync(join(viteDir, 'package.json'), JSON.stringify({
    name: 'vite', version: '8.3.2', bin: { vite: 'bin/vite.js' },
  }));
  writeFileSync(join(viteDir, 'bin', 'vite.js'), [
    "import { writeFileSync } from 'node:fs';",
    "writeFileSync(process.env.MYBOX_VITE_TEST_MARKER, JSON.stringify(process.argv.slice(2)));",
  ].join('\n'));
}

test('uses an installed local Vite CLI without reinstalling dependencies', () => {
  const root = makeProject({ withVite: true });
  let installCalled = false;
  const marker = join(root, 'vite-args.json');
  const previousMarker = process.env.MYBOX_VITE_TEST_MARKER;
  process.env.MYBOX_VITE_TEST_MARKER = marker;
  try {
    const status = runVite(root, ['build', '--mode', 'test'], {
      installDependencies: () => { installCalled = true; return 1; },
    });
    assert.equal(status, 0);
    assert.equal(installCalled, false);
    assert.deepEqual(JSON.parse(readFileSync(marker, 'utf8')), ['build', '--mode', 'test']);
  } finally {
    if (previousMarker === undefined) delete process.env.MYBOX_VITE_TEST_MARKER;
    else process.env.MYBOX_VITE_TEST_MARKER = previousMarker;
  }
});

test('restores dependencies once when the local Vite CLI is missing', () => {
  const root = makeProject();
  let installCalls = 0;
  const cli = ensureVite(root, (installRoot) => {
    installCalls += 1;
    writeFakeVite(installRoot);
    return 0;
  });
  assert.equal(installCalls, 1);
  assert.equal(cli, resolve(root, 'node_modules', 'vite', 'bin', 'vite.js'));
});

test('restores missing Vite and then runs the requested command', () => {
  const root = makeProject();
  let installCalls = 0;
  const marker = join(root, 'vite-args.json');
  const previousMarker = process.env.MYBOX_VITE_TEST_MARKER;
  process.env.MYBOX_VITE_TEST_MARKER = marker;
  try {
    const status = runVite(root, ['build', '--mode', 'bootstrap-test'], {
      installDependencies: (installRoot) => {
        installCalls += 1;
        writeFakeVite(installRoot);
        return 0;
      },
    });
    assert.equal(status, 0);
    assert.equal(installCalls, 1);
    assert.deepEqual(JSON.parse(readFileSync(marker, 'utf8')), ['build', '--mode', 'bootstrap-test']);
  } finally {
    if (previousMarker === undefined) delete process.env.MYBOX_VITE_TEST_MARKER;
    else process.env.MYBOX_VITE_TEST_MARKER = previousMarker;
  }
});

test('refuses automatic dependency installation without a lock file', () => {
  const root = makeProject({ withLock: false });
  let installCalled = false;
  assert.throws(
    () => ensureVite(root, () => { installCalled = true; return 0; }),
    /no package-lock\.json\/npm-shrinkwrap\.json/i,
  );
  assert.equal(installCalled, false);
});

test('reports an unsuccessful dependency restoration clearly', () => {
  const root = makeProject();
  assert.throws(
    () => ensureVite(root, () => { throw new Error('simulated npm registry timeout'); }),
    /simulated npm registry timeout/,
  );
});
