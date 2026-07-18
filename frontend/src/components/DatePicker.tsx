import { useEffect, useRef, useState, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
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

/** Parses a dd/mm/yyyy string typed by the user into an ISO date, or null if incomplete/invalid. */
function parseTyped(text: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim())
  if (!m) return null
  const day = Number(m[1])
  const month = Number(m[2])
  const year = Number(m[3])
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return toIso(year, month - 1, day)
}

/** Auto-inserts `/` as the user types digits, e.g. "1807" -> "18/07". */
function autoFormat(raw: string, previous: string): string {
  // allow deletion without fighting the user
  if (raw.length < previous.length) return raw
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  const parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean)
  return parts.join('/')
}

const YEAR_RANGE = Array.from({ length: 141 }, (_, i) => 1950 + i)

export default function DatePicker({ value, onChange, placeholder = 'يوم/شهر/سنة', allowClear = true }: Props) {
  const [open, setOpen] = useState(false)
  const parsed = parseIso(value)
  const today = new Date()
  const [viewYear, setViewYear] = useState(parsed?.year ?? today.getFullYear())
  const [viewMonth, setViewMonth] = useState(parsed?.month ?? today.getMonth())
  const [typedValue, setTypedValue] = useState(displayValue(value))
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setTypedValue(displayValue(value))
  }, [value])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (
        rootRef.current && !rootRef.current.contains(e.target as Node) &&
        panelRef.current && !panelRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    function place() {
      const rect = rootRef.current?.getBoundingClientRect()
      if (!rect) return
      const panelWidth = 288 // w-72
      const panelHeight = 340
      const margin = 8

      let left = rect.left
      if (left + panelWidth > window.innerWidth - margin) {
        left = Math.max(margin, rect.right - panelWidth)
      }
      left = Math.max(margin, Math.min(left, window.innerWidth - panelWidth - margin))

      const spaceBelow = window.innerHeight - rect.bottom
      const openUpward = spaceBelow < panelHeight && rect.top > panelHeight
      const top = openUpward ? rect.top - panelHeight - margin : rect.bottom + margin

      setCoords({ top, left, width: rect.width })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open])

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
    inputRef.current?.blur()
  }

  function shiftMonth(delta: number) {
    let m = viewMonth + delta
    let y = viewYear
    if (m < 0) { m = 11; y -= 1 }
    if (m > 11) { m = 0; y += 1 }
    setViewMonth(m)
    setViewYear(y)
  }

  function handleTypedChange(raw: string) {
    const formatted = autoFormat(raw, typedValue)
    setTypedValue(formatted)
    const iso = parseTyped(formatted)
    if (iso) {
      onChange(iso)
      const p = parseIso(iso)!
      setViewYear(p.year)
      setViewMonth(p.month)
    }
  }

  function handleTypedBlur() {
    // revert to the last valid value if what's typed doesn't resolve to a full date
    if (!parseTyped(typedValue) && typedValue !== '') {
      setTypedValue(displayValue(value))
    }
  }

  return (
    <div className="relative" ref={rootRef}>
      <div className="flex w-full items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm focus-within:border-accent">
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          dir="ltr"
          value={typedValue}
          onChange={(e) => handleTypedChange(e.target.value)}
          onFocus={openPicker}
          onBlur={handleTypedBlur}
          placeholder={placeholder}
          className="w-full bg-transparent text-start text-ink placeholder:text-ink/40 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => (open ? setOpen(false) : openPicker())}
          className="text-ink/40 hover:text-accent"
          tabIndex={-1}
        >
          <FontAwesomeIcon icon={faCalendarDays} />
        </button>
      </div>

      {open && coords && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', top: coords.top, left: coords.left }}
          className="z-50 w-72 rounded-xl border border-border bg-surface p-3 shadow-lg"
        >
          <div className="mb-2 flex items-center justify-between gap-1">
            <button type="button" onClick={() => shiftMonth(-1)} className="shrink-0 rounded-lg p-1.5 text-ink/60 hover:bg-background">
              <FontAwesomeIcon icon={faChevronRight} />
            </button>

            <div className="flex items-center gap-1">
              <select
                value={viewMonth}
                onChange={(e) => setViewMonth(Number(e.target.value))}
                className="rounded-lg border border-border bg-surface px-1.5 py-1 text-xs font-medium text-ink focus:border-accent focus:outline-none"
              >
                {MONTH_LABELS.map((m, i) => (
                  <option key={m} value={i}>{m}</option>
                ))}
              </select>
              <select
                value={viewYear}
                onChange={(e) => setViewYear(Number(e.target.value))}
                className="rounded-lg border border-border bg-surface px-1.5 py-1 text-xs font-medium text-ink focus:border-accent focus:outline-none"
              >
                {YEAR_RANGE.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>

            <button type="button" onClick={() => shiftMonth(1)} className="shrink-0 rounded-lg p-1.5 text-ink/60 hover:bg-background">
              <FontAwesomeIcon icon={faChevronLeft} />
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7 text-center text-xs text-muted">
            {WEEKDAY_LABELS.map((w) => (
              <span key={w}>{w[0]}</span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, i) => {
              const isSelected = day !== null && parsed?.year === viewYear && parsed?.month === viewMonth && parsed?.day === day
              const isToday = day !== null && viewYear === today.getFullYear() && viewMonth === today.getMonth() && day === today.getDate()
              return (
                <button
                  key={i}
                  type="button"
                  disabled={day === null}
                  onClick={() => day && selectDay(day)}
                  className={`aspect-square rounded-lg text-xs transition-colors ${
                    day === null
                      ? ''
                      : isSelected
                        ? 'bg-accent font-semibold text-white'
                        : isToday
                          ? 'font-semibold text-accent ring-1 ring-inset ring-accent/40 hover:bg-accent-soft'
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
              onClick={() => { onChange(''); setTypedValue(''); setOpen(false) }}
              className="mt-2 w-full rounded-lg py-1.5 text-xs text-muted hover:bg-background"
            >
              مسح التاريخ
            </button>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
