from decimal import ROUND_HALF_UP, Decimal

TWO_PLACES = Decimal("0.01")


def compute_line_tax(line_total: Decimal, tax_rate: Decimal, price_includes_tax: bool) -> Decimal:
    """Compute tax for a single line.

    tax_rate is a fraction (e.g. 0.10 for 10%).
    Exclusive pricing: tax is added on top of line_total.
    Inclusive pricing: tax is extracted from line_total.
    """
    line_total = Decimal(line_total or 0)
    tax_rate = Decimal(tax_rate or 0)
    if price_includes_tax:
        if tax_rate <= 0:
            return Decimal("0.00")
        return (line_total - (line_total / (Decimal("1") + tax_rate))).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)
    return (line_total * tax_rate).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)
