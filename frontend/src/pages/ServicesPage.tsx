import { useEffect, useState, type FormEvent } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faPen, faTrash } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { Card, PageHeader, Button, Input, Table, Thead, Th, Td, Tr, EmptyRow, TableSkeleton } from '../components/ui'
import type { Service } from '../types'

interface StepDraft {
  title: string
  price: string
  fields: string[]
}

function StepsEditor({ steps, onChange }: { steps: StepDraft[]; onChange: (steps: StepDraft[]) => void }) {
  function addStep() {
    onChange([...steps, { title: '', price: '0', fields: [] }])
  }

  function updateStep(i: number, patch: Partial<StepDraft>) {
    onChange(steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  }

  function removeStep(i: number) {
    onChange(steps.filter((_, idx) => idx !== i))
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

  return (
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
            <button type="button" onClick={() => removeStep(i)} className="text-danger hover:underline">
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
                <button type="button" onClick={() => removeField(i, j)} className="text-xs text-danger">×</button>
              </div>
            ))}
            <button type="button" onClick={() => addField(i)} className="text-xs text-accent hover:underline">
              + حقل
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={addStep}
        className="w-full rounded-xl border border-dashed border-border py-2 text-sm text-muted hover:border-accent hover:text-accent"
      >
        <FontAwesomeIcon icon={faPlus} /> إضافة خطوة
      </button>
    </div>
  )
}

const DEFAULT_COLOR = '#3b82f6'
const COLOR_PRESETS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4', '#ec4899', '#78716c']

const emptyForm = {
  name: '',
  default_price: '',
  marks_teeth_missing: false,
  allows_missing_teeth: false,
  price_per_tooth: true,
  color: DEFAULT_COLOR,
  spans_teeth: false,
}

export default function ServicesPage() {
  const { can } = useAuth()
  const [services, setServices] = useState<Service[] | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [steps, setSteps] = useState<StepDraft[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function load() {
    api.get('/services').then((res) => setServices(res.data.data))
  }

  useEffect(load, [])

  const stepsTotal = steps.reduce((sum, s) => sum + (Number(s.price) || 0), 0)
  const priceExceeded = stepsTotal > (Number(form.default_price) || 0)

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (priceExceeded) {
      setError('مجموع أسعار الخطوات أكبر من سعر الخدمة.')
      return
    }

    const payload = {
      name: form.name,
      default_price: Number(form.default_price),
      default_sessions: 1,
      default_interval_days: null,
      marks_teeth_missing: form.marks_teeth_missing,
      allows_missing_teeth: form.allows_missing_teeth,
      price_per_tooth: form.price_per_tooth,
      color: form.color,
      spans_teeth: form.spans_teeth,
    }
    setSaving(true)
    try {
      const serviceId = editingId ?? (await api.post('/services', payload)).data.data.id
      if (editingId) {
        await api.put(`/services/${editingId}`, payload)
      }

      const stepsToSave = steps.filter((s) => s.title.trim())
      if (stepsToSave.length > 0 || (editingId && steps.length === 0)) {
        await api.put(`/services/${serviceId}/steps`, {
          steps: stepsToSave.map((s) => ({
            title: s.title,
            price: Number(s.price) || 0,
            fields: s.fields.filter((f) => f.trim()).map((label) => ({ label })),
          })),
        })
      }

      closeForm()
      load()
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      setError(message ?? 'تحقق من الحقول.')
    } finally {
      setSaving(false)
    }
  }

  function closeForm() {
    setShowForm(false)
    setEditingId(null)
    setForm(emptyForm)
    setSteps([])
    setError(null)
  }

  function startEdit(s: Service) {
    setEditingId(s.id)
    setForm({
      name: s.name,
      default_price: s.default_price,
      marks_teeth_missing: s.marks_teeth_missing,
      allows_missing_teeth: s.allows_missing_teeth,
      price_per_tooth: s.price_per_tooth,
      color: s.color ?? DEFAULT_COLOR,
      spans_teeth: s.spans_teeth,
    })
    setSteps(s.steps && s.steps.length > 0 ? s.steps.map((step) => ({ title: step.title, price: step.price, fields: step.fields.map((f) => f.label) })) : [])
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

  return (
    <div>
      <PageHeader
        title="الخدمات"
        subtitle="أسعار الخدمات وخطوات العمل الافتراضية"
        action={
          can('services.manage') && (
            <Button onClick={() => (showForm ? closeForm() : setShowForm(true))}>
              <FontAwesomeIcon icon={faPlus} />
              خدمة جديدة
            </Button>
          )
        }
      />

      {showForm && (
        <Card className="mb-6 p-6">
          <form onSubmit={handleCreate}>
            <div className="grid grid-cols-2 gap-4">
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
                  checked={form.allows_missing_teeth}
                  onChange={(e) => setForm({ ...form, allows_missing_teeth: e.target.checked })}
                  className="size-3.5"
                />
                هاي خدمة بتشتغل عل سن مفقود (زراعة أسنان مثلاً) — غير هيك، الأسنان المسجّلة "مفقودة" ما بتنقدر تنختار لهاي الخدمة
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
              <label className="col-span-2 flex items-center gap-2 text-sm text-ink/70">
                <input
                  type="checkbox"
                  checked={form.spans_teeth}
                  onChange={(e) => setForm({ ...form, spans_teeth: e.target.checked })}
                  className="size-3.5"
                />
                هاي خدمة تمتد عبر أسنان متجاورة (جسر أسنان مثلاً) — بتترسم كخط واصل بين الأسنان المحددة سوا
              </label>

              <div className="col-span-2">
                <label className="mb-1 block text-xs text-muted">لون الخدمة على رسمة الأسنان</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={form.color}
                    onChange={(e) => setForm({ ...form, color: e.target.value })}
                    className="h-9 w-12 cursor-pointer rounded-lg border border-border bg-surface p-1"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {COLOR_PRESETS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setForm({ ...form, color: c })}
                        className={`size-6 rounded-full border-2 ${form.color === c ? 'border-ink' : 'border-transparent'}`}
                        style={{ background: c }}
                        title={c}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium">خطوات الخدمة</p>
                <p className={`text-xs ${priceExceeded ? 'font-semibold text-danger' : 'text-muted'}`}>
                  مجموع الخطوات: {stepsTotal} ₪ {form.default_price && `/ سعر الخدمة: ${form.default_price} ₪`}
                </p>
              </div>
              <p className="mb-3 text-xs text-muted">
                كل خطوة إلها عنوان وسعر ثابت وحقول إدخال حرة (تُعبّى لكل سن وقت تنفيذ الشغل). السعر بينضاف عالفاتورة أول ما توصف الخطوة "تمت".
              </p>
              <StepsEditor steps={steps} onChange={setSteps} />
            </div>

            {error && <p className="mt-4 text-sm text-danger">{error}</p>}

            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={closeForm}>
                إلغاء
              </Button>
              <Button type="submit" loading={saving}>{editingId ? 'حفظ التعديل' : 'حفظ'}</Button>
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
              <Th></Th>
              <Th>الخدمة</Th>
              <Th>السعر</Th>
              <Th>الخطوات</Th>
              <Th></Th>
            </Thead>
            <tbody>
              {services.length === 0 ? (
                <EmptyRow colSpan={5}>لا توجد خدمات بعد.</EmptyRow>
              ) : (
                services.map((s) => (
                  <Tr key={s.id}>
                    <Td>
                      <span
                        className="inline-block size-4 rounded-full border border-black/10"
                        style={{ background: s.color ?? DEFAULT_COLOR }}
                        title={s.spans_teeth ? 'جسر/تمتد عبر أسنان' : undefined}
                      />
                    </Td>
                    <Td>{s.name}{s.spans_teeth && <span className="ms-1 text-xs text-muted">(جسر)</span>}</Td>
                    <Td className="text-muted">{s.default_price} {s.default_currency}</Td>
                    <Td className="text-muted">{s.steps?.length ?? 0}</Td>
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
