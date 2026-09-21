"""Read a supplier purchase order (image or PDF) into structured lines.

This is a review-only helper: it returns parsed lines + a confidence flag.
Nothing here creates products or changes stock. The AI provider is an
OpenAI-compatible /chat/completions endpoint configured via environment.

- Images: sent to a vision-capable model as a base64 data URL.
- PDFs: text is extracted locally with pypdf and sent as text.
If AI is not configured, the caller falls back to manual entry.
"""
import base64
import io
import json

import httpx

from app.config import settings

# pypdf is only needed for the PDF path. Importing it lazily means a missing
# dependency degrades to "could not read the PDF text" instead of taking the
# whole API down at import time (which is what happened before it was added
# to requirements.txt).
try:
    from pypdf import PdfReader
except ImportError:  # pragma: no cover - depends on the deploy environment
    PdfReader = None  # type: ignore[assignment]

SYSTEM_PROMPT = (
    "You read supplier purchase orders. Return ONLY valid JSON, no commentary, "
    "with this shape: {\"supplier_name\": string, \"po_number\": string, "
    "\"lines\": [{\"item_code\": string, \"name\": string, \"quantity\": number, "
    "\"unit_price\": number|null}]}. Use empty string for missing values. "
    "item_code is the supplier SKU or product code if visible."
)


def _extract_pdf_text(content: bytes) -> str:
    if PdfReader is None:
        return ""
    try:
        reader = PdfReader(io.BytesIO(content))
        return "\n".join((page.extract_text() or "") for page in reader.pages)
    except Exception:
        return ""


def _build_messages(content: bytes, mime: str) -> list[dict]:
    if mime in ("image/jpeg", "image/png", "image/webp", "image/gif"):
        b64 = base64.b64encode(content).decode()
        return [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Extract the purchase order lines from this image."},
                    {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
                ],
            },
        ]
    text = _extract_pdf_text(content)
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"Extract the purchase order lines from this document:\n\n{text[:30000]}"},
    ]


def _parse(response_text: str) -> dict:
    text = response_text.strip()
    # Strip markdown code fences if the model echoes them.
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        import re
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass
        return {"supplier_name": "", "po_number": "", "lines": [], "raw": text}


async def extract_purchase_order(content: bytes, mime: str) -> dict:
    if not settings.AI_API_KEY or not settings.AI_MODEL or not settings.AI_BASE_URL:
        return {"status": "unconfigured", "lines": []}

    messages = _build_messages(content, mime)
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                f"{settings.AI_BASE_URL.rstrip('/')}/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.AI_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.AI_MODEL,
                    "messages": messages,
                    "temperature": 0,
                    "max_tokens": 2048,
                },
            )
    except (httpx.TimeoutException, httpx.RequestError) as exc:
        # A slow or unreachable provider must not 500 the upload endpoint —
        # the document is already saved, and the manager can type the lines.
        return {"status": "error", "detail": f"AI request failed: {type(exc).__name__}"}

    if resp.status_code != 200:
        return {"status": "error", "detail": resp.text[:500]}

    payload = resp.json()
    try:
        reply_text = payload["choices"][0]["message"]["content"]
    except (KeyError, IndexError):
        return {"status": "error", "detail": "Unexpected AI response shape"}

    parsed = _parse(reply_text)
    parsed["status"] = "ok"
    return parsed