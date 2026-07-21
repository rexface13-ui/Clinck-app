import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function ProtectedRoute({
  children,
  permission,
}: {
  children: React.ReactNode
  permission?: string
}) {
  const { data, loading, can } = useAuth()

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-ink/50">جارِ التحميل...</div>
  }

  if (!data) {
    return <Navigate to="/login" replace />
  }

  if (permission && !can(permission)) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
