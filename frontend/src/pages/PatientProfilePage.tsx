import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowRight, faCalendarPlus } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import ToothChart from '../components/ToothChart'
import TreatmentPlanPanel from '../components/TreatmentPlanPanel'
import PatientLedgerPanel from '../components/PatientLedgerPanel'
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

  if (!profile) return <p className="text-sm text-ink/50">جارِ التحميل...</p>

  const { patient, tooth_states, tooth_findings, appointments, notes } = profile

  return (
    <div>
      <Link to="/patients" className="mb-4 flex w-fit items-center gap-2 text-sm text-ink/60 hover:text-ink">
        <FontAwesomeIcon icon={faArrowRight} />
        العودة للمرضى
      </Link>

      <div className="mb-6 flex items-center justify-between rounded-xl bg-white p-6 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold text-ink">{patient.full_name}</h1>
          <p className="text-sm text-ink/60">
            {patient.code} · {patient.gender === 'male' ? 'ذكر' : 'أنثى'}
            {patient.birth_date && ` · ${patient.birth_date}`}
            {patient.is_child && ' · طفل'}
            {patient.phone && ` · ${patient.phone}`}
          </p>
          {patient.guardian_name && (
            <p className="text-sm text-ink/60">ولي الأمر: {patient.guardian_name} ({patient.guardian_phone})</p>
          )}
        </div>
        <Link
          to={`/appointments?patient_id=${patient.id}`}
          className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          <FontAwesomeIcon icon={faCalendarPlus} />
          حجز موعد
        </Link>
      </div>

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
        <div className="rounded-xl bg-white p-6 shadow-sm">
          <h2 className="mb-3 text-sm font-medium text-ink/70">المواعيد</h2>
          {appointments.length === 0 ? (
            <p className="text-sm text-ink/40">لا توجد مواعيد.</p>
          ) : (
            <ul className="space-y-2">
              {appointments.map((a) => (
                <li key={a.id} className="flex justify-between text-sm">
                  <span>{a.doctor_name}</span>
                  <span className="text-ink/60">{a.starts_at_display}</span>
                  <span className="text-ink/60">{a.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl bg-white p-6 shadow-sm">
          <h2 className="mb-3 text-sm font-medium text-ink/70">الملاحظات</h2>
          <div className="mb-3 flex gap-2">
            <input
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              placeholder="أضف ملاحظة..."
              className="flex-1 rounded-lg border border-ink/10 px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
            />
            <button onClick={addNote} className="rounded-lg bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover">
              إضافة
            </button>
          </div>
          {notes.length === 0 ? (
            <p className="text-sm text-ink/40">لا توجد ملاحظات.</p>
          ) : (
            <ul className="space-y-2">
              {notes.map((n) => (
                <li key={n.id} className="text-sm">
                  <p className="text-ink">{n.body}</p>
                  <p className="text-xs text-ink/40">
                    {n.author} · {n.created_at}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
