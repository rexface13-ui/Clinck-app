import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTooth } from '@fortawesome/free-solid-svg-icons'
import { useAuth } from '../contexts/AuthContext'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('owner@dentaflow.local')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(email, password)
      navigate('/patients')
    } catch {
      setError('بيانات الدخول غير صحيحة.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-xl bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-white">
            <FontAwesomeIcon icon={faTooth} />
          </span>
          <h1 className="text-xl font-semibold text-ink">DentaFlow</h1>
        </div>

        <label className="mb-1 block text-sm text-ink/70">البريد الإلكتروني</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="mb-4 w-full rounded-xl border border-ink/10 px-3 py-2 text-sm focus:border-accent focus:outline-none"
        />

        <label className="mb-1 block text-sm text-ink/70">كلمة المرور</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="mb-4 w-full rounded-xl border border-ink/10 px-3 py-2 text-sm focus:border-accent focus:outline-none"
        />

        {error && <p className="mb-4 text-sm text-danger">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-xl bg-accent py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
        >
          {submitting ? 'جارِ الدخول...' : 'دخول'}
        </button>
      </form>
    </main>
  )
}
