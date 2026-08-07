from app.api.auth import router as auth_router
from app.api.users import router as users_router
from app.api.products import router as products_router
from app.api.product_images import router as product_images_router
from app.api.customers import router as customers_router
from app.api.sales_orders import router as sales_orders_router
from app.api.audit_logs import router as audit_logs_router
from app.api.settings import router as settings_router

__all__ = [
    "auth_router",
    "users_router",
    "products_router",
    "product_images_router",
    "customers_router",
    "sales_orders_router",
    "audit_logs_router",
    "settings_router",
]
