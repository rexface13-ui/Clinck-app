import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTrash, faCheck } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import DatePicker from './DatePicker'
import { Modal, Button, SearchableSelect } from './ui'
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
}

export default function CompleteVisitModal({ appointmentId, patientId, patientName, doctorId, onClose, onDone }: Props) {
  const [services, setServices] = useState<Service[]>([])
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([])
  const [lines, setLines] = useState<Line[]>([])
  const [addServiceId, setAddServiceId] = useState('')
  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>('percent')
  const [discountValue, setDiscountValue] = useState('')
  const [payMode, setPayMode] = useState<'now' | 'check' | 'defer'>('now')
  const [cashboxId, setCashboxId] = useState('')
  const [method, setMethod] = useState<'cash' | 'card' | 'transfer'>('cash')
  const [checkForm, setCheckForm] = useState({ check_number: '', bank_name: '', due_date: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.get('/services').then((res) => setServices(res.data.data))
    api.get('/cashboxes').then((res) => {
      setCashboxes(res.data)
      const ils = res.data.find((c: Cashbox) => c.currency === 'ILS')
      if (ils) setCashboxId(String(ils.id))
    })
  }, [])

  const subtotal = lines.reduce((sum, l) => sum + (Number(l.price) || 0), 0)
  const discountAmount = Math.min(
    subtotal,
    Math.max(0, discountType === 'percent' ? (subtotal * (Number(discountValue) || 0)) / 100 : Number(discountValue) || 0),
  )
  const total = Math.max(0, subtotal - discountAmount)

  function addService(serviceId: string) {
    const svc = services.find((s) => s.id === Number(serviceId))
    if (!svc) return
    setLines([...lines, { service_id: svc.id, name: svc.name, price: svc.default_price }])
    setAddServiceId('')
  }

  function removeLine(idx: number) {
    setLines(lines.filter((_, i) => i !== idx))
  }

  function updatePrice(idx: number, price: string) {
    setLines(lines.map((l, i) => (i === idx ? { ...l, price } : l)))
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
      for (const l of lines) {
        const linePrice = Number(l.price) || 0
        const adjustedPrice = Math.round(linePrice * (1 - discountRatio) * 100) / 100
        await api.post(`/treatment-plans/${planId}/items`, {
          service_id: l.service_id,
          unit_price: adjustedPrice,
          sessions_count: 1,
        })
      }

      const approveRes = await api.post(`/treatment-plans/${planId}/approve`)
      const invoiceId = approveRes.data.data.id
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
              <div key={idx} className="flex items-center gap-2 text-sm">
                <span className="flex-1">{l.name}</span>
                <input
                  type="number"
                  value={l.price}
                  onChange={(e) => updatePrice(idx, e.target.value)}
                  className="w-24 rounded-lg border border-border px-2 py-1 text-sm"
                />
                <span className="text-xs text-muted">₪</span>
                <button onClick={() => removeLine(idx)} className="text-danger">
                  <FontAwesomeIcon icon={faTrash} />
                </button>
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
