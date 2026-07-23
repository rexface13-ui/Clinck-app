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

const WEEKDAY_LABELS = ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س']

const DOT_COLOR: Record<OccupancyDay['status'], string> = {
  empty: 'bg-success',
  some: 'bg-warning',
  full: 'bg-danger',
  closed: 'bg-transparent',
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
    <Card className="w-fit min-w-[280px] p-4">
      <div className="mb-3">
        <SearchableSelect
          options={doctors.map((d) => ({ value: String(d.id), label: d.full_name }))}
          value={doctorId}
          onChange={setDoctorId}
          placeholder="اختر طبيب..."
        />
      </div>

      <div className="mb-2 flex items-center justify-between">
        <button onClick={() => shiftMonth(-1)} className="rounded-md p-1 text-ink/40 hover:bg-background hover:text-ink">
          <FontAwesomeIcon icon={faChevronRight} className="text-xs" />
        </button>
        <span className="text-xs font-semibold text-ink/80">{monthLabel}</span>
        <button onClick={() => shiftMonth(1)} className="rounded-md p-1 text-ink/40 hover:bg-background hover:text-ink">
          <FontAwesomeIcon icon={faChevronLeft} className="text-xs" />
        </button>
      </div>

      {!doctorId ? (
        <p className="py-4 text-center text-xs text-muted">ما في أطباء مسجّلين بعد.</p>
      ) : !days ? (
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 35 }).map((_, i) => (
            <div key={i} className="size-8 animate-pulse rounded-md bg-background" />
          ))}
        </div>
      ) : (
        <>
          <div className="mb-0.5 grid grid-cols-7 text-center text-[10px] text-ink/30">
            {WEEKDAY_LABELS.map((w, i) => (
              <div key={i}>{w}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-0.5">
            {Array.from({ length: leadingBlanks }).map((_, i) => (
              <div key={`blank-${i}`} className="size-8" />
            ))}
            {days.map((d) => {
              const isToday = d.date === today
              return (
                <button
                  key={d.date}
                  onClick={() => openDay(d.date)}
                  title={`${STATUS_LABELS[d.status]}${d.appointments_count > 0 ? ` — ${d.appointments_count} موعد` : ''}`}
                  className="group flex size-8 flex-col items-center justify-center"
                >
                  <span
                    className={`flex size-6 items-center justify-center rounded-full text-[11px] transition-colors ${
                      isToday
                        ? 'bg-accent font-semibold text-white'
                        : d.status === 'closed'
                          ? 'text-ink/25 group-hover:bg-background'
                          : 'text-ink/70 group-hover:bg-background'
                    }`}
                  >
                    {Number(d.date.slice(-2))}
                  </span>
                  <span className={`mt-0.5 size-1 rounded-full ${DOT_COLOR[d.status]}`} />
                </button>
              )
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-2.5 text-[10px] text-ink/50">
            <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-success" /> فاضي</span>
            <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-warning" /> حجوزات</span>
            <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-danger" /> ممتلئ</span>
          </div>
        </>
      )}
    </Card>
  )
}
