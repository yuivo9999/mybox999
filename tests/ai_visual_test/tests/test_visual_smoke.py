from __future__ import annotations
import pytest
from playwright.sync_api import expect


def ensure_page_loaded(page):
    navigation = page._ai_visual_events.get("navigation") or {}
    assert not navigation.get("error"), f"页面导航失败：{navigation.get('error')}"
    assert navigation.get("status") is not None, f"未收到 HTTP 响应：{navigation}"
    assert int(navigation["status"]) < 400, f"页面返回错误 HTTP 状态：{navigation}"


def test_page_is_reachable_and_screenshot_is_saved(page):
    ensure_page_loaded(page)
    assert page.url.startswith(("http://", "https://")), f"页面 URL 不正确：{page.url}"
    path = page._ai_visual_artifacts / "page-initial.png"
    page.screenshot(path=str(path), full_page=True, animations="disabled")
    assert path.is_file() and path.stat().st_size > 0, "未生成有效截图"


def test_configured_key_elements_are_visible(page, visual_config):
    ensure_page_loaded(page)
    selectors = visual_config.get("key_selectors", [])
    if not selectors:
        pytest.skip("没有配置 key_selectors；请按目标项目页面设置关键元素选择器")
    for selector in selectors:
        locator = page.locator(selector).first
        expect(locator, f"关键元素不可见或不存在：{selector}").to_be_visible()


def test_horizontal_overflow_for_configured_viewports(page, visual_config):
    ensure_page_loaded(page)
    if not visual_config.get("check_horizontal_overflow", False):
        pytest.skip("配置已关闭横向溢出断言")
    viewports = visual_config.get("viewports") or [{"name": "desktop", "width": 1280, "height": 800}]
    problems = []
    for viewport in viewports:
        width, height = int(viewport["width"]), int(viewport["height"])
        page.set_viewport_size({"width": width, "height": height})
        page.wait_for_timeout(150)
        metrics = page.evaluate("""() => ({innerWidth: window.innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body ? document.body.scrollWidth : 0, height: window.innerHeight})""")
        screenshot = page._ai_visual_artifacts / f"layout-{viewport.get('name', width)}-{width}x{height}.png"
        page.screenshot(path=str(screenshot), full_page=True, animations="disabled")
        if metrics["documentWidth"] > metrics["innerWidth"] + 2:
            problems.append({"viewport": viewport, "metrics": metrics, "screenshot": str(screenshot)})
    assert not problems, "检测到视口横向溢出：\n" + "\n".join(str(problem) for problem in problems)


def test_visible_buttons_have_accessible_names(page, visual_config):
    ensure_page_loaded(page)
    if not visual_config.get("check_button_names", False):
        pytest.skip("配置已关闭按钮可访问名称检查")
    unnamed = []
    buttons = page.locator("button:visible")
    for index in range(buttons.count()):
        button = buttons.nth(index)
        label = (button.get_attribute("aria-label") or button.get_attribute("title") or button.inner_text() or "").strip()
        if not label:
            unnamed.append({"index": index, "html": button.evaluate("el => el.outerHTML")[:500]})
    assert not unnamed, "以下可见按钮缺少可访问名称或文本：\n" + "\n".join(str(item) for item in unnamed)


def test_configured_interactions(page, visual_config):
    ensure_page_loaded(page)
    interactions = visual_config.get("interactions", [])
    if not interactions:
        pytest.skip("没有配置 interactions；请为真实项目定义触发元素与预期状态")
    for index, item in enumerate(interactions):
        # Every scenario starts from a fresh page so one interaction (for example
        # hiding the navigation bar or opening a modal) cannot contaminate the next.
        response = page.goto(visual_config.get("base_url", "http://127.0.0.1:4173/"), wait_until="domcontentloaded", timeout=int(visual_config.get("navigation_timeout_ms", 15000)))
        assert response is not None and response.status < 400, f"场景 {item.get('name', index)} 的页面重载失败"
        name = item.get("name", item.get("trigger", "interaction"))
        trigger = page.locator(item["trigger"]).first
        expect(trigger, f"交互触发器不存在或不可见：{name} / {item['trigger']}").to_be_visible()
        trigger.click(timeout=int(item.get("timeout_ms", 3000)))
        target = page.locator(item["target"]).first
        expected = item.get("expected", "visible")
        if expected == "visible":
            expect(target, f"交互后目标元素应可见：{name} / {item['target']}").to_be_visible(timeout=int(item.get("timeout_ms", 3000)))
        elif expected == "hidden":
            expect(target, f"交互后目标元素应隐藏：{name} / {item['target']}").to_be_hidden(timeout=int(item.get("timeout_ms", 3000)))
        else:
            raise AssertionError(f"不支持的 expected='{expected}'；仅支持 visible/hidden：{name}")
        page.screenshot(path=str(page._ai_visual_artifacts / f"interaction-{name.replace(' ', '_')}.png"), full_page=True, animations="disabled")


def test_no_uncaught_javascript_page_errors(page):
    ensure_page_loaded(page)
    events = page._ai_visual_events
    assert not events["page_errors"], "出现未捕获的页面 JavaScript 错误：\n" + "\n".join(events["page_errors"])


def test_no_browser_console_errors(page):
    ensure_page_loaded(page)
    errors = page._ai_visual_events["console_errors"]
    assert not errors, "浏览器控制台出现 error：\n" + "\n".join(str(item) for item in errors)


def test_no_failed_first_party_requests(page):
    ensure_page_loaded(page)
    from urllib.parse import urlparse
    origin = urlparse(page.url)
    events = page._ai_visual_events
    failed = [item for item in events["failed_requests"] if (urlparse(item["url"]).scheme, urlparse(item["url"]).netloc) == (origin.scheme, origin.netloc)]
    http_errors = [item for item in events["http_errors"] if (urlparse(item["url"]).scheme, urlparse(item["url"]).netloc) == (origin.scheme, origin.netloc)]
    assert not failed, "本站请求失败：\n" + "\n".join(str(item) for item in failed)
    assert not http_errors, "本站资源返回 HTTP 错误：\n" + "\n".join(str(item) for item in http_errors)
