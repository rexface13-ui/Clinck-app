import { useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPaperPlane, faLink, faLinkSlash, faBuilding, faImage, faTrash, faSliders, faBell, faRobot, faCheck, faUserDoctor, faUserPlus, faXmark, faFileLines, faCloudArrowUp } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { Card, PageHeader, Button, Input, SearchableSelect } from '../components/ui'
import type { Branch } from '../types'

interface TelegramLinkStatus {
  linked: boolean
  link_code: string | null
  bot_username: string
}

interface PendingRegistration {
  id: number
  telegram_chat_id: number
  registered_name: string
  registered_phone: string
  created_at: string
}

interface StaffOption {
  id: number
  name: string
}

interface DoctorOption {
  id: number
  full_name: string
}

function ClinicProfileCard() {
  const { data, can, refresh } = useAuth()
  const [form, setForm] = useState({ clinic_name: '', clinic_phone: '', clinic_address: '', clinic_logo: '' })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!data) return
    setForm({
      clinic_name: (data.settings.clinic_name as string) ?? '',
      clinic_phone: (data.settings.clinic_phone as string) ?? '',
      clinic_address: (data.settings.clinic_address as string) ?? '',
      clinic_logo: (data.settings.clinic_logo as string) ?? '',
    })
  }, [data])

  function onLogoPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setForm((f) => ({ ...f, clinic_logo: String(reader.result) }))
    reader.readAsDataURL(file)
  }

  async function save() {
    setSaving(true)
    setSaved(false)
    try {
      await api.put('/settings', { values: form })
      await refresh()
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
        <FontAwesomeIcon icon={faBuilding} className="text-accent" />
        بيانات العيادة
      </h2>
      <p className="mb-4 text-xs text-muted">بتظهر بترويسة كل شي بتطبعه (فواتير، وصفات، خطط علاج).</p>

      <div className="mb-4 flex items-center gap-3">
        {form.clinic_logo ? (
          <img src={form.clinic_logo} alt="شعار العيادة" className="size-16 rounded-xl border border-border object-contain p-1" />
        ) : (
          <div className="flex size-16 items-center justify-center rounded-xl border border-dashed border-border text-ink/30">
            <FontAwesomeIcon icon={faImage} />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-ink/70 hover:bg-background"
          >
            {form.clinic_logo ? 'تغيير الشعار' : 'رفع شعار'}
          </button>
          {form.clinic_logo && (
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, clinic_logo: '' }))}
              className="flex items-center gap-1 text-xs text-danger hover:underline"
            >
              <FontAwesomeIcon icon={faTrash} />
              إزالة
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onLogoPick} />
        </div>
      </div>

      <div className="space-y-3">
        <Input label="اسم العيادة" value={form.clinic_name} onChange={(e) => setForm({ ...form, clinic_name: e.target.value })} />
        <Input label="الهاتف" value={form.clinic_phone} onChange={(e) => setForm({ ...form, clinic_phone: e.target.value })} />
        <Input label="العنوان" value={form.clinic_address} onChange={(e) => setForm({ ...form, clinic_address: e.target.value })} />
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

function GeneralSettingsCard() {
  const { data, can, refresh } = useAuth()
  const [form, setForm] = useState({
    default_appointment_duration: '30',
    base_currency: 'ILS',
    invoice_footer_note: '',
    clinic_hours_start: '10:00',
    clinic_hours_end: '22:00',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!data) return
    setForm({
      default_appointment_duration: String((data.settings.default_appointment_duration as number) ?? 30),
      base_currency: (data.settings.base_currency as string) ?? 'ILS',
      invoice_footer_note: (data.settings.invoice_footer_note as string) ?? '',
      clinic_hours_start: (data.settings.clinic_hours_start as string) ?? '10:00',
      clinic_hours_end: (data.settings.clinic_hours_end as string) ?? '22:00',
    })
  }, [data])

  async function save() {
    setSaving(true)
    setSaved(false)
    try {
      await api.put('/settings', { values: { ...form, default_appointment_duration: Number(form.default_appointment_duration) } })
      await refresh()
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
        <FontAwesomeIcon icon={faSliders} className="text-accent" />
        إعدادات عامة
      </h2>
      <p className="mb-4 text-xs text-muted">قيم افتراضية تُستخدم بالمواعيد والفواتير والطباعة.</p>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm text-muted">مدة الموعد الافتراضية (بالدقايق)</label>
          <input
            type="number"
            min={5}
            max={240}
            value={form.default_appointment_duration}
            onChange={(e) => setForm({ ...form, default_appointment_duration: e.target.value })}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-muted">العملة الافتراضية</label>
          <select
            value={form.base_currency}
            onChange={(e) => setForm({ ...form, base_currency: e.target.value })}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none"
          >
            <option value="ILS">شيكل (ILS)</option>
            <option value="USD">دولار (USD)</option>
            <option value="JOD">دينار (JOD)</option>
          </select>
        </div>
        <Input
          label="ملاحظة تذييل الطباعة (اختياري)"
          value={form.invoice_footer_note}
          onChange={(e) => setForm({ ...form, invoice_footer_note: e.target.value })}
        />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm text-muted">دوام العيادة — من</label>
            <input
              type="time"
              value={form.clinic_hours_start}
              onChange={(e) => setForm({ ...form, clinic_hours_start: e.target.value })}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted">دوام العيادة — إلى</label>
            <input
              type="time"
              value={form.clinic_hours_end}
              onChange={(e) => setForm({ ...form, clinic_hours_end: e.target.value })}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
          </div>
        </div>
        <p className="text-xs text-muted">
          هاد نطاق الجدول الافتراضي بصفحة المواعيد. إذا طبيب معين عنده موعد قبل أو بعد هالنطاق، الجدول بيتوسع تلقائياً هاليوم بس، بدون ما يغيّر هالإعداد.
        </p>
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

function RemindersSettingsCard() {
  const { data, can, refresh } = useAuth()
  const [form, setForm] = useState({
    notify_new_appointment_enabled: true,
    reminder_appointments_enabled: true,
    reminder_checks_enabled: true,
    reminder_lab_enabled: true,
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!data) return
    setForm({
      notify_new_appointment_enabled: (data.settings.notify_new_appointment_enabled as boolean) ?? true,
      reminder_appointments_enabled: (data.settings.reminder_appointments_enabled as boolean) ?? true,
      reminder_checks_enabled: (data.settings.reminder_checks_enabled as boolean) ?? true,
      reminder_lab_enabled: (data.settings.reminder_lab_enabled as boolean) ?? true,
    })
  }, [data])

  async function save() {
    setSaving(true)
    setSaved(false)
    try {
      await api.put('/settings', { values: form })
      await refresh()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  if (!can('settings.manage')) return null

  const rows: [keyof typeof form, string][] = [
    ['notify_new_appointment_enabled', 'إشعار فوري عند حجز موعد جديد (للطبيب)'],
    ['reminder_appointments_enabled', 'تذكير المواعيد اليومي للأطباء'],
    ['reminder_checks_enabled', 'تذكير الشيكات المستحقة قريباً'],
    ['reminder_lab_enabled', 'تذكير حالات المخبر المتأخرة'],
  ]

  return (
    <Card className="max-w-lg p-6">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-medium text-ink/70">
        <FontAwesomeIcon icon={faBell} className="text-accent" />
        إشعارات وتذكيرات تيليغرام
      </h2>
      <p className="mb-4 text-xs text-muted">فعّل أو عطّل كل نوع إشعار/تذكير يُرسل عبر البوت.</p>

      <div className="space-y-2">
        {rows.map(([key, label]) => (
          <label key={key} className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-sm">
            {label}
            <input
              type="checkbox"
              checked={form[key]}
              onChange={(e) => setForm({ ...form, [key]: e.target.checked })}
              className="size-4 accent-accent"
            />
          </label>
        ))}
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

function TelegramBotSettingsCard() {
  const { can } = useAuth()
  const [form, setForm] = useState({ telegram_bot_token: '', telegram_bot_username: '' })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function save() {
    setSaving(true)
    setSaved(false)
    try {
      const values: Record<string, string> = { telegram_bot_username: form.telegram_bot_username }
      // Only send the token if the owner actually typed a new one — it's
      // write-only (never returned from the server), so an empty field
      // here means "leave it as is," not "clear it."
      if (form.telegram_bot_token) values.telegram_bot_token = form.telegram_bot_token
      await api.put('/settings', { values })
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
        بوت تيليغرام — إعدادات التفعيل
      </h2>
      <p className="mb-4 text-xs text-muted">
        سوّي بوت جديد من <span className="font-mono">@BotFather</span> بتيليغرام، وحط التوكن هون. بعدين لازم تشغّل الأمر{' '}
        <span className="font-mono">php artisan telegram:poll</span> بشكل دائم على السيرفر (مو مرة وحدة) عشان البوت يستمع للرسائل.
      </p>

      <div className="space-y-3">
        <Input
          label="اسم البوت (بدون @)"
          value={form.telegram_bot_username}
          onChange={(e) => setForm({ ...form, telegram_bot_username: e.target.value })}
          placeholder="MyClinicBot"
        />
        <Input
          label="توكن البوت"
          type="password"
          value={form.telegram_bot_token}
          onChange={(e) => setForm({ ...form, telegram_bot_token: e.target.value })}
          placeholder="محفوظ مسبقاً — اكتب توكن جديد بس إذا بدك تغيّره"
        />
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

function TelegramRegistrationsCard() {
  const { can, data } = useAuth()
  const branches: Branch[] = data?.branches ?? []
  const [pending, setPending] = useState<PendingRegistration[] | null>(null)
  const [staff, setStaff] = useState<StaffOption[]>([])
  const [doctors, setDoctors] = useState<DoctorOption[]>([])
  const [busyId, setBusyId] = useState<number | null>(null)
  const [mode, setMode] = useState<Record<number, 'staff' | 'doctor' | 'patient' | null>>({})
  const [staffChoice, setStaffChoice] = useState<Record<number, string>>({})
  const [doctorChoice, setDoctorChoice] = useState<Record<number, string>>({})
  const [patientForm, setPatientForm] = useState<Record<number, { branch_id: string; gender: 'male' | 'female' }>>({})

  function load() {
    api.get('/telegram-registrations').then((res) => setPending(res.data))
    api.get('/users').then((res) => setStaff(res.data.data.map((u: { id: number; name: string }) => ({ id: u.id, name: u.name }))))
    api.get('/doctors').then((res) => setDoctors(res.data.data.map((d: { id: number; full_name: string }) => ({ id: d.id, full_name: d.full_name }))))
  }

  useEffect(load, [])

  async function linkStaff(id: number) {
    if (!staffChoice[id]) return
    setBusyId(id)
    try {
      await api.post(`/telegram-registrations/${id}/link-staff`, { user_id: Number(staffChoice[id]) })
      load()
    } finally {
      setBusyId(null)
    }
  }

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
    const f = patientForm[id]
    if (!f?.branch_id) return
    setBusyId(id)
    try {
      await api.post(`/telegram-registrations/${id}/link-patient`, { branch_id: Number(f.branch_id), gender: f.gender })
      load()
    } finally {
      setBusyId(null)
    }
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

  if (!can('settings.manage')) return null
  if (pending && pending.length === 0) return null

  return (
    <Card className="max-w-lg p-6">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-medium text-ink/70">
        <FontAwesomeIcon icon={faUserPlus} className="text-accent" />
        طلبات تسجيل تيليغرام {pending && pending.length > 0 && `(${pending.length})`}
      </h2>
      <p className="mb-4 text-xs text-muted">ناس تواصلوا مع البوت لأول مرة — حدد كل واحد إذا موظف عنده حساب دخول، طبيب، أو مريض.</p>

      <div className="space-y-4">
        {(pending ?? []).map((p) => (
          <div key={p.id} className="rounded-xl border border-border p-3">
            <p className="mb-2 text-sm font-medium text-ink">{p.registered_name} — {p.registered_phone}</p>

            {mode[p.id] === 'staff' ? (
              <div className="flex flex-wrap items-end gap-2">
                <SearchableSelect
                  options={staff.map((s) => ({ value: String(s.id), label: s.name }))}
                  value={staffChoice[p.id] ?? ''}
                  onChange={(v) => setStaffChoice({ ...staffChoice, [p.id]: v })}
                  placeholder="اختر المستخدم..."
                  className="flex-1"
                />
                <Button onClick={() => linkStaff(p.id)} loading={busyId === p.id} className="px-3 py-1.5 text-xs">
                  تأكيد
                </Button>
                <button onClick={() => setMode({ ...mode, [p.id]: null })} className="text-xs text-muted hover:underline">إلغاء</button>
              </div>
            ) : mode[p.id] === 'doctor' ? (
              <div className="flex flex-wrap items-end gap-2">
                <SearchableSelect
                  options={doctors.map((d) => ({ value: String(d.id), label: d.full_name }))}
                  value={doctorChoice[p.id] ?? ''}
                  onChange={(v) => setDoctorChoice({ ...doctorChoice, [p.id]: v })}
                  placeholder="اختر الطبيب..."
                  className="flex-1"
                />
                <Button onClick={() => linkDoctor(p.id)} loading={busyId === p.id} className="px-3 py-1.5 text-xs">
                  تأكيد
                </Button>
                <button onClick={() => setMode({ ...mode, [p.id]: null })} className="text-xs text-muted hover:underline">إلغاء</button>
              </div>
            ) : mode[p.id] === 'patient' ? (
              <div className="flex flex-wrap items-end gap-2">
                <select
                  value={patientForm[p.id]?.branch_id ?? ''}
                  onChange={(e) => setPatientForm({ ...patientForm, [p.id]: { branch_id: e.target.value, gender: patientForm[p.id]?.gender ?? 'male' } })}
                  className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
                >
                  <option value="">الفرع...</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <select
                  value={patientForm[p.id]?.gender ?? 'male'}
                  onChange={(e) => setPatientForm({ ...patientForm, [p.id]: { branch_id: patientForm[p.id]?.branch_id ?? '', gender: e.target.value as 'male' | 'female' } })}
                  className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
                >
                  <option value="male">ذكر</option>
                  <option value="female">أنثى</option>
                </select>
                <Button onClick={() => linkPatient(p.id)} loading={busyId === p.id} className="px-3 py-1.5 text-xs">
                  <FontAwesomeIcon icon={faCheck} />
                  إنشاء ملف مريض جديد
                </Button>
                <button onClick={() => setMode({ ...mode, [p.id]: null })} className="text-xs text-muted hover:underline">إلغاء</button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setMode({ ...mode, [p.id]: 'staff' })}
                  className="flex items-center gap-1.5 rounded-lg bg-accent-soft px-2.5 py-1.5 text-xs font-medium text-accent hover:bg-accent hover:text-white"
                >
                  <FontAwesomeIcon icon={faUserDoctor} />
                  موظف موجود
                </button>
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
                  <FontAwesomeIcon icon={faUserPlus} />
                  مريض جديد
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
    </Card>
  )
}

function DailyReportCard() {
  const { can, data, refresh } = useAuth()
  const [reportTime, setReportTime] = useState('22:00')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [reports, setReports] = useState<{ reports: string[]; repo_slug: string | null } | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [publishResult, setPublishResult] = useState<string | null>(null)
  const [publishError, setPublishError] = useState<string | null>(null)

  useEffect(() => {
    if (!data) return
    setReportTime((data.settings.daily_report_time as string) ?? '22:00')
  }, [data])

  function loadReports() {
    api.get('/reports').then((res) => setReports(res.data))
  }

  useEffect(loadReports, [])

  async function saveTime() {
    setSaving(true)
    setSaved(false)
    try {
      await api.put('/settings', { values: { daily_report_time: reportTime } })
      await refresh()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  async function publish() {
    setPublishing(true)
    setPublishResult(null)
    setPublishError(null)
    try {
      const res = await api.post('/reports/publish')
      setPublishResult(res.data.status === 'already_published' ? 'التقارير منشورة مسبقاً — ما في شي جديد.' : 'تم النشر بنجاح!')
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      setPublishError(message ?? 'تعذّر النشر.')
    } finally {
      setPublishing(false)
    }
  }

  if (!can('settings.manage')) return null

  const repoSlug = reports?.repo_slug
  const latest = reports?.reports?.[0]

  return (
    <Card className="max-w-lg p-6">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-medium text-ink/70">
        <FontAwesomeIcon icon={faFileLines} className="text-accent" />
        تقرير الإغلاق اليومي
      </h2>
      <p className="mb-4 text-xs text-muted">
        بيتولّد تلقائياً كل يوم بالوقت المحدد (محلياً بالسيرفر)، وبتوصلك رسالة تيليغرام تذكّرك تنشره. النشر (رفعه عالرابط) خطوة يدوية بضغطة زر — قصداً، مش تلقائي.
      </p>

      <div className="mb-4">
        <label className="mb-1 block text-sm text-muted">وقت توليد التقرير يومياً</label>
        <input
          type="time"
          value={reportTime}
          onChange={(e) => setReportTime(e.target.value)}
          className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none"
        />
      </div>
      <div className="mb-4 flex items-center gap-3">
        <Button onClick={saveTime} loading={saving}>
          {saving ? 'جارِ الحفظ...' : 'حفظ الوقت'}
        </Button>
        {saved && <span className="text-sm text-success">انحفظ ✓</span>}
      </div>

      <div className="border-t border-border/70 pt-3">
        <p className="mb-2 text-xs text-muted">
          {reports?.reports?.length ? `آخر تقرير مولّد: ${latest}` : 'ما في تقارير مولّدة بعد.'}
        </p>
        <Button onClick={publish} loading={publishing} variant="secondary">
          <FontAwesomeIcon icon={faCloudArrowUp} />
          {publishing ? 'جارِ النشر...' : 'نشر آخر تقرير الآن'}
        </Button>
        {publishResult && <p className="mt-2 text-sm text-success">{publishResult}</p>}
        {publishError && <p className="mt-2 text-sm text-danger">{publishError}</p>}
        {repoSlug && latest && (
          <p className="mt-2 text-xs text-muted">
            الرابط بعد النشر: <span className="font-mono">https://{repoSlug.split('/')[0]}.github.io/{repoSlug.split('/')[1]}/reports/{latest}.html</span>
          </p>
        )}
      </div>
    </Card>
  )
}

export default function SettingsPage() {
  const [status, setStatus] = useState<TelegramLinkStatus | null>(null)
  const [busy, setBusy] = useState(false)

  function load() {
    api.get<TelegramLinkStatus>('/telegram-link').then((res) => setStatus(res.data))
  }

  useEffect(load, [])

  async function generateCode() {
    setBusy(true)
    try {
      const res = await api.post<TelegramLinkStatus>('/telegram-link')
      setStatus(res.data)
    } finally {
      setBusy(false)
    }
  }

  async function unlink() {
    setBusy(true)
    try {
      await api.delete('/telegram-link')
      load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader title="الإعدادات" subtitle="تفضيلات الحساب والتنبيهات" />

      <div className="mb-6 space-y-6">
        <ClinicProfileCard />
        <GeneralSettingsCard />
        <RemindersSettingsCard />
        <TelegramBotSettingsCard />
        <TelegramRegistrationsCard />
        <DailyReportCard />
      </div>

      <Card className="max-w-lg p-6">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-ink/70">
          <FontAwesomeIcon icon={faPaperPlane} className="text-accent" />
          ربط تيليغرام
        </h2>

        {status?.linked ? (
          <>
            <p className="mb-4 text-sm text-accent">حسابك مربوط ببوت تيليغرام. بتوصلك تنبيهات المواعيد والشيكات.</p>
            <Button variant="danger" onClick={unlink} loading={busy}>
              <FontAwesomeIcon icon={faLinkSlash} />
              فك الربط
            </Button>
          </>
        ) : (
          <>
            <p className="mb-4 text-sm text-muted">اربط حسابك ببوت تيليغرام لتصلك تنبيهات المواعيد والشيكات المستحقة.</p>

            {status?.link_code ? (
              <div className="mb-4 rounded-xl bg-background p-4 text-sm">
                <p className="mb-2 text-ink/70">
                  افتح تيليغرام، دوّر على{' '}
                  <span className="font-mono">@{status.bot_username || '(البوت لسا ما انضاف)'}</span>، وابعت:
                </p>
                <p className="font-mono text-lg font-semibold text-accent">/link {status.link_code}</p>
              </div>
            ) : null}

            <Button onClick={generateCode} loading={busy}>
              <FontAwesomeIcon icon={faLink} />
              {busy ? 'جارِ التوليد...' : 'توليد كود ربط'}
            </Button>
          </>
        )}
      </Card>
    </div>
  )
}
