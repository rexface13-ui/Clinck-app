import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronLeft, faChevronRight, faUserDoctor, faClockRotateLeft, faTriangleExclamation, faPlus } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { formatDate } from '../lib/formatDate'
import DatePicker from '../components/DatePicker'
import AppointmentDetailModal from '../components/AppointmentDetailModal'
import { Card, PageHeader, Button, Select } from '../components/ui'
import type { Appointment, Branch, Doctor, Patient } from '../types'

const STATUS_LABELS: Record<Appointment['status'], string> = {
  scheduled: 'مجدول',
  confirmed: 'مؤكد',
  done: 'منجز',
  cancelled: 'ملغى',
  no_show: 'لم يحضر',
}

/** Consistent color per doctor, assigned by position in the doctors list — not by id, so colors stay stable and don't run out for small clinics. */
const DOCTOR_COLORS = ['#2f5d4f', '#b5651d', '#3f6ea5', '#8a3ffc', '#c0392b', '#0e7c7b', '#a0522d', '#5b6ee1']
const NO_DOCTOR_COLOR = '#6b7280'

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDays(iso: string, delta: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + delta)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function extractError(err: unknown): string {
  const message = (err as { response?: { data?: { errors?: Record<string, string[]> } } })?.response?.data?.errors?.starts_at?.[0]
  return message ?? 'تعذّر الحجز — قد يكون الوقت محجوزاً بالفعل.'
}

function parseHM(hm: string): number {
  const [h, m] = hm.split(':').map(Number)
  return h * 60 + m
}

function minutesToHM(mins: number): string {
  const h = Math.floor(mins / 60) % 24
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

const PX_PER_MIN = 1.3

interface LaidOutAppointment extends Appointment {
  startMin: number
  endMin: number
  col: number
  colCount: number
}

/** Greedy column assignment so overlapping appointments (any doctor) sit side by side instead of stacking on top of each other. */
function minutesSinceMidnight(iso: string): number {
  const d = new Date(iso)
  return d.getHours() * 60 + d.getMinutes()
}

function layoutAppointments(appointments: Appointment[]): LaidOutAppointment[] {
  const sorted = [...appointments]
    .map((a) => ({ ...a, startMin: minutesSinceMidnight(a.starts_at), endMin: minutesSinceMidnight(a.ends_at) }))
    .sort((a, b) => a.startMin - b.startMin)

  const columns: number[] = []
  const withCol = sorted.map((a) => {
    let col = columns.findIndex((endMin) => endMin <= a.startMin)
    if (col === -1) {
      col = columns.length
      columns.push(a.endMin)
    } else {
      columns[col] = a.endMin
    }
    return { ...a, col }
  })

  const colCount = Math.max(1, columns.length)
  return withCol.map((a) => ({ ...a, colCount }))
}

export default function AppointmentsPage() {
  const { data: authData } = useAuth()
  const defaultDuration = (authData?.settings.default_appointment_duration as number) ?? 30
  const clinicStart = (authData?.settings.clinic_hours_start as string) || '10:00'
  const clinicEnd = (authData?.settings.clinic_hours_end as string) || '22:00'
  const [searchParams] = useSearchParams()
  const preselectedPatient = searchParams.get('patient_id')
  const preselectedDate = searchParams.get('date')
  const preselectedDoctorId = searchParams.get('doctor_id')
  const [openAppointmentId, setOpenAppointmentId] = useState<number | null>(null)

  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [patients, setPatients] = useState<Patient[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [doctorFilter, setDoctorFilter] = useState<number | 'all'>(preselectedDoctorId ? Number(preselectedDoctorId) : 'all')
  const [date, setDate] = useState(preselectedDate ?? todayIso())
  const [dayAppointments, setDayAppointments] = useState<Appointment[]>([])

  const [bookingOpen, setBookingOpen] = useState(false)
  const [patientId, setPatientId] = useState(preselectedPatient ?? '')
  const [startTime, setStartTime] = useState(clinicStart)
  const [durationHours, setDurationHours] = useState(Math.floor(defaultDuration / 60))
  const [durationMinutes, setDurationMinutes] = useState(defaultDuration % 60)
  const [bookingDoctorId, setBookingDoctorId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [booking, setBooking] = useState(false)

  useEffect(() => {
    api.get('/doctors').then((res) => setDoctors(res.data.data))
    api.get('/patients').then((res) => setPatients(res.data.data))
    api.get('/branches').then((res) => setBranches(res.data))
  }, [])

  function loadAppointments() {
    api
      .get('/appointments', {
        params: {
          doctor_id: doctorFilter === 'all' ? undefined : doctorFilter,
          from: `${date}T00:00:00Z`,
          to: `${date}T23:59:59Z`,
        },
      })
      .then((res) => setDayAppointments(res.data.data))
  }

  useEffect(loadAppointments, [date, doctorFilter])

  const doctorColor = useMemo(() => {
    const map = new Map<number, string>()
    doctors.forEach((d, i) => map.set(d.id, DOCTOR_COLORS[i % DOCTOR_COLORS.length]))
    return map
  }, [doctors])

  const activeAppointments = useMemo(() => dayAppointments.filter((a) => a.status !== 'cancelled'), [dayAppointments])

  // The grid always spans the clinic's configured hours, but a specific
  // doctor's appointment that day can fall outside that range (running
  // late, extra hours) — the grid stretches for that one day instead of
  // clipping it or forcing a settings change.
  const { rangeStart, rangeEnd } = useMemo(() => {
    let start = parseHM(clinicStart)
    let end = parseHM(clinicEnd)
    for (const a of activeAppointments) {
      const s = new Date(a.starts_at)
      const e = new Date(a.ends_at)
      const sMin = s.getHours() * 60 + s.getMinutes()
      const eMin = e.getHours() * 60 + e.getMinutes()
      if (sMin < start) start = Math.floor(sMin / 60) * 60
      if (eMin > end) end = Math.ceil(eMin / 60) * 60
    }
    return { rangeStart: start, rangeEnd: end }
  }, [clinicStart, clinicEnd, activeAppointments])

  const hourMarks = useMemo(() => {
    const marks: number[] = []
    for (let h = Math.floor(rangeStart / 60); h <= Math.ceil(rangeEnd / 60); h++) marks.push(h * 60)
    return marks
  }, [rangeStart, rangeEnd])

  const gridHeight = (rangeEnd - rangeStart) * PX_PER_MIN
  const laidOut = useMemo(() => layoutAppointments(activeAppointments), [activeAppointments])

  function openBookingAt(startMinutesFromMidnight: number) {
    const rounded = Math.round(startMinutesFromMidnight / 15) * 15
    setStartTime(minutesToHM(rounded))
    setBookingOpen(true)
    setError(null)
  }

  function handleGridClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const offsetY = e.clientY - rect.top
    const minutesFromRangeStart = offsetY / PX_PER_MIN
    openBookingAt(rangeStart + minutesFromRangeStart)
  }

  const duration = durationHours * 60 + durationMinutes

  const bookingConflict = useMemo(() => {
    if (!bookingDoctorId || duration <= 0) return null
    const startsAt = new Date(`${date}T${startTime}:00`)
    const endsAt = new Date(startsAt.getTime() + duration * 60000)
    return dayAppointments.find(
      (a) =>
        a.doctor_id === Number(bookingDoctorId) &&
        a.status !== 'cancelled' &&
        a.status !== 'no_show' &&
        new Date(a.starts_at) < endsAt &&
        new Date(a.ends_at) > startsAt,
    )
  }, [bookingDoctorId, startTime, date, dayAppointments, duration])

  async function submitBooking() {
    const mainBranch = branches.find((b) => b.is_main) ?? branches[0]
    if (!patientId || !mainBranch || duration <= 0) return
    setBooking(true)
    setError(null)
    try {
      const startsAt = new Date(`${date}T${startTime}:00`)
      const endsAt = new Date(startsAt.getTime() + duration * 60000)
      await api.post('/appointments', {
        branch_id: mainBranch.id,
        patient_id: Number(patientId),
        doctor_id: bookingDoctorId ? Number(bookingDoctorId) : null,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
      })
      setBookingOpen(false)
      setPatientId('')
      setBookingDoctorId('')
      loadAppointments()
    } catch (err) {
      setError(extractError(err))
    } finally {
      setBooking(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="المواعيد"
        subtitle="مواعيد اليوم عبر كل الأطباء، واحجز بأي وقت متاح بغض النظر عن الطبيب"
        action={
          <Link
            to="/appointments-log"
            className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-ink/70 hover:border-accent hover:text-accent"
          >
            <FontAwesomeIcon icon={faClockRotateLeft} />
            سجل المواعيد
          </Link>
        }
      />

      <Card className="mb-6 flex flex-wrap items-center gap-4 p-4">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setDoctorFilter('all')}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${
              doctorFilter === 'all' ? 'border-accent bg-accent text-white' : 'border-border text-ink/70 hover:border-accent/40'
            }`}
          >
            كل الأطباء
          </button>
          {doctors.map((d) => (
            <button
              key={d.id}
              onClick={() => setDoctorFilter(d.id)}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${
                doctorFilter === d.id ? 'text-white' : 'border-border text-ink/70 hover:border-accent/40'
              }`}
              style={doctorFilter === d.id ? { borderColor: doctorColor.get(d.id), backgroundColor: doctorColor.get(d.id) } : undefined}
            >
              <span className="size-2 rounded-full" style={{ backgroundColor: doctorColor.get(d.id) }} />
              <FontAwesomeIcon icon={faUserDoctor} />
              {d.full_name}
            </button>
          ))}
        </div>

        <div className="mr-auto flex items-center gap-2">
          <button onClick={() => setDate(todayIso())} className="rounded-lg px-3 py-1.5 text-xs text-accent hover:bg-accent-soft">
            اليوم
          </button>
          <button onClick={() => setDate(addDays(date, -1))} className="rounded-lg p-2 text-muted hover:bg-background">
            <FontAwesomeIcon icon={faChevronRight} />
          </button>
          <div className="w-40">
            <DatePicker value={date} onChange={(iso) => iso && setDate(iso)} allowClear={false} />
          </div>
          <button onClick={() => setDate(addDays(date, 1))} className="rounded-lg p-2 text-muted hover:bg-background">
            <FontAwesomeIcon icon={faChevronLeft} />
          </button>
        </div>
      </Card>

      <div className="grid grid-cols-3 gap-6">
        <Card className="col-span-2 p-4">
          <div className="mb-3 flex items-center justify-between px-2">
            <h2 className="text-sm font-medium text-ink/70">مواعيد {formatDate(date)}</h2>
            <p className="text-xs text-muted">اضغط أي مكان فاضي بالجدول لتضيف موعد بهيك الوقت.</p>
          </div>

          <div className="flex">
            <div className="w-14 shrink-0 text-left" style={{ height: gridHeight }}>
              {hourMarks.map((m) => (
                <div key={m} className="relative text-[11px] text-muted" style={{ height: 60 * PX_PER_MIN }}>
                  <span className="absolute -top-2">{minutesToHM(m)}</span>
                </div>
              ))}
            </div>

            <div
              onClick={handleGridClick}
              className="relative flex-1 cursor-crosshair rounded-lg border border-border bg-background/40"
              style={{ height: gridHeight }}
            >
              {hourMarks.map((m) => (
                <div
                  key={m}
                  className="absolute inset-x-0 border-t border-border/60"
                  style={{ top: (m - rangeStart) * PX_PER_MIN }}
                />
              ))}

              {laidOut.length === 0 && (
                <p className="absolute inset-0 flex items-center justify-center text-sm text-muted">لا يوجد مواعيد بهذا اليوم.</p>
              )}

              {laidOut.map((a) => {
                const top = (a.startMin - rangeStart) * PX_PER_MIN
                const height = Math.max(18, (a.endMin - a.startMin) * PX_PER_MIN)
                const width = 100 / a.colCount
                const left = a.col * width
                const color = a.doctor_id ? doctorColor.get(a.doctor_id) ?? NO_DOCTOR_COLOR : NO_DOCTOR_COLOR
                return (
                  <button
                    key={a.id}
                    onClick={(e) => {
                      e.stopPropagation()
                      setOpenAppointmentId(a.id)
                    }}
                    className="absolute overflow-hidden rounded-md px-1.5 py-0.5 text-start text-[11px] text-white shadow-sm transition-opacity hover:opacity-90"
                    style={{ top, height, left: `${left}%`, width: `calc(${width}% - 3px)`, backgroundColor: color }}
                    title={`${a.patient_name} — ${a.doctor_name ?? 'بدون طبيب'} — ${STATUS_LABELS[a.status]}`}
                  >
                    <div className="truncate font-medium">{a.patient_name}</div>
                    {height > 30 && <div className="truncate opacity-80">{a.doctor_name ?? 'بدون طبيب محدد'}</div>}
                  </button>
                )
              })}
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-medium text-ink/70">حجز موعد</h2>
            {!bookingOpen && (
              <button onClick={() => openBookingAt(rangeStart)} className="flex items-center gap-1 text-xs text-accent hover:underline">
                <FontAwesomeIcon icon={faPlus} />
                موعد جديد
              </button>
            )}
          </div>

          <div className="mb-3">
            <label className="mb-1 block text-sm text-muted">تاريخ الموعد</label>
            <DatePicker value={date} onChange={(iso) => iso && setDate(iso)} allowClear={false} />
          </div>

          {!bookingOpen ? (
            <p className="text-sm text-muted">اضغط "موعد جديد" فوق، أو اضغط أي مكان فاضي بالجدول يسار.</p>
          ) : (
            <>
              <Select label="المريض" value={patientId} onChange={(e) => setPatientId(e.target.value)} className="mb-3">
                <option value="">اختر مريضاً</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>{p.full_name} ({p.code})</option>
                ))}
              </Select>

              <label className="mb-1 block text-sm text-muted">وقت بداية الجلسة</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="mb-3 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />

              <label className="mb-1 block text-sm text-muted">مدة الجلسة</label>
              <div className="mb-3 flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={8}
                  value={durationHours}
                  onChange={(e) => setDurationHours(Number(e.target.value))}
                  className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none"
                />
                <span className="shrink-0 text-xs text-muted">ساعة</span>
                <input
                  type="number"
                  min={0}
                  max={59}
                  step={5}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Number(e.target.value))}
                  className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none"
                />
                <span className="shrink-0 text-xs text-muted">دقيقة</span>
              </div>

              <Select label="الطبيب (اختياري)" value={bookingDoctorId} onChange={(e) => setBookingDoctorId(e.target.value)} className="mb-3">
                <option value="">بدون طبيب محدد</option>
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>{d.full_name}</option>
                ))}
              </Select>

              {bookingConflict && (
                <p className="mb-2 flex items-center gap-1.5 text-sm text-danger">
                  <FontAwesomeIcon icon={faTriangleExclamation} />
                  الطبيب عنده موعد آخر بهاد الوقت ({bookingConflict.patient_name ?? 'مريض آخر'} — {bookingConflict.starts_at_display}).
                </p>
              )}
              {error && <p className="mb-2 text-sm text-danger">{error}</p>}

              <div className="flex gap-2">
                <Button
                  onClick={submitBooking}
                  disabled={!patientId || booking || !!bookingConflict || duration <= 0}
                  loading={booking}
                  className="flex-1 justify-center"
                >
                  {booking ? 'جارِ الحجز...' : 'تأكيد الحجز'}
                </Button>
                <Button variant="ghost" onClick={() => setBookingOpen(false)}>
                  إلغاء
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>

      {openAppointmentId && (
        <AppointmentDetailModal
          appointmentId={openAppointmentId}
          onClose={() => setOpenAppointmentId(null)}
          onChanged={loadAppointments}
        />
      )}
    </div>
  )
}
