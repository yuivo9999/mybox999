# 集成链路检查

核对 npm 清单、源 HTML、Android assets/public/index.html 和预置 JS/CSS 文件是否存在；文件同名不等于内容同版本，最终仍应检查引用关系和资源同步过程。

运行本类别：`python tests/run_tests.py --only integration`
