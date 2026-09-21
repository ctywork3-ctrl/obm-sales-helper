import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import StoreLayout from './pages/store/StoreLayout'
import LoadingSpinner from './components/LoadingSpinner'

// Internal app pages
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import ChangePassword from './pages/ChangePassword'
import ProductList from './pages/products/ProductList'
import ProductDetail from './pages/products/ProductDetail'
import CreateOrder from './pages/sales/CreateOrder'
import MyOrders from './pages/sales/MyOrders'
import AllOrders from './pages/sales/AllOrders'
import OrderDetail from './pages/sales/OrderDetail'
import ReviewOrder from './pages/sales/ReviewOrder'
import SalesCustomerList from './pages/sales/SalesCustomerList'
import SalesCustomerForm from './pages/sales/SalesCustomerForm'
import CustomerOrderHistory from './pages/sales/CustomerOrderHistory'
import EditDraftOrder from './pages/sales/EditDraftOrder'
import UserList from './pages/admin/UserList'
import UserForm from './pages/admin/UserForm'
import ProductManagement from './pages/admin/ProductManagement'
import ProductForm from './pages/admin/ProductForm'
import ProductImages from './pages/admin/ProductImages'
import CustomerList from './pages/admin/CustomerList'
import CustomerForm from './pages/admin/CustomerForm'
import ActivityPage from './pages/admin/ActivityPage'
import SalesmanMap from './pages/admin/SalesmanMap'
import ReportsPage from './pages/admin/ReportsPage'
import ReportDesigner from './pages/admin/ReportDesigner'
import ProductPrices from './pages/admin/ProductPrices'
import CategoryManagement from './pages/admin/CategoryManagement'
import OrderTemplates from './pages/sales/OrderTemplates'
import WarehouseScanner from './pages/admin/WarehouseScanner'
import WarehouseReceiving from './pages/admin/WarehouseReceiving'
import BarcodeLabels from './pages/admin/BarcodeLabels'
import UnitProfile from './pages/admin/UnitProfile'
import UnknownProductRequest from './pages/admin/UnknownProductRequest'
import IntakeReview from './pages/admin/IntakeReview'
import StockAdjustment from './pages/admin/StockAdjustment'
import WarehouseReceipts from './pages/admin/WarehouseReceipts'
import PurchaseOrders from './pages/admin/PurchaseOrders'
import PurchaseOrderForm from './pages/admin/PurchaseOrderForm'
import ImportPurchaseOrders from './pages/admin/ImportPurchaseOrders'
import WarrantyCheckPage from './pages/public/WarrantyCheckPage'
import PurchaseOrderDetail from './pages/admin/PurchaseOrderDetail'
import Settings from './pages/admin/Settings'
import RolePermissions from './pages/admin/RolePermissions'
// Inventory hub (new)
import StockOverview from './pages/admin/StockOverview'
import StockLocations from './pages/admin/StockLocations'
import Suppliers from './pages/admin/Suppliers'
import ReceivingTasks from './pages/admin/ReceivingTasks'
import ReceivingTaskDetail from './pages/admin/ReceivingTaskDetail'
import WarrantyLookup from './pages/admin/WarrantyLookup'
import DiscrepancyQueue from './pages/admin/DiscrepancyQueue'
import StockTakes from './pages/admin/StockTakes'
import StockTakeSession from './pages/admin/StockTakeSession'
import Transfers from './pages/admin/Transfers'
import TransferDetail from './pages/admin/TransferDetail'

import NotFound from './pages/NotFound'

// Store pages
import ShopPage from './pages/store/ShopPage'
import ProductDetailPage from './pages/store/ProductDetailPage'

// Role groups used by the route guards.
const WAREHOUSE = ['STOCK_KEEPER', 'MANAGER', 'IT_ADMIN', 'DEVELOPER', 'OPERATIONS_MANAGER', 'PURCHASE_MANAGER', 'DIRECTOR']
const WAREHOUSE_WRITE = ['STOCK_KEEPER', 'MANAGER', 'IT_ADMIN', 'DEVELOPER', 'OPERATIONS_MANAGER']
const BUYING = ['PURCHASE_MANAGER', 'OPERATIONS_MANAGER', 'MANAGER', 'IT_ADMIN', 'DEVELOPER', 'DIRECTOR']
const SALES_VIEW_ALL = ['INSIDE_SALES', 'IT_ADMIN', 'DEVELOPER', 'MANAGER', 'DIRECTOR', 'OPERATIONS_MANAGER', 'PURCHASE_MANAGER']
const REPORTS = ['IT_ADMIN', 'DEVELOPER', 'MANAGER', 'INSIDE_SALES', 'DIRECTOR', 'OPERATIONS_MANAGER', 'PURCHASE_MANAGER']
const OVERSIGHT = ['DIRECTOR', 'OPERATIONS_MANAGER', 'MANAGER', 'IT_ADMIN', 'DEVELOPER']
const DISCREPANCY_ROLES = ['PURCHASE_MANAGER', 'OPERATIONS_MANAGER', 'MANAGER', 'DIRECTOR', 'IT_ADMIN', 'DEVELOPER']
const STOCK_TAKE_ROLES = ['STOCK_KEEPER', 'OPERATIONS_MANAGER', 'PURCHASE_MANAGER', 'MANAGER', 'IT_ADMIN', 'DEVELOPER']
const TRANSFER_ROLES = ['STOCK_KEEPER', 'OPERATIONS_MANAGER', 'PURCHASE_MANAGER', 'MANAGER', 'IT_ADMIN', 'DEVELOPER']

export default function App() {
  const { isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  return (
    <Routes>
      {/* Public Store */}
      <Route path="/shop" element={<Navigate to="/catalog" replace />} />
      <Route path="/catalog" element={<StoreLayout />}>
        <Route index element={<ShopPage />} />
        <Route path=":id" element={<ProductDetailPage />} />
      </Route>
      <Route path="/cart" element={<Navigate to="/catalog" replace />} />
      <Route path="/login" element={<Navigate to="/catalog" replace />} />
      <Route path="/register" element={<Navigate to="/catalog" replace />} />
      <Route path="/checkout" element={<Navigate to="/catalog" replace />} />
      <Route path="/order-confirmation/:id" element={<Navigate to="/catalog" replace />} />
      <Route path="/account/*" element={<Navigate to="/catalog" replace />} />

      {/*
        Public warranty check. Outside /app on purpose: a customer who scans the
        QR on a rod must never be bounced to a staff login. Both paths render the
        same page - bare for typing a code, and with the serial for a QR code.
      */}
      <Route path="/warranty" element={<WarrantyCheckPage />} />
      <Route path="/warranty/:code" element={<WarrantyCheckPage />} />

      {/* Internal App (Admin) */}
      <Route path="/app/login" element={<Login />} />
      <Route
        path="/app"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="change-password" element={<ChangePassword />} />
        <Route path="products" element={<ProductList />} />
        <Route path="products/:id" element={<ProductDetail />} />
        <Route path="sales/create" element={
          <ProtectedRoute requiredRole={['OUTSIDE_SALES', 'INSIDE_SALES']}>
            <CreateOrder />
          </ProtectedRoute>
        } />
        <Route path="sales/my-orders" element={
          <ProtectedRoute requiredRole="OUTSIDE_SALES">
            <MyOrders />
          </ProtectedRoute>
        } />
        <Route path="sales/customers" element={
          <ProtectedRoute requiredRole={['OUTSIDE_SALES', 'INSIDE_SALES']}>
            <SalesCustomerList />
          </ProtectedRoute>
        } />
        <Route path="sales/customers/new" element={
          <ProtectedRoute requiredRole={['OUTSIDE_SALES', 'INSIDE_SALES']}>
            <SalesCustomerForm />
          </ProtectedRoute>
        } />
        <Route path="sales/customers/:id/edit" element={
          <ProtectedRoute requiredRole={['OUTSIDE_SALES', 'INSIDE_SALES']}>
            <SalesCustomerForm />
          </ProtectedRoute>
        } />
        <Route path="sales/customers/:id/orders" element={
          <ProtectedRoute requiredRole={['OUTSIDE_SALES', 'INSIDE_SALES', 'IT_ADMIN', 'DEVELOPER', 'MANAGER', 'DIRECTOR', 'OPERATIONS_MANAGER']}>
            <CustomerOrderHistory />
          </ProtectedRoute>
        } />
        <Route path="sales/all-orders" element={
          <ProtectedRoute requiredRole={SALES_VIEW_ALL}>
            <AllOrders />
          </ProtectedRoute>
        } />
        <Route path="sales/orders/:id" element={<OrderDetail />} />
        <Route path="sales/orders/:id/review" element={
          <ProtectedRoute requiredRole={['INSIDE_SALES', 'IT_ADMIN', 'DEVELOPER', 'MANAGER', 'DIRECTOR', 'OPERATIONS_MANAGER']}>
            <ReviewOrder />
          </ProtectedRoute>
        } />
        <Route path="sales/orders/:id/edit" element={
          <ProtectedRoute requiredRole={['OUTSIDE_SALES', 'INSIDE_SALES']}>
            <EditDraftOrder />
          </ProtectedRoute>
        } />
        <Route path="sales/templates" element={
          <ProtectedRoute requiredRole="OUTSIDE_SALES">
            <OrderTemplates />
          </ProtectedRoute>
        } />

        {/* Inventory hub */}
        <Route path="warehouse" element={
          <ProtectedRoute requiredRole={WAREHOUSE}>
            <StockOverview />
          </ProtectedRoute>
        } />
        <Route path="warehouse/tasks" element={
          <ProtectedRoute requiredRole={WAREHOUSE}>
            <ReceivingTasks />
          </ProtectedRoute>
        } />
        <Route path="warehouse/tasks/:id" element={
          <ProtectedRoute requiredRole={WAREHOUSE}>
            <ReceivingTaskDetail />
          </ProtectedRoute>
        } />
        <Route path="warehouse/locations" element={
          <ProtectedRoute requiredRole={WAREHOUSE}>
            <StockLocations />
          </ProtectedRoute>
        } />
        <Route path="purchase-orders/suppliers" element={
          <ProtectedRoute requiredRole={BUYING}>
            <Suppliers />
          </ProtectedRoute>
        } />
        <Route path="warehouse/warranty" element={
          <ProtectedRoute requiredRole={WAREHOUSE}>
            <WarrantyLookup />
          </ProtectedRoute>
        } />
        <Route path="warehouse/scanner" element={
          <ProtectedRoute requiredRole={WAREHOUSE_WRITE}>
            <WarehouseScanner />
          </ProtectedRoute>
        } />
        <Route path="warehouse/receiving" element={
          <ProtectedRoute requiredRole={WAREHOUSE_WRITE}>
            <WarehouseReceiving />
          </ProtectedRoute>
        } />
        <Route path="warehouse/labels" element={
          <ProtectedRoute requiredRole={WAREHOUSE_WRITE}>
            <BarcodeLabels />
          </ProtectedRoute>
        } />
        <Route path="warehouse/units/:id" element={
          <ProtectedRoute requiredRole={WAREHOUSE}>
            <UnitProfile />
          </ProtectedRoute>
        } />
        <Route path="warehouse/unknown-product" element={
          <ProtectedRoute requiredRole={WAREHOUSE_WRITE}>
            <UnknownProductRequest />
          </ProtectedRoute>
        } />
        <Route path="warehouse/adjustment" element={
          <ProtectedRoute requiredRole={WAREHOUSE_WRITE}>
            <StockAdjustment />
          </ProtectedRoute>
        } />
        <Route path="warehouse/receipts" element={
          <ProtectedRoute requiredRole={WAREHOUSE}>
            <WarehouseReceipts />
          </ProtectedRoute>
        } />
        <Route path="warehouse/stock-takes" element={
          <ProtectedRoute requiredRole={STOCK_TAKE_ROLES}>
            <StockTakes />
          </ProtectedRoute>
        } />
        <Route path="warehouse/stock-takes/:id" element={
          <ProtectedRoute requiredRole={STOCK_TAKE_ROLES}>
            <StockTakeSession />
          </ProtectedRoute>
        } />
        <Route path="warehouse/transfers" element={
          <ProtectedRoute requiredRole={TRANSFER_ROLES}>
            <Transfers />
          </ProtectedRoute>
        } />
        <Route path="warehouse/transfers/:id" element={
          <ProtectedRoute requiredRole={TRANSFER_ROLES}>
            <TransferDetail />
          </ProtectedRoute>
        } />

        <Route path="purchase-orders" element={
          <ProtectedRoute requiredRole={BUYING}>
            <PurchaseOrders />
          </ProtectedRoute>
        } />
        <Route path="purchase-orders/discrepancies" element={
          <ProtectedRoute requiredRole={DISCREPANCY_ROLES}>
            <DiscrepancyQueue />
          </ProtectedRoute>
        } />
        <Route path="purchase-orders/new" element={
          <ProtectedRoute requiredRole={BUYING}>
            <PurchaseOrderForm />
          </ProtectedRoute>
        } />
        {/* Before `:id` on purpose — a dynamic segment would otherwise swallow
            this path and try to load a purchase order called "import". */}
        <Route path="purchase-orders/import" element={
          <ProtectedRoute requiredRole={BUYING}>
            <ImportPurchaseOrders />
          </ProtectedRoute>
        } />
        <Route path="purchase-orders/:id" element={
          <ProtectedRoute requiredRole={BUYING}>
            <PurchaseOrderDetail />
          </ProtectedRoute>
        } />
        <Route path="admin/intake-requests" element={
          <ProtectedRoute requiredRole={['MANAGER', 'IT_ADMIN', 'DEVELOPER', 'OPERATIONS_MANAGER', 'PURCHASE_MANAGER']}>
            <IntakeReview />
          </ProtectedRoute>
        } />
        <Route path="admin/users" element={
          <ProtectedRoute requiredRole={['IT_ADMIN', 'DEVELOPER']}>
            <UserList />
          </ProtectedRoute>
        } />
        <Route path="admin/users/new" element={
          <ProtectedRoute requiredRole={['IT_ADMIN', 'DEVELOPER']}>
            <UserForm />
          </ProtectedRoute>
        } />
        <Route path="admin/users/:id/edit" element={
          <ProtectedRoute requiredRole={['IT_ADMIN', 'DEVELOPER']}>
            <UserForm />
          </ProtectedRoute>
        } />
        <Route path="admin/products" element={
          <ProtectedRoute requiredRole={['IT_ADMIN', 'DEVELOPER', 'MANAGER', 'OPERATIONS_MANAGER']}>
            <ProductManagement />
          </ProtectedRoute>
        } />
        <Route path="admin/categories" element={
          <ProtectedRoute requiredRole={['IT_ADMIN', 'DEVELOPER', 'MANAGER', 'OPERATIONS_MANAGER']}>
            <CategoryManagement />
          </ProtectedRoute>
        } />
        <Route path="admin/products/new" element={
          <ProtectedRoute requiredRole={['IT_ADMIN', 'DEVELOPER', 'MANAGER', 'OPERATIONS_MANAGER']}>
            <ProductForm />
          </ProtectedRoute>
        } />
        <Route path="admin/products/:id/edit" element={
          <ProtectedRoute requiredRole={['IT_ADMIN', 'DEVELOPER', 'MANAGER', 'OPERATIONS_MANAGER']}>
            <ProductForm />
          </ProtectedRoute>
        } />
        <Route path="admin/products/:id/images" element={
          <ProtectedRoute requiredRole={['IT_ADMIN', 'DEVELOPER', 'MANAGER', 'OPERATIONS_MANAGER']}>
            <ProductImages />
          </ProtectedRoute>
        } />
        <Route path="admin/products/:id/prices" element={
          <ProtectedRoute requiredRole={['IT_ADMIN', 'DEVELOPER', 'MANAGER', 'OPERATIONS_MANAGER']}>
            <ProductPrices />
          </ProtectedRoute>
        } />
        <Route path="admin/customers" element={
          <ProtectedRoute requiredRole={['IT_ADMIN', 'INSIDE_SALES', 'OPERATIONS_MANAGER']}>
            <CustomerList />
          </ProtectedRoute>
        } />
        <Route path="admin/customers/new" element={
          <ProtectedRoute requiredRole={['IT_ADMIN', 'INSIDE_SALES', 'OPERATIONS_MANAGER']}>
            <CustomerForm />
          </ProtectedRoute>
        } />
        <Route path="admin/customers/:id/edit" element={
          <ProtectedRoute requiredRole={['IT_ADMIN', 'INSIDE_SALES', 'OPERATIONS_MANAGER']}>
            <CustomerForm />
          </ProtectedRoute>
        } />
        <Route path="admin/audit-logs" element={
          <ProtectedRoute requiredRole={['IT_ADMIN', 'DEVELOPER', 'DIRECTOR', 'OPERATIONS_MANAGER']}>
            <ActivityPage />
          </ProtectedRoute>
        } />
        <Route path="admin/activity" element={
          <ProtectedRoute requiredRole={['IT_ADMIN', 'DEVELOPER', 'DIRECTOR', 'OPERATIONS_MANAGER']}>
            <ActivityPage />
          </ProtectedRoute>
        } />
        <Route path="admin/salesman-map" element={
          <ProtectedRoute requiredRole={['IT_ADMIN', 'DEVELOPER', 'MANAGER']}>
            <SalesmanMap />
          </ProtectedRoute>
        } />
        <Route path="admin/reports" element={
          <ProtectedRoute requiredRole={REPORTS}>
            <ReportsPage />
          </ProtectedRoute>
        } />
        <Route path="admin/report-designer" element={
          <ProtectedRoute requiredRole={OVERSIGHT}>
            <ReportDesigner />
          </ProtectedRoute>
        } />
        <Route path="admin/customer-assignments" element={
          <Navigate to="/app/admin/customers" replace />
        } />
        <Route path="admin/settings" element={
          <ProtectedRoute requiredRole={['IT_ADMIN', 'DEVELOPER']}>
            <Settings />
          </ProtectedRoute>
        } />
        <Route path="admin/role-permissions" element={
          <ProtectedRoute requiredRole={['IT_ADMIN', 'DEVELOPER']}>
            <RolePermissions />
          </ProtectedRoute>
        } />
      </Route>

      {/* Default redirect to store */}
      <Route path="/" element={<Navigate to="/catalog" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
