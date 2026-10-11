import json
import sys
import tarfile
import tempfile
import unittest
import zipfile
import hashlib
import platform
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT_TOOLS = HERE.parent / 'environment'
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT_TOOLS))
from build_common import make_assets_manifest, verify_dist_to_android, verify_current_source_manifest, apk_asset_hashes
from frontend_bundle import _validate_tar_members, restore, node_info, manifest_path

class BuildIntegrityTests(unittest.TestCase):
    def fixture(self, base: Path):
        (base/'src').mkdir(parents=True)
        (base/'public').mkdir()
        (base/'node_modules'/'vite').mkdir(parents=True)
        (base/'package.json').write_text(json.dumps({'name':'fixture','version':'1.0.0','dependencies':{'vite':'8.3.2'}}))
        (base/'package-lock.json').write_text(json.dumps({'lockfileVersion':3,'packages':{'node_modules/vite':{'version':'8.3.2'}}}))
        (base/'node_modules'/'vite'/'package.json').write_text(json.dumps({'name':'vite','version':'8.3.2'}))
        (base/'src'/'App.jsx').write_text('export default 1;')
        (base/'index.html').write_text('<div id="app"></div>')
        dist=base/'dist'; (dist/'assets').mkdir(parents=True)
        (dist/'index.html').write_text('<html><head><link rel="stylesheet" href="/assets/app.css"></head><body><script type="module" src="/assets/app.js"></script></body></html>')
        (dist/'assets'/'app.js').write_text('console.log("fresh");')
        (dist/'assets'/'app.css').write_text('body{margin:0}')
        assets=base/'android'/'app'/'src'/'main'/'assets'/'public'; assets.mkdir(parents=True)
        for path in dist.rglob('*'):
            if path.is_file():
                target=assets/path.relative_to(dist); target.parent.mkdir(parents=True,exist_ok=True); target.write_bytes(path.read_bytes())
        return dist, assets

    def test_manifest_passes_when_dist_and_android_hashes_match(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td); dist,assets=self.fixture(root)
            manifest=make_assets_manifest(root,dist)
            result=verify_dist_to_android(root,manifest,dist,assets)
            self.assertTrue(result['pass'],result)
            self.assertEqual(result['matchingAssetCount'],3)

    def test_source_change_invalidates_old_manifest(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td); dist,assets=self.fixture(root)
            manifest=make_assets_manifest(root,dist)
            (root/'src'/'App.jsx').write_text('export default 2;')
            check=verify_current_source_manifest(root,manifest)
            self.assertFalse(check['pass'])
            result=verify_dist_to_android(root,manifest,dist,assets)
            self.assertFalse(result['pass'])

    def test_android_js_hash_mismatch_fails(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td); dist,assets=self.fixture(root)
            manifest=make_assets_manifest(root,dist)
            (assets/'assets'/'app.js').write_text('console.log("old");')
            result=verify_dist_to_android(root,manifest,dist,assets)
            self.assertFalse(result['pass'])
            self.assertEqual(result['mismatchedAndroidAssets'][0]['path'],'assets/app.js')

    def test_apk_asset_reader_hashes_embedded_files(self):
        with tempfile.TemporaryDirectory() as td:
            apk=Path(td)/'fixture.apk'
            with zipfile.ZipFile(apk,'w',zipfile.ZIP_DEFLATED) as z:
                z.writestr('assets/public/index.html','<html></html>')
                z.writestr('assets/public/assets/app.js','console.log(1)')
            hashes=apk_asset_hashes(apk)
            self.assertIn('index.html',hashes)
            self.assertIn('assets/app.js',hashes)

    def test_offline_bundle_restore_checks_manifest_and_recovers_node_modules(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root/'tests'/'toolchain-cache'/'frontend-deps').mkdir(parents=True)
            (root/'package.json').write_text(json.dumps({'name':'offline-fixture','private':True,'type':'module','engines':{'node':'>=22.12.0'},'dependencies':{'vite':'8.3.2'}}))
            lock = {'lockfileVersion':3,'packages':{'node_modules/vite':{'version':'8.3.2'}}}
            (root/'package-lock.json').write_text(json.dumps(lock))
            nm = root/'node_modules'; (nm/'vite'/'bin').mkdir(parents=True)
            (nm/'vite'/'package.json').write_text(json.dumps({'name':'vite','version':'8.3.2','bin':{'vite':'bin/vite.js'}}))
            (nm/'vite'/'bin'/'vite.js').write_text('process.exit(0);')
            archive = root/'tests'/'toolchain-cache'/'frontend-deps'/'fixture.tar.gz'
            with tarfile.open(archive,'w:gz') as tar: tar.add(nm,arcname='node_modules')
            def sha(path):
                h=hashlib.sha256(); h.update(path.read_bytes()); return h.hexdigest()
            info=node_info(root)
            manifest={'schemaVersion':1,'archivePath':archive.relative_to(root).as_posix(),'archiveSha256':sha(archive),'archiveBytes':archive.stat().st_size,
                      'packageJsonSha256':sha(root/'package.json'),'packageLockSha256':sha(root/'package-lock.json'),
                      'runtime':{'nodeVersion':info['version'],'nodeMajor':int(info['version'].split('.')[0]),'platform':info['platform'],'architecture':info['arch']},'viteVersion':'8.3.2'}
            manifest_path(root).write_text(json.dumps(manifest))
            import shutil
            shutil.rmtree(nm)
            self.assertEqual(restore(root),0)
            self.assertTrue((root/'node_modules'/'vite'/'bin'/'vite.js').is_file())

    def test_dependency_archive_rejects_parent_traversal(self):
        with tempfile.TemporaryDirectory() as td:
            tar_path=Path(td)/'bad.tar.gz'
            with tarfile.open(tar_path,'w:gz') as tar:
                info=tarfile.TarInfo('../node_modules/evil.txt'); info.size=1
                import io
                tar.addfile(info,io.BytesIO(b'x'))
            with tarfile.open(tar_path,'r:gz') as tar:
                with self.assertRaisesRegex(RuntimeError,'不安全路径'):
                    _validate_tar_members(tar)

if __name__ == '__main__': unittest.main(verbosity=2)
