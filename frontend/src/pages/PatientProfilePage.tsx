import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowRight,
  faCalendarPlus,
  faTriangleExclamation,
  faCheck,
  faClockRotateLeft,
  faUserXmark,
  faPen,
  faTrash,
  faPaperclip,
  faDownload,
  faUpload,
} from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import ToothChart from '../components/ToothChart'
import TreatmentPlanPanel from '../components/TreatmentPlanPanel'
import PatientLedgerPanel from '../components/PatientLedgerPanel'
import VisitHistoryPanel from '../components/VisitHistoryPanel'
import DatePicker from '../components/DatePicker'
import CompleteVisitModal from '../components/CompleteVisitModal'
import AppointmentDetailModal from '../components/AppointmentDetailModal'
import { Card, Badge, Button, Tabs } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import type { PatientProfile, Service, Ledger, Doctor, TreatmentPlan } from '../types'

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'مجدول',
  confirmed: 'مؤكد',
  done: 'تمت',
  cancelled: 'ملغى',
  no_show: 'لم يحضر',
}

function isToday(iso: string): boolean {
  const d = new Date(iso)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

export default function PatientProfilePage() {
  const { id } = useParams()
  const { can } = useAuth()
  const canViewBilling = can('billing.view')
  const [profile, setProfile] = useState<PatientProfile | null>(null)
  const [services, setServices] = useState<Service[]>([])
  const [ledger, setLedger] = useState<Ledger | null>(null)
  const [noteBody, setNoteBody] = useState('')
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null)
  const [editingNoteBody, setEditingNoteBody] = useState('')
  const [uploadingAttachment, setUploadingAttachment] = useState(false)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const [updatingVisit, setUpdatingVisit] = useState(false)
  const [pickingForPlanId, setPickingForPlanId] = useState<number | null>(null)
  const [pickedTooth, setPickedTooth] = useState<{ planId: number; toothNumbers: number[] } | null>(null)
  const [busyToothNumbers, setBusyToothNumbers] = useState<Map<number, string[]>>(new Map())
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [editingAppointmentId, setEditingAppointmentId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState({ date: '', time: '', doctor_id: '' })
  const [editError, setEditError] = useState<string | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [completingVisit, setCompletingVisit] = useState<{ id: number; doctorId: number | null } | null>(null)
  const [openAppointmentId, setOpenAppointmentId] = useState<number | null>(null)
  const [startingWalkIn, setStartingWalkIn] = useState(false)
  const [plansRefreshSignal, setPlansRefreshSignal] = useState(0)

  function load() {
    api.get(`/patients/${id}/profile`).then((res) => setProfile(res.data))
    if (canViewBilling) {
      api.get(`/patients/${id}/ledger`).then((res) => setLedger(res.data))
    }
    setPlansRefreshSignal((n) => n + 1)
  }

  useEffect(() => {
    load()
    api.get('/services').then((res) => setServices(res.data.data))
    api.get('/doctors').then((res) => setDoctors(res.data.data))
  }, [id])

  function startEditAppointment(a: { id: number; starts_at: string; doctor_id: number | null }) {
    const d = new Date(a.starts_at)
    const pad = (n: number) => String(n).padStart(2, '0')
    setEditingAppointmentId(a.id)
    setEditForm({
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      doctor_id: a.doctor_id ? String(a.doctor_id) : '',
    })
    setEditError(null)
  }

  async function saveEditAppointment() {
    if (!editingAppointmentId || !editForm.date || !editForm.time) return
    setSavingEdit(true)
    setEditError(null)
    try {
      const startsAt = new Date(`${editForm.date}T${editForm.time}:00`)
      const endsAt = new Date(startsAt.getTime() + 30 * 60000)
      await api.put(`/appointments/${editingAppointmentId}`, {
        doctor_id: editForm.doctor_id ? Number(editForm.doctor_id) : null,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
      })
      setEditingAppointmentId(null)
      load()
    } catch {
      setEditError('تعذّر الحفظ — تأكد إنه الطبيب مو مشغول بهذا الوقت.')
    } finally {
      setSavingEdit(false)
    }
  }

  function handlePlansLoaded(plans: TreatmentPlan[]) {
    const planStatusLabel: Record<TreatmentPlan['status'], string> = { draft: 'مسودة', approved: 'معتمدة', cancelled: 'ملغاة' }
    const busy = new Map<number, string[]>()
    for (const plan of plans) {
      if (plan.status === 'cancelled') continue
      for (const item of plan.items) {
        if (!item.tooth_number) continue
        const detail = `${item.service_name ?? 'خدمة'} — خطة ${planStatusLabel[plan.status]}${plan.doctor_name ? ` (${plan.doctor_name})` : ''}`
        busy.set(item.tooth_number, [...(busy.get(item.tooth_number) ?? []), detail])
      }
    }
    setBusyToothNumbers(busy)
  }

  async function deleteAppointment(appointmentId: number) {
    if (!window.confirm('حذف الموعد نهائياً؟ لو كان مرتبط بجلسة من خطة علاج بترجع الجلسة "بانتظار الجدولة"، ولو كان موعد "زيارة الآن" بتتلغى خطته وفاتورته وديونه تلقائياً معه.')) return
    await api.delete(`/appointments/${appointmentId}`)
    load()
  }

  async function setVisitOutcome(appointmentId: number, status: 'done' | 'cancelled' | 'no_show') {
    setUpdatingVisit(true)
    try {
      await api.put(`/appointments/${appointmentId}`, { status })
      load()
    } finally {
      setUpdatingVisit(false)
    }
  }

  async function startWalkInVisit() {
    setStartingWalkIn(true)
    try {
      const now = new Date()
      const ends = new Date(now.getTime() + 30 * 60000)
      const res = await api.post('/appointments', {
        branch_id: patient.branch_id,
        patient_id: Number(id),
        doctor_id: null,
        starts_at: now.toISOString(),
        ends_at: ends.toISOString(),
      })
      setCompletingVisit({ id: res.data.data.id, doctorId: null })
    } finally {
      setStartingWalkIn(false)
    }
  }

  async function addNote() {
    if (!noteBody.trim()) return
    await api.post(`/patients/${id}/notes`, { body: noteBody })
    setNoteBody('')
    load()
  }

  async function saveNoteEdit() {
    if (!editingNoteId || !editingNoteBody.trim()) return
    await api.patch(`/patients/${id}/notes/${editingNoteId}`, { body: editingNoteBody })
    setEditingNoteId(null)
    load()
  }

  async function deleteNote(noteId: number) {
    if (!window.confirm('حذف هالملاحظة نهائياً؟')) return
    await api.delete(`/patients/${id}/notes/${noteId}`)
    load()
  }

  async function uploadAttachment(file: File) {
    setAttachmentError(null)
    setUploadingAttachment(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      await api.post(`/patients/${id}/attachments`, formData)
      load()
    } catch {
      setAttachmentError('تعذّر رفع الملف — تحقق من نوع الملف وحجمه (الحد الأقصى 10 ميغابايت).')
    } finally {
      setUploadingAttachment(false)
      if (attachmentInputRef.current) attachmentInputRef.current.value = ''
    }
  }

  async function deleteAttachment(attachmentId: number) {
    if (!window.confirm('حذف هذا المرفق نهائياً؟')) return
    await api.delete(`/patients/${id}/attachments/${attachmentId}`)
    load()
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  if (!profile) return <p className="text-sm text-muted">جارِ التحميل...</p>

  const { patient, tooth_states, tooth_findings, appointments, notes, attachments } = profile
  const todayAppointment = appointments.find((a) => isToday(a.starts_at) && (a.status === 'scheduled' || a.status === 'confirmed'))
  const hasDebt = !!ledger && ledger.outstanding_ils > 0

  return (
    <div>
      <Link to="/patients" className="mb-4 flex w-fit items-center gap-2 text-sm text-muted hover:text-ink">
        <FontAwesomeIcon icon={faArrowRight} />
        العودة للمرضى
      </Link>

      {hasDebt && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <FontAwesomeIcon icon={faTriangleExclamation} />
          <span>
            تنبيه: على هذا المريض دين مستحق بقيمة <span className="font-semibold">{ledger!.outstanding_ils.toFixed(2)} ₪</span> — راجع كشف الحساب تحت لتحصيل دفعة.
          </span>
        </div>
      )}

      <Card className="mb-6 flex items-center justify-between p-6">
        <div>
          <h1 className="text-xl font-semibold text-ink">{patient.full_name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>{patient.code}</span>
            <span>·</span>
            <span>{patient.gender === 'male' ? 'ذكر' : 'أنثى'}</span>
            {patient.birth_date && <span>· {patient.birth_date}</span>}
            {patient.is_child && <Badge variant="accent">طفل</Badge>}
            {patient.phone && <span>· {patient.phone}</span>}
          </div>
          {patient.guardian_name && (
            <p className="mt-1 text-sm text-muted">ولي الأمر: {patient.guardian_name} ({patient.guardian_phone})</p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={startWalkInVisit} disabled={startingWalkIn}>
            <FontAwesomeIcon icon={faCheck} />
            {startingWalkIn ? 'جارِ التسجيل...' : 'اجاني هلق (بدون موعد)'}
          </Button>
          <Link to={`/appointments?patient_id=${patient.id}`}>
            <Button>
              <FontAwesomeIcon icon={faCalendarPlus} />
              حجز موعد
            </Button>
          </Link>
        </div>
      </Card>

      {todayAppointment && (
        <Card className="mb-6 flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <h2 className="text-sm font-semibold text-ink/80">زيارة اليوم</h2>
            <p className="mt-0.5 text-sm text-muted">
              مع {todayAppointment.doctor_name} — {todayAppointment.starts_at_display}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setVisitOutcome(todayAppointment.id, 'done')}
              disabled={updatingVisit}
              className="flex items-center gap-2 rounded-xl bg-success-soft px-3 py-2 text-sm font-medium text-success hover:opacity-80 disabled:opacity-50"
            >
              <FontAwesomeIcon icon={faCheck} />
              تمت الزيارة
            </button>
            <button
              onClick={() => setVisitOutcome(todayAppointment.id, 'cancelled')}
              disabled={updatingVisit}
              className="flex items-center gap-2 rounded-xl bg-warning-soft px-3 py-2 text-sm font-medium text-warning hover:opacity-80 disabled:opacity-50"
            >
              <FontAwesomeIcon icon={faClockRotateLeft} />
              تأجيل
            </button>
            <button
              onClick={() => setVisitOutcome(todayAppointment.id, 'no_show')}
              disabled={updatingVisit}
              className="flex items-center gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm font-medium text-danger hover:opacity-80 disabled:opacity-50"
            >
              <FontAwesomeIcon icon={faUserXmark} />
              لم يحضر
            </button>
          </div>
          <p className="w-full text-xs text-muted">
            بعد تسجيل "تمت الزيارة" — استخدم "تحصيل دفعة" بكشف الحساب تحت لتسجيل المبلغ المدفوع (كامل، جزئي، أو بالدين لو ما انحصّل شي).
          </p>
        </Card>
      )}

      <Tabs
        tabs={[
          {
            key: 'treatment',
            label: 'العلاج',
            content: (
              <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[1fr_1.4fr]">
                {/* DOM order matters here, not just visual: this app is RTL, so the first grid
                    child renders on the right. Tooth chart must appear on screen-left, so it's
                    written second even though it reads first in the page top-to-bottom. Its
                    column is also wider than the plan's — the chart is the thing that needs
                    room to be legible/clickable, the plan is just a table. */}
                <TreatmentPlanPanel
                  patientId={patient.id}
                  pickedTooth={pickedTooth}
                  onToothConsumed={() => setPickedTooth(null)}
                  onRequestPickTooth={(planId) => setPickingForPlanId((cur) => (cur === planId ? null : planId))}
                  pickingForPlanId={pickingForPlanId}
                  onPlansLoaded={handlePlansLoaded}
                  refreshSignal={plansRefreshSignal}
                />
                <div>
                  <h2 className="mb-3 text-sm font-medium text-ink/70">رسمة الأسنان</h2>
                  <ToothChart
                    patientId={patient.id}
                    isChild={patient.is_child}
                    toothStates={tooth_states}
                    toothFindings={tooth_findings}
                    services={services}
                    doctors={doctors}
                    onChanged={load}
                    pickMode={pickingForPlanId !== null}
                    onPickTooth={(toothNumbers) => {
                      if (pickingForPlanId === null) return
                      setPickedTooth({ planId: pickingForPlanId, toothNumbers })
                      setPickingForPlanId(null)
                    }}
                    busyToothNumbers={busyToothNumbers}
                  />
                </div>
              </div>
            ),
          },
          {
            key: 'visits',
            label: 'سجل الزيارات',
            content: <VisitHistoryPanel patientId={patient.id} onChanged={load} />,
          },
          ...(canViewBilling
            ? [
                {
                  key: 'ledger',
                  label: 'الحساب',
                  content: <PatientLedgerPanel patientId={patient.id} refreshSignal={plansRefreshSignal} />,
                },
              ]
            : []),
          {
            key: 'appointments',
            label: 'المواعيد',
            content: (
        <Card className="p-6">
          {appointments.length === 0 ? (
            <p className="text-sm text-muted">لا توجد مواعيد.</p>
          ) : (
            <ul className="space-y-2">
              {appointments.map((a) => (
                <li key={a.id} className="border-b border-border/70 pb-2 text-sm last:border-0">
                  <div className="flex items-center justify-between">
                    <button onClick={() => setOpenAppointmentId(a.id)} className="flex flex-1 items-center gap-4 text-start hover:text-accent">
                      <span>{a.doctor_name}</span>
                      <span className="text-muted">{a.starts_at_display}</span>
                      <span className="text-muted">{STATUS_LABELS[a.status] ?? a.status}</span>
                    </button>
                    <div className="flex items-center gap-3">
                      {(a.status === 'scheduled' || a.status === 'confirmed') && (
                        <button
                          onClick={() => setCompletingVisit({ id: a.id, doctorId: a.doctor_id })}
                          className="rounded-lg bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent hover:text-white"
                        >
                          تمّت الزيارة
                        </button>
                      )}
                      {(a.status === 'scheduled' || a.status === 'confirmed') && (
                        <button
                          onClick={() => startEditAppointment(a)}
                          className="flex items-center gap-1 text-xs text-accent hover:underline"
                        >
                          <FontAwesomeIcon icon={faPen} />
                          تعديل
                        </button>
                      )}
                      <button
                        onClick={() => deleteAppointment(a.id)}
                        className="flex items-center gap-1 text-xs text-danger hover:underline"
                      >
                        <FontAwesomeIcon icon={faTrash} />
                        حذف
                      </button>
                    </div>
                  </div>

                  {editingAppointmentId === a.id && (
                    <div className="mt-2 space-y-2 rounded-lg bg-background p-3">
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <DatePicker value={editForm.date} onChange={(v) => setEditForm({ ...editForm, date: v })} placeholder="التاريخ" />
                        </div>
                        <input
                          type="time"
                          value={editForm.time}
                          onChange={(e) => setEditForm({ ...editForm, time: e.target.value })}
                          className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
                        />
                      </div>
                      <select
                        value={editForm.doctor_id}
                        onChange={(e) => setEditForm({ ...editForm, doctor_id: e.target.value })}
                        className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
                      >
                        <option value="">بدون طبيب محدد</option>
                        {doctors.map((d) => (
                          <option key={d.id} value={d.id}>{d.full_name}</option>
                        ))}
                      </select>
                      {editError && <p className="text-xs text-danger">{editError}</p>}
                      <div className="flex gap-2">
                        <Button onClick={saveEditAppointment} disabled={savingEdit} className="flex-1 justify-center px-3 py-1.5 text-xs">
                          {savingEdit ? 'جارِ الحفظ...' : 'حفظ الموعد الجديد'}
                        </Button>
                        <button onClick={() => setEditingAppointmentId(null)} className="rounded-xl px-3 py-1.5 text-xs text-muted hover:bg-background">
                          إلغاء
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
            ),
          },
          {
            key: 'notes',
            label: 'الملاحظات والمرفقات',
            content: (
              <div className="grid grid-cols-2 gap-6">
        <Card className="p-6">
          <h2 className="mb-3 text-sm font-medium text-ink/70">الملاحظات</h2>
          <div className="mb-3 flex gap-2">
            <input
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              placeholder="أضف ملاحظة..."
              className="flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
            />
            <Button onClick={addNote} className="px-3 py-1.5">
              إضافة
            </Button>
          </div>
          {notes.length === 0 ? (
            <p className="text-sm text-muted">لا توجد ملاحظات.</p>
          ) : (
            <ul className="space-y-2">
              {notes.map((n) => (
                <li key={n.id} className="border-b border-border/70 pb-2 text-sm last:border-0">
                  {editingNoteId === n.id ? (
                    <div className="flex gap-2">
                      <input
                        value={editingNoteBody}
                        onChange={(e) => setEditingNoteBody(e.target.value)}
                        className="flex-1 rounded-lg border border-border bg-surface px-2 py-1 text-sm focus:border-accent focus:outline-none"
                      />
                      <button onClick={saveNoteEdit} className="text-xs text-accent hover:underline">حفظ</button>
                      <button onClick={() => setEditingNoteId(null)} className="text-xs text-muted hover:underline">إلغاء</button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-ink">{n.body}</p>
                        <div className="flex shrink-0 gap-2">
                          <button onClick={() => { setEditingNoteId(n.id); setEditingNoteBody(n.body) }} className="text-muted hover:text-accent">
                            <FontAwesomeIcon icon={faPen} />
                          </button>
                          <button onClick={() => deleteNote(n.id)} className="text-muted hover:text-danger">
                            <FontAwesomeIcon icon={faTrash} />
                          </button>
                        </div>
                      </div>
                      <p className="text-xs text-muted">
                        {n.author} · {n.created_at}
                      </p>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-ink/70">
              <FontAwesomeIcon icon={faPaperclip} className="ml-2 text-muted" />
              المرفقات
            </h2>
            <Button
              onClick={() => attachmentInputRef.current?.click()}
              loading={uploadingAttachment}
              className="px-3 py-1.5"
            >
              <FontAwesomeIcon icon={faUpload} />
              رفع من الكمبيوتر
            </Button>
            <input
              ref={attachmentInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) uploadAttachment(file)
              }}
            />
          </div>
          {attachmentError && <p className="mb-3 text-sm text-danger">{attachmentError}</p>}
          {attachments.length === 0 ? (
            <p className="text-sm text-muted">لا توجد مرفقات (أشعة، صور، تقارير...).</p>
          ) : (
            <ul className="space-y-2">
              {attachments.map((a) => (
                <li key={a.id} className="flex items-center justify-between border-b border-border/70 pb-2 text-sm last:border-0">
                  <div>
                    <a href={a.download_url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                      {a.original_name}
                    </a>
                    <p className="text-xs text-muted">
                      {formatFileSize(a.size_bytes)} · {a.uploaded_by ?? '—'} · {a.created_at}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <a href={a.download_url} target="_blank" rel="noreferrer" className="text-muted hover:text-accent">
                      <FontAwesomeIcon icon={faDownload} />
                    </a>
                    <button onClick={() => deleteAttachment(a.id)} className="text-danger hover:underline">
                      <FontAwesomeIcon icon={faTrash} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
              </div>
            ),
          },
        ]}
      />

      {completingVisit && (
        <CompleteVisitModal
          appointmentId={completingVisit.id}
          patientId={patient.id}
          patientName={patient.full_name}
          doctorId={completingVisit.doctorId}
          onClose={() => setCompletingVisit(null)}
          onDone={load}
        />
      )}
      {openAppointmentId && (
        <AppointmentDetailModal
          appointmentId={openAppointmentId}
          onClose={() => setOpenAppointmentId(null)}
          onChanged={load}
        />
      )}
    </div>
  )
}
