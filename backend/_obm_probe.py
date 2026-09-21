"""Throwaway: exercise the new OBM Firebird reader against the real database."""

import sys

sys.path.insert(0, ".")

from app.services.obm_firebird import (
    ObmFirebirdConfig,
    read_purchase_order_headers,
    read_purchase_orders,
    test_connection,
)

config = ObmFirebirdConfig(
    isql_path=r"C:\Program Files (x86)\Firebird\Firebird_2_5\bin\isql.exe",
    database_path=r"C:\OBMSB\Data\SUBANG U THREE HOTEL SDN BHD.fdb",
    user="SYSDBA",
    password="masterkey",
)

print("=== test_connection ===")
for key, value in test_connection(config).items():
    print(f"  {key}: {value}")

print("\n=== headers (first 5) ===")
headers = read_purchase_order_headers(config, limit=5)
for h in headers:
    print(f"  {h['external_reference']:14} {h['document_date']} "
          f"{str(h['supplier_name'])[:32]:34} status={h['obm_status']} total={h['total']}")

print(f"\n  total headers read: {len(headers)}")

print("\n=== read_purchase_orders ===")
result = read_purchase_orders(config, limit=5)
print(f"  counts: {result['counts']}")
for order in result["orders"]:
    print(f"  {order['external_reference']:14} supplier={order['supplier_name'][:30]:32} "
          f"lines={len(order['lines'])} expected={order['expected_date']}")
    for line in order["lines"][:3]:
        print(f"       - {str(line['item_code'])[:22]:24} qty={line['quantity']:>4} "
              f"cost={line['unit_cost']}")
print("\n  skipped:")
for item in result["skipped"]:
    print(f"    {item['reference']}: {item['reason']} ({item['line_count']} line(s))")

print("\n=== read-only guard ===")
try:
    from app.services.obm_firebird import _assert_read_only
    _assert_read_only("SELECT 1 FROM X")
    print("  SELECT allowed: yes")
    for bad in ["UPDATE PURCHASEORDER SET STATUS='X'", "DELETE FROM CREDITOR",
                "DROP TABLE STOCK", "INSERT INTO X VALUES (1)"]:
        try:
            _assert_read_only(bad)
            print(f"  !! NOT BLOCKED: {bad}")
        except Exception as exc:
            print(f"  blocked: {bad[:34]:36} -> {type(exc).__name__}")
except Exception as exc:
    print("  guard check failed:", exc)
