import { useEffect, useState, type FormEvent } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faPen, faTrash } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { Card, PageHeader, Button, Input, Select, Table, Thead, Th, Td, Tr, EmptyRow, TableSkeleton } from '../components/ui'
import type { Service, ServiceCategory } from '../types'

export default function ServicesPage() {
  const { can } = useAuth()
  const [services, setServices] = useState<Service[] | null>(null)
  const [categories, setCategories] = useState<ServiceCategory[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [form, setForm] = useState({
    service_category_id: '',
    name: '',
    default_price: '',
    default_sessions: '1',
    default_interval_days: '',
    marks_teeth_missing: false,
  })
  const [error, setError] = useState<string | null>(null)

  function load() {
    api.get('/services').then((res) => setServices(res.data.data))
    api.get('/service-categories').then((res) => setCategories(res.data))
  }

  useEffect(load, [])

  async function addCategory() {
    if (!newCategoryName.trim()) return
    await api.post('/service-categories', { name: newCategoryName })
    setNewCategoryName('')
    load()
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const payload = {
      service_category_id: Number(form.service_category_id),
      name: form.name,
      default_price: Number(form.default_price),
      default_sessions: Number(form.default_sessions) || 1,
      default_interval_days: form.default_interval_days ? Number(form.default_interval_days) : null,
      marks_teeth_missing: form.marks_teeth_missing,
    }
    try {
      if (editingId) {
        await api.put(`/services/${editingId}`, payload)
      } else {
        await api.post('/services', payload)
      }
      closeForm()
      load()
    } catch {
      setError('تحقق من الحقول.')
    }
  }

  function closeForm() {
    setShowForm(false)
    setEditingId(null)
    setForm({ service_category_id: '', name: '', default_price: '', default_sessions: '1', default_interval_days: '', marks_teeth_missing: false })
  }

  function startEdit(s: Service) {
    setEditingId(s.id)
    setForm({
      service_category_id: String(s.service_category_id),
      name: s.name,
      default_price: s.default_price,
      default_sessions: String(s.default_sessions),
      default_interval_days: s.default_interval_days ? String(s.default_interval_days) : '',
      marks_teeth_missing: s.marks_teeth_missing,
    })
    setError(null)
    setShowForm(true)
  }

  async function deleteService(id: number) {
    if (!window.confirm('حذف هذه الخدمة نهائياً؟')) return
    try {
      await api.delete(`/services/${id}`)
      load()
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      window.alert(message ?? 'تعذّر حذف الخدمة.')
    }
  }

  const categoryName = (id: number) => categories.find((c) => c.id === id)?.name ?? '—'

  return (
    <div>
      <PageHeader
        title="الخدمات"
        subtitle="تصنيفات وأسعار الخدمات الافتراضية"
        action={
          can('services.manage') && (
            <Button onClick={() => (showForm ? closeForm() : setShowForm(true))}>
              <FontAwesomeIcon icon={faPlus} />
              خدمة جديدة
            </Button>
          )
        }
      />

      {can('services.manage') && (
        <Card className="mb-6 flex items-center gap-2 p-4">
          <input
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            placeholder="تصنيف جديد..."
            className="flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
          />
          <Button className="px-3 py-1.5" onClick={addCategory}>
            إضافة تصنيف
          </Button>
        </Card>
      )}

      {showForm && (
        <Card className="mb-6 p-6">
          <form onSubmit={handleCreate} className="grid grid-cols-2 gap-4">
            <Select
              label="التصنيف"
              required
              value={form.service_category_id}
              onChange={(e) => setForm({ ...form, service_category_id: e.target.value })}
            >
              <option value="">اختر تصنيفاً</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
            <Input
              label="اسم الخدمة"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <Input
              type="number"
              label="السعر الافتراضي (₪)"
              required
              value={form.default_price}
              onChange={(e) => setForm({ ...form, default_price: e.target.value })}
            />
            <Input
              type="number"
              label="عدد الجلسات الافتراضي"
              value={form.default_sessions}
              onChange={(e) => setForm({ ...form, default_sessions: e.target.value })}
            />
            <label className="col-span-2 flex items-center gap-2 text-sm text-ink/70">
              <input
                type="checkbox"
                checked={form.marks_teeth_missing}
                onChange={(e) => setForm({ ...form, marks_teeth_missing: e.target.checked })}
                className="size-3.5"
              />
              هاي الخدمة بتخلع/بتشيل السن (خلع أسنان مثلاً) — لما تتم، السن بيصير "مفقود" تلقائياً بالرسمة
            </label>

            {error && <p className="col-span-2 text-sm text-danger">{error}</p>}

            <div className="col-span-2 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={closeForm}>
                إلغاء
              </Button>
              <Button type="submit">{editingId ? 'حفظ التعديل' : 'حفظ'}</Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        {!services ? (
          <TableSkeleton />
        ) : (
          <Table>
            <Thead>
              <Th>التصنيف</Th>
              <Th>الخدمة</Th>
              <Th>السعر</Th>
              <Th>الجلسات</Th>
              <Th></Th>
            </Thead>
            <tbody>
              {services.length === 0 ? (
                <EmptyRow colSpan={5}>لا توجد خدمات بعد.</EmptyRow>
              ) : (
                services.map((s) => (
                  <Tr key={s.id}>
                    <Td className="text-muted">{categoryName(s.service_category_id)}</Td>
                    <Td>{s.name}</Td>
                    <Td className="text-muted">{s.default_price} {s.default_currency}</Td>
                    <Td className="text-muted">{s.default_sessions}</Td>
                    <Td>
                      {can('services.manage') && (
                        <div className="flex items-center gap-3">
                          <button onClick={() => startEdit(s)} className="text-xs text-accent hover:underline">
                            <FontAwesomeIcon icon={faPen} />
                          </button>
                          <button onClick={() => deleteService(s.id)} className="text-xs text-danger hover:underline">
                            <FontAwesomeIcon icon={faTrash} />
                          </button>
                        </div>
                      )}
                    </Td>
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
