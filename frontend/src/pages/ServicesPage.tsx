import { useEffect, useState, type FormEvent } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faPen, faTrash, faListCheck } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { Card, PageHeader, Button, Input, Select, Modal, Table, Thead, Th, Td, Tr, EmptyRow, TableSkeleton } from '../components/ui'
import type { Service, ServiceCategory } from '../types'

interface StepDraft {
  title: string
  price: string
  fields: string[]
}

function StepsModal({ service, onClose, onSaved }: { service: Service; onClose: () => void; onSaved: () => void }) {
  const [steps, setSteps] = useState<StepDraft[]>(
    service.steps && service.steps.length > 0
      ? service.steps.map((s) => ({ title: s.title, price: s.price, fields: s.fields.map((f) => f.label) }))
      : [],
  )
  const [saving, setSaving] = useState(false)

  function addStep() {
    setSteps([...steps, { title: '', price: '0', fields: [] }])
  }

  function updateStep(i: number, patch: Partial<StepDraft>) {
    setSteps(steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  }

  function removeStep(i: number) {
    setSteps(steps.filter((_, idx) => idx !== i))
  }

  function addField(i: number) {
    updateStep(i, { fields: [...steps[i].fields, ''] })
  }

  function updateField(i: number, j: number, label: string) {
    updateStep(i, { fields: steps[i].fields.map((f, idx) => (idx === j ? label : f)) })
  }

  function removeField(i: number, j: number) {
    updateStep(i, { fields: steps[i].fields.filter((_, idx) => idx !== j) })
  }

  async function save() {
    setSaving(true)
    try {
      await api.put(`/services/${service.id}/steps`, {
        steps: steps
          .filter((s) => s.title.trim())
          .map((s) => ({ title: s.title, price: Number(s.price) || 0, fields: s.fields.filter((f) => f.trim()).map((label) => ({ label })) })),
      })
      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={`خطوات — ${service.name}`} onClose={onClose} width="w-[640px]">
      <p className="mb-4 text-xs text-muted">
        كل خطوة إلها عنوان وسعر ثابت وحقول إدخال حرة (تُعبّى لكل سن وقت تنفيذ الشغل). السعر بينضاف عالفاتورة أول ما توصف الخطوة "تمت".
      </p>
      <div className="space-y-3">
        {steps.map((step, i) => (
          <div key={i} className="rounded-xl border border-border p-3">
            <div className="mb-2 flex items-center gap-2">
              <input
                value={step.title}
                onChange={(e) => updateStep(i, { title: e.target.value })}
                placeholder="عنوان الخطوة (مثلاً: أخذ القياسات)"
                className="flex-1 rounded-lg border border-border px-2 py-1.5 text-sm"
              />
              <input
                type="number"
                value={step.price}
                onChange={(e) => updateStep(i, { price: e.target.value })}
                placeholder="السعر"
                className="w-24 rounded-lg border border-border px-2 py-1.5 text-sm"
              />
              <span className="text-xs text-muted">₪</span>
              <button onClick={() => removeStep(i)} className="text-danger hover:underline">
                <FontAwesomeIcon icon={faTrash} />
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {step.fields.map((f, j) => (
                <div key={j} className="flex items-center gap-1">
                  <input
                    value={f}
                    onChange={(e) => updateField(i, j, e.target.value)}
                    placeholder="اسم الحقل"
                    className="w-28 rounded-lg border border-border px-2 py-1 text-xs"
                  />
                  <button onClick={() => removeField(i, j)} className="text-xs text-danger">×</button>
                </div>
              ))}
              <button onClick={() => addField(i)} className="text-xs text-accent hover:underline">
                + حقل
              </button>
            </div>
          </div>
        ))}
        <button onClick={addStep} className="w-full rounded-xl border border-dashed border-border py-2 text-sm text-muted hover:border-accent hover:text-accent">
          <FontAwesomeIcon icon={faPlus} /> إضافة خطوة
        </button>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>إلغاء</Button>
        <Button onClick={save} loading={saving}>حفظ الخطوات</Button>
      </div>
    </Modal>
  )
}

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
    price_per_tooth: true,
  })
  const [error, setError] = useState<string | null>(null)
  const [editingStepsFor, setEditingStepsFor] = useState<Service | null>(null)

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
      price_per_tooth: form.price_per_tooth,
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
    setForm({ service_category_id: '', name: '', default_price: '', default_sessions: '1', default_interval_days: '', marks_teeth_missing: false, price_per_tooth: true })
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
      price_per_tooth: s.price_per_tooth,
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
            <label className="col-span-2 flex items-center gap-2 text-sm text-ink/70">
              <input
                type="checkbox"
                checked={form.price_per_tooth}
                onChange={(e) => setForm({ ...form, price_per_tooth: e.target.checked })}
                className="size-3.5"
              />
              احسب سعر كل خطوة لكل سن لحاله (لو مطفّي، سعر الخطوة مرة وحدة بغض النظر عن عدد الأسنان)
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
                          <button onClick={() => setEditingStepsFor(s)} title="خطوات الخدمة" className="text-xs text-ink/60 hover:text-accent hover:underline">
                            <FontAwesomeIcon icon={faListCheck} /> خطوات ({s.steps?.length ?? 0})
                          </button>
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

      {editingStepsFor && (
        <StepsModal service={editingStepsFor} onClose={() => setEditingStepsFor(null)} onSaved={load} />
      )}
    </div>
  )
}
