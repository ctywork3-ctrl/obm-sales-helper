"""Unit tests for label print configuration.

The config comes from a settings row a human can edit, so the normaliser is the
thing standing between a typo and a print job that produces nothing.
"""

from app.services.labels import (
    DEFAULT_LABEL_CONFIG,
    FIELD_KEYS,
    normalise_label_config,
    parse_label_config,
)


class TestDefaults:
    def test_returns_a_deep_copy(self):
        first = normalise_label_config(None)
        first["thermal"]["width_mm"] = 999
        assert DEFAULT_LABEL_CONFIG["thermal"]["width_mm"] == 50

    def test_default_label_is_50x30mm(self):
        config = normalise_label_config(None)
        assert config["thermal"]["width_mm"] == 50
        assert config["thermal"]["height_mm"] == 30

    def test_default_symbology_is_qr(self):
        assert normalise_label_config(None)["symbology"] == "QR"

    def test_a4_defaults_match_avery_l7159(self):
        config = normalise_label_config(None)
        assert config["a4"]["cols"] == 3
        assert config["a4"]["rows"] == 8
        assert config["a4"]["label_width_mm"] == 63.5

    def test_every_field_key_has_a_default(self):
        assert set(FIELD_KEYS) == set(DEFAULT_LABEL_CONFIG["fields"].keys())


class TestClamping:
    def test_width_is_clamped_not_rejected(self):
        # A slightly wrong label beats a print button that refuses to work.
        config = normalise_label_config({"thermal": {"width_mm": 9999}})
        assert config["thermal"]["width_mm"] == 300

    def test_width_floor(self):
        config = normalise_label_config({"thermal": {"width_mm": 1}})
        assert config["thermal"]["width_mm"] == 10

    def test_garbage_numbers_fall_back_to_default(self):
        config = normalise_label_config({"thermal": {"width_mm": "wide please"}})
        assert config["thermal"]["width_mm"] == 50

    def test_zero_margin_is_allowed(self):
        # Calibration offsets may legitimately be zero; the A4 path floors at
        # 5mm but a label printer has no unprintable margin.
        config = normalise_label_config({"a4": {"margin_top_mm": 0, "margin_left_mm": 0}})
        assert config["a4"]["margin_top_mm"] == 0
        assert config["a4"]["margin_left_mm"] == 0

    def test_columns_and_rows_are_clamped(self):
        config = normalise_label_config({"a4": {"cols": 99, "rows": 0}})
        assert config["a4"]["cols"] == 6
        assert config["a4"]["rows"] == 1


class TestEnumValidation:
    def test_unknown_symbology_falls_back(self):
        assert normalise_label_config({"symbology": "aztec"})["symbology"] == "QR"

    def test_symbology_is_case_insensitive(self):
        assert normalise_label_config({"symbology": "code128"})["symbology"] == "CODE128"

    def test_unknown_ecc_falls_back(self):
        assert normalise_label_config({"qr_ecc": "Z"})["qr_ecc"] == "M"

    def test_unknown_mode_falls_back(self):
        assert normalise_label_config({"default_mode": "laser"})["default_mode"] == "THERMAL"


class TestFields:
    def test_field_toggles_are_respected(self):
        config = normalise_label_config({"fields": {"location": True, "unit_code": False}})
        assert config["fields"]["location"] is True
        assert config["fields"]["unit_code"] is False

    def test_unspecified_fields_keep_their_default(self):
        config = normalise_label_config({"fields": {"location": True}})
        assert config["fields"]["product_name"] is True

    def test_values_are_coerced_to_boolean(self):
        config = normalise_label_config({"fields": {"location": 1}})
        assert config["fields"]["location"] is True


class TestParseStoredSetting:
    def test_unwraps_the_value_wrapper(self):
        stored = {"value": {"symbology": "CODE128"}}
        assert parse_label_config(stored)["symbology"] == "CODE128"

    def test_accepts_a_bare_dict(self):
        assert parse_label_config({"symbology": "CODE128"})["symbology"] == "CODE128"

    def test_accepts_a_json_string(self):
        assert parse_label_config('{"symbology": "CODE128"}')["symbology"] == "CODE128"

    def test_empty_value_returns_defaults(self):
        assert parse_label_config({"value": {}})["symbology"] == "QR"

    def test_none_returns_defaults(self):
        assert parse_label_config(None)["symbology"] == "QR"

    def test_broken_json_returns_defaults(self):
        assert parse_label_config("{not json")["symbology"] == "QR"
