import { createContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import type { AuthUser } from '@/types'
import { authApi } from '@/api/auth'

interface AuthContextType {
  user: AuthUser | null
  isLoading: boolean
  isAuthenticated: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  hasPermission: (permission: string) => boolean
  refreshUser: () => Promise<void>
}

export const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  login: async () => {},
  logout: async () => {},
  hasPermission: () => false,
  refreshUser: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const refreshUser = useCallback(async () => {
    try {
      const response = await authApi.getMe()
      setUser(response.data.user)
    } catch {
      setUser(null)
    }
  }, [])

  useEffect(() => {
    const initAuth = async () => {
      try {
        await refreshUser()
      } finally {
        setIsLoading(false)
      }
    }
    initAuth()
  }, [refreshUser])

  const login = async (username: string, password: string) => {
    const response = await authApi.login({ username, password })
    setUser(response.data.user)
  }

  const logout = async () => {
    try {
      await authApi.logout()
    } finally {
      setUser(null)
      window.location.href = '/login'
    }
  }

  const hasPermission = (permission: string) => {
    if (!user) return false
    if (user.role === 'IT_ADMIN' || user.role === 'DEVELOPER') return true
    return user.permissions?.includes(permission) ?? false
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        logout,
        hasPermission,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
