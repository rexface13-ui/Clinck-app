/**
 * The single place dates get converted from storage (UTC, ISO 8601) to
 * display form. Never format a date ad-hoc in a component — route it
 * through here so every screen agrees on dd/mm/yyyy, Asia/Hebron, and
 * Latin (not Arabic-Indic) tabular digits, matching
 * backend/app/Support/DateFormatter.php.
 */

export const DISPLAY_TIMEZONE = 'Asia/Hebron'

// 'en-GB' gives dd/mm/yyyy ordering with Latin digits regardless of the
// app's Arabic UI locale — Arabic locales render Arabic-Indic digits by
// default, which this codebase never wants for dates.
const DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: DISPLAY_TIMEZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

const DATETIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: DISPLAY_TIMEZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: DISPLAY_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value)
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return ''
  return DATE_FORMATTER.format(toDate(value))
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return ''
  return DATETIME_FORMATTER.format(toDate(value)).replace(',', '')
}

export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return ''
  return TIME_FORMATTER.format(toDate(value))
}
