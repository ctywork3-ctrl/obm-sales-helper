import pytest
from fastapi import HTTPException

from app.permissions import Permissions, ROLE_PERMISSIONS


class TestRoleMappingInvariants:
    def test_all_roles_present(self):
        assert set(ROLE_PERMISSIONS.keys()) == {
            "DEVELOPER", "IT_ADMIN", "DIRECTOR", "OPERATIONS_MANAGER",
            "PURCHASE_MANAGER", "MANAGER", "INSIDE_SALES", "OUTSIDE_SALES", "STOCK_KEEPER",
        }

    def test_no_unknown_permissions(self):
        known = {v for k, v in vars(Permissions).items() if not k.startswith("_") and isinstance(v, str)}
        for role, perms in ROLE_PERMISSIONS.items():
            unknown = set(perms) - known
            assert not unknown, f"{role} grants unknown permissions: {unknown}"

    def test_no_duplicates_within_role(self):
        for role, perms in ROLE_PERMISSIONS.items():
            assert len(perms) == len(set(perms)), f"{role} has duplicate permissions"

    def test_developer_is_superset_of_it_admin(self):
        assert set(ROLE_PERMISSIONS["IT_ADMIN"]).issubset(set(ROLE_PERMISSIONS["DEVELOPER"]))


class TestOutsideSalesRestrictions:
    def test_cannot_view_all_orders(self):
        assert Permissions.SALES_ORDER_VIEW_ALL not in ROLE_PERMISSIONS["OUTSIDE_SALES"]

    def test_cannot_view_cost_price(self):
        assert Permissions.PRODUCTS_VIEW_COST_PRICE not in ROLE_PERMISSIONS["OUTSIDE_SALES"]

    def test_cannot_manage_users(self):
        assert Permissions.USERS_MANAGE not in ROLE_PERMISSIONS["OUTSIDE_SALES"]

    def test_cannot_review_orders(self):
        assert Permissions.SALES_ORDER_REVIEW not in ROLE_PERMISSIONS["OUTSIDE_SALES"]

    def test_can_create_orders_and_own_customers(self):
        assert Permissions.SALES_ORDER_CREATE in ROLE_PERMISSIONS["OUTSIDE_SALES"]
        assert Permissions.CUSTOMERS_MANAGE in ROLE_PERMISSIONS["OUTSIDE_SALES"]


class TestStockKeeperRestrictions:
    def test_cannot_create_orders(self):
        assert Permissions.SALES_ORDER_CREATE not in ROLE_PERMISSIONS["STOCK_KEEPER"]

    def test_cannot_view_revenue_data(self):
        assert Permissions.SALES_ORDER_VIEW_ALL not in ROLE_PERMISSIONS["STOCK_KEEPER"]
        assert Permissions.SALES_ORDER_VIEW_OWN not in ROLE_PERMISSIONS["STOCK_KEEPER"]

    def test_has_warehouse_permissions(self):
        for perm in [Permissions.WAREHOUSE_RECEIVE, Permissions.WAREHOUSE_SCAN, Permissions.WAREHOUSE_ADJUST]:
            assert perm in ROLE_PERMISSIONS["STOCK_KEEPER"]

    def test_cannot_manage_products(self):
        assert Permissions.PRODUCTS_MANAGE not in ROLE_PERMISSIONS["STOCK_KEEPER"]


class TestManagerRole:
    def test_has_customer_assignment(self):
        assert Permissions.CUSTOMERS_ASSIGN in ROLE_PERMISSIONS["MANAGER"]

    def test_has_product_intake_approval(self):
        assert Permissions.PRODUCT_INTAKE_APPROVE in ROLE_PERMISSIONS["MANAGER"]

    def test_cannot_manage_users(self):
        assert Permissions.USERS_MANAGE not in ROLE_PERMISSIONS["MANAGER"]

    def test_can_view_cost_price(self):
        assert Permissions.PRODUCTS_VIEW_COST_PRICE in ROLE_PERMISSIONS["MANAGER"]


class TestInsideSalesRestrictions:
    def test_cannot_view_cost_price(self):
        assert Permissions.PRODUCTS_VIEW_COST_PRICE not in ROLE_PERMISSIONS["INSIDE_SALES"]

    def test_can_review_orders(self):
        assert Permissions.SALES_ORDER_REVIEW in ROLE_PERMISSIONS["INSIDE_SALES"]

    def test_cannot_manage_users(self):
        assert Permissions.USERS_MANAGE not in ROLE_PERMISSIONS["INSIDE_SALES"]

    def test_can_key_in_orders(self):
        # Inside sales enter orders on behalf of the field team, so they need
        # create rights and not just review rights.
        assert Permissions.SALES_ORDER_CREATE in ROLE_PERMISSIONS["INSIDE_SALES"]


class TestDirectorRole:
    """Oversight only: sees and approves, does not run or mutate."""

    def test_can_view_all_orders_and_approve(self):
        assert Permissions.SALES_ORDER_VIEW_ALL in ROLE_PERMISSIONS["DIRECTOR"]
        assert Permissions.SALES_ORDER_REVIEW in ROLE_PERMISSIONS["DIRECTOR"]

    def test_can_approve_large_discounts(self):
        assert Permissions.DISCOUNT_APPROVE in ROLE_PERMISSIONS["DIRECTOR"]

    def test_can_read_but_not_manage_users(self):
        assert Permissions.USERS_VIEW in ROLE_PERMISSIONS["DIRECTOR"]
        assert Permissions.USERS_MANAGE not in ROLE_PERMISSIONS["DIRECTOR"]

    def test_cannot_manage_master_data(self):
        assert Permissions.PRODUCTS_MANAGE not in ROLE_PERMISSIONS["DIRECTOR"]
        assert Permissions.SETTINGS_MANAGE not in ROLE_PERMISSIONS["DIRECTOR"]

    def test_cannot_execute_warehouse_work(self):
        assert Permissions.RECEIVING_TASK_EXECUTE not in ROLE_PERMISSIONS["DIRECTOR"]
        assert Permissions.WAREHOUSE_ADJUST not in ROLE_PERMISSIONS["DIRECTOR"]

    def test_can_view_warranty_and_reports(self):
        assert Permissions.WARRANTY_VIEW in ROLE_PERMISSIONS["DIRECTOR"]
        assert Permissions.REPORTS_VIEW in ROLE_PERMISSIONS["DIRECTOR"]


class TestOperationsManagerRole:
    def test_owns_warehouse_flow(self):
        for perm in [
            Permissions.RECEIVING_TASK_ASSIGN,
            Permissions.RECEIVING_TASK_EXECUTE,
            Permissions.STOCK_LOCATION_MANAGE,
            Permissions.WAREHOUSE_ADJUST,
        ]:
            assert perm in ROLE_PERMISSIONS["OPERATIONS_MANAGER"], perm

    def test_can_run_sales(self):
        assert Permissions.SALES_ORDER_CREATE in ROLE_PERMISSIONS["OPERATIONS_MANAGER"]
        assert Permissions.SALES_ORDER_REVIEW in ROLE_PERMISSIONS["OPERATIONS_MANAGER"]
        assert Permissions.DISCOUNT_APPROVE in ROLE_PERMISSIONS["OPERATIONS_MANAGER"]

    def test_cannot_manage_users(self):
        assert Permissions.USERS_MANAGE not in ROLE_PERMISSIONS["OPERATIONS_MANAGER"]


class TestPurchaseManagerRole:
    def test_can_issue_receiving_tasks(self):
        assert Permissions.RECEIVING_TASK_ASSIGN in ROLE_PERMISSIONS["PURCHASE_MANAGER"]

    def test_can_manage_products_and_see_cost(self):
        assert Permissions.PRODUCTS_MANAGE in ROLE_PERMISSIONS["PURCHASE_MANAGER"]
        assert Permissions.PRODUCTS_VIEW_COST_PRICE in ROLE_PERMISSIONS["PURCHASE_MANAGER"]

    def test_cannot_sell_or_approve_discounts(self):
        assert Permissions.SALES_ORDER_CREATE not in ROLE_PERMISSIONS["PURCHASE_MANAGER"]
        assert Permissions.DISCOUNT_APPROVE not in ROLE_PERMISSIONS["PURCHASE_MANAGER"]

    def test_cannot_manage_users_or_settings(self):
        assert Permissions.USERS_MANAGE not in ROLE_PERMISSIONS["PURCHASE_MANAGER"]
        assert Permissions.SETTINGS_MANAGE not in ROLE_PERMISSIONS["PURCHASE_MANAGER"]


class TestRequireAnyPermissionDependency:
    @pytest.mark.asyncio
    async def test_allows_a_user_holding_one_of_them(self):
        from types import SimpleNamespace
        from app.dependencies import require_any_permission

        dependency = require_any_permission(
            Permissions.USERS_MANAGE, Permissions.WAREHOUSE_SCAN,
        )
        user = SimpleNamespace(role="STOCK_KEEPER")
        assert await dependency(user) is user

    @pytest.mark.asyncio
    async def test_rejects_a_user_holding_none_of_them(self):
        from types import SimpleNamespace
        from app.dependencies import require_any_permission

        dependency = require_any_permission(
            Permissions.USERS_MANAGE, Permissions.WAREHOUSE_SCAN,
        )
        user = SimpleNamespace(role="OUTSIDE_SALES")
        with pytest.raises(HTTPException) as exc_info:
            await dependency(user)
        assert exc_info.value.status_code == 403


class TestWarehouseReadGuards:
    """The receiving-task screens must not be reachable by field sales."""

    def test_outside_sales_has_no_warehouse_read_permission(self):
        warehouse_read = {
            Permissions.STOCK_MOVEMENTS_VIEW,
            Permissions.RECEIVING_TASK_ASSIGN,
            Permissions.RECEIVING_TASK_EXECUTE,
        }
        assert not warehouse_read & set(ROLE_PERMISSIONS["OUTSIDE_SALES"])

    def test_stock_keeper_and_buyers_can_read(self):
        for role in ("STOCK_KEEPER", "PURCHASE_MANAGER", "OPERATIONS_MANAGER", "MANAGER"):
            assert Permissions.STOCK_MOVEMENTS_VIEW in ROLE_PERMISSIONS[role], role


class TestRequirePermissionDependency:
    @pytest.mark.asyncio
    async def test_allows_user_with_permission(self):
        from types import SimpleNamespace
        from app.dependencies import require_permission

        dependency = require_permission(Permissions.PRODUCTS_VIEW)
        user = SimpleNamespace(role="OUTSIDE_SALES")
        result = await dependency(user)
        assert result is user

    @pytest.mark.asyncio
    async def test_rejects_user_without_permission(self):
        from types import SimpleNamespace
        from app.dependencies import require_permission

        dependency = require_permission(Permissions.USERS_MANAGE)
        user = SimpleNamespace(role="OUTSIDE_SALES")
        with pytest.raises(HTTPException) as exc_info:
            await dependency(user)
        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_rejects_unknown_role(self):
        from types import SimpleNamespace
        from app.dependencies import require_permission

        dependency = require_permission(Permissions.PRODUCTS_VIEW)
        user = SimpleNamespace(role="SOMETHING_ELSE")
        with pytest.raises(HTTPException) as exc_info:
            await dependency(user)
        assert exc_info.value.status_code == 403
