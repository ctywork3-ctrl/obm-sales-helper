"""Read purchase orders straight out of OBM's Firebird database.

Why this exists
---------------
The business raises purchase orders in OBM and was re-keying them here by hand.
The CSV importer solved that without knowing anything about OBM, but a CSV is a
manual export step every single time. This module reads the database OBM itself
writes, so "get the new POs" becomes one button.

How it talks to Firebird, and why this way
------------------------------------------
**Through the `isql.exe` that OBM already ships, not a Python driver.**

The only `fbclient.dll` on the machine is 32-bit (Firebird 2.5 lives in
`Program Files (x86)`, beside a 32-bit legacy application), and every Python
here is 64-bit. A driver would need a second, matching client installed and kept
in step. Driving the installed `isql` needs nothing new, and — the real point —
it keeps working when this moves to the tackle company's own OBM, whatever
Firebird build that turns out to be. OBM shops integrate this way routinely.

The cost is that `isql` mixes a banner ("Database: ... User: SYSDBA") and
"SQL> " prompts into stdout. That is handled by bracketing the real rows in
sentinel markers and keeping only what lies between them, then rejecting any
line whose column count is wrong. Prompt noise can never be mistaken for data.

READ-ONLY, BY CONSTRUCTION
--------------------------
Every statement this module builds is a SELECT. `_assert_read_only()` re-checks
the generated script for DML/DDL keywords before it is sent, so a future edit
that tries to write to OBM fails loudly here rather than corrupting the books of
a system that is the legal record for the business. OBM is the source of truth;
this app only ever reads it.
"""

from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass

# Sentinels. Chosen to be impossible as real data and cheap to search for.
BEGIN = "<<<OBM-BEGIN>>>"
END = "<<<OBM-END>>>"

# Tab separates cells: trivially split, and a tab inside an accounting
# description is vanishingly unlikely. If one ever appears, the column count for
# that row is wrong and the row is reported rather than silently mis-parsed.
SEP = "ASCII_CHAR(9)"

# Anything here in a generated script means a bug. Word-boundary matched so a
# column called UPDATED_AT does not trip it.
_FORBIDDEN = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|EXECUTE|MERGE|GRANT|REVOKE|"
    r"RECREATE|COMMIT|ROLLBACK)\b",
    re.IGNORECASE,
)


class ObmFirebirdError(RuntimeError):
    """Raised with a message a human can act on."""


@dataclass(frozen=True)
class ObmFirebirdConfig:
    """Where OBM's database is and how to log in to it."""

    isql_path: str
    database_path: str
    user: str = "SYSDBA"
    password: str = "masterkey"
    timeout: int = 90

    @property
    def configured(self) -> bool:
        return bool(self.isql_path and self.database_path)

    @classmethod
    def from_settings(cls) -> "ObmFirebirdConfig":
        from app.config import settings

        return cls(
            isql_path=settings.OBM_FIREBIRD_ISQL,
            database_path=settings.OBM_FIREBIRD_DATABASE,
            user=settings.OBM_FIREBIRD_USER,
            password=settings.OBM_FIREBIRD_PASSWORD,
            timeout=settings.OBM_FIREBIRD_TIMEOUT,
        )


def _assert_read_only(script: str) -> None:
    hit = _FORBIDDEN.search(script)
    if hit:
        raise ObmFirebirdError(
            f"Refusing to run: the generated script contains {hit.group(0)!r}. "
            "This module reads OBM; it must never write to it."
        )


def _run(config: ObmFirebirdConfig, script: str, *, expected_columns: int) -> list[list[str]]:
    """Run a SELECT-only script and return the rows between the sentinels.

    Raises ObmFirebirdError with something a human can act on - a missing isql,
    a missing database file, bad credentials and a timeout all read differently.
    """
    _assert_read_only(script)

    # isql needs an explicit terminator. Without it the next statement is read as
    # a continuation and the server answers "Token unknown - SELECT".
    script = script.strip()
    if not script.endswith(";"):
        script += ";"

    if not config.isql_path:
        raise ObmFirebirdError(
            "OBM_FIREBIRD_ISQL is not set, so there is no isql to run. "
            "Point it at the isql.exe inside the OBM installation."
        )
    if not config.database_path:
        raise ObmFirebirdError("OBM_FIREBIRD_DATABASE is not set.")

    if not os.path.exists(config.isql_path):
        raise ObmFirebirdError(f"isql not found at {config.isql_path!r}.")
    if not os.path.exists(config.database_path):
        raise ObmFirebirdError(
            f"OBM database not found at {config.database_path!r}. "
            "Check the path and that the file is reachable from this machine."
        )

    full = (
        "SET HEADING OFF;\nSET LIST OFF;\n"
        f"SELECT '{BEGIN}' FROM RDB$DATABASE;\n"
        f"{script}\n"
        f"SELECT '{END}' FROM RDB$DATABASE;\n"
    )

    try:
        result = subprocess.run(
            [
                config.isql_path,
                "-u", config.user,
                "-p", config.password,
                "-q",
                config.database_path,
            ],
            input=full,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=config.timeout,
        )
    except subprocess.TimeoutExpired:
        raise ObmFirebirdError(
            f"isql did not answer within {config.timeout}s. The database may be "
            "locked by a backup, or the file may be on a slow disk."
        )
    except OSError as exc:
        raise ObmFirebirdError(f"Could not start isql: {exc}")

    out = result.stdout or ""

    # isql reports SQL errors on stderr and still exits 0, so stderr is checked
    # rather than the return code.
    err = (result.stderr or "").strip()
    if err and "SQL>" not in err:
        raise ObmFirebirdError(_clean_isql_error(err))

    lines = out.splitlines()
    start = next((i for i, l in enumerate(lines) if BEGIN in l), None)
    stop = next((i for i, l in enumerate(lines) if END in l), None)
    if start is None or stop is None or stop < start:
        raise ObmFirebirdError(
            "isql did not return the expected markers, so the result cannot be "
            "trusted. Check the database path and credentials. Output began: "
            + out[:200].replace("\n", " ")
        )

    rows: list[list[str]] = []
    for raw in lines[start + 1 : stop]:
        if not raw.strip():
            continue
        cells = [c.strip() for c in raw.split("\t")]
        # Reject prompt noise and any row whose shape is wrong.
        if len(cells) != expected_columns:
            continue
        if cells[0].startswith("SQL>") or cells[0].startswith("CON>"):
            continue
        rows.append(cells)
    return rows


def _clean_isql_error(err: str) -> str:
    """Turn an isql error dump into one useful sentence."""
    flat = " ".join(err.split())
    if "Your user name and password are not defined" in flat or "not defined" in flat:
        return (
            "OBM refused the login. Check OBM_FIREBIRD_USER / "
            "OBM_FIREBIRD_PASSWORD (a stock OBM install uses SYSDBA / masterkey)."
        )
    if "unavailable database" in flat.lower():
        return "The database is unavailable - it may be locked by another process."
    return f"isql reported: {flat[:300]}"


# --------------------------------------------------------------------------
# Queries
# --------------------------------------------------------------------------

# The header. TRANSNO is OBM's own document number and becomes our
# external_reference, which is what makes re-imports update rather than
# duplicate. REQUIREDDATE is the date the business expects delivery.
#
# `{limit_clause}` and `{extra}` are filled by `read_purchase_order_headers`.
# They are placeholders rather than string splicing so the statement stays
# readable and cannot be broken by an edit to one half.
_HEADER_SQL = f"""
SELECT {{limit_clause}}
  CAST(po.PKEY AS VARCHAR(20)) || {SEP}
  || COALESCE(TRIM(po.TRANSNO), '') || {SEP}
  || COALESCE(CAST(CAST(po.TXDATE AS DATE) AS VARCHAR(20)), '') || {SEP}
  || COALESCE(CAST(po.VENDOR AS VARCHAR(20)), '') || {SEP}
  || COALESCE(TRIM(c.NAME), '') || {SEP}
  || COALESCE(TRIM(c.ACCTNO), '') || {SEP}
  || COALESCE(TRIM(po.REFERENCE), '') || {SEP}
  || COALESCE(TRIM(po.STATUS), '') || {SEP}
  || COALESCE(CAST(CAST(po.REQUIREDDATE AS DATE) AS VARCHAR(20)), '') || {SEP}
  || COALESCE(CAST(po.TOTALAMT AS VARCHAR(30)), '') || {SEP}
  || COALESCE(CAST(po.TAXPERCENT AS VARCHAR(20)), '')
FROM PURCHASEORDER po
LEFT JOIN CREDITOR c ON c.PKEY = po.VENDOR
WHERE COALESCE(TRIM(po.TRANSNO), '') <> ''
{{extra}}
ORDER BY po.PKEY DESC
"""

# The lines. QTYPROCESSED is what OBM has already received against the line,
# which is the number this app needs for its receiving tasks.
_LINES_SQL = f"""
SELECT
  CAST(i.FORKEY AS VARCHAR(20)) || {SEP}
  || COALESCE(TRIM(p.PRODUCTID), '') || {SEP}
  || COALESCE(TRIM(p.PRODUCTNAME), '') || {SEP}
  || COALESCE(CAST(i.QTY AS VARCHAR(30)), '') || {SEP}
  || COALESCE(CAST(i.UNITPRICE AS VARCHAR(30)), '') || {SEP}
  || COALESCE(CAST(i.QTYPROCESSED AS VARCHAR(30)), '')
FROM PURCHASEORDERITEM i
LEFT JOIN PRODUCT p ON p.PKEY = i.ITEMNO
WHERE i.FORKEY IN ({{keys}})
ORDER BY i.FORKEY, i.LINE
"""

# OBM status codes seen in real data. Documented rather than guessed at, and
# used only to decide what to skip by default - never to hide a document.
STATUS_CANCELLED = "C"


def _to_float(value: str) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _to_int(value: str) -> int | None:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


# Firebird has no "empty date": a NULL/0 date casts to its epoch, which comes
# back as 1899-12-30. Taken at face value that becomes a purchase order expected
# in 1899, which looks like a bug in this app rather than what it is - a blank
# field in OBM. Anything before this floor is treated as absent.
_DATE_FLOOR = "1900-01-01"


def _to_date(value: str) -> str | None:
    """Return an ISO date, or None for a blank/Firebird-zero date."""
    raw = (value or "").strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
        return None
    if raw < _DATE_FLOOR:
        return None
    return raw


def _clean_code(value: str) -> str | None:
    """Return a usable item code, or None.

    OBM writes a bare "-" (sometimes "--" or ".") on a line that has no product
    behind it - an expense or allocation row. Treated literally that becomes a
    product code of "-", which matches nothing and turns a real purchase order
    into a wall of "could not match this line" warnings.
    """
    raw = (value or "").strip()
    if not raw:
        return None
    if set(raw) <= {"-", ".", "_", "*"}:
        return None
    return raw


def test_connection(config: ObmFirebirdConfig) -> dict:
    """Check the OBM link and say what was found. Never raises for a bad link."""
    if not config.configured:
        return {
            "connected": False,
            "configured": False,
            "message": (
                "OBM is not configured. Set OBM_FIREBIRD_ISQL and "
                "OBM_FIREBIRD_DATABASE to point at the OBM installation."
            ),
        }
    try:
        rows = _run(
            config,
            "SELECT TRIM(rdb$get_context('SYSTEM','ENGINE_VERSION')) FROM RDB$DATABASE;",
            expected_columns=1,
        )
        version = rows[0][0] if rows else "unknown"
        count = _run(config, "SELECT COUNT(*) FROM PURCHASEORDER;", expected_columns=1)
        total = count[0][0] if count else "0"
        return {
            "connected": True,
            "configured": True,
            "engine_version": version,
            "purchase_order_count": _to_int(total) or 0,
            "message": f"Connected to OBM (Firebird {version}); {total} purchase order(s) on file.",
        }
    except ObmFirebirdError as exc:
        return {"connected": False, "configured": True, "message": str(exc)}


def read_purchase_order_headers(
    config: ObmFirebirdConfig,
    *,
    limit: int = 200,
    since: str | None = None,
    include_cancelled: bool = False,
) -> list[dict]:
    """Recent OBM purchase-order headers, newest first.

    `since` is an ISO date (YYYY-MM-DD) and filters on OBM's document date.
    """
    conditions = []
    if since:
        # `since` is validated to a strict date shape; reject anything else
        # rather than interpolate free text into SQL.
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", since):
            raise ObmFirebirdError(f"since must be YYYY-MM-DD, got {since!r}")
        conditions.append(f"AND po.TXDATE >= '{since}'")
    if not include_cancelled:
        conditions.append(f"AND COALESCE(TRIM(po.STATUS), '') <> '{STATUS_CANCELLED}'")

    safe_limit = max(1, min(int(limit), 2000))
    sql = _HEADER_SQL.format(
        limit_clause=f"FIRST {safe_limit}",
        extra="\n".join(conditions),
    )

    rows = _run(config, sql, expected_columns=11)
    out = []
    for (
        pkey, transno, txdate, vendor_id, vendor_name, vendor_code,
        reference, status, required, total, tax,
    ) in rows:
        out.append({
            "obm_pkey": _to_int(pkey),
            "external_reference": transno,
            "document_date": _to_date(txdate),
            "supplier_name": vendor_name or None,
            "supplier_code": vendor_code or None,
            "obm_vendor_id": _to_int(vendor_id),
            "reference": reference or None,
            "obm_status": status or None,
            "expected_date": _to_date(required),
            "total": _to_float(total),
            "tax_percent": _to_float(tax),
        })
    return out


def read_purchase_order_lines(
    config: ObmFirebirdConfig, pkeys: list[int]
) -> dict[int, list[dict]]:
    """Lines for the given OBM header keys, grouped by header key."""
    clean = sorted({int(k) for k in pkeys if str(k).strip().lstrip("-").isdigit()})
    if not clean:
        return {}
    keys = ", ".join(str(k) for k in clean)
    rows = _run(config, _LINES_SQL.format(keys=keys), expected_columns=6)

    grouped: dict[int, list[dict]] = {}
    for forkey, item_code, item_name, qty, price, processed in rows:
        key = _to_int(forkey)
        if key is None:
            continue
        grouped.setdefault(key, []).append({
            "item_code": _clean_code(item_code),
            "name": item_name or None,
            "quantity": _to_int(qty) or 0,
            "unit_cost": _to_float(price),
            "quantity_processed": _to_float(processed) or 0.0,
        })
    return grouped


def read_purchase_orders(
    config: ObmFirebirdConfig,
    *,
    limit: int = 200,
    since: str | None = None,
    include_cancelled: bool = False,
) -> dict:
    """Read OBM purchase orders into the `import_purchase_orders()` contract.

    Returns `{"orders": [...], "skipped": [...], "counts": {...}}`.

    Each line additionally carries `quantity_processed` - OBM's own record of how
    much of that line has already been received. It is not part of the original
    import contract, so callers that do not know about it ignore it harmlessly;
    the importer records it beside our own received quantity rather than merging
    the two.

    An order whose every line was dropped (a services-only PO, say) is reported
    in `skipped` by name rather than vanishing - the same rule the CSV parser
    follows, for the same reason: a purchase order that is invisible is a bug.
    """
    headers = read_purchase_order_headers(
        config, limit=limit, since=since, include_cancelled=include_cancelled
    )
    if not headers:
        return {"orders": [], "skipped": [], "counts": {"headers": 0, "importable": 0}}

    keys = [h["obm_pkey"] for h in headers if h["obm_pkey"] is not None]
    lines_by_key = read_purchase_order_lines(config, keys)

    orders = []
    skipped = []
    for header in headers:
        lines = lines_by_key.get(header["obm_pkey"] or -1, [])
        usable = [l for l in lines if l["quantity"] and l["quantity"] > 0 and l["item_code"]]

        notes_bits = []
        if header["reference"]:
            notes_bits.append(f"OBM ref {header['reference']}")
        if header["obm_status"]:
            notes_bits.append(f"OBM status {header['obm_status']}")
        if header["document_date"]:
            notes_bits.append(f"OBM date {header['document_date']}")

        if not usable:
            skipped.append({
                "reference": header["external_reference"],
                "reason": (
                    "no usable lines - every line was a zero-quantity or "
                    "expense line"
                ),
                "line_count": len(lines),
            })
            continue

        orders.append({
            "external_reference": header["external_reference"],
            "supplier_name": header["supplier_name"] or "Unknown supplier",
            "expected_date": header["expected_date"],
            "notes": " · ".join(notes_bits) or None,
            "lines": [
                {
                    "item_code": l["item_code"],
                    "name": l["name"],
                    "quantity": l["quantity"],
                    "unit_cost": l["unit_cost"],
                    # OBM's own "already received" figure. Carried through so the
                    # importer can record it beside our own received quantity;
                    # dropping it here is how a half-delivered PO ends up looking
                    # fully outstanding.
                    "quantity_processed": l["quantity_processed"],
                }
                for l in usable
            ],
        })

    return {
        "orders": orders,
        "skipped": skipped,
        "counts": {
            "headers": len(headers),
            "importable": len(orders),
            "skipped": len(skipped),
        },
    }
