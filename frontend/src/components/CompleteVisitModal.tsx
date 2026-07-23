import { useEffect, useMemo, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTrash, faCheck, faTooth } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import DatePicker from './DatePicker'
import { Modal, Button, SearchableSelect } from './ui'
import {
  UPPER_PERMANENT,
  LOWER_PERMANENT,
  UPPER_PRIMARY,
  LOWER_PRIMARY,
  UPPER_ARCH,
  LOWER_ARCH,
  VIEWBOX,
  archPosition,
  primaryCanonicalIndex,
  toothCrownPath,
  toothShapeType,
  toothSize,
  cuspPositions,
  type ArchConfig,
} from '../lib/dental'
import type { Cashbox, Service } from '../types'

interface Props {
  appointmentId: number
  patientId: number
  patientName: string
  doctorId: number | null
  onClose: () => void
  onDone: () => void
}

interface Line {
  service_id: number
  name: string
  price: string
  /** Optional, comma-separated (e.g. "16" or "16,17") — one per tooth this line applies to. */
  tooth_numbers: string
  /** Subset of tooth_numbers that's still ongoing (needs another visit) rather than finished today. */
  pending_teeth: string
  /** true (default): price is per tooth, so picking N teeth multiplies the total (extraction, filling...).
   *  false: price is a flat fee no matter how many teeth are picked (cleaning...) — still logs each tooth
   *  in its history, just split evenly so the total stays the flat price. */
  per_tooth: boolean
}

/** Pre-discount total for one line, accounting for how many teeth are selected and whether the price multiplies per tooth. */
function lineTotal(l: Line): number {
  const price = Number(l.price) || 0
  if (!l.per_tooth) return price
  const teethCount = l.tooth_numbers.split(',').map((t) => t.trim()).filter(Boolean).length
  return price * Math.max(1, teethCount)
}

interface LaidOutTooth {
  number: number
  x: number
  y: number
  rotationDeg: number
  crownPath: string
  cusps: { x: number; y: number; r: number }[]
  labelX: number
  labelY: number
}

/** Mirrors ToothChart's layout so this mini picker draws the same tooth shapes and the same (correct) primary-tooth slots as the main chart. */
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

export default function CompleteVisitModal({ appointmentId, patientId, patientName, doctorId, onClose, onDone }: Props) {
  const [services, setServices] = useState<Service[]>([])
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([])
  const [lines, setLines] = useState<Line[]>([])
  const [addServiceId, setAddServiceId] = useState('')
  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>('fixed')
  const [discountValue, setDiscountValue] = useState('')
  const [payMode, setPayMode] = useState<'now' | 'check' | 'defer'>('now')
  const [cashboxId, setCashboxId] = useState('')
  const [method, setMethod] = useState<'cash' | 'card' | 'transfer'>('cash')
  const [checkForm, setCheckForm] = useState({ check_number: '', bank_name: '', due_date: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isChild, setIsChild] = useState(false)
  const [pickerOpenIdx, setPickerOpenIdx] = useState<number | null>(null)

  useEffect(() => {
    api.get('/services').then((res) => setServices(res.data.data))
    api.get('/cashboxes').then((res) => {
      setCashboxes(res.data)
      const ils = res.data.find((c: Cashbox) => c.currency === 'ILS')
      if (ils) setCashboxId(String(ils.id))
    })
    api.get(`/patients/${patientId}`).then((res) => setIsChild(!!res.data.data.is_child))
  }, [patientId])

  const pickerTeeth = useMemo(
    () => [
      ...layoutArch(UPPER_PERMANENT, UPPER_PRIMARY, isChild, UPPER_ARCH),
      ...layoutArch(LOWER_PERMANENT, LOWER_PRIMARY, isChild, LOWER_ARCH),
    ],
    [isChild],
  )

  const subtotal = lines.reduce((sum, l) => sum + lineTotal(l), 0)
  const discountAmount = Math.min(
    subtotal,
    Math.max(0, discountType === 'percent' ? (subtotal * (Number(discountValue) || 0)) / 100 : Number(discountValue) || 0),
  )
  const total = Math.max(0, subtotal - discountAmount)

  function addService(serviceId: string) {
    const svc = services.find((s) => s.id === Number(serviceId))
    if (!svc) return
    setLines([...lines, { service_id: svc.id, name: svc.name, price: svc.default_price, tooth_numbers: '', pending_teeth: '', per_tooth: true }])
    setAddServiceId('')
  }

  function removeLine(idx: number) {
    setLines(lines.filter((_, i) => i !== idx))
  }

  function updatePrice(idx: number, price: string) {
    setLines(lines.map((l, i) => (i === idx ? { ...l, price } : l)))
  }

  function updateTeeth(idx: number, tooth_numbers: string) {
    setLines(lines.map((l, i) => (i === idx ? { ...l, tooth_numbers } : l)))
  }

  function togglePerTooth(idx: number) {
    setLines(lines.map((l, i) => (i === idx ? { ...l, per_tooth: !l.per_tooth } : l)))
  }

  /** Cycles a tooth chip: not touched → touched + done today → touched + still continuing → not touched. */
  function cycleTooth(idx: number, tooth: number) {
    setLines(
      lines.map((l, i) => {
        if (i !== idx) return l
        const touched = l.tooth_numbers.split(',').map((t) => t.trim()).filter(Boolean)
        const pending = l.pending_teeth.split(',').map((t) => t.trim()).filter(Boolean)
        const key = String(tooth)
        if (!touched.includes(key)) {
          return { ...l, tooth_numbers: [...touched, key].join(',') }
        }
        if (!pending.includes(key)) {
          return { ...l, pending_teeth: [...pending, key].join(',') }
        }
        return {
          ...l,
          tooth_numbers: touched.filter((t) => t !== key).join(','),
          pending_teeth: pending.filter((t) => t !== key).join(','),
        }
      }),
    )
  }

  async function submit() {
    if (lines.length === 0) {
      setError('لازم تضيف خدمة واحدة على الأقل.')
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
      const planRes = await api.post('/treatment-plans', { patient_id: patientId, doctor_id: doctorId, appointment_id: appointmentId })
      const planId = planRes.data.data.id

      // Discount is distributed proportionally across lines so the sum of
      // the submitted unit_prices matches the discounted total exactly.
      const discountRatio = subtotal > 0 ? discountAmount / subtotal : 0
      const itemIds: number[] = []
      const itemTeeth: Record<number, { tooth_numbers: number[] | null; pending_teeth: number[] | null }> = {}
      for (const l of lines) {
        const teeth = l.tooth_numbers
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
          .map(Number)
        // One item per line, covering all its picked teeth together — one
        // price, one session, regardless of how many teeth. per_tooth only
        // changes how that one price is computed (lineTotal already
        // multiplies by tooth count when per_tooth is checked, or keeps it
        // flat when unchecked); it never splits the charge across items.
        // Each tooth still gets its own finding/history entry when the
        // session is completed below (see completeSession() backend).
        const linePrice = Math.round(lineTotal(l) * (1 - discountRatio) * 100) / 100
        const itemRes = await api.post(`/treatment-plans/${planId}/items`, {
          service_id: l.service_id,
          tooth_number: teeth.length > 0 ? teeth[0] : null,
          tooth_numbers: teeth.length > 0 ? teeth : null,
          unit_price: linePrice,
          sessions_count: 1,
        })
        const itemId = itemRes.data.data.id
        itemIds.push(itemId)
        const pending = l.pending_teeth
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
          .map(Number)
          .filter((t) => teeth.includes(t))
        itemTeeth[itemId] = { tooth_numbers: teeth.length > 0 ? teeth : null, pending_teeth: pending.length > 0 ? pending : null }
      }

      // Approving only schedules the (single) session per item — nothing is
      // charged until each session is explicitly completed right below, which
      // is what actually bills the visit. This is a same-day visit, so every
      // item's one session is completed immediately.
      await api.post(`/treatment-plans/${planId}/approve`)
      const planAfterApprove = await api.get(`/treatment-plans/${planId}`)
      const itemsById: Record<number, { unit_price: string; sessions: { id: number }[] }> = {}
      for (const it of planAfterApprove.data.data.items) itemsById[it.id] = it

      await Promise.all(
        itemIds.map((itemId) => {
          const item = itemsById[itemId]
          const sessionId = item.sessions[0].id
          return api.post(`/treatment-plans/${planId}/items/${itemId}/sessions/${sessionId}/complete`, {
            price: Number(item.unit_price),
            tooth_numbers: itemTeeth[itemId]?.tooth_numbers,
            pending_teeth: itemTeeth[itemId]?.pending_teeth,
          })
        }),
      )

      const finalPlan = await api.get(`/treatment-plans/${planId}`)
      const invoiceId = finalPlan.data.data.latest_invoice_id
      await api.put(`/appointments/${appointmentId}`, { status: 'done' })

      if (payMode === 'now') {
        const box = cashboxes.find((c) => c.id === Number(cashboxId))
        if (box) {
          await api.post(`/patients/${patientId}/payments`, {
            invoice_id: invoiceId,
            cashbox_id: box.id,
            amount: total,
            currency: box.currency,
            exchange_rate: 1,
            method,
          })
        }
      } else if (payMode === 'check') {
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
      setError('صار خطأ أثناء تسجيل الزيارة، تأكد من البيانات وحاول مرة ثانية.')
    } finally {
      setBusy(false)
    }
  }

  const serviceOptions = services.map((s) => ({ value: String(s.id), label: s.name, sublabel: `${s.default_price} ₪` }))
  const cashboxOptions = cashboxes.map((c) => ({ value: String(c.id), label: c.name, sublabel: c.currency }))

  return (
    <Modal title={`تمّت الزيارة — ${patientName}`} onClose={onClose} width="w-[560px]">
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">الخدمات المقدّمة اليوم — اختر خدمة وتنضاف فوراً</label>
          <SearchableSelect
            options={serviceOptions}
            value={addServiceId}
            onChange={addService}
            placeholder="اختر خدمة..."
          />
        </div>

        {lines.length > 0 && (
          <div className="space-y-2 rounded-lg bg-background p-3">
            {lines.map((l, idx) => (
              <div key={idx}>
                <div className="flex items-center gap-2 text-sm">
                  <span className="flex-1">{l.name}</span>
                  <button
                    type="button"
                    onClick={() => setPickerOpenIdx(pickerOpenIdx === idx ? null : idx)}
                    title="اختر السن/الأسنان اللي اشتغلتها بهاي الخدمة من الرسمة — بيسجلها بسجل السن كمان"
                    className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-xs ${
                      l.tooth_numbers ? 'border-accent text-accent' : 'border-border text-muted'
                    }`}
                  >
                    <FontAwesomeIcon icon={faTooth} />
                    {l.tooth_numbers ? l.tooth_numbers.split(',').join('، ') : 'اختر سن'}
                  </button>
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

                {l.tooth_numbers.split(',').filter((t) => t.trim()).length > 1 && (
                  <label className="mt-1 flex items-center gap-1.5 text-[11px] text-ink/60">
                    <input type="checkbox" checked={l.per_tooth} onChange={() => togglePerTooth(idx)} className="size-3.5" />
                    احتساب السعر لكل سن لحاله (بدل ما يضل سعر ثابت واحد لكل الأسنان مع بعض)
                  </label>
                )}

                {pickerOpenIdx === idx && (
                  <div className="mt-2 space-y-2 rounded-lg border border-border bg-white p-2">
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        onClick={() => updateTeeth(idx, pickerTeeth.map((t) => t.number).join(','))}
                        className="rounded-lg border border-border px-2 py-1 text-[11px] text-ink/70 hover:border-accent hover:text-accent"
                      >
                        تحديد الكل
                      </button>
                      <button
                        type="button"
                        onClick={() => updateTeeth(idx, (isChild ? UPPER_PRIMARY : UPPER_PERMANENT).join(','))}
                        className="rounded-lg border border-border px-2 py-1 text-[11px] text-ink/70 hover:border-accent hover:text-accent"
                      >
                        النصف العلوي
                      </button>
                      <button
                        type="button"
                        onClick={() => updateTeeth(idx, (isChild ? LOWER_PRIMARY : LOWER_PERMANENT).join(','))}
                        className="rounded-lg border border-border px-2 py-1 text-[11px] text-ink/70 hover:border-accent hover:text-accent"
                      >
                        النصف السفلي
                      </button>
                      {l.tooth_numbers && (
                        <button
                          type="button"
                          onClick={() => setLines(lines.map((line, i) => (i === idx ? { ...line, tooth_numbers: '', pending_teeth: '' } : line)))}
                          className="rounded-lg border border-danger/20 px-2 py-1 text-[11px] text-danger/70 hover:border-danger hover:text-danger"
                        >
                          مسح التحديد
                        </button>
                      )}
                    </div>
                    <p className="text-[11px] text-ink/40">أخضر = خلص اليوم، أصفر = لسا مستمر (بضل بحالة "قيد التنفيذ" ويظهر بجلسة جاية)</p>
                    <svg viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`} className="w-full" style={{ maxWidth: 380 }}>
                      <line
                        x1={40}
                        y1={VIEWBOX.height / 2}
                        x2={VIEWBOX.width - 40}
                        y2={VIEWBOX.height / 2}
                        stroke="#e2e8f0"
                        strokeDasharray="4 4"
                      />
                      <line x1={UPPER_ARCH.cx} y1={20} x2={UPPER_ARCH.cx} y2={VIEWBOX.height - 20} stroke="#e2e8f0" strokeDasharray="4 4" />
                      {pickerTeeth.map((t) => {
                        const selected = l.tooth_numbers.split(',').map((v) => v.trim()).includes(String(t.number))
                        const pending = l.pending_teeth.split(',').map((v) => v.trim()).includes(String(t.number))
                        const fill = selected ? (pending ? '#fef3c7' : 'var(--color-accent)') : '#fff8f0'
                        const stroke = selected ? (pending ? '#d97706' : 'var(--color-accent)') : '#c9b8a8'
                        return (
                          <g key={t.number} onClick={() => cycleTooth(idx, t.number)} className="cursor-pointer">
                            <title>{!selected ? 'مو مشمول بهاي الزيارة' : pending ? 'استمرار — لسا محتاج جلسة تانية' : 'خلص اليوم'}</title>
                            <g transform={`translate(${t.x},${t.y}) rotate(${t.rotationDeg})`}>
                              <path
                                d={t.crownPath}
                                fill={fill}
                                stroke={stroke}
                                strokeWidth={selected ? 2.5 : 1.2}
                              />
                              {t.cusps.map((c, i) => (
                                <circle key={i} cx={c.x} cy={c.y} r={c.r} fill="#00000010" />
                              ))}
                            </g>
                            <text
                              x={t.labelX}
                              y={t.labelY}
                              textAnchor="middle"
                              dominantBaseline="middle"
                              fontSize="10"
                              fill="var(--color-ink)"
                              className="select-none"
                            >
                              {t.number}
                            </text>
                          </g>
                        )
                      })}
                    </svg>
                    <div className="flex justify-end">
                      <button type="button" onClick={() => setPickerOpenIdx(null)} className="text-xs text-accent hover:underline">
                        تم
                      </button>
                    </div>
                  </div>
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
            <SearchableSelect
              options={cashboxOptions}
              value={cashboxId}
              onChange={setCashboxId}
              placeholder="الصندوق..."
              className="flex-1"
            />
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as typeof method)}
              className="rounded-lg border border-border px-2 py-1.5 text-sm"
            >
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

        {payMode === 'defer' && (
          <p className="text-xs text-ink/50">رح يضل المبلغ ديناً على المريض، وبتقدر تحصّله لاحقاً من ملف المريض أو دفتر الديون.</p>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-muted hover:bg-background">
            إلغاء
          </button>
          <Button onClick={submit} disabled={busy}>
            <FontAwesomeIcon icon={faCheck} />
            {busy ? 'جارِ الحفظ...' : 'تأكيد الزيارة'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
