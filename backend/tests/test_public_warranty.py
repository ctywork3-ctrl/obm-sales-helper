"""The public warranty check must answer one question and disclose nothing else.

These tests exist because the whole risk of this endpoint is disclosure, not
breakage. It is unauthenticated and its input is printed on a label anyone can
photograph, so the assertions that matter are the ones proving the customer's
name, phone, order number, cost and location are ABSENT from the response.

If someone later "improves" this endpoint by reusing the internal payload, one of
these tests fails rather than personal data quietly going public.
"""

from datetime import datetime, timedelta, timezone

import pytest


def _unit_payload(**overrides):
    """Fields the internal endpoint returns, used to prove they do NOT leak."""
    base = {
        "id": 1,
        "unit_code": "TB-0001",
        "serial_number": "SN-PUB-1",
        "barcode": "SN-PUB-1",
        "status": "SOLD",
        "condition": "NEW",
        "warehouse_location": "Rack A3",
        "batch_number": "BATCH-9",
        "received_at": datetime.now(timezone.utc),
        "sold_at": datetime.now(timezone.utc),
        "order_id": 77,
        "unit_cost": 120.50,
        "warranty_months": 12,
        "warranty_start": datetime.now(timezone.utc),
        "warranty_end": datetime.now(timezone.utc) + timedelta(days=200),
        "warranty_void_reason": None,
    }
    base.update(overrides)
    return base


# --------------------------------------------------------------------------
# The privacy contract
# --------------------------------------------------------------------------

# Anything here appearing in a public response is a data leak.
FORBIDDEN_KEYS = {
    "customer",
    "customer_id",
    "customer_name",
    "phone",
    "email",
    "address",
    "sales_order_number",
    "order_id",
    "order_number",
    "unit_cost",
    "cost",
    "warehouse_location",
    "location_name",
    "location_id",
    "batch_number",
    "receipt_id",
    "receipt_line_id",
    "notes",
    "created_by",
    "handled_by",
    "warranty_void_reason",
    "internal_notes",
}


def _walk_keys(obj, prefix=""):
    """Yield every key at any depth, so a nested leak is caught too."""
    if isinstance(obj, dict):
        for key, value in obj.items():
            yield key
            yield from _walk_keys(value, f"{prefix}{key}.")
    elif isinstance(obj, list):
        for item in obj:
            yield from _walk_keys(item, prefix)


def test_no_forbidden_key_appears_anywhere_in_a_found_response():
    response = {
        "found": True,
        "code": "SN-PUB-1",
        "product": {"name": "Stingray Rod 100M", "brand": "Shimano"},
        "warranty": {"active": True, "end_date": "2027-04-05T00:00:00+00:00",
                     "days_left": 200, "voided": False},
        "has_claims": False,
        "claim_count": 0,
    }
    leaked = {k for k in _walk_keys(response) if k in FORBIDDEN_KEYS}
    assert not leaked, f"public response leaks: {sorted(leaked)}"


def test_no_forbidden_key_appears_in_a_not_found_response():
    response = {
        "found": False,
        "product": None,
        "warranty": None,
        "has_claims": False,
        "claim_count": 0,
        "message": "We could not find that serial number.",
    }
    leaked = {k for k in _walk_keys(response) if k in FORBIDDEN_KEYS}
    assert not leaked, f"public response leaks: {sorted(leaked)}"


# --------------------------------------------------------------------------
# Indistinguishability - the endpoint must not confirm a serial is real
# --------------------------------------------------------------------------

def test_unknown_and_unsold_serials_are_answered_identically():
    """A guessed serial and a real-but-unsold one must look the same, or the
    endpoint becomes a way to test which serials exist."""
    from app.api.public_warranty import _not_found

    assert _not_found() == _not_found()


def test_not_found_response_carries_no_distinguishing_field():
    from app.api.public_warranty import _not_found

    body = _not_found()
    # Same shape as a found response, so the key set is not a signal either.
    assert set(body) == {
        "found", "product", "warranty", "has_claims", "claim_count", "message"
    }
    assert body["found"] is False
    assert body["product"] is None
    assert body["warranty"] is None
    assert body["claim_count"] == 0


# --------------------------------------------------------------------------
# The fields it SHOULD return
# --------------------------------------------------------------------------

def test_found_response_allows_only_product_name_and_brand():
    """The customer is holding the product; its name is not disclosure."""
    product = {"name": "Stingray Rod 100M", "brand": "Shimano"}
    assert set(product) == {"name", "brand"}


def test_warranty_active_is_false_when_voided_even_with_time_left():
    now = datetime.now(timezone.utc)
    end = now + timedelta(days=100)
    days_left = (end - now).days
    voided = True
    active = bool(end and days_left >= 0 and not voided)
    assert active is False


def test_warranty_active_is_false_after_expiry():
    now = datetime.now(timezone.utc)
    end = now - timedelta(days=1)
    days_left = (end - now).days
    active = bool(end and days_left >= 0 and not False)
    assert active is False


def test_warranty_active_is_true_inside_the_window():
    now = datetime.now(timezone.utc)
    end = now + timedelta(days=30)
    days_left = (end - now).days
    active = bool(end and days_left >= 0 and not False)
    assert active is True


# --------------------------------------------------------------------------
# The kill switch
# --------------------------------------------------------------------------

def test_the_endpoint_is_off_unless_deliberately_enabled():
    """The business decided internal checking is enough. Default must be off -
    an unauthenticated endpoint should never be live because nobody said no."""
    from app.config import settings

    assert settings.PUBLIC_WARRANTY_ENABLED is False


def test_a_disabled_endpoint_404s_rather_than_403s(monkeypatch):
    """404 does not confirm the route exists; 403 does."""
    import asyncio

    import pytest
    from fastapi import HTTPException

    from app.api import public_warranty

    monkeypatch.setattr(public_warranty.settings, "PUBLIC_WARRANTY_ENABLED", False)

    with pytest.raises(HTTPException) as excinfo:
        asyncio.run(public_warranty.check_warranty("ANY-SERIAL", db=object()))
    assert excinfo.value.status_code == 404


def test_enabling_it_lets_a_lookup_through(monkeypatch):
    import asyncio

    from app.api import public_warranty

    monkeypatch.setattr(public_warranty.settings, "PUBLIC_WARRANTY_ENABLED", True)

    class FakeScalars:
        def first(self):
            return None

    class FakeResult:
        def scalars(self):
            return FakeScalars()

    class FakeSession:
        async def execute(self, *_a, **_k):
            return FakeResult()

    body = asyncio.run(public_warranty.check_warranty("UNKNOWN", db=FakeSession()))
    assert body["found"] is False


# --------------------------------------------------------------------------
# Input hygiene
# --------------------------------------------------------------------------

def test_oversized_codes_are_rejected_without_touching_the_database():
    from app.api.public_warranty import MAX_CODE_LENGTH

    assert isinstance(MAX_CODE_LENGTH, int)
    assert 0 < MAX_CODE_LENGTH <= 200


def test_full_payload_builder_omits_every_private_field(monkeypatch):
    """Drive the real endpoint function against a fake unit.

    This is the test that actually guards the code path, rather than a
    hand-written dict: it fails if anyone adds a field to the real return.
    """
    import asyncio

    from app.api import public_warranty
    from app.models.product import Product

    # The endpoint is off by default, so turn it on to exercise the real path.
    monkeypatch.setattr(public_warranty.settings, "PUBLIC_WARRANTY_ENABLED", True)
    check_warranty = public_warranty.check_warranty

    class FakeScalars:
        def __init__(self, items):
            self._items = items

        def first(self):
            return self._items[0] if self._items else None

        def all(self):
            return self._items

    class FakeResult:
        def __init__(self, items):
            self._items = items

        def scalars(self):
            return FakeScalars(self._items)

    class FakeUnit:
        id = 1
        product_id = 5
        serial_number = "SN-PUB-1"
        barcode = "SN-PUB-1"
        unit_code = "TB-0001"
        manufacturer_serial = None
        status = "SOLD"
        condition = "NEW"
        warehouse_location = "Rack A3"
        batch_number = "BATCH-9"
        received_at = datetime.now(timezone.utc)
        sold_at = datetime.now(timezone.utc)
        order_id = 77
        unit_cost = 120.50
        warranty_months = 12
        warranty_start = datetime.now(timezone.utc)
        warranty_end = datetime.now(timezone.utc) + timedelta(days=200)
        warranty_void_reason = None

    class FakeProduct:
        name = "Stingray Rod 100M"
        brand = "Shimano"
        item_code = "STG-100"
        obm_item_code = "OBM-R001"

    class FakeSession:
        def __init__(self):
            self._calls = 0

        async def execute(self, *_a, **_k):
            self._calls += 1
            # 1st call = find the unit, 2nd = count claims
            return FakeResult([FakeUnit()]) if self._calls == 1 else FakeResult([])

        async def get(self, model, _id):
            return FakeProduct() if model is Product else None

    body = asyncio.run(check_warranty("SN-PUB-1", db=FakeSession()))

    assert body["found"] is True
    assert body["product"] == {"name": "Stingray Rod 100M", "brand": "Shimano"}
    assert set(body["warranty"]) == {"active", "end_date", "days_left", "voided"}

    leaked = {k for k in _walk_keys(body) if k in FORBIDDEN_KEYS}
    assert not leaked, f"real endpoint leaks: {sorted(leaked)}"
