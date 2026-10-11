# APK/Gradle 工程静态检查

静态检查 Android 目录、Gradle wrapper、app Gradle 配置、Manifest、settings 和 Java 运行环境，并记录 Android 内置 `assets/public` 目录结构；不会核验其是否与前端源码同步。

运行静态检查：`python tests/run_tests.py --only apk`

只有用户明确要求独立 APK 打包任务时，才考虑执行 `python tests/run_tests.py --apk-build`。该操作不会构建或同步前端 Web 资源。它不会安装 APK 或进行实机测试。
