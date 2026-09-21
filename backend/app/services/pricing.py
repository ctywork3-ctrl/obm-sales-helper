"""Money maths for sales orders: line pricing, discounts and tax allocation.

This is the single source of truth for order totals. The draft editor, the
API and the A4 print all read the numbers written here, so a discount typed
on a phone in the field shows up identically on the printed document.

Rules
-----
* Line discount: ``PERCENT`` (0-100) or ``AMOUNT`` (capped at the line gross).
* Order discount: same two modes, applied to the net subtotal *after* line
  discounts, capped at that subtotal.
* Tax is charged on the discounted amount, not the list price. The order
  discount is spread across lines pro-rata by net line value so per-line tax
  stays auditable (and so a fully discounted order still pays zero tax).
* Everything is quantised to 2 decimals with ROUND_HALF_UP, and the residual
  cent from the pro-rata split is parked on the largest line so that
  ``sum(line_tax)`` always equals the order tax exactly.
"""

from decimal import ROUND_HALF_UP, Decimal

from app.services.tax import compute_line_tax

TWO = Decimal("0.01")
ZERO = Decimal("0.00")
HUNDRED = Decimal("100")

DISCOUNT_TYPES = ("NONE", "PERCENT", "AMOUNT")


def money(value) -> Decimal:
    """Coerce anything numeric to a 2dp Decimal without float drift."""
    if value is None:
        value = 0
    return Decimal(str(value)).quantize(TWO, rounding=ROUND_HALF_UP)


def normalise_discount_type(discount_type: str | None) -> str:
    dtype = (discount_type or "NONE").strip().upper()
    return dtype if dtype in DISCOUNT_TYPES else "NONE"


def compute_discount(base, discount_type: str | None, discount_value) -> Decimal:
    """Discount amount for a base amount. Never negative, never above base."""
    base = money(base)
    dtype = normalise_discount_type(discount_type)
    value = Decimal(str(discount_value or 0))

    if dtype == "PERCENT":
        pct = min(max(value, ZERO), HUNDRED)
        return money(base * pct / HUNDRED)
    if dtype == "AMOUNT":
        return money(min(max(value, ZERO), base))
    return ZERO


def price_line(quantity, unit_price, discount_type="NONE", discount_value=0) -> dict:
    """Gross / discount / net for one line."""
    dtype = normalise_discount_type(discount_type)
    value = money(discount_value)
    gross = money(Decimal(str(quantity or 0)) * Decimal(str(unit_price or 0)))
    discount = compute_discount(gross, dtype, value)
    return {
        "gross": gross,
        "discount_type": dtype,
        "discount_value": value,
        "discount": discount,
        "net": money(gross - discount),
    }


def price_order(
    lines: list[dict],
    order_discount_type: str | None = "NONE",
    order_discount_value=0,
    tax_rate: Decimal = ZERO,
    price_includes_tax: bool = False,
) -> dict:
    """Price a whole order.

    ``lines`` is a list of dicts each carrying ``quantity``, ``unit_price``,
    ``discount_type`` and ``discount_value``. The returned ``lines`` list adds
    ``gross``, ``discount``, ``net``, ``taxable``, ``tax_amount`` and
    ``line_total`` (net + tax) to each entry, in the same order.
    """
    tax_rate = Decimal(str(tax_rate or 0))

    priced: list[dict] = []
    gross_subtotal = ZERO
    line_discount_total = ZERO

    for line in lines:
        p = price_line(
            line.get("quantity"),
            line.get("unit_price"),
            line.get("discount_type"),
            line.get("discount_value"),
        )
        priced.append({**line, **p})
        gross_subtotal += p["gross"]
        line_discount_total += p["discount"]

    gross_subtotal = money(gross_subtotal)
    line_discount_total = money(line_discount_total)
    subtotal = money(gross_subtotal - line_discount_total)

    order_discount = compute_discount(subtotal, order_discount_type, order_discount_value)
    taxable_base = money(subtotal - order_discount)

    # Spread the order discount pro-rata by net value.
    allocated = ZERO
    for index, line in enumerate(priced):
        if index == len(priced) - 1 or subtotal <= 0:
            share = money(taxable_base - allocated) if index == len(priced) - 1 else ZERO
        else:
            share = money(taxable_base * line["net"] / subtotal)
            share = min(share, money(taxable_base - allocated))
        line["order_discount_share"] = share
        line["taxable"] = share
        line["tax_amount"] = compute_line_tax(share, tax_rate, price_includes_tax)
        allocated += share

    tax_total = money(sum(line["tax_amount"] for line in priced))

    for line in priced:
        line["line_total"] = money(line["net"] + line["tax_amount"])

    return {
        "lines": priced,
        "gross_subtotal": gross_subtotal,
        "line_discount_total": line_discount_total,
        "subtotal": subtotal,
        "order_discount": order_discount,
        "discount_total": money(line_discount_total + order_discount),
        "taxable_base": taxable_base,
        "tax_total": tax_total,
        "total": money(taxable_base + tax_total),
    }


def discount_breakdown(priced: dict) -> list[dict]:
    """Human-readable rows for the A4 discount summary block."""
    rows: list[dict] = []
    for line in priced.get("lines", []):
        if line["discount"] > 0:
            rows.append({
                "product_name": line.get("product_name_snapshot") or line.get("product_name"),
                "product_code": line.get("product_code_snapshot") or line.get("product_code"),
                "quantity": line.get("quantity"),
                "gross": float(line["gross"]),
                "discount": float(line["discount"]),
                "net": float(line["net"]),
            })
    return rows
