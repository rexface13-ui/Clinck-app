import { useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCalendarDays, faChevronLeft, faChevronRight } from '@fortawesome/free-solid-svg-icons'

const WEEKDAY_LABELS = ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت']
const MONTH_LABELS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
]

/** value/onChange use ISO yyyy-mm-dd (matches the API). Display is always dd/mm/yyyy — never the browser's locale-dependent native date input. */
interface Props {
  value: string
  onChange: (isoDate: string) => void
  placeholder?: string
  allowClear?: boolean
}

function toIso(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function parseIso(iso: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  return { year: Number(m[1]), month: Number(m[2]) - 1, day: Number(m[3]) }
}

function displayValue(iso: string): string {
  const parsed = parseIso(iso)
  if (!parsed) return ''
  return `${String(parsed.day).padStart(2, '0')}/${String(parsed.month + 1).padStart(2, '0')}/${parsed.year}`
}

export default function DatePicker({ value, onChange, placeholder = 'يوم/شهر/سنة', allowClear = true }: Props) {
  const [open, setOpen] = useState(false)
  const parsed = parseIso(value)
  const today = new Date()
  const [viewYear, setViewYear] = useState(parsed?.year ?? today.getFullYear())
  const [viewMonth, setViewMonth] = useState(parsed?.month ?? today.getMonth())
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  function openPicker() {
    if (parsed) {
      setViewYear(parsed.year)
      setViewMonth(parsed.month)
    }
    setOpen(true)
  }

  const firstOfMonth = new Date(viewYear, viewMonth, 1)
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const leadingBlanks = firstOfMonth.getDay()

  const cells: (number | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  function selectDay(day: number) {
    onChange(toIso(viewYear, viewMonth, day))
    setOpen(false)
  }

  function shiftMonth(delta: number) {
    let m = viewMonth + delta
    let y = viewYear
    if (m < 0) { m = 11; y -= 1 }
    if (m > 11) { m = 0; y += 1 }
    setViewMonth(m)
    setViewYear(y)
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={openPicker}
        className="flex w-full items-center justify-between rounded-xl border border-ink/10 px-3 py-2 text-start text-sm focus:border-accent focus:outline-none"
      >
        <span className={value ? 'text-ink' : 'text-ink/40'}>{value ? displayValue(value) : placeholder}</span>
        <FontAwesomeIcon icon={faCalendarDays} className="text-ink/40" />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-72 rounded-xl border border-ink/10 bg-white p-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => shiftMonth(-1)} className="rounded-lg p-1.5 text-ink/60 hover:bg-background">
              <FontAwesomeIcon icon={faChevronRight} />
            </button>
            <span className="text-sm font-medium text-ink">
              {MONTH_LABELS[viewMonth]} {viewYear}
            </span>
            <button type="button" onClick={() => shiftMonth(1)} className="rounded-lg p-1.5 text-ink/60 hover:bg-background">
              <FontAwesomeIcon icon={faChevronLeft} />
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7 text-center text-xs text-ink/40">
            {WEEKDAY_LABELS.map((w) => (
              <span key={w}>{w[0]}</span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, i) => {
              const isSelected = day !== null && parsed?.year === viewYear && parsed?.month === viewMonth && parsed?.day === day
              return (
                <button
                  key={i}
                  type="button"
                  disabled={day === null}
                  onClick={() => day && selectDay(day)}
                  className={`aspect-square rounded-lg text-xs ${
                    day === null
                      ? ''
                      : isSelected
                        ? 'bg-accent text-white'
                        : 'text-ink/70 hover:bg-background'
                  }`}
                >
                  {day ?? ''}
                </button>
              )
            })}
          </div>

          {allowClear && value && (
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false) }}
              className="mt-2 w-full rounded-lg py-1.5 text-xs text-ink/50 hover:bg-background"
            >
              مسح التاريخ
            </button>
          )}
        </div>
      )}
    </div>
  )
}
