# APK/Gradle 工程检查

静态检查 Android 目录、Gradle wrapper、app Gradle 配置、manifest、settings 和 Java 运行环境。只有显式执行 `python tests/run_tests.py --apk-build` 才会调用 assembleDebug；不会安装 APK 或进行实机测试。

运行本类别：`python tests/run_tests.py --only apk`
