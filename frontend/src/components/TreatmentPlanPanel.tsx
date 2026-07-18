import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faCheck, faCalendarPlus } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import type { Doctor, Service, TreatmentPlan } from '../types'

const STATUS_LABELS: Record<TreatmentPlan['status'], string> = {
  draft: 'مسودة',
  approved: 'معتمدة',
  cancelled: 'ملغاة',
}

export default function TreatmentPlanPanel({ patientId }: { patientId: number }) {
  const { can } = useAuth()
  const [plans, setPlans] = useState<TreatmentPlan[]>([])
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [showNewPlan, setShowNewPlan] = useState(false)
  const [newDoctorId, setNewDoctorId] = useState('')
  const [itemForm, setItemForm] = useState<Record<number, { service_id: string; tooth_number: string; unit_price: string; sessions_count: string }>>({})
  const [busy, setBusy] = useState(false)

  function load() {
    api.get('/treatment-plans', { params: { patient_id: patientId } }).then((res) => setPlans(res.data.data))
  }

  useEffect(() => {
    load()
    api.get('/doctors').then((res) => setDoctors(res.data.data))
    api.get('/services').then((res) => setServices(res.data.data))
  }, [patientId])

  const canManage = can('treatment_plans.manage')

  async function createPlan() {
    if (!newDoctorId) return
    setBusy(true)
    try {
      await api.post('/treatment-plans', { patient_id: patientId, doctor_id: Number(newDoctorId) })
      setShowNewPlan(false)
      setNewDoctorId('')
      load()
    } finally {
      setBusy(false)
    }
  }

  function itemFormFor(planId: number) {
    return itemForm[planId] ?? { service_id: '', tooth_number: '', unit_price: '', sessions_count: '1' }
  }

  async function addItem(planId: number) {
    const f = itemFormFor(planId)
    if (!f.service_id || !f.unit_price) return
    setBusy(true)
    try {
      await api.post(`/treatment-plans/${planId}/items`, {
        service_id: Number(f.service_id),
        tooth_number: f.tooth_number ? Number(f.tooth_number) : null,
        unit_price: Number(f.unit_price),
        sessions_count: Number(f.sessions_count) || 1,
      })
      setItemForm({ ...itemForm, [planId]: { service_id: '', tooth_number: '', unit_price: '', sessions_count: '1' } })
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
            <label className="mb-1 block text-xs text-ink/60">الطبيب المعالج</label>
            <select
              value={newDoctorId}
              onChange={(e) => setNewDoctorId(e.target.value)}
              className="w-full rounded-lg border border-ink/10 px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
            >
              <option value="">اختر طبيباً</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>{d.full_name}</option>
              ))}
            </select>
          </div>
          <button onClick={createPlan} disabled={busy || !newDoctorId} className="rounded-lg bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent-hover disabled:opacity-60">
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
                  <span className="text-sm font-medium text-ink">{plan.doctor_name}</span>
                  <span
                    className={`mr-2 rounded-lg px-2 py-0.5 text-xs ${
                      plan.status === 'approved' ? 'bg-accent/10 text-accent' : 'bg-ink/5 text-ink/60'
                    }`}
                  >
                    {STATUS_LABELS[plan.status]}
                  </span>
                </div>
                {canManage && plan.status === 'draft' && (
                  <button
                    onClick={() => approvePlan(plan.id)}
                    disabled={busy || plan.items.length === 0}
                    className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1 text-xs text-white hover:bg-accent-hover disabled:opacity-60"
                  >
                    <FontAwesomeIcon icon={faCheck} />
                    اعتماد وإصدار فاتورة
                  </button>
                )}
                {canManage && plan.status === 'approved' && (
                  <button
                    onClick={() => scheduleSessions(plan.id)}
                    disabled={busy}
                    className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1 text-xs text-white hover:bg-accent-hover disabled:opacity-60"
                  >
                    <FontAwesomeIcon icon={faCalendarPlus} />
                    جدولة الجلسات
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
                      <td className="p-1">
                        {plan.status === 'draft' && canManage && (
                          <button onClick={() => removeItem(plan.id, item.id)} className="text-danger/70 hover:text-danger">
                            حذف
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {plan.status === 'draft' && canManage && (
                <div className="flex flex-wrap items-end gap-2 border-t border-ink/10 pt-2">
                  <select
                    value={itemFormFor(plan.id).service_id}
                    onChange={(e) =>
                      setItemForm({
                        ...itemForm,
                        [plan.id]: {
                          ...itemFormFor(plan.id),
                          service_id: e.target.value,
                          unit_price: services.find((s) => s.id === Number(e.target.value))?.default_price ?? '',
                        },
                      })
                    }
                    className="rounded-lg border border-ink/10 px-2 py-1 text-xs"
                  >
                    <option value="">خدمة...</option>
                    {services.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    placeholder="رقم السن"
                    value={itemFormFor(plan.id).tooth_number}
                    onChange={(e) => setItemForm({ ...itemForm, [plan.id]: { ...itemFormFor(plan.id), tooth_number: e.target.value } })}
                    className="w-20 rounded-lg border border-ink/10 px-2 py-1 text-xs"
                  />
                  <input
                    type="number"
                    placeholder="السعر"
                    value={itemFormFor(plan.id).unit_price}
                    onChange={(e) => setItemForm({ ...itemForm, [plan.id]: { ...itemFormFor(plan.id), unit_price: e.target.value } })}
                    className="w-24 rounded-lg border border-ink/10 px-2 py-1 text-xs"
                  />
                  <input
                    type="number"
                    placeholder="الجلسات"
                    value={itemFormFor(plan.id).sessions_count}
                    onChange={(e) => setItemForm({ ...itemForm, [plan.id]: { ...itemFormFor(plan.id), sessions_count: e.target.value } })}
                    className="w-20 rounded-lg border border-ink/10 px-2 py-1 text-xs"
                  />
                  <button
                    onClick={() => addItem(plan.id)}
                    disabled={busy}
                    className="rounded-lg bg-accent px-3 py-1 text-xs text-white hover:bg-accent-hover disabled:opacity-60"
                  >
                    إضافة بند
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
