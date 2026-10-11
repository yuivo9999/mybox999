# 前端功能、依赖恢复与构建检查

静态检查 `package.json`、build 脚本、Vite 依赖声明、锁文件与前端入口：

```bash
python tests/run_tests.py --only frontend
python tests/run_tests.py --only dependencies
```

## 自动防护 `vite: not found`

项目的 `dev`、`build`、`preview`、`lint` 与 `test` 脚本均通过 `tests/frontend/run-vite.mjs` 启动本地锁定版本的 Vite。运行前会确认 `node_modules/vite` 的 CLI 真实存在；如果缺失或安装不完整，启动器将检查 Node.js 版本与 npm 锁文件，并尝试执行：

```bash
npm ci --no-audit --no-fund
```

安装成功后重新检查本地 Vite，再使用当前 Node.js 直接启动其 CLI，不依赖 shell 是否能找到 `node_modules/.bin/vite`。如果网络、npm registry 或依赖安装失败，启动器会给出实际安装错误，不会把失败伪装成构建成功。默认安装超时为 5 分钟，可通过 `MYBOX_NPM_CI_TIMEOUT_MS` 调整。

自动恢复需要可用的 Node.js 22+、npm、有效 `package-lock.json` 和依赖下载能力。离线环境或 registry 不可访问时，仍需先在可用网络环境中安装项目依赖。

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
