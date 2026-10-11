from __future__ import annotations
import json
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
import pytest
from playwright.sync_api import sync_playwright

TEST_ROOT = Path(__file__).resolve().parent

def _load_config() -> dict:
    selected = os.environ.get("AI_VISUAL_CONFIG")
    candidates = [Path(selected).expanduser().resolve()] if selected else [TEST_ROOT / "config.json", TEST_ROOT / "config.example.json"]
    for path in candidates:
        if path.is_file():
            with path.open("r", encoding="utf-8") as handle:
                config = json.load(handle)
            config["_config_path"] = str(path)
            return config
    return {"base_url": os.environ.get("AI_VISUAL_BASE_URL", "http://127.0.0.1:4173/"), "viewports": [{"name": "desktop", "width": 1280, "height": 800}], "key_selectors": [], "interactions": []}

CONFIG = _load_config()
if os.environ.get("AI_VISUAL_BASE_URL"):
    CONFIG["base_url"] = os.environ["AI_VISUAL_BASE_URL"]
RUN_ID = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
ARTIFACT_ROOT = Path(os.environ.get("AI_VISUAL_ARTIFACT_DIR", str(TEST_ROOT / "artifacts" / RUN_ID))).expanduser().resolve()
REPORT_ROOT = Path(os.environ.get("AI_VISUAL_REPORT_DIR", str(TEST_ROOT / "reports" / RUN_ID))).expanduser().resolve()
BASELINE_ROOT = Path(os.environ.get("AI_VISUAL_BASELINE_DIR", str(TEST_ROOT / "baselines"))).expanduser().resolve()
for folder in (ARTIFACT_ROOT, REPORT_ROOT, BASELINE_ROOT):
    folder.mkdir(parents=True, exist_ok=True)


def safe_name(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", value).strip("_.") or "test"

@pytest.fixture(scope="session")
def visual_config():
    return CONFIG

@pytest.fixture(scope="session")
def browser():
    with sync_playwright() as playwright:
        executable = os.environ.get("AI_VISUAL_CHROMIUM_EXECUTABLE") or shutil.which("chromium") or shutil.which("chromium-browser") or shutil.which("google-chrome")
        launch_options = {"headless": True}
        if executable:
            launch_options["executable_path"] = executable
        browser = playwright.chromium.launch(**launch_options)
        yield browser
        browser.close()

@pytest.fixture

def page(request, browser, visual_config):
    viewports = visual_config.get("viewports") or [{"name": "desktop", "width": 1280, "height": 800}]
    first = viewports[0]
    context = browser.new_context(
        viewport={"width": int(first["width"]), "height": int(first["height"])},
        device_scale_factor=1,
        reduced_motion="reduce",
    )
    test_name = safe_name(request.node.name)
    trace_path = ARTIFACT_ROOT / f"{test_name}.trace.zip"
    context.tracing.start(screenshots=True, snapshots=True, sources=True)
    current_page = context.new_page()
    events = {"test": request.node.name, "base_url": visual_config.get("base_url"), "started_at_utc": datetime.now(timezone.utc).isoformat(), "console_errors": [], "page_errors": [], "failed_requests": [], "http_errors": [], "navigation": None}
    current_page.on("console", lambda msg: events["console_errors"].append({"type": msg.type, "text": msg.text}) if msg.type == "error" else None)
    current_page.on("pageerror", lambda exc: events["page_errors"].append(str(exc)))
    current_page.on("requestfailed", lambda req: events["failed_requests"].append({"url": req.url, "method": req.method, "failure": req.failure}))
    current_page.on("response", lambda resp: events["http_errors"].append({"url": resp.url, "status": resp.status}) if resp.status >= 400 else None)
    current_page._ai_visual_events = events
    current_page._ai_visual_artifacts = ARTIFACT_ROOT
    current_page._ai_visual_reports = REPORT_ROOT
    current_page._ai_visual_trace = trace_path
    current_page._ai_visual_config = visual_config
    try:
        response = current_page.goto(visual_config.get("base_url", "http://127.0.0.1:4173/"), wait_until="domcontentloaded", timeout=int(visual_config.get("navigation_timeout_ms", 15000)))
        events["navigation"] = {"url": current_page.url, "status": response.status if response else None}
    except Exception as exc:
        events["navigation"] = {"url": current_page.url, "error": str(exc)}
    yield current_page
    try:
        if not current_page.is_closed() and current_page.url != "about:blank":
            current_page.screenshot(path=str(ARTIFACT_ROOT / f"{test_name}-final.png"), full_page=True, animations="disabled", timeout=5000)
    except Exception as exc:
        events.setdefault("teardown_warnings", []).append(f"final screenshot failed: {exc}")
    # Capture on-screen geometry so failures can be located by CSS-pixel coordinates,
    # not only described from a screenshot. Include configured selectors and common controls.
    inventory = []
    try:
        selector_hints = list(visual_config.get("key_selectors", []))
        for item in visual_config.get("interactions", []):
            selector_hints.extend([item.get("trigger", ""), item.get("target", "")])
        inventory = current_page.evaluate("""(hints) => {
          const viewport = {width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1};
          const result = [];
          const add = (el, selectorHint, index) => {
            const r = el.getBoundingClientRect();
            const s = getComputedStyle(el);
            const visible = r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0;
            const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
            const inViewport = cx >= 0 && cy >= 0 && cx < window.innerWidth && cy < window.innerHeight;
            const top = inViewport ? document.elementFromPoint(cx, cy) : null;
            const occludedAtCenter = !!(top && top !== el && !el.contains(top));
            result.push({selectorHint, index, tag: el.tagName.toLowerCase(), id: el.id || null, testid: el.getAttribute('data-testid'), role: el.getAttribute('role'), label: (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.value || '').trim().slice(0, 180), text: (el.innerText || '').trim().slice(0, 180), visible, rect: {x: Math.round(r.x*100)/100, y: Math.round(r.y*100)/100, width: Math.round(r.width*100)/100, height: Math.round(r.height*100)/100, right: Math.round(r.right*100)/100, bottom: Math.round(r.bottom*100)/100}, centerInViewport: inViewport, occludedAtCenter, centerOverlay: occludedAtCenter && top ? {tag: top.tagName.toLowerCase(), id: top.id || null, testid: top.getAttribute('data-testid')} : null, css: {display:s.display, visibility:s.visibility, position:s.position, zIndex:s.zIndex}, html: el.outerHTML.slice(0, 500)});
          };
          for (const selector of hints) {
            if (!selector) continue;
            try { document.querySelectorAll(selector).forEach((el, i) => add(el, selector, i)); }
            catch (e) { result.push({selectorHint: selector, error: String(e)}); }
          }
          const generic = 'button, a[href], input, select, textarea, [role=button], [data-testid]';
          document.querySelectorAll(generic).forEach((el, i) => { if (i < 150) add(el, generic, i); });
          return {viewport, elements: result};
        }""", selector_hints)
        inventory_path = REPORT_ROOT / f"elements-{test_name}.json"
        inventory_path.write_text(json.dumps(inventory, ensure_ascii=False, indent=2), encoding="utf-8")
        events["element_inventory_file"] = str(inventory_path)
        events["element_count"] = len(inventory.get("elements", []))
    except Exception as exc:
        events.setdefault("teardown_warnings", []).append(f"element inventory failed: {exc}")
    events["finished_at_utc"] = datetime.now(timezone.utc).isoformat()
    try:
        context.tracing.stop(path=str(trace_path))
        events["trace_file"] = str(trace_path)
    except Exception as exc:
        events.setdefault("teardown_warnings", []).append(f"trace save failed: {exc}")
    report_path = REPORT_ROOT / f"{test_name}.json"
    report_path.write_text(json.dumps(events, ensure_ascii=False, indent=2), encoding="utf-8")
    context.close()

@pytest.fixture(scope="session")
def visual_paths():
    return {"artifacts": ARTIFACT_ROOT, "reports": REPORT_ROOT, "baselines": BASELINE_ROOT}
