# MyBox AI 浏览器视觉测试工具（可独立放入 `tests/`）

本工具在本地 Chromium 浏览器中运行网页测试：启动本地 HTTP 服务、检查 DOM/元素坐标、执行配置的交互、捕获 JavaScript 与网络错误、保存截图和 Playwright trace，并可进行基线截图对比。

**重要边界**：`demo/` 是用于验证测试工具本身的示例页面，不代表 MyBox 实际页面通过测试。要测试真实项目，请把服务器根目录指向项目已有的网页资源目录，并为真实页面配置选择器。若该目录包含尚未同步的旧资源，测试报告必须视为旧资源测试结果。

## 目录

- `server.py`：标准库 HTTP 服务，默认只监听 `127.0.0.1:4173`。
- `demo/`：示例页面，用于确认端口、浏览器、截图和交互测试链路工作正常。
- `config.example.json`：示例测试配置；测试真实项目时复制为 `config.json` 并修改。
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

## 2. 先验证测试工具自身

从项目根目录运行本地示例页面：

```bash
python tests/ai_visual_test/server.py --port 4173
```

保持服务器运行，在另一终端执行：

```bash
AI_VISUAL_CONFIG=tests/ai_visual_test/config.example.json python -m pytest tests/ai_visual_test/tests -v
```

默认地址为 `http://127.0.0.1:4173`。服务器和 Playwright 浏览器必须运行在可以互相访问的同一环境中；容器或远程执行环境需要另外配置网络/端口转发。

## 3. 测试 Android 项目内置的静态网页资源

如果需要检查 Android 项目当前内置的静态前端资源，可从项目根目录把服务根目录指向 `android/app/src/main/assets/public`：

```bash
python tests/ai_visual_test/server.py --root android/app/src/main/assets/public --port 4173
```

然后在另一终端执行测试。请使用单独的配置文件，并把示例页面专用选择器改成真实页面的 CSS/ARIA 选择器。静态服务器仅提供目录中的文件，不会重新构建资源，也不会自动将源代码修改同步到这里。

若项目当前没有可直接运行的页面入口，或实际源代码必须经打包后才能运行，这种方式只能检查内置静态资源，不能代替真实前端构建验证。

## 4. 测试真实页面的配置方式

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

## 5. 视觉基线

首次确认页面布局正确后，捕获基线：

```bash
AI_VISUAL_CONFIG=tests/ai_visual_test/config.json python tests/ai_visual_test/capture_baselines.py
```

之后运行测试会将当前截图与 `baselines/` 中相同视口的基线进行比较。视觉比较是像素差异提示，不会自动证明差异就是缺陷；动态内容、视频帧、时间文本和动画可能产生误报，应使用静态测试数据或将动态区域纳入专门处理。

## 6. 结果与诊断

- `artifacts/`：实际截图、视觉差异图与每个测试的 Playwright trace ZIP。
- `reports/`：导航结果、控制台错误、页面异常、请求失败及 HTTP 错误记录；`elements-*.json` 提供元素坐标与可见状态，便于进一步分析截图。
- pytest 输出：通过、失败或跳过，以及可读的失败原因。

测试通过只说明当前浏览器、当前地址、当前配置和实际加载的资源满足所定义的断言。它不能证明 Android 原生全屏、真实设备 WebView、真实视频解码或服务端可用性正常；不能验证的行为应明确标记为“未验证”。
