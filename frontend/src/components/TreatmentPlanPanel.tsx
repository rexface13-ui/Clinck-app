import { Fragment, useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faCheck, faCalendarPlus, faChevronDown, faChevronLeft } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { SearchableSelect } from './ui'
import { describeTeeth } from '../lib/dental'
import type { Cashbox, Doctor, PlanItem, Service, TreatmentPlan } from '../types'

const STATUS_LABELS: Record<TreatmentPlan['status'], string> = {
  draft: 'مسودة',
  approved: 'معتمدة',
  cancelled: 'ملغاة',
}

const SESSION_STATUS_LABELS: Record<string, string> = {
  pending: 'لسا ما جدولت',
  scheduled: 'مجدولة',
  done: 'محسوبة',
  cancelled: 'ملغاة',
}

interface ItemFormState {
  service_id: string
  tooth_number: string
  unit_price: string
  sessions_count: string
  interval_days: string
  discount_type: 'percent' | 'fixed'
  discount_value: string
}

/** Final per-session price after applying the line's discount — this is what actually gets billed/stored as unit_price. */
function discountedPrice(f: ItemFormState): number {
  const base = Number(f.unit_price) || 0
  const raw = Number(f.discount_value) || 0
  const discount = f.discount_type === 'percent' ? (base * raw) / 100 : raw
  return Math.max(0, base - Math.min(base, discount))
}

interface SessionFormState {
  price: string
  discount_type: 'percent' | 'fixed'
  discount_value: string
  pay_now: boolean
  cashbox_id: string
  method: 'cash' | 'card' | 'transfer'
}

function sessionDiscountedPrice(f: SessionFormState): number {
  const base = Number(f.price) || 0
  const raw = Number(f.discount_value) || 0
  const discount = f.discount_type === 'percent' ? (base * raw) / 100 : raw
  return Math.max(0, base - Math.min(base, discount))
}

/** One row in the items table: all plan items sharing a batch_id (created together from one "add" action, e.g. picking several teeth for one service) collapse into a single group. */
interface ItemGroup {
  key: string
  items: PlanItem[]
}

function groupItems(items: PlanItem[]): ItemGroup[] {
  const order: string[] = []
  const map = new Map<string, PlanItem[]>()
  for (const item of items) {
    const key = item.batch_id ?? `single-${item.id}`
    if (!map.has(key)) {
      map.set(key, [])
      order.push(key)
    }
    map.get(key)!.push(item)
  }
  return order.map((key) => ({ key, items: map.get(key)! }))
}

interface Props {
  patientId: number
  isChild?: boolean
  /** Tooth number(s) most recently picked from the chart, and which plan it's for — filled by the parent when pick mode is active. */
  pickedTooth?: { planId: number; toothNumbers: number[] } | null
  onToothConsumed?: () => void
  /** Parent switches the chart into pick mode for this plan id. */
  onRequestPickTooth?: (planId: number) => void
  pickingForPlanId?: number | null
  /** Reports the loaded plans up so the parent can flag "busy" teeth on the chart. */
  onPlansLoaded?: (plans: TreatmentPlan[]) => void
  /** Bump this (e.g. a counter) to force a reload from outside — the panel fetches its own data independently otherwise. */
  refreshSignal?: number
}

export default function TreatmentPlanPanel({ patientId, isChild = false, pickedTooth, onToothConsumed, onRequestPickTooth, pickingForPlanId, onPlansLoaded, refreshSignal }: Props) {
  const { can } = useAuth()
  const [plans, setPlans] = useState<TreatmentPlan[]>([])
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([])
  const [showNewPlan, setShowNewPlan] = useState(false)
  const [newDoctorId, setNewDoctorId] = useState('')
  const [itemForm, setItemForm] = useState<Record<number, ItemFormState>>({})
  const [sessionForm, setSessionForm] = useState<Record<number, SessionFormState>>({})
  const [openSessionId, setOpenSessionId] = useState<number | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  function toggleGroup(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  useEffect(() => {
    if (!pickedTooth) return
    setItemForm((prev) => ({
      ...prev,
      [pickedTooth.planId]: { ...itemFormFor(pickedTooth.planId, prev), tooth_number: pickedTooth.toothNumbers.slice().sort((a, b) => a - b).join(',') },
    }))
    onToothConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedTooth])

  function load() {
    api.get('/treatment-plans', { params: { patient_id: patientId } }).then((res) => {
      setPlans(res.data.data)
      onPlansLoaded?.(res.data.data)
    })
  }

  useEffect(() => {
    load()
    api.get('/doctors').then((res) => setDoctors(res.data.data))
    api.get('/services').then((res) => setServices(res.data.data))
    api.get('/cashboxes').then((res) => setCashboxes(res.data))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, refreshSignal])

  const canManage = can('treatment_plans.manage')

  async function createPlan() {
    setBusy(true)
    try {
      await api.post('/treatment-plans', { patient_id: patientId, doctor_id: newDoctorId ? Number(newDoctorId) : null })
      setShowNewPlan(false)
      setNewDoctorId('')
      load()
    } finally {
      setBusy(false)
    }
  }

  function itemFormFor(planId: number, map: typeof itemForm = itemForm): ItemFormState {
    return map[planId] ?? { service_id: '', tooth_number: '', unit_price: '', sessions_count: '1', interval_days: '', discount_type: 'percent', discount_value: '' }
  }

  async function addItem(planId: number) {
    const f = itemFormFor(planId)
    if (!f.service_id || !f.unit_price) return
    // The tooth field can hold several comma-separated numbers (picked in bulk
    // from the chart, or typed by hand) — one identical plan item gets created
    // per tooth. With no tooth number at all (whole-mouth services like a
    // cleaning), a single item with no tooth is created.
    const teeth = f.tooth_number
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .map(Number)
    const toothNumbers = teeth.length > 0 ? teeth : [null]
    const finalPrice = discountedPrice(f)
    // One tooth doesn't need a batch — it's already a single row. Several teeth
    // picked in one "add" share a batch_id so they collapse into one group row
    // instead of listing every tooth separately.
    const batchId = toothNumbers.length > 1 ? crypto.randomUUID() : null

    setBusy(true)
    try {
      // Fired in parallel, not sequentially — awaiting each POST one at a time
      // made adding a service to a whole arch (16 teeth) take many seconds.
      await Promise.all(
        toothNumbers.map((tooth) =>
          api.post(`/treatment-plans/${planId}/items`, {
            service_id: Number(f.service_id),
            tooth_number: tooth,
            batch_id: batchId,
            unit_price: finalPrice,
            sessions_count: Number(f.sessions_count) || 1,
            interval_days: f.interval_days ? Number(f.interval_days) : null,
          }),
        ),
      )
      setItemForm({ ...itemForm, [planId]: { service_id: '', tooth_number: '', unit_price: '', sessions_count: '1', interval_days: '', discount_type: 'percent', discount_value: '' } })
      load()
    } finally {
      setBusy(false)
    }
  }

  async function removeItem(planId: number, itemId: number) {
    setBusy(true)
    try {
      await api.delete(`/treatment-plans/${planId}/items/${itemId}`)
      load()
    } finally {
      setBusy(false)
    }
  }

  async function removeGroup(planId: number, itemIds: number[]) {
    setBusy(true)
    try {
      await Promise.all(itemIds.map((id) => api.delete(`/treatment-plans/${planId}/items/${id}`)))
      load()
    } finally {
      setBusy(false)
    }
  }

  function sessionFormFor(sessionId: number, defaultPrice: string): SessionFormState {
    const ils = cashboxes.find((c) => c.currency === 'ILS')
    return (
      sessionForm[sessionId] ?? {
        price: defaultPrice,
        discount_type: 'percent',
        discount_value: '',
        pay_now: true,
        cashbox_id: ils ? String(ils.id) : '',
        method: 'cash',
      }
    )
  }

  async function completeSession(planId: number, itemId: number, sessionId: number, defaultPrice: string) {
    const f = sessionFormFor(sessionId, defaultPrice)
    const price = sessionDiscountedPrice(f)
    if (f.pay_now && !f.cashbox_id) return
    setBusy(true)
    try {
      await api.post(`/treatment-plans/${planId}/items/${itemId}/sessions/${sessionId}/complete`, {
        price,
        pay_now: f.pay_now,
        cashbox_id: f.pay_now ? Number(f.cashbox_id) : undefined,
        method: f.pay_now ? f.method : undefined,
      })
      setOpenSessionId(null)
      load()
    } finally {
      setBusy(false)
    }
  }

  async function cancelSessionAction(planId: number, itemId: number, sessionId: number) {
    if (!window.confirm('إلغاء هالجلسة؟ لو كانت محسوبة رح يترد مبلغها كرصيد للمريض، وأي سن مسجل عليها يرجع لونه.')) return
    setBusy(true)
    try {
      await api.post(`/treatment-plans/${planId}/items/${itemId}/sessions/${sessionId}/cancel`)
      load()
    } finally {
      setBusy(false)
    }
  }

  async function cancelItem(planId: number, itemId: number) {
    if (!window.confirm('إلغاء هالبند؟ رح تتلغى جلساته ومواعيدها، وأي سن اتحدد إله (يرجع لونه بالرسمة)، وجزؤه من الفاتورة يترد كرصيد للمريض.')) return
    setBusy(true)
    try {
      await api.post(`/treatment-plans/${planId}/items/${itemId}/cancel`)
      load()
    } finally {
      setBusy(false)
    }
  }

  async function cancelGroup(planId: number, itemIds: number[]) {
    if (!window.confirm(`إلغاء كل البنود (${itemIds.length})؟ رح تتلغى جلساتها ومواعيدها، وكل الأسنان المرتبطة ترجع ألوانها، وقيمتها ترد كرصيد للمريض.`)) return
    setBusy(true)
    try {
      await Promise.all(itemIds.map((id) => api.post(`/treatment-plans/${planId}/items/${id}/cancel`)))
      load()
    } finally {
      setBusy(false)
    }
  }

  async function deletePlan(planId: number) {
    if (!window.confirm('حذف خطة العلاج بالكامل؟')) return
    setBusy(true)
    try {
      await api.delete(`/treatment-plans/${planId}`)
      load()
    } finally {
      setBusy(false)
    }
  }

  async function approvePlan(planId: number) {
    if (!window.confirm('اعتماد الخطة بجدول جلساتها بس — ما رح يترتب أي مبلغ عالمريض إلا لما تحاسب كل جلسة تصير فعلياً. متابعة؟')) return
    setBusy(true)
    try {
      await api.post(`/treatment-plans/${planId}/approve`)
      load()
    } finally {
      setBusy(false)
    }
  }

  async function cancelPlan(planId: number) {
    if (!window.confirm('إلغاء الخطة المعتمدة؟ رح تتلغى الفاتورة ويرجع المبلغ عن دين المريض (إذا كان مو مدفوع)، وتتلغى الجلسات والمواعيد المرتبطة فيها.')) return
    setBusy(true)
    try {
      await api.post(`/treatment-plans/${planId}/cancel`)
      load()
    } finally {
      setBusy(false)
    }
  }

  async function scheduleSessions(planId: number) {
    setBusy(true)
    try {
      await api.post(`/treatment-plans/${planId}/schedule-sessions`)
      load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl bg-white p-6 shadow-sm">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink/70">خطط العلاج</h2>
        {canManage && (
          <button
            onClick={() => setShowNewPlan((v) => !v)}
            className="flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
          >
            <FontAwesomeIcon icon={faPlus} />
            خطة جديدة
          </button>
        )}
      </div>
      <p className="mb-4 text-xs text-ink/40">
        لجلسة اليوم فقط (خدمة أو أكثر بزيارة وحدة، مع خصم ودفع مباشر) استخدم زر "اجاني هلق" أو "تمّت الزيارة" فوق —
        هون تحت لخطة علاج بعدة جلسات ممتدة على أكثر من زيارة.
      </p>

      {showNewPlan && (
        <div className="mb-4 flex items-end gap-2 rounded-lg bg-background p-3">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-ink/60">الطبيب المعالج (اختياري)</label>
            <select
              value={newDoctorId}
              onChange={(e) => setNewDoctorId(e.target.value)}
              className="w-full rounded-lg border border-ink/10 px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
            >
              <option value="">بدون طبيب محدد</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>{d.full_name}</option>
              ))}
            </select>
          </div>
          <button onClick={createPlan} disabled={busy} className="rounded-lg bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent-hover disabled:opacity-60">
            إنشاء
          </button>
        </div>
      )}

      {plans.length === 0 ? (
        <p className="text-sm text-ink/40">لا توجد خطط علاج.</p>
      ) : (
        <div className="space-y-4">
          {plans.map((plan) => (
            <div key={plan.id} className="rounded-lg border border-ink/10 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-ink">{plan.doctor_name ?? 'بدون طبيب محدد'}</span>
                  <span
                    className={`mr-2 rounded-lg px-2 py-0.5 text-xs ${
                      plan.status === 'approved' ? 'bg-accent/10 text-accent' : 'bg-ink/5 text-ink/60'
                    }`}
                  >
                    {STATUS_LABELS[plan.status]}
                  </span>
                </div>
                {canManage && plan.status === 'draft' && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => deletePlan(plan.id)}
                      disabled={busy}
                      className="text-xs text-danger/70 hover:text-danger"
                    >
                      حذف الخطة
                    </button>
                    <button
                      onClick={() => approvePlan(plan.id)}
                      disabled={busy || plan.items.length === 0}
                      className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1 text-xs text-white hover:bg-accent-hover disabled:opacity-60"
                    >
                      <FontAwesomeIcon icon={faCheck} />
                      اعتماد وجدولة الجلسات
                    </button>
                  </div>
                )}
                {canManage && plan.status === 'approved' && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => cancelPlan(plan.id)}
                      disabled={busy}
                      className="text-xs text-danger/70 hover:text-danger"
                    >
                      إلغاء الخطة
                    </button>
                    <button
                      onClick={() => scheduleSessions(plan.id)}
                      disabled={busy}
                      className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1 text-xs text-white hover:bg-accent-hover disabled:opacity-60"
                    >
                      <FontAwesomeIcon icon={faCalendarPlus} />
                      جدولة الجلسات
                    </button>
                  </div>
                )}
                {canManage && plan.status === 'cancelled' && (
                  <button
                    onClick={() => deletePlan(plan.id)}
                    disabled={busy}
                    className="text-xs text-danger/70 hover:text-danger"
                  >
                    حذف الخطة
                  </button>
                )}
              </div>

              <table className="mb-2 w-full text-xs">
                <thead>
                  <tr className="text-ink/50">
                    <th className="p-1 text-start font-normal">الخدمة</th>
                    <th className="p-1 text-start font-normal">السن</th>
                    <th className="p-1 text-start font-normal">السعر</th>
                    <th className="p-1 text-start font-normal">الجلسات</th>
                    <th className="p-1 text-start font-normal">الفاصلة</th>
                    <th className="p-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {groupItems(plan.items).map((group) => {
                    const isSingle = group.items.length === 1
                    const isExpanded = isSingle || expandedGroups.has(group.key)
                    const teeth = group.items.map((i) => i.tooth_number).filter((n): n is number => n !== null)
                    const totalPrice = group.items.reduce((sum, i) => sum + Number(i.unit_price) * i.sessions_count, 0)
                    const totalSessions = group.items.reduce((sum, i) => sum + i.sessions_count, 0)
                    const doneSessions = group.items.reduce((sum, i) => sum + (i.sessions?.filter((s) => s.status === 'done').length ?? 0), 0)
                    const first = group.items[0]

                    return (
                      <Fragment key={group.key}>
                        <tr className="border-t border-ink/5">
                          <td className="p-1">
                            {!isSingle && (
                              <button onClick={() => toggleGroup(group.key)} className="ml-1 text-ink/40 hover:text-ink">
                                <FontAwesomeIcon icon={isExpanded ? faChevronDown : faChevronLeft} />
                              </button>
                            )}
                            {first.service_name}
                          </td>
                          {/* Collapsed group row deliberately shows only the service name + session count —
                              teeth/price/interval are per-tooth details that only make sense once expanded. */}
                          <td className="p-1">{isSingle || isExpanded ? (teeth.length > 0 ? describeTeeth(teeth, isChild) : '—') : ''}</td>
                          <td className="p-1">{isSingle || isExpanded ? `${totalPrice.toFixed(2)} ${first.currency}` : ''}</td>
                          <td className="p-1">
                            {totalSessions}
                            {plan.status === 'approved' && <span className="text-ink/40"> ({doneSessions} محسوبة)</span>}
                          </td>
                          <td className="p-1 text-ink/60">
                            {isSingle || isExpanded
                              ? first.interval_days
                                ? `كل ${first.interval_days} يوم`
                                : `افتراضي الخدمة (${services.find((s) => s.id === first.service_id)?.default_interval_days ?? 7} يوم)`
                              : ''}
                          </td>
                          <td className="p-1">
                            {plan.status === 'draft' && canManage && (
                              <button
                                onClick={() => (isSingle ? removeItem(plan.id, first.id) : removeGroup(plan.id, group.items.map((i) => i.id)))}
                                className="text-danger/70 hover:text-danger"
                              >
                                حذف
                              </button>
                            )}
                            {plan.status === 'approved' && canManage && (
                              <button
                                onClick={() => (isSingle ? cancelItem(plan.id, first.id) : cancelGroup(plan.id, group.items.map((i) => i.id)))}
                                disabled={busy}
                                className="text-danger/70 hover:text-danger disabled:opacity-60"
                              >
                                إلغاء الكل
                              </button>
                            )}
                          </td>
                        </tr>

                        {!isSingle && isExpanded && group.items.map((item) => (
                          <tr key={item.id} className="border-t border-ink/5 bg-background/30">
                            <td colSpan={6} className="p-1 ps-6 text-[11px] text-ink/60">
                              سن {item.tooth_number} — {item.unit_price} {item.currency}
                              {plan.status === 'approved' && canManage && (
                                <button onClick={() => cancelItem(plan.id, item.id)} disabled={busy} className="mr-3 text-danger/70 hover:text-danger disabled:opacity-60">
                                  إلغاء هالسن
                                </button>
                              )}
                              {plan.status === 'draft' && canManage && (
                                <button onClick={() => removeItem(plan.id, item.id)} className="mr-3 text-danger/70 hover:text-danger">
                                  حذف هالسن
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}

                      {plan.status === 'approved' && isExpanded && group.items.flatMap((item) => (item.sessions ?? []).map((session) => (
                        <tr key={session.id} className="border-t border-ink/5 bg-background/50">
                          <td colSpan={6} className="p-1 ps-4">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-ink/60">
                                جلسة {session.session_number}/{item.sessions_count} —{' '}
                                <span
                                  className={
                                    session.status === 'done'
                                      ? 'text-accent'
                                      : session.status === 'cancelled'
                                        ? 'text-danger/70'
                                        : 'text-ink/50'
                                  }
                                >
                                  {SESSION_STATUS_LABELS[session.status]}
                                </span>
                              </span>
                              {canManage && (session.status === 'pending' || session.status === 'scheduled') && (
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => setOpenSessionId(openSessionId === session.id ? null : session.id)}
                                    className="rounded-lg bg-accent px-2 py-1 text-white hover:bg-accent-hover"
                                  >
                                    تمّت + حاسب
                                  </button>
                                  <button
                                    onClick={() => cancelSessionAction(plan.id, item.id, session.id)}
                                    disabled={busy}
                                    className="text-danger/70 hover:text-danger disabled:opacity-60"
                                  >
                                    إلغاء
                                  </button>
                                </div>
                              )}
                              {canManage && session.status === 'done' && (
                                <button
                                  onClick={() => cancelSessionAction(plan.id, item.id, session.id)}
                                  disabled={busy}
                                  className="text-danger/70 hover:text-danger disabled:opacity-60"
                                >
                                  إلغاء (استرجاع)
                                </button>
                              )}
                            </div>

                            {openSessionId === session.id && (
                              <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-ink/10 bg-white p-2">
                                <div>
                                  <label className="mb-1 block text-[10px] text-ink/50">السعر</label>
                                  <input
                                    type="number"
                                    value={sessionFormFor(session.id, item.unit_price).price}
                                    onChange={(e) =>
                                      setSessionForm({
                                        ...sessionForm,
                                        [session.id]: { ...sessionFormFor(session.id, item.unit_price), price: e.target.value },
                                      })
                                    }
                                    className="w-20 rounded-lg border border-ink/10 px-2 py-1 text-xs"
                                  />
                                </div>
                                <div>
                                  <label className="mb-1 block text-[10px] text-ink/50">خصم</label>
                                  <div className="flex gap-1">
                                    <select
                                      value={sessionFormFor(session.id, item.unit_price).discount_type}
                                      onChange={(e) =>
                                        setSessionForm({
                                          ...sessionForm,
                                          [session.id]: { ...sessionFormFor(session.id, item.unit_price), discount_type: e.target.value as 'percent' | 'fixed' },
                                        })
                                      }
                                      className="rounded-lg border border-ink/10 px-1 py-1 text-xs text-ink/60"
                                    >
                                      <option value="percent">%</option>
                                      <option value="fixed">₪</option>
                                    </select>
                                    <input
                                      type="number"
                                      placeholder="0"
                                      value={sessionFormFor(session.id, item.unit_price).discount_value}
                                      onChange={(e) =>
                                        setSessionForm({
                                          ...sessionForm,
                                          [session.id]: { ...sessionFormFor(session.id, item.unit_price), discount_value: e.target.value },
                                        })
                                      }
                                      className="w-14 rounded-lg border border-ink/10 px-1 py-1 text-xs"
                                    />
                                  </div>
                                </div>
                                <label className="flex items-center gap-1 text-[10px] text-ink/60">
                                  <input
                                    type="checkbox"
                                    checked={sessionFormFor(session.id, item.unit_price).pay_now}
                                    onChange={(e) =>
                                      setSessionForm({
                                        ...sessionForm,
                                        [session.id]: { ...sessionFormFor(session.id, item.unit_price), pay_now: e.target.checked },
                                      })
                                    }
                                  />
                                  دفع الآن
                                </label>
                                {sessionFormFor(session.id, item.unit_price).pay_now && (
                                  <div>
                                    <label className="mb-1 block text-[10px] text-ink/50">الصندوق</label>
                                    <select
                                      value={sessionFormFor(session.id, item.unit_price).cashbox_id}
                                      onChange={(e) =>
                                        setSessionForm({
                                          ...sessionForm,
                                          [session.id]: { ...sessionFormFor(session.id, item.unit_price), cashbox_id: e.target.value },
                                        })
                                      }
                                      className="rounded-lg border border-ink/10 px-2 py-1 text-xs"
                                    >
                                      {cashboxes.map((c) => (
                                        <option key={c.id} value={c.id}>{c.name}</option>
                                      ))}
                                    </select>
                                  </div>
                                )}
                                <p className="text-[10px] text-accent">
                                  السعر بعد الخصم: {sessionDiscountedPrice(sessionFormFor(session.id, item.unit_price)).toFixed(2)} ₪
                                </p>
                                <button
                                  onClick={() => completeSession(plan.id, item.id, session.id, item.unit_price)}
                                  disabled={busy}
                                  className="rounded-lg bg-accent px-3 py-1 text-xs text-white hover:bg-accent-hover disabled:opacity-60"
                                >
                                  تأكيد
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      )))}
                      </Fragment>
                    )
                  })}

                  {plan.status === 'draft' && canManage && (
                    <tr className="border-t border-ink/10">
                      <td className="p-1 align-top">
                        <SearchableSelect
                          options={services.map((s) => ({ value: String(s.id), label: s.name, sublabel: `${s.default_price} ₪` }))}
                          value={itemFormFor(plan.id).service_id}
                          onChange={(value) =>
                            setItemForm({
                              ...itemForm,
                              [plan.id]: {
                                ...itemFormFor(plan.id),
                                service_id: value,
                                unit_price: services.find((s) => s.id === Number(value))?.default_price ?? '',
                              },
                            })
                          }
                          placeholder="خدمة..."
                        />
                      </td>
                      <td className="p-1 align-top">
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="رقم السن (أو عدة أسنان)"
                          value={itemFormFor(plan.id).tooth_number}
                          onChange={(e) => setItemForm({ ...itemForm, [plan.id]: { ...itemFormFor(plan.id), tooth_number: e.target.value } })}
                          onFocus={() => onRequestPickTooth?.(plan.id)}
                          title="اكتب رقم/أرقام الأسنان يدوياً (مفصولة بفاصلة)، أو اضغط عالحقل وحدد من الرسمة"
                          className={`w-full rounded-lg border px-2 py-1 text-xs ${
                            pickingForPlanId === plan.id ? 'border-accent ring-1 ring-accent/30' : 'border-ink/10'
                          }`}
                        />
                      </td>
                      <td className="p-1 align-top">
                        <input
                          type="number"
                          placeholder="السعر"
                          value={itemFormFor(plan.id).unit_price}
                          onChange={(e) => setItemForm({ ...itemForm, [plan.id]: { ...itemFormFor(plan.id), unit_price: e.target.value } })}
                          className="mb-1 w-full rounded-lg border border-ink/10 px-2 py-1 text-xs"
                        />
                        <div className="flex gap-1">
                          <select
                            value={itemFormFor(plan.id).discount_type}
                            onChange={(e) => setItemForm({ ...itemForm, [plan.id]: { ...itemFormFor(plan.id), discount_type: e.target.value as 'percent' | 'fixed' } })}
                            className="rounded-lg border border-ink/10 px-1 py-1 text-xs text-ink/60"
                            title="نوع الخصم"
                          >
                            <option value="percent">خصم %</option>
                            <option value="fixed">خصم ₪</option>
                          </select>
                          <input
                            type="number"
                            placeholder="0"
                            value={itemFormFor(plan.id).discount_value}
                            onChange={(e) => setItemForm({ ...itemForm, [plan.id]: { ...itemFormFor(plan.id), discount_value: e.target.value } })}
                            className="w-14 rounded-lg border border-ink/10 px-1 py-1 text-xs"
                            title="قيمة الخصم"
                          />
                        </div>
                        {Number(itemFormFor(plan.id).discount_value) > 0 && (
                          <p className="mt-0.5 text-[10px] text-accent">
                            السعر بعد الخصم: {discountedPrice(itemFormFor(plan.id)).toFixed(2)} ₪
                          </p>
                        )}
                      </td>
                      <td className="p-1 align-top">
                        <input
                          type="number"
                          placeholder="الجلسات"
                          value={itemFormFor(plan.id).sessions_count}
                          onChange={(e) => setItemForm({ ...itemForm, [plan.id]: { ...itemFormFor(plan.id), sessions_count: e.target.value } })}
                          className="w-full rounded-lg border border-ink/10 px-2 py-1 text-xs"
                        />
                      </td>
                      <td className="p-1 align-top">
                        <select
                          value={itemFormFor(plan.id).interval_days}
                          onChange={(e) => setItemForm({ ...itemForm, [plan.id]: { ...itemFormFor(plan.id), interval_days: e.target.value } })}
                          className="w-full rounded-lg border border-ink/10 px-2 py-1 text-xs"
                        >
                          <option value="">افتراضي الخدمة</option>
                          <option value="1">يومياً</option>
                          <option value="7">أسبوعياً</option>
                          <option value="14">كل أسبوعين</option>
                          <option value="30">شهرياً</option>
                        </select>
                      </td>
                      <td className="p-1 align-top">
                        <button
                          onClick={() => addItem(plan.id)}
                          disabled={busy}
                          className="whitespace-nowrap rounded-lg bg-accent px-2 py-1 text-xs text-white hover:bg-accent-hover disabled:opacity-60"
                        >
                          إضافة
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
