import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faCheck, faCalendarPlus } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { SearchableSelect } from './ui'
import type { Doctor, Service, TreatmentPlan } from '../types'

const STATUS_LABELS: Record<TreatmentPlan['status'], string> = {
  draft: 'مسودة',
  approved: 'معتمدة',
  cancelled: 'ملغاة',
}

interface Props {
  patientId: number
  /** Tooth number(s) most recently picked from the chart, and which plan it's for — filled by the parent when pick mode is active. */
  pickedTooth?: { planId: number; toothNumbers: number[] } | null
  onToothConsumed?: () => void
  /** Parent switches the chart into pick mode for this plan id. */
  onRequestPickTooth?: (planId: number) => void
  pickingForPlanId?: number | null
  /** Reports the loaded plans up so the parent can flag "busy" teeth on the chart. */
  onPlansLoaded?: (plans: TreatmentPlan[]) => void
  /** Bump this (e.g. a counter) to force a reload from outside — the panel fetches its own data independently otherwise. */
  refreshSignal?: number
}

export default function TreatmentPlanPanel({ patientId, pickedTooth, onToothConsumed, onRequestPickTooth, pickingForPlanId, onPlansLoaded, refreshSignal }: Props) {
  const { can } = useAuth()
  const [plans, setPlans] = useState<TreatmentPlan[]>([])
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [showNewPlan, setShowNewPlan] = useState(false)
  const [newDoctorId, setNewDoctorId] = useState('')
  const [itemForm, setItemForm] = useState<Record<number, { service_id: string; tooth_number: string; unit_price: string; sessions_count: string; interval_days: string }>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!pickedTooth) return
    setItemForm((prev) => ({
      ...prev,
      [pickedTooth.planId]: { ...itemFormFor(pickedTooth.planId, prev), tooth_number: pickedTooth.toothNumbers.slice().sort((a, b) => a - b).join(',') },
    }))
    onToothConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedTooth])

  function load() {
    api.get('/treatment-plans', { params: { patient_id: patientId } }).then((res) => {
      setPlans(res.data.data)
      onPlansLoaded?.(res.data.data)
    })
  }

  useEffect(() => {
    load()
    api.get('/doctors').then((res) => setDoctors(res.data.data))
    api.get('/services').then((res) => setServices(res.data.data))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, refreshSignal])

  const canManage = can('treatment_plans.manage')

  async function createPlan() {
    setBusy(true)
    try {
      await api.post('/treatment-plans', { patient_id: patientId, doctor_id: newDoctorId ? Number(newDoctorId) : null })
      setShowNewPlan(false)
      setNewDoctorId('')
      load()
    } finally {
      setBusy(false)
    }
  }

  function itemFormFor(planId: number, map: typeof itemForm = itemForm) {
    return map[planId] ?? { service_id: '', tooth_number: '', unit_price: '', sessions_count: '1', interval_days: '' }
  }

  async function addItem(planId: number) {
    const f = itemFormFor(planId)
    if (!f.service_id || !f.unit_price) return
    // The tooth field can hold several comma-separated numbers (picked in bulk
    // from the chart, or typed by hand) — one identical plan item gets created
    // per tooth. With no tooth number at all (whole-mouth services like a
    // cleaning), a single item with no tooth is created.
    const teeth = f.tooth_number
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .map(Number)
    const toothNumbers = teeth.length > 0 ? teeth : [null]

    setBusy(true)
    try {
      for (const tooth of toothNumbers) {
        await api.post(`/treatment-plans/${planId}/items`, {
          service_id: Number(f.service_id),
          tooth_number: tooth,
          unit_price: Number(f.unit_price),
          sessions_count: Number(f.sessions_count) || 1,
          interval_days: f.interval_days ? Number(f.interval_days) : null,
        })
      }
      setItemForm({ ...itemForm, [planId]: { service_id: '', tooth_number: '', unit_price: '', sessions_count: '1', interval_days: '' } })
      load()
    } finally {
      setBusy(false)
    }
  }

  async function removeItem(planId: number, itemId: number) {
    setBusy(true)
    try {
      await api.delete(`/treatment-plans/${planId}/items/${itemId}`)
      load()
    } finally {
      setBusy(false)
    }
  }

  async function deletePlan(planId: number) {
    if (!window.confirm('حذف خطة العلاج بالكامل؟')) return
    setBusy(true)
    try {
      await api.delete(`/treatment-plans/${planId}`)
      load()
    } finally {
      setBusy(false)
    }
  }

  async function approvePlan(planId: number) {
    if (!window.confirm('اعتماد الخطة يولّد فاتورة فوراً — لا يمكن التراجع. متابعة؟')) return
    setBusy(true)
    try {
      await api.post(`/treatment-plans/${planId}/approve`)
      load()
    } finally {
      setBusy(false)
    }
  }

  async function cancelPlan(planId: number) {
    if (!window.confirm('إلغاء الخطة المعتمدة؟ رح تتلغى الفاتورة ويرجع المبلغ عن دين المريض (إذا كان مو مدفوع)، وتتلغى الجلسات والمواعيد المرتبطة فيها.')) return
    setBusy(true)
    try {
      await api.post(`/treatment-plans/${planId}/cancel`)
      load()
    } finally {
      setBusy(false)
    }
  }

  async function scheduleSessions(planId: number) {
    setBusy(true)
    try {
      await api.post(`/treatment-plans/${planId}/schedule-sessions`)
      load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink/70">خطط العلاج</h2>
        {canManage && (
          <button
            onClick={() => setShowNewPlan((v) => !v)}
            className="flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
          >
            <FontAwesomeIcon icon={faPlus} />
            خطة جديدة
          </button>
        )}
      </div>

      {showNewPlan && (
        <div className="mb-4 flex items-end gap-2 rounded-lg bg-background p-3">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-ink/60">الطبيب المعالج (اختياري)</label>
            <select
              value={newDoctorId}
              onChange={(e) => setNewDoctorId(e.target.value)}
              className="w-full rounded-lg border border-ink/10 px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
            >
              <option value="">بدون طبيب محدد</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>{d.full_name}</option>
              ))}
            </select>
          </div>
          <button onClick={createPlan} disabled={busy} className="rounded-lg bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent-hover disabled:opacity-60">
            إنشاء
          </button>
        </div>
      )}

      {plans.length === 0 ? (
        <p className="text-sm text-ink/40">لا توجد خطط علاج.</p>
      ) : (
        <div className="space-y-4">
          {plans.map((plan) => (
            <div key={plan.id} className="rounded-lg border border-ink/10 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-ink">{plan.doctor_name ?? 'بدون طبيب محدد'}</span>
                  <span
                    className={`mr-2 rounded-lg px-2 py-0.5 text-xs ${
                      plan.status === 'approved' ? 'bg-accent/10 text-accent' : 'bg-ink/5 text-ink/60'
                    }`}
                  >
                    {STATUS_LABELS[plan.status]}
                  </span>
                </div>
                {canManage && plan.status === 'draft' && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => deletePlan(plan.id)}
                      disabled={busy}
                      className="text-xs text-danger/70 hover:text-danger"
                    >
                      حذف الخطة
                    </button>
                    <button
                      onClick={() => approvePlan(plan.id)}
                      disabled={busy || plan.items.length === 0}
                      className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1 text-xs text-white hover:bg-accent-hover disabled:opacity-60"
                    >
                      <FontAwesomeIcon icon={faCheck} />
                      اعتماد وإصدار فاتورة
                    </button>
                  </div>
                )}
                {canManage && plan.status === 'approved' && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => cancelPlan(plan.id)}
                      disabled={busy}
                      className="text-xs text-danger/70 hover:text-danger"
                    >
                      إلغاء الخطة
                    </button>
                    <button
                      onClick={() => scheduleSessions(plan.id)}
                      disabled={busy}
                      className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1 text-xs text-white hover:bg-accent-hover disabled:opacity-60"
                    >
                      <FontAwesomeIcon icon={faCalendarPlus} />
                      جدولة الجلسات
                    </button>
                  </div>
                )}
                {canManage && plan.status === 'cancelled' && (
                  <button
                    onClick={() => deletePlan(plan.id)}
                    disabled={busy}
                    className="text-xs text-danger/70 hover:text-danger"
                  >
                    حذف الخطة
                  </button>
                )}
              </div>

              <table className="mb-2 w-full text-xs">
                <thead>
                  <tr className="text-ink/50">
                    <th className="p-1 text-start font-normal">الخدمة</th>
                    <th className="p-1 text-start font-normal">السن</th>
                    <th className="p-1 text-start font-normal">السعر</th>
                    <th className="p-1 text-start font-normal">الجلسات</th>
                    <th className="p-1 text-start font-normal">الفاصلة</th>
                    <th className="p-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {plan.items.map((item) => (
                    <tr key={item.id} className="border-t border-ink/5">
                      <td className="p-1">{item.service_name}</td>
                      <td className="p-1">{item.tooth_number ?? '—'}</td>
                      <td className="p-1">{item.unit_price} {item.currency}</td>
                      <td className="p-1">
                        {item.sessions_count}
                        {item.sessions && (
                          <span className="text-ink/40">
                            {' '}({item.sessions.filter((s) => s.status === 'scheduled' || s.status === 'done').length} مجدولة)
                          </span>
                        )}
                      </td>
                      <td className="p-1 text-ink/60">
                        {item.interval_days
                          ? `كل ${item.interval_days} يوم`
                          : `افتراضي الخدمة (${services.find((s) => s.id === item.service_id)?.default_interval_days ?? 7} يوم)`}
                      </td>
                      <td className="p-1">
                        {plan.status === 'draft' && canManage && (
                          <button onClick={() => removeItem(plan.id, item.id)} className="text-danger/70 hover:text-danger">
                            حذف
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}

                  {plan.status === 'draft' && canManage && (
                    <tr className="border-t border-ink/10">
                      <td className="p-1 align-top">
                        <SearchableSelect
                          options={services.map((s) => ({ value: String(s.id), label: s.name, sublabel: `${s.default_price} ₪` }))}
                          value={itemFormFor(plan.id).service_id}
                          onChange={(value) =>
                            setItemForm({
                              ...itemForm,
                              [plan.id]: {
                                ...itemFormFor(plan.id),
                                service_id: value,
                                unit_price: services.find((s) => s.id === Number(value))?.default_price ?? '',
                              },
                            })
                          }
                          placeholder="خدمة..."
                        />
                      </td>
                      <td className="p-1 align-top">
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="رقم السن (أو عدة أسنان)"
                          value={itemFormFor(plan.id).tooth_number}
                          onChange={(e) => setItemForm({ ...itemForm, [plan.id]: { ...itemFormFor(plan.id), tooth_number: e.target.value } })}
                          onFocus={() => onRequestPickTooth?.(plan.id)}
                          title="اكتب رقم/أرقام الأسنان يدوياً (مفصولة بفاصلة)، أو اضغط عالحقل وحدد من الرسمة"
                          className={`w-full rounded-lg border px-2 py-1 text-xs ${
                            pickingForPlanId === plan.id ? 'border-accent ring-1 ring-accent/30' : 'border-ink/10'
                          }`}
                        />
                      </td>
                      <td className="p-1 align-top">
                        <input
                          type="number"
                          placeholder="السعر"
                          value={itemFormFor(plan.id).unit_price}
                          onChange={(e) => setItemForm({ ...itemForm, [plan.id]: { ...itemFormFor(plan.id), unit_price: e.target.value } })}
                          className="w-full rounded-lg border border-ink/10 px-2 py-1 text-xs"
                        />
                      </td>
                      <td className="p-1 align-top">
                        <input
                          type="number"
                          placeholder="الجلسات"
                          value={itemFormFor(plan.id).sessions_count}
                          onChange={(e) => setItemForm({ ...itemForm, [plan.id]: { ...itemFormFor(plan.id), sessions_count: e.target.value } })}
                          className="w-full rounded-lg border border-ink/10 px-2 py-1 text-xs"
                        />
                      </td>
                      <td className="p-1 align-top">
                        <select
                          value={itemFormFor(plan.id).interval_days}
                          onChange={(e) => setItemForm({ ...itemForm, [plan.id]: { ...itemFormFor(plan.id), interval_days: e.target.value } })}
                          className="w-full rounded-lg border border-ink/10 px-2 py-1 text-xs"
                        >
                          <option value="">افتراضي الخدمة</option>
                          <option value="1">يومياً</option>
                          <option value="7">أسبوعياً</option>
                          <option value="14">كل أسبوعين</option>
                          <option value="30">شهرياً</option>
                        </select>
                      </td>
                      <td className="p-1 align-top">
                        <button
                          onClick={() => addItem(plan.id)}
                          disabled={busy}
                          className="whitespace-nowrap rounded-lg bg-accent px-2 py-1 text-xs text-white hover:bg-accent-hover disabled:opacity-60"
                        >
                          إضافة
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
