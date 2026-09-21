"""Unit tests for the PO → receiving-task arithmetic.

`compute_outstanding` is the single calculation that stops the same delivery
being issued to two store keepers, so it is worth pinning down precisely.
"""

from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from app.services.receiving import (
    NoOutstandingLines,
    OPEN_TASK_STATUSES,
    compute_outstanding,
    parse_due_date,
)


class TestComputeOutstanding:
    def test_nothing_received_or_reserved(self):
        assert compute_outstanding(10, 0, 0) == 10

    def test_received_quantity_is_subtracted(self):
        assert compute_outstanding(10, 4, 0) == 6

    def test_reserved_quantity_is_subtracted(self):
        # This is the double-conversion guard: a task is already counting 4.
        assert compute_outstanding(10, 0, 4) == 6

    def test_both_subtracted_together(self):
        assert compute_outstanding(10, 4, 6) == 0

    def test_never_goes_negative(self):
        # Over-receipt is possible, and must not produce a negative quantity
        # that would then be sent to the client as a task line.
        assert compute_outstanding(10, 15, 0) == 0
        assert compute_outstanding(10, 0, 99) == 0
        assert compute_outstanding(0, 0, 0) == 0

    def test_none_is_treated_as_zero(self):
        assert compute_outstanding(None, None, None) == 0
        assert compute_outstanding(10, None, None) == 10

    def test_fully_received_is_zero(self):
        assert compute_outstanding(5, 5, 0) == 0

    def test_returns_a_plain_int(self):
        assert isinstance(compute_outstanding(10, 0, 0), int)

    def test_string_digits_are_coerced(self):
        # Postgres NUMERIC can arrive as a Decimal; int() keeps it consistent.
        from decimal import Decimal

        assert compute_outstanding(Decimal("10"), Decimal("3"), 2) == 5


class TestOpenTaskStatuses:
    def test_a_draft_task_still_holds_its_quantity(self):
        assert "DRAFT" in OPEN_TASK_STATUSES

    def test_an_assigned_task_holds_its_quantity(self):
        assert "ASSIGNED" in OPEN_TASK_STATUSES

    def test_an_in_progress_task_holds_its_quantity(self):
        assert "IN_PROGRESS" in OPEN_TASK_STATUSES

    def test_completed_and_cancelled_release_their_quantity(self):
        assert "COMPLETED" not in OPEN_TASK_STATUSES
        assert "CANCELLED" not in OPEN_TASK_STATUSES


class TestParseDueDate:
    def test_iso_datetime(self):
        parsed = parse_due_date("2026-09-20T14:30:00")
        assert isinstance(parsed, datetime)
        assert parsed.year == 2026 and parsed.month == 9 and parsed.day == 20

    def test_trailing_z_is_accepted(self):
        parsed = parse_due_date("2026-09-20T14:30:00Z")
        assert parsed is not None
        assert parsed.tzinfo is not None

    def test_plain_date(self):
        parsed = parse_due_date("2026-09-20")
        assert parsed is not None and parsed.day == 20

    def test_empty_returns_none(self):
        assert parse_due_date(None) is None
        assert parse_due_date("") is None

    def test_garbage_is_rejected_with_400(self):
        with pytest.raises(HTTPException) as exc_info:
            parse_due_date("next tuesday")
        assert exc_info.value.status_code == 400

    def test_aware_and_naive_inputs_both_parse(self):
        # The frontend sends toISOString() (aware); a date input sends naive.
        aware = parse_due_date("2026-09-20T06:30:00.000Z")
        naive = parse_due_date("2026-09-20T14:30")
        assert aware is not None and naive is not None
        assert aware.tzinfo is not None
        assert naive.tzinfo is None


class TestNoOutstandingLines:
    def test_is_an_exception_the_api_layer_translates_to_409(self):
        assert issubclass(NoOutstandingLines, Exception)

    def test_carries_no_payload_so_the_api_owns_the_message(self):
        # The endpoint builds a human message naming the PO number, which the
        # service does not have to know about.
        assert NoOutstandingLines().args == ()
