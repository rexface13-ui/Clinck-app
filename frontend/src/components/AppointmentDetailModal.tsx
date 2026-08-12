import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCheck, faUser, faClockRotateLeft, faCalendarPlus, faTriangleExclamation, faTrash } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { formatDate, formatTime } from '../lib/formatDate'
import DatePicker from './DatePicker'
import { Modal, Badge, Button } from './ui'
import type { BadgeVariant } from './ui'
import type { Appointment, AppointmentTimelineEntry, Doctor } from '../types'

const STATUS_VARIANTS: Record<Appointment['status'], BadgeVariant> = {
  scheduled: 'info',
  confirmed: 'accent',
  done: 'success',
  cancelled: 'danger',
  no_show: 'warning',
}

const STATUS_LABELS: Record<Appointment['status'], string> = {
  scheduled: 'مجدول',
  confirmed: 'مؤكد',
  done: 'حضر',
  cancelled: 'ملغى',
  no_show: 'لم يحضر',
}

interface Props {
  appointmentId: number
  onClose: () => void
  /** Called after any change (cancel, complete, notes save) so the caller can refresh its own list. */
  onChanged: () => void
}

export default function AppointmentDetailModal({ appointmentId, onClose, onChanged }: Props) {
  const { can } = useAuth()
  const [appointment, setAppointment] = useState<Appointment | null>(null)
  const [notes, setNotes] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [timeline, setTimeline] = useState<AppointmentTimelineEntry[] | null>(null)
  const [doctors, setDoctors] = useState<Doctor[]>([])

  const [rescheduling, setRescheduling] = useState(false)
  const [newDate, setNewDate] = useState('')
  const [newTime, setNewTime] = useState('10:00')
  const [newDoctorId, setNewDoctorId] = useState('')
  const [rescheduleError, setRescheduleError] = useState<string | null>(null)
  const [savingReschedule, setSavingReschedule] = useState(false)

  function load() {
    api.get<{ data: Appointment }>(`/appointments/${appointmentId}`).then((res) => {
      setAppointment(res.data.data)
      setNotes(res.data.data.notes ?? '')
    })
    api.get<AppointmentTimelineEntry[]>(`/appointments/${appointmentId}/timeline`).then((res) => setTimeline(res.data))
  }

  useEffect(load, [appointmentId])
  useEffect(() => {
    api.get('/doctors').then((res) => setDoctors(res.data.data))
  }, [])

  async function saveNotes() {
    setSavingNotes(true)
    try {
      await api.put(`/appointments/${appointmentId}`, { notes: notes || null })
      onChanged()
    } finally {
      setSavingNotes(false)
    }
  }

  async function deleteAppointment() {
    if (!window.confirm('حذف هذا الموعد نهائياً؟')) return
    setDeleting(true)
    try {
      await api.delete(`/appointments/${appointmentId}`)
      onChanged()
      onClose()
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      window.alert(message ?? 'تعذّر حذف الموعد.')
    } finally {
      setDeleting(false)
    }
  }

  function openReschedule() {
    if (!appointment) return
    const d = new Date(appointment.starts_at)
    setNewDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
    setNewTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)
    setNewDoctorId(appointment.doctor_id ? String(appointment.doctor_id) : '')
    setRescheduleError(null)
    setRescheduling(true)
  }

  async function saveReschedule() {
    if (!appointment || !newDate) return
    setSavingReschedule(true)
    setRescheduleError(null)
    try {
      const durationMs = new Date(appointment.ends_at).getTime() - new Date(appointment.starts_at).getTime()
      const startsAt = new Date(`${newDate}T${newTime}:00`)
      const endsAt = new Date(startsAt.getTime() + durationMs)
      await api.put(`/appointments/${appointmentId}`, {
        doctor_id: newDoctorId ? Number(newDoctorId) : null,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
      })
      setRescheduling(false)
      load()
      onChanged()
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      setRescheduleError(message ?? 'تعذّر تأجيل الموعد.')
    } finally {
      setSavingReschedule(false)
    }
  }

  return (
    <Modal title="تفاصيل الموعد" onClose={onClose} width="w-[520px]">
      {!appointment ? (
        <p className="py-8 text-center text-sm text-muted">جارِ التحميل...</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-lg font-semibold text-ink">{appointment.patient_name}</p>
              <p className="mt-1 text-sm text-muted">{appointment.doctor_name ?? 'بدون طبيب محدد'}</p>
              <p className="mt-1 text-sm text-muted">
                {formatDate(appointment.starts_at)} — {formatTime(appointment.starts_at)}
              </p>
            </div>
            <Badge variant={STATUS_VARIANTS[appointment.status]}>{STATUS_LABELS[appointment.status]}</Badge>
          </div>

          <Link
            to={`/patients/${appointment.patient_id}`}
            onClick={onClose}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent-soft py-2 text-sm font-medium text-accent hover:bg-accent hover:text-white"
          >
            <FontAwesomeIcon icon={faUser} />
            فتح ملف المريض
          </Link>

          {!!appointment.work_items?.length && (
            <div className="rounded-lg bg-background p-3">
              <h3 className="mb-2 text-xs font-semibold text-muted">الشغل المسجّل بهاي الزيارة</h3>
              <ul className="space-y-2 text-sm">
                {appointment.work_items.map((w) => (
                  <li key={w.id}>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        {w.service_color && <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: w.service_color }} />}
                        {w.service_name}
                      </span>
                      <span className="text-xs text-muted">{w.status === 'done' ? 'مكتمل' : 'قيد التنفيذ'}</span>
                    </div>
                    {!!w.teeth.length && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {w.teeth.map((n) => (
                          <span key={n} className="rounded-full bg-surface px-1.5 py-0.5 text-[10px] text-ink/60 ring-1 ring-border">
                            {n}
                          </span>
                        ))}
                      </div>
                    )}
                    {!!w.pending.length && (
                      <p className="mt-1 text-xs text-warning">
                        ضل: {w.pending.map((p) => `${p.step_title} (سن ${p.tooth_number})`).join('، ')}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {appointment.has_pending_work && (
            <div className="rounded-lg bg-warning-soft p-3 text-sm">
              <p className="mb-2 flex items-center gap-1.5 font-medium text-warning">
                <FontAwesomeIcon icon={faTriangleExclamation} />
                في شغل ضل ما انجز بهاي الزيارة
              </p>
              {appointment.follow_up_appointment ? (
                <p className="text-ink/70">
                  موعد المتابعة محجوز: <span className="font-medium text-ink">{appointment.follow_up_appointment.starts_at_display}</span>
                </p>
              ) : (
                <>
                  <p className="mb-2 text-ink/70">لسا ما تحدد موعد متابعة.</p>
                  <Link
                    to={`/appointments?patient_id=${appointment.patient_id}`}
                    onClick={onClose}
                    className="flex items-center justify-center gap-2 rounded-lg bg-warning py-2 text-sm font-medium text-white hover:opacity-90"
                  >
                    <FontAwesomeIcon icon={faCalendarPlus} />
                    احجز موعد متابعة
                  </Link>
                </>
              )}
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-muted">ملاحظات على الموعد</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
              placeholder="أي ملاحظة على هالموعد..."
            />
            <button
              onClick={saveNotes}
              disabled={savingNotes || notes === (appointment.notes ?? '')}
              className="mt-2 rounded-lg bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent hover:text-white disabled:opacity-50"
            >
              {savingNotes ? 'جارِ الحفظ...' : 'حفظ الملاحظة'}
            </button>
          </div>

          {!!timeline?.length && (
            <div>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted">
                <FontAwesomeIcon icon={faClockRotateLeft} />
                سجل الموعد
              </h3>
              <ul className="space-y-2 border-r-2 border-border pr-3 text-xs">
                {timeline.map((t) => (
                  <li key={t.id} className="text-ink/70">
                    <span className="text-ink">{t.description}</span>
                    <span className="text-muted"> — {t.user_name} — {t.created_at}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {can('appointments.manage') && (
            <div className="space-y-2 border-t border-border/70 pt-3">
              <Link
                to={`/patients/${appointment.patient_id}?tab=work`}
                onClick={onClose}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-2 text-sm font-medium text-white hover:bg-accent-hover"
              >
                <FontAwesomeIcon icon={faCheck} />
                تمّت الزيارة — تخطيط العمل
              </Link>

              {!rescheduling ? (
                <div className="flex gap-2">
                  <button
                    onClick={openReschedule}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-warning-soft px-4 py-2 text-sm font-medium text-warning hover:bg-warning hover:text-white"
                  >
                    <FontAwesomeIcon icon={faClockRotateLeft} />
                    تأجيل (يوم/وقت تاني)
                  </button>
                  <button
                    onClick={deleteAppointment}
                    disabled={deleting}
                    className="flex items-center justify-center gap-2 rounded-lg bg-danger-soft px-4 py-2 text-sm font-medium text-danger hover:bg-danger hover:text-white disabled:opacity-50"
                  >
                    <FontAwesomeIcon icon={faTrash} />
                    حذف الموعد
                  </button>
                </div>
              ) : (
                <div className="space-y-2 rounded-lg bg-background p-3">
                  <DatePicker value={newDate} onChange={(iso) => iso && setNewDate(iso)} allowClear={false} />
                  <div className="flex gap-2">
                    <input
                      type="time"
                      value={newTime}
                      onChange={(e) => setNewTime(e.target.value)}
                      className="flex-1 rounded-lg border border-border px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
                    />
                    <select
                      value={newDoctorId}
                      onChange={(e) => setNewDoctorId(e.target.value)}
                      className="flex-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
                    >
                      <option value="">بدون طبيب محدد</option>
                      {doctors.map((d) => (
                        <option key={d.id} value={d.id}>{d.full_name}</option>
                      ))}
                    </select>
                  </div>
                  {rescheduleError && <p className="text-xs text-danger">{rescheduleError}</p>}
                  <div className="flex gap-2">
                    <Button onClick={saveReschedule} loading={savingReschedule} className="flex-1 justify-center px-3 py-1.5 text-xs">
                      حفظ الموعد الجديد
                    </Button>
                    <button onClick={() => setRescheduling(false)} className="rounded-lg px-3 py-1.5 text-xs text-muted hover:bg-background">
                      إلغاء
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
