"""Supplier master data: identity rules.

The point of `Supplier` is that ONE vendor must not become several because
somebody typed the name differently. These tests pin that down, because a future
"small improvement" to the normalization would silently re-split every vendor in
the discrepancy queue.

    python -m pytest tests/test_suppliers.py -q
"""

from app.models.master_data import normalize_supplier_name


class TestNormalizationCollapses:
    """Things that must map to the SAME supplier."""

    def test_casing_is_ignored(self):
        assert normalize_supplier_name("Mismatch Supplier") == normalize_supplier_name(
            "mismatch supplier"
        )
        assert normalize_supplier_name("MISMATCH SUPPLIER") == normalize_supplier_name(
            "Mismatch Supplier"
        )

    def test_extra_inner_whitespace_is_ignored(self):
        assert normalize_supplier_name("Mismatch  Supplier") == normalize_supplier_name(
            "Mismatch Supplier"
        )

    def test_leading_and_trailing_whitespace_is_ignored(self):
        assert normalize_supplier_name("  Mismatch Supplier  ") == normalize_supplier_name(
            "Mismatch Supplier"
        )

    def test_tabs_and_newlines_are_ignored(self):
        assert normalize_supplier_name("Mismatch\tSupplier") == normalize_supplier_name(
            "Mismatch Supplier"
        )
        assert normalize_supplier_name("Mismatch\nSupplier") == normalize_supplier_name(
            "Mismatch Supplier"
        )

    def test_real_world_variants_all_collapse(self):
        variants = [
            "Seng Heng Fishing Tackle",
            "seng heng fishing tackle",
            "SENG HENG FISHING TACKLE",
            "Seng  Heng  Fishing  Tackle",
            "  Seng Heng Fishing Tackle ",
        ]
        assert len({normalize_supplier_name(v) for v in variants}) == 1


class TestNormalizationPreserves:
    """Things that must stay DIFFERENT - merging these would be a data bug."""

    def test_different_companies_stay_apart(self):
        assert normalize_supplier_name("Angler Trading") != normalize_supplier_name(
            "Angler Supply"
        )

    def test_punctuation_is_significant(self):
        # We deliberately do NOT strip punctuation: folding "Sdn. Bhd." into
        # "Sdn Bhd" risks merging two genuinely separate registered companies,
        # and that is a worse error than showing two rows.
        assert normalize_supplier_name("Angler Sdn. Bhd.") != normalize_supplier_name(
            "Angler Sdn Bhd"
        )

    def test_numbers_are_significant(self):
        assert normalize_supplier_name("Supplier 1") != normalize_supplier_name("Supplier 2")


class TestNormalizationEdgeCases:

    def test_empty_and_none_are_empty_string(self):
        for value in (None, "", "   ", "\t\n"):
            assert normalize_supplier_name(value) == ""

    def test_whitespace_only_is_falsy_so_callers_can_reject_it(self):
        # The API treats a falsy result as "no name supplied" and returns 400,
        # so this must stay falsy rather than becoming e.g. "_".
        assert not normalize_supplier_name("   ")

    def test_result_is_always_safe_to_compare(self):
        # No whitespace may survive, or two suppliers could differ by an
        # invisible character nobody can see in the UI.
        for raw in ["  A B  ", "A\tB", "A\nB", " A "]:
            assert " " not in normalize_supplier_name(raw)
            assert normalize_supplier_name(raw) == normalize_supplier_name(
                normalize_supplier_name(raw)
            )

    def test_normalization_is_idempotent(self):
        # Running it twice must not change the answer, because the API stores
        # the normalized form and later re-normalizes incoming names to match.
        for raw in ["Mismatch Supplier", "  Seng  Heng ", "Angler Sdn. Bhd."]:
            once = normalize_supplier_name(raw)
            assert normalize_supplier_name(once) == once
