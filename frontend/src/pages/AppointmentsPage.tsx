import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronLeft, faChevronRight, faClock, faUserDoctor, faClockRotateLeft } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { formatDate, formatTime } from '../lib/formatDate'
import DatePicker from '../components/DatePicker'
import AppointmentDetailModal from '../components/AppointmentDetailModal'
import { Card, PageHeader, Button, Select, Badge } from '../components/ui'
import type { BadgeVariant } from '../components/ui'
import type { Appointment, Branch, Doctor, Patient, Slot } from '../types'

const STATUS_VARIANTS: Record<Appointment['status'], BadgeVariant> = {
  scheduled: 'info',
  confirmed: 'accent',
  done: 'neutral',
  cancelled: 'danger',
  no_show: 'danger',
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

/** A bookable slot, tagged with which doctor/branch it belongs to — slots from every available doctor are merged into one flat, time-sorted list so booking doesn't require picking a doctor first. */
interface OpenSlot extends Slot {
  doctorId: number
  doctorName: string
  branchId: number
}

export default function AppointmentsPage() {
  const [searchParams] = useSearchParams()
  const preselectedPatient = searchParams.get('patient_id')
  const preselectedDate = searchParams.get('date')
  const preselectedDoctorId = searchParams.get('doctor_id')
  const [openAppointmentId, setOpenAppointmentId] = useState<number | null>(null)

  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [patients, setPatients] = useState<Patient[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [manualBooking, setManualBooking] = useState(false)
  const [manualTime, setManualTime] = useState('09:00')
  const [manualDoctorId, setManualDoctorId] = useState('')
  const [doctorFilter, setDoctorFilter] = useState<number | 'all'>(preselectedDoctorId ? Number(preselectedDoctorId) : 'all')
  const [date, setDate] = useState(preselectedDate ?? todayIso())
  const [dayAppointments, setDayAppointments] = useState<Appointment[]>([])
  const [openSlots, setOpenSlots] = useState<OpenSlot[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState<OpenSlot | null>(null)
  const [patientId, setPatientId] = useState(preselectedPatient ?? '')
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

  function loadOpenSlots() {
    const weekday = new Date(date + 'T00:00:00').getDay()
    const candidates = doctors
      .filter((d) => doctorFilter === 'all' || d.id === doctorFilter)
      .map((d) => ({ doctor: d, branchId: d.availability?.find((a) => a.weekday === weekday)?.branch_id }))
      .filter((c): c is { doctor: Doctor; branchId: number } => !!c.branchId)

    if (candidates.length === 0) {
      setOpenSlots([])
      return
    }

    setLoadingSlots(true)
    Promise.all(
      candidates.map(({ doctor, branchId }) =>
        api
          .get(`/doctors/${doctor.id}/slots`, { params: { branch_id: branchId, date } })
          .then((res) => (res.data.slots as Slot[]).map((s) => ({ ...s, doctorId: doctor.id, doctorName: doctor.full_name, branchId }))),
      ),
    )
      .then((groups) => {
        const merged = groups.flat().sort((a, b) => a.starts_at.localeCompare(b.starts_at))
        setOpenSlots(merged)
      })
      .finally(() => setLoadingSlots(false))
  }

  useEffect(() => {
    setSelectedSlot(null)
    loadOpenSlots()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, doctorFilter, doctors])

  async function book() {
    if (!selectedSlot || !patientId) return
    setBooking(true)
    setError(null)
    try {
      await api.post('/appointments', {
        branch_id: selectedSlot.branchId,
        patient_id: Number(patientId),
        doctor_id: selectedSlot.doctorId,
        starts_at: selectedSlot.starts_at,
        ends_at: selectedSlot.ends_at,
      })
      setSelectedSlot(null)
      loadAppointments()
      loadOpenSlots()
    } catch {
      setError('تعذّر الحجز — قد يكون الوقت محجوزاً بالفعل.')
    } finally {
      setBooking(false)
    }
  }

  async function bookManual() {
    const mainBranch = branches.find((b) => b.is_main) ?? branches[0]
    if (!patientId || !mainBranch) return
    setBooking(true)
    setError(null)
    try {
      const startsAt = new Date(`${date}T${manualTime}:00`)
      const endsAt = new Date(startsAt.getTime() + 30 * 60000)
      await api.post('/appointments', {
        branch_id: mainBranch.id,
        patient_id: Number(patientId),
        doctor_id: manualDoctorId ? Number(manualDoctorId) : null,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
      })
      setManualBooking(false)
      setManualDoctorId('')
      loadAppointments()
      loadOpenSlots()
    } catch {
      setError('تعذّر الحجز — قد يكون الوقت محجوزاً بالفعل.')
    } finally {
      setBooking(false)
    }
  }

  // Cancelled appointments don't need to keep occupying the day view once
  // they're cancelled — they still exist and are visible in "سجل المواعيد".
  const sortedAppointments = useMemo(
    () => dayAppointments.filter((a) => a.status !== 'cancelled').sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    [dayAppointments],
  )

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
                doctorFilter === d.id ? 'border-accent bg-accent text-white' : 'border-border text-ink/70 hover:border-accent/40'
              }`}
            >
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
          <h2 className="mb-2 flex items-center gap-2 px-2 text-sm font-medium text-ink/70">
            <FontAwesomeIcon icon={faClock} className="text-accent" />
            مواعيد {formatDate(date)}
          </h2>

          {sortedAppointments.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted">لا يوجد مواعيد بهذا اليوم.</p>
          ) : (
            <div className="divide-y divide-border/70">
              {sortedAppointments.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setOpenAppointmentId(a.id)}
                  className="flex w-full items-center gap-3 px-2 py-2.5 text-start text-sm hover:bg-background"
                >
                  <span className="w-14 shrink-0 font-mono text-xs text-muted">{formatTime(a.starts_at)}</span>
                  <span className="flex-1 font-medium text-ink">{a.patient_name}</span>
                  <span className="text-xs text-muted">{a.doctor_name ?? 'بدون طبيب محدد'}</span>
                  <Badge variant={STATUS_VARIANTS[a.status]}>{STATUS_LABELS[a.status]}</Badge>
                </button>
              ))}
            </div>
          )}

          <h2 className="mb-2 mt-6 flex items-center gap-2 border-t border-border px-2 pt-4 text-sm font-medium text-ink/70">
            <FontAwesomeIcon icon={faClock} className="text-accent" />
            الأوقات المتاحة — اختر أي وقت، بأي طبيب
          </h2>

          {loadingSlots ? (
            <p className="p-6 text-center text-sm text-muted">جارِ التحميل...</p>
          ) : openSlots.length === 0 ? (
            <div className="p-6 text-center">
              <p className="mb-3 text-sm text-muted">لا يوجد دوام أو أوقات متاحة بهذا اليوم.</p>
              <button
                onClick={() => {
                  setManualBooking(true)
                  setSelectedSlot(null)
                }}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
              >
                احجز موعداً يدوياً بدون طبيب
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2 px-2 py-2">
              {openSlots.map((s) => (
                <button
                  key={`${s.doctorId}-${s.starts_at}`}
                  onClick={() => setSelectedSlot(s)}
                  className={`flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm transition-colors ${
                    selectedSlot?.doctorId === s.doctorId && selectedSlot?.starts_at === s.starts_at
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-border text-muted hover:border-accent hover:text-accent'
                  }`}
                >
                  <span className="font-mono">{s.starts_at_display}</span>
                  {doctorFilter === 'all' && <span className="text-xs opacity-70">· {s.doctorName}</span>}
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-medium text-ink/70">حجز موعد</h2>
            <button
              onClick={() => {
                setManualBooking((v) => !v)
                setSelectedSlot(null)
              }}
              className="text-xs text-accent hover:underline"
            >
              {manualBooking ? 'اختيار من الأوقات المتاحة' : 'حجز بدون تحديد طبيب'}
            </button>
          </div>

          <div className="mb-3">
            <label className="mb-1 block text-sm text-muted">تاريخ الموعد</label>
            <DatePicker value={date} onChange={(iso) => iso && setDate(iso)} allowClear={false} />
          </div>

          {manualBooking ? (
            <>
              <p className="mb-3 text-xs text-muted">
                يحجز موعداً بدون ربطه بجدول طبيب معيّن — تقدر تحدد الطبيب لاحقاً، أو تخليه بدون طبيب.
              </p>
              <Select label="المريض" value={patientId} onChange={(e) => setPatientId(e.target.value)} className="mb-3">
                <option value="">اختر مريضاً</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>{p.full_name} ({p.code})</option>
                ))}
              </Select>
              <label className="mb-1 block text-sm text-muted">الوقت</label>
              <input
                type="time"
                value={manualTime}
                onChange={(e) => setManualTime(e.target.value)}
                className="mb-3 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
              <Select label="الطبيب (اختياري)" value={manualDoctorId} onChange={(e) => setManualDoctorId(e.target.value)} className="mb-3">
                <option value="">بدون طبيب محدد</option>
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>{d.full_name}</option>
                ))}
              </Select>

              {error && <p className="mb-2 text-sm text-danger">{error}</p>}

              <Button onClick={bookManual} disabled={!patientId || booking} loading={booking} className="w-full justify-center">
                {booking ? 'جارِ الحجز...' : 'تأكيد الحجز'}
              </Button>
            </>
          ) : !selectedSlot ? (
            <p className="text-sm text-muted">
              {openSlots.length === 0
                ? 'ما في أوقات متاحة اليوم — اضغط "حجز بدون تحديد طبيب" فوق، أو احجز يدوياً من القائمة يسار.'
                : 'اختر وقتاً متاحاً من القائمة.'}
            </p>
          ) : (
            <>
              <p className="mb-1 text-sm text-ink">
                الوقت: <span className="font-medium">{selectedSlot.starts_at_display}</span>
              </p>
              <p className="mb-3 text-sm text-muted">مع {selectedSlot.doctorName}</p>
              <Select label="المريض" value={patientId} onChange={(e) => setPatientId(e.target.value)} className="mb-3">
                <option value="">اختر مريضاً</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>{p.full_name} ({p.code})</option>
                ))}
              </Select>

              {error && <p className="mb-2 text-sm text-danger">{error}</p>}

              <Button onClick={book} disabled={!patientId || booking} loading={booking} className="w-full justify-center">
                {booking ? 'جارِ الحجز...' : 'تأكيد الحجز'}
              </Button>
            </>
          )}
        </Card>
      </div>

      {openAppointmentId && (
        <AppointmentDetailModal
          appointmentId={openAppointmentId}
          onClose={() => setOpenAppointmentId(null)}
          onChanged={() => {
            loadAppointments()
            loadOpenSlots()
          }}
        />
      )}
    </div>
  )
}
