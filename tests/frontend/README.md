# 前端静态检查

本目录只说明与前端源码/config 静态检查有关的边界，不执行 Vite，不执行前端构建，不恢复或安装 npm 依赖。

运行静态检查：

```bash
python tests/run_tests.py --only frontend
python tests/run_tests.py --only dependencies
```

项目根目录 `package.json` 保留普通开发使用的 `vite` 命令脚本。AI 助手不得为了任务验证运行 `npm run build`、触发构建的 `npm test`/`npm run lint` 或任何 `vite build` 命令；不得在 `tests/` 下重建构建启动器或依赖归档工具。请遵守根目录 `AGENTS.md` 的项目级限制。
