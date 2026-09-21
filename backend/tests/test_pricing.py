"""Unit tests for the sales-order pricing/discount engine.

These lock down the money maths, because a discount bug is the kind of thing
that silently costs real money and nobody notices until the month-end report
disagrees with the bank.
"""

from decimal import Decimal

import pytest

from app.services.pricing import (
    compute_discount,
    money,
    normalise_discount_type,
    price_line,
    price_order,
)
from app.services.tax import compute_line_tax


class TestMoney:
    def test_quantises_to_two_places_half_up(self):
        assert money("1.005") == Decimal("1.01")
        assert money("1.004") == Decimal("1.00")

    def test_none_is_zero(self):
        assert money(None) == Decimal("0.00")

    def test_no_float_drift(self):
        # 0.1 + 0.2 in float is 0.30000000000000004
        assert money(Decimal("0.1") + Decimal("0.2")) == Decimal("0.30")


class TestNormaliseDiscountType:
    @pytest.mark.parametrize("raw,expected", [
        (None, "NONE"),
        ("", "NONE"),
        ("percent", "PERCENT"),
        ("Amount", "AMOUNT"),
        ("nonsense", "NONE"),
    ])
    def test_normalises(self, raw, expected):
        assert normalise_discount_type(raw) == expected


class TestComputeDiscount:
    def test_percent(self):
        assert compute_discount(400, "PERCENT", 10) == Decimal("40.00")

    def test_percent_cannot_exceed_one_hundred(self):
        assert compute_discount(400, "PERCENT", 150) == Decimal("400.00")

    def test_percent_cannot_be_negative(self):
        assert compute_discount(400, "PERCENT", -5) == Decimal("0.00")

    def test_amount(self):
        assert compute_discount(400, "AMOUNT", 25) == Decimal("25.00")

    def test_amount_is_capped_at_the_base(self):
        # A RM 500 discount on a RM 400 line must not make the line negative.
        assert compute_discount(400, "AMOUNT", 500) == Decimal("400.00")

    def test_amount_cannot_be_negative(self):
        assert compute_discount(400, "AMOUNT", -10) == Decimal("0.00")

    def test_none_gives_nothing(self):
        assert compute_discount(400, "NONE", 50) == Decimal("0.00")

    def test_zero_base_gives_nothing(self):
        assert compute_discount(0, "PERCENT", 10) == Decimal("0.00")


class TestPriceLine:
    def test_line_with_percent_discount(self):
        result = price_line(2, 200, "PERCENT", 10)
        assert result["gross"] == Decimal("400.00")
        assert result["discount"] == Decimal("40.00")
        assert result["net"] == Decimal("360.00")

    def test_line_with_amount_discount(self):
        result = price_line(1, 100, "AMOUNT", 20)
        assert result["gross"] == Decimal("100.00")
        assert result["discount"] == Decimal("20.00")
        assert result["net"] == Decimal("80.00")

    def test_echoes_normalised_type_and_value(self):
        result = price_line(1, 100, "percent", 5)
        assert result["discount_type"] == "PERCENT"
        assert result["discount_value"] == Decimal("5.00")

    def test_line_total_never_negative(self):
        result = price_line(1, 50, "AMOUNT", 999)
        assert result["net"] == Decimal("0.00")


class TestPriceOrder:
    def test_worked_example(self):
        """Two lines, line discounts, then a 5% order discount."""
        result = price_order(
            [
                {"quantity": 2, "unit_price": 200, "discount_type": "PERCENT", "discount_value": 10},
                {"quantity": 1, "unit_price": 100, "discount_type": "AMOUNT", "discount_value": 20},
            ],
            order_discount_type="PERCENT",
            order_discount_value=5,
        )
        assert result["gross_subtotal"] == Decimal("500.00")
        assert result["line_discount_total"] == Decimal("60.00")
        assert result["subtotal"] == Decimal("440.00")
        assert result["order_discount"] == Decimal("22.00")
        assert result["discount_total"] == Decimal("82.00")
        assert result["total"] == Decimal("418.00")

    def test_order_discount_is_capped_at_the_net_subtotal(self):
        result = price_order(
            [{"quantity": 1, "unit_price": 100, "discount_type": "NONE", "discount_value": 0}],
            order_discount_type="AMOUNT",
            order_discount_value=500,
        )
        assert result["order_discount"] == Decimal("100.00")
        assert result["total"] == Decimal("0.00")

    def test_tax_is_charged_on_the_discounted_amount(self):
        # 100 gross, 10% line discount -> 90 taxable, 10% tax -> 9 tax, 99 total
        result = price_order(
            [{"quantity": 1, "unit_price": 100, "discount_type": "PERCENT", "discount_value": 10}],
            tax_rate=Decimal("0.10"),
        )
        assert result["taxable_base"] == Decimal("90.00")
        assert result["tax_total"] == Decimal("9.00")
        assert result["total"] == Decimal("99.00")

    def test_fully_discounted_order_pays_no_tax(self):
        result = price_order(
            [{"quantity": 1, "unit_price": 100, "discount_type": "PERCENT", "discount_value": 100}],
            tax_rate=Decimal("0.10"),
        )
        assert result["taxable_base"] == Decimal("0.00")
        assert result["tax_total"] == Decimal("0.00")
        assert result["total"] == Decimal("0.00")

    def test_line_tax_always_sums_to_order_tax(self):
        """The pro-rata split must not lose or invent cents."""
        lines = [
            {"quantity": 3, "unit_price": 33.33, "discount_type": "NONE", "discount_value": 0},
            {"quantity": 1, "unit_price": 10.01, "discount_type": "PERCENT", "discount_value": 7},
            {"quantity": 7, "unit_price": 1.11, "discount_type": "AMOUNT", "discount_value": 0.5},
        ]
        result = price_order(lines, order_discount_type="PERCENT", order_discount_value=3.5,
                             tax_rate=Decimal("0.06"))
        line_tax_sum = sum(line["tax_amount"] for line in result["lines"])
        assert line_tax_sum == result["tax_total"]

    def test_order_discount_shares_sum_to_the_taxable_base(self):
        lines = [
            {"quantity": 1, "unit_price": 33.33, "discount_type": "NONE", "discount_value": 0},
            {"quantity": 2, "unit_price": 16.67, "discount_type": "NONE", "discount_value": 0},
            {"quantity": 5, "unit_price": 3.33, "discount_type": "NONE", "discount_value": 0},
        ]
        result = price_order(lines, order_discount_type="PERCENT", order_discount_value=7.77)
        share_sum = sum(line["order_discount_share"] for line in result["lines"])
        assert share_sum == result["taxable_base"]

    def test_empty_order_is_all_zero(self):
        result = price_order([])
        assert result["gross_subtotal"] == Decimal("0.00")
        assert result["total"] == Decimal("0.00")

    def test_line_total_is_net_plus_tax(self):
        result = price_order(
            [{"quantity": 1, "unit_price": 100, "discount_type": "NONE", "discount_value": 0}],
            tax_rate=Decimal("0.10"),
        )
        line = result["lines"][0]
        assert line["line_total"] == money(line["net"] + line["tax_amount"])


class TestInclusiveTax:
    def test_tax_is_extracted_from_an_inclusive_price(self):
        # RM 110 inclusive of 10% tax -> 10 tax, 100 net
        assert compute_line_tax(Decimal("110.00"), Decimal("0.10"), True) == Decimal("10.00")

    def test_zero_rate_inclusive_is_zero(self):
        assert compute_line_tax(Decimal("110.00"), Decimal("0"), True) == Decimal("0.00")

    def test_exclusive_tax_is_added_on_top(self):
        assert compute_line_tax(Decimal("100.00"), Decimal("0.10"), False) == Decimal("10.00")
