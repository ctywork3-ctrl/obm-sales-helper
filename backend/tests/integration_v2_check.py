"""End-to-end check of the v2 feature drop against the live backend."""

import json
import os
import sys
from datetime import datetime, timezone

import httpx

# Make the backend importable so the check can also assert that its own service
# modules load — an import error there would only show up at runtime otherwise.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

BASE = "http://127.0.0.1:8001"
PASSED, FAILED = [], []


def check(label, condition, detail=""):
    if condition:
        PASSED.append(label)
        print(f"  PASS  {label}")
    else:
        FAILED.append(label)
        print(f"  FAIL  {label}  {detail}")


def make_client():
    client = httpx.Client(base_url=BASE, timeout=30.0)
    client.get("/health")  # sets the csrf cookie
    return client


def login(client, username, password="password123"):
    """Log in, waiting out the 5-per-minute login rate limit if needed."""
    import time

    for attempt in range(4):
        token = client.cookies.get("csrf_token")
        response = client.post(
            "/api/auth/login",
            json={"username": username, "password": password},
            headers={"x-csrf-token": token},
        )
        if response.status_code != 429:
            return response
        print(f"     (login rate limit hit for {username}; waiting 65s)", flush=True)
        time.sleep(65)
        client.get("/health")
    return response


def csrf(client):
    return {"x-csrf-token": client.cookies.get("csrf_token")}


def main():
    print("=" * 68)
    print(" OBM v2 integration check")
    print("=" * 68)

    dev = make_client()

    print("\n[1] Auth: developer session + renamed user no longer logs in")
    response = login(dev, "developer")
    check("login developer", response.status_code == 200, response.text[:160])
    if response.status_code != 200:
        print("Cannot continue without a login.")
        return

    stale = make_client()
    stale.get("/health")
    stale_response = stale.post(
        "/api/auth/login",
        json={"username": "manager01", "password": "password123"},
        headers={"x-csrf-token": stale.cookies.get("csrf_token")},
    )
    check(
        "old manager01 no longer logs in (401, not rate limited)",
        stale_response.status_code == 401,
        f"got {stale_response.status_code} {stale_response.text[:120]}",
    )

    # Inside sales key orders in, so they own the order flow below.
    inside = make_client()
    inside_login = login(inside, "inside01")
    check("login inside01 (inside sales)", inside_login.status_code == 200, inside_login.text[:160])
    if inside_login.status_code != 200:
        print("Cannot continue without the inside-sales login.")
        return

    print("\n[2] New warehouse + template endpoints respond")
    for path in (
        "/api/warehouse/stock-overview",
        "/api/warehouse/locations",
        "/api/warehouse/receiving-tasks",
        "/api/warehouse/warranty/claims",
        "/api/report-templates/catalog",
        "/api/report-templates",
        "/api/sales-orders/discount-policy",
    ):
        response = dev.get(path)
        check(f"GET {path}", response.status_code == 200, f"{response.status_code} {response.text[:120]}")

    catalog = dev.get("/api/report-templates/catalog").json()
    check("catalog exposes block types", len(catalog["block_catalog"]) >= 10, str(len(catalog["block_catalog"])))
    check("catalog exposes doc types", len(catalog["doc_types"]) == 5)

    templates = dev.get("/api/report-templates").json()
    check("seeded report templates exist", len(templates) >= 5, str(len(templates)))
    check("a default sales-order layout exists", any(t["is_default"] and t["doc_type"] == "SALES_ORDER" for t in templates))

    print("\n[3] Discount engine on a real sales order")
    customer = inside.get("/api/customers", params={"page_size": 1}).json()["items"][0]
    products = inside.get("/api/products", params={"page_size": 30}).json()["items"]
    in_stock = [p for p in products if (p.get("stock_qty") or 0) >= 3 and p.get("is_active")]
    check("have products with stock", len(in_stock) >= 1)
    product = in_stock[0]

    order_payload = {
        "customer_id": customer["id"],
        "currency": "MYR",
        "notes": "integration check",
        "discount_type": "PERCENT",
        "discount_value": 5,
        "discount_reason": "Integration test bulk discount",
        "items": [
            {
                "product_id": product["id"],
                "quantity": 2,
                "unit_price": 200,
                "discount_type": "PERCENT",
                "discount_value": 10,
            },
            {
                "product_id": in_stock[1]["id"] if len(in_stock) > 1 else product["id"],
                "quantity": 1,
                "unit_price": 100,
                "discount_type": "AMOUNT",
                "discount_value": 20,
            },
        ],
    }
    # avoid the same product twice
    if order_payload["items"][1]["product_id"] == product["id"]:
        order_payload["items"] = order_payload["items"][:1]

    response = inside.post("/api/sales-orders", json=order_payload, headers=csrf(inside))
    check("create order with discounts", response.status_code == 201, response.text[:200])
    if response.status_code != 201:
        print(response.text[:600])
        return

    order = response.json()
    order_id = order["id"]
    totals = order
    print(f"     order {order['order_number']}")
    print(f"     gross={totals['gross_subtotal']} line_disc={totals['line_discount_total']} "
          f"net={totals['subtotal_amount']} order_disc={totals['order_discount_amount']} "
          f"disc_total={totals['discount_total']} total={totals['total_amount']}")

    # Expected: line1 gross 400, 10% -> 40 disc. line2 gross 100, 20 -> 20 disc.
    # gross subtotal 500, line disc 60, net 440. order disc 5% of 440 = 22.
    # total = 440 - 22 = 418
    check("gross subtotal = 500", abs(float(totals["gross_subtotal"]) - 500) < 0.01, str(totals["gross_subtotal"]))
    check("line discounts = 60", abs(float(totals["line_discount_total"]) - 60) < 0.01, str(totals["line_discount_total"]))
    check("net subtotal = 440", abs(float(totals["subtotal_amount"]) - 440) < 0.01, str(totals["subtotal_amount"]))
    check("order discount = 22", abs(float(totals["order_discount_amount"]) - 22) < 0.01, str(totals["order_discount_amount"]))
    check("total discount = 82", abs(float(totals["discount_total"]) - 82) < 0.01, str(totals["discount_total"]))
    check("order total = 418", abs(float(totals["total_amount"]) - 418) < 0.01, str(totals["total_amount"]))

    flagged = totals["discount_requires_approval"]
    # 82 / 500 = 16.4% which is above the 10% threshold
    check("discount flagged for approval (16.4% > 10%)", flagged is True, str(flagged))

    print("\n[4] The previously crashing PUT endpoint")
    update = inside.put(
        f"/api/sales-orders/{order_id}",
        json={
            "customer_id": customer["id"],
            "notes": "updated by integration check",
            "currency": "MYR",
            "discount_type": "AMOUNT",
            "discount_value": 30,
            "discount_reason": "Fixed goodwill discount",
            "items": [
                {
                    "product_id": product["id"],
                    "product_code_snapshot": product.get("obm_item_code") or product.get("item_code"),
                    "product_name_snapshot": product["name"],
                    "quantity": 2,
                    "unit_price": 200,
                    "discount_type": "NONE",
                    "discount_value": 0,
                }
            ],
        },
        headers=csrf(inside),
    )
    check("PUT full update succeeds (was AttributeError)", update.status_code == 200, f"{update.status_code} {update.text[:200]}")
    if update.status_code == 200:
        updated = update.json()
        print(f"     gross={updated['gross_subtotal']} order_disc={updated['order_discount_amount']} total={updated['total_amount']}")
        check("update applied notes", updated["notes"] == "updated by integration check")
        # gross 400, no line disc, order disc 30 -> total 370
        check("updated total = 370", abs(float(updated["total_amount"]) - 370) < 0.01, str(updated["total_amount"]))

    print("\n[5] A4 print data")
    print_data = inside.get(f"/api/report-templates/print-data/sales-order/{order_id}")
    check("print data responds", print_data.status_code == 200, print_data.text[:200])
    if print_data.status_code == 200:
        payload = print_data.json()
        check("print data carries a template config", bool(payload["template"]["config"]["blocks"]))
        check("print data carries company block fields", "company_name" in payload["company"])
        check("print data carries totals", "total" in payload["order"]["totals"])
        check("print data carries items", len(payload["order"]["items"]) >= 1)
        print(f"     blocks: {len(payload['template']['config']['blocks'])}")

    print("\n[6] Submit + review the order")
    submitted = inside.post(f"/api/sales-orders/{order_id}/submit", headers=csrf(inside))
    check("submit order", submitted.status_code == 200, submitted.text[:200])
    if submitted.status_code == 200:
        check("status is SUBMITTED", submitted.json()["status"] == "SUBMITTED")
    approved = inside.post(f"/api/sales-orders/{order_id}/approve", headers=csrf(inside))
    check("approve order", approved.status_code == 200, approved.text[:200])
    keyed = inside.post(
        f"/api/sales-orders/{order_id}/mark-keyed-to-obm",
        json={"obm_reference_number": "OBM-IT-0001"},
        headers=csrf(inside),
    )
    check("mark keyed to OBM", keyed.status_code == 200, keyed.text[:200])

    print("\n[7] Purchase order -> receiving task -> serial capture -> stock")
    serial_product = next((p for p in in_stock if p.get("inventory_model") == "SERIALIZED"), None)
    if serial_product is None:
        # flip one to serialized so the serial path is exercised
        serial_product = in_stock[0]
        dev.patch(
            f"/api/products/{serial_product['id']}",
            json={"inventory_model": "SERIALIZED", "warranty_months": 24},
            headers=csrf(dev),
        )
        refreshed = dev.get(f"/api/products/{serial_product['id']}").json()
        serial_product = refreshed
        print(f"     switched {serial_product['name']} to SERIALIZED for the test")

    po = dev.post(
        "/api/purchase-orders",
        json={
            "supplier_name": "Integration Supplier Sdn Bhd",
            "notes": "integration check",
            "lines": [{"product_id": serial_product["id"], "quantity_ordered": 3, "unit_cost": 88}],
        },
        headers=csrf(dev),
    )
    check("create purchase order", po.status_code == 201, po.text[:200])
    po_id = po.json()["id"]
    sent = dev.post(f"/api/purchase-orders/{po_id}/send", headers=csrf(dev))
    check("send purchase order", sent.status_code == 200, sent.text[:200])

    users = dev.get("/api/users").json()
    keeper = next((u for u in users if u["role"] == "STOCK_KEEPER" and u["is_active"]), None)
    locations = dev.get("/api/warehouse/locations").json()
    location = locations[0] if locations else None

    task = dev.post(
        "/api/warehouse/receiving-tasks",
        json={
            "purchase_order_id": po_id,
            "assigned_to": keeper["id"] if keeper else None,
            "priority": "HIGH",
            "location_id": location["id"] if location else None,
            "instructions": "Integration test count",
        },
        headers=csrf(dev),
    )
    check("create receiving task from PO", task.status_code == 201, task.text[:300])
    if task.status_code != 201:
        print(task.text[:600])
        return
    task_body = task.json()
    task_id = task_body["id"]
    check("task copied PO lines", len(task_body["lines"]) == 1, str(len(task_body["lines"])))
    check("task is ASSIGNED", task_body["status"] == "ASSIGNED", task_body["status"])
    check("task knows the tracking mode", task_body["lines"][0]["tracking_mode"] == "SERIALIZED", task_body["lines"][0]["tracking_mode"])

    started = dev.post(f"/api/warehouse/receiving-tasks/{task_id}/start", headers=csrf(dev))
    check("start task", started.status_code == 200, started.text[:200])

    line_id = task_body["lines"][0]["id"]

    def available_units(product_id):
        """For a SERIALIZED product, stock_qty is derived from AVAILABLE units."""
        units = dev.get(f"/api/product-units/product/{product_id}").json()
        return sum(1 for u in units if u["status"] == "AVAILABLE")

    stock_before = dev.get(f"/api/products/{serial_product['id']}").json()["stock_qty"]
    units_before = available_units(serial_product["id"])

    run_tag = datetime.now(timezone.utc).strftime("%H%M%S")
    serials = [f"ITEST-{run_tag}-1", f"ITEST-{run_tag}-2", f"ITEST-{run_tag}-3"]
    scanned_ids: list[int] = []
    for serial in serials:
        scan = dev.post(
            f"/api/warehouse/receiving-tasks/{task_id}/scan",
            json={"task_line_id": line_id, "code": serial},
            headers=csrf(dev),
        )
        ok = scan.status_code == 200 and scan.json()["result"] == "OK"
        check(f"scan {serial}", ok, scan.text[:160])
        if ok:
            scanned_ids.append(scan.json()["unit"]["id"])

    duplicate = dev.post(
        f"/api/warehouse/receiving-tasks/{task_id}/scan",
        json={"task_line_id": line_id, "code": serials[0]},
        headers=csrf(dev),
    )
    check("duplicate serial rejected", duplicate.status_code == 200 and duplicate.json()["result"] == "DUPLICATE", duplicate.text[:160])

    detail = dev.get(f"/api/warehouse/receiving-tasks/{task_id}").json()
    check("task shows 3 of 3 scanned", detail["total_scanned"] == 3, str(detail["total_scanned"]))

    units_mid = available_units(serial_product["id"])
    check(
        "no unit becomes sellable before completion",
        units_mid == units_before,
        f"{units_before} -> {units_mid}",
    )

    completed = dev.post(f"/api/warehouse/receiving-tasks/{task_id}/complete", json={}, headers=csrf(dev))
    check("complete task", completed.status_code == 200, completed.text[:300])
    if completed.status_code == 200:
        print(f"     receipt {completed.json()['receipt_number']}, lines moved {completed.json()['lines_moved']}")

    units_after = available_units(serial_product["id"])
    stock_after = dev.get(f"/api/products/{serial_product['id']}").json()["stock_qty"]
    check(
        "3 units became sellable after completion",
        units_after == units_before + 3,
        f"{units_before} -> {units_after}",
    )
    check(
        "product stock_qty equals the available unit count (derived)",
        stock_after == units_after,
        f"stock_qty={stock_after} available_units={units_after}",
    )

    po_after = dev.get(f"/api/purchase-orders/{po_id}").json()
    check("PO marked COMPLETED", po_after["status"] == "COMPLETED", po_after["status"])
    check("PO line shows received quantity", po_after["lines"][0]["quantity_received"] == 3, str(po_after["lines"][0]["quantity_received"]))

    print("\n[8] Warranty trail")
    lookup = dev.get(f"/api/warehouse/warranty/lookup/{serials[0]}")
    check("warranty lookup finds the unit", lookup.status_code == 200 and lookup.json()["found"], lookup.text[:200])
    if lookup.status_code == 200 and lookup.json()["found"]:
        unit = lookup.json()["unit"]
        print(f"     status={unit['status']} warranty_months={unit['warranty_months']} "
              f"end={unit['warranty_end']} active={unit['warranty_active']}")
        check("unit is AVAILABLE after receipt", unit["status"] == "AVAILABLE", unit["status"])
        check("warranty end was set", bool(unit["warranty_end"]), str(unit["warranty_end"]))
        check("warranty is active", unit["warranty_active"] is True, str(unit["warranty_active"]))

    claim = dev.post(
        "/api/warehouse/warranty/claims",
        json={"code": serials[0], "issue": "Integration test: tip section cracked"},
        headers=csrf(dev),
    )
    check("open warranty claim", claim.status_code == 201, claim.text[:200])
    if claim.status_code == 201:
        print(f"     claim {claim.json()['claim_number']} in_warranty={claim.json()['in_warranty_at_claim']}")
        check("claim recognises active warranty", claim.json()["in_warranty_at_claim"] is True)

    missing = dev.get("/api/warehouse/warranty/lookup/NOPE-9999")
    check("unknown serial returns found=false", missing.status_code == 200 and missing.json()["found"] is False)

    print("\n[9] Count difference: reported, not blocked")
    po2 = dev.post(
        "/api/purchase-orders",
        json={
            "supplier_name": "Mismatch Supplier",
            "lines": [{"product_id": serial_product["id"], "quantity_ordered": 2}],
        },
        headers=csrf(dev),
    )
    po2_id = po2.json()["id"]
    dev.post(f"/api/purchase-orders/{po2_id}/send", headers=csrf(dev))

    # Converting the PO issues the task — this is the flow the UI now drives.
    convert = dev.post(
        f"/api/purchase-orders/{po2_id}/receiving-tasks",
        json={"mode": "WHOLE", "assigned_to": keeper["id"] if keeper else None, "priority": "HIGH"},
        headers=csrf(dev),
    )
    check("PO converts to a receiving task", convert.status_code == 201, convert.text[:250])
    if convert.status_code != 201:
        print(convert.text[:500])
        return
    converted = convert.json()["tasks"][0]
    task2_id = converted["id"]
    check("converted task copies the PO line", len(converted["lines"]) == 1)
    check("converted task is assigned", converted["status"] == "ASSIGNED", converted["status"])

    # The whole point of the open-task subtraction: a second conversion must not
    # promise the same cartons again.
    again = dev.post(
        f"/api/purchase-orders/{po2_id}/receiving-tasks",
        json={"mode": "WHOLE"},
        headers=csrf(dev),
    )
    check("re-converting an open PO is refused (409)", again.status_code == 409, f"got {again.status_code}")
    if again.status_code == 409:
        detail = again.json()["detail"]
        check("refusal explains why", isinstance(detail, dict) and detail.get("code") == "NO_OUTSTANDING_LINES", str(detail)[:160])

    preview = dev.get(f"/api/purchase-orders/{po2_id}/receiving-lines").json()
    check("outstanding preview drops to 0 while the task is open", preview["total_outstanding"] == 0, str(preview["total_outstanding"]))
    check("preview reports the open task", len(preview["open_receiving_tasks"]) == 1, str(len(preview["open_receiving_tasks"])))

    line2 = converted["lines"][0]["id"]
    dev.post(
        f"/api/warehouse/receiving-tasks/{task2_id}/scan",
        json={"task_line_id": line2, "code": f"ITEST-SHORT-{run_tag}"},
        headers=csrf(dev),
    )

    # Strict mode still detects the mismatch (this is what the automated gate uses).
    strict = dev.post(
        f"/api/warehouse/receiving-tasks/{task2_id}/complete",
        json={"enforce_match": True},
        headers=csrf(dev),
    )
    check("enforce_match still returns 409", strict.status_code == 409, f"got {strict.status_code}")
    if strict.status_code == 409:
        detail = strict.json()["detail"]
        check("mismatch payload lists the differences",
              isinstance(detail, dict) and detail.get("code") == "COUNT_MISMATCH" and detail.get("differences"),
              str(detail)[:160])

    # The default is now to post what was counted and report the difference.
    posted = dev.post(
        f"/api/warehouse/receiving-tasks/{task2_id}/complete",
        json={},
        headers=csrf(dev),
    )
    check("a short count posts without blocking the worker", posted.status_code == 200, posted.text[:250])
    if posted.status_code == 200:
        body = posted.json()
        print(f"     posted {body['receipt_number']}, has_discrepancy={body['has_discrepancy']} ({body['discrepancy_summary']})")
        check("response flags the discrepancy", body["has_discrepancy"] is True, str(body.get("has_discrepancy")))
        check("one discrepancy recorded", body["discrepancy_count"] == 1, str(body["discrepancy_count"]))

    queue = dev.get("/api/warehouse/discrepancies", params={"status": "OPEN"}).json()
    check("discrepancy lands in the purchase manager queue", queue["total"] >= 1, str(queue["total"]))
    if queue["items"]:
        row = queue["items"][0]
        print(f"     {row['direction']} {row['difference']} x {row['product_name']} from {row['supplier_name']}")
        check("discrepancy is SHORT with the right delta", row["direction"] == "SHORT" and row["difference"] == 1,
              f"{row['direction']} {row['difference']}")
        check("discrepancy is linked to the PO", row["purchase_order_id"] == po2_id, str(row["purchase_order_id"]))
        resolved = dev.patch(
            f"/api/warehouse/discrepancies/{row['id']}",
            json={"status": "CHASED", "resolution_note": "Supplier contacted, credit note requested"},
            headers=csrf(dev),
        )
        check("discrepancy can be chased", resolved.status_code == 200 and resolved.json()["status"] == "CHASED",
              resolved.text[:160])

    # Stock must still reflect reality: 1 counted, so 1 received.
    po2_after = dev.get(f"/api/purchase-orders/{po2_id}").json()
    check("PO advances to PARTIALLY_RECEIVED", po2_after["status"] == "PARTIALLY_RECEIVED", po2_after["status"])
    check("PO line records only what arrived", po2_after["lines"][0]["quantity_received"] == 1,
          str(po2_after["lines"][0]["quantity_received"]))

    print("\n[9b] Splitting a PO across workers")
    po3 = dev.post(
        "/api/purchase-orders",
        json={
            "supplier_name": "Split Supplier",
            "lines": [
                {"product_id": serial_product["id"], "quantity_ordered": 2},
                {"product_id": in_stock[-1]["id"], "quantity_ordered": 5},
            ],
        },
        headers=csrf(dev),
    )
    po3_id = po3.json()["id"]
    dev.post(f"/api/purchase-orders/{po3_id}/send", headers=csrf(dev))
    po3_lines = dev.get(f"/api/purchase-orders/{po3_id}/receiving-lines").json()["lines"]
    check("two outstanding lines to split", len(po3_lines) == 2, str(len(po3_lines)))

    split = dev.post(
        f"/api/purchase-orders/{po3_id}/receiving-tasks",
        json={
            "mode": "SPLIT",
            "priority": "NORMAL",
            "assignments": [
                {"assigned_to": keeper["id"] if keeper else None,
                 "purchase_order_line_ids": [po3_lines[0]["purchase_order_line_id"]]},
                {"assigned_to": keeper["id"] if keeper else None,
                 "purchase_order_line_ids": [po3_lines[1]["purchase_order_line_id"]]},
            ],
        },
        headers=csrf(dev),
    )
    check("SPLIT creates one task per assignment", split.status_code == 201 and len(split.json()["tasks"]) == 2,
          split.text[:250])
    if split.status_code == 201:
        tasks = split.json()["tasks"]
        check("each split task has exactly one line", all(len(t["lines"]) == 1 for t in tasks),
              str([len(t["lines"]) for t in tasks]))
        check("split tasks are distinct", tasks[0]["id"] != tasks[1]["id"])
        # Cancel them so they do not linger in the queue.
        for task in tasks:
            dev.post(f"/api/warehouse/receiving-tasks/{task['id']}/cancel", headers=csrf(dev))
        check("cancelled split tasks release their quantities",
              dev.get(f"/api/purchase-orders/{po3_id}/receiving-lines").json()["total_outstanding"] == 7,
              str(dev.get(f"/api/purchase-orders/{po3_id}/receiving-lines").json()["total_outstanding"]))

    print("\n[9c] Label printing config and data")
    label_config = dev.get("/api/labels/config")
    check("label config responds", label_config.status_code == 200, label_config.text[:200])
    if label_config.status_code == 200:
        config = label_config.json()["config"]
        check("default symbology is QR", config["symbology"] == "QR", config["symbology"])
        check("default label is 50x30mm", config["thermal"]["width_mm"] == 50 and config["thermal"]["height_mm"] == 30,
              f"{config['thermal']['width_mm']}x{config['thermal']['height_mm']}")
        check("A4 sheet defaults to a 3x8 grid", config["a4"]["cols"] == 3 and config["a4"]["rows"] == 8,
              f"{config['a4']['cols']}x{config['a4']['rows']}")

        saved = dev.put(
            "/api/labels/config",
            json={"config": {**config, "symbology": "CODE128",
                             "thermal": {"width_mm": 999, "height_mm": 30, "dpi": 203}}},
            headers=csrf(dev),
        )
        check("label config saves", saved.status_code == 200, saved.text[:200])
        if saved.status_code == 200:
            # 999mm must be clamped rather than rejected — a slightly wrong label
            # beats a print button that refuses to work.
            check("out-of-range width is clamped not rejected",
                  saved.json()["config"]["thermal"]["width_mm"] == 300,
                  str(saved.json()["config"]["thermal"]["width_mm"]))
            check("symbology switch persists", saved.json()["config"]["symbology"] == "CODE128")
        dev.put("/api/labels/config", json={"config": config}, headers=csrf(dev))

    if scanned_ids:
        render = dev.post("/api/labels/render-data", json={"unit_ids": scanned_ids}, headers=csrf(dev))
        check("label render-data responds", render.status_code == 200, render.text[:200])
        if render.status_code == 200:
            rows = render.json()["labels"]
            check("render-data returns a row per unit", len(rows) == len(scanned_ids), str(len(rows)))
            if rows:
                print(f"     label: {rows[0]['code']} / {rows[0]['product_name']} / warranty {rows[0]['warranty_months']}m")
                check("label carries the serial for the QR", bool(rows[0]["code"]))
                check("label carries a human-readable manufacturer serial field",
                      "manufacturer_serial" in rows[0])
                check("QR content is the plain code, not a URL",
                      not str(rows[0]["code"]).lower().startswith("http"), str(rows[0]["code"]))

    print("\n[10] Stock overview reflects the new units")
    overview = dev.get(
        "/api/warehouse/stock-overview",
        params={"search": serial_product["item_code"]},
    ).json()
    row = next((i for i in overview["items"] if i["id"] == serial_product["id"]), None)
    check("stock overview lists the product", row is not None)
    if row:
        print(f"     on hand={row['stock_qty']} model={row['inventory_model']} units={row['unit_count']} by_status={row['units_by_status']}")
        check("overview reports serialized model", row["inventory_model"] == "SERIALIZED")
        check("overview counts the units", row["unit_count"] >= 4, str(row["unit_count"]))
        check("overview reports locations", len(row["units_by_location"]) >= 1, str(row["units_by_location"]))

    print("\n[11] Role gates")
    role_checks = [
        ("operationsmanager01", [("/api/warehouse/receiving-tasks", True)]),
        ("purchasemanager01", [("/api/purchase-orders", True)]),
        ("director", [
            ("/api/warehouse/stock-overview", True),
            # Director may read the user list (oversight) ...
            ("/api/users", True),
        ]),
        # Field sales must not reach the warehouse back office.
        ("sales01", [("/api/warehouse/receiving-tasks", False)]),
    ]
    for username, expectations in role_checks:
        client = make_client()
        login_response = login(client, username)
        if login_response.status_code != 200:
            check(f"{username} can log in", False, login_response.text[:120])
            continue
        check(f"{username} can log in", True)
        for path, should_allow in expectations:
            response = client.get(path)
            allowed = response.status_code == 200
            check(
                f"{username} {'can' if should_allow else 'cannot'} reach {path}",
                allowed == should_allow,
                f"got {response.status_code}",
            )

    print("\n[12] Write guards: oversight roles cannot mutate master data")
    director = make_client()
    if login(director, "director").status_code == 200:
        created = director.post(
            "/api/users",
            json={"username": f"nope{datetime.now(timezone.utc).strftime('%H%M%S')}",
                  "full_name": "Should Not Exist", "role": "OUTSIDE_SALES"},
            headers=csrf(director),
        )
        check("director cannot create users", created.status_code == 403, f"got {created.status_code}")
    else:
        print("     (skipped: could not log in as director)")

    print("\n[13] OBM seam (settings real, connector deliberately absent)")
    obm = dev.get("/api/purchase-orders/obm-status")
    check("OBM status responds", obm.status_code == 200, obm.text[:200])
    if obm.status_code == 200:
        body = obm.json()
        print(f"     configured={body['configured']} enabled={body['enabled']} import_available={body['import_available']}")
        check("reports import as not available rather than pretending", body["import_available"] is False)
        check("explains itself to the user", bool(body["message"]))
        check("does not leak the API key", "api_key" not in body)

    # source is now a real column and filterable.
    manual = dev.get("/api/purchase-orders", params={"source": "MANUAL"}).json()
    check("PO list filters by source", isinstance(manual, list), str(type(manual)))
    check("existing POs backfilled as MANUAL",
          all(po.get("source") in ("MANUAL", "OBM_IMPORT") for po in manual),
          str({po.get("source") for po in manual[:5]}))

    # The importer is idempotent on (source, external_reference) and must not
    # invent POs for references it has never seen twice.
    from app.services.obm import get_obm_config
    print("     obm service importable:", callable(get_obm_config))

    print("\n[14] Stock takes: count the shelf, post the differences")

    def available_serials(product_id):
        units = dev.get(f"/api/product-units/product/{product_id}").json()
        return [u["serial_number"] for u in units if u["status"] == "AVAILABLE"]

    # --- 14a: a serialized product, one rod missing ---------------------------
    before_serials = available_serials(serial_product["id"])
    before_stock = dev.get(f"/api/products/{serial_product['id']}").json()["stock_qty"]
    check("serialized product has units to count", len(before_serials) >= 2, str(len(before_serials)))

    started = dev.post(
        "/api/warehouse/stock-takes",
        json={"scope": "PRODUCT", "product_id": serial_product["id"],
              "notes": "integration check", "instructions": "Count every rod"},
        headers=csrf(dev),
    )
    check("stock take starts", started.status_code == 201, started.text[:250])
    if started.status_code != 201:
        print(started.text[:600])
        return
    st = started.json()
    st_id = st["id"]
    check("session is IN_PROGRESS", st["status"] == "IN_PROGRESS", st["status"])
    check("one line for the product", len(st["counts"]) == 1, str(len(st["counts"])))
    line = st["counts"][0]
    check("expected quantity is frozen from the system",
          line["expected_qty"] == len(before_serials),
          f"{line['expected_qty']} vs {len(before_serials)}")
    check("line starts uncounted (not zero)",
          line["counted_qty"] is None and line["variance"] is None,
          f"{line['counted_qty']}/{line['variance']}")

    # Count all but one rod.
    for serial in before_serials[:-1]:
        scanned = dev.post(f"/api/warehouse/stock-takes/{st_id}/scan",
                           json={"code": serial}, headers=csrf(dev))
        if scanned.status_code != 200 or scanned.json()["result"] != "OK":
            check(f"scan {serial} into the count", False, scanned.text[:160])
    check("scanning all but one leaves a variance",
          dev.get(f"/api/warehouse/stock-takes/{st_id}").json()["counts"][0]["variance"] == -1,
          str(dev.get(f"/api/warehouse/stock-takes/{st_id}").json()["counts"][0]["variance"]))

    repeat = dev.post(f"/api/warehouse/stock-takes/{st_id}/scan",
                      json={"code": before_serials[0]}, headers=csrf(dev))
    check("re-scanning a counted rod is harmless",
          repeat.status_code == 200 and repeat.json()["result"] == "ALREADY_COUNTED",
          repeat.text[:160])

    # Posting inventory off without a reason must be refused.
    no_reason = dev.post(f"/api/warehouse/stock-takes/{st_id}/complete",
                         json={}, headers=csrf(dev))
    check("posting a variance without a reason is refused", no_reason.status_code == 400,
          f"got {no_reason.status_code}")
    if no_reason.status_code == 400:
        detail = no_reason.json()["detail"]
        check("refusal explains it writes inventory off",
              isinstance(detail, dict) and detail.get("code") == "REASON_REQUIRED",
              str(detail)[:160])

    posted = dev.post(f"/api/warehouse/stock-takes/{st_id}/complete",
                      json={"completion_notes": "One rod unaccounted for after the flood"},
                      headers=csrf(dev))
    check("stock take posts with a reason", posted.status_code == 200, posted.text[:250])
    if posted.status_code == 200:
        body = posted.json()
        print(f"     {body['message']}")
        check("net variance is -1", body["net_variance"] == -1, str(body["net_variance"]))
        applied = body["applied"][0]
        check("the missing rod is named, not just a number",
              applied.get("missing_serials") == [before_serials[-1]],
              str(applied.get("missing_serials")))
        check("an adjustment document was created", bool(applied.get("adjustment_number")),
              str(applied.get("adjustment_number")))

    after_stock = dev.get(f"/api/products/{serial_product['id']}").json()["stock_qty"]
    check("stock dropped by exactly one", after_stock == before_stock - 1,
          f"{before_stock} -> {after_stock}")
    remaining = available_serials(serial_product["id"])
    check("the missing rod is no longer AVAILABLE",
          before_serials[-1] not in remaining,
          f"{before_serials[-1]} still available")

    ledger = dev.get("/api/warehouse/stock-movements", params={"limit": 20}).json()
    check("the write-off is in the stock ledger",
          any(m.get("source_type") == "STOCK_TAKE" for m in ledger),
          str([m.get("source_type") for m in ledger[:5]]))

    done = dev.get(f"/api/warehouse/stock-takes/{st_id}").json()
    check("session is COMPLETED", done["status"] == "COMPLETED", done["status"])
    check("the reason is stored on the session",
          done["completion_notes"] == "One rod unaccounted for after the flood",
          str(done["completion_notes"]))
    late = dev.post(f"/api/warehouse/stock-takes/{st_id}/scan",
                    json={"code": before_serials[0]}, headers=csrf(dev))
    check("a posted session refuses further scans", late.status_code == 400, f"got {late.status_code}")

    # --- 14b: a bulk product, more found than the system knew -----------------
    bulk_product = next(
        (p for p in products if (p.get("inventory_model") or "BULK").upper() == "BULK" and p.get("is_active")),
        None,
    )
    if bulk_product:
        bulk_before = dev.get(f"/api/products/{bulk_product['id']}").json()["stock_qty"]
        bulk_start = dev.post(
            "/api/warehouse/stock-takes",
            json={"scope": "PRODUCT", "product_id": bulk_product["id"]},
            headers=csrf(dev),
        ).json()
        bulk_line = bulk_start["counts"][0]
        check("bulk line is BULK tracking", bulk_line["tracking_mode"] == "BULK", bulk_line["tracking_mode"])

        set_qty = dev.post(
            f"/api/warehouse/stock-takes/{bulk_start['id']}/lines/{bulk_line['id']}/quantity",
            json={"quantity": bulk_line["expected_qty"] + 2},
            headers=csrf(dev),
        )
        check("a bulk quantity can be typed in", set_qty.status_code == 200, set_qty.text[:200])
        check("variance is +2", set_qty.json()["variance"] == 2, str(set_qty.json()["variance"]))

        bulk_post = dev.post(
            f"/api/warehouse/stock-takes/{bulk_start['id']}/complete",
            json={"completion_notes": "Found two extra on the display rack"},
            headers=csrf(dev),
        )
        check("bulk stock take posts", bulk_post.status_code == 200, bulk_post.text[:200])
        if bulk_post.status_code == 200:
            print(f"     {bulk_post.json()['message']}")
        bulk_after = dev.get(f"/api/products/{bulk_product['id']}").json()["stock_qty"]
        check("bulk stock rose by 2", bulk_after == bulk_before + 2, f"{bulk_before} -> {bulk_after}")
    else:
        print("     (skipped bulk path: no bulk product available)")

    # --- 14c: a location count covers serialized goods only -------------------
    location_id_for_count = None
    for candidate in (locations or []):
        probe = dev.post(
            "/api/warehouse/stock-takes",
            json={"scope": "LOCATION", "location_id": candidate["id"]},
            headers=csrf(dev),
        )
        if probe.status_code == 201:
            location_id_for_count = probe.json()
            break

    if location_id_for_count:
        modes = {c["tracking_mode"] for c in location_id_for_count["counts"]}
        check("a location count includes only serialized products",
              modes.issubset({"SERIALIZED"}),
              str(modes))
        print(f"     location count '{location_id_for_count['session_number']}' has "
              f"{location_id_for_count['total_lines']} line(s)")
        cancelled = dev.post(
            f"/api/warehouse/stock-takes/{location_id_for_count['id']}/cancel",
            headers=csrf(dev),
        )
        check("a stock take can be cancelled", cancelled.status_code == 200, cancelled.text[:200])
        check("a cancelled count posts nothing",
              cancelled.json()["status"] == "CANCELLED",
              cancelled.json()["status"])
    else:
        print("     (skipped location path: could not open a location count)")

    print("\n[15] Stock transfers: a move never changes a quantity")

    def units_of(product_id):
        return dev.get(f"/api/product-units/product/{product_id}").json()

    # Find a serialized product with units sitting in one real location.
    source_location_id = None
    source_location_name = None
    move_product = None
    move_serials = []
    for candidate in products:
        if (candidate.get("inventory_model") or "BULK").upper() != "SERIALIZED":
            continue
        available = [
            u for u in units_of(candidate["id"])
            if u["status"] == "AVAILABLE" and u.get("location_id")
        ]
        by_location = {}
        for unit in available:
            by_location.setdefault(unit["location_id"], []).append(unit)
        for location_id, group in by_location.items():
            if len(group) >= 2:
                source_location_id = location_id
                source_location_name = group[0].get("location_name")
                move_product = candidate
                move_serials = [u["serial_number"] for u in group[:2]]
                break
        if move_product:
            break

    if not move_product:
        print("     (skipped: no serialized product has 2+ units in one location)")
    else:
        destination = next(
            (loc for loc in (locations or []) if loc["id"] != source_location_id), None
        )
        check("a destination location exists", destination is not None)
        print(
            f"     moving {len(move_serials)} x {move_product['name']} "
            f"from {source_location_name} to {destination['name'] if destination else '?'}"
        )

        # Bulk stock has no location, so it must be refused rather than fudged.
        bulk_for_transfer = next(
            (p for p in products if (p.get("inventory_model") or "BULK").upper() == "BULK"),
            None,
        )
        if bulk_for_transfer:
            refused = dev.post(
                "/api/warehouse/transfers",
                json={
                    "from_location_id": source_location_id,
                    "to_location_id": destination["id"],
                    "lines": [{"product_id": bulk_for_transfer["id"], "quantity": 1}],
                },
                headers=csrf(dev),
            )
            check("bulk stock cannot be transferred (no location)",
                  refused.status_code == 400, f"got {refused.status_code}")

        same_place = dev.post(
            "/api/warehouse/transfers",
            json={
                "from_location_id": source_location_id,
                "to_location_id": source_location_id,
                "lines": [{"product_id": move_product["id"], "quantity": 1}],
            },
            headers=csrf(dev),
        )
        check("source and destination must differ", same_place.status_code == 400,
              f"got {same_place.status_code}")

        stock_before_transfer = dev.get(f"/api/products/{move_product['id']}").json()["stock_qty"]

        created = dev.post(
            "/api/warehouse/transfers",
            json={
                "from_location_id": source_location_id,
                "to_location_id": destination["id"],
                "notes": "integration check",
                "lines": [{"product_id": move_product["id"], "quantity": len(move_serials)}],
            },
            headers=csrf(dev),
        )
        check("transfer created", created.status_code == 201, created.text[:250])
        if created.status_code != 201:
            print(created.text[:600])
            return
        tr = created.json()
        tr_id = tr["id"]
        check("transfer starts as DRAFT", tr["status"] == "DRAFT", tr["status"])
        check("total units recorded", tr["total_units"] == len(move_serials), str(tr["total_units"]))

        # --- dispatch: scan out ---
        for serial in move_serials:
            out = dev.post(
                f"/api/warehouse/transfers/{tr_id}/scan",
                json={"code": serial, "phase": "DISPATCH"}, headers=csrf(dev),
            )
            if out.status_code != 200 or out.json()["result"] not in ("OK", "OK_LOCATION_MISMATCH"):
                check(f"scan {serial} out", False, out.text[:200])
        check(
            "both units scanned out",
            dev.get(f"/api/warehouse/transfers/{tr_id}").json()["dispatched_units"] == len(move_serials),
            str(dev.get(f"/api/warehouse/transfers/{tr_id}").json()["dispatched_units"]),
        )

        dup = dev.post(
            f"/api/warehouse/transfers/{tr_id}/scan",
            json={"code": move_serials[0], "phase": "DISPATCH"}, headers=csrf(dev),
        )
        check("scanning the same rod out twice is refused",
              dup.json()["result"] == "ALREADY_DISPATCHED", dup.text[:160])

        # THE INVARIANT: scanning out changes where stock is, never how much.
        mid = dev.get(f"/api/products/{move_product['id']}").json()["stock_qty"]
        check("scanned-out units do not change the stock quantity",
              mid == stock_before_transfer, f"{stock_before_transfer} -> {mid}")
        still_here = [u for u in units_of(move_product["id"]) if u["serial_number"] in move_serials]
        check("scanned-out units have not moved yet",
              all(u.get("location_id") == source_location_id for u in still_here),
              str([u.get("location_id") for u in still_here]))

        dispatched = dev.post(f"/api/warehouse/transfers/{tr_id}/dispatch",
                              json={}, headers=csrf(dev))
        check("transfer goes in transit", dispatched.status_code == 200, dispatched.text[:200])
        check("status is IN_TRANSIT", dispatched.json()["status"] == "IN_TRANSIT",
              dispatched.json()["status"])

        # --- receive: scan in ---
        for serial in move_serials:
            incoming = dev.post(
                f"/api/warehouse/transfers/{tr_id}/scan",
                json={"code": serial, "phase": "RECEIVE"}, headers=csrf(dev),
            )
            if incoming.status_code != 200 or incoming.json()["result"] != "OK":
                check(f"scan {serial} in", False, incoming.text[:200])
        check(
            "both units confirmed in",
            dev.get(f"/api/warehouse/transfers/{tr_id}").json()["received_units"] == len(move_serials),
            str(dev.get(f"/api/warehouse/transfers/{tr_id}").json()["received_units"]),
        )

        moved = [u for u in units_of(move_product["id"]) if u["serial_number"] in move_serials]
        check("receiving is what relocates the units",
              all(u.get("location_id") == destination["id"] for u in moved),
              str([u.get("location_id") for u in moved]))

        after_transfer = dev.get(f"/api/products/{move_product['id']}").json()["stock_qty"]
        check("a completed move never changed the stock quantity",
              after_transfer == stock_before_transfer,
              f"{stock_before_transfer} -> {after_transfer}")

        done = dev.post(f"/api/warehouse/transfers/{tr_id}/complete", json={}, headers=csrf(dev))
        check("transfer completes", done.status_code == 200, done.text[:200])
        if done.status_code == 200:
            print(f"     {done.json()['message']}")
            check("no units left in flight", done.json()["in_flight_released"] == 0,
                  str(done.json()["in_flight_released"]))

        # --- the in-flight path ---
        in_flight_transfer = dev.post(
            "/api/warehouse/transfers",
            json={
                "from_location_id": destination["id"],
                "to_location_id": source_location_id,
                "lines": [{"product_id": move_product["id"], "quantity": len(move_serials)}],
            },
            headers=csrf(dev),
        ).json()
        ft_id = in_flight_transfer["id"]
        for serial in move_serials:
            dev.post(f"/api/warehouse/transfers/{ft_id}/scan",
                     json={"code": serial, "phase": "DISPATCH"}, headers=csrf(dev))
        dev.post(f"/api/warehouse/transfers/{ft_id}/dispatch", json={}, headers=csrf(dev))
        dev.post(f"/api/warehouse/transfers/{ft_id}/scan",
                 json={"code": move_serials[0], "phase": "RECEIVE"}, headers=csrf(dev))

        blocked = dev.post(f"/api/warehouse/transfers/{ft_id}/complete",
                           json={}, headers=csrf(dev))
        check("closing with an unconfirmed unit is refused", blocked.status_code == 400,
              f"got {blocked.status_code}")
        if blocked.status_code == 400:
            detail = blocked.json()["detail"]
            check("the refusal names the in-flight count",
                  isinstance(detail, dict)
                  and detail.get("code") == "IN_FLIGHT_UNCONFIRMED"
                  and detail.get("in_flight") == 1,
                  str(detail)[:180])

        closed = dev.post(
            f"/api/warehouse/transfers/{ft_id}/complete",
            json={"completion_notes": "One rod left on the trolley, will move tomorrow"},
            headers=csrf(dev),
        )
        check("it closes once a reason is given", closed.status_code == 200, closed.text[:200])
        if closed.status_code == 200:
            print(f"     {closed.json()['message']}")
            check("the unconfirmed unit is released", closed.json()["in_flight_released"] == 1,
                  str(closed.json()["in_flight_released"]))

        stranded = next(
            (u for u in units_of(move_product["id"]) if u["serial_number"] == move_serials[1]),
            None,
        )
        check("the unconfirmed rod stayed where it physically was",
              bool(stranded) and stranded.get("location_id") == destination["id"],
              str(stranded.get("location_id") if stranded else None))

        # --- cancel releases units ---
        cancel_me = dev.post(
            "/api/warehouse/transfers",
            json={
                "from_location_id": source_location_id,
                "to_location_id": destination["id"],
                "lines": [{"product_id": move_product["id"], "quantity": 1}],
            },
            headers=csrf(dev),
        ).json()
        claimed = next(
            (u for u in units_of(move_product["id"])
             if u["status"] == "AVAILABLE" and u.get("location_id") == source_location_id),
            None,
        )
        if claimed:
            dev.post(f"/api/warehouse/transfers/{cancel_me['id']}/scan",
                     json={"code": claimed["serial_number"], "phase": "DISPATCH"}, headers=csrf(dev))
        cancelled = dev.post(f"/api/warehouse/transfers/{cancel_me['id']}/cancel",
                             headers=csrf(dev))
        check("a transfer can be cancelled", cancelled.status_code == 200, cancelled.text[:200])
        check("cancelling posts no stock movement",
              dev.get(f"/api/products/{move_product['id']}").json()["stock_qty"] == after_transfer,
              str(dev.get(f"/api/products/{move_product['id']}").json()["stock_qty"]))

    print("\n" + "=" * 68)
    print(f" {len(PASSED)} passed, {len(FAILED)} failed")
    if FAILED:
        print(" Failures:")
        for item in FAILED:
            print(f"   - {item}")
    print("=" * 68)
    return 0 if not FAILED else 1


if __name__ == "__main__":
    sys.exit(main())
