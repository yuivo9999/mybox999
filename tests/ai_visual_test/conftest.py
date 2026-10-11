from __future__ import annotations

import json
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import pytest
from playwright.sync_api import sync_playwright

TEST_ROOT = Path(__file__).resolve().parent


def _load_config() -> dict:
    selected = os.environ.get("AI_VISUAL_CONFIG")
    candidates = [Path(selected).expanduser().resolve()] if selected else [
        TEST_ROOT / "config.json",
        TEST_ROOT / "config.example.json",
    ]
    for path in candidates:
        if path.is_file():
            with path.open("r", encoding="utf-8") as handle:
                config = json.load(handle)
            config["_config_path"] = str(path)
            return config
    return {
        "base_url": os.environ.get("AI_VISUAL_BASE_URL", "http://127.0.0.1:4173/"),
        "viewports": [{"name": "desktop", "width": 1280, "height": 800}],
        "key_selectors": [],
        "geometry_selectors": [],
        "interactions": [],
    }


CONFIG = _load_config()
if os.environ.get("AI_VISUAL_BASE_URL"):
    CONFIG["base_url"] = os.environ["AI_VISUAL_BASE_URL"]
RUN_ID = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
ARTIFACT_ROOT = Path(
    os.environ.get("AI_VISUAL_ARTIFACT_DIR", str(TEST_ROOT / "artifacts" / RUN_ID))
).expanduser().resolve()
REPORT_ROOT = Path(
    os.environ.get("AI_VISUAL_REPORT_DIR", str(TEST_ROOT / "reports" / RUN_ID))
).expanduser().resolve()
BASELINE_ROOT = Path(
    os.environ.get("AI_VISUAL_BASELINE_DIR", str(TEST_ROOT / "baselines"))
).expanduser().resolve()
for folder in (ARTIFACT_ROOT, REPORT_ROOT, BASELINE_ROOT):
    folder.mkdir(parents=True, exist_ok=True)


def safe_name(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", value).strip("_.") or "test"


def _locator_for_action(page, action: dict):
    if action.get("role"):
        return page.get_by_role(
            action["role"],
            name=action.get("name"),
            exact=bool(action.get("exact", False)),
        )
    selector = action.get("selector")
    if not selector:
        raise ValueError("操作需要 selector，或同时提供 role/name")
    return page.locator(selector)


def apply_startup_actions(page, config: dict, events: dict) -> None:
    """Navigate the app to the configured state without hiding setup failures."""
    completed = []
    try:
        for action in config.get("startup_actions", []):
            action_type = action.get("type", "click")
            label = action.get("name") or action.get("selector") or action.get("name") or action_type
            timeout = int(action.get("timeout_ms", 5000))
            locator = _locator_for_action(page, action)

            if action_type == "click":
                if locator.count() < 1:
                    raise AssertionError(f"启动操作目标不存在：{label}")
                locator.first.wait_for(state="visible", timeout=timeout)
                locator.first.click(timeout=timeout)
            elif action_type == "fill":
                if locator.count() < 1:
                    raise AssertionError(f"启动操作目标不存在：{label}")
                locator.first.wait_for(state="visible", timeout=timeout)
                locator.first.fill(str(action.get("value", "")), timeout=timeout)
            elif action_type == "wait_for":
                if locator.count() < 1:
                    raise AssertionError(f"等待目标不存在：{label}")
                locator.first.wait_for(state=action.get("state", "visible"), timeout=timeout)
            else:
                raise ValueError(f"不支持的 startup action type：{action_type}")
            completed.append({"name": label, "type": action_type, "status": "PASS"})

        ready_selector = config.get("ready_selector")
        if ready_selector:
            page.locator(ready_selector).first.wait_for(
                state="visible",
                timeout=int(config.get("ready_timeout_ms", 10000)),
            )
            completed.append({"name": f"ready:{ready_selector}", "type": "wait_for", "status": "PASS"})
        events["startup_actions"] = completed
    except Exception as exc:
        events["startup_actions"] = completed
        events["setup_error"] = str(exc)


@pytest.fixture(scope="session")
def visual_config():
    return CONFIG


@pytest.fixture(scope="session")
def browser():
    with sync_playwright() as playwright:
        executable = (
            os.environ.get("AI_VISUAL_CHROMIUM_EXECUTABLE")
            or shutil.which("chromium")
            or shutil.which("chromium-browser")
            or shutil.which("google-chrome")
        )
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
    events = {
        "test": request.node.name,
        "base_url": visual_config.get("base_url"),
        "config_path": visual_config.get("_config_path"),
        "started_at_utc": datetime.now(timezone.utc).isoformat(),
        "console_errors": [],
        "page_errors": [],
        "failed_requests": [],
        "http_errors": [],
        "blocked_external_requests": [],
        "navigation": None,
    }
    def capture_console_message(message):
        if message.type != "error":
            return
        # External requests are deliberately aborted for deterministic offline UI screenshots.
        # Ignore only the browser's explicit blocked-by-client notice; retain all other console errors.
        if visual_config.get("block_external_requests", False) and "ERR_BLOCKED_BY_CLIENT" in message.text:
            return
        events["console_errors"].append({"type": message.type, "text": message.text})

    current_page.on("console", capture_console_message)
    current_page.on("pageerror", lambda exc: events["page_errors"].append(str(exc)))
    current_page.on(
        "requestfailed",
        lambda req: events["failed_requests"].append(
            {"url": req.url, "method": req.method, "failure": req.failure}
        ),
    )
    current_page.on(
        "response",
        lambda resp: events["http_errors"].append({"url": resp.url, "status": resp.status})
        if resp.status >= 400 else None,
    )

    if visual_config.get("block_external_requests", False):
        base = urlparse(visual_config.get("base_url", ""))
        allowed_origins = {(base.scheme, base.netloc)}
        for item in visual_config.get("allow_external_origins", []):
            parsed = urlparse(item if "://" in item else f"https://{item}")
            allowed_origins.add((parsed.scheme, parsed.netloc))

        def route_external(route):
            parsed = urlparse(route.request.url)
            if parsed.scheme in {"http", "https"} and parsed.netloc and (parsed.scheme, parsed.netloc) not in allowed_origins:
                events["blocked_external_requests"].append(route.request.url)
                route.abort("blockedbyclient")
            else:
                route.continue_()

        current_page.route("**/*", route_external)

    current_page._ai_visual_events = events
    current_page._ai_visual_artifacts = ARTIFACT_ROOT
    current_page._ai_visual_reports = REPORT_ROOT
    current_page._ai_visual_trace = trace_path
    current_page._ai_visual_config = visual_config
    try:
        response = current_page.goto(
            visual_config.get("base_url", "http://127.0.0.1:4173/"),
            wait_until="domcontentloaded",
            timeout=int(visual_config.get("navigation_timeout_ms", 15000)),
        )
        events["navigation"] = {"url": current_page.url, "status": response.status if response else None}
        apply_startup_actions(current_page, visual_config, events)
    except Exception as exc:
        events["navigation"] = {"url": current_page.url, "error": str(exc)}
        if "ERR_BLOCKED_BY_ADMINISTRATOR" in str(exc):
            # Some managed Chromium environments block every URL through enterprise policy.
            # Do not attempt to override that policy; explicitly mark browser verification as unavailable.
            try:
                context.tracing.stop()
            except Exception:
                pass
            context.close()
            pytest.skip(
                "UNVERIFIED: Chromium managed policy blocks navigation (ERR_BLOCKED_BY_ADMINISTRATOR); "
                "run visual tests in an authorized browser environment."
            )
    yield current_page

    try:
        if not current_page.is_closed() and current_page.url != "about:blank":
            current_page.screenshot(
                path=str(ARTIFACT_ROOT / f"{test_name}-final.png"),
                full_page=True,
                animations="disabled",
                timeout=5000,
            )
    except Exception as exc:
        events.setdefault("teardown_warnings", []).append(f"final screenshot failed: {exc}")

    # Capture DOM geometry to make visual findings actionable in CSS-pixel coordinates.
    inventory = []
    try:
        selector_hints = list(visual_config.get("key_selectors", []))
        selector_hints.extend(visual_config.get("geometry_selectors", []))
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
          document.querySelectorAll(generic).forEach((el, i) => { if (i < 200) add(el, generic, i); });
          return {viewport, elements: result};
        }""", selector_hints)
        inventory_path = REPORT_ROOT / f"elements-{test_name}.json"
        inventory_path.write_text(json.dumps(inventory, ensure_ascii=False, indent=2), encoding="utf-8")
        events["element_inventory_file"] = str(inventory_path)
        events["element_count"] = len(inventory.get("elements", []))
    except Exception as exc:
        events.setdefault("teardown_warnings", []).append(f"element inventory failed: {exc}")

    events["finished_at_utc"] = datetime.now(timezone.utc).isoformat()
    events["artifacts_root"] = str(ARTIFACT_ROOT)
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


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    report = outcome.get_result()
    setattr(item, f"_ai_visual_report_{report.when}", report)


def pytest_sessionfinish(session, exitstatus):
    tests = []
    for item in getattr(session, "items", []):
        candidate_reports = [
            getattr(item, "_ai_visual_report_setup", None),
            getattr(item, "_ai_visual_report_call", None),
            getattr(item, "_ai_visual_report_teardown", None),
        ]
        candidate_reports = [report for report in candidate_reports if report is not None]
        failed_report = next((report for report in candidate_reports if report.failed), None)
        skipped_report = next((report for report in candidate_reports if report.skipped), None)
        report = failed_report or skipped_report or (candidate_reports[-1] if candidate_reports else None)
        detail = str(getattr(report, "longrepr", "")) if report and (report.failed or report.skipped) else None
        if failed_report:
            status = "FAILED"
        elif skipped_report and detail and ("ERR_BLOCKED_BY_ADMINISTRATOR" in detail or "UNVERIFIED:" in detail):
            status = "UNVERIFIED"
        elif skipped_report:
            status = "SKIPPED"
        else:
            status = report.outcome.upper() if report else "UNVERIFIED"
        tests.append({
            "nodeid": item.nodeid,
            "status": status,
            "duration_seconds": round(float(getattr(report, "duration", 0) or 0), 3) if report else None,
            "detail": detail[:3000] if detail else None,
        })
    screenshots = sorted(str(path) for path in ARTIFACT_ROOT.rglob("*.png") if path.is_file())
    traces = sorted(str(path) for path in ARTIFACT_ROOT.rglob("*.trace.zip") if path.is_file())
    summary = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "project_root": str(TEST_ROOT.parents[1]),
        "target_url": CONFIG.get("base_url"),
        "config_path": CONFIG.get("_config_path"),
        "pytest_exit_code": int(exitstatus),
        "ai_visual_review": "PENDING",
        "counts": {name: sum(1 for test in tests if test["status"] == name) for name in ("PASSED", "FAILED", "SKIPPED", "UNVERIFIED")},
        "tests": tests,
        "artifact_root": str(ARTIFACT_ROOT),
        "report_root": str(REPORT_ROOT),
        "screenshots": screenshots,
        "traces": traces,
    }
    (REPORT_ROOT / "visual-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# MyBox AI Visual Review",
        "",
        "**AI visual review status: PENDING** — the test runner cannot decide whether a page is aesthetically correct. An AI/developer must inspect the screenshots below and record a conclusion.",
        "",
        f"- Target: `{CONFIG.get('base_url')}`",
        f"- Config: `{CONFIG.get('_config_path', 'auto/default')}`",
        f"- Playwright exit code: `{exitstatus}`",
        f"- Counts: `{summary['counts']}`",
        f"- Artifacts: `{ARTIFACT_ROOT}`",
        f"- Geometry/error reports: `{REPORT_ROOT}`",
        "",
        "## Screenshots captured",
    ]
    lines.extend([f"- `{path}`" for path in screenshots] or ["- No screenshots were captured."])
    lines.extend(["", "## Required visual review", "- [ ] Inspect actual application screenshots, not only the Demo screenshots.", "- [ ] Check spacing, alignment, theme consistency, text truncation, overlays, clipping and mobile touch targets.", "- [ ] Review element geometry JSON and browser/HTTP error JSON for relevant defects.", "- [ ] If code was changed, rerun the browser test and inspect the new screenshots.", "- [ ] Keep this review `PENDING` until the screenshots have actually been inspected.", "", "## Reviewer conclusion", "PENDING — record observed issues, files changed and final PASS/FAIL/UNVERIFIED status here.", ""])
    (REPORT_ROOT / "AI_REVIEW.md").write_text("\n".join(lines), encoding="utf-8")
