# 依赖环境检查

检查 node/npm 是否可用、依赖是否声明、锁文件和 node_modules 是否存在。默认不安装依赖；如果已确认使用 npm 且 package-lock.json 正确，可显式运行 `python tests/run_tests.py --install-node-deps`。

运行本类别：`python tests/run_tests.py --only dependencies`
