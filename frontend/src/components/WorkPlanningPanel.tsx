import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCheck,
  faCheckDouble,
  faPlus,
  faTrash,
  faCalendarPlus,
  faCopy,
  faObjectGroup,
  faTriangleExclamation,
  faNoteSticky,
  faPen,
} from '@fortawesome/free-solid-svg-icons'
import { Odontogram } from 'react-odontogram'
import 'react-odontogram/style.css'
import { api } from '../lib/api'
import DatePicker from './DatePicker'
import ToothNotesModal from './ToothNotesModal'
import ReceiveCheckModal from './ReceiveCheckModal'
import { Card, Button, Select, SearchableSelect, Badge } from './ui'
import type { BadgeVariant } from './ui'
import Modal from './ui/Modal'
import {
  OdontogramBridgeOverlay,
  OdontogramClickOverlay,
  OdontogramNumberOverlay,
  OdontogramSelectionOverlay,
  useOdontogramGeometry,
} from './OdontogramNumbers'
import {
  DEFAULT_TOOTH_FILL,
  LOWER_PERMANENT,
  LOWER_PRIMARY,
  STATUS_COLOR,
  UPPER_PERMANENT,
  UPPER_PRIMARY,
  fadeHex,
  toLibraryToothId,
} from '../lib/dental'
import type { Cashbox, Doctor, Note, Service, ToothFinding, ToothState, WorkItem } from '../types'

/** Same phantom-slot muting as ToothChart.tsx — see its comment for why. */
const CHILD_PHANTOM_LIBRARY_IDS = [16, 17, 18, 26, 27, 28, 36, 37, 38, 46, 47, 48].map((n) => `teeth-${n}`)

function money(n: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n)
}

const STATUS_LABELS: Record<WorkItem['status'], string> = { in_progress: 'قيد التنفيذ', done: 'مكتمل', cancelled: 'ملغي' }
const STATUS_VARIANTS: Record<WorkItem['status'], BadgeVariant> = { in_progress: 'warning', done: 'success', cancelled: 'neutral' }

/**
 * While editing one specific session, its picker/details card pops up as a
 * focused modal instead of sitting inline under the always-visible "كل
 * الشغل الحالي" list — otherwise the list of every open session stays on
 * screen alongside the one being edited, which reads as "everything mixed
 * together" instead of "just this session's details". Starting a brand-new
 * work item keeps the old inline placement (nothing to disambiguate from yet).
 */
function PickerWrapper({
  editing,
  onClose,
  title,
  sectionRef,
  children,
}: {
  editing: boolean
  onClose: () => void
  title: string
  sectionRef: RefObject<HTMLDivElement | null>
  children: ReactNode
}) {
  if (editing) {
    return (
      <Modal title={title} onClose={onClose} width="w-full max-w-3xl">
        {children}
      </Modal>
    )
  }
  return <div ref={sectionRef}>{children}</div>
}

export default function WorkPlanningPanel({
  patientId,
  isChild,
  medicalAlerts = [],
  onChanged,
  appointmentId,
  defaultDoctorId,
  toothStates = [],
  toothFindings = [],
  initialSelectedTeeth = [],
  onInitialSelectionConsumed,
  notes = [],
  focusWorkItemId,
  onFocusConsumed,
}: {
  patientId: number
  patientName: string
  isChild: boolean
  medicalAlerts?: string[]
  onChanged?: () => void
  /** Today's already-booked appointment this session belongs to, if any — when absent (walk-in with no booking), checkout asks for a visit duration and books one on the fly. */
  appointmentId?: number
  /** Doctor the appointment was booked with, if any — pre-fills the supervising-doctor field so a scheduled, arrived patient doesn't need it re-picked, but it stays editable. */
  defaultDoctorId?: number | null
  /** Same chart data as the overview tab — shown on the tooth-picker here too so existing work/findings are visible while selecting teeth, not just today's in-progress items. */
  toothStates?: ToothState[]
  toothFindings?: ToothFinding[]
  /** Teeth pre-selected from the overview chart's "بدء العمل" button — seeded into the tooth-picker once, then cleared via onInitialSelectionConsumed so re-renders don't keep overwriting the user's own subsequent clicks. */
  initialSelectedTeeth?: number[]
  onInitialSelectionConsumed?: () => void
  /** Same patient notes list the overview tab's notebook button uses — surfaced here too so a note can be added mid-work without switching tabs. */
  notes?: Note[]
  /** An existing work item to jump straight into edit mode for — from the overview chart's "شغل حالي" callout, so the user lands here with that item's teeth already loaded instead of having to find it in the list. Cleared via onFocusConsumed once handled. */
  focusWorkItemId?: number | null
  onFocusConsumed?: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const toothNumbers = isChild ? [...UPPER_PRIMARY, ...LOWER_PRIMARY] : [...UPPER_PERMANENT, ...LOWER_PERMANENT]
  const toLibraryId = isChild ? toLibraryToothId : (n: number) => `teeth-${n}`
  // Odontogram manages its own selection internally after mount — the only
  // way to push OUR selection changes back into it is to force a remount
  // with a fresh `defaultSelected` (see ToothChart.tsx for the same pattern).
  const [chartKey, setChartKey] = useState(0)
  function setSelection(next: number[] | ((prev: number[]) => number[])) {
    setSelectedTeeth((prev) => {
      const value = typeof next === 'function' ? next(prev) : next
      setChartKey((k) => k + 1)
      return value
    })
  }
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([])
  const [doctorId, setDoctorId] = useState(defaultDoctorId ? String(defaultDoctorId) : '')
  const [workItems, setWorkItems] = useState<WorkItem[]>([])
  const [activeWorkItemId, setActiveWorkItemId] = useState<number | null>(null)

  const [selectedTeeth, setSelectedTeeth] = useState<number[]>([])
  /** Anchor for ctrl+click range selection — click a tooth normally, then ctrl+click another to select everything between them, no separate "range mode" toggle needed. */
  const [lastClickedTooth, setLastClickedTooth] = useState<number | null>(null)
  const [notesToothNumber, setNotesToothNumber] = useState<number | null>(null)
  const [notesWorkItemId, setNotesWorkItemId] = useState<number | null>(null)
  const [notesToothStepId, setNotesToothStepId] = useState<number | null>(null)
  const [newServiceId, setNewServiceId] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  /** Non-null while re-opening an existing work item for editing — the tooth-picker/service card above becomes that item's edit form instead of the "start new work" form. */
  const [editingWorkItemId, setEditingWorkItemId] = useState<number | null>(null)
  const [editingOriginalTeeth, setEditingOriginalTeeth] = useState<number[]>([])
  const [editedPrices, setEditedPrices] = useState<Record<number, string>>({})
  /** "المبلغ المحصّل" for the session being edited — starts at the item's stored value, only sent to the backend (with a cashbox+method) if it actually changed on save. */
  const [editingOriginalCollected, setEditingOriginalCollected] = useState(0)
  const [editedCollectedAmount, setEditedCollectedAmount] = useState('')
  const [editedCollectedCashboxId, setEditedCollectedCashboxId] = useState('')
  const [editedCollectedMethod, setEditedCollectedMethod] = useState<'cash' | 'card' | 'transfer'>('cash')
  const [patientOutstandingIls, setPatientOutstandingIls] = useState<number | null>(null)
  const pickerSectionRef = useRef<HTMLDivElement>(null)

  const [checkoutIds, setCheckoutIds] = useState<Set<number>>(new Set())
  const [discount, setDiscount] = useState('')
  const [priceEditMode, setPriceEditMode] = useState<'final' | 'amount' | 'percent'>('final')
  const checkoutSectionRef = useRef<HTMLDivElement>(null)
  /** Amount actually being paid today — free-typed, defaults to the full total but can be lowered to any partial amount (or 0). Whatever's left over just stays as debt on the patient's ledger, no forced pay-now/defer choice. */
  const [paidAmount, setPaidAmount] = useState('')
  const [paidAmountTouched, setPaidAmountTouched] = useState(false)
  const [cashboxId, setCashboxId] = useState('')
  const [method, setMethod] = useState<'cash' | 'card' | 'transfer' | 'check'>('cash')
  const [checkingOut, setCheckingOut] = useState(false)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [checkoutResult, setCheckoutResult] = useState<string | null>(null)
  /** A cheque isn't a cashbox movement — it opens the same "استلام شيك" form used on الشيكات right after the session's work/invoice is saved, instead of going through pay_cashbox_id/pay_method. */
  const [showCheckModal, setShowCheckModal] = useState(false)
  const [checkAmountForModal, setCheckAmountForModal] = useState(0)

  const [schedulingId, setSchedulingId] = useState<number | null>(null)
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduleTime, setScheduleTime] = useState('10:00')
  const [scheduleDurationHours, setScheduleDurationHours] = useState(0)
  const [scheduleDurationMinutes, setScheduleDurationMinutes] = useState(30)
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [scheduleSuccessId, setScheduleSuccessId] = useState<number | null>(null)
  const [pendingScheduleIds, setPendingScheduleIds] = useState<number[]>([])

  /**
   * `keepItemId` re-adds one specific work item after the reload even though
   * it isn't `in_progress` (a billed/done session opened for editing via
   * focusWorkItemId — see below) — without this, refreshing after any edit
   * to that item drops it from the list entirely, since the base query only
   * ever fetches in_progress items. That's what made the whole edit panel
   * seem to "vanish" after removing a tooth from an already-billed session.
   */
  function loadWorkItems(keepItemId?: number) {
    return api.get('/work-items', { params: { patient_id: patientId, status: 'in_progress' } }).then(async (res) => {
      let items: WorkItem[] = res.data.data
      if (keepItemId && !items.some((x) => x.id === keepItemId)) {
        try {
          const fresh = await api.get(`/work-items/${keepItemId}`)
          items = [fresh.data.data, ...items]
        } catch {
          // item was deleted/emptied out by the edit itself — fine to just drop it
        }
      }
      setWorkItems(items)
      return items
    })
  }

  useEffect(() => {
    api.get('/doctors').then((res) => setDoctors(res.data.data))
    api.get('/services').then((res) => setServices(res.data.data))
    api.get('/cashboxes').then((res) => {
      setCashboxes(res.data)
      const ils = res.data.find((c: Cashbox) => c.currency === 'ILS')
      if (ils) setCashboxId(String(ils.id))
    })
    // If this panel mounted already aiming at a specific session (opened via
    // "تعديل" from the session log / tooth chart), this call and the
    // focus-effect below both fire a fetch at nearly the same moment — this
    // one for the in_progress list, the other for that one specific item.
    // Whichever response lands LAST used to win outright (setWorkItems just
    // overwrote), so about half the time the focus-effect's merge got wiped
    // out right after landing and the edit form never had anything to show.
    // Passing the same id here keeps it in the result regardless of order.
    loadWorkItems(focusWorkItemId ?? undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId])

  useEffect(() => {
    if (initialSelectedTeeth.length === 0) return
    setSelection(initialSelectedTeeth)
    onInitialSelectionConsumed?.()
    // "بدء العمل" from the chart switches to this tab, but the picker (where
    // the service/doctor actually get filled in) sits BELOW the "كل الشغل
    // الحالي" list in this tab's own layout — landing at the top of the tab
    // still leaves it out of view. Scroll straight to the picker itself.
    requestAnimationFrame(() => pickerSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSelectedTeeth])

  useEffect(() => {
    if (!focusWorkItemId) return
    const w = workItems.find((wi) => wi.id === focusWorkItemId)
    if (w) {
      startEditWorkItem(w)
      onFocusConsumed?.()
      return
    }
    // loadWorkItems() only fetches in_progress items — an already checked-out
    // (billed) session's work item is status 'done' and never shows up there,
    // so a session opened from its invoice/session-log entry needs its own
    // fetch here, then gets merged into the list so the edit UI below (which
    // only renders for items present in `workItems`) actually has it to show.
    api.get(`/work-items/${focusWorkItemId}`).then((res) => {
      const item: WorkItem = res.data.data
      setWorkItems((prev) => (prev.some((x) => x.id === item.id) ? prev : [item, ...prev]))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusWorkItemId, workItems])

  const selectedService = services.find((s) => String(s.id) === newServiceId)

  /** A missing/extracted tooth can't be selected for a normal service — only for a service explicitly flagged as working on missing teeth (implants and the like). */
  function toothBlocked(number: number): boolean {
    return stateByTooth.get(number) === 'missing' && !selectedService?.allows_missing_teeth
  }

  /**
   * A tooth marked missing (usually from a prior extraction) isn't a dead
   * end anymore — picking it for a service that doesn't work on missing
   * teeth (an implant, say) just asks to confirm first, then un-marks it
   * (deletes the missing flag on its extraction finding) so it goes back to
   * "present" and normal work can proceed on it, e.g. planning an implant
   * where a tooth used to be.
   */
  async function confirmAndRestoreTooth(number: number): Promise<boolean> {
    if (!window.confirm(`السن ${number} مسجّل مخلوع (مفقود). متأكد إنك بدك تبدأ عليه شغل جديد؟ (رح يرجع "موجود" تلقائياً)`)) {
      return false
    }
    const extractionFinding = toothFindings.find((f) => f.tooth_number === number && f.marks_missing)
    if (extractionFinding) {
      await api.patch(`/patients/${patientId}/chart/findings/${extractionFinding.id}`, { marks_missing: false })
      onChanged?.()
    }
    return true
  }

  function toggleTooth(number: number, event?: { ctrlKey?: boolean; metaKey?: boolean }) {
    if ((event?.ctrlKey || event?.metaKey) && lastClickedTooth !== null) {
      const startIdx = toothNumbers.indexOf(lastClickedTooth)
      const endIdx = toothNumbers.indexOf(number)
      const [lo, hi] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx]
      const rangeNumbers = toothNumbers.slice(lo, hi + 1).filter((n) => !toothBlocked(n))
      setSelection((prev) => Array.from(new Set([...prev, ...rangeNumbers])))
      setLastClickedTooth(number)
      return
    }
    setLastClickedTooth(number)
    if (!selectedTeeth.includes(number) && toothBlocked(number) && stateByTooth.get(number) === 'missing') {
      confirmAndRestoreTooth(number).then((ok) => {
        if (ok) setSelection((prev) => (prev.includes(number) ? prev : [...prev, number]))
      })
      return
    }
    setSelection((prev) => {
      if (prev.includes(number)) return prev.filter((n) => n !== number)
      if (toothBlocked(number)) return prev
      return [...prev, number]
    })
  }

  /** Switching to a service that doesn't work on missing teeth drops any already-selected missing tooth from the pending selection. */
  function selectService(serviceId: string) {
    setNewServiceId(serviceId)
    const service = services.find((s) => String(s.id) === serviceId)
    if (!service?.allows_missing_teeth) {
      setSelection((prev) => prev.filter((n) => stateByTooth.get(n) !== 'missing'))
    }
  }

  async function createWorkItem() {
    if (!doctorId || !newServiceId || selectedTeeth.length === 0) {
      setCreateError('لازم تختار الطبيب، الخدمة، وسن واحد عالأقل.')
      return
    }
    let teeth = selectedTeeth
    // Teeth selected before a service was picked (e.g. from the chart's
    // "بدء العمل") skip toggleTooth's own missing-tooth confirmation — catch
    // it here instead of silently dropping them once the service turns out
    // not to allow missing teeth.
    if (!selectedService?.allows_missing_teeth) {
      const missingSelected = selectedTeeth.filter((n) => stateByTooth.get(n) === 'missing')
      for (const n of missingSelected) {
        const ok = await confirmAndRestoreTooth(n)
        if (!ok) teeth = teeth.filter((t) => t !== n)
      }
    }
    if (teeth.length === 0) {
      setCreateError('كل الأسنان المحددة مفقودة، وهاي الخدمة ما بتسمح تشتغل عليها.')
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      const res = await api.post('/work-items', {
        patient_id: patientId,
        doctor_id: Number(doctorId),
        service_id: Number(newServiceId),
        tooth_numbers: teeth,
      })
      setSelection([])
      setNewServiceId('')
      loadWorkItems()
      setActiveWorkItemId(res.data.data.id)
    } catch {
      setCreateError('صار خطأ أثناء بدء الشغل.')
    } finally {
      setCreating(false)
    }
  }

  /**
   * Checks whether any of `teeth` already has work under the same service
   * elsewhere for this patient — a different in-progress work item that
   * already covers the tooth, or a chart finding already marked 'done' —
   * before letting it get added here too (accidental duplicate work/billing).
   * Returns human-readable warning lines, empty if nothing conflicts.
   */
  function findDuplicates(teeth: number[], serviceId: number, excludeWorkItemId: number | null): string[] {
    const warnings: string[] = []
    for (const tooth of teeth) {
      const otherItem = workItems.find(
        (w) => w.id !== excludeWorkItemId && w.service_id === serviceId && w.teeth.includes(tooth),
      )
      if (otherItem) {
        warnings.push(`سن ${tooth} أصلاً ضمن شغلة تانية قيد التنفيذ لنفس الخدمة.`)
        continue
      }
      const doneFinding = toothFindings.find((f) => f.tooth_number === tooth && f.service_id === serviceId && f.status === 'done')
      if (doneFinding) {
        warnings.push(`سن ${tooth} أصلاً منجز بنفس الخدمة من قبل.`)
      }
    }
    return warnings
  }

  function startEditWorkItem(w: WorkItem) {
    setEditingWorkItemId(w.id)
    setEditingOriginalTeeth(w.teeth)
    setSelection(w.teeth)
    setNewServiceId(String(w.service_id ?? ''))
    if (w.doctor_id) setDoctorId(String(w.doctor_id))
    setEditedPrices(Object.fromEntries(w.steps.map((s) => [s.id, s.price])))
    setEditingOriginalCollected(w.collected_amount_ils ?? 0)
    setEditedCollectedAmount(String(w.collected_amount_ils ?? 0))
    setEditedCollectedCashboxId('')
    setEditedCollectedMethod('cash')
    setActiveWorkItemId(w.id)
    setCreateError(null)
    api.get(`/patients/${patientId}/ledger`).then((res) => setPatientOutstandingIls(res.data.outstanding_ils)).catch(() => {})
    requestAnimationFrame(() => pickerSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
  }

  function cancelEditWorkItem() {
    setEditingWorkItemId(null)
    setEditingOriginalTeeth([])
    setEditedPrices({})
    setEditingOriginalCollected(0)
    setEditedCollectedAmount('')
    setEditedCollectedCashboxId('')
    setPatientOutstandingIls(null)
    setSelection([])
    setNewServiceId('')
    setCreateError(null)
  }

  async function saveWorkItemEdits(w: WorkItem) {
    if (!w.service_id) return
    const addedTeeth = selectedTeeth.filter((n) => !editingOriginalTeeth.includes(n))
    const removedTeeth = editingOriginalTeeth.filter((n) => !selectedTeeth.includes(n))

    if (selectedTeeth.length === 0) {
      setCreateError('لازم يضل سن واحد عالأقل بالشغلة.')
      return
    }

    if (addedTeeth.length > 0) {
      const warnings = findDuplicates(addedTeeth, w.service_id, w.id)
      if (warnings.length > 0 && !window.confirm(`${warnings.join('\n')}\nمتأكد إنك بدك تضيفها هون كمان؟`)) {
        return
      }
    }

    const newCollected = Math.max(0, Number(editedCollectedAmount) || 0)
    const collectedChanged = newCollected !== editingOriginalCollected
    if (collectedChanged && !editedCollectedCashboxId) {
      setCreateError('اختر الصندوق عشان تعدّل المبلغ المحصّل.')
      return
    }

    setCreating(true)
    setCreateError(null)
    try {
      if (addedTeeth.length > 0) {
        await api.post(`/work-items/${w.id}/teeth`, { tooth_numbers: addedTeeth })
      }
      for (const tooth of removedTeeth) {
        await api.delete(`/work-items/${w.id}/teeth/${tooth}`)
      }
      for (const step of w.steps) {
        const edited = editedPrices[step.id]
        if (edited !== undefined && Number(edited) !== Number(step.price)) {
          await api.patch(`/work-items/${w.id}/steps/${step.id}`, { price: Number(edited) })
        }
      }
      if (collectedChanged) {
        await api.patch(`/work-items/${w.id}/collected-amount`, {
          amount: newCollected,
          cashbox_id: editedCollectedCashboxId ? Number(editedCollectedCashboxId) : null,
          method: editedCollectedMethod,
        })
      }
      cancelEditWorkItem()
      loadWorkItems(w.id)
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      setCreateError(message ?? 'صار خطأ أثناء حفظ التعديلات.')
    } finally {
      setCreating(false)
    }
  }

  async function toggleToothStep(workItem: WorkItem, toothStepId: number, completed: boolean) {
    if (!completed) {
      const step = workItem.steps.find((s) => s.tooth_steps.some((ts) => ts.id === toothStepId))
      const toothStep = step?.tooth_steps.find((ts) => ts.id === toothStepId)
      if (toothStep?.invoiced) {
        const when = toothStep.completed_at ? ` بتاريخ ${toothStep.completed_at}` : ''
        const priceNote = workItem.price_per_tooth && step ? ` وسعره (${step.price} ₪) رح يرجع كخصم على حساب المريض.` : ''
        if (!window.confirm(`هالخطوة كانت منجزة ومحسوبة من جلسة سابقة${when}. متأكد إنك بدك تلغيها؟${priceNote}`)) return
      }
    }
    try {
      await api.patch(`/work-items/${workItem.id}/tooth-steps/${toothStepId}`, { completed })
      loadWorkItems(workItem.id)
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      window.alert(message ?? 'صار خطأ أثناء الإلغاء.')
    }
  }

  async function saveField(workItem: WorkItem, toothStepId: number, fieldLabel: string, value: string, currentValues: Record<string, string>) {
    await api.patch(`/work-items/${workItem.id}/tooth-steps/${toothStepId}`, {
      field_values: { ...currentValues, [fieldLabel]: value },
    })
  }

  async function applyToAll(workItem: WorkItem, sourceTooth: number) {
    await api.post(`/work-items/${workItem.id}/apply-to-all`, { tooth_number: sourceTooth })
    loadWorkItems(workItem.id)
  }

  /**
   * The step-by-step checklist (checkbox per tooth-step, price, notes,
   * apply-to-all) for one work item — shared by the plain "browse this
   * session's steps" expand-on-click AND the edit modal, so there's exactly
   * one place that renders it instead of two copies drifting apart. Price
   * only becomes an editable input while `w` is the item actively being
   * edited (editingWorkItemId === w.id); otherwise it's shown read-only.
   */
  function renderStepsEditor(w: WorkItem) {
    return (
      <div className="space-y-4">
        {w.steps.map((step) => (
          <div key={step.id} className="rounded-lg bg-background p-3">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-sm font-semibold text-ink">{step.title}</h4>
              {editingWorkItemId === w.id ? (
                <span className="flex items-center gap-1 text-xs text-muted">
                  <input
                    type="number"
                    value={editedPrices[step.id] ?? step.price}
                    onChange={(e) => setEditedPrices({ ...editedPrices, [step.id]: e.target.value })}
                    className="w-20 rounded-lg border border-border px-2 py-1 text-xs"
                  />
                  ₪ {w.price_per_tooth ? '/ سن' : 'إجمالي'}
                </span>
              ) : (
                <span className="text-xs text-muted">{step.price} ₪ {w.price_per_tooth ? '/ سن' : 'إجمالي'}</span>
              )}
            </div>
            <div className="space-y-2">
              {step.tooth_steps.map((ts) => (
                <div
                  key={ts.id}
                  className={`flex flex-wrap items-center gap-2 rounded-lg border p-2 ${
                    ts.invoiced ? 'border-ink/5 bg-background/60 opacity-70' : 'border-ink/10 bg-white'
                  }`}
                >
                  <label className="flex items-center gap-1.5 text-xs font-medium text-ink">
                    <input
                      type="checkbox"
                      checked={ts.completed}
                      onChange={(e) => toggleToothStep(w, ts.id, e.target.checked)}
                      className="size-4 accent-success"
                    />
                    سن {ts.tooth_number}
                  </label>
                  {ts.invoiced && (
                    <span className="text-[11px] text-muted">— تم إنجازه بجلسة سابقة{ts.completed_at ? ` بتاريخ ${ts.completed_at}` : ''}</span>
                  )}
                  <button
                    onClick={() => { setNotesToothNumber(ts.tooth_number); setNotesWorkItemId(w.id); setNotesToothStepId(ts.id) }}
                    title={`دفتر ملاحظات السن — خطوة ${step.title}`}
                    className="flex items-center gap-1 rounded-lg border border-accent/30 bg-accent-soft px-2 py-1 text-[11px] font-medium text-accent hover:border-accent"
                  >
                    <FontAwesomeIcon icon={faNoteSticky} />
                    {(() => {
                      const count = notes.filter((n) => n.tooth_number === ts.tooth_number && n.work_item_tooth_step_id === ts.id).length
                      return count > 0 ? `دفتر الملاحظات (${count})` : 'دفتر الملاحظات'
                    })()}
                  </button>
                  {step.fields.map((f) => (
                    <input
                      key={f.id}
                      defaultValue={ts.field_values[f.label] ?? ''}
                      onBlur={(e) => saveField(w, ts.id, f.label, e.target.value, ts.field_values)}
                      placeholder={f.label}
                      className="w-28 rounded-lg border border-border px-2 py-1 text-xs"
                    />
                  ))}
                  {w.steps.flatMap((s) => s.tooth_steps).filter((other) => other.tooth_number === ts.tooth_number && !other.completed).length > 1 && (
                    <button
                      onClick={() => completeAllStepsForTooth(w, ts.tooth_number)}
                      title="بيخلّص كل خطوات هالسن دفعة وحدة — مفيد لما تكون خلّصت الشغل عليه فعلياً وما بدك تفتش عليه بكل قسم خطوة"
                      className="flex items-center gap-1 text-[11px] text-success hover:underline"
                    >
                      <FontAwesomeIcon icon={faCheckDouble} />
                      إنهاء كل خطوات السن
                    </button>
                  )}
                  <button
                    onClick={() => applyToAll(w, ts.tooth_number)}
                    title="طبّق نفس القيم على كل الأسنان"
                    className="ms-auto flex items-center gap-1 text-[11px] text-muted hover:text-accent"
                  >
                    <FontAwesomeIcon icon={faCopy} />
                    طبّق على الكل
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }

  /**
   * A tooth's steps are scattered across the step-first list (one section
   * per step, not per tooth), so finishing e.g. a filling that has 3 steps
   * means hunting the same tooth number down in 3 different places. This
   * marks every not-yet-completed step for one tooth done in one go —
   * useful when a tooth genuinely got all its work finished today and the
   * per-step checkboxes are just friction, not a real distinction to track.
   */
  async function completeAllStepsForTooth(workItem: WorkItem, toothNumber: number) {
    const pending = workItem.steps.flatMap((s) => s.tooth_steps.filter((ts) => ts.tooth_number === toothNumber && !ts.completed))
    if (pending.length === 0) return
    await Promise.all(pending.map((ts) => api.patch(`/work-items/${workItem.id}/tooth-steps/${ts.id}`, { completed: true })))
    loadWorkItems(workItem.id)
  }

  async function cancelWorkItem(workItem: WorkItem) {
    if (!window.confirm('إلغاء هالشغل بالكامل؟ (فقط إذا ما انحسب منه شي بعد)')) return
    try {
      await api.delete(`/work-items/${workItem.id}`)
      loadWorkItems()
      if (activeWorkItemId === workItem.id) setActiveWorkItemId(null)
    } catch {
      window.alert('ما فيك تلغي شغل انحسب منه شي.')
    }
  }

  /**
   * Only counts completed-but-not-yet-invoiced tooth-steps — a multi-session
   * work item (e.g. orthodontics with many visits) keeps its already-billed
   * steps marked completed forever, so summing every completed step here
   * would re-total the whole item's history on each new session instead of
   * just what's newly done today. Mirrors the backend's own billing rule
   * (WorkItemService::billableCharges only charges pending steps).
   */
  /** What's still left to charge at the NEXT checkout — completed steps that haven't been invoiced yet. Used for the "التحصيل" section total, not for "how much was this session worth overall" (see sessionTotal). */
  function itemTotal(workItem: WorkItem): number {
    let total = 0
    for (const step of workItem.steps) {
      const billableTeeth = step.tooth_steps.filter((ts) => ts.completed && !ts.invoiced)
      if (billableTeeth.length === 0) continue
      if (workItem.price_per_tooth) {
        total += billableTeeth.length * Number(step.price)
      } else {
        total += Number(step.price)
      }
    }
    return total
  }

  /**
   * The session's actual agreed price — every completed step counts,
   * whether it was billed just now or in an earlier checkout. itemTotal()
   * only counts what's still pending, so it reads as "0" for a session
   * that's fully done and already fully invoiced, which isn't what "المبلغ
   * المتفق عليه" is asking.
   */
  function sessionTotal(workItem: WorkItem): number {
    let total = 0
    for (const step of workItem.steps) {
      const doneTeeth = step.tooth_steps.filter((ts) => ts.completed)
      if (doneTeeth.length === 0) continue
      total += workItem.price_per_tooth ? doneTeeth.length * Number(step.price) : Number(step.price)
    }
    return total
  }

  const checkoutTotal = useMemo(
    () => workItems.filter((w) => checkoutIds.has(w.id)).reduce((sum, w) => sum + itemTotal(w), 0),
    [workItems, checkoutIds],
  )
  const discountAmount = Math.max(0, Number(discount) || 0)
  const finalTotal = Math.max(0, checkoutTotal - discountAmount)
  /** Defaults to 0 (nothing collected yet) — most sessions close without an on-the-spot payment, so the common case is "leave it as debt" rather than "pay in full"; the clinic owner types in whatever was actually handed over. */
  const paidAmountValue = paidAmountTouched ? Math.max(0, Math.min(finalTotal, Number(paidAmount) || 0)) : 0
  const remainingAsDebt = Math.max(0, finalTotal - paidAmountValue)

  function toggleCheckoutId(id: number) {
    setCheckoutIds((prev) => {
      const next = new Set(prev)
      const adding = !next.has(id)
      if (adding) next.add(id)
      else next.delete(id)
      if (adding) {
        requestAnimationFrame(() => checkoutSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
        if (!doctorId) {
          const item = workItems.find((w) => w.id === id)
          if (item?.doctor_id) setDoctorId(String(item.doctor_id))
        }
      }
      return next
    })
  }

  async function submitCheckout() {
    if (checkoutIds.size === 0) {
      setCheckoutError('اختر شغل واحد عالأقل للتحصيل.')
      return
    }
    if (!doctorId) {
      setCheckoutError('اختر الطبيب.')
      return
    }
    const isCheck = method === 'check' && paidAmountValue > 0
    if (paidAmountValue > 0 && !isCheck && !cashboxId) {
      setCheckoutError('اختر الصندوق.')
      return
    }
    setCheckingOut(true)
    setCheckoutError(null)
    try {
      // A cheque isn't a cashbox movement, so it's never sent as
      // pay_cashbox_id/pay_method here — the invoice is saved unpaid and
      // ReceiveCheckModal (opened right after) is what actually settles
      // the patient's balance, same as it does from الشيكات directly.
      const checkAmount = paidAmountValue
      // No appointment_id means a walk-in with nothing booked today — the
      // backend resolves/creates a same-day appointment on its own, no
      // manual time/duration entry needed here.
      const res = await api.post('/work-items/checkout', {
        patient_id: patientId,
        work_item_ids: Array.from(checkoutIds),
        doctor_id: Number(doctorId),
        discount_amount: discountAmount,
        pay_cashbox_id: paidAmountValue > 0 && !isCheck ? Number(cashboxId) : null,
        pay_method: paidAmountValue > 0 && !isCheck ? method : null,
        pay_amount: paidAmountValue,
        appointment_id: appointmentId ?? null,
      })
      setCheckoutResult(`تمّ الحفظ — الإجمالي ${money(res.data.total_ils)} ₪`)
      const checkedOutIds = Array.from(checkoutIds)
      setCheckoutIds(new Set())
      setDiscount('')
      setPaidAmount('')
      setPaidAmountTouched(false)
      setActiveWorkItemId(null)
      const freshItems = await loadWorkItems()
      setPendingScheduleIds(freshItems.filter((w) => checkedOutIds.includes(w.id)).map((w) => w.id))
      onChanged?.()
      setTimeout(() => setCheckoutResult(null), 4000)
      if (isCheck) {
        setCheckAmountForModal(checkAmount)
        setShowCheckModal(true)
      }
    } catch (err) {
      const backendMessage = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      setCheckoutError(backendMessage ?? 'صار خطأ أثناء الحفظ.')
    } finally {
      setCheckingOut(false)
    }
  }

  async function submitSchedule(workItem: WorkItem) {
    setScheduleError(null)
    if (!scheduleDate || !scheduleTime) {
      setScheduleError('لازم تحدد التاريخ والوقت.')
      return
    }
    const durationMinutes = scheduleDurationHours * 60 + scheduleDurationMinutes
    if (durationMinutes <= 0) {
      setScheduleError('لازم تحدد مدة الموعد.')
      return
    }
    const startsAt = new Date(`${scheduleDate}T${scheduleTime}:00`)
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60000)
    try {
      await api.post(`/work-items/${workItem.id}/schedule`, { starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString() })
      setSchedulingId(null)
      setScheduleDate('')
      setScheduleSuccessId(workItem.id)
      setPendingScheduleIds((prev) => prev.filter((id) => id !== workItem.id))
      loadWorkItems()
      setTimeout(() => setScheduleSuccessId(null), 4000)
    } catch {
      setScheduleError('صار خطأ أثناء حجز الموعد.')
    }
  }

  /**
   * Per-tooth coloring for teeth already touched by today's in-progress work:
   * each tooth gets its work item's service color, faded while any step on
   * it is still incomplete and full-strength once every step on that tooth
   * is checked off — same "planned vs done" language as the overview chart.
   */
  const toothWorkColor = useMemo(() => {
    const map = new Map<number, { color: string; done: boolean }>()
    for (const w of workItems) {
      // A bridge/appliance tooth stays plain here too — the connecting
      // line is what marks it as part of the bridge, not a crown fill.
      if (!w.service_color || w.service_spans_teeth) continue
      for (const toothNumber of w.teeth) {
        const toothSteps = w.steps.flatMap((s) => s.tooth_steps.filter((ts) => ts.tooth_number === toothNumber))
        if (toothSteps.length === 0) continue
        const done = toothSteps.every((ts) => ts.completed)
        const anyDone = toothSteps.some((ts) => ts.completed)
        if (!anyDone) continue
        map.set(toothNumber, { color: w.service_color, done })
      }
    }
    return map
  }, [workItems])

  const stateByTooth = useMemo(() => {
    const map = new Map<number, string>()
    toothStates.forEach((s) => map.set(s.tooth_number, s.status))
    return map
  }, [toothStates])

  const activeFindingByTooth = useMemo(() => {
    const map = new Map<number, ToothFinding>()
    toothFindings.forEach((f) => {
      if (f.service_id && !map.has(f.tooth_number)) map.set(f.tooth_number, f)
    })
    return map
  }, [toothFindings])

  /**
   * Combined fill for the tooth-picker: today's live in-progress work (most
   * relevant, changes as you check steps off) wins over an existing chart
   * finding, which wins over "missing", which falls back to the plain
   * default — same layering the overview tab uses, so this chart isn't a
   * blank slate next to a patient who already has a full dental history.
   */
  function pickerToothColor(tooth: number): string {
    const work = toothWorkColor.get(tooth)
    if (work) return work.done ? work.color : fadeHex(work.color, 0.55)
    if (stateByTooth.get(tooth) === 'missing') return STATUS_COLOR.missing
    const finding = activeFindingByTooth.get(tooth)
    if (!finding) return DEFAULT_TOOTH_FILL
    // A bridge/appliance tooth stays plain — the connecting line marks it, not a crown fill.
    if (finding.service_spans_teeth) return DEFAULT_TOOTH_FILL
    if (finding.service_color) {
      const done = finding.status === 'done'
      return done ? finding.service_color : fadeHex(finding.service_color, 0.55)
    }
    if (finding.status === 'planned' || finding.status === 'in_progress') return STATUS_COLOR.planned
    return STATUS_COLOR.done
  }

  /**
   * Bridge-style services (spans_teeth) get a connecting bar drawn across
   * their teeth instead of (or alongside) each tooth's own crown color —
   * same grouping as the overview chart.
   */
  const bridgeGroups = useMemo(() => {
    const groups = new Map<string, { color: string; done: boolean; teeth: number[] }>()
    toothFindings.forEach((f) => {
      if (!f.service_spans_teeth || !f.service_id) return
      const key = `${f.plan_id ?? 'x'}-${f.service_id}`
      const g = groups.get(key)
      if (g) {
        g.teeth.push(f.tooth_number)
        g.done = g.done && f.status === 'done'
      } else {
        groups.set(key, { color: f.service_color ?? STATUS_COLOR.done, done: f.status === 'done', teeth: [f.tooth_number] })
      }
    })
    return Array.from(groups.values()).filter((g) => g.teeth.length > 1)
  }, [toothFindings])

  /** One condition group per distinct picker color actually in use — selection/range-anchor highlighting is handled separately via defaultSelected, since the library's own "selected" styling already reads clearly on top. */
  const teethConditions = useMemo(() => {
    const groups = new Map<string, { fillColor: string; outlineColor: string; teeth: string[] }>()
    for (const n of toothNumbers) {
      const color = pickerToothColor(n)
      if (color === DEFAULT_TOOTH_FILL) continue
      const g = groups.get(color)
      if (g) g.teeth.push(toLibraryId(n))
      else groups.set(color, { fillColor: color, outlineColor: color, teeth: [toLibraryId(n)] })
    }
    const result = Array.from(groups.entries()).map(([key, g]) => ({ label: key, ...g }))
    if (isChild) result.push({ label: 'phantom', fillColor: '#e5e7eb', outlineColor: '#d1d5db', teeth: CHILD_PHANTOM_LIBRARY_IDS })
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toothWorkColor, stateByTooth, activeFindingByTooth, isChild])

  const geometry = useOdontogramGeometry(containerRef, toothNumbers, toLibraryId, [chartKey, isChild])

  const serviceOptions = services.map((s) => ({ value: String(s.id), label: s.name }))
  const doctorOptions = doctors.map((d) => ({ value: String(d.id), label: d.full_name }))
  const editingItem = workItems.find((wi) => wi.id === editingWorkItemId) ?? null

  return (
    <div className="space-y-6">
      {medicalAlerts.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center gap-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
            <FontAwesomeIcon icon={faTriangleExclamation} />
            حساسية: {medicalAlerts.join('، ')}
          </div>
        </Card>
      )}

      {workItems.length > 0 && (
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-medium text-ink/70">شغل قيد التنفيذ اليوم</h2>
          <div className="space-y-2">
            {workItems.map((w) => {
              const done = w.steps.reduce((s, st) => s + st.tooth_steps.filter((ts) => ts.completed).length, 0)
              const of = w.steps.reduce((s, st) => s + st.tooth_steps.length, 0)
              return (
                <div key={w.id} className="rounded-lg border border-ink/10">
                  <div className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                    <button onClick={() => setActiveWorkItemId(activeWorkItemId === w.id ? null : w.id)} className="text-start hover:text-accent">
                      <span className="font-medium text-ink">{w.service_name}</span>
                      <span className="text-xs text-muted"> — أسنان {w.teeth.join('، ')} — {w.doctor_name ?? 'بدون طبيب'}</span>
                    </button>
                    <span className="text-xs text-muted">{done}/{of} خطوة</span>
                    <Badge variant={STATUS_VARIANTS[w.status]}>{STATUS_LABELS[w.status]}</Badge>
                    <span className="text-sm font-medium text-ink">{money(itemTotal(w))} ₪</span>
                    <div className="ms-auto flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => toggleCheckoutId(w.id)}
                        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                          checkoutIds.has(w.id) ? 'bg-accent text-white' : 'bg-accent-soft text-accent hover:opacity-80'
                        }`}
                      >
                        <FontAwesomeIcon icon={faCheck} />
                        {checkoutIds.has(w.id) ? 'ضمن إنهاء الجلسة الحالية' : 'إنهاء الجلسة الحالية'}
                      </button>
                      <button
                        onClick={() => (editingWorkItemId === w.id ? cancelEditWorkItem() : startEditWorkItem(w))}
                        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                          editingWorkItemId === w.id ? 'bg-accent text-white' : 'bg-background text-ink/70 hover:text-accent'
                        }`}
                      >
                        <FontAwesomeIcon icon={faPen} />
                        {editingWorkItemId === w.id ? 'إلغاء التعديل' : 'تعديل'}
                      </button>
                      <button
                        onClick={() => cancelWorkItem(w)}
                        className="flex items-center gap-1.5 rounded-lg bg-background px-2.5 py-1.5 text-xs font-medium text-danger hover:bg-danger-soft"
                      >
                        <FontAwesomeIcon icon={faTrash} />
                        إلغاء
                      </button>
                    </div>
                  </div>

                  {scheduleSuccessId === w.id && (
                    <p className="flex items-center gap-1.5 border-t border-ink/10 p-3 text-xs text-success">
                      <FontAwesomeIcon icon={faCheck} />
                      تم حجز موعد المتابعة.
                    </p>
                  )}

                  {pendingScheduleIds.includes(w.id) && schedulingId !== w.id && scheduleSuccessId !== w.id && (
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink/10 bg-warning-soft px-3 py-2 text-xs text-warning">
                      <span>الجلسة انتهت وضلّ فيها خطوات مش منجزة — جدول موعد المتابعة.</span>
                      <button
                        onClick={() => {
                          setSchedulingId(w.id)
                          setScheduleError(null)
                        }}
                        className="flex items-center gap-1.5 rounded-lg bg-warning px-2.5 py-1 font-medium text-white hover:opacity-90"
                      >
                        <FontAwesomeIcon icon={faCalendarPlus} />
                        جدولة موعد المتابعة
                      </button>
                    </div>
                  )}

                  {schedulingId === w.id && (
                    <div className="border-t border-ink/10 p-3">
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="w-40">
                          <DatePicker value={scheduleDate} onChange={setScheduleDate} placeholder="تاريخ المتابعة" />
                        </div>
                        <input
                          type="time"
                          value={scheduleTime}
                          onChange={(e) => setScheduleTime(e.target.value)}
                          className="rounded-lg border border-border px-2 py-1.5 text-sm"
                        />
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            max={8}
                            value={scheduleDurationHours}
                            onChange={(e) => setScheduleDurationHours(Number(e.target.value))}
                            className="w-14 rounded-lg border border-border px-2 py-1.5 text-sm"
                          />
                          <span className="text-xs text-muted">ساعة</span>
                          <input
                            type="number"
                            min={0}
                            max={59}
                            step={5}
                            value={scheduleDurationMinutes}
                            onChange={(e) => setScheduleDurationMinutes(Number(e.target.value))}
                            className="w-16 rounded-lg border border-border px-2 py-1.5 text-sm"
                          />
                          <span className="text-xs text-muted">دقيقة</span>
                        </div>
                        <Button onClick={() => submitSchedule(w)} className="px-3 py-1.5 text-xs">
                          حجز موعد متابعة
                        </Button>
                      </div>
                      {scheduleError && <p className="mt-2 text-xs text-danger">{scheduleError}</p>}
                    </div>
                  )}

                  {activeWorkItemId === w.id && editingWorkItemId !== w.id && (
                    <div className="border-t border-ink/10 p-3">{renderStepsEditor(w)}</div>
                  )}
                </div>
              )
            })}
          </div>
        </Card>
      )}

      <PickerWrapper editing={editingWorkItemId !== null} onClose={cancelEditWorkItem} title={`تعديل جلسة — ${services.find((s) => String(s.id) === newServiceId)?.name ?? ''}`} sectionRef={pickerSectionRef}>
      <Card className={editingWorkItemId !== null ? 'border-0 p-0 shadow-none' : 'p-4'}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink/70">
            {editingWorkItemId ? 'تفاصيل هاي الجلسة بس — عدّل الأسنان/الخطوات وحفظ' : 'إضافة شغل جديد — حدد الأسنان'}
          </h2>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <FontAwesomeIcon icon={faObjectGroup} />
              اضغط سن، وبعدين Ctrl+ضغط سن تاني تحدد كل النطاق بينهم
            </span>
            {selectedTeeth.length > 0 && !editingWorkItemId && (
              <button
                onClick={() => {
                  setSelection([])
                  setLastClickedTooth(null)
                }}
                className="text-xs text-danger hover:underline"
              >
                مسح التحديد ({selectedTeeth.length})
              </button>
            )}
          </div>
        </div>

        {editingWorkItemId && editingItem && (
          <div className="mb-4 border-b border-ink/10 pb-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-medium text-ink/70">شو اشتغلت بهاي الجلسة:</p>
              <p className="text-sm font-semibold text-ink">
                المبلغ المتفق عليه: <span className="text-accent">{money(sessionTotal(editingItem))} ₪</span>
              </p>
            </div>
            {renderStepsEditor(editingItem)}
          </div>
        )}

        {/* Side-by-side kept shrinking the chart no matter the CSS technique
            (flex, then a hard-px grid track) — something about this
            container's real available width made both compress it. Full
            size beats clever positioning, so: stacked, chart at its natural
            size, fields in a card right below it. */}
        <div ref={containerRef} className="relative mx-auto" style={{ maxWidth: 500 }}>
          <Odontogram
            key={chartKey}
            layout="circle"
            notation="FDI"
            maxTeeth={8}
            defaultSelected={selectedTeeth.map(toLibraryId)}
            singleSelect={false}
            onChange={() => {}}
            teethConditions={teethConditions}
            showLabels={false}
            // Library's own "selected" tint is driven by its own internal
            // click state, which clicks no longer go through (see
            // OdontogramClickOverlay below) — transparent so it can't show
            // a stale highlight that contradicts our own selection ring.
            colors={{ darkBlue: 'var(--color-accent)', baseBlue: '#c9b8a8', lightBlue: 'transparent' }}
          />
          {geometry && <OdontogramBridgeOverlay geometry={geometry} groups={bridgeGroups} />}
          {geometry && <OdontogramSelectionOverlay geometry={geometry} selected={selectedTeeth} />}
          {geometry && <OdontogramNumberOverlay geometry={geometry} toothNumbers={toothNumbers} />}
          {geometry && <OdontogramClickOverlay geometry={geometry} toothNumbers={toothNumbers} onSelect={toggleTooth} />}
        </div>

        <div className="mx-auto mt-4 grid gap-4 rounded-xl border border-border bg-background p-4 sm:grid-cols-2" style={{ maxWidth: 500 }}>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink/80">الخدمة</label>
            {editingWorkItemId ? (
              <p className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink/70">
                {services.find((s) => String(s.id) === newServiceId)?.name ?? '—'}
              </p>
            ) : (
              <SearchableSelect
                options={serviceOptions}
                value={newServiceId}
                onChange={selectService}
                placeholder="اختر خدمة..."
              />
            )}
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink/80">الطبيب المشرف (إجباري)</label>
            <SearchableSelect options={doctorOptions} value={doctorId} onChange={setDoctorId} placeholder="اختر طبيب..." />
          </div>
        </div>

        {editingWorkItemId && (
          <div className="mt-3 rounded-xl border border-border bg-background p-3">
            <label className="mb-1 block text-xs text-muted">المبلغ المحصّل لهاي الجلسة</label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="number"
                min={0}
                value={editedCollectedAmount}
                onChange={(e) => setEditedCollectedAmount(e.target.value)}
                className="w-32 rounded-lg border border-border px-2 py-1.5 text-sm font-semibold"
              />
              <span className="text-xs text-muted">₪</span>
              {patientOutstandingIls !== null && (
                <span className="text-xs text-muted">
                  الرصيد العام المتبقي على المريض: <span className="font-medium text-ink/70">{money(patientOutstandingIls)} ₪</span>
                </span>
              )}
            </div>
            {Math.max(0, Number(editedCollectedAmount) || 0) !== editingOriginalCollected && (
              <div className="mt-2 flex gap-2">
                <SearchableSelect
                  options={cashboxes.map((c) => ({ value: String(c.id), label: c.name, sublabel: c.currency }))}
                  value={editedCollectedCashboxId}
                  onChange={setEditedCollectedCashboxId}
                  placeholder="الصندوق..."
                  className="flex-1"
                />
                <Select value={editedCollectedMethod} onChange={(e) => setEditedCollectedMethod(e.target.value as typeof editedCollectedMethod)}>
                  <option value="cash">نقدي</option>
                  <option value="card">بطاقة</option>
                  <option value="transfer">تحويل</option>
                </Select>
              </div>
            )}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-end gap-3">
          {editingWorkItemId ? (
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  const w = workItems.find((wi) => wi.id === editingWorkItemId)
                  if (w) saveWorkItemEdits(w)
                }}
                loading={creating}
                disabled={creating}
              >
                <FontAwesomeIcon icon={faCheck} />
                حفظ التعديلات ({selectedTeeth.length} سن)
              </Button>
              <button onClick={cancelEditWorkItem} className="rounded-xl px-3 py-2 text-sm text-muted hover:bg-background">
                إلغاء
              </button>
            </div>
          ) : (
            <Button onClick={createWorkItem} loading={creating} disabled={creating}>
              <FontAwesomeIcon icon={faPlus} />
              بدء الشغل ({selectedTeeth.length} سن)
            </Button>
          )}
        </div>
        {createError && <p className="mt-2 text-sm text-danger">{createError}</p>}
      </Card>
      </PickerWrapper>

      {checkoutIds.size > 0 && (
        <div ref={checkoutSectionRef}>
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-medium text-ink/70">التحصيل — {checkoutIds.size} شغل محدد</h2>
          <div className="mb-3 w-64">
            <label className="mb-1 block text-xs text-muted">الطبيب</label>
            <SearchableSelect options={doctorOptions} value={doctorId} onChange={setDoctorId} placeholder="اختر طبيب..." />
          </div>
          <div className="mb-3 flex items-center justify-between text-sm">
            <span className="text-muted">الإجمالي حسب الخطوات المنجزة</span>
            <span className="text-ink">{money(checkoutTotal)} ₪</span>
          </div>
          <div className="mb-2 flex gap-1 rounded-lg border border-border bg-white p-1 text-xs">
            {[
              { value: 'final' as const, label: 'السعر النهائي' },
              { value: 'amount' as const, label: 'مبلغ الخصم' },
              { value: 'percent' as const, label: 'نسبة الخصم %' },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setPriceEditMode(opt.value)}
                className={`flex-1 rounded-md py-1.5 font-medium transition-colors ${
                  priceEditMode === opt.value ? 'bg-accent text-white' : 'text-ink/60 hover:bg-background'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="mb-3 flex items-center gap-2">
            {priceEditMode === 'final' && (
              <>
                <span className="text-sm text-ink/70">السعر النهائي</span>
                <input
                  type="number"
                  value={finalTotal === checkoutTotal && discount === '' ? '' : finalTotal}
                  onChange={(e) => {
                    const typed = e.target.value === '' ? checkoutTotal : Math.max(0, Number(e.target.value))
                    setDiscount(String(Math.max(0, checkoutTotal - typed)))
                  }}
                  placeholder={String(checkoutTotal)}
                  className="w-28 rounded-lg border border-border px-2 py-1.5 text-sm font-semibold"
                />
                <span className="text-xs text-muted">₪</span>
              </>
            )}
            {priceEditMode === 'amount' && (
              <>
                <span className="text-sm text-ink/70">مبلغ الخصم</span>
                <input
                  type="number"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  placeholder="0"
                  className="w-28 rounded-lg border border-border px-2 py-1.5 text-sm font-semibold"
                />
                <span className="text-xs text-muted">₪</span>
              </>
            )}
            {priceEditMode === 'percent' && (
              <>
                <span className="text-sm text-ink/70">نسبة الخصم</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={checkoutTotal > 0 ? Math.round((discountAmount / checkoutTotal) * 1000) / 10 : ''}
                  onChange={(e) => {
                    const pct = Math.max(0, Math.min(100, Number(e.target.value) || 0))
                    setDiscount(String(Math.round(checkoutTotal * (pct / 100))))
                  }}
                  placeholder="0"
                  className="w-28 rounded-lg border border-border px-2 py-1.5 text-sm font-semibold"
                />
                <span className="text-xs text-muted">%</span>
              </>
            )}
          </div>
          <p className="mb-3 text-xs text-muted">
            {discountAmount > 0 ? `خصم ${money(discountAmount)} ₪ — الإجمالي بعد الخصم ${money(finalTotal)} ₪.` : `بدون خصم — الإجمالي ${money(finalTotal)} ₪.`}
          </p>

          <div className="mb-3">
            <label className="mb-1 block text-xs text-muted">المبلغ المدفوع</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={finalTotal}
                value={paidAmountTouched ? paidAmount : 0}
                onChange={(e) => {
                  setPaidAmountTouched(true)
                  setPaidAmount(e.target.value)
                }}
                placeholder="0"
                className="w-32 rounded-lg border border-border px-2 py-1.5 text-sm font-semibold"
              />
              <span className="text-xs text-muted">₪</span>
              {remainingAsDebt > 0 && <span className="text-xs text-warning">الباقي {money(remainingAsDebt)} ₪ بيضل دين على المريض</span>}
            </div>
          </div>

          {paidAmountValue > 0 && (
            <div className="mb-3">
              <div className="flex gap-2">
                {method !== 'check' && (
                  <SearchableSelect
                    options={cashboxes.map((c) => ({ value: String(c.id), label: c.name, sublabel: c.currency }))}
                    value={cashboxId}
                    onChange={setCashboxId}
                    placeholder="الصندوق..."
                    className="flex-1"
                  />
                )}
                <Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                  <option value="cash">نقدي</option>
                  <option value="card">بطاقة</option>
                  <option value="transfer">تحويل</option>
                  <option value="check">شيك</option>
                </Select>
              </div>
              {method === 'check' && (
                <p className="mt-1.5 text-xs text-muted">بعد الحفظ رح يفتحلك فورم استلام الشيك — تعبّي بياناته وصورته وبيروح لصفحة "الشيكات" تلقائياً.</p>
              )}
            </div>
          )}

          {checkoutError && <p className="mb-2 text-sm text-danger">{checkoutError}</p>}
          {checkoutResult && (
            <p className="mb-2 flex items-center gap-1.5 text-sm text-success">
              <FontAwesomeIcon icon={faCheck} />
              {checkoutResult}
            </p>
          )}

          <Button onClick={submitCheckout} loading={checkingOut} disabled={checkingOut} className="w-full justify-center">
            تأكيد الحفظ والتحصيل
          </Button>
        </Card>
        </div>
      )}

      {notesToothNumber !== null && (
        <ToothNotesModal
          patientId={patientId}
          toothNumber={notesToothNumber}
          notes={notes}
          onClose={() => { setNotesToothNumber(null); setNotesWorkItemId(null); setNotesToothStepId(null) }}
          onChanged={() => onChanged?.()}
          workItemId={notesWorkItemId ?? undefined}
          workItemToothStepId={notesToothStepId ?? undefined}
          sessionLabel={
            notesWorkItemId
              ? (() => {
                  const w = workItems.find((wi) => wi.id === notesWorkItemId)
                  return w ? `${w.service_name ?? 'جلسة'} — ${w.created_at}` : undefined
                })()
              : undefined
          }
          stepTitle={
            notesToothStepId
              ? workItems.flatMap((wi) => wi.steps).find((s) => s.tooth_steps.some((ts) => ts.id === notesToothStepId))?.title
              : undefined
          }
        />
      )}

      {showCheckModal && (
        <ReceiveCheckModal
          partyType="patient"
          partyId={patientId}
          initialAmount={checkAmountForModal}
          onClose={() => setShowCheckModal(false)}
          onCreated={() => onChanged?.()}
        />
      )}
    </div>
  )
}
