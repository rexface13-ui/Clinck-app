import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faTrash, faPen, faPaperPlane } from '@fortawesome/free-solid-svg-icons'
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
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const telegramLinkId = searchParams.get('telegram_link_id')
  const branches: Branch[] = data?.branches ?? []
  const [doctors, setDoctors] = useState<Doctor[] | null>(null)
  const [showForm, setShowForm] = useState(() => searchParams.get('new') === '1')
  const [form, setForm] = useState({
    full_name: searchParams.get('name') ?? '',
    contract_type: 'commission' as Doctor['contract_type'],
    default_commission_percent: '',
    monthly_salary: '',
  })
  const [newDoctorSchedule, setNewDoctorSchedule] = useState({
    branch_id: branches[0]?.id ?? 1,
    weekdays: [0, 1, 2, 3, 4] as number[],
    start_time: '09:00',
    end_time: '17:00',
  })
  const [availForm, setAvailForm] = useState<
    Record<number, { branch_id: number; weekdays: number[]; start_time: string; end_time: string }>
  >({})
  const [addingAvailability, setAddingAvailability] = useState<number | null>(null)
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

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      searchParams.delete('new')
      searchParams.delete('name')
      setSearchParams(searchParams, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const createNeedsSalary = form.contract_type === 'salary' || form.contract_type === 'salary_commission'
    const createNeedsCommission = form.contract_type !== 'salary'
    try {
      const res = await api.post('/doctors', {
        full_name: form.full_name,
        contract_type: form.contract_type,
        default_commission_percent: createNeedsCommission ? form.default_commission_percent || null : null,
        monthly_salary: createNeedsSalary ? form.monthly_salary || null : null,
      })
      const doctorId = res.data.data.id
      if (newDoctorSchedule.weekdays.length > 0) {
        await Promise.all(
          newDoctorSchedule.weekdays.map((weekday) =>
            api.post(`/doctors/${doctorId}/availability`, {
              branch_id: newDoctorSchedule.branch_id,
              weekday,
              start_time: newDoctorSchedule.start_time,
              end_time: newDoctorSchedule.end_time,
            }),
          ),
        )
      }

      if (telegramLinkId) {
        await api.post(`/telegram-registrations/${telegramLinkId}/link-doctor`, { doctor_id: doctorId })
        navigate('/telegram')
        return
      }

      setShowForm(false)
      setForm({ full_name: '', contract_type: 'commission', default_commission_percent: '', monthly_salary: '' })
      setNewDoctorSchedule({ branch_id: branches[0]?.id ?? 1, weekdays: [0, 1, 2, 3, 4], start_time: '09:00', end_time: '17:00' })
      load()
    } catch {
      setError('تحقق من الحقول المطلوبة لهذا النوع من التعاقد.')
    }
  }

  function toggleNewDoctorWeekday(day: number) {
    setNewDoctorSchedule((prev) => ({
      ...prev,
      weekdays: prev.weekdays.includes(day) ? prev.weekdays.filter((d) => d !== day) : [...prev.weekdays, day],
    }))
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
    // A field left over in local state from before switching contract type
    // (e.g. a commission % that was set while type was "commission", still
    // sitting there after switching to "salary") must not be sent as-is —
    // only fields that actually apply to the *new* contract type get saved,
    // everything else is explicitly nulled out so it doesn't silently persist.
    const editNeedsSalary = editForm.contract_type === 'salary' || editForm.contract_type === 'salary_commission'
    const editNeedsCommission = editForm.contract_type !== 'salary'
    try {
      await api.put(`/doctors/${doctorId}`, {
        full_name: editForm.full_name,
        contract_type: editForm.contract_type,
        default_commission_percent: editNeedsCommission ? editForm.default_commission_percent || null : null,
        monthly_salary: editNeedsSalary ? editForm.monthly_salary || null : null,
      })
      setEditingId(null)
      load()
    } catch {
      setEditError('تحقق من الحقول المطلوبة لهذا النوع من التعاقد.')
    }
  }

  async function deleteDoctor(doctorId: number, doctorName: string) {
    if (!window.confirm('حذف هذا الطبيب نهائياً؟')) return
    try {
      await api.delete(`/doctors/${doctorId}`)
      load()
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      if (message?.includes('شغل مسجّل') || message?.includes('عمولات')) {
        const typed = window.prompt(
          `${message}\n\nلحذفه نهائياً مع كل شي مرتبط فيه (استخدم هذا فقط لبيانات تجريبية) — اكتب اسمه بالضبط:\n${doctorName}`,
        )
        if (typed !== doctorName) return
        try {
          await api.delete(`/doctors/${doctorId}/force-delete`, { data: { confirm: typed } })
          load()
        } catch {
          window.alert('تعذّر الحذف النهائي.')
        }
        return
      }
      window.alert(message ?? 'تعذّر حذف الطبيب.')
    }
  }

  function defaultAvailForm() {
    return { branch_id: branches[0]?.id ?? 1, weekdays: [] as number[], start_time: '09:00', end_time: '17:00' }
  }

  function toggleAvailWeekday(doctorId: number, day: number) {
    const current = availForm[doctorId] ?? defaultAvailForm()
    const weekdays = current.weekdays.includes(day) ? current.weekdays.filter((d) => d !== day) : [...current.weekdays, day]
    setAvailForm({ ...availForm, [doctorId]: { ...current, weekdays } })
  }

  async function addAvailability(doctorId: number) {
    const f = availForm[doctorId] ?? defaultAvailForm()
    if (f.weekdays.length === 0) return
    setAddingAvailability(doctorId)
    try {
      await Promise.all(
        f.weekdays.map((weekday) =>
          api.post(`/doctors/${doctorId}/availability`, {
            branch_id: f.branch_id,
            weekday,
            start_time: f.start_time,
            end_time: f.end_time,
          }),
        ),
      )
      setAvailForm({ ...availForm, [doctorId]: { ...f, weekdays: [] } })
      load()
    } finally {
      setAddingAvailability(null)
    }
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
          {telegramLinkId && (
            <p className="col-span-2 mb-4 flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2 text-xs text-accent">
              <FontAwesomeIcon icon={faPaperPlane} />
              رح ينربط هالطبيب تلقائياً بمحادثة التيليغرام بعد الحفظ.
            </p>
          )}
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

            <div className="col-span-2 border-t border-border pt-4">
              <h4 className="mb-2 text-xs font-medium text-muted">أوقات الدوام (اختياري — تقدر تضيف/تعدّل لاحقاً)</h4>
              <div className="mb-2 flex flex-wrap gap-2">
                {WEEKDAYS.map((w, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleNewDoctorWeekday(i)}
                    className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                      newDoctorSchedule.weekdays.includes(i)
                        ? 'border-accent bg-accent text-white'
                        : 'border-border text-ink/70 hover:border-accent/40'
                    }`}
                  >
                    {w}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <select
                  className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs focus:border-accent focus:outline-none"
                  value={newDoctorSchedule.branch_id}
                  onChange={(e) => setNewDoctorSchedule({ ...newDoctorSchedule, branch_id: Number(e.target.value) })}
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                <input
                  type="time"
                  className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs focus:border-accent focus:outline-none"
                  value={newDoctorSchedule.start_time}
                  onChange={(e) => setNewDoctorSchedule({ ...newDoctorSchedule, start_time: e.target.value })}
                />
                <span className="text-xs text-muted">إلى</span>
                <input
                  type="time"
                  className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs focus:border-accent focus:outline-none"
                  value={newDoctorSchedule.end_time}
                  onChange={(e) => setNewDoctorSchedule({ ...newDoctorSchedule, end_time: e.target.value })}
                />
              </div>
              <p className="mt-1 text-[11px] text-ink/40">
                نفس الوقت بينطبق على كل الأيام يلي حددتها فوق — إذا بدك وقت مختلف ليوم معيّن، عدّله بعدين من بطاقة الطبيب.
              </p>
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
                    {d.telegram_linked && (
                      <span className="flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-xs text-success">
                        <FontAwesomeIcon icon={faPaperPlane} />
                        مربوط بتيليغرام
                      </span>
                    )}
                  </div>
                </div>
                {can('doctors.manage') && (
                  <div className="flex items-center gap-3">
                    <button onClick={() => startEdit(d)} className="flex items-center gap-1 text-xs text-accent hover:underline">
                      <FontAwesomeIcon icon={faPen} />
                      تعديل
                    </button>
                    <button onClick={() => deleteDoctor(d.id, d.full_name)} className="flex items-center gap-1 text-xs text-danger hover:underline">
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
                  <div>
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {WEEKDAYS.map((w, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => toggleAvailWeekday(d.id, i)}
                          className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                            (availForm[d.id]?.weekdays ?? []).includes(i)
                              ? 'border-accent bg-accent text-white'
                              : 'border-border text-ink/70 hover:border-accent/40'
                          }`}
                        >
                          {w}
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <select
                        className="rounded-lg border border-border bg-surface px-2 py-1 text-xs focus:border-accent focus:outline-none"
                        value={availForm[d.id]?.branch_id ?? branches[0]?.id ?? ''}
                        onChange={(e) =>
                          setAvailForm({ ...availForm, [d.id]: { ...(availForm[d.id] ?? defaultAvailForm()), branch_id: Number(e.target.value) } })
                        }
                      >
                        {branches.map((b) => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>
                      <input
                        type="time"
                        className="rounded-lg border border-border bg-surface px-2 py-1 text-xs focus:border-accent focus:outline-none"
                        value={availForm[d.id]?.start_time ?? '09:00'}
                        onChange={(e) =>
                          setAvailForm({ ...availForm, [d.id]: { ...(availForm[d.id] ?? defaultAvailForm()), start_time: e.target.value } })
                        }
                      />
                      <span className="text-xs text-muted">إلى</span>
                      <input
                        type="time"
                        className="rounded-lg border border-border bg-surface px-2 py-1 text-xs focus:border-accent focus:outline-none"
                        value={availForm[d.id]?.end_time ?? '17:00'}
                        onChange={(e) =>
                          setAvailForm({ ...availForm, [d.id]: { ...(availForm[d.id] ?? defaultAvailForm()), end_time: e.target.value } })
                        }
                      />
                      <Button
                        className="px-3 py-1 text-xs"
                        onClick={() => addAvailability(d.id)}
                        disabled={(availForm[d.id]?.weekdays ?? []).length === 0 || addingAvailability === d.id}
                        loading={addingAvailability === d.id}
                      >
                        إضافة الأيام المحددة
                      </Button>
                    </div>
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
