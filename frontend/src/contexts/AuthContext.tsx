import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, authApi } from '../lib/api'
import type { BootstrapData } from '../types'

interface AuthContextValue {
  data: BootstrapData | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  can: (permission: string) => boolean
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<BootstrapData | null>(null)
  const [loading, setLoading] = useState(true)

  const loadBootstrap = async () => {
    try {
      const res = await api.get<BootstrapData>('/bootstrap')
      setData(res.data)
    } catch {
      setData(null)
    }
  }

  useEffect(() => {
    loadBootstrap().finally(() => setLoading(false))
  }, [])

  const login = async (username: string, password: string) => {
    await authApi.get('/sanctum/csrf-cookie')
    await authApi.post('/login', { username, password })
    await loadBootstrap()
  }

  const logout = async () => {
    await authApi.post('/logout')
    setData(null)
  }

  const can = (permission: string) => data?.permissions.includes(permission) ?? false

  return (
    <AuthContext.Provider value={{ data, loading, login, logout, can, refresh: loadBootstrap }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
