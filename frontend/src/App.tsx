import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import LoadingSpinner from './components/LoadingSpinner'
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
import UserList from './pages/admin/UserList'
import UserForm from './pages/admin/UserForm'
import ProductManagement from './pages/admin/ProductManagement'
import ProductForm from './pages/admin/ProductForm'
import ProductImages from './pages/admin/ProductImages'
import CustomerList from './pages/admin/CustomerList'
import CustomerForm from './pages/admin/CustomerForm'
import AuditLogList from './pages/admin/AuditLogList'
import Settings from './pages/admin/Settings'
import RolePermissions from './pages/admin/RolePermissions'

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
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
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
          <ProtectedRoute requiredRole="OUTSIDE_SALES">
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
        <Route path="sales/all-orders" element={
          <ProtectedRoute requiredRole={['INSIDE_SALES', 'IT_ADMIN', 'DEVELOPER']}>
            <AllOrders />
          </ProtectedRoute>
        } />
        <Route path="sales/orders/:id" element={<OrderDetail />} />
        <Route path="sales/orders/:id/review" element={
          <ProtectedRoute requiredRole={['INSIDE_SALES', 'IT_ADMIN', 'DEVELOPER']}>
            <ReviewOrder />
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
          <ProtectedRoute requiredRole={['IT_ADMIN', 'DEVELOPER']}>
            <ProductManagement />
          </ProtectedRoute>
        } />
        <Route path="admin/products/new" element={
          <ProtectedRoute requiredRole={['IT_ADMIN', 'DEVELOPER']}>
            <ProductForm />
          </ProtectedRoute>
        } />
        <Route path="admin/products/:id/edit" element={
          <ProtectedRoute requiredRole={['IT_ADMIN', 'DEVELOPER']}>
            <ProductForm />
          </ProtectedRoute>
        } />
        <Route path="admin/products/:id/images" element={
          <ProtectedRoute requiredRole={['IT_ADMIN', 'DEVELOPER']}>
            <ProductImages />
          </ProtectedRoute>
        } />
        <Route path="admin/customers" element={
          <ProtectedRoute requiredRole={['IT_ADMIN', 'INSIDE_SALES']}>
            <CustomerList />
          </ProtectedRoute>
        } />
        <Route path="admin/customers/new" element={
          <ProtectedRoute requiredRole={['IT_ADMIN', 'INSIDE_SALES']}>
            <CustomerForm />
          </ProtectedRoute>
        } />
        <Route path="admin/customers/:id/edit" element={
          <ProtectedRoute requiredRole={['IT_ADMIN', 'INSIDE_SALES']}>
            <CustomerForm />
          </ProtectedRoute>
        } />
        <Route path="admin/audit-logs" element={
          <ProtectedRoute requiredRole={['IT_ADMIN', 'DEVELOPER']}>
            <AuditLogList />
          </ProtectedRoute>
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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
