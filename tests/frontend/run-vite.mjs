#!/usr/bin/env node
/**
 * Run the project's locally locked Vite CLI, restoring npm dependencies when
 * Vite is missing. This prevents an unhelpful "vite: not found" failure from
 * an uninstalled or incomplete node_modules directory.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(SCRIPT_PATH), '../..');
const DEFAULT_INSTALL_TIMEOUT_MS = 5 * 60 * 1000;

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
  const bin = typeof vitePackage.bin === 'string'
    ? vitePackage.bin
    : vitePackage.bin?.vite;
  if (typeof bin !== 'string' || !bin.trim()) return null;

  const packageDirectory = resolve(projectRoot, 'node_modules', 'vite');
  const cliPath = resolve(packageDirectory, bin);
  // Do not execute a malformed package manifest that points outside vite/.
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

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor < 22) {
    throw new Error(`This project requires Node.js >=22 (current: ${process.versions.node}). Select Node.js 22 or newer, then retry.`);
  }
  return manifest;
}

function installNpmDependencies(projectRoot) {
  const lockPath = resolve(projectRoot, 'package-lock.json');
  const shrinkwrapPath = resolve(projectRoot, 'npm-shrinkwrap.json');
  if (!existsSync(lockPath) && !existsSync(shrinkwrapPath)) {
    throw new Error('Vite is missing and no package-lock.json/npm-shrinkwrap.json exists. Refusing a non-reproducible automatic install.');
  }

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const configuredTimeout = Number(process.env.MYBOX_NPM_CI_TIMEOUT_MS);
  const timeout = Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? configuredTimeout
    : DEFAULT_INSTALL_TIMEOUT_MS;

  console.log('[MyBox build] Local Vite is missing. Running `npm ci --no-audit --no-fund` from the project lock file...');
  const result = spawnSync(npmCommand, ['ci', '--no-audit', '--no-fund'], {
    cwd: projectRoot,
    stdio: 'inherit',
    timeout,
    shell: process.platform === 'win32',
    windowsHide: true,
  });

  if (result.error) {
    const reason = result.error.code === 'ETIMEDOUT'
      ? `npm ci exceeded the ${Math.round(timeout / 1000)}-second timeout`
      : result.error.message;
    throw new Error(`Unable to prepare frontend dependencies: ${reason}. Check network access, npm registry access, and Node.js/npm installation.`);
  }
  if (result.status !== 0) {
    const detail = result.signal ? ` (signal ${result.signal})` : '';
    throw new Error(`Unable to prepare frontend dependencies: npm ci exited with code ${result.status ?? 'unknown'}${detail}. Fix the npm installation error and retry.`);
  }
  return 0;
}

/** Ensure the locked local Vite CLI exists, running npm ci only when necessary. */
export function ensureVite(projectRoot, installDependencies = installNpmDependencies) {
  const root = resolve(projectRoot);
  declaredVite(root);

  const existingCli = findViteCli(root);
  if (existingCli) return existingCli;

  if (!existsSync(resolve(root, 'package-lock.json')) && !existsSync(resolve(root, 'npm-shrinkwrap.json'))) {
    throw new Error('Vite is missing and no package-lock.json/npm-shrinkwrap.json exists. Refusing a non-reproducible automatic install.');
  }

  console.warn('[MyBox build] node_modules/vite is missing or incomplete; attempting a lock-file-based dependency restore.');
  const installResult = installDependencies(root);
  if (installResult !== 0) {
    throw new Error(`Dependency restoration did not succeed (exit code ${installResult}).`);
  }

  const restoredCli = findViteCli(root);
  if (!restoredCli) {
    throw new Error('npm ci finished but the local Vite CLI is still missing. Check package-lock.json and npm install logs.');
  }
  return restoredCli;
}

/** Run Vite directly through Node, avoiding PATH-dependent .bin resolution. */
export function runVite(projectRoot, args = [], options = {}) {
  const install = options.installDependencies || installNpmDependencies;
  const spawn = options.spawn || spawnSync;
  const cliPath = ensureVite(projectRoot, install);
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
