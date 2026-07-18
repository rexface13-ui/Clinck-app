import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronLeft, faChevronRight, faClock, faUserDoctor } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { formatDate, formatTime } from '../lib/formatDate'
import DatePicker from '../components/DatePicker'
import type { Appointment, Doctor, Patient, Slot } from '../types'

const STATUS_STYLES: Record<Appointment['status'], string> = {
  scheduled: 'bg-accent/10 text-accent border-accent/30',
  confirmed: 'bg-accent/20 text-accent border-accent/40',
  done: 'bg-ink/10 text-ink/50 border-ink/10',
  cancelled: 'bg-danger/10 text-danger/60 border-danger/20 line-through',
  no_show: 'bg-danger/10 text-danger/60 border-danger/20',
}

const STATUS_LABELS: Record<Appointment['status'], string> = {
  scheduled: 'مجدول',
  confirmed: 'مؤكد',
  done: 'منجز',
  cancelled: 'ملغى',
  no_show: 'لم يحضر',
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDays(iso: string, delta: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + delta)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function minutesToLabel(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

interface TimelineRow {
  minutes: number
  label: string
  slot: Slot | null
  appointment: Appointment | null
}

export default function AppointmentsPage() {
  const [searchParams] = useSearchParams()
  const preselectedPatient = searchParams.get('patient_id')

  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [patients, setPatients] = useState<Patient[]>([])
  const [doctorId, setDoctorId] = useState<number | null>(null)
  const [branchId, setBranchId] = useState<number | null>(null)
  const [date, setDate] = useState(todayIso())
  const [slots, setSlots] = useState<Slot[]>([])
  const [dayAppointments, setDayAppointments] = useState<Appointment[]>([])
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null)
  const [patientId, setPatientId] = useState(preselectedPatient ?? '')
  const [error, setError] = useState<string | null>(null)
  const [booking, setBooking] = useState(false)

  useEffect(() => {
    api.get('/doctors').then((res) => {
      setDoctors(res.data.data)
      if (res.data.data.length > 0) setDoctorId(res.data.data[0].id)
    })
    api.get('/patients').then((res) => setPatients(res.data.data))
  }, [])

  const selectedDoctor = doctors.find((d) => d.id === doctorId)
  const weekday = new Date(date + 'T00:00:00').getDay()
  const todaysAvailability = (selectedDoctor?.availability ?? []).filter((a) => a.weekday === weekday)

  useEffect(() => {
    const branch = selectedDoctor?.availability?.[0]?.branch_id
    if (branch) setBranchId(branch)
  }, [doctorId, selectedDoctor])

  function loadSlots() {
    if (!doctorId || !branchId) return
    setSelectedSlot(null)
    api
      .get(`/doctors/${doctorId}/slots`, { params: { branch_id: branchId, date, duration: 30 } })
      .then((res) => setSlots(res.data.slots))

    api
      .get('/appointments', {
        params: { doctor_id: doctorId, from: `${date}T00:00:00Z`, to: `${date}T23:59:59Z` },
      })
      .then((res) => setDayAppointments(res.data.data))
  }

  useEffect(loadSlots, [doctorId, branchId, date])

  const timeline = useMemo<TimelineRow[]>(() => {
    if (todaysAvailability.length === 0) return []

    const startMin = Math.min(...todaysAvailability.map((a) => timeToMinutes(a.start_time)))
    const endMin = Math.max(...todaysAvailability.map((a) => timeToMinutes(a.end_time)))

    const rows: TimelineRow[] = []
    for (let m = startMin; m < endMin; m += 30) {
      const label = minutesToLabel(m)
      const slot = slots.find((s) => s.starts_at_display === label) ?? null
      const appointment = dayAppointments.find((a) => formatTime(a.starts_at) === label) ?? null
      rows.push({ minutes: m, label, slot, appointment })
    }
    return rows
  }, [todaysAvailability, slots, dayAppointments])

  async function book() {
    if (!selectedSlot || !doctorId || !branchId || !patientId) return
    setBooking(true)
    setError(null)
    try {
      await api.post('/appointments', {
        branch_id: branchId,
        patient_id: Number(patientId),
        doctor_id: doctorId,
        starts_at: selectedSlot.starts_at,
        ends_at: selectedSlot.ends_at,
      })
      setSelectedSlot(null)
      loadSlots()
    } catch {
      setError('تعذّر الحجز — قد يكون الوقت محجوزاً بالفعل.')
    } finally {
      setBooking(false)
    }
  }

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold text-ink">المواعيد</h1>

      <div className="mb-6 flex flex-wrap items-center gap-4 rounded-xl bg-white p-4 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {doctors.map((d) => (
            <button
              key={d.id}
              onClick={() => setDoctorId(d.id)}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${
                doctorId === d.id ? 'border-accent bg-accent text-white' : 'border-ink/10 text-ink/70 hover:border-accent/40'
              }`}
            >
              <FontAwesomeIcon icon={faUserDoctor} />
              {d.full_name}
            </button>
          ))}
        </div>

        <div className="mr-auto flex items-center gap-2">
          <button onClick={() => setDate(todayIso())} className="rounded-lg px-3 py-1.5 text-xs text-accent hover:bg-accent/10">
            اليوم
          </button>
          <button onClick={() => setDate(addDays(date, -1))} className="rounded-lg p-2 text-ink/60 hover:bg-background">
            <FontAwesomeIcon icon={faChevronRight} />
          </button>
          <div className="w-40">
            <DatePicker value={date} onChange={(iso) => iso && setDate(iso)} allowClear={false} />
          </div>
          <button onClick={() => setDate(addDays(date, 1))} className="rounded-lg p-2 text-ink/60 hover:bg-background">
            <FontAwesomeIcon icon={faChevronLeft} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 rounded-xl bg-white p-4 shadow-sm">
          <h2 className="mb-2 flex items-center gap-2 px-2 text-sm font-medium text-ink/70">
            <FontAwesomeIcon icon={faClock} />
            {formatDate(date)}
          </h2>

          {timeline.length === 0 ? (
            <p className="p-6 text-center text-sm text-ink/40">لا يوجد دوام لهذا الطبيب في هذا اليوم.</p>
          ) : (
            <div className="divide-y divide-ink/5">
              {timeline.map((row) => (
                <div key={row.minutes} className="flex items-center gap-3 py-1.5">
                  <span className="w-12 shrink-0 text-xs text-ink/40">{row.label}</span>
                  {row.appointment ? (
                    <div className={`flex-1 rounded-lg border px-3 py-2 text-sm ${STATUS_STYLES[row.appointment.status]}`}>
                      <span className="font-medium">{row.appointment.patient_name}</span>
                      <span className="mr-2 text-xs opacity-70">{STATUS_LABELS[row.appointment.status]}</span>
                    </div>
                  ) : row.slot ? (
                    <button
                      onClick={() => setSelectedSlot(row.slot)}
                      className={`flex-1 rounded-lg border border-dashed px-3 py-2 text-start text-sm transition-colors ${
                        selectedSlot?.starts_at === row.slot.starts_at
                          ? 'border-accent bg-accent/10 text-accent'
                          : 'border-ink/15 text-ink/40 hover:border-accent hover:text-accent'
                      }`}
                    >
                      متاح
                    </button>
                  ) : (
                    <div className="flex-1 rounded-lg px-3 py-2 text-sm text-ink/20">—</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-medium text-ink/70">حجز موعد</h2>
          {!selectedSlot ? (
            <p className="text-sm text-ink/40">اختر وقتاً متاحاً من الجدول.</p>
          ) : (
            <>
              <p className="mb-3 text-sm text-ink">
                الوقت: <span className="font-medium">{selectedSlot.starts_at_display}</span>
              </p>
              <label className="mb-1 block text-sm text-ink/70">المريض</label>
              <select
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
                className="mb-3 w-full rounded-lg border border-ink/10 px-3 py-2 text-sm focus:border-accent focus:outline-none"
              >
                <option value="">اختر مريضاً</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>{p.full_name} ({p.code})</option>
                ))}
              </select>

              {error && <p className="mb-2 text-sm text-danger">{error}</p>}

              <button
                onClick={book}
                disabled={!patientId || booking}
                className="w-full rounded-lg bg-accent py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
              >
                {booking ? 'جارِ الحجز...' : 'تأكيد الحجز'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
