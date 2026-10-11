# 静态资源完整性检查

检查 HTML 的 src/href/poster 和 CSS url(...) 中可识别的本地资源引用。动态拼接路径、运行时加载资源以及非标准根目录可能需要人工确认，静态检查不能覆盖全部运行时资源。

运行本类别：`python tests/run_tests.py --only resources`
