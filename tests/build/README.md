# MyBox AI build-integrity tools

These scripts exist to support the AI development workflow. They are not Android app features and are not production dependencies.

## 1. Diagnose first (read-only)

```bash
python tests/environment/build_doctor.py
python tests/environment/build_doctor.py --node --android --network
```

The doctor does not install dependencies or download anything. `--network` only performs DNS lookups for `registry.npmjs.org` and `services.gradle.org`.

## 2. Prepare frontend dependencies once

In a connected maintenance environment, with Node.js 22.12+ and npm:

```bash
python tests/environment/frontend_bundle.py --prepare
```

The script runs `npm ci`, checks installed direct dependency versions, runs the production Vite build, then archives `node_modules` and writes `tests/toolchain-cache/frontend-deps/manifest.json`. Deliver the archive and manifest together. The bundle is tied to the project manifest/lock hashes, Node major version, OS and architecture.

Normal `npm run build` does not download packages. If the local Vite CLI is absent, `tests/frontend/run-vite.mjs` invokes the local restore tool. No verified archive means `BLOCKED`, not a network retry.

## 3. Build and sync assets

```bash
python tests/build/sync_android_assets.py
```

This always executes a fresh `npm run build`; there is no mode to reuse an old `dist/`. It then runs the project-local Capacitor CLI, compares every expected `dist/` file to Android `assets/public/` by SHA-256, and writes `tests/reports/build/latest-assets-manifest.json` only as a traceable build record. A failing build prevents resource copy.

## 4. Verify the resources and APK

```bash
python tests/build/verify_android_assets.py
python tests/build/verify_apk_assets.py --apk android/app/build/outputs/apk/debug/app-debug.apk
```

The asset manifest contains the build ID, dependency lock hashes, source-tree fingerprint, Vite version, and each file's hash. Verification refuses a manifest if source inputs changed after the build. APK verification extracts the actual files from the APK ZIP and hashes them against the same manifest.

Unreferenced extra Android JS/CSS is reported, not automatically deleted, because legacy and plugin files may not be owned by Vite.

## 5. One explicit pipeline

```bash
python tests/build/android_build_pipeline.py
python tests/build/android_build_pipeline.py --release
# or through the unified AI test runner
python tests/run_tests.py --android-build-pipeline
python tests/run_tests.py --android-build-pipeline --release
```

The pipeline stops on the first failed/blocked stage, does not package an old `dist/`, and verifies the final APK's `assets/public/` bytes against the manifest. Logs and JSON status are stored under `tests/reports/build/`.
