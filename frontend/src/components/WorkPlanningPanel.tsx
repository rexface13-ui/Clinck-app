import { useEffect, useMemo, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCheck,
  faPlus,
  faTrash,
  faCalendarPlus,
  faCopy,
  faObjectGroup,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import DatePicker from './DatePicker'
import { Card, Button, Select, SearchableSelect, Badge } from './ui'
import type { BadgeVariant } from './ui'
import { ToothCrown, ToothDefs } from './ToothCrown'
import {
  DEFAULT_TOOTH_FILL,
  LOWER_ARCH,
  LOWER_PERMANENT,
  LOWER_PRIMARY,
  STATUS_COLOR,
  UPPER_ARCH,
  UPPER_PERMANENT,
  UPPER_PRIMARY,
  VIEWBOX,
  archPosition,
  cuspPositions,
  fadeHex,
  primaryCanonicalIndex,
  toothCrownPath,
  toothShapeType,
  toothSize,
  type ArchConfig,
} from '../lib/dental'
import type { Branch, Cashbox, Doctor, Service, ToothFinding, ToothState, WorkItem } from '../types'

interface LaidOutTooth {
  number: number
  x: number
  y: number
  rotationDeg: number
  crownPath: string
  cusps: { x1: number; y1: number; x2: number; y2: number }[]
  labelX: number
  labelY: number
}

function layoutArch(permanentNumbers: number[], primaryNumbers: number[], isChild: boolean, arch: ArchConfig): LaidOutTooth[] {
  const list = isChild ? primaryNumbers : permanentNumbers
  return list.map((number, i) => {
    const isPrimary = number >= 51
    const pos = isPrimary ? archPosition(primaryCanonicalIndex(number), 16, arch) : archPosition(i, list.length, arch)
    const type = toothShapeType(number, isPrimary)
    const { w, h } = toothSize(type, isPrimary)
    return {
      number,
      x: pos.x,
      y: pos.y,
      rotationDeg: pos.rotationDeg,
      crownPath: toothCrownPath(type, w, h),
      cusps: cuspPositions(type, w, h),
      labelX: pos.labelX,
      labelY: pos.labelY,
    }
  })
}

function money(n: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n)
}

const STATUS_LABELS: Record<WorkItem['status'], string> = { in_progress: 'قيد التنفيذ', done: 'مكتمل', cancelled: 'ملغي' }
const STATUS_VARIANTS: Record<WorkItem['status'], BadgeVariant> = { in_progress: 'warning', done: 'success', cancelled: 'neutral' }

export default function WorkPlanningPanel({
  patientId,
  isChild,
  medicalAlerts = [],
  onChanged,
  appointmentId,
  defaultDoctorId,
  toothStates = [],
  toothFindings = [],
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
}) {
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [walkInStartTime, setWalkInStartTime] = useState(() => {
    const now = new Date()
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  })
  const [walkInDurationHours, setWalkInDurationHours] = useState(0)
  const [walkInDurationMinutes, setWalkInDurationMinutes] = useState(30)
  const [doctorId, setDoctorId] = useState(defaultDoctorId ? String(defaultDoctorId) : '')
  const [workItems, setWorkItems] = useState<WorkItem[]>([])
  const [activeWorkItemId, setActiveWorkItemId] = useState<number | null>(null)

  const [selectedTeeth, setSelectedTeeth] = useState<number[]>([])
  const [rangeMode, setRangeMode] = useState(false)
  const [rangeStart, setRangeStart] = useState<number | null>(null)
  const [newServiceId, setNewServiceId] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const [checkoutIds, setCheckoutIds] = useState<Set<number>>(new Set())
  const [discount, setDiscount] = useState('')
  const [priceEditMode, setPriceEditMode] = useState<'final' | 'amount' | 'percent'>('final')
  const checkoutSectionRef = useRef<HTMLDivElement>(null)
  const [payMode, setPayMode] = useState<'now' | 'defer'>('now')
  const [cashboxId, setCashboxId] = useState('')
  const [method, setMethod] = useState<'cash' | 'card' | 'transfer'>('cash')
  const [checkingOut, setCheckingOut] = useState(false)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [checkoutResult, setCheckoutResult] = useState<string | null>(null)

  const [schedulingId, setSchedulingId] = useState<number | null>(null)
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduleTime, setScheduleTime] = useState('10:00')
  const [scheduleDurationHours, setScheduleDurationHours] = useState(0)
  const [scheduleDurationMinutes, setScheduleDurationMinutes] = useState(30)
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [scheduleSuccessId, setScheduleSuccessId] = useState<number | null>(null)
  const [pendingScheduleIds, setPendingScheduleIds] = useState<number[]>([])

  function loadWorkItems() {
    return api.get('/work-items', { params: { patient_id: patientId, status: 'in_progress' } }).then((res) => {
      setWorkItems(res.data.data)
      return res.data.data as WorkItem[]
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
    if (!appointmentId) api.get('/branches').then((res) => setBranches(res.data))
    loadWorkItems()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId])

  const teeth = useMemo(
    () => [
      ...layoutArch(UPPER_PERMANENT, UPPER_PRIMARY, isChild, UPPER_ARCH),
      ...layoutArch(LOWER_PERMANENT, LOWER_PRIMARY, isChild, LOWER_ARCH),
    ],
    [isChild],
  )

  const selectedService = services.find((s) => String(s.id) === newServiceId)

  /** A missing/extracted tooth can't be selected for a normal service — only for a service explicitly flagged as working on missing teeth (implants and the like). */
  function toothBlocked(number: number): boolean {
    return stateByTooth.get(number) === 'missing' && !selectedService?.allows_missing_teeth
  }

  function toggleTooth(number: number) {
    if (rangeMode) {
      if (rangeStart === null) {
        setRangeStart(number)
        return
      }
      const startIdx = teeth.findIndex((t) => t.number === rangeStart)
      const endIdx = teeth.findIndex((t) => t.number === number)
      const [lo, hi] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx]
      const rangeNumbers = teeth.slice(lo, hi + 1).map((t) => t.number).filter((n) => !toothBlocked(n))
      setSelectedTeeth((prev) => Array.from(new Set([...prev, ...rangeNumbers])))
      setRangeStart(null)
      setRangeMode(false)
      return
    }
    setSelectedTeeth((prev) => {
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
      setSelectedTeeth((prev) => prev.filter((n) => stateByTooth.get(n) !== 'missing'))
    }
  }

  async function createWorkItem() {
    if (!doctorId || !newServiceId || selectedTeeth.length === 0) {
      setCreateError('لازم تختار الطبيب، الخدمة، وسن واحد عالأقل.')
      return
    }
    const teeth = selectedService?.allows_missing_teeth ? selectedTeeth : selectedTeeth.filter((n) => stateByTooth.get(n) !== 'missing')
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
      setSelectedTeeth([])
      setNewServiceId('')
      loadWorkItems()
      setActiveWorkItemId(res.data.data.id)
    } catch {
      setCreateError('صار خطأ أثناء بدء الشغل.')
    } finally {
      setCreating(false)
    }
  }

  async function toggleToothStep(workItem: WorkItem, toothStepId: number, completed: boolean) {
    await api.patch(`/work-items/${workItem.id}/tooth-steps/${toothStepId}`, { completed })
    loadWorkItems()
  }

  async function saveField(workItem: WorkItem, toothStepId: number, fieldLabel: string, value: string, currentValues: Record<string, string>) {
    await api.patch(`/work-items/${workItem.id}/tooth-steps/${toothStepId}`, {
      field_values: { ...currentValues, [fieldLabel]: value },
    })
  }

  async function applyToAll(workItem: WorkItem, sourceTooth: number) {
    await api.post(`/work-items/${workItem.id}/apply-to-all`, { tooth_number: sourceTooth })
    loadWorkItems()
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

  function itemTotal(workItem: WorkItem): number {
    let total = 0
    for (const step of workItem.steps) {
      const completedTeeth = step.tooth_steps.filter((ts) => ts.completed)
      if (completedTeeth.length === 0) continue
      if (workItem.price_per_tooth) {
        total += completedTeeth.length * Number(step.price)
      } else if (completedTeeth.length > 0) {
        total += Number(step.price)
      }
    }
    return total
  }

  const checkoutTotal = useMemo(
    () => workItems.filter((w) => checkoutIds.has(w.id)).reduce((sum, w) => sum + itemTotal(w), 0),
    [workItems, checkoutIds],
  )
  const discountAmount = Math.max(0, Number(discount) || 0)
  const finalTotal = Math.max(0, checkoutTotal - discountAmount)

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
    if (payMode === 'now' && !cashboxId) {
      setCheckoutError('اختر الصندوق.')
      return
    }
    const walkInDuration = walkInDurationHours * 60 + walkInDurationMinutes
    if (!appointmentId && walkInDuration <= 0) {
      setCheckoutError('حدد مدة الزيارة.')
      return
    }
    setCheckingOut(true)
    setCheckoutError(null)
    try {
      let effectiveAppointmentId = appointmentId ?? null
      if (!effectiveAppointmentId) {
        const mainBranch = branches.find((b) => b.is_main) ?? branches[0]
        const now = new Date()
        const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
        const startsAt = new Date(`${todayIso}T${walkInStartTime}:00`)
        const endsAt = new Date(startsAt.getTime() + walkInDuration * 60000)
        const apptRes = await api.post('/appointments', {
          branch_id: mainBranch?.id,
          patient_id: patientId,
          doctor_id: Number(doctorId),
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
        })
        effectiveAppointmentId = apptRes.data.data.id
      }
      const res = await api.post('/work-items/checkout', {
        patient_id: patientId,
        work_item_ids: Array.from(checkoutIds),
        doctor_id: Number(doctorId),
        discount_amount: discountAmount,
        pay_cashbox_id: payMode === 'now' ? Number(cashboxId) : null,
        pay_method: payMode === 'now' ? method : null,
        appointment_id: effectiveAppointmentId,
      })
      setCheckoutResult(`تمّ الحفظ — الإجمالي ${money(res.data.total_ils)} ₪`)
      const checkedOutIds = Array.from(checkoutIds)
      setCheckoutIds(new Set())
      setDiscount('')
      setActiveWorkItemId(null)
      const freshItems = await loadWorkItems()
      setPendingScheduleIds(freshItems.filter((w) => checkedOutIds.includes(w.id)).map((w) => w.id))
      onChanged?.()
      setTimeout(() => setCheckoutResult(null), 4000)
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
      if (!w.service_color) continue
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
    if (finding) {
      if (finding.service_color) {
        const done = finding.status === 'done'
        return done ? finding.service_color : fadeHex(finding.service_color, 0.55)
      }
      if (finding.status === 'planned' || finding.status === 'in_progress') return STATUS_COLOR.planned
      return STATUS_COLOR.done
    }
    return DEFAULT_TOOTH_FILL
  }

  const serviceOptions = services.map((s) => ({ value: String(s.id), label: s.name }))
  const doctorOptions = doctors.map((d) => ({ value: String(d.id), label: d.full_name }))

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

                  {activeWorkItemId === w.id && (
                    <div className="space-y-4 border-t border-ink/10 p-3">
                      {w.steps.map((step) => (
                        <div key={step.id} className="rounded-lg bg-background p-3">
                          <div className="mb-2 flex items-center justify-between">
                            <h4 className="text-sm font-semibold text-ink">{step.title}</h4>
                            <span className="text-xs text-muted">{step.price} ₪ {w.price_per_tooth ? '/ سن' : 'إجمالي'}</span>
                          </div>
                          <div className="space-y-2">
                            {step.tooth_steps.map((ts) => (
                              <div key={ts.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-ink/10 bg-white p-2">
                                <label className="flex items-center gap-1.5 text-xs font-medium text-ink">
                                  <input
                                    type="checkbox"
                                    checked={ts.completed}
                                    onChange={(e) => toggleToothStep(w, ts.id, e.target.checked)}
                                    className="size-4 accent-success"
                                  />
                                  سن {ts.tooth_number}
                                </label>
                                {step.fields.map((f) => (
                                  <input
                                    key={f.id}
                                    defaultValue={ts.field_values[f.label] ?? ''}
                                    onBlur={(e) => saveField(w, ts.id, f.label, e.target.value, ts.field_values)}
                                    placeholder={f.label}
                                    className="w-28 rounded-lg border border-border px-2 py-1 text-xs"
                                  />
                                ))}
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
                  )}
                </div>
              )
            })}
          </div>
        </Card>
      )}

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink/70">إضافة شغل جديد — حدد الأسنان</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setRangeMode((v) => !v)
                setRangeStart(null)
              }}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs ${
                rangeMode ? 'border-accent bg-accent-soft text-accent' : 'border-border text-muted hover:border-accent hover:text-accent'
              }`}
            >
              <FontAwesomeIcon icon={faObjectGroup} />
              {rangeMode ? (rangeStart ? `حدد آخر سن بالنطاق (من ${rangeStart})` : 'اضغط أول سن بالنطاق') : 'تحديد نطاق'}
            </button>
            {selectedTeeth.length > 0 && (
              <button onClick={() => setSelectedTeeth([])} className="text-xs text-danger hover:underline">
                مسح التحديد ({selectedTeeth.length})
              </button>
            )}
          </div>
        </div>

        <svg viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`} className="w-full" style={{ maxWidth: 620 }}>
          <ToothDefs />
          <line x1={40} y1={VIEWBOX.height / 2} x2={VIEWBOX.width - 40} y2={VIEWBOX.height / 2} stroke="#e2e8f0" strokeDasharray="4 4" />
          {bridgeGroups.map((g, i) => {
            const points = g.teeth
              .map((n) => teeth.find((t) => t.number === n))
              .filter((t): t is LaidOutTooth => !!t)
              .sort((a, b) => a.labelX - b.labelX)
            if (points.length < 2) return null
            const color = g.done ? g.color : fadeHex(g.color, 0.5)
            return (
              <polyline
                key={i}
                points={points.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke={color}
                strokeWidth={7}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.85}
              />
            )
          })}
          {teeth.map((t) => {
            const selected = selectedTeeth.includes(t.number)
            const isRangeAnchor = rangeStart === t.number
            const blocked = toothBlocked(t.number)
            const fill = selected || isRangeAnchor ? 'var(--color-accent)' : pickerToothColor(t.number)
            const stroke = selected || isRangeAnchor ? 'var(--color-accent)' : '#c9b8a8'
            return (
              <g
                key={t.number}
                onClick={() => toggleTooth(t.number)}
                className={blocked ? 'cursor-not-allowed' : 'cursor-pointer'}
                opacity={blocked ? 0.35 : 1}
              >
                <title>{blocked ? 'سن مفقود — هاي الخدمة ما بتشتغل عليه' : ''}</title>
                <g transform={`translate(${t.x},${t.y}) rotate(${t.rotationDeg})`}>
                  <ToothCrown
                    crownPath={t.crownPath}
                    cusps={t.cusps}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={selected || isRangeAnchor ? 2.5 : 1.2}
                  />
                </g>
                <text x={t.labelX} y={t.labelY} textAnchor="middle" dominantBaseline="middle" fontSize="11" fill="var(--color-ink)" className="select-none">
                  {t.number}
                </text>
              </g>
            )
          })}
        </svg>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="w-64">
            <label className="mb-1 block text-xs text-muted">الخدمة</label>
            <SearchableSelect
              options={serviceOptions}
              value={newServiceId}
              onChange={selectService}
              placeholder="اختر خدمة..."
            />
          </div>
          <div className="w-64">
            <label className="mb-1 block text-xs text-muted">الطبيب المشرف (إجباري)</label>
            <SearchableSelect options={doctorOptions} value={doctorId} onChange={setDoctorId} placeholder="اختر طبيب..." />
          </div>
          <Button onClick={createWorkItem} loading={creating} disabled={creating}>
            <FontAwesomeIcon icon={faPlus} />
            بدء الشغل ({selectedTeeth.length} سن)
          </Button>
        </div>
        {createError && <p className="mt-2 text-sm text-danger">{createError}</p>}
      </Card>

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

          {!appointmentId && (
            <div className="mb-3">
              <label className="mb-1 block text-xs text-muted">وقت البدء والمدة (ما في موعد محجوز اليوم)</label>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={walkInStartTime}
                  onChange={(e) => setWalkInStartTime(e.target.value)}
                  className="rounded-lg border border-border px-2 py-1.5 text-sm"
                />
                <input
                  type="number"
                  min={0}
                  max={8}
                  value={walkInDurationHours}
                  onChange={(e) => setWalkInDurationHours(Number(e.target.value))}
                  className="w-16 rounded-lg border border-border px-2 py-1.5 text-sm"
                />
                <span className="text-xs text-muted">ساعة</span>
                <input
                  type="number"
                  min={0}
                  max={59}
                  step={5}
                  value={walkInDurationMinutes}
                  onChange={(e) => setWalkInDurationMinutes(Number(e.target.value))}
                  className="w-16 rounded-lg border border-border px-2 py-1.5 text-sm"
                />
                <span className="text-xs text-muted">دقيقة</span>
              </div>
            </div>
          )}

          <div className="mb-3 flex gap-1 rounded-lg border border-border bg-white p-1">
            <button
              onClick={() => setPayMode('now')}
              className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${payMode === 'now' ? 'bg-accent text-white' : 'text-ink/60 hover:bg-background'}`}
            >
              دفع الآن
            </button>
            <button
              onClick={() => setPayMode('defer')}
              className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${payMode === 'defer' ? 'bg-accent text-white' : 'text-ink/60 hover:bg-background'}`}
            >
              تأجيل (يضل دين)
            </button>
          </div>

          {payMode === 'now' && (
            <div className="mb-3 flex gap-2">
              <SearchableSelect
                options={cashboxes.map((c) => ({ value: String(c.id), label: c.name, sublabel: c.currency }))}
                value={cashboxId}
                onChange={setCashboxId}
                placeholder="الصندوق..."
                className="flex-1"
              />
              <Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                <option value="cash">نقدي</option>
                <option value="card">بطاقة</option>
                <option value="transfer">تحويل</option>
              </Select>
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
    </div>
  )
}
