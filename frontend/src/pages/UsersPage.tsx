import { useEffect, useState, type FormEvent } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { Card, PageHeader, Button, Input, Table, Thead, Th, Td, Tr, EmptyRow, TableSkeleton } from '../components/ui'
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
  const [users, setUsers] = useState<UserRow[] | null>(null)
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
      <PageHeader
        title="المستخدمون"
        subtitle="إدارة حسابات فريق العيادة وصلاحياتهم"
        action={
          can('users.manage') && (
            <Button onClick={() => setShowForm((v) => !v)}>
              <FontAwesomeIcon icon={faPlus} />
              مستخدم جديد
            </Button>
          )
        }
      />

      {showForm && (
        <Card className="mb-6 p-6">
          <form onSubmit={handleCreate} className="grid grid-cols-2 gap-4">
            <Input label="الاسم" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input
              type="email"
              label="البريد الإلكتروني"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <Input
              type="password"
              label="كلمة المرور"
              required
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <div>
              <label className="mb-1 block text-sm text-muted">الأدوار</label>
              <div className="flex flex-wrap gap-2">
                {roles.map((r) => (
                  <button
                    type="button"
                    key={r}
                    onClick={() => setForm({ ...form, roles: toggle(form.roles, r) })}
                    className={`rounded-lg border px-2 py-1 text-xs ${
                      form.roles.includes(r) ? 'border-accent bg-accent text-white' : 'border-border text-ink/70'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-sm text-muted">الفروع</label>
              <div className="flex flex-wrap gap-2">
                {branches.map((b) => (
                  <button
                    type="button"
                    key={b.id}
                    onClick={() => setForm({ ...form, branch_ids: toggle(form.branch_ids, b.id) })}
                    className={`rounded-lg border px-2 py-1 text-xs ${
                      form.branch_ids.includes(b.id) ? 'border-accent bg-accent text-white' : 'border-border text-ink/70'
                    }`}
                  >
                    {b.name}
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="col-span-2 text-sm text-danger">{error}</p>}

            <div className="col-span-2 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
                إلغاء
              </Button>
              <Button type="submit">حفظ</Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        {!users ? (
          <TableSkeleton />
        ) : (
          <Table>
            <Thead>
              <Th>الاسم</Th>
              <Th>البريد</Th>
              <Th>الأدوار</Th>
              <Th>الفروع</Th>
            </Thead>
            <tbody>
              {users.length === 0 ? (
                <EmptyRow colSpan={4}>لا يوجد مستخدمون بعد.</EmptyRow>
              ) : (
                users.map((u) => (
                  <Tr key={u.id}>
                    <Td>{u.name}</Td>
                    <Td className="text-muted">{u.email}</Td>
                    <Td className="text-muted">{u.roles.join(', ')}</Td>
                    <Td className="text-muted">{u.branches.map((b) => b.name).join(', ')}</Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}
