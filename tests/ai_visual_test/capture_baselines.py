#!/usr/bin/env python3
"""Capture approved visual baseline screenshots for configured viewports."""
from __future__ import annotations
import json
import os
import shutil
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent

def main() -> int:
    config_path = Path(os.environ.get("AI_VISUAL_CONFIG", str(HERE / "config.json" if (HERE / "config.json").exists() else HERE / "config.example.json"))).expanduser().resolve()
    if not config_path.is_file():
        raise SystemExit(f"找不到配置文件：{config_path}")
    config = json.loads(config_path.read_text(encoding="utf-8"))
    url = os.environ.get("AI_VISUAL_BASE_URL", config.get("base_url", "http://127.0.0.1:4173/"))
    output = Path(os.environ.get("AI_VISUAL_BASELINE_DIR", str(HERE / "baselines"))).expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    viewports = config.get("viewports") or [{"name": "desktop", "width": 1280, "height": 800}]
    with sync_playwright() as p:
        executable = os.environ.get("AI_VISUAL_CHROMIUM_EXECUTABLE") or shutil.which("chromium") or shutil.which("chromium-browser") or shutil.which("google-chrome")
        launch_options = {"headless": True}
        if executable:
            launch_options["executable_path"] = executable
        browser = p.chromium.launch(**launch_options)
        try:
            for vp in viewports:
                width, height = int(vp["width"]), int(vp["height"])
                name = str(vp.get("name", f"{width}x{height}")).replace(" ", "_")
                page = browser.new_page(viewport={"width": width, "height": height}, device_scale_factor=1, reduced_motion="reduce")
                response = page.goto(url, wait_until="domcontentloaded", timeout=int(config.get("navigation_timeout_ms", 15000)))
                if response is None or response.status >= 400:
                    raise RuntimeError(f"页面加载失败：{url}; status={response.status if response else None}")
                page.screenshot(path=str(output / f"page-{name}-{width}x{height}.png"), full_page=True, animations="disabled")
                print(f"已保存基线：{output / f'page-{name}-{width}x{height}.png'}")
                page.close()
        finally:
            browser.close()
    print("基线截图已生成。请先人工确认这些图片确实代表期望结果，再用于后续回归比较。")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
