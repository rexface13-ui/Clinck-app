import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faMoneyBill, faChevronDown, faChevronLeft, faTooth, faPrint, faTriangleExclamation, faFileMedical } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { formatDate } from '../lib/formatDate'
import { printDocument, metaRow } from '../lib/print'
import { useClinicProfile } from '../lib/useClinicProfile'
import { Card, Badge, SearchableSelect } from './ui'
import type { BadgeVariant } from './ui'
import { describeTeeth } from '../lib/dental'
import MiniToothDiagram from './MiniToothDiagram'
import type { Cashbox, Prescription, Visit } from '../types'

interface VisitGroup {
  key: string
  visits: Visit[]
}

/** All teeth a visit covers. */
function visitTeeth(v: Visit): number[] {
  if (v.tooth_numbers && v.tooth_numbers.length > 0) return v.tooth_numbers
  return v.tooth_number ? [v.tooth_number] : []
}

/** Visits billed together in one invoice line (a flat-fee service covering several teeth at once) share a batch_id, so they show as one grouped entry instead of a separate row per tooth. */
function groupVisits(visits: Visit[]): VisitGroup[] {
  const order: string[] = []
  const map = new Map<string, Visit[]>()
  for (const v of visits) {
    const key = v.batch_id ?? `single-${v.session_id ?? v.invoice_id}`
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

export default function VisitHistoryPanel({
  patientId,
  patientName,
  isChild = false,
  medicalAlerts = [],
  onChanged,
}: {
  patientId: number
  patientName?: string
  isChild?: boolean
  medicalAlerts?: string[]
  onChanged?: () => void
}) {
  const { can } = useAuth()
  const canCollect = can('billing.manage')
  const clinic = useClinicProfile()
  const [prescribingFor, setPrescribingFor] = useState<string | null>(null)
  const [medsText, setMedsText] = useState<Record<string, string>>({})
  const [prescriptionsVersion, setPrescriptionsVersion] = useState(0)

  function printPrescriptionFor(key: string, v: Visit) {
    const meds = medsText[key] ?? ''
    if (!meds.trim()) return
    const body = `
      ${metaRow([
        ['المريض', patientName ?? ''],
        ['التاريخ', formatDate(new Date().toISOString())],
        ...(v.doctor_name ? ([['الطبيب', v.doctor_name]] as [string, string][]) : []),
      ])}
      <p style="font-size:13px;margin-bottom:6px;"><b>الأدوية:</b></p>
      <div style="white-space:pre-wrap;font-size:14px;line-height:1.9;border:1px solid #ddd;border-radius:8px;padding:14px;min-height:120px;">${meds.replace(/\n/g, '<br/>')}</div>
      <div class="signature"><div>توقيع الطبيب</div></div>
    `
    printDocument('وصفة طبية', body, clinic)
    api.post('/prescriptions', { patient_id: patientId, medications: meds }).then(() => setPrescriptionsVersion((n) => n + 1))
    setPrescribingFor(null)
  }

  const [visits, setVisits] = useState<Visit[]>([])
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([])
  const [showPrescriptions, setShowPrescriptions] = useState(false)
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([])
  const [openKey, setOpenKey] = useState<string | null>(null)
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
  const [payAmount, setPayAmount] = useState<Record<string, string>>({})
  const [payCashboxId, setPayCashboxId] = useState<Record<string, string>>({})
  const [payExchangeRate, setPayExchangeRate] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  function load() {
    api.get(`/patients/${patientId}/visits`).then((res) => setVisits(res.data))
  }

  useEffect(() => {
    load()
    api.get('/cashboxes').then((res) => setCashboxes(res.data))
  }, [patientId])

  useEffect(() => {
    api.get('/prescriptions', { params: { patient_id: patientId } }).then((res) => setPrescriptions(res.data.data))
  }, [patientId, prescriptionsVersion])

  function open(key: string, v: Visit) {
    if (openKey === key) {
      setOpenKey(null)
      return
    }
    setOpenKey(key)
    setPayAmount({ ...payAmount, [key]: v.price })
    const ils = cashboxes.find((c) => c.currency === 'ILS')
    if (ils) setPayCashboxId({ ...payCashboxId, [key]: String(ils.id) })
  }

  async function collect(key: string, v: Visit) {
    const boxId = payCashboxId[key]
    const amount = Number(payAmount[key])
    if (!boxId || !amount) return
    const box = cashboxes.find((c) => c.id === Number(boxId))
    if (!box) return
    const exchangeRate = Number(payExchangeRate[key]) || 1
    if (box.currency !== 'ILS' && exchangeRate <= 0) return
    setBusy(true)
    try {
      await api.post(`/patients/${patientId}/payments`, {
        invoice_id: v.invoice_id,
        cashbox_id: box.id,
        amount,
        currency: box.currency,
        exchange_rate: exchangeRate,
        method: 'cash',
      })
      load()
      onChanged?.()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      {prescriptions.length > 0 && (
        <Card className="mb-4 p-6">
          <button
            onClick={() => setShowPrescriptions((v) => !v)}
            className="flex w-full items-center justify-between text-sm font-medium text-muted"
          >
            <span className="flex items-center gap-2">
              <FontAwesomeIcon icon={faFileMedical} className="text-accent" />
              سجل الوصفات ({prescriptions.length})
            </span>
            <FontAwesomeIcon icon={showPrescriptions ? faChevronDown : faChevronLeft} className="text-ink/40" />
          </button>
          {showPrescriptions && (
            <div className="mt-3 space-y-2">
              {prescriptions.map((p) => (
                <div key={p.id} className="rounded-lg border border-ink/10 p-3 text-sm">
                  <div className="mb-1 flex items-center justify-between text-xs text-muted">
                    <span>{p.created_at}</span>
                    {p.doctor_name && <span>{p.doctor_name}</span>}
                  </div>
                  <p className="whitespace-pre-wrap text-ink">{p.medications}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
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
              return <VisitRow key={group.key} rowKey={group.key} v={first} />
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
                    {group.visits.map((v, i) => (
                      <VisitRow key={`${group.key}-${i}`} rowKey={`${group.key}-${i}`} v={v} nested />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Card>
    </div>
  )

  function VisitRow({ rowKey, v, nested = false }: { rowKey: string; v: Visit; nested?: boolean }) {
    const teeth = visitTeeth(v)
    const diagramKey = `visit-${rowKey}`
    return (
      <div className={`relative ${nested ? 'rounded-lg bg-background/60' : 'rounded-lg border border-ink/10'}`}>
        <div
          onClick={() => open(rowKey, v)}
          className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-sm hover:bg-background"
        >
          <div className="flex items-center gap-2">
            <span className="font-medium text-ink">{v.service_name ?? 'خدمة'}</span>
            {v.step_title && <span className="text-xs text-muted">— {v.step_title}</span>}
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

        {openKey === rowKey && (
                <div className="space-y-3 border-t border-ink/10 p-3">
                  {v.note && <p className="text-sm text-ink">{v.note}</p>}

                  <div className="border-t border-ink/5 pt-2">
                    {prescribingFor === rowKey ? (
                      <div className="space-y-2">
                        {medicalAlerts.length > 0 && (
                          <div className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
                            <FontAwesomeIcon icon={faTriangleExclamation} className="mt-0.5" />
                            <span>تنبيه حساسية: {medicalAlerts.join('، ')}</span>
                          </div>
                        )}
                        <textarea
                          value={medsText[rowKey] ?? ''}
                          onChange={(e) => setMedsText({ ...medsText, [rowKey]: e.target.value })}
                          placeholder={'الأدوية...\nمثال: Amoxicillin 500mg — كل 8 ساعات لمدة 5 أيام'}
                          rows={3}
                          className="w-full rounded-lg border border-ink/10 px-2 py-1.5 text-sm"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => printPrescriptionFor(rowKey, v)}
                            disabled={!(medsText[rowKey] ?? '').trim()}
                            className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent-hover disabled:opacity-40"
                          >
                            <FontAwesomeIcon icon={faPrint} />
                            طباعة
                          </button>
                          <button onClick={() => setPrescribingFor(null)} className="rounded-lg px-3 py-1.5 text-xs text-muted hover:bg-background">
                            إلغاء
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setPrescribingFor(rowKey)}
                        className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-ink/60 hover:bg-background hover:text-accent"
                      >
                        <FontAwesomeIcon icon={faPrint} />
                        كتابة وصفة طبية وطباعتها
                      </button>
                    )}
                  </div>

                  {canCollect && v.invoice_status !== 'paid' && v.invoice_status !== 'void' && (
                    <div className="flex items-end gap-2 border-t border-ink/5 pt-2">
                      <div>
                        <label className="mb-1 block text-[11px] text-muted">الصندوق</label>
                        <SearchableSelect
                          options={cashboxes.map((c) => ({ value: String(c.id), label: c.name, sublabel: c.currency }))}
                          value={payCashboxId[rowKey] ?? ''}
                          onChange={(value) => setPayCashboxId({ ...payCashboxId, [rowKey]: value })}
                          placeholder="الصندوق..."
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] text-muted">المبلغ</label>
                        <input
                          type="number"
                          value={payAmount[rowKey] ?? ''}
                          onChange={(e) => setPayAmount({ ...payAmount, [rowKey]: e.target.value })}
                          className="w-24 rounded-lg border border-ink/10 px-2 py-1 text-sm"
                        />
                      </div>
                      {(() => {
                        const box = cashboxes.find((c) => c.id === Number(payCashboxId[rowKey]))
                        if (!box || box.currency === 'ILS') return null
                        return (
                          <div>
                            <label className="mb-1 block text-[11px] text-muted">سعر الصرف (₪)</label>
                            <input
                              type="number"
                              step="0.01"
                              value={payExchangeRate[rowKey] ?? ''}
                              onChange={(e) => setPayExchangeRate({ ...payExchangeRate, [rowKey]: e.target.value })}
                              className="w-20 rounded-lg border border-ink/10 px-2 py-1 text-sm"
                            />
                          </div>
                        )
                      })()}
                      <button
                        onClick={() => collect(rowKey, v)}
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
