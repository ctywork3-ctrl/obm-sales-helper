from decimal import Decimal

import pytest

from app.services.tax import compute_line_tax


class TestExclusiveTax:
    def test_ten_percent(self):
        assert compute_line_tax(Decimal("100.00"), Decimal("0.10"), False) == Decimal("10.00")

    def test_nine_percent_rounding(self):
        # 33.33 * 0.09 = 2.9997 -> rounds to 3.00
        assert compute_line_tax(Decimal("33.33"), Decimal("0.09"), False) == Decimal("3.00")

    def test_five_percent(self):
        assert compute_line_tax(Decimal("80.00"), Decimal("0.05"), False) == Decimal("4.00")

    def test_zero_rate(self):
        assert compute_line_tax(Decimal("100.00"), Decimal("0"), False) == Decimal("0.00")

    def test_zero_total(self):
        assert compute_line_tax(Decimal("0"), Decimal("0.10"), False) == Decimal("0.00")


class TestInclusiveTax:
    def test_ten_percent(self):
        # 110.00 inclusive at 10% -> 110 - 100 = 10.00
        assert compute_line_tax(Decimal("110.00"), Decimal("0.10"), True) == Decimal("10.00")

    def test_nine_percent(self):
        # 109.00 inclusive at 9% -> 109 - 100 = 9.00
        assert compute_line_tax(Decimal("109.00"), Decimal("0.09"), True) == Decimal("9.00")

    def test_rounding(self):
        # 100.00 inclusive at 10% -> 100 - 90.909090... = 9.0909... -> 9.09
        assert compute_line_tax(Decimal("100.00"), Decimal("0.10"), True) == Decimal("9.09")

    def test_zero_rate(self):
        assert compute_line_tax(Decimal("100.00"), Decimal("0"), True) == Decimal("0.00")

    def test_tax_rate_fraction(self):
        # Rate supplied as fraction 0.09 for 9%
        assert compute_line_tax(Decimal("218.00"), Decimal("0.09"), True) == Decimal("18.00")


class TestEdgeCases:
    def test_none_values(self):
        assert compute_line_tax(None, None, False) == Decimal("0.00")

    def test_inclusive_zero_total(self):
        assert compute_line_tax(Decimal("0"), Decimal("0.10"), True) == Decimal("0.00")

    @pytest.mark.parametrize("rate", ["0.05", "0.09", "0.10"])
    def test_inclusive_never_exceeds_total(self, rate):
        tax = compute_line_tax(Decimal("10.00"), Decimal(rate), True)
        assert tax <= Decimal("10.00")
