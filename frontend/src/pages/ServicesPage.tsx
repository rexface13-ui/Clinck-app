import { useEffect, useState, type FormEvent } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import type { Service, ServiceCategory } from '../types'

export default function ServicesPage() {
  const { can } = useAuth()
  const [services, setServices] = useState<Service[]>([])
  const [categories, setCategories] = useState<ServiceCategory[]>([])
  const [showForm, setShowForm] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [form, setForm] = useState({
    service_category_id: '',
    name: '',
    default_price: '',
    default_sessions: '1',
    default_interval_days: '',
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
    try {
      await api.post('/services', {
        service_category_id: Number(form.service_category_id),
        name: form.name,
        default_price: Number(form.default_price),
        default_sessions: Number(form.default_sessions) || 1,
        default_interval_days: form.default_interval_days ? Number(form.default_interval_days) : null,
      })
      setShowForm(false)
      setForm({ service_category_id: '', name: '', default_price: '', default_sessions: '1', default_interval_days: '' })
      load()
    } catch {
      setError('تحقق من الحقول.')
    }
  }

  const categoryName = (id: number) => categories.find((c) => c.id === id)?.name ?? '—'

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink">الخدمات</h1>
        {can('services.manage') && (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
          >
            <FontAwesomeIcon icon={faPlus} />
            خدمة جديدة
          </button>
        )}
      </div>

      {can('services.manage') && (
        <div className="mb-6 flex items-center gap-2 rounded-xl bg-white p-4 shadow-sm">
          <input
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            placeholder="تصنيف جديد..."
            className="flex-1 rounded-lg border border-ink/10 px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
          />
          <button onClick={addCategory} className="rounded-lg bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover">
            إضافة تصنيف
          </button>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="mb-6 grid grid-cols-2 gap-4 rounded-xl bg-white p-6 shadow-sm">
          <div>
            <label className="mb-1 block text-sm text-ink/70">التصنيف</label>
            <select
              required
              value={form.service_category_id}
              onChange={(e) => setForm({ ...form, service_category_id: e.target.value })}
              className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm focus:border-accent focus:outline-none"
            >
              <option value="">اختر تصنيفاً</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-ink/70">اسم الخدمة</label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-ink/70">السعر الافتراضي (₪)</label>
            <input
              type="number"
              required
              value={form.default_price}
              onChange={(e) => setForm({ ...form, default_price: e.target.value })}
              className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-ink/70">عدد الجلسات الافتراضي</label>
            <input
              type="number"
              value={form.default_sessions}
              onChange={(e) => setForm({ ...form, default_sessions: e.target.value })}
              className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
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
              <th className="p-4 font-medium">التصنيف</th>
              <th className="p-4 font-medium">الخدمة</th>
              <th className="p-4 font-medium">السعر</th>
              <th className="p-4 font-medium">الجلسات</th>
            </tr>
          </thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.id} className="border-b border-ink/5 last:border-0">
                <td className="p-4 text-ink/70">{categoryName(s.service_category_id)}</td>
                <td className="p-4">{s.name}</td>
                <td className="p-4 text-ink/70">{s.default_price} {s.default_currency}</td>
                <td className="p-4 text-ink/70">{s.default_sessions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
