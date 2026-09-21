# OBM Sales Helper

Mobile-first (iPhone/iPad) web app for a Malaysian fishing-tackle trading company that runs the **OBM** desktop accounting software. OBM stays the book of record — this app **never writes to OBM** (read-only Firebird integration) and bridges the gaps OBM can't handle on mobile.

## 👉 Start here (for humans and AI assistants)

**[`QWEN_HANDOFF_BRIEF.md`](./QWEN_HANDOFF_BRIEF.md)** — the complete specification: business context, roles, data model, **59 implementation scenarios**, non-negotiable rules, and definition of done. Any AI assistant can build/extend the app from this one file.

Supporting design docs:

- [`WAREHOUSE_AND_SERIAL_PLAN.md`](./WAREHOUSE_AND_SERIAL_PLAN.md) — warehouse, barcode scanning, serial units & warranty design
- [`OBM_INTEGRATION.md`](./OBM_INTEGRATION.md) — how the read-only OBM (Firebird) integration works
- [`MODEL-SOURCE-OF-TRUTH.md`](./MODEL-SOURCE-OF-TRUTH.md) — data model reference

## What the app does

1. **Sales on the go** — outside sales create orders on iPhone; inside sales review/approve, then re-key into OBM and mark the order `KEYED_TO_OBM` with the OBM doc number.
2. **Warehouse on the phone** — purchase manager issues receiving tasks; workers scan barcodes with the camera, take photo evidence, and post GRNs (nothing moves until posted). Stock-takes, transfers, structured locations, discrepancy queue.
3. **Product catalog** — product manager turns warehouse stock into sellable product inventory (`BULK` qty or per-serial `ProductUnit`s) with prices, photos, warranty terms, commission rates.
4. **Warranty** — serial-tracked units with warranty clocks; public QR warranty-lookup page that leaks no customer data.
5. **Extras** — order chatter/comments, notifications, full audit log, CSV reports, optional B2B storefront, PWA with offline queue.

## Stack

- **Backend:** Python 3.13 · FastAPI · SQLAlchemy (async) · PostgreSQL · Alembic · cookie sessions + CSRF
- **Frontend:** React + TypeScript (Vite) · PWA (manifest + service worker + offline write queue) · camera barcode scanning
- **Integration:** OBM accounting (Firebird 2.5) read-only via `isql.exe`, CSV fallback

## Running locally

```bash
# backend
cd backend
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --port 8001

# frontend
cd frontend
npm install
npm run dev   # dev server on :3000
```

`backend/.env.example` lists the environment variables (copy to `backend/.env`).
