import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowRight,
  faCalendarPlus,
  faTriangleExclamation,
  faCheck,
  faClockRotateLeft,
  faUserXmark,
} from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import ToothChart from '../components/ToothChart'
import TreatmentPlanPanel from '../components/TreatmentPlanPanel'
import PatientLedgerPanel from '../components/PatientLedgerPanel'
import { Card, Badge, Button } from '../components/ui'
import type { PatientProfile, Service, Ledger } from '../types'

function isToday(iso: string): boolean {
  const d = new Date(iso)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

export default function PatientProfilePage() {
  const { id } = useParams()
  const [profile, setProfile] = useState<PatientProfile | null>(null)
  const [services, setServices] = useState<Service[]>([])
  const [ledger, setLedger] = useState<Ledger | null>(null)
  const [noteBody, setNoteBody] = useState('')
  const [updatingVisit, setUpdatingVisit] = useState(false)

  function load() {
    api.get(`/patients/${id}/profile`).then((res) => setProfile(res.data))
    api.get(`/patients/${id}/ledger`).then((res) => setLedger(res.data))
  }

  useEffect(() => {
    load()
    api.get('/services').then((res) => setServices(res.data.data))
  }, [id])

  async function setVisitOutcome(appointmentId: number, status: 'done' | 'cancelled' | 'no_show') {
    setUpdatingVisit(true)
    try {
      await api.put(`/appointments/${appointmentId}`, { status })
      load()
    } finally {
      setUpdatingVisit(false)
    }
  }

  async function addNote() {
    if (!noteBody.trim()) return
    await api.post(`/patients/${id}/notes`, { body: noteBody })
    setNoteBody('')
    load()
  }

  if (!profile) return <p className="text-sm text-muted">جارِ التحميل...</p>

  const { patient, tooth_states, tooth_findings, appointments, notes } = profile
  const todayAppointment = appointments.find((a) => isToday(a.starts_at) && (a.status === 'scheduled' || a.status === 'confirmed'))
  const hasDebt = !!ledger && ledger.outstanding_ils > 0

  return (
    <div>
      <Link to="/patients" className="mb-4 flex w-fit items-center gap-2 text-sm text-muted hover:text-ink">
        <FontAwesomeIcon icon={faArrowRight} />
        العودة للمرضى
      </Link>

      {hasDebt && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <FontAwesomeIcon icon={faTriangleExclamation} />
          <span>
            تنبيه: على هذا المريض دين مستحق بقيمة <span className="font-semibold">{ledger!.outstanding_ils.toFixed(2)} ₪</span> — راجع كشف الحساب تحت لتحصيل دفعة.
          </span>
        </div>
      )}

      <Card className="mb-6 flex items-center justify-between p-6">
        <div>
          <h1 className="text-xl font-semibold text-ink">{patient.full_name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>{patient.code}</span>
            <span>·</span>
            <span>{patient.gender === 'male' ? 'ذكر' : 'أنثى'}</span>
            {patient.birth_date && <span>· {patient.birth_date}</span>}
            {patient.is_child && <Badge variant="accent">طفل</Badge>}
            {patient.phone && <span>· {patient.phone}</span>}
          </div>
          {patient.guardian_name && (
            <p className="mt-1 text-sm text-muted">ولي الأمر: {patient.guardian_name} ({patient.guardian_phone})</p>
          )}
        </div>
        <Link to={`/appointments?patient_id=${patient.id}`}>
          <Button>
            <FontAwesomeIcon icon={faCalendarPlus} />
            حجز موعد
          </Button>
        </Link>
      </Card>

      {todayAppointment && (
        <Card className="mb-6 flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <h2 className="text-sm font-semibold text-ink/80">زيارة اليوم</h2>
            <p className="mt-0.5 text-sm text-muted">
              مع {todayAppointment.doctor_name} — {todayAppointment.starts_at_display}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setVisitOutcome(todayAppointment.id, 'done')}
              disabled={updatingVisit}
              className="flex items-center gap-2 rounded-xl bg-success-soft px-3 py-2 text-sm font-medium text-success hover:opacity-80 disabled:opacity-50"
            >
              <FontAwesomeIcon icon={faCheck} />
              تمت الزيارة
            </button>
            <button
              onClick={() => setVisitOutcome(todayAppointment.id, 'cancelled')}
              disabled={updatingVisit}
              className="flex items-center gap-2 rounded-xl bg-warning-soft px-3 py-2 text-sm font-medium text-warning hover:opacity-80 disabled:opacity-50"
            >
              <FontAwesomeIcon icon={faClockRotateLeft} />
              تأجيل
            </button>
            <button
              onClick={() => setVisitOutcome(todayAppointment.id, 'no_show')}
              disabled={updatingVisit}
              className="flex items-center gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm font-medium text-danger hover:opacity-80 disabled:opacity-50"
            >
              <FontAwesomeIcon icon={faUserXmark} />
              لم يحضر
            </button>
          </div>
          <p className="w-full text-xs text-muted">
            بعد تسجيل "تمت الزيارة" — استخدم "تحصيل دفعة" بكشف الحساب تحت لتسجيل المبلغ المدفوع (كامل، جزئي، أو بالدين لو ما انحصّل شي).
          </p>
        </Card>
      )}

      <h2 className="mb-3 text-sm font-medium text-ink/70">رسمة الأسنان</h2>
      <div className="mb-6">
        <ToothChart
          patientId={patient.id}
          isChild={patient.is_child}
          toothStates={tooth_states}
          toothFindings={tooth_findings}
          services={services}
          onChanged={load}
        />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-6">
        <TreatmentPlanPanel patientId={patient.id} />
        <PatientLedgerPanel patientId={patient.id} />
      </div>

      <div className="grid grid-cols-2 gap-6">
        <Card className="p-6">
          <h2 className="mb-3 text-sm font-medium text-ink/70">المواعيد</h2>
          {appointments.length === 0 ? (
            <p className="text-sm text-muted">لا توجد مواعيد.</p>
          ) : (
            <ul className="space-y-2">
              {appointments.map((a) => (
                <li key={a.id} className="flex justify-between border-b border-border/70 pb-2 text-sm last:border-0">
                  <span>{a.doctor_name}</span>
                  <span className="text-muted">{a.starts_at_display}</span>
                  <span className="text-muted">{a.status}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-6">
          <h2 className="mb-3 text-sm font-medium text-ink/70">الملاحظات</h2>
          <div className="mb-3 flex gap-2">
            <input
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              placeholder="أضف ملاحظة..."
              className="flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
            />
            <Button onClick={addNote} className="px-3 py-1.5">
              إضافة
            </Button>
          </div>
          {notes.length === 0 ? (
            <p className="text-sm text-muted">لا توجد ملاحظات.</p>
          ) : (
            <ul className="space-y-2">
              {notes.map((n) => (
                <li key={n.id} className="border-b border-border/70 pb-2 text-sm last:border-0">
                  <p className="text-ink">{n.body}</p>
                  <p className="text-xs text-muted">
                    {n.author} · {n.created_at}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
