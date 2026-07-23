import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTrash, faCheck } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import DatePicker from './DatePicker'
import { Modal, Button, SearchableSelect } from './ui'
import type { Cashbox, PlanItem, TreatmentPlan } from '../types'

interface Props {
  plan: TreatmentPlan
  patientId: number
  patientName: string
  onClose: () => void
  onDone: () => void
}

interface Line {
  item_id: number
  service_name: string
  /** This item's still-workable teeth (already-finished teeth are excluded entirely — can't be touched again). */
  pool: number[]
  /** Which of the pool's teeth are part of this visit at all — a subset, or all of it. */
  selectedTeeth: number[]
  /** Of selectedTeeth, which are actually finished today (vs. touched but still continuing next time). */
  doneTeeth: number[]
  price: string
  /** The item's normal price — restored automatically if a fully-postponed line (price zeroed) gets a tooth marked done again. */
  defaultPrice: string
}

export default function RecordPlanSessionModal({ plan, patientId, patientName, onClose, onDone }: Props) {
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([])
  const [lines, setLines] = useState<Line[]>([])
  const [addItemId, setAddItemId] = useState('')
  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>('fixed')
  const [discountValue, setDiscountValue] = useState('')
  const [payMode, setPayMode] = useState<'now' | 'check' | 'defer'>('now')
  const [cashboxId, setCashboxId] = useState('')
  const [method, setMethod] = useState<'cash' | 'card' | 'transfer'>('cash')
  const [checkForm, setCheckForm] = useState({ check_number: '', bank_name: '', due_date: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.get('/cashboxes').then((res) => {
      setCashboxes(res.data)
      const ils = res.data.find((c: Cashbox) => c.currency === 'ILS')
      if (ils) setCashboxId(String(ils.id))
    })
  }, [])

  function poolFor(item: PlanItem): number[] {
    if (item.remaining_teeth) return item.remaining_teeth
    return item.tooth_numbers && item.tooth_numbers.length > 0 ? item.tooth_numbers : item.tooth_number ? [item.tooth_number] : []
  }

  const availableItems = plan.items.filter((i) => !lines.some((l) => l.item_id === i.id))

  function addLine(itemId: string) {
    const item = plan.items.find((i) => i.id === Number(itemId))
    if (!item) return
    const pool = poolFor(item)
    // Default: every remaining tooth is part of today's visit and marked
    // finished (the common case — most visits close out what they touch).
    // Staff flips a tooth to "continuing" if it still needs another visit.
    setLines([
      ...lines,
      { item_id: item.id, service_name: item.service_name ?? 'خدمة', pool, selectedTeeth: pool, doneTeeth: pool, price: item.unit_price, defaultPrice: item.unit_price },
    ])
    setAddItemId('')
  }

  function removeLine(idx: number) {
    setLines(lines.filter((_, i) => i !== idx))
  }

  function updatePrice(idx: number, price: string) {
    setLines(lines.map((l, i) => (i === idx ? { ...l, price } : l)))
  }

  /** Cycles a tooth chip: not touched → touched + done today → touched + still continuing → not touched. */
  function cycleTooth(idx: number, tooth: number) {
    setLines(
      lines.map((l, i) => {
        if (i !== idx) return l
        const touched = l.selectedTeeth.includes(tooth)
        const done = l.doneTeeth.includes(tooth)
        const next: Line = !touched
          ? { ...l, selectedTeeth: [...l.selectedTeeth, tooth], doneTeeth: [...l.doneTeeth, tooth] }
          : done
            ? { ...l, doneTeeth: l.doneTeeth.filter((t) => t !== tooth) }
            : { ...l, selectedTeeth: l.selectedTeeth.filter((t) => t !== tooth), doneTeeth: l.doneTeeth.filter((t) => t !== tooth) }

        // Nothing finished this visit for this line — don't bill it, unless
        // the secretary already typed a custom amount. Restore the normal
        // price automatically once a tooth is marked done again.
        if (next.doneTeeth.length === 0 && (l.price === l.defaultPrice || l.price === '')) {
          next.price = '0'
        } else if (next.doneTeeth.length > 0 && l.doneTeeth.length === 0 && (l.price === '0' || l.price === '')) {
          next.price = next.defaultPrice
        }
        return next
      }),
    )
  }

  const subtotal = lines.reduce((sum, l) => sum + (Number(l.price) || 0), 0)
  const discountAmount = Math.min(
    subtotal,
    Math.max(0, discountType === 'percent' ? (subtotal * (Number(discountValue) || 0)) / 100 : Number(discountValue) || 0),
  )
  const total = Math.max(0, subtotal - discountAmount)

  async function submit() {
    if (lines.length === 0) {
      setError('لازم تختار خدمة واحدة عالأقل من الخطة.')
      return
    }
    if (lines.some((l) => l.pool.length > 0 && l.selectedTeeth.length === 0)) {
      setError('لازم تحدد سن واحد عالأقل لكل خدمة إلها أسنان بالخطة.')
      return
    }
    if (payMode === 'now' && !cashboxId) {
      setError('اختر الصندوق.')
      return
    }
    if (payMode === 'check' && (!checkForm.check_number || !checkForm.due_date)) {
      setError('عبّي رقم الشيك وتاريخ الاستحقاق.')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const discountRatio = subtotal > 0 ? discountAmount / subtotal : 0

      await api.post(`/treatment-plans/${plan.id}/record-session`, {
        lines: lines.map((l) => ({
          item_id: l.item_id,
          tooth_numbers: l.pool.length > 0 ? l.selectedTeeth : null,
          pending_teeth: l.pool.length > 0 ? l.selectedTeeth.filter((t) => !l.doneTeeth.includes(t)) : null,
          price: Math.round((Number(l.price) || 0) * (1 - discountRatio) * 100) / 100,
        })),
        pay_now: payMode === 'now',
        cashbox_id: payMode === 'now' ? Number(cashboxId) : undefined,
        method: payMode === 'now' ? method : undefined,
      })

      if (payMode === 'check') {
        const data = new FormData()
        data.append('direction', 'incoming')
        data.append('party_type', 'patient')
        data.append('party_id', String(patientId))
        data.append('check_number', checkForm.check_number)
        if (checkForm.bank_name) data.append('bank_name', checkForm.bank_name)
        data.append('amount', String(total))
        data.append('currency', 'ILS')
        data.append('due_date', checkForm.due_date)
        await api.post('/checks', data, { headers: { 'Content-Type': 'multipart/form-data' } })
      }

      onDone()
      onClose()
    } catch {
      setError('صار خطأ أثناء تسجيل الجلسة، تأكد من البيانات وحاول مرة ثانية.')
    } finally {
      setBusy(false)
    }
  }

  const itemOptions = availableItems.map((i) => ({
    value: String(i.id),
    label: i.service_name ?? 'خدمة',
    sublabel: poolFor(i).length > 0 ? `أسنان الخطة: ${poolFor(i).join('، ')}` : 'بدون سن محدد',
  }))

  const cashboxOptions = cashboxes.map((c) => ({ value: String(c.id), label: c.name, sublabel: c.currency }))

  return (
    <Modal title={`تسجيل جلسة — ${patientName}`} onClose={onClose} width="w-[560px]">
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">خدمات هالجلسة (من ضمن خدمات الخطة)</label>
          {itemOptions.length === 0 ? (
            <p className="text-xs text-ink/40">كل خدمات الخطة مضافة للجلسة أصلاً.</p>
          ) : (
            <SearchableSelect options={itemOptions} value={addItemId} onChange={addLine} placeholder="اختر خدمة من الخطة..." />
          )}
        </div>

        {lines.length > 0 && (
          <div className="space-y-3 rounded-lg bg-background p-3">
            {lines.map((l, idx) => (
              <div key={idx} className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className="flex-1 font-medium text-ink">{l.service_name}</span>
                  <input
                    type="number"
                    value={l.price}
                    onChange={(e) => updatePrice(idx, e.target.value)}
                    className="w-20 rounded-lg border border-border px-2 py-1 text-sm"
                  />
                  <span className="text-xs text-muted">₪</span>
                  <button onClick={() => removeLine(idx)} className="text-danger">
                    <FontAwesomeIcon icon={faTrash} />
                  </button>
                </div>
                {l.pool.length > 0 && (
                  <>
                    <div className="flex flex-wrap gap-1">
                      {l.pool.map((tooth) => {
                        const touched = l.selectedTeeth.includes(tooth)
                        const done = l.doneTeeth.includes(tooth)
                        return (
                          <button
                            key={tooth}
                            type="button"
                            onClick={() => cycleTooth(idx, tooth)}
                            title={!touched ? 'مو مشمول بهاي الزيارة' : done ? 'خلص اليوم' : 'استمرار — لسا محتاج جلسة تانية'}
                            className={`rounded-lg border px-2 py-1 text-xs ${
                              touched
                                ? done
                                  ? 'border-success bg-success text-white'
                                  : 'border-amber-500 bg-amber-100 text-amber-800'
                                : 'border-border text-ink/60'
                            }`}
                          >
                            {tooth}
                          </button>
                        )
                      })}
                    </div>
                    <p className="text-[11px] text-ink/40">
                      أخضر = خلص اليوم، أصفر = لسا مستمر (رح يرجع يظهر تلقائياً بالجلسة الجاية)، رمادي = مو مشمول بهاي الزيارة
                    </p>
                  </>
                )}
              </div>
            ))}

            <div className="flex items-center gap-2 border-t border-border/70 pt-2 text-sm">
              <span className="text-ink/70">خصم</span>
              <div className="flex flex-1 gap-1 rounded-lg border border-ink/10 bg-white p-0.5">
                <button
                  type="button"
                  onClick={() => setDiscountType('percent')}
                  className={`flex-1 rounded-md py-1 text-xs font-medium transition-colors ${discountType === 'percent' ? 'bg-accent text-white' : 'text-ink/60 hover:bg-background'}`}
                >
                  نسبة %
                </button>
                <button
                  type="button"
                  onClick={() => setDiscountType('fixed')}
                  className={`flex-1 rounded-md py-1 text-xs font-medium transition-colors ${discountType === 'fixed' ? 'bg-accent text-white' : 'text-ink/60 hover:bg-background'}`}
                >
                  مبلغ ثابت
                </button>
              </div>
              <input
                type="number"
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                placeholder="0"
                className="w-20 rounded-lg border border-border px-2 py-1 text-sm"
              />
            </div>

            <div className="flex justify-between text-xs text-ink/50">
              <span>المجموع قبل الخصم</span>
              <span>{subtotal.toFixed(2)} ₪</span>
            </div>
            {discountAmount > 0 && (
              <div className="flex justify-between text-xs text-danger">
                <span>الخصم</span>
                <span>-{discountAmount.toFixed(2)} ₪</span>
              </div>
            )}
            <div className="flex justify-between border-t border-border/70 pt-2 text-sm font-semibold text-ink">
              <span>الإجمالي</span>
              <span>{total.toFixed(2)} ₪</span>
            </div>
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-muted">الدفع</label>
          <div className="flex gap-1 rounded-lg border border-border bg-white p-1">
            <button
              type="button"
              onClick={() => setPayMode('now')}
              className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${payMode === 'now' ? 'bg-accent text-white' : 'text-ink/60 hover:bg-background'}`}
            >
              دفع الآن
            </button>
            <button
              type="button"
              onClick={() => setPayMode('check')}
              className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${payMode === 'check' ? 'bg-accent text-white' : 'text-ink/60 hover:bg-background'}`}
            >
              شيك
            </button>
            <button
              type="button"
              onClick={() => setPayMode('defer')}
              className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${payMode === 'defer' ? 'bg-accent text-white' : 'text-ink/60 hover:bg-background'}`}
            >
              تأجيل (يضل دين)
            </button>
          </div>
        </div>

        {payMode === 'now' && (
          <div className="flex gap-2">
            <SearchableSelect options={cashboxOptions} value={cashboxId} onChange={setCashboxId} placeholder="الصندوق..." className="flex-1" />
            <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)} className="rounded-lg border border-border px-2 py-1.5 text-sm">
              <option value="cash">نقدي</option>
              <option value="card">بطاقة</option>
              <option value="transfer">تحويل</option>
            </select>
          </div>
        )}

        {payMode === 'check' && (
          <div className="space-y-2">
            <input
              placeholder="رقم الشيك"
              value={checkForm.check_number}
              onChange={(e) => setCheckForm({ ...checkForm, check_number: e.target.value })}
              className="w-full rounded-lg border border-border px-2 py-1.5 text-sm"
            />
            <input
              placeholder="اسم البنك (اختياري)"
              value={checkForm.bank_name}
              onChange={(e) => setCheckForm({ ...checkForm, bank_name: e.target.value })}
              className="w-full rounded-lg border border-border px-2 py-1.5 text-sm"
            />
            <DatePicker value={checkForm.due_date} onChange={(v) => setCheckForm({ ...checkForm, due_date: v })} placeholder="تاريخ الاستحقاق" />
          </div>
        )}

        {payMode === 'defer' && <p className="text-xs text-ink/50">رح يضل المبلغ ديناً على المريض، وبتقدر تحصّله لاحقاً من ملف المريض أو دفتر الديون.</p>}

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-muted hover:bg-background">
            إلغاء
          </button>
          <Button onClick={submit} disabled={busy}>
            <FontAwesomeIcon icon={faCheck} />
            {busy ? 'جارِ الحفظ...' : 'تأكيد الجلسة'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
