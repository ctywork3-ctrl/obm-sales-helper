from fastapi import APIRouter

from app.api.auth import router as auth_router
from app.api.users import router as users_router
from app.api.products import router as products_router
from app.api.product_images import router as product_images_router
from app.api.product_prices import router as product_prices_router
from app.api.customers import router as customers_router
from app.api.sales_orders import router as sales_orders_router
from app.api.audit_logs import router as audit_logs_router
from app.api.settings import router as settings_router
from app.api.role_permissions import router as role_permissions_router
from app.api.dashboard import router as dashboard_router
from app.api.notifications import router as notifications_router
from app.api.order_comments import router as order_comments_router
from app.api.stock_movements import router as stock_movements_router
from app.api.barcodes import router as barcodes_router
from app.api.tracking import router as tracking_router
from app.api.master_data import router as master_data_router
from app.api.reports import router as reports_router
from app.api.product_units import router as product_units_router
from app.api.product_unit_images import router as product_unit_images_router
from app.api.order_templates import router as order_templates_router
from app.api.inventory import router as inventory_router
from app.api.purchase_orders import router as purchase_orders_router
from app.api.store_products import router as store_products_router
from app.api.warehouse_ops import router as warehouse_ops_router
from app.api.report_templates import router as report_templates_router
from app.api.labels import router as labels_router
from app.api.stock_takes import router as stock_takes_router
from app.api.transfers import router as transfers_router
from app.api.public_warranty import router as public_warranty_router

api_router = APIRouter()

api_router.include_router(auth_router)
api_router.include_router(users_router)
api_router.include_router(products_router)
api_router.include_router(product_images_router)
api_router.include_router(product_prices_router)
api_router.include_router(customers_router)
api_router.include_router(sales_orders_router)
api_router.include_router(audit_logs_router)
api_router.include_router(settings_router)
api_router.include_router(role_permissions_router)
api_router.include_router(dashboard_router)
api_router.include_router(notifications_router)
api_router.include_router(order_comments_router)
api_router.include_router(stock_movements_router)
api_router.include_router(barcodes_router)
api_router.include_router(tracking_router)
api_router.include_router(master_data_router)
api_router.include_router(reports_router)
api_router.include_router(product_units_router)
api_router.include_router(product_unit_images_router)
api_router.include_router(order_templates_router)
api_router.include_router(inventory_router)
api_router.include_router(purchase_orders_router)
api_router.include_router(store_products_router)
api_router.include_router(warehouse_ops_router)
api_router.include_router(report_templates_router)
api_router.include_router(labels_router)
api_router.include_router(stock_takes_router)
api_router.include_router(transfers_router)
# Deliberately unauthenticated: a customer scanning the QR on a rod must not be
# asked to log in. The endpoint exposes only the warranty dates - see the module
# docstring for exactly what is withheld and why.
api_router.include_router(public_warranty_router)
