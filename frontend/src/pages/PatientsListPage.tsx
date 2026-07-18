import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faUser, faBolt } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import DatePicker from '../components/DatePicker'
import type { Branch, Doctor, Patient } from '../types'

/** Same rule as backend/app/Models/Patient.php: under 12 defaults to child. */
function isChildFromBirthDate(birthDate: string): boolean {
  const parsed = new Date(birthDate + 'T00:00:00')
  const now = new Date()
  let age = now.getFullYear() - parsed.getFullYear()
  const monthDiff = now.getMonth() - parsed.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < parsed.getDate())) age--
  return age < 12
}

export default function PatientsListPage() {
  const { data, can } = useAuth()
  const navigate = useNavigate()
  const [patients, setPatients] = useState<Patient[]>([])
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const branches: Branch[] = data?.branches ?? []

  const [form, setForm] = useState({
    branch_id: branches[0]?.id ?? 1,
    full_name: '',
    gender: 'male' as 'male' | 'female',
    birth_date: '',
    isChildOverride: null as boolean | null,
    phone: '',
    guardian_name: '',
    guardian_phone: '',
    walkIn: false,
    walkInDoctorId: '',
  })
  const [error, setError] = useState<string | null>(null)

  function loadPatients() {
    setLoading(true)
    api
      .get('/patients')
      .then((res) => setPatients(res.data.data))
      .finally(() => setLoading(false))
  }

  useEffect(loadPatients, [])
  useEffect(() => {
    api.get('/doctors').then((res) => setDoctors(res.data.data))
  }, [])

  const inferredIsChild = form.birth_date ? isChildFromBirthDate(form.birth_date) : null
  const effectiveIsChild = form.isChildOverride ?? inferredIsChild

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const payload = {
        branch_id: form.branch_id,
        full_name: form.full_name,
        gender: form.gender,
        birth_date: form.birth_date || null,
        is_child: form.isChildOverride ?? undefined,
        guardian_name: form.guardian_name || null,
        guardian_phone: form.guardian_phone || null,
        phone: form.phone || null,
      }
      const res = await api.post('/patients', payload)
      const patientId = res.data.data.id

      if (form.walkIn && form.walkInDoctorId) {
        const now = new Date()
        const ends = new Date(now.getTime() + 30 * 60 * 1000)
        try {
          await api.post('/appointments', {
            branch_id: form.branch_id,
            patient_id: patientId,
            doctor_id: Number(form.walkInDoctorId),
            starts_at: now.toISOString(),
            ends_at: ends.toISOString(),
          })
        } catch {
          // doctor busy right now — patient is still created, just no walk-in slot booked
        }
      }

      setShowForm(false)
      navigate(`/patients/${patientId}`)
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'حدث خطأ أثناء الحفظ.'
      setError(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink">المرضى</h1>
        {can('patients.manage') && (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
          >
            <FontAwesomeIcon icon={faPlus} />
            مريض جديد
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
            <label className="mb-1 block text-sm text-ink/70">الفرع</label>
            <select
              value={form.branch_id}
              onChange={(e) => setForm({ ...form, branch_id: Number(e.target.value) })}
              className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm focus:border-accent focus:outline-none"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-ink/70">الجنس</label>
            <select
              value={form.gender}
              onChange={(e) => setForm({ ...form, gender: e.target.value as 'male' | 'female' })}
              className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm focus:border-accent focus:outline-none"
            >
              <option value="male">ذكر</option>
              <option value="female">أنثى</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-ink/70">تاريخ الميلاد (يوم/شهر/سنة)</label>
            <DatePicker
              value={form.birth_date}
              onChange={(iso) => setForm({ ...form, birth_date: iso, isChildOverride: null })}
            />
          </div>

          <div className="col-span-2 flex items-center gap-3 rounded-xl bg-background px-4 py-3">
            <span className="text-sm text-ink/70">الفئة العمرية:</span>
            <button
              type="button"
              onClick={() => setForm({ ...form, isChildOverride: false })}
              className={`rounded-lg border px-3 py-1 text-xs ${
                effectiveIsChild === false ? 'border-accent bg-accent text-white' : 'border-ink/10 text-ink/70'
              }`}
            >
              بالغ
            </button>
            <button
              type="button"
              onClick={() => setForm({ ...form, isChildOverride: true })}
              className={`rounded-lg border px-3 py-1 text-xs ${
                effectiveIsChild === true ? 'border-accent bg-accent text-white' : 'border-ink/10 text-ink/70'
              }`}
            >
              طفل
            </button>
            {inferredIsChild !== null && form.isChildOverride === null && (
              <span className="text-xs text-ink/40">(محسوبة تلقائياً من تاريخ الميلاد — بإمكانك تغييرها)</span>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm text-ink/70">الهاتف</label>
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
          </div>
          <div />
          <div>
            <label className="mb-1 block text-sm text-ink/70">اسم ولي الأمر (اختياري)</label>
            <input
              value={form.guardian_name}
              onChange={(e) => setForm({ ...form, guardian_name: e.target.value })}
              className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-ink/70">هاتف ولي الأمر</label>
            <input
              value={form.guardian_phone}
              onChange={(e) => setForm({ ...form, guardian_phone: e.target.value })}
              className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
          </div>

          <div className="col-span-2 rounded-xl border border-accent/30 bg-accent/5 p-4">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={form.walkIn}
                onChange={(e) => setForm({ ...form, walkIn: e.target.checked })}
                className="size-4 accent-[var(--color-accent)]"
              />
              <FontAwesomeIcon icon={faBolt} className="text-accent" />
              زيارة بدون موعد مسبق — ابدأ الكشف الآن (Walk-in)
            </label>
            {form.walkIn && (
              <div className="mt-3">
                <label className="mb-1 block text-xs text-ink/60">الطبيب المناوب</label>
                <select
                  required={form.walkIn}
                  value={form.walkInDoctorId}
                  onChange={(e) => setForm({ ...form, walkInDoctorId: e.target.value })}
                  className="w-full rounded-lg border border-ink/10 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                >
                  <option value="">اختر طبيباً</option>
                  {doctors.map((d) => (
                    <option key={d.id} value={d.id}>{d.full_name}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-ink/50">
                  رح يتسجّل الموعد فوراً بالوقت الحالي، وبتقدر تفتح ملف المريض وترسم أسنانه على طول.
                </p>
              </div>
            )}
          </div>

          {error && <p className="col-span-2 text-sm text-danger">{error}</p>}

          <div className="col-span-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-xl px-4 py-2 text-sm text-ink/70 hover:bg-background"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
            >
              {submitting ? 'جارِ الحفظ...' : 'حفظ'}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        {loading ? (
          <p className="p-6 text-sm text-ink/50">جارِ التحميل...</p>
        ) : patients.length === 0 ? (
          <p className="p-6 text-sm text-ink/50">لا يوجد مرضى بعد.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-right text-ink/60">
                <th className="p-4 font-medium">الكود</th>
                <th className="p-4 font-medium">الاسم</th>
                <th className="p-4 font-medium">الفئة</th>
                <th className="p-4 font-medium">الهاتف</th>
                <th className="p-4 font-medium">تاريخ التسجيل</th>
              </tr>
            </thead>
            <tbody>
              {patients.map((p) => (
                <tr key={p.id} className="border-b border-ink/5 last:border-0 hover:bg-background">
                  <td className="p-4">
                    <Link to={`/patients/${p.id}`} className="flex items-center gap-2 text-accent">
                      <FontAwesomeIcon icon={faUser} className="text-ink/30" />
                      {p.code}
                    </Link>
                  </td>
                  <td className="p-4">
                    <Link to={`/patients/${p.id}`}>{p.full_name}</Link>
                  </td>
                  <td className="p-4">
                    <span className={`rounded-lg px-2 py-0.5 text-xs ${p.is_child ? 'bg-accent/10 text-accent' : 'bg-ink/5 text-ink/60'}`}>
                      {p.is_child ? 'طفل' : 'بالغ'}
                    </span>
                  </td>
                  <td className="p-4 text-ink/70">{p.phone ?? '—'}</td>
                  <td className="p-4 text-ink/70">{p.created_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
