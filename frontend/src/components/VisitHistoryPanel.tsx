import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTrash, faSave, faMoneyBill, faChevronDown, faChevronLeft, faTooth } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { Card, Badge, SearchableSelect } from './ui'
import type { BadgeVariant } from './ui'
import { describeTeeth } from '../lib/dental'
import MiniToothDiagram from './MiniToothDiagram'
import type { Cashbox, Visit } from '../types'

interface VisitGroup {
  key: string
  visits: Visit[]
}

/** All teeth a visit covers — tooth_numbers if the session's item has several, else the single tooth_number, else none. */
function visitTeeth(v: Visit): number[] {
  if (v.tooth_numbers && v.tooth_numbers.length > 0) return v.tooth_numbers
  return v.tooth_number ? [v.tooth_number] : []
}

/** Visits created together in one "add" action (several teeth picked for the same service in one go) share a batch_id, so they show as one grouped entry with a "press for detail" list instead of a separate row per tooth. */
function groupVisits(visits: Visit[]): VisitGroup[] {
  const order: string[] = []
  const map = new Map<string, Visit[]>()
  for (const v of visits) {
    // Same fallback as TreatmentPlanPanel's groupItems: visits from before
    // batch_id existed still group if they're the same service within the
    // same minute, instead of listing every tooth as its own entry.
    const minuteBucket = Math.floor(new Date(v.created_at).getTime() / 60000)
    const key = v.batch_id ?? `legacy-${v.service_name}-${minuteBucket}`
    if (!map.has(key)) {
      map.set(key, [])
      order.push(key)
    }
    map.get(key)!.push(v)
  }
  return order.map((key) => ({ key, visits: map.get(key)! }))
}

const INVOICE_STATUS_LABELS: Record<string, string> = {
  unpaid: 'غير مدفوعة',
  partial: 'مدفوعة جزئياً',
  paid: 'مدفوعة',
  void: 'ملغاة (مسترجعة)',
}

const INVOICE_STATUS_VARIANTS: Record<string, BadgeVariant> = {
  unpaid: 'danger',
  partial: 'warning',
  paid: 'success',
  void: 'neutral',
}

export default function VisitHistoryPanel({ patientId, isChild = false, onChanged }: { patientId: number; isChild?: boolean; onChanged?: () => void }) {
  const { can } = useAuth()
  const canManage = can('treatment_plans.manage')
  const canCollect = can('billing.manage')

  const [visits, setVisits] = useState<Visit[]>([])
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([])
  const [openId, setOpenId] = useState<number | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [diagramFor, setDiagramFor] = useState<string | null>(null)

  function toggleDiagram(key: string) {
    setDiagramFor((prev) => (prev === key ? null : key))
  }

  function toggleGroup(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const [editPrice, setEditPrice] = useState<Record<number, string>>({})
  const [editNote, setEditNote] = useState<Record<number, string>>({})
  const [payAmount, setPayAmount] = useState<Record<number, string>>({})
  const [payCashboxId, setPayCashboxId] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState(false)

  function load() {
    api.get(`/patients/${patientId}/visits`).then((res) => setVisits(res.data))
  }

  useEffect(() => {
    load()
    api.get('/cashboxes').then((res) => setCashboxes(res.data))
  }, [patientId])

  function open(v: Visit) {
    if (openId === v.session_id) {
      setOpenId(null)
      return
    }
    setOpenId(v.session_id)
    setEditPrice({ ...editPrice, [v.session_id]: v.price })
    setEditNote({ ...editNote, [v.session_id]: v.note ?? '' })
    setPayAmount({ ...payAmount, [v.session_id]: v.price })
    const ils = cashboxes.find((c) => c.currency === 'ILS')
    if (ils) setPayCashboxId({ ...payCashboxId, [v.session_id]: String(ils.id) })
  }

  async function saveEdit(v: Visit) {
    setBusy(true)
    try {
      await api.patch(`/treatment-plans/${v.plan_id}/items/${v.item_id}/sessions/${v.session_id}`, {
        price: Number(editPrice[v.session_id]),
        note: editNote[v.session_id],
      })
      load()
      onChanged?.()
    } finally {
      setBusy(false)
    }
  }

  async function deleteVisit(v: Visit) {
    if (!window.confirm('حذف هالزيارة نهائياً؟ رح يترد مبلغها كرصيد للمريض، وأي سن مسجل عليها يرجع لونه.')) return
    setBusy(true)
    try {
      await api.post(`/treatment-plans/${v.plan_id}/items/${v.item_id}/sessions/${v.session_id}/cancel`)
      setOpenId(null)
      load()
      onChanged?.()
    } finally {
      setBusy(false)
    }
  }

  async function deleteGroup(group: VisitGroup) {
    if (!window.confirm(`حذف كل الزيارة (${group.visits.length} سن) نهائياً؟ رح يترد مبلغها كرصيد للمريض، وكل الأسنان ترجع ألوانها.`)) return
    setBusy(true)
    try {
      await Promise.all(
        group.visits
          .filter((v) => v.session_id)
          .map((v) => api.post(`/treatment-plans/${v.plan_id}/items/${v.item_id}/sessions/${v.session_id}/cancel`)),
      )
      setOpenId(null)
      load()
      onChanged?.()
    } finally {
      setBusy(false)
    }
  }

  async function collect(v: Visit) {
    const cashboxId = payCashboxId[v.session_id]
    const amount = Number(payAmount[v.session_id])
    if (!cashboxId || !amount) return
    const box = cashboxes.find((c) => c.id === Number(cashboxId))
    if (!box) return
    setBusy(true)
    try {
      await api.post(`/patients/${patientId}/payments`, {
        invoice_id: v.invoice_id,
        cashbox_id: box.id,
        amount,
        currency: box.currency,
        exchange_rate: 1,
        method: 'cash',
      })
      load()
      onChanged?.()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="p-6">
      <h2 className="mb-3 text-sm font-medium text-muted">سجل الجلسات</h2>
      {visits.length === 0 ? (
        <p className="text-sm text-muted">لا توجد زيارات محسوبة بعد.</p>
      ) : (
        <div className="space-y-2">
          {groupVisits(visits).map((group) => {
            const isSingle = group.visits.length === 1
            const isExpanded = isSingle || expandedGroups.has(group.key)
            const first = group.visits[0]
            const teeth = group.visits.flatMap(visitTeeth)
            const totalPrice = group.visits.reduce((sum, v) => sum + Number(v.price), 0)

            if (isSingle) {
              return <VisitRow key={group.key} v={first} />
            }

            return (
              <div key={group.key} className="relative rounded-lg border border-ink/10">
                <div
                  onClick={() => toggleGroup(group.key)}
                  className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-sm hover:bg-background"
                >
                  <div className="flex items-center gap-2">
                    <FontAwesomeIcon icon={isExpanded ? faChevronDown : faChevronLeft} className="text-ink/40" />
                    <span className="font-medium text-ink">{first.service_name ?? 'خدمة'}</span>
                    {teeth.length > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleDiagram(group.key)
                        }}
                        className={`flex items-center gap-1 rounded-lg border px-1.5 py-0.5 text-xs ${diagramFor === group.key ? 'border-accent text-accent' : 'border-ink/10 text-muted hover:border-accent hover:text-accent'}`}
                      >
                        <FontAwesomeIcon icon={faTooth} />
                        {describeTeeth(teeth, isChild)}
                      </button>
                    )}
                    {first.doctor_name && <span className="text-xs text-muted">— {first.doctor_name}</span>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-ink">{totalPrice.toFixed(2)} ₪</span>
                    <Badge variant={INVOICE_STATUS_VARIANTS[first.invoice_status]}>{INVOICE_STATUS_LABELS[first.invoice_status]}</Badge>
                    <span className="text-xs text-muted">{first.date}</span>
                  </div>
                </div>

                {diagramFor === group.key && (
                  <div className="absolute right-3 top-full z-20 mt-1 rounded-xl border border-ink/10 bg-white p-3 shadow-lg">
                    <MiniToothDiagram teeth={teeth} isChild={isChild} />
                  </div>
                )}

                {isExpanded && (
                  <div className="space-y-1 border-t border-ink/10 p-2">
                    {canManage && (
                      <div className="flex justify-end px-1">
                        <button
                          onClick={() => deleteGroup(group)}
                          disabled={busy}
                          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-danger hover:bg-danger-soft disabled:opacity-60"
                        >
                          <FontAwesomeIcon icon={faTrash} />
                          حذف الكل ({group.visits.length})
                        </button>
                      </div>
                    )}
                    {group.visits.map((v) => (
                      <VisitRow key={v.session_id ?? `${v.item_id}-${v.tooth_number}`} v={v} nested />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )

  function VisitRow({ v, nested = false }: { v: Visit; nested?: boolean }) {
    const teeth = visitTeeth(v)
    const diagramKey = `visit-${v.session_id ?? `${v.item_id}-${v.tooth_number}`}`
    return (
      <div className={`relative ${nested ? 'rounded-lg bg-background/60' : 'rounded-lg border border-ink/10'}`}>
        <div
          onClick={() => open(v)}
          className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-sm hover:bg-background"
        >
          <div className="flex items-center gap-2">
            <span className="font-medium text-ink">{v.service_name ?? 'خدمة'}</span>
            {teeth.length > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  toggleDiagram(diagramKey)
                }}
                className={`flex items-center gap-1 rounded-lg border px-1.5 py-0.5 text-xs ${diagramFor === diagramKey ? 'border-accent text-accent' : 'border-ink/10 text-muted hover:border-accent hover:text-accent'}`}
              >
                <FontAwesomeIcon icon={faTooth} />
                {describeTeeth(teeth, isChild)}
              </button>
            )}
            {!nested && v.doctor_name && <span className="text-xs text-muted">— {v.doctor_name}</span>}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-ink">{v.price} ₪</span>
            {!nested && <Badge variant={INVOICE_STATUS_VARIANTS[v.invoice_status]}>{INVOICE_STATUS_LABELS[v.invoice_status]}</Badge>}
            <span className="text-xs text-muted">{v.date}</span>
          </div>
        </div>

        {diagramFor === diagramKey && (
          <div className="absolute right-3 top-full z-20 mt-1 rounded-xl border border-ink/10 bg-white p-3 shadow-lg">
            <MiniToothDiagram teeth={teeth} isChild={isChild} />
          </div>
        )}

        {openId === v.session_id && (
                <div className="space-y-3 border-t border-ink/10 p-3">
                  {!v.session_id ? (
                    <p className="text-xs text-ink/50">
                      {v.note || 'زيارة قديمة مسجّلة قبل ربط الزيارات بالجلسات — غير قابلة للتعديل، بس تقدر تحصّل دفعتها تحت.'}
                    </p>
                  ) : canManage ? (
                    <>
                      <div className="flex items-end gap-2">
                        <div>
                          <label className="mb-1 block text-[11px] text-muted">السعر</label>
                          <input
                            type="number"
                            value={editPrice[v.session_id] ?? ''}
                            onChange={(e) => setEditPrice({ ...editPrice, [v.session_id]: e.target.value })}
                            className="w-24 rounded-lg border border-ink/10 px-2 py-1 text-sm"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="mb-1 block text-[11px] text-muted">ملاحظة</label>
                          <input
                            value={editNote[v.session_id] ?? ''}
                            onChange={(e) => setEditNote({ ...editNote, [v.session_id]: e.target.value })}
                            placeholder="ملاحظة عن هالزيارة..."
                            className="w-full rounded-lg border border-ink/10 px-2 py-1 text-sm"
                          />
                        </div>
                        <button
                          onClick={() => saveEdit(v)}
                          disabled={busy}
                          className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent-hover disabled:opacity-60"
                        >
                          <FontAwesomeIcon icon={faSave} />
                          حفظ
                        </button>
                        <button
                          onClick={() => deleteVisit(v)}
                          disabled={busy}
                          className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-danger hover:bg-danger-soft disabled:opacity-60"
                        >
                          <FontAwesomeIcon icon={faTrash} />
                          حذف
                        </button>
                      </div>
                    </>
                  ) : (
                    v.note && <p className="text-sm text-ink">{v.note}</p>
                  )}

                  {canCollect && v.invoice_status !== 'paid' && v.invoice_status !== 'void' && (
                    <div className="flex items-end gap-2 border-t border-ink/5 pt-2">
                      <div>
                        <label className="mb-1 block text-[11px] text-muted">الصندوق</label>
                        <SearchableSelect
                          options={cashboxes.map((c) => ({ value: String(c.id), label: c.name, sublabel: c.currency }))}
                          value={payCashboxId[v.session_id] ?? ''}
                          onChange={(value) => setPayCashboxId({ ...payCashboxId, [v.session_id]: value })}
                          placeholder="الصندوق..."
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] text-muted">المبلغ</label>
                        <input
                          type="number"
                          value={payAmount[v.session_id] ?? ''}
                          onChange={(e) => setPayAmount({ ...payAmount, [v.session_id]: e.target.value })}
                          className="w-24 rounded-lg border border-ink/10 px-2 py-1 text-sm"
                        />
                      </div>
                      <button
                        onClick={() => collect(v)}
                        disabled={busy}
                        className="flex items-center gap-1 rounded-lg bg-success-soft px-3 py-1.5 text-xs font-medium text-success hover:opacity-80 disabled:opacity-60"
                      >
                        <FontAwesomeIcon icon={faMoneyBill} />
                        تحصيل دفعة
                      </button>
                    </div>
                  )}
                </div>
              )}
      </div>
    )
  }
}
