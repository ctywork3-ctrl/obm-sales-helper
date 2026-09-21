import { useState, useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import MobileNav from './MobileNav'
import CommandPalette from './CommandPalette'
import NotificationBell from './NotificationBell'
import { useAuth } from '@/hooks/useAuth'
import { useGeolocation } from '@/hooks/useGeolocation'
import { LogOut, User, Search, MapPin } from 'lucide-react'

export default function Layout() {
  const { user, logout } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { sendLocation, startHeartbeat, stopHeartbeat } = useGeolocation()
  const [locationShared, setLocationShared] = useState(false)

  useEffect(() => {
    sendLocation('APP_OPEN')
    startHeartbeat(300000)
    setLocationShared(true)
    return () => stopHeartbeat()
  }, [])

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center justify-between border-b bg-white px-4 shadow-sm sm:px-6">
          <button
            onClick={() => setSidebarOpen(true)}
            className="md:hidden"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <div className="flex items-center gap-4 ml-auto">
            <button
              onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
              className="hidden items-center gap-2 rounded-md border bg-white px-3 py-1.5 text-sm text-gray-400 hover:bg-gray-50 sm:flex"
            >
              <Search className="h-3.5 w-3.5" />
              <span>Search...</span>
              <kbd className="ml-2 rounded border bg-gray-100 px-1 text-[10px]">⌘K</kbd>
            </button>
            <NotificationBell />
            {locationShared && (
              <span className="hidden items-center gap-1 text-xs text-green-600 sm:flex" title="Location is being shared">
                <MapPin className="h-3 w-3" />
                Location
              </span>
            )}
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <User className="h-4 w-4" />
              </div>
              <div className="hidden sm:block">
                <p className="text-sm font-medium">{user?.full_name}</p>
                <p className="text-xs text-muted-foreground">{user?.role?.replace(/_/g, ' ')}</p>
              </div>
            </div>
            <button
              onClick={logout}
              className="inline-flex h-8 items-center justify-center rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>

      <MobileNav open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <CommandPalette />
    </div>
  )
}
