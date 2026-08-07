from fastapi import APIRouter

from app.api.auth import router as auth_router
from app.api.users import router as users_router
from app.api.products import router as products_router
from app.api.product_images import router as product_images_router
from app.api.customers import router as customers_router
from app.api.sales_orders import router as sales_orders_router
from app.api.audit_logs import router as audit_logs_router
from app.api.settings import router as settings_router
from app.api.role_permissions import router as role_permissions_router

api_router = APIRouter()

api_router.include_router(auth_router)
api_router.include_router(users_router)
api_router.include_router(products_router)
api_router.include_router(product_images_router)
api_router.include_router(customers_router)
api_router.include_router(sales_orders_router)
api_router.include_router(audit_logs_router)
api_router.include_router(settings_router)
api_router.include_router(role_permissions_router)
