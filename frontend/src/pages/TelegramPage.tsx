import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faRobot, faUserPlus, faUserDoctor, faUser, faXmark, faCheck, faMagnifyingGlass, faPlus } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { Card, PageHeader, Button, Input } from '../components/ui'
import SearchableSelect from '../components/ui/SearchableSelect'
import type { Patient } from '../types'

interface PendingRegistration {
  id: number
  telegram_chat_id: number
  registered_name: string
  registered_phone: string
  created_at: string
}

interface DoctorOption {
  id: number
  full_name: string
}

interface LinkedDoctor {
  id: number
  full_name: string
  linked_at: string
}

interface LinkedPatient {
  id: number
  full_name: string
  phone: string | null
  linked_at: string
}

function BotConfigCard() {
  const { can, data, refresh } = useAuth()
  const [form, setForm] = useState({ telegram_bot_token: '', telegram_bot_username: '', telegram_welcome_message: '' })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!data) return
    setForm((f) => ({
      ...f,
      telegram_bot_username: (data.settings.telegram_bot_username as string) ?? '',
      telegram_welcome_message: (data.settings.telegram_welcome_message as string) ?? '',
    }))
  }, [data])

  async function save() {
    setSaving(true)
    setSaved(false)
    try {
      const values: Record<string, string> = {
        telegram_bot_username: form.telegram_bot_username,
        telegram_welcome_message: form.telegram_welcome_message,
      }
      // Token is write-only (never returned from the server) — an empty
      // field here means "leave it as is," not "clear it."
      if (form.telegram_bot_token) values.telegram_bot_token = form.telegram_bot_token
      await api.put('/settings', { values })
      await refresh()
      setForm((f) => ({ ...f, telegram_bot_token: '' }))
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  if (!can('settings.manage')) return null

  return (
    <Card className="max-w-lg p-6">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-medium text-ink/70">
        <FontAwesomeIcon icon={faRobot} className="text-accent" />
        إعدادات البوت
      </h2>
      <p className="mb-4 text-xs text-muted">
        سوّي بوت جديد من <span className="font-mono">@BotFather</span> بتيليغرام، وحط التوكن هون. اسم البوت مش ضروري.
      </p>

      <div className="space-y-3">
        <Input
          label="توكن البوت"
          type="password"
          value={form.telegram_bot_token}
          onChange={(e) => setForm({ ...form, telegram_bot_token: e.target.value })}
          placeholder="محفوظ مسبقاً — اكتب توكن جديد بس إذا بدك تغيّره"
        />
        <Input
          label="اسم البوت (اختياري، بدون @)"
          value={form.telegram_bot_username}
          onChange={(e) => setForm({ ...form, telegram_bot_username: e.target.value })}
          placeholder="MyClinicBot"
        />
        <div>
          <label className="mb-1 block text-sm text-ink/70">الرسالة الافتتاحية</label>
          <textarea
            rows={3}
            value={form.telegram_welcome_message}
            onChange={(e) => setForm({ ...form, telegram_welcome_message: e.target.value })}
            placeholder="أهلاً بك! 👋 اختر واحد من الأزرار تحت 👇"
            className="w-full rounded-lg border border-border bg-surface p-2 text-sm focus:border-accent focus:outline-none"
          />
          <p className="mt-1 text-xs text-muted">
            أول رسالة بتوصل أي حدا بيفتح البوت لأول مرة. اتركها فاضية للرسالة الافتراضية. الأزرار تحتها ثابتة لأنها هي اللي بتسجّله.
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button onClick={save} loading={saving}>
          {saving ? 'جارِ الحفظ...' : 'حفظ'}
        </Button>
        {saved && <span className="text-sm text-success">انحفظت ✓</span>}
      </div>
    </Card>
  )
}

/** Small async patient search combobox — patients aren't a static list like doctors, so we fetch matches as the owner types instead of preloading everyone. */
function PatientPicker({ onPick }: { onPick: (p: Patient) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Patient[] | null>(null)

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults(null)
      return
    }
    const id = setTimeout(() => {
      api.get('/patients', { params: { search: trimmed } }).then((res) => setResults(res.data.data))
    }, 250)
    return () => clearTimeout(id)
  }, [query])

  return (
    <div className="relative w-64">
      <FontAwesomeIcon icon={faMagnifyingGlass} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted" />
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="بحث عن مريض موجود..."
        className="w-full rounded-lg border border-border bg-surface py-1.5 pe-2 ps-7 text-sm focus:border-accent focus:outline-none"
      />
      {query.trim().length >= 2 && (
        <div className="absolute right-0 top-full z-40 mt-1 w-full rounded-lg border border-border bg-surface shadow-lg">
          {results === null ? (
            <p className="p-3 text-center text-xs text-muted">جارِ البحث...</p>
          ) : results.length === 0 ? (
            <p className="p-3 text-center text-xs text-muted">ما في نتائج.</p>
          ) : (
            <ul className="max-h-48 overflow-y-auto py-1">
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(p)
                      setQuery('')
                      setResults(null)
                    }}
                    className="flex w-full flex-col items-start px-2.5 py-1.5 text-start text-sm hover:bg-accent-soft"
                  >
                    <span>{p.full_name}</span>
                    <span className="text-xs text-muted">{p.code}{p.phone ? ` · ${p.phone}` : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export default function TelegramPage() {
  const navigate = useNavigate()
  const [pending, setPending] = useState<PendingRegistration[] | null>(null)
  const [doctors, setDoctors] = useState<DoctorOption[]>([])
  const [linkedDoctors, setLinkedDoctors] = useState<LinkedDoctor[] | null>(null)
  const [linkedPatients, setLinkedPatients] = useState<LinkedPatient[] | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [mode, setMode] = useState<Record<number, 'doctor' | 'patient' | null>>({})
  const [doctorChoice, setDoctorChoice] = useState<Record<number, string>>({})
  const [patientChoice, setPatientChoice] = useState<Record<number, Patient | null>>({})

  function load() {
    api.get('/telegram-registrations').then((res) => setPending(res.data))
    api.get('/doctors').then((res) => setDoctors(res.data.data.map((d: { id: number; full_name: string }) => ({ id: d.id, full_name: d.full_name }))))
    api.get('/telegram-registrations-linked').then((res) => {
      setLinkedDoctors(res.data.doctors)
      setLinkedPatients(res.data.patients)
    })
  }

  useEffect(load, [])

  async function linkDoctor(id: number) {
    if (!doctorChoice[id]) return
    setBusyId(id)
    try {
      await api.post(`/telegram-registrations/${id}/link-doctor`, { doctor_id: Number(doctorChoice[id]) })
      load()
    } finally {
      setBusyId(null)
    }
  }

  async function linkPatient(id: number) {
    const p = patientChoice[id]
    if (!p) return
    setBusyId(id)
    try {
      await api.post(`/telegram-registrations/${id}/link-patient`, { patient_id: p.id })
      load()
    } finally {
      setBusyId(null)
    }
  }

  function createNewDoctor(link: PendingRegistration) {
    navigate(`/doctors?new=1&telegram_link_id=${link.id}&name=${encodeURIComponent(link.registered_name)}`)
  }

  function createNewPatient(link: PendingRegistration) {
    navigate(
      `/patients?new=1&telegram_link_id=${link.id}&name=${encodeURIComponent(link.registered_name)}&phone=${encodeURIComponent(link.registered_phone ?? '')}`,
    )
  }

  async function reject(id: number) {
    if (!window.confirm('رفض هذا الطلب نهائياً؟')) return
    setBusyId(id)
    try {
      await api.delete(`/telegram-registrations/${id}`)
      load()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <PageHeader title="تيليغرام" subtitle="إعدادات البوت وطلبات ربط الأطباء والمرضى" />

      <div className="space-y-6">
        <BotConfigCard />

        <Card className="max-w-2xl p-6">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-medium text-ink/70">
            <FontAwesomeIcon icon={faUserPlus} className="text-accent" />
            طلبات الربط {pending && pending.length > 0 && `(${pending.length})`}
          </h2>
          <p className="mb-4 text-xs text-muted">لما حدا يبعت اسمه للبوت أول مرة، بيظهر هون — اربطه بطبيب أو مريض موجود، أو أنشئ ملف جديد له.</p>

          {pending === null ? (
            <p className="text-sm text-muted">جارِ التحميل...</p>
          ) : pending.length === 0 ? (
            <p className="text-sm text-muted">ما في طلبات ربط جديدة حالياً.</p>
          ) : (
            <div className="space-y-4">
              {pending.map((p) => (
                <div key={p.id} className="rounded-xl border border-border p-3">
                  <p className="mb-2 text-sm font-medium text-ink">
                    {p.registered_name} {p.registered_phone && <span className="text-muted">— {p.registered_phone}</span>}
                  </p>

                  {mode[p.id] === 'doctor' ? (
                    <div className="flex flex-wrap items-end gap-2">
                      <SearchableSelect
                        options={doctors.map((d) => ({ value: String(d.id), label: d.full_name }))}
                        value={doctorChoice[p.id] ?? ''}
                        onChange={(v) => setDoctorChoice({ ...doctorChoice, [p.id]: v })}
                        placeholder="اختر الطبيب..."
                        className="flex-1"
                      />
                      <Button onClick={() => linkDoctor(p.id)} loading={busyId === p.id} disabled={!doctorChoice[p.id]} className="px-3 py-1.5 text-xs">
                        <FontAwesomeIcon icon={faCheck} />
                        تأكيد
                      </Button>
                      <button type="button" onClick={() => createNewDoctor(p)} className="flex items-center gap-1 text-xs text-accent hover:underline">
                        <FontAwesomeIcon icon={faPlus} />
                        طبيب جديد بهالاسم
                      </button>
                      <button onClick={() => setMode({ ...mode, [p.id]: null })} className="text-xs text-muted hover:underline">إلغاء</button>
                    </div>
                  ) : mode[p.id] === 'patient' ? (
                    <div className="flex flex-wrap items-end gap-2">
                      <PatientPicker onPick={(picked) => setPatientChoice({ ...patientChoice, [p.id]: picked })} />
                      {patientChoice[p.id] && (
                        <span className="rounded-lg bg-accent-soft px-2 py-1 text-xs text-accent">
                          {patientChoice[p.id]!.full_name}
                        </span>
                      )}
                      <Button onClick={() => linkPatient(p.id)} loading={busyId === p.id} disabled={!patientChoice[p.id]} className="px-3 py-1.5 text-xs">
                        <FontAwesomeIcon icon={faCheck} />
                        تأكيد
                      </Button>
                      <button type="button" onClick={() => createNewPatient(p)} className="flex items-center gap-1 text-xs text-accent hover:underline">
                        <FontAwesomeIcon icon={faPlus} />
                        مريض جديد بهالاسم
                      </button>
                      <button onClick={() => setMode({ ...mode, [p.id]: null })} className="text-xs text-muted hover:underline">إلغاء</button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => setMode({ ...mode, [p.id]: 'doctor' })}
                        className="flex items-center gap-1.5 rounded-lg bg-accent-soft px-2.5 py-1.5 text-xs font-medium text-accent hover:bg-accent hover:text-white"
                      >
                        <FontAwesomeIcon icon={faUserDoctor} />
                        طبيب
                      </button>
                      <button
                        onClick={() => setMode({ ...mode, [p.id]: 'patient' })}
                        className="flex items-center gap-1.5 rounded-lg bg-accent-soft px-2.5 py-1.5 text-xs font-medium text-accent hover:bg-accent hover:text-white"
                      >
                        <FontAwesomeIcon icon={faUser} />
                        مريض
                      </button>
                      <button
                        onClick={() => reject(p.id)}
                        disabled={busyId === p.id}
                        className="flex items-center gap-1.5 rounded-lg bg-danger-soft px-2.5 py-1.5 text-xs font-medium text-danger hover:bg-danger hover:text-white disabled:opacity-50"
                      >
                        <FontAwesomeIcon icon={faXmark} />
                        رفض
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="p-6">
            <h2 className="mb-1 flex items-center gap-2 text-sm font-medium text-ink/70">
              <FontAwesomeIcon icon={faUserDoctor} className="text-accent" />
              الأطباء المرتبطين {linkedDoctors && linkedDoctors.length > 0 && `(${linkedDoctors.length})`}
            </h2>
            {linkedDoctors === null ? (
              <p className="mt-3 text-sm text-muted">جارِ التحميل...</p>
            ) : linkedDoctors.length === 0 ? (
              <p className="mt-3 text-sm text-muted">ولا طبيب مربوط بتيليغرام حالياً.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {linkedDoctors.map((d) => (
                  <li key={d.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                    <span className="text-ink">{d.full_name}</span>
                    <span className="text-xs text-muted">{d.linked_at}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-6">
            <h2 className="mb-1 flex items-center gap-2 text-sm font-medium text-ink/70">
              <FontAwesomeIcon icon={faUser} className="text-accent" />
              المرضى المرتبطين {linkedPatients && linkedPatients.length > 0 && `(${linkedPatients.length})`}
            </h2>
            {linkedPatients === null ? (
              <p className="mt-3 text-sm text-muted">جارِ التحميل...</p>
            ) : linkedPatients.length === 0 ? (
              <p className="mt-3 text-sm text-muted">ولا مريض مربوط بتيليغرام حالياً.</p>
            ) : (
              <ul className="mt-3 max-h-96 space-y-2 overflow-y-auto">
                {linkedPatients.map((p) => (
                  <li key={p.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                    <span className="text-ink">
                      {p.full_name}
                      {p.phone && <span className="text-muted"> — {p.phone}</span>}
                    </span>
                    <span className="text-xs text-muted">{p.linked_at}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
