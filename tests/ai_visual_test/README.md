# MyBox AI 浏览器视觉测试工具（可独立放入 `tests/`）

本工具在本地 Chromium 浏览器中运行网页测试：可验证工具 Demo，也可启动真实 MyBox Vite 开发服务器并进入 LIVE 页面；检查 DOM/元素坐标、执行配置的交互、捕获 JavaScript 与网络错误、保存截图和 Playwright trace，并可进行基线截图对比。测试结束后会生成测试摘要与 `AI_REVIEW.md`，并尽力输出截图联系表。

**重要边界**：`demo/` 是用于验证测试工具本身的示例页面，不代表 MyBox 实际页面通过测试。要测试真实项目，请把服务器根目录指向项目已有的网页资源目录，并为真实页面配置选择器。若该目录包含尚未同步的旧资源，测试报告必须视为旧资源测试结果。

## 目录

- `server.py`：标准库 HTTP 服务，默认只监听 `127.0.0.1:4173`。
- `demo/`：示例页面，用于确认端口、浏览器、截图和交互测试链路工作正常。
- `config.example.json`：工具 Demo 配置，不代表 MyBox 页面验证结果。
- `config.mybox.example.json`：实际 MyBox LIVE 页面配置模板，自动点击底部“直播”导航。
- `tests/`：Playwright 自动化测试。
- `capture_baselines.py`：捕获当前页面的视觉基线截图。
- `baselines/`：预期截图。
- `artifacts/`：实际截图、差异图和 trace。
- `reports/`：每项测试采集的 JSON 诊断信息，以及 `elements-*.json` 元素清单（包括 CSS 像素坐标、尺寸、可见性、中心点遮挡线索和元素标签）。

## 1. 准备测试依赖

在能够访问目标项目目录的 Python 环境中准备依赖：

```bash
python -m pip install -r tests/ai_visual_test/requirements.txt
```

测试工具会优先使用 `AI_VISUAL_CHROMIUM_EXECUTABLE` 指定的浏览器，其次自动查找系统中的 `chromium`、`chromium-browser` 或 `google-chrome`；如果都不存在，再执行 `python -m playwright install chromium` 安装 Playwright 配套浏览器。这里只准备浏览器测试工具，不会执行前端构建、APK 构建或实机测试。

## 2. 验证测试工具自身（Demo）

从项目根目录运行本地示例页面：

```bash
python tests/ai_visual_test/server.py --port 4173
```

保持服务器运行，在另一终端执行：

```bash
AI_VISUAL_CONFIG=tests/ai_visual_test/config.example.json python -m pytest tests/ai_visual_test/tests -v
```

更推荐从项目根目录执行 `python tests/run_tests.py --visual`，入口会自动启动 Demo 服务、运行 Playwright 并输出诊断报告。默认端口被占用时会停止并提示更换 `--port`，不会偷偷连到不明服务。

## 3. 测试真实 MyBox LIVE 页面（推荐用于 UI 任务）

从项目根目录执行：

```bash
python tests/run_tests.py --visual-app
```

工具会通过 `tests/frontend/run-vite.mjs` 启动项目的 Vite 开发服务器，加载 `config.mybox.example.json`，点击可访问名称为“直播”的按钮，然后等待 `.sangtian-window` 出现。会检查关键元素、元素几何、手机 320/360/390/412 CSS px 视口、横向溢出、交互状态、控制台和本站请求，并保存截图、元素清单、运行时事件与 trace。

如果 Vite 缺失，现有启动器会尝试按 `package-lock.json` 恢复依赖，因此此命令可能访问 npm registry。可以调整端口，例如 `python tests/run_tests.py --visual-app --port 4381`。端口已占用、依赖安装失败、Chromium 无法启动或页面未按配置进入 LIVE 时，测试应停止并报告具体原因，不会终止占用端口的无关进程。

如果浏览器报 `ERR_BLOCKED_BY_ADMINISTRATOR`，测试环境的 Chromium 可能被组织策略禁止访问所有 URL。此时测试会将浏览器验证标记为 `UNVERIFIED` 并停止该场景，不会尝试绕过浏览器策略；请在有权限的浏览器执行环境中重跑。

`block_external_requests` 为真实页面配置启用，以避免截图依赖第三方图片/直播地址的网络状态；因此该模式验证的是本地页面布局与交互，不验证真实直播源、第三方服务或网络可用性。

## 4. 测试 Android 项目内置的静态网页资源

如果需要检查 Android 项目当前内置的静态前端资源，可从项目根目录把服务根目录指向 `android/app/src/main/assets/public`：

```bash
python tests/ai_visual_test/server.py --root android/app/src/main/assets/public --port 4173
```

然后在另一终端执行测试。请使用单独的配置文件，并把示例页面专用选择器改成真实页面的 CSS/ARIA 选择器。静态服务器仅提供目录中的文件，不会重新构建资源，也不会自动将源代码修改同步到这里。

若项目当前没有可直接运行的页面入口，或实际源代码必须经打包后才能运行，这种方式只能检查内置静态资源，不能代替真实前端构建验证。

## 5. 测试其他真实页面的配置方式

复制配置文件：

```bash
cp tests/ai_visual_test/config.example.json tests/ai_visual_test/config.json
```

然后编辑 `config.json`：

- `base_url`：目标页面的本地地址。
- `key_selectors`：应存在并可见的关键元素选择器；不要保留 Demo 选择器。
- `interactions`：触发器、目标元素和目标可见状态；无适用交互时设为空数组。
- `check_horizontal_overflow`：是否把横向溢出判为失败。
- `check_button_names`：是否检查可见按钮有可访问名称。
- `viewports`：要检查的视口尺寸。

运行：

```bash
AI_VISUAL_CONFIG=tests/ai_visual_test/config.json python -m pytest tests/ai_visual_test/tests -v
```

## 6. 视觉基线

首次确认页面布局正确后，捕获基线：

```bash
AI_VISUAL_CONFIG=tests/ai_visual_test/config.json python tests/ai_visual_test/capture_baselines.py
```

之后运行测试会将当前截图与 `baselines/` 中相同视口的基线进行比较。视觉比较是像素差异提示，不会自动证明差异就是缺陷；动态内容、视频帧、时间文本和动画可能产生误报，应使用静态测试数据或将动态区域纳入专门处理。

## 7. 结果与诊断

- `artifacts/`：实际截图、视觉差异图、每个测试的 Playwright trace ZIP 与 `contact-sheet.png`（联系表只供快速浏览）。
- `reports/`：导航结果、启动动作、控制台错误、页面异常、被阻止的外部请求、本站请求失败及 HTTP 错误记录；`elements-*.json` 提供元素坐标、尺寸、可见性与中心点遮挡线索；`visual-summary.json` 汇总测试状态，`AI_REVIEW.md` 提供视觉复核清单。
- pytest 输出：通过、失败或跳过，以及可读的失败原因。

测试通过只说明当前浏览器、当前地址、当前配置和实际加载的资源满足所定义的断言。它不能证明 Android 原生全屏、真实设备 WebView、真实视频解码或服务端可用性正常；不能验证的行为应明确标记为“未验证”。

## 8. AI 视觉复核约定

自动化脚本只负责生成证据与执行可程序化断言，并不能判断界面是否“好看”。执行 UI 任务的 AI/开发者应打开 `artifacts/` 下的真实应用原始截图，结合元素几何 JSON 和错误报告进行视觉分析；修改代码后再次运行并查看新截图。请按 `review-template.md` 记录问题、修复与结论。`AI_REVIEW.md` 在实际检查完成前必须保持 PENDING。
