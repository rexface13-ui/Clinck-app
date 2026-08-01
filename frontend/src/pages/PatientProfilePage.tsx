import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams, Link, useNavigate } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowRight,
  faCalendarPlus,
  faTriangleExclamation,
  faPen,
  faTrash,
  faPaperclip,
  faDownload,
  faUpload,
  faNoteSticky,
} from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import ToothChart from '../components/ToothChart'
import ToothNotesModal from '../components/ToothNotesModal'
import WorkPlanningPanel from '../components/WorkPlanningPanel'
import PatientLedgerPanel from '../components/PatientLedgerPanel'
import VisitHistoryPanel from '../components/VisitHistoryPanel'
import DatePicker from '../components/DatePicker'
import AppointmentDetailModal from '../components/AppointmentDetailModal'
import MedicalHistoryField from '../components/MedicalHistoryField'
import { Card, Badge, Button, Tabs, Modal, Input } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import type { PatientProfile, Service, Ledger, Doctor } from '../types'

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
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
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
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') === 'work' ? 'work' : 'overview')
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [editingAppointmentId, setEditingAppointmentId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState({ date: '', time: '', doctor_id: '' })
  const [editError, setEditError] = useState<string | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [openAppointmentId, setOpenAppointmentId] = useState<number | null>(null)
  const [refreshSignal, setRefreshSignal] = useState(0)
  const [editingPatient, setEditingPatient] = useState(false)
  const [patientForm, setPatientForm] = useState({
    full_name: '',
    phone: '',
    guardian_name: '',
    guardian_phone: '',
    medical_alerts: [] as string[],
    medical_notes: '',
  })
  const [savingPatient, setSavingPatient] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deletingPatient, setDeletingPatient] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  /** Teeth selected from the overview chart's "بدء العمل" button — seeds WorkPlanningPanel's own selection once it mounts on the work tab, so the patient doesn't have to re-pick the same teeth twice. */
  const [pendingWorkTeeth, setPendingWorkTeeth] = useState<number[]>([])
  const [notesModalTooth, setNotesModalTooth] = useState<number | null>(null)

  function goToWorkTab() {
    setActiveTab('work')
    requestAnimationFrame(() => tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  function startWorkOnTeeth(toothNumbers: number[]) {
    setPendingWorkTeeth(toothNumbers)
    goToWorkTab()
  }

  function load() {
    api.get(`/patients/${id}/profile`).then((res) => setProfile(res.data))
    if (canViewBilling) {
      api.get(`/patients/${id}/ledger`).then((res) => setLedger(res.data))
    }
    setRefreshSignal((n) => n + 1)
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

  async function deleteAppointment(appointmentId: number) {
    if (!window.confirm('حذف الموعد نهائياً؟ لو كان مرتبط بجلسة من خطة علاج بترجع الجلسة "بانتظار الجدولة"، ولو كان موعد "زيارة الآن" بتتلغى خطته وفاتورته وديونه تلقائياً معه.')) return
    await api.delete(`/appointments/${appointmentId}`)
    load()
  }

  function openEditPatient() {
    if (!profile) return
    const p = profile.patient
    setPatientForm({
      full_name: p.full_name,
      phone: p.phone ?? '',
      guardian_name: p.guardian_name ?? '',
      guardian_phone: p.guardian_phone ?? '',
      medical_alerts: p.medical_alerts,
      medical_notes: p.medical_notes ?? '',
    })
    setEditingPatient(true)
  }

  async function savePatient() {
    setSavingPatient(true)
    try {
      await api.put(`/patients/${id}`, {
        full_name: patientForm.full_name,
        phone: patientForm.phone || null,
        guardian_name: patientForm.guardian_name || null,
        guardian_phone: patientForm.guardian_phone || null,
        medical_alerts: patientForm.medical_alerts,
        medical_notes: patientForm.medical_notes || null,
      })
      setEditingPatient(false)
      load()
    } finally {
      setSavingPatient(false)
    }
  }

  async function forceDeletePatient() {
    if (!profile) return
    setDeletingPatient(true)
    setDeleteError(null)
    try {
      await api.delete(`/patients/${id}/force-delete`, { data: { confirm: deleteConfirmText } })
      navigate('/patients')
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      setDeleteError(message ?? 'تعذّر الحذف.')
    } finally {
      setDeletingPatient(false)
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
  const generalNotes = notes.filter((n) => n.tooth_number === null)
  const toothNotesByTooth = new Map<number, typeof notes>()
  for (const n of notes) {
    if (n.tooth_number === null) continue
    const list = toothNotesByTooth.get(n.tooth_number) ?? []
    list.push(n)
    toothNotesByTooth.set(n.tooth_number, list)
  }
  const toothNoteNumbers = Array.from(toothNotesByTooth.keys()).sort((a, b) => a - b)
  const todayAppointment = appointments.find((a) => isToday(a.starts_at) && (a.status === 'scheduled' || a.status === 'confirmed'))
  const hasDebt = !!ledger && ledger.outstanding_ils > 0
  const nextAppointment = appointments
    .filter((a) => (a.status === 'scheduled' || a.status === 'confirmed') && new Date(a.starts_at).getTime() >= Date.now())
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())[0]
  const lastDoneAppointment = appointments
    .filter((a) => a.status === 'done')
    .sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime())[0]

  return (
    <div>
      <Link to="/patients" className="mb-4 flex w-fit items-center gap-2 text-sm text-muted hover:text-ink">
        <FontAwesomeIcon icon={faArrowRight} />
        العودة للمرضى
      </Link>

      {patient.medical_alerts.length > 0 && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <FontAwesomeIcon icon={faTriangleExclamation} className="mt-0.5" />
          <div>
            <span className="font-semibold">تنبيه طبي: </span>
            <span>{patient.medical_alerts.join('، ')}</span>
            {patient.medical_notes && <p className="mt-1 text-danger/80">{patient.medical_notes}</p>}
          </div>
        </div>
      )}

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
            {patient.age !== null && <span>· {patient.age} سنة</span>}
            {patient.is_child && <Badge variant="accent">طفل</Badge>}
            {patient.phone && <span>· {patient.phone}</span>}
            {patient.telegram_linked && (
              <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs text-success">مربوط بتيليغرام</span>
            )}
          </div>
          {patient.guardian_name && (
            <p className="mt-1 text-sm text-muted">ولي الأمر: {patient.guardian_name} ({patient.guardian_phone})</p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={openEditPatient}
            title="تعديل معلومات المريض"
            className="flex items-center gap-2 rounded-xl border border-ink/10 px-3 py-2 text-sm text-ink/70 hover:bg-background"
          >
            <FontAwesomeIcon icon={faPen} />
            تعديل
          </button>
          <Link to={`/appointments?patient_id=${patient.id}`}>
            <Button>
              <FontAwesomeIcon icon={faCalendarPlus} />
              حجز موعد
            </Button>
          </Link>
        </div>
      </Card>

      <div ref={tabsRef}>
      <Tabs
        active={activeTab}
        onActiveChange={setActiveTab}
        tabs={[
          {
            key: 'overview',
            label: 'نظرة عامة',
            content: (
              <div className="grid grid-cols-[minmax(220px,1fr)_minmax(260px,1.4fr)] gap-6">
                <div className="space-y-4">
                  <Card className="p-5">
                    <h2 className="mb-3 text-sm font-medium text-ink/70">معلومات المريض</h2>
                    <dl className="space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <dt className="text-muted">الكود</dt>
                        <dd className="text-ink">{patient.code}</dd>
                      </div>
                      <div className="flex items-center justify-between">
                        <dt className="text-muted">الجنس</dt>
                        <dd className="text-ink">{patient.gender === 'male' ? 'ذكر' : 'أنثى'}{patient.is_child && <Badge variant="accent">طفل</Badge>}</dd>
                      </div>
                      {patient.age !== null && (
                        <div className="flex items-center justify-between">
                          <dt className="text-muted">العمر</dt>
                          <dd className="text-ink">{patient.age} سنة</dd>
                        </div>
                      )}
                      {patient.phone && (
                        <div className="flex items-center justify-between">
                          <dt className="text-muted">الهاتف</dt>
                          <dd className="text-ink">{patient.phone}</dd>
                        </div>
                      )}
                      {patient.guardian_name && (
                        <div className="flex items-center justify-between">
                          <dt className="text-muted">ولي الأمر</dt>
                          <dd className="text-ink">{patient.guardian_name}{patient.guardian_phone ? ` (${patient.guardian_phone})` : ''}</dd>
                        </div>
                      )}
                    </dl>
                  </Card>

                  <Card className="space-y-2 p-5">
                    <h2 className="mb-1 text-sm font-medium text-ink/70">لمحة سريعة</h2>
                    {canViewBilling && ledger && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted">الرصيد المستحق</span>
                        <span className={`font-semibold ${ledger.outstanding_ils > 0 ? 'text-danger' : 'text-success'}`}>
                          {ledger.outstanding_ils.toFixed(2)} ₪
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted">الموعد القادم</span>
                      <span className="text-ink">{nextAppointment ? nextAppointment.starts_at_display : '—'}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted">آخر زيارة</span>
                      <span className="text-ink">{lastDoneAppointment ? lastDoneAppointment.starts_at_display : '—'}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted">الملاحظات</span>
                      <span className="text-ink">{notes.length}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted">المرفقات</span>
                      <span className="text-ink">{attachments.length}</span>
                    </div>
                  </Card>
                </div>

                <div>
                  <h2 className="mb-3 text-sm font-medium text-ink/70">رسمة الأسنان — اضغط سن لتشوف سجل الشغل عليه</h2>
                  <ToothChart
                    patientId={patient.id}
                    isChild={patient.is_child}
                    toothStates={tooth_states}
                    toothFindings={tooth_findings}
                    services={services}
                    doctors={doctors}
                    onChanged={load}
                    notes={notes}
                    onStartWork={startWorkOnTeeth}
                  />
                </div>
              </div>
            ),
          },
          {
            key: 'work',
            label: 'تخطيط العمل',
            content: (
              <WorkPlanningPanel
                patientId={patient.id}
                patientName={patient.full_name}
                isChild={patient.is_child}
                medicalAlerts={patient.medical_alerts}
                onChanged={load}
                appointmentId={todayAppointment?.id}
                defaultDoctorId={todayAppointment?.doctor_id}
                toothStates={tooth_states}
                toothFindings={tooth_findings}
                initialSelectedTeeth={pendingWorkTeeth}
                onInitialSelectionConsumed={() => setPendingWorkTeeth([])}
                notes={notes}
              />
            ),
          },
          {
            key: 'visits',
            label: 'سجل الجلسات',
            content: (
              <VisitHistoryPanel
                patientId={patient.id}
                patientName={patient.full_name}
                isChild={patient.is_child}
                medicalAlerts={patient.medical_alerts}
                onChanged={load}
                notes={notes}
              />
            ),
          },
          ...(canViewBilling
            ? [
                {
                  key: 'ledger',
                  label: 'الحساب',
                  content: <PatientLedgerPanel patientId={patient.id} refreshSignal={refreshSignal} />,
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
                          onClick={() => setActiveTab('work')}
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
          {generalNotes.length === 0 ? (
            <p className="text-sm text-muted">لا توجد ملاحظات عامة.</p>
          ) : (
            <ul className="space-y-2">
              {generalNotes.map((n) => (
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

        <Card className="col-span-2 p-6">
          <h2 className="mb-3 text-sm font-medium text-ink/70">
            <FontAwesomeIcon icon={faNoteSticky} className="ml-2 text-muted" />
            دفتر ملاحظات الأسنان — كل الملاحظات المكتوبة لأي سن لهذا المريض، من أي مكان بالنظام
          </h2>
          {toothNoteNumbers.length === 0 ? (
            <p className="text-sm text-muted">ما في ملاحظات مكتوبة لأي سن بعد.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              {toothNoteNumbers.map((toothNumber) => {
                const list = toothNotesByTooth.get(toothNumber)!.slice().sort((a, b) => b.id - a.id)
                return (
                  <button
                    key={toothNumber}
                    onClick={() => setNotesModalTooth(toothNumber)}
                    className="rounded-lg border border-ink/10 p-3 text-start hover:border-accent hover:bg-accent-soft/30"
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-sm font-medium text-ink">السن {toothNumber}</span>
                      <span className="rounded-full bg-accent-soft px-1.5 text-[11px] text-accent">{list.length}</span>
                    </div>
                    <p className="truncate text-xs text-muted">{list[0].body}</p>
                  </button>
                )
              })}
            </div>
          )}
        </Card>
              </div>
            ),
          },
        ]}
      />
      </div>

      {notesModalTooth !== null && (
        <ToothNotesModal
          patientId={patient.id}
          toothNumber={notesModalTooth}
          notes={notes}
          onClose={() => setNotesModalTooth(null)}
          onChanged={load}
        />
      )}

      {openAppointmentId && (
        <AppointmentDetailModal
          appointmentId={openAppointmentId}
          onClose={() => setOpenAppointmentId(null)}
          onChanged={load}
        />
      )}
      {editingPatient && (
        <Modal title="تعديل معلومات المريض" onClose={() => setEditingPatient(false)} width="w-[560px]">
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="الاسم الكامل"
              value={patientForm.full_name}
              onChange={(e) => setPatientForm({ ...patientForm, full_name: e.target.value })}
            />
            <Input
              label="الهاتف"
              value={patientForm.phone}
              onChange={(e) => setPatientForm({ ...patientForm, phone: e.target.value })}
            />
            <Input
              label="اسم ولي الأمر (اختياري)"
              value={patientForm.guardian_name}
              onChange={(e) => setPatientForm({ ...patientForm, guardian_name: e.target.value })}
            />
            <Input
              label="هاتف ولي الأمر"
              value={patientForm.guardian_phone}
              onChange={(e) => setPatientForm({ ...patientForm, guardian_phone: e.target.value })}
            />
            <MedicalHistoryField
              alerts={patientForm.medical_alerts}
              onAlertsChange={(medical_alerts) => setPatientForm({ ...patientForm, medical_alerts })}
              notes={patientForm.medical_notes}
              onNotesChange={(medical_notes) => setPatientForm({ ...patientForm, medical_notes })}
            />
            <div className="col-span-2 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setEditingPatient(false)}>
                إلغاء
              </Button>
              <Button onClick={savePatient} loading={savingPatient}>
                {savingPatient ? 'جارِ الحفظ...' : 'حفظ'}
              </Button>
            </div>

            {can('patients.manage') && (
              <div className="col-span-2 mt-2 rounded-xl border border-danger/30 bg-danger-soft/40 p-4">
                <p className="mb-2 text-sm font-semibold text-danger">منطقة خطر — حذف نهائي</p>
                <p className="mb-3 text-xs text-danger/80">
                  بيحذف المريض وكل شي مرتبط فيه نهائياً (مواعيد، شغل، فواتير، دفعات، حساب، ملاحظات، مرفقات) — ما فيه رجوع.
                  للتأكيد، اكتب اسم المريض بالضبط: <span className="font-semibold">{patient.full_name}</span>
                </p>
                <div className="flex gap-2">
                  <input
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    placeholder={patient.full_name}
                    className="flex-1 rounded-lg border border-danger/30 bg-surface px-2 py-1.5 text-sm focus:border-danger focus:outline-none"
                  />
                  <Button
                    variant="danger"
                    onClick={forceDeletePatient}
                    loading={deletingPatient}
                    disabled={deleteConfirmText !== patient.full_name || deletingPatient}
                  >
                    حذف نهائي
                  </Button>
                </div>
                {deleteError && <p className="mt-2 text-xs text-danger">{deleteError}</p>}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
