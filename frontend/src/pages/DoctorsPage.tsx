import { useEffect, useState, type FormEvent } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faTrash, faPen } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { Card, PageHeader, Badge, Button, Input, Select, CardSkeleton } from '../components/ui'
import type { Branch, Doctor } from '../types'

const CONTRACT_LABELS: Record<Doctor['contract_type'], string> = {
  salary: 'راتب ثابت',
  salary_commission: 'راتب + عمولة',
  commission: 'عمولة',
  independent: 'مستقل',
}

const WEEKDAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']

export default function DoctorsPage() {
  const { data, can } = useAuth()
  const branches: Branch[] = data?.branches ?? []
  const [doctors, setDoctors] = useState<Doctor[] | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    full_name: '',
    contract_type: 'commission' as Doctor['contract_type'],
    default_commission_percent: '',
    monthly_salary: '',
  })
  const [availForm, setAvailForm] = useState<Record<number, { branch_id: number; weekday: number; start_time: string; end_time: string }>>({})
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState({
    full_name: '',
    contract_type: 'commission' as Doctor['contract_type'],
    default_commission_percent: '',
    monthly_salary: '',
  })
  const [editError, setEditError] = useState<string | null>(null)

  function load() {
    api.get('/doctors').then((res) => setDoctors(res.data.data))
  }

  useEffect(load, [])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await api.post('/doctors', {
        full_name: form.full_name,
        contract_type: form.contract_type,
        default_commission_percent: form.default_commission_percent || null,
        monthly_salary: form.monthly_salary || null,
      })
      setShowForm(false)
      setForm({ full_name: '', contract_type: 'commission', default_commission_percent: '', monthly_salary: '' })
      load()
    } catch {
      setError('تحقق من الحقول المطلوبة لهذا النوع من التعاقد.')
    }
  }

  function startEdit(d: Doctor) {
    setEditingId(d.id)
    setEditForm({
      full_name: d.full_name,
      contract_type: d.contract_type,
      default_commission_percent: d.default_commission_percent ?? '',
      monthly_salary: d.monthly_salary ?? '',
    })
    setEditError(null)
  }

  async function saveEdit(doctorId: number) {
    setEditError(null)
    try {
      await api.put(`/doctors/${doctorId}`, {
        full_name: editForm.full_name,
        contract_type: editForm.contract_type,
        default_commission_percent: editForm.default_commission_percent || null,
        monthly_salary: editForm.monthly_salary || null,
      })
      setEditingId(null)
      load()
    } catch {
      setEditError('تحقق من الحقول المطلوبة لهذا النوع من التعاقد.')
    }
  }

  async function deleteDoctor(doctorId: number) {
    if (!window.confirm('حذف هذا الطبيب نهائياً؟')) return
    try {
      await api.delete(`/doctors/${doctorId}`)
      load()
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      window.alert(message ?? 'تعذّر حذف الطبيب.')
    }
  }

  async function addAvailability(doctorId: number) {
    // The form's visible defaults (first branch, Sunday, 09:00-17:00) only
    // land in `availForm` once the user touches a field — if they click
    // "إضافة وقت" without changing anything, fall back to the same
    // defaults the inputs are already displaying instead of doing nothing.
    const f = availForm[doctorId] ?? {
      branch_id: branches[0]?.id ?? 1,
      weekday: 0,
      start_time: '09:00',
      end_time: '17:00',
    }
    await api.post(`/doctors/${doctorId}/availability`, f)
    load()
  }

  async function removeAvailability(doctorId: number, availId: number) {
    await api.delete(`/doctors/${doctorId}/availability/${availId}`)
    load()
  }

  const needsSalary = form.contract_type === 'salary' || form.contract_type === 'salary_commission'
  const needsCommission = form.contract_type !== 'salary'

  return (
    <div>
      <PageHeader
        title="الأطباء"
        subtitle="إدارة الأطباء وأوقات دوامهم"
        action={
          can('doctors.manage') && (
            <Button onClick={() => setShowForm((v) => !v)}>
              <FontAwesomeIcon icon={faPlus} />
              طبيب جديد
            </Button>
          )
        }
      />

      {showForm && (
        <Card className="mb-6 p-6">
          <form onSubmit={handleCreate} className="grid grid-cols-2 gap-4">
            <Input
              label="الاسم الكامل"
              required
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            />
            <Select
              label="نوع التعاقد"
              value={form.contract_type}
              onChange={(e) => setForm({ ...form, contract_type: e.target.value as Doctor['contract_type'] })}
            >
              {Object.entries(CONTRACT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            {needsSalary && (
              <Input
                type="number"
                label="الراتب الشهري (₪)"
                value={form.monthly_salary}
                onChange={(e) => setForm({ ...form, monthly_salary: e.target.value })}
              />
            )}
            {needsCommission && (
              <div>
                <Input
                  type="number"
                  label="نسبة العمولة الافتراضية (%)"
                  value={form.default_commission_percent}
                  onChange={(e) => setForm({ ...form, default_commission_percent: e.target.value })}
                />
                {form.contract_type === 'independent' && (
                  <p className="mt-1 text-xs text-muted">مستقل: العيادة تحصّل من المريض وتحوّل له نسبته.</p>
                )}
              </div>
            )}

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

      <div className="space-y-4">
        {!doctors ? (
          <>
            <CardSkeleton className="h-32" />
            <CardSkeleton className="h-32" />
          </>
        ) : doctors.length === 0 ? (
          <Card className="p-10 text-center text-sm text-muted">لا يوجد أطباء بعد.</Card>
        ) : (
          doctors.map((d) => (
            <Card key={d.id} className="p-6">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-ink">{d.full_name}</h3>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge variant="accent">{CONTRACT_LABELS[d.contract_type]}</Badge>
                    {d.default_commission_percent && <span className="text-sm text-muted">عمولة {d.default_commission_percent}%</span>}
                    {d.monthly_salary && <span className="text-sm text-muted">راتب {d.monthly_salary} ₪</span>}
                  </div>
                </div>
                {can('doctors.manage') && (
                  <div className="flex items-center gap-3">
                    <button onClick={() => startEdit(d)} className="flex items-center gap-1 text-xs text-accent hover:underline">
                      <FontAwesomeIcon icon={faPen} />
                      تعديل
                    </button>
                    <button onClick={() => deleteDoctor(d.id)} className="flex items-center gap-1 text-xs text-danger hover:underline">
                      <FontAwesomeIcon icon={faTrash} />
                      حذف
                    </button>
                  </div>
                )}
              </div>

              {editingId === d.id && (
                <div className="mb-4 grid grid-cols-2 gap-4 rounded-xl bg-background p-4">
                  <Input
                    label="الاسم الكامل"
                    value={editForm.full_name}
                    onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })}
                  />
                  <Select
                    label="نوع التعاقد"
                    value={editForm.contract_type}
                    onChange={(e) => setEditForm({ ...editForm, contract_type: e.target.value as Doctor['contract_type'] })}
                  >
                    {Object.entries(CONTRACT_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                  {(editForm.contract_type === 'salary' || editForm.contract_type === 'salary_commission') && (
                    <Input
                      type="number"
                      label="الراتب الشهري (₪)"
                      value={editForm.monthly_salary}
                      onChange={(e) => setEditForm({ ...editForm, monthly_salary: e.target.value })}
                    />
                  )}
                  {editForm.contract_type !== 'salary' && (
                    <Input
                      type="number"
                      label="نسبة العمولة الافتراضية (%)"
                      value={editForm.default_commission_percent}
                      onChange={(e) => setEditForm({ ...editForm, default_commission_percent: e.target.value })}
                    />
                  )}
                  {editError && <p className="col-span-2 text-sm text-danger">{editError}</p>}
                  <div className="col-span-2 flex justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={() => setEditingId(null)}>
                      إلغاء
                    </Button>
                    <Button onClick={() => saveEdit(d.id)}>حفظ</Button>
                  </div>
                </div>
              )}

              <div className="border-t border-border pt-3">
                <h4 className="mb-2 text-xs font-medium text-muted">أوقات الدوام</h4>
                <ul className="mb-2 space-y-1">
                  {(d.availability ?? []).map((a) => (
                    <li key={a.id} className="flex items-center gap-2 text-sm text-ink/70">
                      <span>{WEEKDAYS[a.weekday]}</span>
                      <span>{a.start_time} - {a.end_time}</span>
                      <button onClick={() => removeAvailability(d.id, a.id)} className="text-danger/70 hover:text-danger">
                        <FontAwesomeIcon icon={faTrash} className="text-xs" />
                      </button>
                    </li>
                  ))}
                </ul>
                {can('doctors.manage') && (
                  <div className="flex flex-wrap items-end gap-2">
                    <select
                      className="rounded-lg border border-border bg-surface px-2 py-1 text-xs focus:border-accent focus:outline-none"
                      value={availForm[d.id]?.branch_id ?? branches[0]?.id ?? ''}
                      onChange={(e) =>
                        setAvailForm({ ...availForm, [d.id]: { ...(availForm[d.id] ?? { weekday: 0, start_time: '09:00', end_time: '17:00', branch_id: branches[0]?.id ?? 1 }), branch_id: Number(e.target.value) } })
                      }
                    >
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                    <select
                      className="rounded-lg border border-border bg-surface px-2 py-1 text-xs focus:border-accent focus:outline-none"
                      value={availForm[d.id]?.weekday ?? 0}
                      onChange={(e) =>
                        setAvailForm({ ...availForm, [d.id]: { ...(availForm[d.id] ?? { branch_id: branches[0]?.id ?? 1, start_time: '09:00', end_time: '17:00' }), weekday: Number(e.target.value) } })
                      }
                    >
                      {WEEKDAYS.map((w, i) => (
                        <option key={i} value={i}>{w}</option>
                      ))}
                    </select>
                    <input
                      type="time"
                      className="rounded-lg border border-border bg-surface px-2 py-1 text-xs focus:border-accent focus:outline-none"
                      value={availForm[d.id]?.start_time ?? '09:00'}
                      onChange={(e) =>
                        setAvailForm({ ...availForm, [d.id]: { ...(availForm[d.id] ?? { branch_id: branches[0]?.id ?? 1, weekday: 0, end_time: '17:00' }), start_time: e.target.value } })
                      }
                    />
                    <input
                      type="time"
                      className="rounded-lg border border-border bg-surface px-2 py-1 text-xs focus:border-accent focus:outline-none"
                      value={availForm[d.id]?.end_time ?? '17:00'}
                      onChange={(e) =>
                        setAvailForm({ ...availForm, [d.id]: { ...(availForm[d.id] ?? { branch_id: branches[0]?.id ?? 1, weekday: 0, start_time: '09:00' }), end_time: e.target.value } })
                      }
                    />
                    <Button className="px-3 py-1 text-xs" onClick={() => addAvailability(d.id)}>
                      إضافة وقت
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
