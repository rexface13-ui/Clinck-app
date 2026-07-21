import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTrash, faSave, faMoneyBill } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { Card, Badge, SearchableSelect } from './ui'
import type { BadgeVariant } from './ui'
import type { Cashbox, Visit } from '../types'

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

export default function VisitHistoryPanel({ patientId, onChanged }: { patientId: number; onChanged?: () => void }) {
  const { can } = useAuth()
  const canManage = can('treatment_plans.manage')
  const canCollect = can('billing.manage')

  const [visits, setVisits] = useState<Visit[]>([])
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([])
  const [openId, setOpenId] = useState<number | null>(null)
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
      <h2 className="mb-3 text-sm font-medium text-muted">سجل الزيارات</h2>
      {visits.length === 0 ? (
        <p className="text-sm text-muted">لا توجد زيارات محسوبة بعد.</p>
      ) : (
        <div className="space-y-2">
          {visits.map((v) => (
            <div key={v.session_id} className="rounded-lg border border-ink/10">
              <button
                onClick={() => open(v)}
                className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-background"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink">{v.service_name ?? 'خدمة'}</span>
                  {v.tooth_number && <span className="text-xs text-muted">سن {v.tooth_number}</span>}
                  {v.doctor_name && <span className="text-xs text-muted">— {v.doctor_name}</span>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-ink">{v.price} ₪</span>
                  <Badge variant={INVOICE_STATUS_VARIANTS[v.invoice_status]}>{INVOICE_STATUS_LABELS[v.invoice_status]}</Badge>
                  <span className="text-xs text-muted">{v.date}</span>
                </div>
              </button>

              {openId === v.session_id && (
                <div className="space-y-3 border-t border-ink/10 p-3">
                  {canManage ? (
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
          ))}
        </div>
      )}
    </Card>
  )
}
