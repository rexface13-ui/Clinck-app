import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronLeft, faChevronRight } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { Card, SearchableSelect } from './ui'
import type { Doctor } from '../types'

interface OccupancyDay {
  date: string
  status: 'empty' | 'some' | 'full' | 'closed'
  appointments_count: number
  available_minutes: number
  booked_minutes: number
}

const WEEKDAY_LABELS = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت']

const STATUS_STYLES: Record<OccupancyDay['status'], string> = {
  empty: 'bg-success-soft text-success border-success/20',
  some: 'bg-warning-soft text-warning border-warning/20',
  full: 'bg-danger-soft text-danger border-danger/20',
  closed: 'bg-background text-ink/30 border-border',
}

const STATUS_LABELS: Record<OccupancyDay['status'], string> = {
  empty: 'فاضي',
  some: 'في حجوزات',
  full: 'ممتلئ',
  closed: 'غير مفتوح',
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function DoctorOccupancyCalendar() {
  const navigate = useNavigate()
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [doctorId, setDoctorId] = useState('')
  const [cursor, setCursor] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() + 1 }
  })
  const [days, setDays] = useState<OccupancyDay[] | null>(null)

  useEffect(() => {
    api.get('/doctors').then((res) => {
      setDoctors(res.data.data)
      if (res.data.data.length > 0) setDoctorId(String(res.data.data[0].id))
    })
  }, [])

  useEffect(() => {
    if (!doctorId) return
    setDays(null)
    api
      .get<{ days: OccupancyDay[] }>(`/doctors/${doctorId}/occupancy`, { params: { year: cursor.year, month: cursor.month } })
      .then((res) => setDays(res.data.days))
  }, [doctorId, cursor])

  function shiftMonth(delta: number) {
    setCursor((c) => {
      const d = new Date(c.year, c.month - 1 + delta, 1)
      return { year: d.getFullYear(), month: d.getMonth() + 1 }
    })
  }

  function openDay(date: string) {
    navigate(`/appointments?date=${date}${doctorId ? `&doctor_id=${doctorId}` : ''}`)
  }

  const monthLabel = new Date(cursor.year, cursor.month - 1, 1).toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' })
  const firstDay = days?.[0] ? new Date(days[0].date + 'T00:00:00') : null
  const leadingBlanks = firstDay ? firstDay.getDay() : 0
  const today = todayIso()

  return (
    <Card className="p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink/80">التقويم الشهري</h2>
        <div className="w-56">
          <SearchableSelect
            options={doctors.map((d) => ({ value: String(d.id), label: d.full_name }))}
            value={doctorId}
            onChange={setDoctorId}
            placeholder="اختر طبيب..."
          />
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <button onClick={() => shiftMonth(-1)} className="rounded-lg p-2 text-ink/50 hover:bg-background hover:text-ink">
          <FontAwesomeIcon icon={faChevronRight} />
        </button>
        <span className="text-sm font-medium text-ink">{monthLabel}</span>
        <button onClick={() => shiftMonth(1)} className="rounded-lg p-2 text-ink/50 hover:bg-background hover:text-ink">
          <FontAwesomeIcon icon={faChevronLeft} />
        </button>
      </div>

      {!doctorId ? (
        <p className="py-6 text-center text-sm text-muted">ما في أطباء مسجّلين بعد.</p>
      ) : !days ? (
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: 35 }).map((_, i) => (
            <div key={i} className="aspect-square animate-pulse rounded-lg bg-background" />
          ))}
        </div>
      ) : (
        <>
          <div className="mb-1 grid grid-cols-7 gap-1.5 text-center text-[11px] text-muted">
            {WEEKDAY_LABELS.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: leadingBlanks }).map((_, i) => (
              <div key={`blank-${i}`} />
            ))}
            {days.map((d) => (
              <button
                key={d.date}
                onClick={() => openDay(d.date)}
                title={`${STATUS_LABELS[d.status]} — ${d.appointments_count} موعد`}
                className={`flex aspect-square flex-col items-center justify-center rounded-lg border text-xs font-medium transition-transform hover:scale-105 ${STATUS_STYLES[d.status]} ${
                  d.date === today ? 'ring-2 ring-accent' : ''
                }`}
              >
                <span>{Number(d.date.slice(-2))}</span>
                {d.appointments_count > 0 && <span className="text-[10px] opacity-70">{d.appointments_count}</span>}
              </button>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-3 text-[11px] text-ink/60">
            <span className="flex items-center gap-1"><span className="size-2.5 rounded-full bg-success" /> فاضي</span>
            <span className="flex items-center gap-1"><span className="size-2.5 rounded-full bg-warning" /> في حجوزات</span>
            <span className="flex items-center gap-1"><span className="size-2.5 rounded-full bg-danger" /> ممتلئ</span>
            <span className="flex items-center gap-1"><span className="size-2.5 rounded-full bg-ink/20" /> غير مفتوح</span>
          </div>
        </>
      )}
    </Card>
  )
}
