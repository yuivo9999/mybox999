# 前端功能、依赖恢复与构建检查

静态检查 `package.json`、build 脚本、Vite 依赖声明、锁文件与前端入口：

```bash
python tests/run_tests.py --only frontend
python tests/run_tests.py --only dependencies
```

## 自动防护 `vite: not found`：本地预置归档优先

项目的 `dev`、`build`、`preview`、`lint` 与 `test` 脚本都经过 `tests/frontend/run-vite.mjs`。Vite 缺失时，启动器只允许从 `tests/toolchain-cache/frontend-deps/` 校验并恢复 `node_modules`，正常构建不自动 `npm ci`，也不临时联网下载。

在具备网络或完整 npm 缓存的准备环境中明确执行一次：

```bash
python tests/environment/frontend_bundle.py --prepare
```

该维护命令会安装锁文件依赖、检查直接依赖版本、执行生产构建，再归档 `node_modules` 并生成 SHA-256 manifest。归档与 manifest 应共同交付。若归档缺失、锁文件哈希/平台不一致或内容校验失败，构建会明确输出 `BLOCKED`，不会继续尝试随机下载。

## 检查恢复机制

```bash
npm run test:frontend-bootstrap
```

该测试使用临时测试目录和模拟的本地 Vite CLI，不会安装真实依赖，也不会改动项目的 `node_modules`。

执行正式构建：

```bash
npm run build
# 或
python tests/run_tests.py --frontend-build
```
