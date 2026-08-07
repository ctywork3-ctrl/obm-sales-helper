class Permissions:
    AUTH_CHANGE_OWN_PASSWORD = "auth.change_own_password"
    PRODUCTS_VIEW = "products.view"
    PRODUCTS_MANAGE = "products.manage"
    PRODUCTS_IMAGE_UPLOAD = "products.image.upload"
    PRODUCTS_IMAGE_DELETE = "products.image.delete"
    PRODUCTS_VIEW_COST_PRICE = "products.view_cost_price"
    SALES_ORDER_CREATE = "sales_order.create"
    SALES_ORDER_VIEW_OWN = "sales_order.view_own"
    SALES_ORDER_VIEW_ALL = "sales_order.view_all"
    SALES_ORDER_REVIEW = "sales_order.review"
    SALES_ORDER_REJECT = "sales_order.reject"
    SALES_ORDER_MARK_KEYED = "sales_order.mark_keyed"
    SALES_ORDER_CANCEL = "sales_order.cancel"
    CUSTOMERS_VIEW = "customers.view"
    CUSTOMERS_MANAGE = "customers.manage"
    USERS_VIEW = "users.view"
    USERS_MANAGE = "users.manage"
    USERS_ROLE_ASSIGN = "users.role.assign"
    AUDIT_VIEW = "audit.view"
    AUDIT_EXPORT = "audit.export"
    SETTINGS_VIEW = "settings.view"
    SETTINGS_MANAGE = "settings.manage"
    OBM_VIEW = "obm.view"
    OBM_MANAGE = "obm.manage"


ROLE_PERMISSIONS = {
    "DEVELOPER": [
        Permissions.PRODUCTS_VIEW,
        Permissions.PRODUCTS_MANAGE,
        Permissions.PRODUCTS_IMAGE_UPLOAD,
        Permissions.PRODUCTS_IMAGE_DELETE,
        Permissions.PRODUCTS_VIEW_COST_PRICE,
        Permissions.SALES_ORDER_VIEW_ALL,
        Permissions.SALES_ORDER_REVIEW,
        Permissions.SALES_ORDER_REJECT,
        Permissions.SALES_ORDER_MARK_KEYED,
        Permissions.CUSTOMERS_VIEW,
        Permissions.CUSTOMERS_MANAGE,
        Permissions.USERS_VIEW,
        Permissions.USERS_MANAGE,
        Permissions.USERS_ROLE_ASSIGN,
        Permissions.AUDIT_VIEW,
        Permissions.AUDIT_EXPORT,
        Permissions.SETTINGS_VIEW,
        Permissions.SETTINGS_MANAGE,
        Permissions.OBM_VIEW,
        Permissions.OBM_MANAGE,
    ],
    "IT_ADMIN": [
        Permissions.PRODUCTS_VIEW,
        Permissions.PRODUCTS_MANAGE,
        Permissions.PRODUCTS_IMAGE_UPLOAD,
        Permissions.PRODUCTS_IMAGE_DELETE,
        Permissions.PRODUCTS_VIEW_COST_PRICE,
        Permissions.SALES_ORDER_VIEW_ALL,
        Permissions.SALES_ORDER_REVIEW,
        Permissions.SALES_ORDER_REJECT,
        Permissions.SALES_ORDER_MARK_KEYED,
        Permissions.CUSTOMERS_VIEW,
        Permissions.CUSTOMERS_MANAGE,
        Permissions.USERS_VIEW,
        Permissions.USERS_MANAGE,
        Permissions.USERS_ROLE_ASSIGN,
        Permissions.AUDIT_VIEW,
        Permissions.AUDIT_EXPORT,
        Permissions.SETTINGS_VIEW,
        Permissions.SETTINGS_MANAGE,
        Permissions.OBM_VIEW,
        Permissions.OBM_MANAGE,
    ],
    "INSIDE_SALES": [
        Permissions.PRODUCTS_VIEW,
        Permissions.SALES_ORDER_VIEW_ALL,
        Permissions.SALES_ORDER_REVIEW,
        Permissions.SALES_ORDER_REJECT,
        Permissions.SALES_ORDER_MARK_KEYED,
        Permissions.CUSTOMERS_VIEW,
        Permissions.CUSTOMERS_MANAGE,
    ],
    "OUTSIDE_SALES": [
        Permissions.PRODUCTS_VIEW,
        Permissions.SALES_ORDER_CREATE,
        Permissions.SALES_ORDER_VIEW_OWN,
        Permissions.CUSTOMERS_VIEW,
        Permissions.CUSTOMERS_MANAGE,
    ],
}
