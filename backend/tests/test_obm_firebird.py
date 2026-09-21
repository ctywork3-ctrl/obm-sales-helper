"""Rules for reading OBM's Firebird database.

No Firebird and no OBM installation is needed: `subprocess.run` is stubbed and
fed the exact shape of output isql produces, including its banner and "SQL>"
prompt noise. That noise is the whole reason the parsing is non-trivial, so the
tests reproduce it rather than pretending stdout is clean.

The rules worth pinning, in rough order of how expensive they are to get wrong:

* the module can never write to OBM (it is the legal record of the business),
* a Firebird zero date does not become a purchase order expected in 1899,
* prompt noise never becomes a row,
* a PO whose every line is dropped is named, not silently lost.
"""

import subprocess

import pytest

from app.services.obm_firebird import (
    BEGIN,
    END,
    ObmFirebirdConfig,
    ObmFirebirdError,
    _assert_read_only,
    _to_date,
    read_purchase_order_headers,
    read_purchase_orders,
)

# Aliased on purpose: pytest collects any module-level name beginning with
# "test_", so importing `test_connection` unaliased makes pytest treat the
# production function as a test case and run it.
from app.services.obm_firebird import test_connection as obm_test_connection


@pytest.fixture
def config(tmp_path, monkeypatch):
    """A config whose isql and database paths exist, so the file checks pass."""
    isql = tmp_path / "isql.exe"
    isql.write_text("stub")
    database = tmp_path / "obm.fdb"
    database.write_text("stub")
    return ObmFirebirdConfig(
        isql_path=str(isql), database_path=str(database), user="SYSDBA", password="masterkey"
    )


def fake_isql(rows: list[list[str]], *, banner: bool = True):
    """Build a subprocess.run replacement that emits isql-shaped output.

    Reproduces the banner and the interleaved prompts that make naive parsing
    fail, because that is what real isql prints when fed a script on stdin.

    The returned function carries a `.calls` list of the scripts it was given,
    so a test can assert on the SQL that was actually sent.
    """
    body = "\n".join("\t".join(r) for r in rows)

    def _run(*args, **_kwargs):
        calls.append(_kwargs.get("input") or (args[0] if args else ""))
        parts = []
        if banner:
            parts.append("Database:  C:\\OBMSB\\Data\\OBM.FDB, User: SYSDBA")
        parts.append(f"SQL> SQL> SQL> \n{BEGIN} \n")
        parts.append("SQL> CON> CON> \n")
        parts.append(body)
        parts.append(f"\nSQL> \n{END} \n")
        return subprocess.CompletedProcess(
            args=[], returncode=0, stdout="\n".join(parts), stderr=""
        )

    calls: list[str] = []
    _run.calls = calls
    return _run


HEADER_COLUMNS = 11
LINE_COLUMNS = 6


def header_row(pkey, transno, date, vendor, name, acct, ref, status, req, total, tax="0"):
    return [str(pkey), transno, date, str(vendor), name, acct, ref, status, req, total, tax]


# --------------------------------------------------------------------------
# It must never write to OBM
# --------------------------------------------------------------------------

@pytest.mark.parametrize("statement", [
    "UPDATE PURCHASEORDER SET STATUS = 'X'",
    "DELETE FROM CREDITOR",
    "DROP TABLE PRODUCT",
    "INSERT INTO CREDITOR (NAME) VALUES ('x')",
    "ALTER TABLE STOCK ADD COLUMN X INTEGER",
    "MERGE INTO A USING B ON 1=1",
    "EXECUTE PROCEDURE DO_SOMETHING",
    "GRANT ALL ON X TO Y",
])
def test_writing_statements_are_refused(statement):
    """OBM is the source of truth; this app only ever reads it."""
    with pytest.raises(ObmFirebirdError):
        _assert_read_only(statement)


def test_a_select_is_allowed():
    _assert_read_only("SELECT TRANSNO FROM PURCHASEORDER WHERE PKEY = 1")


def test_a_column_merely_containing_a_keyword_is_allowed():
    """Word boundaries matter: UPDATED_AT is a column, not an UPDATE."""
    _assert_read_only("SELECT UPDATED_AT, CREATED_AT FROM PURCHASEORDER")


def test_a_write_never_reaches_the_subprocess(config, monkeypatch):
    called = {"n": 0}

    def _explode(*_a, **_k):
        called["n"] += 1
        raise AssertionError("subprocess must not be reached")

    monkeypatch.setattr(subprocess, "run", _explode)
    with pytest.raises(ObmFirebirdError):
        from app.services.obm_firebird import _run

        _run(config, "DELETE FROM PURCHASEORDER", expected_columns=1)
    assert called["n"] == 0


# --------------------------------------------------------------------------
# Firebird's zero date
# --------------------------------------------------------------------------

def test_firebird_zero_date_is_not_a_date():
    """A blank REQUIREDDATE casts to 1899-12-30. Importing that gives a PO
    expected in 1899, which reads as a bug in this app."""
    assert _to_date("1899-12-30") is None
    assert _to_date("1858-11-17") is None


def test_a_real_date_survives():
    assert _to_date("2026-10-15") == "2026-10-15"
    assert _to_date("1900-01-01") == "1900-01-01"


def test_blank_and_junk_dates_are_none():
    assert _to_date("") is None
    assert _to_date("not a date") is None
    assert _to_date("15/10/2026") is None


# --------------------------------------------------------------------------
# Parsing isql output
# --------------------------------------------------------------------------

def test_prompt_noise_is_never_mistaken_for_data(config, monkeypatch):
    rows = [
        header_row(9, "PO26/01/001", "2026-01-05", 21, "ACME TACKLE", "400-A001", "", "N", "1899-12-30", "1000"),
    ]
    monkeypatch.setattr(subprocess, "run", fake_isql(rows))
    out = read_purchase_order_headers(config, limit=5)
    assert len(out) == 1
    assert out[0]["external_reference"] == "PO26/01/001"


def test_a_row_with_the_wrong_column_count_is_dropped(config, monkeypatch):
    """A tab inside a description would shift the columns; better to drop the
    row than to silently mis-assign a quantity to a price."""
    rows = [
        header_row(9, "PO26/01/001", "2026-01-05", 21, "GOOD", "400-A", "", "N", "1899-12-30", "1"),
        ["7", "BROKEN", "row with too few"],
    ]
    monkeypatch.setattr(subprocess, "run", fake_isql(rows))
    out = read_purchase_order_headers(config, limit=5)
    assert len(out) == 1


def test_missing_sentinels_is_an_error_not_a_silent_empty(config, monkeypatch):
    def _run(*_a, **_k):
        return subprocess.CompletedProcess(
            args=[], returncode=0, stdout="Database: x\nSQL> nothing useful", stderr=""
        )

    monkeypatch.setattr(subprocess, "run", _run)
    with pytest.raises(ObmFirebirdError):
        read_purchase_order_headers(config, limit=5)


def test_bad_credentials_produce_an_actionable_message(config, monkeypatch):
    def _run(*_a, **_k):
        return subprocess.CompletedProcess(
            args=[], returncode=0, stdout="",
            stderr="Your user name and password are not defined.",
        )

    monkeypatch.setattr(subprocess, "run", _run)
    with pytest.raises(ObmFirebirdError) as excinfo:
        read_purchase_order_headers(config, limit=5)
    assert "OBM_FIREBIRD_USER" in str(excinfo.value)


def test_a_timeout_says_so(config, monkeypatch):
    def _run(*_a, **_k):
        raise subprocess.TimeoutExpired(cmd="isql", timeout=90)

    monkeypatch.setattr(subprocess, "run", _run)
    with pytest.raises(ObmFirebirdError) as excinfo:
        read_purchase_order_headers(config, limit=5)
    assert "did not answer" in str(excinfo.value)


def test_missing_isql_says_so(tmp_path):
    config = ObmFirebirdConfig(
        isql_path=str(tmp_path / "nope.exe"), database_path=str(tmp_path / "nope.fdb")
    )
    with pytest.raises(ObmFirebirdError) as excinfo:
        read_purchase_order_headers(config, limit=5)
    assert "isql not found" in str(excinfo.value)


def test_missing_database_says_so(tmp_path):
    isql = tmp_path / "isql.exe"
    isql.write_text("stub")
    config = ObmFirebirdConfig(
        isql_path=str(isql), database_path=str(tmp_path / "gone.fdb")
    )
    with pytest.raises(ObmFirebirdError) as excinfo:
        read_purchase_order_headers(config, limit=5)
    assert "database not found" in str(excinfo.value).lower()


def test_since_must_be_a_date_not_free_text(config, monkeypatch):
    """Anything reaching the SQL is validated first."""
    monkeypatch.setattr(subprocess, "run", fake_isql([]))
    with pytest.raises(ObmFirebirdError):
        read_purchase_order_headers(config, limit=5, since="2026-01-01'; DROP TABLE X; --")


# --------------------------------------------------------------------------
# Mapping into the import contract
# --------------------------------------------------------------------------

def _two_query_isql(header_rows, line_rows):
    """isql is called twice: headers, then lines. Answer in order."""
    calls = {"n": 0}

    def _run(*_a, **_k):
        calls["n"] += 1
        rows = header_rows if calls["n"] == 1 else line_rows
        body = "\n".join("\t".join(r) for r in rows)
        out = f"Database: x\n{BEGIN}\n{body}\n{END}\n"
        return subprocess.CompletedProcess(args=[], returncode=0, stdout=out, stderr="")

    return _run


def test_orders_map_into_the_import_contract(config, monkeypatch):
    headers = [
        header_row(9, "PO26/01/001", "2026-01-05", 21, "ACME TACKLE", "400-A001",
                   "SUP-REF-1", "N", "2026-02-01", "1000"),
    ]
    lines = [
        ["9", "R001", "Stingray Rod 100M", "4", "88.5", "0"],
        ["9", "R002", "Stingray Rod 200M", "3", "1250", "0"],
    ]
    monkeypatch.setattr(subprocess, "run", _two_query_isql(headers, lines))

    result = read_purchase_orders(config, limit=10)
    assert result["counts"] == {"headers": 1, "importable": 1, "skipped": 0}

    order = result["orders"][0]
    # These keys are the contract `import_purchase_orders()` documents.
    assert set(order) == {
        "external_reference", "supplier_name", "expected_date", "notes", "lines"
    }
    assert order["external_reference"] == "PO26/01/001"
    assert order["supplier_name"] == "ACME TACKLE"
    assert order["expected_date"] == "2026-02-01"
    assert len(order["lines"]) == 2
    assert order["lines"][0] == {
        "item_code": "R001",
        "name": "Stingray Rod 100M",
        "quantity": 4,
        "unit_cost": 88.5,
        # OBM's own "already received" figure travels with the line so the
        # importer can record it beside our own quantity.
        "quantity_processed": 0.0,
    }


def test_the_obm_reference_and_status_are_kept_in_the_notes(config, monkeypatch):
    """A PO that came from OBM should say so on its face, so nobody wonders why
    a draft appeared they did not type."""
    headers = [
        header_row(9, "PO26/01/001", "2026-01-05", 21, "ACME", "400-A", "SUPREF", "N",
                   "1899-12-30", "10"),
    ]
    lines = [["9", "R001", "Rod", "1", "10", "0"]]
    monkeypatch.setattr(subprocess, "run", _two_query_isql(headers, lines))

    notes = read_purchase_orders(config, limit=10)["orders"][0]["notes"]
    assert "SUPREF" in notes
    assert "status N" in notes
    assert "2026-01-05" in notes


def test_zero_quantity_lines_are_dropped(config, monkeypatch):
    """OBM carries expense-allocation rows at quantity zero. Importing them as
    real lines would invent demand for stock nobody ordered."""
    headers = [
        header_row(9, "PO26/01/001", "2026-01-05", 21, "ACME", "400-A", "", "N",
                   "1899-12-30", "10"),
    ]
    lines = [
        ["9", "R001", "Rod", "4", "88.5", "0"],
        ["9", "LAUNDRY", "LAUNDRY", "0", "0", "0"],
        ["9", "SALES", "SALES", "0", "0", "0"],
    ]
    monkeypatch.setattr(subprocess, "run", _two_query_isql(headers, lines))

    order = read_purchase_orders(config, limit=10)["orders"][0]
    assert len(order["lines"]) == 1
    assert order["lines"][0]["item_code"] == "R001"


def test_an_order_with_no_usable_lines_is_named_not_lost(config, monkeypatch):
    """A services-only PO is real in OBM but has nothing to receive. It is
    reported by name so the user is not left wondering where it went."""
    headers = [
        header_row(9, "PO26/01/002", "2026-01-05", 21, "HOTEL SUPPLIES", "400-B", "", "N",
                   "1899-12-30", "500"),
    ]
    lines = [["9", "HOTEL EXPENSES", "HOTEL EXPENSES", "0", "0", "0"]]
    monkeypatch.setattr(subprocess, "run", _two_query_isql(headers, lines))

    result = read_purchase_orders(config, limit=10)
    assert result["orders"] == []
    assert len(result["skipped"]) == 1
    assert result["skipped"][0]["reference"] == "PO26/01/002"
    assert "no usable lines" in result["skipped"][0]["reason"]


def test_a_line_without_an_item_code_is_not_importable(config, monkeypatch):
    """OBM writes a bare '-' for a line with no product behind it."""
    headers = [
        header_row(9, "PO26/01/003", "2026-01-05", 21, "ACME", "400-A", "", "N",
                   "1899-12-30", "140"),
    ]
    lines = [["9", "-", "-", "2", "140", "0"]]
    monkeypatch.setattr(subprocess, "run", _two_query_isql(headers, lines))

    result = read_purchase_orders(config, limit=10)
    assert result["orders"] == []
    assert result["skipped"][0]["reference"] == "PO26/01/003"


def test_cancelled_pos_are_excluded_by_default(config, monkeypatch):
    headers = [
        header_row(9, "PO26/01/001", "2026-01-05", 21, "ACME", "400-A", "", "N",
                   "1899-12-30", "10"),
    ]
    stub = fake_isql(headers)
    monkeypatch.setattr(subprocess, "run", stub)
    read_purchase_order_headers(config, limit=5)
    # The generated SQL must carry the status filter...
    assert "STATUS" in stub.calls[0] and "'C'" in stub.calls[0]


def test_include_cancelled_drops_the_status_filter(config, monkeypatch):
    headers = [
        header_row(9, "PO26/01/001", "2026-01-05", 21, "ACME", "400-A", "", "C",
                   "1899-12-30", "10"),
    ]
    stub = fake_isql(headers)
    monkeypatch.setattr(subprocess, "run", stub)
    out = read_purchase_order_headers(config, limit=5, include_cancelled=True)
    assert "<> 'C'" not in stub.calls[0]
    assert out[0]["obm_status"] == "C"


# --------------------------------------------------------------------------
# test_connection
# --------------------------------------------------------------------------

def test_unconfigured_reports_plainly():
    result = obm_test_connection(ObmFirebirdConfig(isql_path="", database_path=""))
    assert result["connected"] is False
    assert result["configured"] is False
    assert "not configured" in result["message"]


def test_a_broken_link_reports_instead_of_raising(config, monkeypatch):
    """The settings screen calls this; a bad path must render, not 500."""
    def _run(*_a, **_k):
        return subprocess.CompletedProcess(
            args=[], returncode=0, stdout="", stderr="unavailable database"
        )

    monkeypatch.setattr(subprocess, "run", _run)
    result = obm_test_connection(config)
    assert result["connected"] is False
    assert result["configured"] is True
    assert result["message"]


def test_a_good_link_reports_the_version_and_count(config, monkeypatch):
    calls = {"n": 0}

    def _run(*_a, **_k):
        calls["n"] += 1
        value = "2.5.6" if calls["n"] == 1 else "12"
        out = f"Database: x\n{BEGIN}\n{value}\n{END}\n"
        return subprocess.CompletedProcess(args=[], returncode=0, stdout=out, stderr="")

    monkeypatch.setattr(subprocess, "run", _run)
    result = obm_test_connection(config)
    assert result["connected"] is True
    assert result["engine_version"] == "2.5.6"
    assert result["purchase_order_count"] == 12
