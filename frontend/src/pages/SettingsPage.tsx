import { useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPaperPlane, faLink, faLinkSlash, faBuilding, faImage, faTrash, faSliders, faBell } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { Card, PageHeader, Button, Input } from '../components/ui'

interface TelegramLinkStatus {
  linked: boolean
  link_code: string | null
  bot_username: string
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
  const [form, setForm] = useState({ reminder_appointments_enabled: true, reminder_checks_enabled: true, reminder_lab_enabled: true })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!data) return
    setForm({
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
    ['reminder_appointments_enabled', 'تذكير المواعيد اليومي للأطباء'],
    ['reminder_checks_enabled', 'تذكير الشيكات المستحقة قريباً'],
    ['reminder_lab_enabled', 'تذكير حالات المخبر المتأخرة'],
  ]

  return (
    <Card className="max-w-lg p-6">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-medium text-ink/70">
        <FontAwesomeIcon icon={faBell} className="text-accent" />
        تذكيرات تيليغرام
      </h2>
      <p className="mb-4 text-xs text-muted">فعّل أو عطّل كل نوع تذكير يومي يُرسل عبر البوت.</p>

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
