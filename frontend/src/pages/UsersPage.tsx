import { useEffect, useState, type FormEvent } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import type { Branch } from '../types'

interface UserRow {
  id: number
  name: string
  email: string
  is_active: boolean
  roles: string[]
  branches: { id: number; name: string }[]
}

export default function UsersPage() {
  const { data, can } = useAuth()
  const branches: Branch[] = data?.branches ?? []
  const [users, setUsers] = useState<UserRow[]>([])
  const [roles, setRoles] = useState<string[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    roles: [] as string[],
    branch_ids: [] as number[],
  })
  const [error, setError] = useState<string | null>(null)

  function load() {
    api.get('/users').then((res) => setUsers(res.data.data))
    api.get('/roles').then((res) => setRoles(res.data))
  }

  useEffect(load, [])

  function toggle<T>(arr: T[], value: T): T[] {
    return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value]
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await api.post('/users', form)
      setShowForm(false)
      setForm({ name: '', email: '', password: '', roles: [], branch_ids: [] })
      load()
    } catch {
      setError('تحقق من الحقول (البريد فريد، كلمة مرور 8 أحرف على الأقل).')
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink">المستخدمون</h1>
        {can('users.manage') && (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
          >
            <FontAwesomeIcon icon={faPlus} />
            مستخدم جديد
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mb-6 grid grid-cols-2 gap-4 rounded-xl bg-white p-6 shadow-sm">
          <div>
            <label className="mb-1 block text-sm text-ink/70">الاسم</label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-ink/70">البريد الإلكتروني</label>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-ink/70">كلمة المرور</label>
            <input
              type="password"
              required
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-ink/70">الأدوار</label>
            <div className="flex flex-wrap gap-2">
              {roles.map((r) => (
                <button
                  type="button"
                  key={r}
                  onClick={() => setForm({ ...form, roles: toggle(form.roles, r) })}
                  className={`rounded-lg border px-2 py-1 text-xs ${
                    form.roles.includes(r) ? 'border-accent bg-accent text-white' : 'border-ink/10 text-ink/70'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="col-span-2">
            <label className="mb-1 block text-sm text-ink/70">الفروع</label>
            <div className="flex flex-wrap gap-2">
              {branches.map((b) => (
                <button
                  type="button"
                  key={b.id}
                  onClick={() => setForm({ ...form, branch_ids: toggle(form.branch_ids, b.id) })}
                  className={`rounded-lg border px-2 py-1 text-xs ${
                    form.branch_ids.includes(b.id) ? 'border-accent bg-accent text-white' : 'border-ink/10 text-ink/70'
                  }`}
                >
                  {b.name}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="col-span-2 text-sm text-danger">{error}</p>}

          <div className="col-span-2 flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="rounded-xl px-4 py-2 text-sm text-ink/70 hover:bg-background">
              إلغاء
            </button>
            <button type="submit" className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover">
              حفظ
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-right text-ink/60">
              <th className="p-4 font-medium">الاسم</th>
              <th className="p-4 font-medium">البريد</th>
              <th className="p-4 font-medium">الأدوار</th>
              <th className="p-4 font-medium">الفروع</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-ink/5 last:border-0">
                <td className="p-4">{u.name}</td>
                <td className="p-4 text-ink/70">{u.email}</td>
                <td className="p-4 text-ink/70">{u.roles.join(', ')}</td>
                <td className="p-4 text-ink/70">{u.branches.map((b) => b.name).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
