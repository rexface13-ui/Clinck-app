import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTooth } from '@fortawesome/free-solid-svg-icons'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../lib/api'
import { Card, Button, Input } from '../components/ui'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('owner')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Not authenticated yet here, so branding can't come from the normal
  // bootstrap payload — fetched separately from the one public endpoint.
  const [branding, setBranding] = useState<{ clinic_name?: string; clinic_logo?: string }>({})

  useEffect(() => {
    api.get<{ clinic_name?: string; clinic_logo?: string }>('/branding').then((res) => setBranding(res.data)).catch(() => {})
  }, [])

  const clinicName = branding.clinic_name || 'DentaFlow'

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(username, password)
      navigate('/')
    } catch {
      setError('بيانات الدخول غير صحيحة.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm p-8">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          {branding.clinic_logo ? (
            <img src={branding.clinic_logo} alt={clinicName} className="size-14 rounded-2xl object-cover shadow-sm" />
          ) : (
            <span className="flex size-14 items-center justify-center rounded-2xl bg-accent text-2xl text-white shadow-sm">
              <FontAwesomeIcon icon={faTooth} />
            </span>
          )}
          <div>
            <h1 className="text-xl font-semibold text-ink">{clinicName}</h1>
            <p className="text-sm text-muted">نظام إدارة العيادة السنية</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            type="text"
            label="اسم المستخدم"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <Input
            type="password"
            label="كلمة المرور"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          {error && <p className="text-sm text-danger">{error}</p>}

          <Button type="submit" loading={submitting} className="w-full justify-center">
            {submitting ? 'جارِ الدخول...' : 'دخول'}
          </Button>
        </form>
      </Card>
    </main>
  )
}
