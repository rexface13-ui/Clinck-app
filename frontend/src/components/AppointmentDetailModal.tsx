import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCheck, faXmark, faFileInvoiceDollar } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { formatDate, formatTime } from '../lib/formatDate'
import { Modal, Badge } from './ui'
import type { BadgeVariant } from './ui'
import type { Appointment } from '../types'
import CompleteVisitModal from './CompleteVisitModal'

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
  const [completing, setCompleting] = useState(false)

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

  if (completing && appointment) {
    return (
      <CompleteVisitModal
        appointmentId={appointment.id}
        patientId={appointment.patient_id}
        patientName={appointment.patient_name ?? ''}
        doctorId={appointment.doctor_id}
        onClose={() => setCompleting(false)}
        onDone={() => {
          onChanged()
          onClose()
        }}
      />
    )
  }

  const pending = appointment && (appointment.status === 'scheduled' || appointment.status === 'confirmed')
  const plan = appointment?.treatment_plan

  return (
    <Modal title="تفاصيل الموعد" onClose={onClose} width="w-[520px]">
      {!appointment ? (
        <p className="py-8 text-center text-sm text-muted">جارِ التحميل...</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <Link to={`/patients/${appointment.patient_id}`} onClick={onClose} className="text-lg font-semibold text-ink hover:text-accent">
                {appointment.patient_name}
              </Link>
              <p className="mt-1 text-sm text-muted">{appointment.doctor_name ?? 'بدون طبيب محدد'}</p>
              <p className="mt-1 text-sm text-muted">
                {formatDate(appointment.starts_at)} — {formatTime(appointment.starts_at)}
              </p>
            </div>
            <Badge variant={STATUS_VARIANTS[appointment.status]}>{STATUS_LABELS[appointment.status]}</Badge>
          </div>

          {plan && (
            <div className="rounded-lg bg-background p-3">
              <h3 className="mb-2 text-xs font-semibold text-muted">الخدمات المسجّلة بهاي الزيارة</h3>
              {plan.items.length === 0 ? (
                <p className="text-sm text-muted">لا يوجد خدمات.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {plan.items.map((item) => (
                    <li key={item.id} className="flex items-center justify-between">
                      <span>
                        {item.service_name}
                        {item.tooth_number && <span className="text-muted"> — سن {item.tooth_number}</span>}
                      </span>
                      <span className="text-muted">{item.unit_price} ₪</span>
                    </li>
                  ))}
                </ul>
              )}
              {plan.latest_invoice_id && can('billing.view') && (
                <Link
                  to={`/patients/${appointment.patient_id}?pay=1`}
                  onClick={onClose}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-border py-1.5 text-xs font-medium text-accent hover:border-accent"
                >
                  <FontAwesomeIcon icon={faFileInvoiceDollar} />
                  فتح كشف الحساب / تحصيل دفعة
                </Link>
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

          {pending && can('appointments.manage') && (
            <div className="flex gap-2 border-t border-border/70 pt-3">
              <button
                onClick={() => setCompleting(true)}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent py-2 text-sm font-medium text-white hover:bg-accent-hover"
              >
                <FontAwesomeIcon icon={faCheck} />
                تمّت الزيارة
              </button>
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
