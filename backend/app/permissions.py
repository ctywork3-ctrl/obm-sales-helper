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
    DISCOUNT_APPROVE = "sales_order.discount_approve"
    CUSTOMERS_VIEW = "customers.view"
    CUSTOMERS_MANAGE = "customers.manage"
    CUSTOMERS_ASSIGN = "customers.assign"
    SUPPLIERS_VIEW = "suppliers.view"
    SUPPLIERS_MANAGE = "suppliers.manage"
    USERS_VIEW = "users.view"
    USERS_MANAGE = "users.manage"
    USERS_ROLE_ASSIGN = "users.role.assign"
    AUDIT_VIEW = "audit.view"
    AUDIT_EXPORT = "audit.export"
    SETTINGS_VIEW = "settings.view"
    SETTINGS_MANAGE = "settings.manage"
    OBM_VIEW = "obm.view"
    OBM_MANAGE = "obm.manage"
    WAREHOUSE_RECEIVE = "warehouse.receive"
    WAREHOUSE_SCAN = "warehouse.scan"
    WAREHOUSE_ADJUST = "warehouse.stock_adjustment"
    WAREHOUSE_TRANSFER = "warehouse.stock_transfer"
    STOCK_MOVEMENTS_VIEW = "stock_movements.view"
    STOCK_LOCATION_MANAGE = "stock_location.manage"
    RECEIVING_TASK_ASSIGN = "receiving_task.assign"
    RECEIVING_TASK_EXECUTE = "receiving_task.execute"
    WARRANTY_VIEW = "warranty.view"
    WARRANTY_MANAGE = "warranty.manage"
    REPORTS_VIEW = "reports.view"
    REPORT_DESIGN_MANAGE = "report_design.manage"
    LABELS_PRINT = "labels.print"
    LABELS_CONFIGURE = "labels.configure"
    RECEIVING_DISCREPANCY_REVIEW = "receiving_discrepancy.review"
    STOCK_TAKE_RUN = "stock_take.run"
    STOCK_TAKE_MANAGE = "stock_take.manage"
    TRANSFER_CREATE = "transfer.create"
    TRANSFER_EXECUTE = "transfer.execute"
    PRODUCT_INTAKE_APPROVE = "product_intake.approve"


_VIEW_ONLY_REPORTS = [
    Permissions.REPORTS_VIEW,
]


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
        Permissions.SALES_ORDER_CANCEL,
        Permissions.DISCOUNT_APPROVE,
        Permissions.CUSTOMERS_VIEW,
        Permissions.CUSTOMERS_MANAGE,
        Permissions.SUPPLIERS_VIEW,
        Permissions.SUPPLIERS_MANAGE,
        Permissions.CUSTOMERS_ASSIGN,
        Permissions.USERS_VIEW,
        Permissions.USERS_MANAGE,
        Permissions.USERS_ROLE_ASSIGN,
        Permissions.AUDIT_VIEW,
        Permissions.AUDIT_EXPORT,
        Permissions.SETTINGS_VIEW,
        Permissions.SETTINGS_MANAGE,
        Permissions.OBM_VIEW,
        Permissions.OBM_MANAGE,
        Permissions.WAREHOUSE_RECEIVE,
        Permissions.WAREHOUSE_SCAN,
        Permissions.WAREHOUSE_ADJUST,
        Permissions.WAREHOUSE_TRANSFER,
        Permissions.STOCK_MOVEMENTS_VIEW,
        Permissions.STOCK_LOCATION_MANAGE,
        Permissions.RECEIVING_TASK_ASSIGN,
        Permissions.RECEIVING_TASK_EXECUTE,
        Permissions.WARRANTY_VIEW,
        Permissions.WARRANTY_MANAGE,
        Permissions.REPORTS_VIEW,
        Permissions.REPORT_DESIGN_MANAGE,
        Permissions.PRODUCT_INTAKE_APPROVE,
        Permissions.LABELS_PRINT,
        Permissions.LABELS_CONFIGURE,
        Permissions.RECEIVING_DISCREPANCY_REVIEW,
        Permissions.STOCK_TAKE_RUN,
        Permissions.STOCK_TAKE_MANAGE,
        Permissions.TRANSFER_CREATE,
        Permissions.TRANSFER_EXECUTE,
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
        Permissions.SALES_ORDER_CANCEL,
        Permissions.DISCOUNT_APPROVE,
        Permissions.CUSTOMERS_VIEW,
        Permissions.CUSTOMERS_MANAGE,
        Permissions.SUPPLIERS_VIEW,
        Permissions.SUPPLIERS_MANAGE,
        Permissions.CUSTOMERS_ASSIGN,
        Permissions.USERS_VIEW,
        Permissions.USERS_MANAGE,
        Permissions.USERS_ROLE_ASSIGN,
        Permissions.AUDIT_VIEW,
        Permissions.AUDIT_EXPORT,
        Permissions.SETTINGS_VIEW,
        Permissions.SETTINGS_MANAGE,
        Permissions.OBM_VIEW,
        Permissions.OBM_MANAGE,
        Permissions.WAREHOUSE_RECEIVE,
        Permissions.WAREHOUSE_SCAN,
        Permissions.WAREHOUSE_ADJUST,
        Permissions.WAREHOUSE_TRANSFER,
        Permissions.STOCK_MOVEMENTS_VIEW,
        Permissions.STOCK_LOCATION_MANAGE,
        Permissions.RECEIVING_TASK_ASSIGN,
        Permissions.RECEIVING_TASK_EXECUTE,
        Permissions.WARRANTY_VIEW,
        Permissions.WARRANTY_MANAGE,
        Permissions.REPORTS_VIEW,
        Permissions.REPORT_DESIGN_MANAGE,
        Permissions.PRODUCT_INTAKE_APPROVE,
        Permissions.LABELS_PRINT,
        Permissions.LABELS_CONFIGURE,
        Permissions.RECEIVING_DISCREPANCY_REVIEW,
        Permissions.STOCK_TAKE_RUN,
        Permissions.STOCK_TAKE_MANAGE,
        Permissions.TRANSFER_CREATE,
        Permissions.TRANSFER_EXECUTE,
    ],
    # Top-level oversight. Sees and approves everything, but does not run the
    # day-to-day warehouse or edit master data.
    "DIRECTOR": [
        Permissions.PRODUCTS_VIEW,
        Permissions.PRODUCTS_VIEW_COST_PRICE,
        Permissions.SALES_ORDER_VIEW_ALL,
        Permissions.SALES_ORDER_REVIEW,
        Permissions.SALES_ORDER_REJECT,
        Permissions.SALES_ORDER_CANCEL,
        Permissions.DISCOUNT_APPROVE,
        Permissions.CUSTOMERS_VIEW,
        Permissions.USERS_VIEW,
        Permissions.AUDIT_VIEW,
        Permissions.AUDIT_EXPORT,
        Permissions.SETTINGS_VIEW,
        Permissions.OBM_VIEW,
        Permissions.STOCK_MOVEMENTS_VIEW,
        Permissions.WAREHOUSE_SCAN,
        Permissions.WARRANTY_VIEW,
        Permissions.REPORTS_VIEW,
        Permissions.REPORT_DESIGN_MANAGE,
        Permissions.LABELS_PRINT,
        Permissions.RECEIVING_DISCREPANCY_REVIEW,
    ],
    # Runs the business: approves orders, owns stock and warehouse flow, can
    # issue receiving tasks, and manages the product catalogue.
    "OPERATIONS_MANAGER": [
        Permissions.PRODUCTS_VIEW,
        Permissions.PRODUCTS_MANAGE,
        Permissions.PRODUCTS_IMAGE_UPLOAD,
        Permissions.PRODUCTS_VIEW_COST_PRICE,
        Permissions.SALES_ORDER_CREATE,
        Permissions.SALES_ORDER_VIEW_ALL,
        Permissions.SALES_ORDER_REVIEW,
        Permissions.SALES_ORDER_REJECT,
        Permissions.SALES_ORDER_MARK_KEYED,
        Permissions.SALES_ORDER_CANCEL,
        Permissions.DISCOUNT_APPROVE,
        Permissions.CUSTOMERS_VIEW,
        Permissions.CUSTOMERS_MANAGE,
        Permissions.SUPPLIERS_VIEW,
        Permissions.SUPPLIERS_MANAGE,
        Permissions.CUSTOMERS_ASSIGN,
        Permissions.USERS_VIEW,
        Permissions.AUDIT_VIEW,
        Permissions.SETTINGS_VIEW,
        Permissions.OBM_VIEW,
        Permissions.WAREHOUSE_RECEIVE,
        Permissions.WAREHOUSE_SCAN,
        Permissions.WAREHOUSE_ADJUST,
        Permissions.WAREHOUSE_TRANSFER,
        Permissions.STOCK_MOVEMENTS_VIEW,
        Permissions.STOCK_LOCATION_MANAGE,
        Permissions.RECEIVING_TASK_ASSIGN,
        Permissions.RECEIVING_TASK_EXECUTE,
        Permissions.WARRANTY_VIEW,
        Permissions.WARRANTY_MANAGE,
        Permissions.REPORTS_VIEW,
        Permissions.REPORT_DESIGN_MANAGE,
        Permissions.PRODUCT_INTAKE_APPROVE,
        Permissions.LABELS_PRINT,
        Permissions.LABELS_CONFIGURE,
        Permissions.RECEIVING_DISCREPANCY_REVIEW,
        Permissions.STOCK_TAKE_RUN,
        Permissions.STOCK_TAKE_MANAGE,
        Permissions.TRANSFER_CREATE,
        Permissions.TRANSFER_EXECUTE,
    ],
    # Buys the goods: owns purchase orders and the supplier side, issues
    # receiving tasks to the storekeeper, watches stock and cost.
    "PURCHASE_MANAGER": [
        Permissions.PRODUCTS_VIEW,
        Permissions.PRODUCTS_MANAGE,
        Permissions.PRODUCTS_VIEW_COST_PRICE,
        Permissions.SALES_ORDER_VIEW_ALL,
        Permissions.CUSTOMERS_VIEW,
        Permissions.SUPPLIERS_VIEW,
        Permissions.SUPPLIERS_MANAGE,
        Permissions.OBM_VIEW,
        Permissions.OBM_MANAGE,
        Permissions.WAREHOUSE_RECEIVE,
        Permissions.WAREHOUSE_SCAN,
        Permissions.STOCK_MOVEMENTS_VIEW,
        Permissions.RECEIVING_TASK_ASSIGN,
        Permissions.RECEIVING_TASK_EXECUTE,
        Permissions.WARRANTY_VIEW,
        Permissions.REPORTS_VIEW,
        Permissions.PRODUCT_INTAKE_APPROVE,
        Permissions.LABELS_PRINT,
        Permissions.RECEIVING_DISCREPANCY_REVIEW,
        Permissions.STOCK_TAKE_MANAGE,
        Permissions.TRANSFER_CREATE,
    ],
    "INSIDE_SALES": [
        Permissions.PRODUCTS_VIEW,
        # Inside sales key orders in on behalf of the field team, so they need
        # create rights as well as review rights.
        Permissions.SALES_ORDER_CREATE,
        Permissions.SALES_ORDER_VIEW_ALL,
        Permissions.SALES_ORDER_REVIEW,
        Permissions.SALES_ORDER_REJECT,
        Permissions.SALES_ORDER_MARK_KEYED,
        Permissions.SALES_ORDER_CANCEL,
        Permissions.CUSTOMERS_VIEW,
        Permissions.CUSTOMERS_MANAGE,
        Permissions.REPORTS_VIEW,
    ],
    "OUTSIDE_SALES": [
        Permissions.PRODUCTS_VIEW,
        Permissions.SALES_ORDER_CREATE,
        Permissions.SALES_ORDER_VIEW_OWN,
        Permissions.SALES_ORDER_CANCEL,
        Permissions.CUSTOMERS_VIEW,
        Permissions.CUSTOMERS_MANAGE,
    ],
    "STOCK_KEEPER": [
        Permissions.PRODUCTS_VIEW,
        Permissions.WAREHOUSE_RECEIVE,
        Permissions.WAREHOUSE_SCAN,
        Permissions.WAREHOUSE_ADJUST,
        Permissions.WAREHOUSE_TRANSFER,
        Permissions.STOCK_MOVEMENTS_VIEW,
        Permissions.RECEIVING_TASK_EXECUTE,
        Permissions.WARRANTY_VIEW,
        Permissions.CUSTOMERS_VIEW,
        # Read-only on suppliers: a store keeper needs to see whose delivery they
        # are counting, but must not be able to edit vendor records.
        Permissions.SUPPLIERS_VIEW,
        Permissions.LABELS_PRINT,
        Permissions.STOCK_TAKE_RUN,
        Permissions.TRANSFER_EXECUTE,
    ],
    "MANAGER": [
        Permissions.PRODUCTS_VIEW,
        Permissions.PRODUCTS_MANAGE,
        Permissions.PRODUCTS_IMAGE_UPLOAD,
        Permissions.PRODUCTS_IMAGE_DELETE,
        Permissions.PRODUCTS_VIEW_COST_PRICE,
        Permissions.SALES_ORDER_VIEW_ALL,
        Permissions.SALES_ORDER_REVIEW,
        Permissions.SALES_ORDER_REJECT,
        Permissions.SALES_ORDER_MARK_KEYED,
        Permissions.SALES_ORDER_CANCEL,
        Permissions.DISCOUNT_APPROVE,
        Permissions.CUSTOMERS_VIEW,
        Permissions.CUSTOMERS_MANAGE,
        Permissions.SUPPLIERS_VIEW,
        Permissions.SUPPLIERS_MANAGE,
        Permissions.CUSTOMERS_ASSIGN,
        Permissions.WAREHOUSE_RECEIVE,
        Permissions.WAREHOUSE_SCAN,
        Permissions.WAREHOUSE_ADJUST,
        Permissions.WAREHOUSE_TRANSFER,
        Permissions.STOCK_MOVEMENTS_VIEW,
        Permissions.STOCK_LOCATION_MANAGE,
        Permissions.RECEIVING_TASK_ASSIGN,
        Permissions.RECEIVING_TASK_EXECUTE,
        Permissions.WARRANTY_VIEW,
        Permissions.WARRANTY_MANAGE,
        Permissions.REPORTS_VIEW,
        Permissions.REPORT_DESIGN_MANAGE,
        Permissions.PRODUCT_INTAKE_APPROVE,
        Permissions.AUDIT_VIEW,
        Permissions.SETTINGS_VIEW,
        Permissions.LABELS_PRINT,
        Permissions.LABELS_CONFIGURE,
        Permissions.RECEIVING_DISCREPANCY_REVIEW,
        Permissions.STOCK_TAKE_RUN,
        Permissions.STOCK_TAKE_MANAGE,
        Permissions.TRANSFER_CREATE,
        Permissions.TRANSFER_EXECUTE,
    ],
}

ALL_ROLES = list(ROLE_PERMISSIONS.keys())


def permissions_for_role(role: str) -> list[str]:
    return list(ROLE_PERMISSIONS.get(role, []))
