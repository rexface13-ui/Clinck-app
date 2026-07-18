import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { data, loading } = useAuth()

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-ink/50">جارِ التحميل...</div>
  }

  if (!data) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
