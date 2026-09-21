"""`import_purchase_orders()` - the one seam both the CSV importer and the OBM
reader feed.

The rules pinned here are about what happens when the accounting package sends
something this app cannot use. That is the normal case for a first import, not
an edge case: OBM holds years of documents, most of whose lines predate the
product catalogue.

The expensive mistake is creating a purchase order that has no lines. It looks
like a real order, so someone has to open it to discover it is empty - and a
re-import would strip the lines off a PO that already had them.
"""

import pytest

from app.models.master_data import Supplier
from app.models.product import Product
from app.models.purchase_order import PurchaseOrder, PurchaseOrderLine
from app.services.obm import SOURCE_OBM, import_purchase_orders
from sqlalchemy import select, func


def order(reference="PO26/01/001", supplier="ACME TACKLE", lines=None, **overrides):
    entry = {
        "external_reference": reference,
        "supplier_name": supplier,
        "expected_date": None,
        "notes": None,
        "lines": lines if lines is not None else [
            {"item_code": "R001", "name": "Stingray Rod", "quantity": 4, "unit_cost": 88.5},
        ],
    }
    entry.update(overrides)
    return entry


async def add_product(db, item_code="R001", name="Stingray Rod", obm_item_code=None):
    product = Product(
        item_code=item_code,
        name=name,
        obm_item_code=obm_item_code,
        evidence_policy="RECEIPT",
        inventory_model="BULK",
    )
    db.add(product)
    await db.flush()
    return product


async def po_count(db) -> int:
    return (await db.execute(select(func.count(PurchaseOrder.id)))).scalar()


async def line_count(db, po_id: int) -> int:
    return (
        await db.execute(
            select(func.count(PurchaseOrderLine.id)).where(
                PurchaseOrderLine.purchase_order_id == po_id
            )
        )
    ).scalar()


# --------------------------------------------------------------------------
# The rule this file exists for
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_a_po_whose_lines_all_fail_is_skipped_not_created_empty(db_session):
    """No product matches, so there is nothing to receive against.

    Creating the PO anyway gives a draft with zero items - indistinguishable
    from a real order until someone opens it.
    """
    report = await import_purchase_orders(
        db_session,
        [order(lines=[{"item_code": "NOT-A-PRODUCT", "name": "Mystery", "quantity": 3}])],
        actor_user_id=1,
    )

    assert report["created"] == 0
    assert await po_count(db_session) == 0

    # ...and it is named, not swallowed.
    assert len(report["skipped"]) == 1
    assert report["skipped"][0]["reference"] == "PO26/01/001"
    assert "no lines matched a product" in report["skipped"][0]["reason"]

    # The line itself is reported so the user knows which product to create.
    assert len(report["unmatched_lines"]) == 1
    assert report["unmatched_lines"][0]["item_code"] == "NOT-A-PRODUCT"


@pytest.mark.asyncio
async def test_an_existing_po_is_not_emptied_when_its_lines_stop_matching(db_session):
    """The mirror-image failure: an update that resolves nothing must not wipe
    the lines the purchase order already had."""
    await add_product(db_session)
    await import_purchase_orders(db_session, [order()], actor_user_id=1)

    po = (await db_session.execute(select(PurchaseOrder))).scalars().first()
    assert await line_count(db_session, po.id) == 1

    # Same reference, but now nothing resolves. Note both the code AND the name
    # have to change: `_resolve_product` falls back to an exact name match, so
    # renaming only the code would still resolve and the test would prove nothing.
    product = (await db_session.execute(select(Product))).scalars().first()
    product.item_code = "RENAMED"
    product.name = "Renamed Rod"
    await db_session.flush()

    report = await import_purchase_orders(
        db_session,
        [order(lines=[{"item_code": "R001", "name": "Stingray Rod", "quantity": 4}])],
        actor_user_id=1,
    )

    assert report["updated"] == 0
    assert report["skipped"][0]["reason"].startswith("no lines matched")
    # The original line survived.
    assert await line_count(db_session, po.id) == 1


@pytest.mark.asyncio
async def test_a_partly_matching_po_is_still_created(db_session):
    """One good line is enough. Only an order with NOTHING usable is held back."""
    await add_product(db_session)
    report = await import_purchase_orders(
        db_session,
        [order(lines=[
            {"item_code": "R001", "name": "Stingray Rod", "quantity": 4},
            {"item_code": "GHOST", "name": "Not a product", "quantity": 2},
        ])],
        actor_user_id=1,
    )

    assert report["created"] == 1
    po = (await db_session.execute(select(PurchaseOrder))).scalars().first()
    assert await line_count(db_session, po.id) == 1
    assert len(report["unmatched_lines"]) == 1


# --------------------------------------------------------------------------
# The happy path
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_a_matching_po_is_created_as_a_draft(db_session):
    await add_product(db_session)
    report = await import_purchase_orders(db_session, [order()], actor_user_id=7)

    assert report["created"] == 1
    po = (await db_session.execute(select(PurchaseOrder))).scalars().first()
    assert po.status == "DRAFT"
    assert po.source == SOURCE_OBM
    assert po.external_reference == "PO26/01/001"
    assert po.created_by == 7
    assert await line_count(db_session, po.id) == 1


@pytest.mark.asyncio
async def test_reimporting_updates_rather_than_duplicating(db_session):
    """The property that makes a re-read safe to run: OBM's document number is
    the key, so running it twice does not double the orders."""
    await add_product(db_session)
    await import_purchase_orders(db_session, [order()], actor_user_id=1)
    report = await import_purchase_orders(db_session, [order()], actor_user_id=1)

    assert report["created"] == 0
    assert report["updated"] == 1
    assert await po_count(db_session) == 1


@pytest.mark.asyncio
async def test_reimport_replaces_lines_rather_than_appending(db_session):
    """A PO not yet being worked on takes its lines from the accounting package,
    which is the source of truth."""
    await add_product(db_session)
    await import_purchase_orders(db_session, [order()], actor_user_id=1)

    report = await import_purchase_orders(
        db_session,
        [order(lines=[
            {"item_code": "R001", "name": "Stingray Rod", "quantity": 9},
        ])],
        actor_user_id=1,
    )

    assert report["updated"] == 1
    po = (await db_session.execute(select(PurchaseOrder))).scalars().first()
    assert await line_count(db_session, po.id) == 1
    line = (await db_session.execute(
        select(PurchaseOrderLine).where(PurchaseOrderLine.purchase_order_id == po.id)
    )).scalars().first()
    assert line.quantity_ordered == 9


@pytest.mark.asyncio
async def test_a_po_already_in_progress_is_left_alone(db_session):
    """Someone is receiving it. Rewriting the lines under them would break a
    promise made to a supplier."""
    await add_product(db_session)
    await import_purchase_orders(db_session, [order()], actor_user_id=1)

    po = (await db_session.execute(select(PurchaseOrder))).scalars().first()
    po.status = "SENT"
    await db_session.flush()

    report = await import_purchase_orders(db_session, [order()], actor_user_id=1)
    assert report["updated"] == 0
    assert report["created"] == 0
    assert "already in progress" in report["skipped"][0]["reason"]


# --------------------------------------------------------------------------
# Identity
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_the_supplier_is_linked_when_the_master_row_exists(db_session):
    await add_product(db_session)
    supplier = Supplier(name="Acme Tackle", normalized_name="acmetackle")
    db_session.add(supplier)
    await db_session.flush()

    await import_purchase_orders(db_session, [order(supplier="acme  tackle")], actor_user_id=1)

    po = (await db_session.execute(select(PurchaseOrder))).scalars().first()
    assert po.supplier_id == supplier.id
    # The document's own wording is kept as the historical snapshot.
    assert po.supplier_name == "acme  tackle"


@pytest.mark.asyncio
async def test_an_unknown_supplier_imports_unlinked_rather_than_inventing_one(db_session):
    """An import is not the place to create master data, or every typo in the
    accounting package becomes a permanent supplier."""
    await add_product(db_session)
    await import_purchase_orders(db_session, [order(supplier="Nobody Ltd")], actor_user_id=1)

    po = (await db_session.execute(select(PurchaseOrder))).scalars().first()
    assert po.supplier_id is None
    assert po.supplier_name == "Nobody Ltd"

    suppliers = (await db_session.execute(select(Supplier))).scalars().all()
    assert suppliers == []


@pytest.mark.asyncio
async def test_a_po_missing_a_reference_is_refused(db_session):
    report = await import_purchase_orders(
        db_session, [order(reference="")], actor_user_id=1
    )
    assert report["created"] == 0
    assert "external_reference" in report["skipped"][0]["reason"]


@pytest.mark.asyncio
async def test_a_po_with_no_lines_at_all_is_refused(db_session):
    report = await import_purchase_orders(
        db_session, [order(lines=[])], actor_user_id=1
    )
    assert report["created"] == 0
    assert report["skipped"][0]["reason"] == "no lines"


@pytest.mark.asyncio
async def test_zero_quantity_lines_are_dropped(db_session):
    """OBM carries expense rows at quantity zero."""
    await add_product(db_session)
    report = await import_purchase_orders(
        db_session,
        [order(lines=[
            {"item_code": "R001", "name": "Stingray Rod", "quantity": 0},
            {"item_code": "R001", "name": "Stingray Rod", "quantity": 5},
        ])],
        actor_user_id=1,
    )
    assert report["created"] == 1
    po = (await db_session.execute(select(PurchaseOrder))).scalars().first()
    assert await line_count(db_session, po.id) == 1


# --------------------------------------------------------------------------
# OBM's received figure is recorded, never adopted
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_obm_processed_quantity_is_recorded_beside_ours(db_session):
    """OBM saying "5 already arrived" must not become our received quantity.

    `quantity_received` records what THIS app received, through its own receipts.
    Adopting another system's number would make our receiving state unexplainable
    and would double-count the moment those goods were booked in here. So OBM's
    figure is stored separately for a human to compare.
    """
    await add_product(db_session)
    await import_purchase_orders(
        db_session,
        [order(lines=[
            {"item_code": "R001", "name": "Stingray Rod", "quantity": 10,
             "unit_cost": 88.5, "quantity_processed": 5},
        ])],
        actor_user_id=1,
    )

    line = (await db_session.execute(select(PurchaseOrderLine))).scalars().first()
    assert float(line.obm_quantity_processed) == 5.0
    assert line.quantity_received == 0, "OBM's figure must never become ours"
    assert line.quantity_ordered == 10


@pytest.mark.asyncio
async def test_a_csv_line_has_no_obm_figure(db_session):
    """CSV rows carry no processed quantity, so the column stays empty and the
    UI shows no comparison rather than a misleading zero."""
    await add_product(db_session)
    await import_purchase_orders(
        db_session,
        [order(lines=[
            {"item_code": "R001", "name": "Stingray Rod", "quantity": 4, "unit_cost": 88.5},
        ])],
        actor_user_id=1,
    )
    line = (await db_session.execute(select(PurchaseOrderLine))).scalars().first()
    assert line.obm_quantity_processed is None


@pytest.mark.asyncio
async def test_reimport_refreshes_the_obm_figure(db_session):
    """The accounting package is the source of truth for this number, so a
    re-read updates it rather than leaving a stale one behind."""
    await add_product(db_session)
    await import_purchase_orders(
        db_session,
        [order(lines=[
            {"item_code": "R001", "name": "Stingray Rod", "quantity": 10,
             "quantity_processed": 2},
        ])],
        actor_user_id=1,
    )
    await import_purchase_orders(
        db_session,
        [order(lines=[
            {"item_code": "R001", "name": "Stingray Rod", "quantity": 10,
             "quantity_processed": 7},
        ])],
        actor_user_id=1,
    )

    line = (await db_session.execute(select(PurchaseOrderLine))).scalars().first()
    assert float(line.obm_quantity_processed) == 7.0
    assert line.quantity_received == 0


# --------------------------------------------------------------------------
# The receiving preview flags the disagreement
# --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_receiving_lines_flag_a_line_obm_thinks_arrived(db_session):
    """This is the point of the whole feature: do not send someone to count
    goods the accounting package already considers delivered."""
    from app.services.receiving import outstanding_lines_for_po

    await add_product(db_session)
    await import_purchase_orders(
        db_session,
        [order(lines=[
            {"item_code": "R001", "name": "Stingray Rod", "quantity": 10,
             "quantity_processed": 10},
        ])],
        actor_user_id=1,
    )
    po = (await db_session.execute(select(PurchaseOrder))).scalars().first()
    po = await load_full_po(db_session, po.id)

    rows = await outstanding_lines_for_po(db_session, po)
    assert len(rows) == 1
    row = rows[0]
    assert row["obm_quantity_processed"] == 10.0
    assert row["obm_disagrees"] is True
    assert row["obm_already_complete"] is True
    # Our own figure is untouched, so the line still reads as outstanding here -
    # the flag is what tells a human to look, not a silent adjustment.
    assert row["quantity_received"] == 0
    assert row["quantity_outstanding"] == 10


@pytest.mark.asyncio
async def test_receiving_lines_do_not_flag_a_line_obm_agrees_on(db_session):
    from app.services.receiving import outstanding_lines_for_po

    await add_product(db_session)
    await import_purchase_orders(
        db_session,
        [order(lines=[
            {"item_code": "R001", "name": "Stingray Rod", "quantity": 10,
             "quantity_processed": 0},
        ])],
        actor_user_id=1,
    )
    po = (await db_session.execute(select(PurchaseOrder))).scalars().first()
    po = await load_full_po(db_session, po.id)

    row = (await outstanding_lines_for_po(db_session, po))[0]
    assert row["obm_quantity_processed"] == 0.0
    assert row["obm_disagrees"] is False
    assert row["obm_already_complete"] is False


@pytest.mark.asyncio
async def test_receiving_lines_do_not_flag_when_there_is_no_obm_figure(db_session):
    """A hand-raised PO has no OBM figure, so nothing is claimed about it."""
    from app.services.receiving import outstanding_lines_for_po

    await add_product(db_session)
    await import_purchase_orders(
        db_session,
        [order(lines=[
            {"item_code": "R001", "name": "Stingray Rod", "quantity": 4},
        ])],
        actor_user_id=1,
    )
    po = (await db_session.execute(select(PurchaseOrder))).scalars().first()
    po = await load_full_po(db_session, po.id)

    row = (await outstanding_lines_for_po(db_session, po))[0]
    assert row["obm_quantity_processed"] is None
    assert row["obm_disagrees"] is False
    assert row["obm_already_complete"] is False


async def load_full_po(db, po_id):
    """Reload a PO with its lines and products, the way the API does."""
    from sqlalchemy.orm import selectinload

    return (
        await db.execute(
            select(PurchaseOrder)
            .options(selectinload(PurchaseOrder.lines).selectinload(PurchaseOrderLine.product))
            .where(PurchaseOrder.id == po_id)
        )
    ).scalars().first()
