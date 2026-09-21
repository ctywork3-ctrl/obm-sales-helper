"""Report/print template schema.

A template is an ordered list of blocks. Each block renders one section of an
A4 page and carries the list of fields the user chose to show. Storing the
layout as JSON means a new block type is a code change only — no migration.

The block catalog below is the contract shared with the frontend designer:
it drives the block palette, the field-picker chips and the live preview.
"""

import json

# --- Paper ----------------------------------------------------------------

PAPER_SPECS = {
    "A4": {"width_mm": 210, "height_mm": 297},
    "A5": {"width_mm": 148, "height_mm": 210},
    "LETTER": {"width_mm": 216, "height_mm": 279},
}

# --- Block catalog --------------------------------------------------------

BLOCK_CATALOG: dict[str, dict] = {
    "companyHeader": {
        "label": "Company header",
        "description": "Your company name, address and registration number.",
        "fields": [
            {"key": "company_name", "label": "Company name"},
            {"key": "company_address", "label": "Address"},
            {"key": "company_phone", "label": "Phone"},
            {"key": "company_email", "label": "Email"},
            {"key": "company_reg_no", "label": "Registration no."},
            {"key": "company_logo", "label": "Logo"},
        ],
        "default_fields": [
            "company_logo", "company_name", "company_address",
            "company_phone", "company_email", "company_reg_no",
        ],
    },
    "docTitle": {
        "label": "Document title",
        "description": "Big title such as SALES ORDER or INVOICE.",
        "fields": [
            {"key": "title_text", "label": "Title text"},
            {"key": "order_number", "label": "Order number"},
            {"key": "copy_label", "label": "Copy label (ORIGINAL / COPY)"},
        ],
        "default_fields": ["title_text", "order_number"],
    },
    "docMeta": {
        "label": "Document details",
        "description": "Order number, date, status and who prepared it.",
        "fields": [
            {"key": "order_number", "label": "Order number"},
            {"key": "order_date", "label": "Order date"},
            {"key": "status", "label": "Status"},
            {"key": "salesman", "label": "Salesperson"},
            {"key": "currency", "label": "Currency"},
            {"key": "obm_reference_number", "label": "OBM reference"},
            {"key": "submitted_at", "label": "Submitted at"},
            {"key": "approved_at", "label": "Approved at"},
        ],
        "default_fields": ["order_number", "order_date", "status", "salesman", "currency", "obm_reference_number"],
    },
    "billTo": {
        "label": "Customer / delivery",
        "description": "Who the goods are for and where they go.",
        "fields": [
            {"key": "customer_name", "label": "Customer name"},
            {"key": "customer_code", "label": "Customer code"},
            {"key": "customer_phone", "label": "Customer phone"},
            {"key": "delivery_address", "label": "Delivery address"},
            {"key": "contact", "label": "Contact person"},
            {"key": "notes", "label": "Order notes"},
        ],
        "default_fields": ["customer_name", "customer_code", "customer_phone", "delivery_address", "contact"],
    },
    "itemsTable": {
        "label": "Items table",
        "description": "The product lines, with an optional discount column.",
        "fields": [
            {"key": "index", "label": "#"},
            {"key": "product_code", "label": "Code"},
            {"key": "product_name", "label": "Description"},
            {"key": "quantity", "label": "Qty"},
            {"key": "unit_price", "label": "Unit price"},
            {"key": "discount", "label": "Discount"},
            {"key": "discount_percent", "label": "Discount %"},
            {"key": "tax", "label": "Tax"},
            {"key": "line_total", "label": "Amount"},
        ],
        "default_fields": ["index", "product_code", "product_name", "quantity", "unit_price", "discount", "line_total"],
    },
    "discountSummary": {
        "label": "Discount summary",
        "description": "Line-by-line discount detail, with the reason given.",
        "fields": [
            {"key": "product_name", "label": "Product"},
            {"key": "product_code", "label": "Code"},
            {"key": "quantity", "label": "Qty"},
            {"key": "gross", "label": "List amount"},
            {"key": "discount", "label": "Discount"},
            {"key": "net", "label": "Net"},
            {"key": "discount_reason", "label": "Reason"},
        ],
        "default_fields": ["product_name", "quantity", "gross", "discount", "net", "discount_reason"],
    },
    "serialNumbers": {
        "label": "Serial numbers & warranty",
        "description": "Per-unit serials and warranty expiry for tracked goods.",
        "fields": [
            {"key": "product_name", "label": "Product"},
            {"key": "serial_number", "label": "Serial number"},
            {"key": "warehouse_location", "label": "Location"},
            {"key": "warranty_start", "label": "Warranty start"},
            {"key": "warranty_end", "label": "Warranty end"},
            {"key": "warranty_months", "label": "Warranty (months)"},
        ],
        "default_fields": ["product_name", "serial_number", "warranty_end"],
    },
    "totals": {
        "label": "Totals",
        "description": "Subtotal, discounts, tax and the amount due.",
        "fields": [
            {"key": "gross_subtotal", "label": "Gross subtotal"},
            {"key": "line_discount_total", "label": "Line discounts"},
            {"key": "subtotal", "label": "Net subtotal"},
            {"key": "order_discount", "label": "Order discount"},
            {"key": "tax", "label": "Tax"},
            {"key": "total", "label": "Total"},
            {"key": "discount_saved", "label": "Total discount"},
            {"key": "amount_in_words", "label": "Amount in words"},
        ],
        "default_fields": ["gross_subtotal", "line_discount_total", "order_discount", "subtotal", "tax", "total"],
    },
    "bankDetails": {
        "label": "Bank / payment details",
        "description": "Where to pay, pulled from Settings.",
        "fields": [{"key": "company_bank_details", "label": "Bank details"}],
        "default_fields": ["company_bank_details"],
    },
    "terms": {
        "label": "Terms & conditions",
        "description": "Fine print from Settings, plus the warranty note.",
        "fields": [
            {"key": "company_terms", "label": "Terms"},
            {"key": "warranty_note", "label": "Warranty note"},
        ],
        "default_fields": ["company_terms"],
    },
    "signatures": {
        "label": "Signatures",
        "description": "Prepared / approved / received-by signature lines.",
        "fields": [
            {"key": "prepared_by", "label": "Prepared by"},
            {"key": "approved_by", "label": "Approved by"},
            {"key": "received_by", "label": "Received by"},
            {"key": "date_line", "label": "Date line"},
        ],
        "default_fields": ["prepared_by", "approved_by", "received_by"],
    },
}

DOC_TYPES = [
    {"key": "SALES_ORDER", "label": "Sales Order", "default_title": "SALES ORDER"},
    {"key": "INVOICE", "label": "Invoice", "default_title": "TAX INVOICE"},
    {"key": "DELIVERY_ORDER", "label": "Delivery Order", "default_title": "DELIVERY ORDER"},
    {"key": "PURCHASE_ORDER", "label": "Purchase Order", "default_title": "PURCHASE ORDER"},
    {"key": "REPORT", "label": "Data Report", "default_title": "REPORT"},
]


def _default_title(doc_type: str) -> str:
    for entry in DOC_TYPES:
        if entry["key"] == doc_type:
            return entry["default_title"]
    return "DOCUMENT"


def default_template_config(doc_type: str = "SALES_ORDER") -> dict:
    """The template a fresh install starts with, per document type."""
    order = [
        "companyHeader", "docTitle", "docMeta", "billTo",
        "itemsTable", "discountSummary", "serialNumbers", "totals",
        "bankDetails", "terms", "signatures",
    ]
    blocks = []
    for block_type in order:
        spec = BLOCK_CATALOG[block_type]
        blocks.append({
            "id": block_type,
            "type": block_type,
            "visible": True,
            "title": spec["label"],
            "fields": list(spec["default_fields"]),
        })

    config = {
        "version": 1,
        "doc_type": doc_type,
        "paper": {"size": "A4", "orientation": "portrait", "margin_mm": 12},
        "theme": {"accent": "#0f766e", "font": "Helvetica", "font_size": 10},
        "options": {
            "show_page_numbers": True,
            "show_footer_line": True,
            "zebra_rows": True,
        },
        "blocks": blocks,
    }

    # A report is tabular data, not a transaction document.
    if doc_type == "REPORT":
        config["blocks"] = [
            b for b in blocks
            if b["type"] in ("companyHeader", "docTitle", "docMeta", "itemsTable", "totals", "signatures")
        ]
        for block in config["blocks"]:
            if block["type"] == "itemsTable":
                block["fields"] = ["index", "product_code", "product_name", "quantity", "unit_price", "line_total"]
            if block["type"] == "totals":
                block["fields"] = ["total"]
        config["theme"]["accent"] = "#1d4ed8"

    return config


def parse_config(config_json: str | None) -> dict:
    if not config_json:
        return default_template_config()
    try:
        parsed = json.loads(config_json)
        if isinstance(parsed, dict):
            return parsed
    except (json.JSONDecodeError, TypeError):
        pass
    return default_template_config()


def normalise_config(config: dict | None, doc_type: str = "SALES_ORDER") -> dict:
    """Coerce a client-supplied config into something safe to render.

    Unknown block types are dropped and unknown fields are filtered against
    the catalog, so a stale designer tab can never write garbage that breaks
    the print view later.
    """
    base = default_template_config(doc_type)
    if not isinstance(config, dict):
        return base

    base["version"] = int(config.get("version", 1) or 1)
    base["doc_type"] = config.get("doc_type") or doc_type

    paper = config.get("paper") or {}
    size = str(paper.get("size", base["paper"]["size"])).upper()
    base["paper"]["size"] = size if size in PAPER_SPECS else "A4"
    orientation = str(paper.get("orientation", "portrait")).lower()
    base["paper"]["orientation"] = orientation if orientation in ("portrait", "landscape") else "portrait"
    try:
        margin = float(paper.get("margin_mm", base["paper"]["margin_mm"]))
        base["paper"]["margin_mm"] = min(max(margin, 5), 30)
    except (TypeError, ValueError):
        pass

    theme = config.get("theme") or {}
    base["theme"]["accent"] = str(theme.get("accent", base["theme"]["accent"]))[:20]
    base["theme"]["font"] = str(theme.get("font", base["theme"]["font"]))[:40]
    try:
        base["theme"]["font_size"] = min(max(int(theme.get("font_size", 10)), 7), 16)
    except (TypeError, ValueError):
        pass

    options = config.get("options") or {}
    for key in ("show_page_numbers", "show_footer_line", "zebra_rows"):
        if key in options:
            base["options"][key] = bool(options[key])

    blocks = config.get("blocks")
    if isinstance(blocks, list) and blocks:
        cleaned = []
        seen: set[str] = set()
        for index, block in enumerate(blocks):
            if not isinstance(block, dict):
                continue
            block_type = block.get("type")
            spec = BLOCK_CATALOG.get(block_type)
            if not spec:
                continue
            block_id = str(block.get("id") or f"{block_type}-{index}")[:60]
            if block_id in seen:
                block_id = f"{block_id}-{index}"
            seen.add(block_id)

            allowed = {f["key"] for f in spec["fields"]}
            chosen = block.get("fields")
            if not isinstance(chosen, list):
                chosen = list(spec["default_fields"])
            fields = [f for f in chosen if f in allowed]
            if not fields:
                fields = list(spec["default_fields"])

            cleaned.append({
                "id": block_id,
                "type": block_type,
                "visible": bool(block.get("visible", True)),
                "title": str(block.get("title") or spec["label"])[:80],
                "fields": fields,
            })
        if cleaned:
            base["blocks"] = cleaned

    return base
