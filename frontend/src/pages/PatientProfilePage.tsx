import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowRight, faCalendarPlus } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import ToothChart from '../components/ToothChart'
import TreatmentPlanPanel from '../components/TreatmentPlanPanel'
import PatientLedgerPanel from '../components/PatientLedgerPanel'
import { Card, Badge, Button } from '../components/ui'
import type { PatientProfile, Service } from '../types'

export default function PatientProfilePage() {
  const { id } = useParams()
  const [profile, setProfile] = useState<PatientProfile | null>(null)
  const [services, setServices] = useState<Service[]>([])
  const [noteBody, setNoteBody] = useState('')

  function load() {
    api.get(`/patients/${id}/profile`).then((res) => setProfile(res.data))
  }

  useEffect(() => {
    load()
    api.get('/services').then((res) => setServices(res.data.data))
  }, [id])

  async function addNote() {
    if (!noteBody.trim()) return
    await api.post(`/patients/${id}/notes`, { body: noteBody })
    setNoteBody('')
    load()
  }

  if (!profile) return <p className="text-sm text-muted">جارِ التحميل...</p>

  const { patient, tooth_states, tooth_findings, appointments, notes } = profile

  return (
    <div>
      <Link to="/patients" className="mb-4 flex w-fit items-center gap-2 text-sm text-muted hover:text-ink">
        <FontAwesomeIcon icon={faArrowRight} />
        العودة للمرضى
      </Link>

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
