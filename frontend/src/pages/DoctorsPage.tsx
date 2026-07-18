import { useEffect, useState, type FormEvent } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faTrash } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
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
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    full_name: '',
    contract_type: 'commission' as Doctor['contract_type'],
    default_commission_percent: '',
    monthly_salary: '',
  })
  const [availForm, setAvailForm] = useState<Record<number, { branch_id: number; weekday: number; start_time: string; end_time: string }>>({})
  const [error, setError] = useState<string | null>(null)

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

  async function addAvailability(doctorId: number) {
    const f = availForm[doctorId]
    if (!f) return
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
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink">الأطباء</h1>
        {can('doctors.manage') && (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
          >
            <FontAwesomeIcon icon={faPlus} />
            طبيب جديد
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mb-6 grid grid-cols-2 gap-4 rounded-xl bg-white p-6 shadow-sm">
          <div>
            <label className="mb-1 block text-sm text-ink/70">الاسم الكامل</label>
            <input
              required
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-ink/70">نوع التعاقد</label>
            <select
              value={form.contract_type}
              onChange={(e) => setForm({ ...form, contract_type: e.target.value as Doctor['contract_type'] })}
              className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm focus:border-accent focus:outline-none"
            >
              {Object.entries(CONTRACT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {needsSalary && (
            <div>
              <label className="mb-1 block text-sm text-ink/70">الراتب الشهري (₪)</label>
              <input
                type="number"
                value={form.monthly_salary}
                onChange={(e) => setForm({ ...form, monthly_salary: e.target.value })}
                className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
            </div>
          )}
          {needsCommission && (
            <div>
              <label className="mb-1 block text-sm text-ink/70">نسبة العمولة الافتراضية (%)</label>
              <input
                type="number"
                value={form.default_commission_percent}
                onChange={(e) => setForm({ ...form, default_commission_percent: e.target.value })}
                className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
              {form.contract_type === 'independent' && (
                <p className="mt-1 text-xs text-ink/50">مستقل: العيادة تحصّل من المريض وتحوّل له نسبته.</p>
              )}
            </div>
          )}

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

      <div className="space-y-4">
        {doctors.map((d) => (
          <div key={d.id} className="rounded-xl bg-white p-6 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="font-medium text-ink">{d.full_name}</h3>
                <p className="text-sm text-ink/60">
                  {CONTRACT_LABELS[d.contract_type]}
                  {d.default_commission_percent && ` · عمولة ${d.default_commission_percent}%`}
                  {d.monthly_salary && ` · راتب ${d.monthly_salary} ₪`}
                </p>
              </div>
            </div>

            <div className="border-t border-ink/10 pt-3">
              <h4 className="mb-2 text-xs font-medium text-ink/60">أوقات الدوام</h4>
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
                    className="rounded-lg border border-ink/10 px-2 py-1 text-xs"
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
                    className="rounded-lg border border-ink/10 px-2 py-1 text-xs"
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
                    className="rounded-lg border border-ink/10 px-2 py-1 text-xs"
                    value={availForm[d.id]?.start_time ?? '09:00'}
                    onChange={(e) =>
                      setAvailForm({ ...availForm, [d.id]: { ...(availForm[d.id] ?? { branch_id: branches[0]?.id ?? 1, weekday: 0, end_time: '17:00' }), start_time: e.target.value } })
                    }
                  />
                  <input
                    type="time"
                    className="rounded-lg border border-ink/10 px-2 py-1 text-xs"
                    value={availForm[d.id]?.end_time ?? '17:00'}
                    onChange={(e) =>
                      setAvailForm({ ...availForm, [d.id]: { ...(availForm[d.id] ?? { branch_id: branches[0]?.id ?? 1, weekday: 0, start_time: '09:00' }), end_time: e.target.value } })
                    }
                  />
                  <button
                    onClick={() => addAvailability(d.id)}
                    className="rounded-lg bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover"
                  >
                    إضافة وقت
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
