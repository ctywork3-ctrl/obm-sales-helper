"""Render every new screen in a real browser and report runtime errors.

Typecheck and `vite build` catch a lot, but they cannot catch a React runtime
error: a bad hook order, a null dereference in a render path, an icon that does
not exist. Those only show up when the page actually renders.

This logs in, walks the pages built for the warehouse work, records every
console error and uncaught exception, and writes a screenshot of each so the
result is reviewable rather than asserted.

    python smoke_frontend.py
"""

import asyncio
import os
import sys
from datetime import datetime, timezone

import httpx
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:3000"
API = "http://127.0.0.1:8001"
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "smoke-screenshots")
USERNAME = "developer"
PASSWORD = "password123"

# Pages built or changed in the warehouse work. `None` means "find an id from
# the API first" and is filled in by the caller.
PAGES = [
    ("receiving-tasks", "/app/warehouse/tasks"),
    ("labels", "/app/warehouse/labels"),
    ("stock-takes", "/app/warehouse/stock-takes"),
    ("transfers", "/app/warehouse/transfers"),
    ("discrepancies", "/app/purchase-orders/discrepancies"),
    ("suppliers", "/app/purchase-orders/suppliers"),
    ("import_po", "/app/purchase-orders/import"),
    ("warranty", "/app/warehouse/warranty"),
    ("stock-overview", "/app/warehouse/stock"),
    ("settings", "/app/admin/settings"),
]

# Console noise that is not a defect.
IGNORE_PATTERNS = (
    "Download the React DevTools",
    "favicon",
    "[vite]",
    "Failed to load resource: the server responded with a status of 404",
)


def ensure_open_fixtures() -> dict:
    """Make sure one OPEN receiving task, stock take and transfer exist.

    Opening the *first* row of a list is not enough: the first row is often a
    cancelled one from an earlier test run, so the interactive part of the screen
    never renders and the check passes on an empty page. Creating the fixtures
    means the scanning UI is what actually gets verified.
    """
    client = httpx.Client(base_url=API, timeout=30)
    client.get("/health")
    token = client.cookies.get("csrf_token")
    headers = {"x-csrf-token": token}
    client.post(
        "/api/auth/login",
        json={"username": USERNAME, "password": PASSWORD},
        headers=headers,
    )

    found: dict[str, int] = {}
    created_here: dict[str, int] = {}

    def is_open(status: str) -> bool:
        return status not in ("COMPLETED", "CANCELLED")

    for task in client.get("/api/warehouse/receiving-tasks").json():
        if is_open(task["status"]) and task["total_expected"] > 0:
            found["receiving_task"] = task["id"]
            break

    for session in client.get("/api/warehouse/stock-takes").json():
        if session["status"] == "IN_PROGRESS":
            found["stock_take"] = session["id"]
            break

    for transfer in client.get("/api/warehouse/transfers").json():
        if is_open(transfer["status"]):
            found["transfer"] = transfer["id"]
            break

    products = client.get("/api/products", params={"page_size": 100}).json().get("items", [])
    locations = client.get("/api/warehouse/locations").json()

    # A receiving task, from a fresh PO.
    if "receiving_task" not in found:
        product = next(
            (p for p in products
             if p.get("is_active")
             and (p.get("inventory_model") or "BULK").upper() == "SERIALIZED"),
            None,
        ) or next((p for p in products if p.get("is_active")), None)
        if product:
            po = client.post(
                "/api/purchase-orders",
                json={
                    "supplier_name": "Smoke Test Supplier",
                    "lines": [{"product_id": product["id"], "quantity_ordered": 2}],
                },
                headers=headers,
            ).json()
            client.post(f"/api/purchase-orders/{po['id']}/send", headers=headers)
            created = client.post(
                f"/api/purchase-orders/{po['id']}/receiving-tasks",
                json={"mode": "WHOLE", "priority": "NORMAL"},
                headers=headers,
            )
            if created.status_code == 201:
                found["receiving_task"] = created.json()["tasks"][0]["id"]
                created_here["receiving_task"] = found["receiving_task"]

    # Scan a couple of units into it, so the label screen has real serials to
    # render. Without this the label check silently skips and proves nothing.
    task_id = found.get("receiving_task")
    if task_id:
        detail = client.get(f"/api/warehouse/receiving-tasks/{task_id}").json()
        scanned = sum(len(line.get("units", [])) for line in detail.get("lines", []))
        if scanned == 0:
            serialized_line = next(
                (l for l in detail.get("lines", [])
                 if l.get("tracking_mode") == "SERIALIZED" and l.get("quantity_expected", 0) > 0),
                None,
            )
            if serialized_line:
                # Unique per run, so a repeat run does not collide with serials
                # this script already registered.
                stamp = datetime.now(timezone.utc).strftime("%H%M%S")
                for index in range(2):
                    response = client.post(
                        f"/api/warehouse/receiving-tasks/{task_id}/scan",
                        json={
                            "task_line_id": serialized_line["id"],
                            "code": f"SMOKE-{stamp}-{index + 1}",
                        },
                        headers=headers,
                    )
                    if response.status_code != 200:
                        print(f"     ! scan failed: {response.text[:120]}")
                print(f"     scanned 2 units into receiving task {task_id} for label rendering")

    # A stock take on a serialized product, so the scan input renders.
    if "stock_take" not in found:
        for product in products:
            if (product.get("inventory_model") or "BULK").upper() != "SERIALIZED":
                continue
            started = client.post(
                "/api/warehouse/stock-takes",
                json={"scope": "PRODUCT", "product_id": product["id"]},
                headers=headers,
            )
            if started.status_code == 201:
                found["stock_take"] = started.json()["id"]
                created_here["stock_take"] = found["stock_take"]
                break

    # A transfer with units available at the source.
    if "transfer" not in found and len(locations) >= 2:
        for location in locations:
            options = client.get(
                "/api/warehouse/transfers/transferable",
                params={"from_location_id": location["id"]},
            ).json()
            if not options:
                continue
            destination = next(
                (l for l in locations if l["id"] != location["id"]), None
            )
            if not destination:
                continue
            created = client.post(
                "/api/warehouse/transfers",
                json={
                    "from_location_id": location["id"],
                    "to_location_id": destination["id"],
                    "notes": "Smoke test",
                    "lines": [{"product_id": options[0]["product_id"], "quantity": 1}],
                },
                headers=headers,
            )
            if created.status_code == 201:
                found["transfer"] = created.json()["id"]
                created_here["transfer"] = found["transfer"]
                break

    client.close()
    # Reused records are left alone; only this run's own clutter is removed.
    return {**found, "_created": created_here}


def is_noise(text: str) -> bool:
    return any(pattern.lower() in text.lower() for pattern in IGNORE_PATTERNS)


async def login(page) -> bool:
    # The staff login lives under /app/login; bare /login redirects to the store.
    await page.goto(f"{BASE}/app/login", wait_until="domcontentloaded")
    await page.wait_for_timeout(1500)
    if "/login" not in page.url and "/app" in page.url:
        return True

    try:
        await page.fill("#username", USERNAME)
        await page.fill("#password", PASSWORD)
        await page.click('button[type="submit"]')
        await page.wait_for_timeout(3000)
    except Exception as exc:
        print(f"  ! could not submit the login form: {exc}")
        try:
            print(f"    landed on: {page.url}")
            body = await page.inner_text("body")
            print(f"    page text: {' | '.join(body.strip().splitlines()[:4])[:200]}")
        except Exception:
            pass
        return False

    return "/login" not in page.url


async def visit(page, label: str, path: str, problems: list, expect: str | None = None) -> None:
    errors: list[str] = []

    def on_console(message):
        if message.type == "error" and not is_noise(message.text):
            errors.append(f"console: {message.text[:300]}")

    def on_pageerror(error):
        errors.append(f"uncaught: {str(error)[:300]}")

    page.on("console", on_console)
    page.on("pageerror", on_pageerror)

    try:
        response = await page.goto(f"{BASE}{path}", wait_until="domcontentloaded")
        await page.wait_for_timeout(2200)

        status = response.status if response else 0
        body = await page.inner_text("body")
        # A React crash usually leaves the error boundary or an almost empty root.
        root_len = await page.evaluate(
            "() => (document.getElementById('root')?.innerText || '').length"
        )
        title = await page.title()

        shot = os.path.join(OUT_DIR, f"{label}.png")
        await page.screenshot(path=shot, full_page=False)

        verdict = "ok"
        if errors:
            verdict = "ERRORS"
        elif status >= 400:
            verdict = f"HTTP {status}"
        elif root_len < 60:
            verdict = f"BLANK (root text {root_len} chars)"
        elif expect and expect.lower() not in body.lower():
            # "No errors" is not the same as "the thing is on the page" — an
            # empty shell renders without errors too.
            verdict = f"MISSING '{expect}'"

        marker = "PASS" if verdict == "ok" else "FAIL"
        print(f"  {marker}  {label:22s} {path}  [{verdict}]")

        if verdict != "ok":
            problems.append((label, path, verdict, list(errors)))
            snippet = " | ".join(body.strip().splitlines()[:3])[:200]
            print(f"         page text: {snippet}")

    except Exception as exc:
        print(f"  FAIL  {label:20s} {path}  [navigation failed: {exc}]")
        problems.append((label, path, f"navigation failed: {exc}", list(errors)))
    finally:
        page.remove_listener("console", on_console)
        page.remove_listener("pageerror", on_pageerror)


def cleanup_fixtures(fixtures: dict) -> None:
    """Cancel the records this run created.

    Reusing an existing open record is fine; leaving behind a new PO, task,
    stock take and transfer on every run is not — it would slowly turn the dev
    database into a graveyard of test data.
    """
    created = fixtures.get("_created") or {}
    if not created:
        return

    client = httpx.Client(base_url=API, timeout=30)
    client.get("/health")
    token = client.cookies.get("csrf_token")
    headers = {"x-csrf-token": token}
    client.post(
        "/api/auth/login",
        json={"username": USERNAME, "password": PASSWORD},
        headers=headers,
    )

    print("\n[5] Cleaning up records this run created ...")
    if task_id := created.get("receiving_task"):
        response = client.post(f"/api/warehouse/receiving-tasks/{task_id}/cancel", headers=headers)
        print(f"  {'ok' if response.status_code == 200 else 'note'}  cancelled receiving task {task_id}")
    if session_id := created.get("stock_take"):
        response = client.post(f"/api/warehouse/stock-takes/{session_id}/cancel", headers=headers)
        print(f"  {'ok' if response.status_code == 200 else 'note'}  cancelled stock take {session_id}")
    if transfer_id := created.get("transfer"):
        response = client.post(f"/api/warehouse/transfers/{transfer_id}/cancel", headers=headers)
        print(f"  {'ok' if response.status_code == 200 else 'note'}  cancelled transfer {transfer_id}")

    client.close()


async def decode_label_qr(page, expected_serial: str, problems: list) -> None:
    """Screenshot the first label and actually decode its QR code.

    A label can look perfectly laid out and still be unscannable — a QR that
    overflows its box, or is rendered too small, or has no quiet zone. Rendering
    it and decoding it is the only honest check.
    """
    try:
        import cv2
        import numpy as np
    except ImportError:
        print("     NOTE  opencv not available, skipping the QR decode check")
        return

    # Find the first preview label. The preview grid wraps each label in a
    # bordered box; the printable payload is hidden, so target the visible one.
    element = await page.query_selector("div.border.border-gray-300.bg-white")
    if element is None:
        print("     FAIL  could not find a rendered label to decode")
        problems.append(("label-qr", "decode", "no label element found", []))
        return

    shot = os.path.join(OUT_DIR, "label-closeup.png")
    await element.screenshot(path=shot)

    image = cv2.imread(shot)
    if image is None:
        problems.append(("label-qr", "decode", "could not read the screenshot", []))
        return

    # Upscale: the label is only ~50mm on screen, and a decoder wants pixels.
    image = cv2.resize(image, None, fx=4, fy=4, interpolation=cv2.INTER_NEAREST)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    detector = cv2.QRCodeDetector()
    decoded, _, _ = detector.detectAndDecode(gray)

    if not decoded:
        print("     FAIL  the rendered QR did not decode")
        problems.append(("label-qr", "decode", "QR unreadable", []))
        return

    if decoded != expected_serial:
        print(f"     FAIL  QR decodes to {decoded!r}, expected {expected_serial!r}")
        problems.append(
            ("label-qr", "decode", f"decoded {decoded!r} != {expected_serial!r}", [])
        )
        return

    print(f"     PASS  scanned the label: QR decodes to {decoded!r}")

    # A URL in the QR would mean the serial got wrapped somewhere.
    if decoded.lower().startswith("http"):
        problems.append(("label-qr", "content", "QR contains a URL, not a serial", []))


async def main() -> int:
    os.makedirs(OUT_DIR, exist_ok=True)
    problems: list = []

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1440, "height": 950})
        page = await context.new_page()

        print("=" * 70)
        print(" Frontend smoke check")
        print("=" * 70)

        # Seed BEFORE the browser logs in. Logging in revokes every other session
        # for that user (single-session enforcement), so seeding afterwards would
        # silently sign the browser out and every page would 401.
        print("\n[0] Ensuring open records exist ...")
        fixtures = ensure_open_fixtures()
        for name, value in fixtures.items():
            if name.startswith("_"):
                continue
            origin = "created" if name in (fixtures.get("_created") or {}) else "reused"
            print(f"     {name}: {value} ({origin})")
        if not any(not k.startswith("_") for k in fixtures):
            print("     ! could not find or create any open record")

        print("\n[1] Logging in ...")
        if not await login(page):
            print("  FAIL  could not log in — is the backend running on :8001?")
            await browser.close()
            return 1
        print(f"  PASS  logged in, now at {page.url}")

        print("\n[2] Walking the pages ...")
        for label, path in PAGES:
            await visit(page, label, path, problems)

        print("\n[3] Walking detail pages (open records, so the working UI renders) ...")
        detail_targets = [
            # `expect` proves the interactive part actually rendered, not just
            # that the route resolved without throwing.
            ("receiving-task-detail", fixtures.get("receiving_task"),
             "/app/warehouse/tasks/{}", "Items"),
            ("stock-take-detail", fixtures.get("stock_take"),
             "/app/warehouse/stock-takes/{}", "Lines"),
            ("transfer-detail", fixtures.get("transfer"),
             "/app/warehouse/transfers/{}", "Products"),
        ]
        for label, entity_id, route, expect in detail_targets:
            if entity_id is None:
                print(f"  SKIP  {label:22s} (no open record available)")
                continue
            await visit(page, label, route.format(entity_id), problems, expect=expect)

        # The PO detail page: any PO will do, this one is not state-dependent.
        async def first_id(api_path: str):
            try:
                data = await page.evaluate(
                    """async (path) => {
                        const r = await fetch(path, { credentials: 'include' });
                        if (!r.ok) return null;
                        return await r.json();
                    }""",
                    api_path,
                )
                if isinstance(data, list) and data:
                    return data[0].get("id")
                return None
            except Exception:
                return None

        po_id = await first_id("/api/purchase-orders")
        if po_id is not None:
            await visit(page, "purchase-order-detail", f"/app/purchase-orders/{po_id}", problems)
        else:
            print("  SKIP  purchase-order-detail (no purchase orders)")

        # The label itself. This is the one screen where the output is a physical
        # object, so it is worth proving a real sticker renders — QR and all —
        # rather than trusting that the page loads.
        receiving_task_id = fixtures.get("receiving_task")
        if receiving_task_id:
            task = await page.evaluate(
                """async (id) => {
                    const r = await fetch(`/api/warehouse/receiving-tasks/${id}`,
                                          { credentials: 'include' });
                    return r.ok ? await r.json() : null;
                }""",
                receiving_task_id,
            )
            serials = [
                unit
                for line in (task or {}).get("lines", [])
                for unit in line.get("units", [])
            ]
            if serials:
                first_serial = serials[0]["serial_number"]
                await visit(
                    page,
                    "label-with-units",
                    f"/app/warehouse/labels?task={receiving_task_id}",
                    problems,
                    expect=first_serial,
                )
                svg_count = await page.evaluate(
                    "() => document.querySelectorAll('svg').length"
                )
                print(f"     {len(serials)} unit(s), {svg_count} svg element(s) on the page")
                if svg_count < len(serials):
                    problems.append(
                        ("label-with-units", "svg count", f"{svg_count} svg for {len(serials)} labels", [])
                    )

                # Decode the rendered QR. This is the only check that proves a
                # phone can actually scan the sticker: the layout can look right
                # while the code is unreadable.
                await decode_label_qr(page, serials[0]["serial_number"], problems)
            else:
                print("  SKIP  label-with-units (that task has no scanned units)")

        print("\n[4] Checking the installable-app bits ...")
        for asset in ("/manifest.webmanifest", "/sw.js", "/icon-192.png"):
            try:
                response = await page.request.get(f"{BASE}{asset}")
                ok = response.status == 200
                print(f"  {'PASS' if ok else 'FAIL'}  {asset}  [{response.status}]")
                if not ok:
                    problems.append((asset, asset, f"HTTP {response.status}", []))
            except Exception as exc:
                print(f"  FAIL  {asset}  [{exc}]")
                problems.append((asset, asset, str(exc), []))

        sw_registered = await page.evaluate(
            """async () => {
                if (!('serviceWorker' in navigator)) return 'unsupported';
                const regs = await navigator.serviceWorker.getRegistrations();
                return regs.length > 0 ? 'registered' : 'none';
            }"""
        )
        print(f"  {'PASS' if sw_registered == 'registered' else 'NOTE'}  service worker: {sw_registered}")

        await browser.close()

    cleanup_fixtures(fixtures)

    print("\n" + "=" * 70)
    if problems:
        print(f" {len(problems)} problem(s) found")
        for label, path, verdict, errors in problems:
            print(f"\n  {label}  ({path})")
            print(f"    {verdict}")
            for error in errors[:5]:
                print(f"    - {error}")
    else:
        print(" All pages rendered cleanly, no console errors")
    print("=" * 70)
    print(f"\nScreenshots in {os.path.normpath(OUT_DIR)}")

    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
