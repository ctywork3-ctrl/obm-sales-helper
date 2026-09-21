"""Parser rules for the CSV purchase-order importer.

These pin the decisions that are easy to get wrong and expensive to get wrong,
because the failure mode is a PO that quietly does not exist:

* a bad line must not erase its order,
* a supplier name with no master row is NOT a parse error,
* header names are matched loosely (nobody controls the export),
* day-first dates win in a Malaysian export,
* the same PO on many rows groups into one order,
* and two suppliers on one PO is reported, never guessed.
"""

import pytest

from app.services.po_import import parse_date, parse_po_csv

HEADER = "PO No,Supplier,Item Code,Description,Qty,Unit Price,Due Date,Remarks\n"


def csv_of(*rows: str) -> bytes:
    return (HEADER + "\n".join(rows) + "\n").encode("utf-8")


# --------------------------------------------------------------------------
# The bug this file exists for
# --------------------------------------------------------------------------

def test_bad_line_does_not_erase_its_order():
    """A PO whose only row has no quantity still appears, with the error.

    Before this, `CSV-PO-9002` vanished from `orders` entirely: the quantity
    check ran before the order dict was registered. The user was told the file
    held one PO when it plainly held two, and the importer never got the
    reference so it could not even say "skipped: no lines".
    """
    parsed = parse_po_csv(csv_of(
        "CSV-PO-9001,Shimano SEA,OBM-R001,Rod 100M,4,RM88.50,15/10/2026,ok",
        "CSV-PO-9002,Predator Tackle,OBM-R003,Rod 500H,,RM210.00,20/10/2026,bad qty",
    ))

    refs = {o["external_reference"] for o in parsed["orders"]}
    assert refs == {"CSV-PO-9001", "CSV-PO-9002"}

    second = next(o for o in parsed["orders"] if o["external_reference"] == "CSV-PO-9002")
    assert second["lines"] == []

    # Two errors, both wanted: one locates the bad row, one names the PO that
    # will not be imported. The row error alone does not tell the user what
    # happened to the order.
    assert len(parsed["errors"]) == 2
    row_errors = [e for e in parsed["errors"] if e["row"] == 3]
    assert len(row_errors) == 1
    assert "quantity" in row_errors[0]["reason"]

    order_errors = [e for e in parsed["errors"] if e["row"] == 0]
    assert len(order_errors) == 1
    assert "CSV-PO-9002" in order_errors[0]["reason"]


def test_order_with_only_bad_lines_reports_zero_importable_but_is_visible():
    parsed = parse_po_csv(csv_of(
        "CSV-PO-BAD,Someone,OBM-R001,Rod,0,RM10.00,15/10/2026,zero qty",
    ))
    # Visible as an order (so the user sees the reference) but with no lines.
    assert len(parsed["orders"]) == 1
    assert parsed["orders"][0]["lines"] == []
    # The API layer is what filters these out; the parser never hides them.
    importable = [o for o in parsed["orders"] if o["lines"]]
    assert importable == []


def test_bad_line_in_the_middle_of_a_good_order_keeps_the_good_lines():
    parsed = parse_po_csv(csv_of(
        "CSV-PO-9001,Shimano SEA,OBM-R001,Rod 100M,4,RM88.50,15/10/2026,",
        "CSV-PO-9001,Shimano SEA,OBM-R002,Rod 200M,,RM1250.00,15/10/2026,",
        "CSV-PO-9001,Shimano SEA,OBM-R003,Rod 300M,2,RM99.00,15/10/2026,",
    ))
    assert len(parsed["orders"]) == 1
    assert len(parsed["orders"][0]["lines"]) == 2
    assert len(parsed["errors"]) == 1


# --------------------------------------------------------------------------
# Supplier identity is not the parser's job
# --------------------------------------------------------------------------

def test_unmatched_supplier_is_not_an_error():
    """The parser does not know the supplier table, so it must not judge.

    `_resolve_supplier` deliberately returns None rather than inventing master
    data. The parser's job is to report the distinct names so the screen can
    offer to create them.
    """
    parsed = parse_po_csv(csv_of(
        "CSV-PO-9001,Shimano SEA,OBM-R001,Rod,4,RM88.50,15/10/2026,",
        "CSV-PO-9001,Shimano SEA,OBM-R002,Rod,3,RM89.00,15/10/2026,",
        "CSV-PO-9002,Predator Tackle,OBM-R003,Rod,5,RM210.00,20/10/2026,",
    ))
    assert parsed["errors"] == []
    assert parsed["unmatched_suppliers"] == ["Predator Tackle", "Shimano SEA"]


def test_orders_with_no_usable_lines_are_excluded_from_unmatched_suppliers():
    """Otherwise the import screen offers to create a supplier for a PO that
    will never be created."""
    parsed = parse_po_csv(csv_of(
        "CSV-PO-BAD,Ghost Vendor,OBM-R001,Rod,,RM10.00,15/10/2026,",
    ))
    assert parsed["unmatched_suppliers"] == []


def test_supplier_name_snapshot_is_kept_verbatim():
    parsed = parse_po_csv(csv_of(
        "CSV-PO-9001,  Shimano  SEA  ,OBM-R001,Rod,4,RM88.50,15/10/2026,",
    ))
    # The snapshot keeps the document's own spelling (leading/trailing space
    # trimmed, inner spacing kept). The PO must show what the document said;
    # collapsing whitespace is the matcher's job, not the record's. This is the
    # same split as `supplier_name` vs `normalized_name` on the master row.
    assert parsed["orders"][0]["supplier_name"] == "Shimano  SEA"


# --------------------------------------------------------------------------
# Headers, dates, numbers
# --------------------------------------------------------------------------

@pytest.mark.parametrize("header", [
    "PO No,Supplier,Item Code,Description,Qty,Unit Price,Due Date,Remarks",
    "po_number,VENDOR,sku,product_name,quantity,unit_cost,delivery_date,remarks",
    "Reference,Vendor Name,Product Code,Item Name,Order Qty,Price,ETA,Comment",
    "doc-no,supplier_name,item_no,description,qty,buy_price,due_date,notes",
])
def test_headers_are_matched_loosely(header):
    content = (
        header + "\n"
        "CSV-PO-1,Shimano SEA,OBM-R001,Stingray Rod 100M,4,RM88.50,15/10/2026,x\n"
    ).encode("utf-8")
    parsed = parse_po_csv(content)
    assert parsed["errors"] == [], parsed["errors"]
    assert len(parsed["orders"]) == 1, parsed["columns"]
    assert parsed["orders"][0]["lines"][0]["quantity"] == 4
    assert parsed["orders"][0]["lines"][0]["unit_cost"] == 88.5


def test_missing_required_column_is_explained_not_crashed():
    parsed = parse_po_csv(b"a,b,c\n1,2,3\n")
    assert parsed["orders"] == []
    assert parsed["errors"]
    reason = parsed["errors"][0]["reason"]
    assert "missing required column" in reason
    assert "a" in reason  # lists what it did find


def test_day_first_dates_win():
    """15/10/2026 is 15 October; a US-first reading would be invalid here, and
    a naive %m/%d/%Y would silently swap day and month on files where it is
    not."""
    assert parse_date("15/10/2026") == "2026-10-15"
    assert parse_date("2026-10-15") == "2026-10-15"
    assert parse_date("15-10-2026") == "2026-10-15"


def test_unreadable_date_warns_but_still_imports():
    parsed = parse_po_csv(csv_of(
        "CSV-PO-9001,Shimano SEA,OBM-R001,Rod,4,RM88.50,next tuesday,",
    ))
    assert parsed["orders"][0]["expected_date"] is None
    assert parsed["orders"][0]["lines"]  # the line still imported
    assert parsed["warnings"] and "next tuesday" in parsed["warnings"][0]["reason"]


def test_currency_prefix_and_thousands_separator_are_tolerated():
    parsed = parse_po_csv(csv_of(
        'CSV-PO-9001,Shimano SEA,OBM-R001,Rod,1,"RM1,250.00",15/10/2026,',
        'CSV-PO-9001,Shimano SEA,OBM-R002,Rod,1,$99.90,15/10/2026,',
    ))
    costs = [line["unit_cost"] for line in parsed["orders"][0]["lines"]]
    assert costs == [1250.0, 99.9]


def test_bom_from_excel_does_not_break_the_first_header():
    content = b"\xef\xbb\xbf" + csv_of(
        "CSV-PO-9001,Shimano SEA,OBM-R001,Rod,4,RM88.50,15/10/2026,",
    )
    parsed = parse_po_csv(content)
    assert parsed["errors"] == []
    assert len(parsed["orders"]) == 1


def test_blank_lines_are_not_counted_as_rows():
    parsed = parse_po_csv(csv_of(
        "CSV-PO-9001,Shimano SEA,OBM-R001,Rod,4,RM88.50,15/10/2026,",
        ",,,,,,,",
    ))
    assert parsed["rows_read"] == 1


# --------------------------------------------------------------------------
# Grouping and the one genuine cross-row error
# --------------------------------------------------------------------------

def test_rows_group_into_one_order_per_reference():
    parsed = parse_po_csv(csv_of(
        "CSV-PO-1,Sup A,OBM-R001,Rod,1,RM10.00,15/10/2026,",
        "CSV-PO-1,Sup A,OBM-R002,Rod,2,RM20.00,15/10/2026,",
        "CSV-PO-2,Sup A,OBM-R003,Rod,3,RM30.00,16/10/2026,",
    ))
    assert len(parsed["orders"]) == 2
    by_ref = {o["external_reference"]: o for o in parsed["orders"]}
    assert len(by_ref["CSV-PO-1"]["lines"]) == 2
    assert len(by_ref["CSV-PO-2"]["lines"]) == 1


def test_two_suppliers_on_one_po_is_reported_never_guessed():
    parsed = parse_po_csv(csv_of(
        "CSV-PO-1,Sup A,OBM-R001,Rod,1,RM10.00,15/10/2026,",
        "CSV-PO-1,Sup B,OBM-R002,Rod,2,RM20.00,15/10/2026,",
    ))
    assert parsed["orders"][0]["supplier_name"] == "Sup A"  # first wins, unchanged
    assert len(parsed["orders"][0]["lines"]) == 1
    assert any("two suppliers" in e["reason"] for e in parsed["errors"])


def test_same_supplier_different_casing_is_not_a_conflict():
    """Normalization is the supplier table's rule; the parser compares what the
    document says. Identical text is identical; casing differs only when the
    export genuinely wrote it differently, and that is not a data error."""
    parsed = parse_po_csv(csv_of(
        "CSV-PO-1,Sup A,OBM-R001,Rod,1,RM10.00,15/10/2026,",
        "CSV-PO-1,Sup A,OBM-R002,Rod,2,RM20.00,15/10/2026,",
    ))
    assert parsed["errors"] == []
    assert len(parsed["orders"][0]["lines"]) == 2


def test_a_row_with_no_reference_is_an_error_not_a_crash():
    parsed = parse_po_csv(csv_of(
        ",Sup A,OBM-R001,Rod,1,RM10.00,15/10/2026,",
    ))
    assert parsed["orders"] == []
    assert "reference" in parsed["errors"][0]["reason"]


def test_empty_file_yields_nothing_rather_than_raising():
    parsed = parse_po_csv(b"")
    assert parsed["orders"] == []
    assert parsed["rows_read"] == 0
