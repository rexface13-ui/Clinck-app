import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCheck, faXmark, faUser } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { formatDate, formatTime } from '../lib/formatDate'
import { Modal, Badge } from './ui'
import type { BadgeVariant } from './ui'
import type { Appointment } from '../types'

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
  const [cancelling, setCancelling] = useState(false)

  function load() {
    api.get<{ data: Appointment }>(`/appointments/${appointmentId}`).then((res) => {
      setAppointment(res.data.data)
      setNotes(res.data.data.notes ?? '')
    })
  }

  useEffect(load, [appointmentId])

  async function saveNotes() {
    setSavingNotes(true)
    try {
      await api.put(`/appointments/${appointmentId}`, { notes: notes || null })
      onChanged()
    } finally {
      setSavingNotes(false)
    }
  }

  async function cancelAppointment() {
    if (!window.confirm('إلغاء هذا الموعد؟')) return
    setCancelling(true)
    try {
      await api.put(`/appointments/${appointmentId}`, { status: 'cancelled' })
      onChanged()
      onClose()
    } finally {
      setCancelling(false)
    }
  }

  const pending = appointment && (appointment.status === 'scheduled' || appointment.status === 'confirmed')

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
              <ul className="space-y-1 text-sm">
                {appointment.work_items.map((w) => (
                  <li key={w.id} className="flex items-center justify-between">
                    <span>{w.service_name}</span>
                    <span className="text-xs text-muted">{w.status === 'done' ? 'مكتمل' : 'قيد التنفيذ'}</span>
                  </li>
                ))}
              </ul>
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

          {pending && can('appointments.manage') && (
            <div className="flex gap-2 border-t border-border/70 pt-3">
              <Link
                to={`/patients/${appointment.patient_id}?tab=work`}
                onClick={onClose}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent py-2 text-sm font-medium text-white hover:bg-accent-hover"
              >
                <FontAwesomeIcon icon={faCheck} />
                تمّت الزيارة
              </Link>
              <button
                onClick={cancelAppointment}
                disabled={cancelling}
                className="flex items-center justify-center gap-2 rounded-lg bg-danger-soft px-4 py-2 text-sm font-medium text-danger hover:bg-danger hover:text-white disabled:opacity-50"
              >
                <FontAwesomeIcon icon={faXmark} />
                إلغاء الموعد
              </button>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
