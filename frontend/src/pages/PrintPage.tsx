import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faMagnifyingGlass, faPrint, faUser } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { formatDate } from '../lib/formatDate'
import { printDocument, metaRow } from '../lib/print'
import { useClinicProfile } from '../lib/useClinicProfile'
import { Card, PageHeader, Button, Tabs } from '../components/ui'
import type { Patient, Ledger, WorkItem } from '../types'

function PatientPicker({ patient, onPick }: { patient: Patient | null; onPick: (p: Patient) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Patient[]>([])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      return
    }
    const id = setTimeout(() => {
      api.get('/patients', { params: { search: q } }).then((res) => setResults(res.data.data))
    }, 250)
    return () => clearTimeout(id)
  }, [query])

  return (
    <div className="mb-6">
      <div className="relative">
        <FontAwesomeIcon icon={faMagnifyingGlass} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          value={patient ? patient.full_name : query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ابحث عن مريض بالاسم أو رقم الهاتف..."
          className="w-full max-w-md rounded-xl border border-border bg-surface py-2.5 pe-3 ps-9 text-sm focus:border-accent focus:outline-none"
        />
      </div>
      {results.length > 0 && !patient && (
        <div className="mt-2 max-w-md overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          {results.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                onPick(p)
                setResults([])
                setQuery('')
              }}
              className="flex w-full items-center gap-2 border-b border-border/60 px-3 py-2 text-sm last:border-0 hover:bg-background"
            >
              <FontAwesomeIcon icon={faUser} className="text-ink/30" />
              {p.full_name} <span className="text-muted">({p.code})</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function PrescriptionTab({ patient }: { patient: Patient | null }) {
  const clinic = useClinicProfile()
  const [doctorName, setDoctorName] = useState('')
  const [diagnosis, setDiagnosis] = useState('')
  const [medications, setMedications] = useState('')

  function print() {
    if (!patient) return
    const body = `
      ${metaRow([
        ['المريض', patient.full_name],
        ['التاريخ', formatDate(new Date().toISOString())],
        ...(doctorName ? ([['الطبيب', doctorName]] as [string, string][]) : []),
      ])}
      ${diagnosis ? `<p style="font-size:13px;margin-bottom:12px;"><b>التشخيص:</b> ${diagnosis.replace(/\n/g, '<br/>')}</p>` : ''}
      <p style="font-size:13px;margin-bottom:6px;"><b>الأدوية:</b></p>
      <div style="white-space:pre-wrap;font-size:14px;line-height:1.9;border:1px solid #ddd;border-radius:8px;padding:14px;min-height:120px;">${medications.replace(/\n/g, '<br/>')}</div>
      <div class="signature"><div>توقيع الطبيب</div></div>
    `
    printDocument('وصفة طبية', body, clinic)
  }

  return (
    <Card className="max-w-2xl p-6">
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs text-muted">اسم الطبيب (اختياري)</label>
          <input value={doctorName} onChange={(e) => setDoctorName(e.target.value)} className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none" />
        </div>
      </div>
      <label className="mb-1 block text-xs text-muted">التشخيص/الملاحظة (اختياري)</label>
      <textarea value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} rows={2} className="mb-3 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none" />
      <label className="mb-1 block text-xs text-muted">الأدوية</label>
      <textarea
        value={medications}
        onChange={(e) => setMedications(e.target.value)}
        rows={6}
        placeholder={'مثال:\nAmoxicillin 500mg — كل 8 ساعات لمدة 5 أيام\nIbuprofen 400mg — عند الحاجة للألم'}
        className="mb-4 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none"
      />
      <Button onClick={print} disabled={!patient || !medications.trim()}>
        <FontAwesomeIcon icon={faPrint} />
        طباعة الوصفة
      </Button>
      {!patient && <p className="mt-2 text-xs text-danger">اختر مريض أول.</p>}
    </Card>
  )
}

function LedgerTab({ patient }: { patient: Patient | null }) {
  const clinic = useClinicProfile()
  const [ledger, setLedger] = useState<Ledger | null>(null)

  useEffect(() => {
    if (!patient) return
    api.get(`/patients/${patient.id}/ledger`).then((res) => setLedger(res.data))
  }, [patient])

  function print() {
    if (!patient || !ledger) return
    const rows = ledger.transactions
      .map(
        (t) => `<tr>
          <td>${formatDate(t.occurred_at)}</td>
          <td>${t.type === 'charge' ? 'تحصيل خدمة' : t.type === 'payment' ? 'دفعة' : t.type === 'refund' ? 'استرجاع' : 'تسوية'}</td>
          <td>${Number(t.amount_ils).toFixed(2)} ₪</td>
          <td>${t.balance_after_ils.toFixed(2)} ₪</td>
        </tr>`,
      )
      .join('')
    const body = `
      ${metaRow([
        ['المريض', patient.full_name],
        ['الكود', patient.code],
        ['التاريخ', formatDate(new Date().toISOString())],
      ])}
      <table>
        <thead><tr><th>التاريخ</th><th>النوع</th><th>المبلغ</th><th>الرصيد بعدها</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr class="total-row"><td colspan="3">الرصيد المستحق</td><td>${ledger.outstanding_ils.toFixed(2)} ₪</td></tr></tfoot>
      </table>
    `
    printDocument('كشف حساب', body, clinic)
  }

  return (
    <Card className="max-w-2xl p-6">
      {!patient ? (
        <p className="text-sm text-danger">اختر مريض أول.</p>
      ) : !ledger ? (
        <p className="text-sm text-muted">جارِ التحميل...</p>
      ) : (
        <>
          <p className="mb-4 text-sm text-ink/80">
            الرصيد المستحق: <span className={`font-semibold ${ledger.outstanding_ils > 0 ? 'text-danger' : 'text-success'}`}>{ledger.outstanding_ils.toFixed(2)} ₪</span>
            {' — '}{ledger.transactions.length} حركة مالية
          </p>
          <Button onClick={print}>
            <FontAwesomeIcon icon={faPrint} />
            طباعة كشف الحساب
          </Button>
        </>
      )}
    </Card>
  )
}

function AppointmentCardTab({ patient }: { patient: Patient | null }) {
  const clinic = useClinicProfile()
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [doctorName, setDoctorName] = useState('')
  const [note, setNote] = useState('')

  function print() {
    if (!patient || !date) return
    const body = `
      ${metaRow([
        ['المريض', patient.full_name],
        ['التاريخ', date],
        ...(time ? ([['الوقت', time]] as [string, string][]) : []),
        ...(doctorName ? ([['الطبيب', doctorName]] as [string, string][]) : []),
      ])}
      ${note ? `<p style="font-size:13px;">${note.replace(/\n/g, '<br/>')}</p>` : ''}
    `
    printDocument('بطاقة موعد', body, clinic)
  }

  return (
    <Card className="max-w-2xl p-6">
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs text-muted">تاريخ الموعد</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted">الوقت (اختياري)</label>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none" />
        </div>
      </div>
      <label className="mb-1 block text-xs text-muted">اسم الطبيب (اختياري)</label>
      <input value={doctorName} onChange={(e) => setDoctorName(e.target.value)} className="mb-3 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none" />
      <label className="mb-1 block text-xs text-muted">ملاحظة (اختياري)</label>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mb-4 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none" />
      <Button onClick={print} disabled={!patient || !date}>
        <FontAwesomeIcon icon={faPrint} />
        طباعة بطاقة الموعد
      </Button>
      {!patient && <p className="mt-2 text-xs text-danger">اختر مريض أول.</p>}
    </Card>
  )
}

function WorkPlanTab({ patient }: { patient: Patient | null }) {
  const clinic = useClinicProfile()
  const [items, setItems] = useState<WorkItem[]>([])
  const [itemId, setItemId] = useState('')

  useEffect(() => {
    if (!patient) return
    api.get('/work-items', { params: { patient_id: patient.id, status: 'in_progress' } }).then((res) => setItems(res.data.data))
  }, [patient])

  const item = items.find((p) => String(p.id) === itemId)

  function print() {
    if (!patient || !item) return
    const rows = item.steps
      .map((step) => `<tr><td>${step.title}</td><td>${item.teeth.join('، ')}</td><td>${Number(step.price).toFixed(2)} ₪</td></tr>`)
      .join('')
    const total = item.steps.reduce((s, st) => s + Number(st.price) * (item.price_per_tooth ? item.teeth.length : 1), 0)
    const body = `
      ${metaRow([
        ['المريض', patient.full_name],
        ['الطبيب', item.doctor_name ?? '—'],
        ['التاريخ', formatDate(new Date().toISOString())],
      ])}
      <table>
        <thead><tr><th>الخطوة</th><th>الأسنان</th><th>السعر</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr class="total-row"><td colspan="2">الإجمالي التقديري</td><td>${total.toFixed(2)} ₪</td></tr></tfoot>
      </table>
      <p style="font-size:12px;color:#555;margin-top:16px;">بالتوقيع أدناه، المريض موافق على خطة العلاج المذكورة أعلاه وأسعارها.</p>
      <div class="signature"><div>توقيع المريض / ولي الأمر</div><div>توقيع الطبيب</div></div>
    `
    printDocument(`خطة علاج — ${item.service_name ?? ''}`, body, clinic)
  }

  return (
    <Card className="max-w-2xl p-6">
      {!patient ? (
        <p className="text-sm text-danger">اختر مريض أول.</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">ما عند هالمريض شغل قيد التنفيذ.</p>
      ) : (
        <>
          <label className="mb-1 block text-xs text-muted">اختر الشغل</label>
          <select value={itemId} onChange={(e) => setItemId(e.target.value)} className="mb-4 w-full max-w-sm rounded-xl border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none">
            <option value="">اختر...</option>
            {items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.service_name} — أسنان {p.teeth.join('، ')}
              </option>
            ))}
          </select>
          <div>
            <Button onClick={print} disabled={!item}>
              <FontAwesomeIcon icon={faPrint} />
              طباعة للتوقيع
            </Button>
          </div>
        </>
      )}
    </Card>
  )
}

export default function PrintPage() {
  const [patient, setPatient] = useState<Patient | null>(null)

  return (
    <div>
      <PageHeader title="الطباعة" subtitle="اختر مريض، وبعدها شو بدك تطبعله" />
      <PatientPicker patient={patient} onPick={setPatient} />
      {patient && (
        <button onClick={() => setPatient(null)} className="mb-4 text-xs text-muted hover:text-ink">
          × تغيير المريض
        </button>
      )}
      <Tabs
        defaultTab="prescription"
        tabs={[
          { key: 'prescription', label: 'وصفة طبية', content: <PrescriptionTab patient={patient} /> },
          { key: 'ledger', label: 'كشف حساب', content: <LedgerTab patient={patient} /> },
          { key: 'appointment', label: 'بطاقة موعد', content: <AppointmentCardTab patient={patient} /> },
          { key: 'plan', label: 'خطة علاج للتوقيع', content: <WorkPlanTab patient={patient} /> },
        ]}
      />
    </div>
  )
}
