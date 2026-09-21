"""Label printing configuration.

Two modes share one config:

* ``THERMAL`` — a dedicated label printer. The page size is the label itself
  (e.g. 50x30mm), one label per page.
* ``A4`` — a sheet of die-cut labels through the office printer, laid out on a
  grid (e.g. Avery L7159: 63.5x33.9mm, 3 columns x 8 rows).

Everything is in millimetres so it can be dialled in against real stock.

Deliberately NOT stored as flat settings fields: `Settings.tsx` unwraps one
level of JSON, so a nested object would render as "[object Object]".
"""

import json

DEFAULT_LABEL_CONFIG: dict = {
    "default_mode": "THERMAL",
    "symbology": "QR",          # QR | CODE128
    "qr_ecc": "M",              # L | M | Q | H
    "thermal": {
        "width_mm": 50.0,
        "height_mm": 30.0,
        "dpi": 203,
    },
    "a4": {
        "sheet": "A4",
        "cols": 3,
        "rows": 8,
        "label_width_mm": 63.5,
        "label_height_mm": 33.9,
        "margin_top_mm": 8.0,
        "margin_left_mm": 4.0,
        "gap_x_mm": 2.5,
        "gap_y_mm": 0.0,
    },
    # What actually gets printed on the sticker. The QR always carries the
    # serial; these control the human-readable text around it.
    "fields": {
        "product_name": True,
        "item_code": True,
        "warranty_months": True,
        "manufacturer_serial": True,
        "unit_code": True,
        "location": False,
    },
}

SYMBOLOGIES = ("QR", "CODE128")
QR_ECC_LEVELS = ("L", "M", "Q", "H")
MODES = ("THERMAL", "A4")
FIELD_KEYS = tuple(DEFAULT_LABEL_CONFIG["fields"].keys())


def _clamp(value, low: float, high: float, fallback: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return min(max(number, low), high)


def _clamp_int(value, low: int, high: int, fallback: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return fallback
    return min(max(number, low), high)


def normalise_label_config(config: dict | None) -> dict:
    """Coerce a client-supplied config into something safe to print.

    Out-of-range millimetres are clamped rather than rejected: a label that is
    slightly wrong is far better than a print button that refuses to work
    because someone typed 400 in a width field.
    """
    base = json.loads(json.dumps(DEFAULT_LABEL_CONFIG))  # deep copy
    if not isinstance(config, dict):
        return base

    mode = str(config.get("default_mode", base["default_mode"])).upper()
    base["default_mode"] = mode if mode in MODES else "THERMAL"

    symbology = str(config.get("symbology", base["symbology"])).upper()
    base["symbology"] = symbology if symbology in SYMBOLOGIES else "QR"

    ecc = str(config.get("qr_ecc", base["qr_ecc"])).upper()
    base["qr_ecc"] = ecc if ecc in QR_ECC_LEVELS else "M"

    thermal = config.get("thermal") or {}
    base["thermal"]["width_mm"] = _clamp(thermal.get("width_mm"), 10, 300, base["thermal"]["width_mm"])
    base["thermal"]["height_mm"] = _clamp(thermal.get("height_mm"), 10, 300, base["thermal"]["height_mm"])
    base["thermal"]["dpi"] = _clamp_int(thermal.get("dpi"), 72, 1200, base["thermal"]["dpi"])

    a4 = config.get("a4") or {}
    base["a4"]["sheet"] = str(a4.get("sheet", base["a4"]["sheet"])).upper()[:10]
    base["a4"]["cols"] = _clamp_int(a4.get("cols"), 1, 6, base["a4"]["cols"])
    base["a4"]["rows"] = _clamp_int(a4.get("rows"), 1, 12, base["a4"]["rows"])
    base["a4"]["label_width_mm"] = _clamp(a4.get("label_width_mm"), 10, 300, base["a4"]["label_width_mm"])
    base["a4"]["label_height_mm"] = _clamp(a4.get("label_height_mm"), 10, 300, base["a4"]["label_height_mm"])
    # Calibration offsets may legitimately be zero, so the floor is 0 not 5.
    base["a4"]["margin_top_mm"] = _clamp(a4.get("margin_top_mm"), 0, 60, base["a4"]["margin_top_mm"])
    base["a4"]["margin_left_mm"] = _clamp(a4.get("margin_left_mm"), 0, 60, base["a4"]["margin_left_mm"])
    base["a4"]["gap_x_mm"] = _clamp(a4.get("gap_x_mm"), 0, 20, base["a4"]["gap_x_mm"])
    base["a4"]["gap_y_mm"] = _clamp(a4.get("gap_y_mm"), 0, 20, base["a4"]["gap_y_mm"])

    fields = config.get("fields") or {}
    for key in FIELD_KEYS:
        if key in fields:
            base["fields"][key] = bool(fields[key])

    return base


def parse_label_config(config_json) -> dict:
    """Read the stored setting, which may be wrapped as {"value": {...}}."""
    if isinstance(config_json, dict) and "value" in config_json and isinstance(config_json["value"], dict):
        config_json = config_json["value"]
    if isinstance(config_json, str):
        try:
            config_json = json.loads(config_json)
        except (json.JSONDecodeError, TypeError):
            config_json = None
    if not isinstance(config_json, dict) or not config_json:
        return json.loads(json.dumps(DEFAULT_LABEL_CONFIG))
    return normalise_label_config(config_json)
