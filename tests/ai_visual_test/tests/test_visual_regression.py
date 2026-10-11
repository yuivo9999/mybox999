from __future__ import annotations
import re
import pytest
from PIL import Image, ImageChops


def _name(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", value).strip("_.") or "viewport"


def test_visual_baselines_for_configured_viewports(page, visual_config, visual_paths):
    navigation = page._ai_visual_events.get("navigation") or {}
    assert not navigation.get("error"), f"页面导航失败：{navigation.get('error')}"
    assert navigation.get("status") is not None and int(navigation["status"]) < 400, f"页面不可用：{navigation}"
    viewports = visual_config.get("viewports") or [{"name": "desktop", "width": 1280, "height": 800}]
    threshold = float(visual_config.get("visual_difference_threshold", 0.015))
    pixel_threshold = int(visual_config.get("visual_pixel_threshold", 20))
    missing = []
    failures = []
    for viewport in viewports:
        width, height = int(viewport["width"]), int(viewport["height"])
        label = _name(str(viewport.get("name", f"{width}x{height}")))
        baseline = visual_paths["baselines"] / f"page-{label}-{width}x{height}.png"
        actual = visual_paths["artifacts"] / f"visual-{label}-{width}x{height}.png"
        page.set_viewport_size({"width": width, "height": height})
        page.wait_for_timeout(100)
        page.screenshot(path=str(actual), full_page=True, animations="disabled")
        if not baseline.exists():
            missing.append(str(baseline))
            continue
        with Image.open(baseline) as baseline_source, Image.open(actual) as actual_source:
            expected = baseline_source.convert("RGB")
            current = actual_source.convert("RGB")
            if expected.size != current.size:
                failures.append(f"{label}: 图片尺寸不同，预期 {expected.size}，实际 {current.size}；截图 {actual}")
                continue
            diff = ImageChops.difference(expected, current)
            grey = diff.convert("L")
            mask = grey.point(lambda pixel: 255 if pixel > pixel_threshold else 0)
            changed = sum(1 for value in mask.getdata() if value)
            total = max(1, expected.width * expected.height)
            ratio = changed / total
            if ratio > threshold:
                diff_path = visual_paths["artifacts"] / f"diff-{label}-{width}x{height}.png"
                diff.save(diff_path)
                failures.append(f"{label}: 差异像素比例 {ratio:.3%} 超过阈值 {threshold:.3%}；实际截图 {actual}；差异图 {diff_path}")
    assert not failures, "视觉回归差异：\n" + "\n".join(failures)
    if missing:
        pytest.skip("尚无已确认的视觉基线；先确认页面正确，再运行 capture_baselines.py：\n" + "\n".join(missing))
