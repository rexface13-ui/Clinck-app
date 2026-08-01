import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronLeft, faChevronRight, faClockRotateLeft, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import DatePicker from '../components/DatePicker'
import AppointmentDetailModal from '../components/AppointmentDetailModal'
import { Card, PageHeader, Button, SearchableSelect } from '../components/ui'
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

const WEEKDAY_LABELS_FRI_FIRST = ['جمعة', 'سبت', 'أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس']
const MONTH_LABELS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function parseIsoDate(iso: string): Date {
  return new Date(iso + 'T00:00:00')
}

function todayIso(): string {
  return toIso(new Date())
}

function addDays(iso: string, delta: number): string {
  const d = parseIsoDate(iso)
  d.setDate(d.getDate() + delta)
  return toIso(d)
}

function addMonths(iso: string, delta: number): string {
  const d = parseIsoDate(iso)
  return toIso(new Date(d.getFullYear(), d.getMonth() + delta, 1))
}

/** Friday-first weekday index (0=Friday...6=Thursday) — the Middle-East work week, vs. JS's Sunday-first getDay(). */
function friIndex(iso: string): number {
  return (parseIsoDate(iso).getDay() + 2) % 7
}

function startOfWeekFri(iso: string): string {
  return addDays(iso, -friIndex(iso))
}

function weekDays(startIso: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(startIso, i))
}

/** Weeks (rows) covering the month `iso` falls in, each starting Friday, including the leading/trailing days needed to fill a complete grid. */
function monthWeeks(iso: string): string[][] {
  const d = parseIsoDate(iso)
  const firstOfMonth = toIso(new Date(d.getFullYear(), d.getMonth(), 1))
  const lastOfMonth = toIso(new Date(d.getFullYear(), d.getMonth() + 1, 0))
  const gridStart = startOfWeekFri(firstOfMonth)
  const gridEnd = addDays(startOfWeekFri(lastOfMonth), 6)
  const weeks: string[][] = []
  let cursor = gridStart
  while (cursor <= gridEnd) {
    weeks.push(weekDays(cursor))
    cursor = addDays(cursor, 7)
  }
  return weeks
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

function minutesSinceMidnight(iso: string): number {
  const d = new Date(iso)
  return d.getHours() * 60 + d.getMinutes()
}

/** Greedy column assignment so overlapping appointments within the same column (doctor) sit side by side instead of stacking on top of each other. */
function layoutAppointments(appointments: Appointment[]): LaidOutAppointment[] {
  const sorted = [...appointments]
    .map((a) => ({ ...a, startMin: minutesSinceMidnight(a.starts_at), endMin: minutesSinceMidnight(a.ends_at) }))
    .sort((a, b) => a.startMin - b.startMin)

  const cols: number[] = []
  const withCol = sorted.map((a) => {
    let col = cols.findIndex((endMin) => endMin <= a.startMin)
    if (col === -1) {
      col = cols.length
      cols.push(a.endMin)
    } else {
      cols[col] = a.endMin
    }
    return { ...a, col }
  })

  const colCount = Math.max(1, cols.length)
  return withCol.map((a) => ({ ...a, colCount }))
}

interface Column {
  key: string
  id: number | null
  label: string
  color: string
}

export default function AppointmentsPage() {
  const { data: authData } = useAuth()
  const defaultDuration = (authData?.settings.default_appointment_duration as number) ?? 30
  const clinicStart = (authData?.settings.clinic_hours_start as string) || '10:00'
  const clinicEnd = (authData?.settings.clinic_hours_end as string) || '22:00'
  const [searchParams] = useSearchParams()
  const preselectedPatient = searchParams.get('patient_id')
  const preselectedDate = searchParams.get('date')
  const [openAppointmentId, setOpenAppointmentId] = useState<number | null>(null)

  // Booking a patient from their profile lands you on the month view first
  // (per the "حجز موعد" flow) — pick a day there to drop into that day's
  // grid and drag out the actual slot. Otherwise the day view is more useful
  // by default.
  const [view, setView] = useState<'day' | 'week' | 'month'>(preselectedPatient ? 'month' : 'day')
  const [date, setDate] = useState(preselectedDate ?? todayIso())

  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [patients, setPatients] = useState<Patient[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [appointments, setAppointments] = useState<Appointment[]>([])

  const [bookingOpen, setBookingOpen] = useState(false)
  const [bookingPatientId, setBookingPatientId] = useState(preselectedPatient ?? '')
  const [bookingDoctorId, setBookingDoctorId] = useState<number | null>(null)
  const [bookingStartMin, setBookingStartMin] = useState(0)
  const [bookingEndMin, setBookingEndMin] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [booking, setBooking] = useState(false)

  const [drag, setDrag] = useState<{ colId: number | null; startMin: number; currentMin: number } | null>(null)

  useEffect(() => {
    api.get('/doctors').then((res) => setDoctors(res.data.data))
    api.get('/patients').then((res) => setPatients(res.data.data))
    api.get('/branches').then((res) => setBranches(res.data))
  }, [])

  const range = useMemo(() => {
    if (view === 'day') return { from: date, to: date }
    if (view === 'week') {
      const s = startOfWeekFri(date)
      return { from: s, to: addDays(s, 6) }
    }
    const weeks = monthWeeks(date)
    return { from: weeks[0][0], to: weeks[weeks.length - 1][6] }
  }, [view, date])

  function loadAppointments() {
    api
      .get('/appointments', { params: { from: `${range.from}T00:00:00Z`, to: `${range.to}T23:59:59Z` } })
      .then((res) => setAppointments(res.data.data))
  }

  useEffect(loadAppointments, [range.from, range.to])

  const doctorColor = useMemo(() => {
    const map = new Map<number, string>()
    doctors.forEach((d, i) => map.set(d.id, DOCTOR_COLORS[i % DOCTOR_COLORS.length]))
    return map
  }, [doctors])

  const columns: Column[] = useMemo(
    () => [
      ...doctors.map((d) => ({ key: String(d.id), id: d.id, label: d.full_name, color: doctorColor.get(d.id) ?? NO_DOCTOR_COLOR })),
      { key: 'none', id: null, label: 'بدون طبيب محدد', color: NO_DOCTOR_COLOR },
    ],
    [doctors, doctorColor],
  )

  const dayAppointments = useMemo(
    () => appointments.filter((a) => a.starts_at.slice(0, 10) === date && a.status !== 'cancelled'),
    [appointments, date],
  )

  const { rangeStart, rangeEnd } = useMemo(() => {
    let start = parseHM(clinicStart)
    let end = parseHM(clinicEnd)
    for (const a of dayAppointments) {
      const s = new Date(a.starts_at)
      const e = new Date(a.ends_at)
      const sMin = s.getHours() * 60 + s.getMinutes()
      const eMin = e.getHours() * 60 + e.getMinutes()
      if (sMin < start) start = Math.floor(sMin / 60) * 60
      if (eMin > end) end = Math.ceil(eMin / 60) * 60
    }
    return { rangeStart: start, rangeEnd: end }
  }, [clinicStart, clinicEnd, dayAppointments])

  const hourMarks = useMemo(() => {
    const marks: number[] = []
    for (let h = Math.floor(rangeStart / 60); h <= Math.ceil(rangeEnd / 60); h++) marks.push(h * 60)
    return marks
  }, [rangeStart, rangeEnd])

  const gridHeight = (rangeEnd - rangeStart) * PX_PER_MIN

  // The hour labels live outside the schedule card (to its left, at each
  // gridline) — this measures the real gap between the card's top edge and
  // where the grid itself actually starts (below the card's title row and
  // the per-doctor column-header row), so the labels line up with the
  // gridlines regardless of how tall those rows render.
  const scheduleWrapRef = useRef<HTMLDivElement>(null)
  const gridBodyRef = useRef<HTMLDivElement>(null)
  const [labelTopOffset, setLabelTopOffset] = useState(0)

  useLayoutEffect(() => {
    if (!scheduleWrapRef.current || !gridBodyRef.current) return
    const wrapTop = scheduleWrapRef.current.getBoundingClientRect().top
    const gridTop = gridBodyRef.current.getBoundingClientRect().top
    setLabelTopOffset(gridTop - wrapTop)
  }, [view, date, columns.length, gridHeight])

  function openBookingWith(colId: number | null, startMin: number, endMin: number) {
    setBookingDoctorId(colId)
    setBookingStartMin(startMin)
    setBookingEndMin(endMin)
    setBookingOpen(true)
    setError(null)
  }

  /** Click-and-drag on a doctor's column: drag distance sets the appointment's duration directly, no separate duration field needed. A plain click (no real drag) falls back to the clinic's default duration. */
  function startDrag(colId: number | null, e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    e.preventDefault()
    const columnEl = e.currentTarget
    const rect = columnEl.getBoundingClientRect()
    const startMin = Math.round((rangeStart + (e.clientY - rect.top) / PX_PER_MIN) / 15) * 15
    setDrag({ colId, startMin, currentMin: startMin })

    function onMove(ev: MouseEvent) {
      const r = columnEl.getBoundingClientRect()
      const min = Math.round((rangeStart + (ev.clientY - r.top) / PX_PER_MIN) / 15) * 15
      setDrag((prev) => (prev ? { ...prev, currentMin: min } : prev))
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      setDrag((prev) => {
        if (!prev) return null
        let start = Math.min(prev.startMin, prev.currentMin)
        let end = Math.max(prev.startMin, prev.currentMin)
        if (end - start < 10) end = start + defaultDuration
        openBookingWith(prev.colId, start, end)
        return null
      })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const bookingConflict = useMemo(() => {
    if (bookingDoctorId === null || !bookingOpen) return null
    const startsAt = new Date(`${date}T${minutesToHM(bookingStartMin)}:00`)
    const endsAt = new Date(`${date}T${minutesToHM(bookingEndMin)}:00`)
    return dayAppointments.find(
      (a) =>
        a.doctor_id === bookingDoctorId &&
        a.status !== 'cancelled' &&
        a.status !== 'no_show' &&
        new Date(a.starts_at) < endsAt &&
        new Date(a.ends_at) > startsAt,
    )
  }, [bookingDoctorId, bookingStartMin, bookingEndMin, date, dayAppointments, bookingOpen])

  async function submitBooking() {
    const mainBranch = branches.find((b) => b.is_main) ?? branches[0]
    if (!bookingPatientId || !mainBranch || bookingEndMin <= bookingStartMin) return
    setBooking(true)
    setError(null)
    try {
      const startsAt = new Date(`${date}T${minutesToHM(bookingStartMin)}:00`)
      const endsAt = new Date(`${date}T${minutesToHM(bookingEndMin)}:00`)
      await api.post('/appointments', {
        branch_id: mainBranch.id,
        patient_id: Number(bookingPatientId),
        doctor_id: bookingDoctorId,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
      })
      setBookingOpen(false)
      loadAppointments()
    } catch (err) {
      setError(extractError(err))
    } finally {
      setBooking(false)
    }
  }

  function goToDay(iso: string) {
    setDate(iso)
    setView('day')
  }

  function shiftView(delta: number) {
    if (view === 'day') setDate(addDays(date, delta))
    else if (view === 'week') setDate(addDays(date, delta * 7))
    else setDate(addMonths(date, delta))
  }

  const patientOptions = patients.map((p) => ({ value: String(p.id), label: p.full_name, sublabel: p.code }))

  return (
    <div>
      <PageHeader
        title="المواعيد"
        subtitle="للاستعراض والتوثيق — احجز موعد واشتغل بأي وقت بغض النظر عن حالة الموعد"
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
        <div className="flex gap-1 rounded-xl border border-border bg-background p-1">
          {([
            ['day', 'يومي'],
            ['week', 'أسبوعي'],
            ['month', 'شهري'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                view === key ? 'bg-accent text-white' : 'text-ink/60 hover:bg-surface'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mr-auto flex items-center gap-2">
          <button onClick={() => setDate(todayIso())} className="rounded-lg px-3 py-1.5 text-xs text-accent hover:bg-accent-soft">
            اليوم
          </button>
          <button onClick={() => shiftView(-1)} className="rounded-lg p-2 text-muted hover:bg-background">
            <FontAwesomeIcon icon={faChevronRight} />
          </button>
          {view === 'day' ? (
            <div className="flex items-center gap-2">
              <span className="min-w-28 text-center text-sm font-medium text-ink">
                {WEEKDAY_LABELS_FRI_FIRST[friIndex(date)]}
                {date === todayIso() && <span className="text-accent"> (اليوم)</span>}
              </span>
              <div className="w-36">
                <DatePicker value={date} onChange={(iso) => iso && setDate(iso)} allowClear={false} />
              </div>
            </div>
          ) : (
            <span className="min-w-32 text-center text-sm font-medium text-ink">
              {view === 'week'
                ? `${addDays(startOfWeekFri(date), 0).split('-').reverse().join('/')} — ${addDays(startOfWeekFri(date), 6).split('-').reverse().join('/')}`
                : `${MONTH_LABELS[parseIsoDate(date).getMonth()]} ${parseIsoDate(date).getFullYear()}`}
            </span>
          )}
          <button onClick={() => shiftView(1)} className="rounded-lg p-2 text-muted hover:bg-background">
            <FontAwesomeIcon icon={faChevronLeft} />
          </button>
        </div>
      </Card>

      {view === 'day' && (
        <div className="grid grid-cols-3 gap-6">
          <div ref={scheduleWrapRef} className="col-span-2 flex items-start gap-2">
            <div className="relative w-10 shrink-0" style={{ height: labelTopOffset + gridHeight }}>
              {hourMarks.map((m) => (
                <span
                  key={m}
                  className="absolute right-0 -translate-y-1/2 text-xs font-semibold text-ink/70"
                  style={{ top: labelTopOffset + (m - rangeStart) * PX_PER_MIN }}
                >
                  {minutesToHM(m)}
                </span>
              ))}
            </div>

            <Card className="flex-1 p-4">
              <div className="mb-3 flex items-center justify-between px-2">
                <h2 className="text-sm font-medium text-ink/70">مواعيد اليوم — عمود لكل طبيب</h2>
                <p className="text-xs text-muted">اضغط واسحب على عمود الطبيب لتحدد وقت ومدة الموعد.</p>
              </div>

              <div className="flex flex-1 gap-px overflow-hidden rounded-lg border border-border bg-border">
                {columns.map((col, colIndex) => {
                  const colAppointments = dayAppointments.filter((a) => (a.doctor_id ?? null) === col.id)
                  const laidOut = layoutAppointments(colAppointments)
                  return (
                    <div key={col.key} className="flex min-w-0 flex-1 flex-col bg-surface">
                      <div className="flex items-center gap-1.5 truncate border-b border-border bg-background/60 px-1.5 py-1 text-[11px] font-medium text-ink/70">
                        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: col.color }} />
                        <span className="truncate">{col.label}</span>
                      </div>
                      <div
                        ref={colIndex === 0 ? gridBodyRef : undefined}
                        onMouseDown={(e) => startDrag(col.id, e)}
                        className="relative cursor-crosshair bg-background/40"
                        style={{ height: gridHeight }}
                      >
                        {hourMarks.map((m) => (
                          <div key={m} className="absolute inset-x-0 border-t border-border/60" style={{ top: (m - rangeStart) * PX_PER_MIN }} />
                        ))}

                        {drag && drag.colId === col.id && (
                          <div
                            className="absolute inset-x-1 rounded-md border border-accent bg-accent/25"
                            style={{
                              top: (Math.min(drag.startMin, drag.currentMin) - rangeStart) * PX_PER_MIN,
                              height: Math.max(4, Math.abs(drag.currentMin - drag.startMin) * PX_PER_MIN),
                            }}
                          />
                        )}

                        {laidOut.map((a) => {
                          const top = (a.startMin - rangeStart) * PX_PER_MIN
                          const height = Math.max(18, (a.endMin - a.startMin) * PX_PER_MIN)
                          const width = 100 / a.colCount
                          const left = a.col * width
                          return (
                            <button
                              key={a.id}
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation()
                                setOpenAppointmentId(a.id)
                              }}
                              className="absolute overflow-hidden rounded-md px-1.5 py-0.5 text-start text-[11px] text-white shadow-sm transition-opacity hover:opacity-90"
                              style={{ top, height, left: `${left}%`, width: `calc(${width}% - 3px)`, backgroundColor: col.color }}
                              title={`${a.patient_name} — ${a.doctor_name ?? 'بدون طبيب'} — ${STATUS_LABELS[a.status]}`}
                            >
                              <div className="truncate font-medium">{a.patient_name}</div>
                              {height > 30 && <div className="truncate opacity-80">{a.starts_at_display}</div>}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          </div>

          <Card className="p-6">
            <h2 className="mb-4 text-sm font-medium text-ink/70">حجز موعد</h2>

            <div className="mb-3">
              <label className="mb-1 block text-sm text-muted">تاريخ الموعد</label>
              <DatePicker value={date} onChange={(iso) => iso && setDate(iso)} allowClear={false} />
            </div>

            {!bookingOpen ? (
              <p className="text-sm text-muted">اضغط واسحب على عمود أي طبيب بالجدول يسار لتحدد الوقت والمدة.</p>
            ) : (
              <>
                <div className="mb-3 rounded-lg bg-background px-3 py-2 text-sm">
                  <span className="text-ink">{minutesToHM(bookingStartMin)} — {minutesToHM(bookingEndMin)}</span>
                  <span className="text-muted"> ({bookingEndMin - bookingStartMin} د) — </span>
                  <span className="font-medium" style={{ color: columns.find((c) => c.id === bookingDoctorId)?.color }}>
                    {columns.find((c) => c.id === bookingDoctorId)?.label}
                  </span>
                </div>

                <label className="mb-1 block text-sm text-muted">المريض</label>
                <div className="mb-3">
                  <SearchableSelect options={patientOptions} value={bookingPatientId} onChange={setBookingPatientId} placeholder="ابحث عن مريض بالاسم..." />
                </div>

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
                    disabled={!bookingPatientId || booking || !!bookingConflict}
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
      )}

      {view === 'week' && (
        <WeekView
          days={weekDays(startOfWeekFri(date))}
          appointments={appointments}
          doctorColor={doctorColor}
          onOpenAppointment={setOpenAppointmentId}
          onGoToDay={goToDay}
        />
      )}

      {view === 'month' && (
        <MonthView
          weeks={monthWeeks(date)}
          currentMonth={parseIsoDate(date).getMonth()}
          appointments={appointments}
          doctorColor={doctorColor}
          onOpenAppointment={setOpenAppointmentId}
          onGoToDay={goToDay}
        />
      )}

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

/** Which calendar day an appointment belongs to, in the browser's (clinic's) local timezone — not a raw slice of the UTC-stored ISO string, which would misplace late-night/early-morning appointments across a day boundary. */
function apptLocalDateIso(a: Appointment): string {
  return toIso(new Date(a.starts_at))
}

function apptColor(a: Appointment, doctorColor: Map<number, string>): string {
  return a.doctor_id ? doctorColor.get(a.doctor_id) ?? NO_DOCTOR_COLOR : NO_DOCTOR_COLOR
}

function WeekView({
  days,
  appointments,
  doctorColor,
  onOpenAppointment,
  onGoToDay,
}: {
  days: string[]
  appointments: Appointment[]
  doctorColor: Map<number, string>
  onOpenAppointment: (id: number) => void
  onGoToDay: (iso: string) => void
}) {
  const today = todayIso()
  return (
    <div className="grid grid-cols-7 gap-3">
      {days.map((iso, i) => {
        const dayAppts = appointments
          .filter((a) => apptLocalDateIso(a) === iso && a.status !== 'cancelled')
          .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
        return (
          <Card
            key={iso}
            onClick={() => onGoToDay(iso)}
            className={`min-h-64 cursor-pointer p-3 hover:border-accent/40 ${iso === today ? 'ring-1 ring-accent/40' : ''}`}
          >
            <div className="mb-2 text-center">
              <p className="text-xs text-muted">{WEEKDAY_LABELS_FRI_FIRST[i]}</p>
              <p className={`text-sm font-semibold ${iso === today ? 'text-accent' : 'text-ink'}`}>{Number(iso.slice(8, 10))}</p>
            </div>
            <div className="space-y-1">
              {dayAppts.map((a) => (
                <button
                  key={a.id}
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenAppointment(a.id)
                  }}
                  title={`${a.starts_at_display} — ${a.doctor_name ?? 'بدون طبيب'}`}
                  className="block w-full truncate rounded-md px-1.5 py-1 text-start text-[11px] text-white shadow-sm hover:opacity-90"
                  style={{ backgroundColor: apptColor(a, doctorColor) }}
                >
                  {a.patient_name}
                </button>
              ))}
              {dayAppts.length === 0 && <p className="text-center text-[11px] text-muted">—</p>}
            </div>
          </Card>
        )
      })}
    </div>
  )
}

function MonthView({
  weeks,
  currentMonth,
  appointments,
  doctorColor,
  onOpenAppointment,
  onGoToDay,
}: {
  weeks: string[][]
  currentMonth: number
  appointments: Appointment[]
  doctorColor: Map<number, string>
  onOpenAppointment: (id: number) => void
  onGoToDay: (iso: string) => void
}) {
  const today = todayIso()
  return (
    <Card className="p-4">
      <div className="mb-1 grid grid-cols-7 text-center text-xs text-muted">
        {WEEKDAY_LABELS_FRI_FIRST.map((w) => (
          <span key={w} className="py-1">{w}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {weeks.flat().map((iso) => {
          const inMonth = parseIsoDate(iso).getMonth() === currentMonth
          const dayAppts = appointments
            .filter((a) => apptLocalDateIso(a) === iso && a.status !== 'cancelled')
            .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
          const shown = dayAppts.slice(0, 3)
          const extra = dayAppts.length - shown.length
          return (
            <div
              key={iso}
              onClick={() => onGoToDay(iso)}
              className={`min-h-24 cursor-pointer rounded-lg border p-1.5 hover:border-accent/40 ${
                iso === today ? 'border-accent/50 bg-accent-soft/30' : 'border-border/60'
              } ${inMonth ? '' : 'opacity-40'}`}
            >
              <p className={`mb-1 text-[11px] font-medium ${iso === today ? 'text-accent' : 'text-ink/70'}`}>{Number(iso.slice(8, 10))}</p>
              <div className="space-y-0.5">
                {shown.map((a) => (
                  <button
                    key={a.id}
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenAppointment(a.id)
                    }}
                    title={`${a.starts_at_display} — ${a.doctor_name ?? 'بدون طبيب'}`}
                    className="block w-full truncate rounded px-1 py-0.5 text-start text-[10px] text-white hover:opacity-90"
                    style={{ backgroundColor: apptColor(a, doctorColor) }}
                  >
                    {a.patient_name}
                  </button>
                ))}
                {extra > 0 && <p className="text-[10px] text-muted">+{extra}</p>}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
