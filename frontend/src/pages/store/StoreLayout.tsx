import { useState } from 'react'
import { Outlet, Link, useNavigate } from 'react-router-dom'
import { Menu, X, Search, Fish, BriefcaseBusiness } from 'lucide-react'

export default function StoreLayout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const navigate = useNavigate()

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (searchQuery.trim()) {
       navigate(`/catalog?search=${encodeURIComponent(searchQuery.trim())}`)
      setSearchQuery('')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-white shadow-sm">
        <div className="mx-auto max-w-7xl px-4">
          <div className="flex h-16 items-center justify-between gap-4">
            {/* Logo */}
            <Link to="/catalog" className="flex items-center gap-2 flex-shrink-0">
              <Fish className="h-8 w-8 text-blue-600" />
              <span className="text-xl font-bold hidden sm:block">Tackle Box</span>
            </Link>

            {/* Search */}
            <form onSubmit={handleSearch} className="flex-1 max-w-xl">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search fishing gear..."
                  className="w-full rounded-lg border bg-gray-50 py-2 pl-10 pr-4 text-sm focus:border-blue-500 focus:bg-white focus:outline-none"
                />
              </div>
            </form>

            {/* Nav */}
            <nav className="hidden md:flex items-center gap-6">
              <Link to="/catalog" className="text-sm font-medium text-gray-700 hover:text-blue-600">
                Catalog
              </Link>
              <Link to="/app/login" className="flex items-center gap-1 text-sm font-medium text-gray-700 hover:text-blue-600">
                <BriefcaseBusiness className="h-4 w-4" />
                Staff Login
              </Link>
            </nav>

            {/* Mobile menu toggle */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-md hover:bg-gray-100"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="border-t md:hidden">
            <div className="space-y-1 px-4 py-3">
              <Link to="/catalog" className="block rounded-md px-3 py-2 text-sm font-medium hover:bg-gray-100" onClick={() => setMobileMenuOpen(false)}>
                Catalog
              </Link>
              <Link to="/app/login" className="block rounded-md px-3 py-2 text-sm font-medium hover:bg-gray-100" onClick={() => setMobileMenuOpen(false)}>
                Staff Login
              </Link>
            </div>
          </div>
        )}
      </header>

      {/* Main */}
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="border-t bg-white mt-12">
        <div className="mx-auto max-w-7xl px-4 py-8">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Fish className="h-6 w-6 text-blue-600" />
                <span className="font-bold">Tackle Box</span>
              </div>
              <p className="text-sm text-gray-500">
                Browse fishing tackle and equipment, then place orders through the staff sales workspace.
              </p>
            </div>
            <div>
               <h3 className="font-semibold mb-3">Catalog</h3>
              <ul className="space-y-2 text-sm text-gray-500">
                 <li><Link to="/catalog" className="hover:text-blue-600">All Products</Link></li>
                 <li><Link to="/catalog?category=Equipment" className="hover:text-blue-600">Equipment</Link></li>
                 <li><Link to="/catalog?category=Accessories" className="hover:text-blue-600">Accessories</Link></li>
                 <li><Link to="/catalog?category=Consumables" className="hover:text-blue-600">Consumables</Link></li>
              </ul>
            </div>
             <div>
               <h3 className="font-semibold mb-3">Staff</h3>
               <ul className="space-y-2 text-sm text-gray-500">
                 <li><Link to="/app/login" className="hover:text-blue-600">Staff Login</Link></li>
                 <li><Link to="/app" className="hover:text-blue-600">Operations Dashboard</Link></li>
               </ul>
             </div>
            <div>
              <h3 className="font-semibold mb-3">Contact</h3>
              <ul className="space-y-2 text-sm text-gray-500">
                <li>Phone: +60 12-345 6789</li>
                <li>Email: info@tacklebox.my</li>
                <li>Address: Kuala Lumpur, Malaysia</li>
              </ul>
            </div>
          </div>
          <div className="mt-8 border-t pt-4 text-center text-xs text-gray-400">
            &copy; {new Date().getFullYear()} Tackle Box. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  )
}
