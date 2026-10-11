#!/usr/bin/env node
/**
 * Run the project's locked Vite CLI. If dependencies are absent, recover only from
 * the pre-verified local offline bundle; normal build commands never download npm deps.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(SCRIPT_PATH), '../..');

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read ${label} at ${path}: ${error.message}`);
  }
}

function findViteCli(projectRoot) {
  const vitePackagePath = resolve(projectRoot, 'node_modules', 'vite', 'package.json');
  if (!existsSync(vitePackagePath)) return null;
  const vitePackage = readJson(vitePackagePath, 'installed Vite package metadata');
  const bin = typeof vitePackage.bin === 'string' ? vitePackage.bin : vitePackage.bin?.vite;
  if (typeof bin !== 'string' || !bin.trim()) return null;
  const packageDirectory = resolve(projectRoot, 'node_modules', 'vite');
  const cliPath = resolve(packageDirectory, bin);
  if (cliPath !== packageDirectory && !cliPath.startsWith(`${packageDirectory}${sep}`)) {
    throw new Error(`Invalid Vite CLI path in ${vitePackagePath}: ${bin}`);
  }
  return existsSync(cliPath) ? cliPath : null;
}

function declaredVite(projectRoot) {
  const packagePath = resolve(projectRoot, 'package.json');
  const manifest = readJson(packagePath, 'project package.json');
  const dependencies = {
    ...(manifest.dependencies || {}),
    ...(manifest.devDependencies || {}),
    ...(manifest.optionalDependencies || {}),
  };
  if (!dependencies.vite) {
    throw new Error('Vite is not declared in package.json. Add it to the project dependencies before building.');
  }
  const [nodeMajor, nodeMinor, nodePatch] = process.versions.node.split('.').map(Number);
  if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 12)) {
    throw new Error(`This project requires Node.js >=22.12.0 for its locked Vite version (current: ${process.versions.node}). Select a compatible Node.js release, then retry.`);
  }
  if (!existsSync(resolve(projectRoot, 'package-lock.json')) && !existsSync(resolve(projectRoot, 'npm-shrinkwrap.json'))) {
    throw new Error('A package-lock.json/npm-shrinkwrap.json is required to validate the offline dependency bundle.');
  }
  return manifest;
}

function findPython() {
  if (process.env.MYBOX_PYTHON) return [{ command: process.env.MYBOX_PYTHON, prefix: [] }];
  if (process.platform === 'win32') {
    return [
      { command: 'python', prefix: [] },
      { command: 'py', prefix: ['-3'] },
    ];
  }
  return [
    { command: 'python3', prefix: [] },
    { command: 'python', prefix: [] },
  ];
}

function restoreFrontendBundle(projectRoot) {
  const restoreScript = resolve(projectRoot, 'tests', 'environment', 'frontend_bundle.py');
  if (!existsSync(restoreScript)) {
    throw new Error(`本地 Vite 缺失，且未找到预置依赖恢复工具：${restoreScript}`);
  }
  let lastError = null;
  for (const candidate of findPython()) {
    const result = spawnSync(candidate.command, [...candidate.prefix, restoreScript, '--restore', '--root', projectRoot], {
      cwd: projectRoot,
      stdio: 'inherit',
      windowsHide: true,
      timeout: 120000,
    });
    if (result.error?.code === 'ENOENT') {
      lastError = result.error;
      continue;
    }
    if (result.error) throw new Error(`无法启动本地依赖恢复工具：${result.error.message}`);
    if (result.status !== 0) {
      throw new Error('本地 Vite 缺失，预置依赖恢复未成功。构建未尝试联网下载；请查看上方 BLOCKED 原因，或在准备环境显式运行 `python tests/environment/frontend_bundle.py --prepare`。');
    }
    return 0;
  }
  throw new Error(`本地 Vite 缺失，无法运行 Python 依赖恢复工具（${lastError?.message || 'python/python3 不可用'}）。请提供 Python 3，或在可运行环境显式准备并安装依赖。`);
}

/** Ensure the locked local Vite CLI exists, recovering only from the offline bundle. */
export function ensureVite(projectRoot, restoreDependencies = restoreFrontendBundle) {
  const root = resolve(projectRoot);
  declaredVite(root);
  const existingCli = findViteCli(root);
  if (existingCli) return existingCli;
  console.warn('[MyBox build] Local Vite is missing/incomplete. Checking the pre-verified offline dependency bundle; network installation is disabled for normal builds.');
  const restoreResult = restoreDependencies(root);
  if (restoreResult !== 0) throw new Error(`依赖包恢复未成功（exit code ${restoreResult}）。`);
  const restoredCli = findViteCli(root);
  if (!restoredCli) throw new Error('预置依赖包恢复后仍找不到本地 Vite CLI；检查归档、manifest 和 package-lock.json。');
  return restoredCli;
}

/** Run Vite directly through Node, avoiding PATH-dependent .bin resolution. */
export function runVite(projectRoot, args = [], options = {}) {
  const restore = options.restoreDependencies || options.installDependencies || restoreFrontendBundle;
  const spawn = options.spawn || spawnSync;
  const cliPath = ensureVite(projectRoot, restore);
  const result = spawn(process.execPath, [cliPath, ...args], {
    cwd: resolve(projectRoot),
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw new Error(`Unable to start the Vite CLI: ${result.error.message}`);
  if (result.status !== 0) {
    if (result.status === null) throw new Error(`Vite exited without a status (signal ${result.signal || 'unknown'}).`);
    return result.status;
  }
  return 0;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === SCRIPT_PATH) {
  try {
    process.exitCode = runVite(PROJECT_ROOT, process.argv.slice(2));
  } catch (error) {
    console.error(`[MyBox build] ${error.message}`);
    process.exitCode = 1;
  }
}
