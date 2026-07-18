import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import type { CommissionStatement, Doctor } from '../types'

const MONTH_LABELS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
]

function currentYear(): number {
  return new Date().getFullYear()
}

function currentMonthNum(): number {
  return new Date().getMonth() + 1
}

export default function CommissionsPage() {
  const { can } = useAuth()
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [doctorId, setDoctorId] = useState<number | null>(null)
  const [year, setYear] = useState(currentYear())
  const [monthNum, setMonthNum] = useState(currentMonthNum())
  const month = `${year}-${String(monthNum).padStart(2, '0')}`
  const [statement, setStatement] = useState<CommissionStatement | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.get('/doctors').then((res) => {
      setDoctors(res.data.data)
      if (res.data.data.length > 0) setDoctorId(res.data.data[0].id)
    })
  }, [])

  function load() {
    if (!doctorId) return
    api.get(`/doctors/${doctorId}/commission-statement`, { params: { month: `${month}-01` } }).then((res) => setStatement(res.data))
  }

  useEffect(load, [doctorId, month])

  async function settle() {
    if (!doctorId) return
    setBusy(true)
    try {
      await api.post(`/doctors/${doctorId}/commission-statement/settle`, { month: `${month}-01` })
      load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold text-ink">كشف عمولات الأطباء</h1>

      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl bg-white p-4 shadow-sm">
        <select value={doctorId ?? ''} onChange={(e) => setDoctorId(Number(e.target.value))} className="rounded-lg border border-ink/10 px-3 py-1.5 text-sm">
          {doctors.map((d) => (
            <option key={d.id} value={d.id}>{d.full_name}</option>
          ))}
        </select>
        <select value={monthNum} onChange={(e) => setMonthNum(Number(e.target.value))} className="rounded-lg border border-ink/10 px-3 py-1.5 text-sm">
          {MONTH_LABELS.map((label, i) => (
            <option key={i} value={i + 1}>{label}</option>
          ))}
        </select>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="rounded-lg border border-ink/10 px-3 py-1.5 text-sm">
          {Array.from({ length: 6 }, (_, i) => currentYear() - 2 + i).map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      {statement && (
        <>
          <div className="mb-6 flex items-center justify-between rounded-xl bg-white p-6 shadow-sm">
            <div>
              <p className="text-sm text-ink/60">إجمالي عمولات {statement.doctor.full_name} — {statement.month}</p>
              <p className="text-2xl font-semibold text-ink">{statement.total_ils.toFixed(2)} ₪</p>
            </div>
            {can('commissions.view') && (
              <div className="text-end">
                <span className={`mb-2 block rounded-lg px-3 py-1 text-xs ${statement.settled ? 'bg-accent/10 text-accent' : 'bg-danger/10 text-danger'}`}>
                  {statement.settled ? 'مُسوّى' : 'غير مُسوّى'}
                </span>
                {!statement.settled && statement.transactions.length > 0 && (
                  <button onClick={settle} disabled={busy} className="rounded-lg bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover disabled:opacity-60">
                    تسوية الشهر
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-xl bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-right text-ink/60">
                  <th className="p-4 font-medium">المريض</th>
                  <th className="p-4 font-medium">السن</th>
                  <th className="p-4 font-medium">المبلغ</th>
                  <th className="p-4 font-medium">التسوية</th>
                </tr>
              </thead>
              <tbody>
                {statement.transactions.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-6 text-center text-sm text-ink/40">لا توجد عمولات لهذا الشهر.</td>
                  </tr>
                ) : (
                  statement.transactions.map((t) => (
                    <tr key={t.id} className="border-b border-ink/5 last:border-0">
                      <td className="p-4">{t.patient_name}</td>
                      <td className="p-4 text-ink/70">{t.tooth_number ?? '—'}</td>
                      <td className="p-4 text-ink/70">{t.amount_ils} ₪</td>
                      <td className="p-4 text-ink/70">{t.settled_at ?? '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
