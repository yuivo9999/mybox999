# Frontend offline dependency bundle

This directory is reserved for a **pre-verified, platform-specific `node_modules` archive** and its `manifest.json`.

The archive is intentionally not fabricated or populated with an incomplete cache. At the time this change was prepared, the available npm cache could not satisfy `npm ci --offline` (`ENOTCACHED`, missing `yauzl`) and `registry.npmjs.org` was not reachable from the execution environment. Therefore this directory contains no usable bundle until the explicit preparation command succeeds on a connected maintenance host.

## Prepare once on a connected, matching environment

From the project root:

```bash
python tests/environment/frontend_bundle.py --prepare
```

This explicit maintenance operation runs locked npm installation, verifies direct dependency versions, performs a real `npm run build`, archives the resulting `node_modules`, and writes a manifest with platform/runtime data and SHA-256 hashes.

Deliver/copy the generated `.tar.gz` **and** `manifest.json` together with this project. The archive is platform-specific; do not use Linux `node_modules` on Windows/macOS or across CPU architectures. If `package.json` or `package-lock.json` changes, regenerate the archive.

## Normal build behavior

Normal `npm run build` does not download npm packages. If Vite is missing, the launcher calls the restore tool:

```bash
python tests/environment/frontend_bundle.py --restore
```

Restore verifies manifest hashes, project lockfile hashes, Node major version and platform before extracting to a temporary location. It validates required direct dependency versions before atomically replacing `node_modules`. If there is no valid bundle, it stops with `BLOCKED`; run `--prepare` only in an environment where dependency preparation is explicitly approved and network/cache availability is known.
