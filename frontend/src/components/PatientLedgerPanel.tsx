import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faCamera, faPercent, faTrash } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import DatePicker from './DatePicker'
import { Card, Table, Thead, Th, Td, Tr, EmptyRow, Badge, SearchableSelect } from './ui'
import type { BadgeVariant } from './ui'
import type { Cashbox, Invoice, Ledger } from '../types'
import RequestCheckImageButton, { TelegramCheckTargetPicker, sendTelegramCheckRequest } from './RequestCheckImageButton'

const TYPE_LABELS: Record<string, string> = {
  charge: 'فاتورة',
  payment: 'دفعة',
  refund: 'استرجاع',
  adjustment: 'خصم',
}

const TYPE_VARIANTS: Record<string, BadgeVariant> = {
  charge: 'danger',
  payment: 'success',
  refund: 'info',
  adjustment: 'neutral',
}

type Tab = 'cash' | 'check'

export default function PatientLedgerPanel({
  patientId,
  refreshSignal,
  autoOpenPayment = false,
}: {
  patientId: number
  refreshSignal?: number
  /** Skip the "pay=1" query-param dance and just open the payment form immediately — used when this panel is embedded in a popup rather than a routed page. */
  autoOpenPayment?: boolean
}) {
  const { can } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const canCollectCash = can('billing.manage')
  const canCollectCheck = can('checks.manage')

  const [ledger, setLedger] = useState<Ledger | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([])
  const [showForm, setShowForm] = useState(() => autoOpenPayment || searchParams.get('pay') === '1')
  const [tab, setTab] = useState<Tab>(canCollectCash ? 'cash' : 'check')
  const [showDiscountForm, setShowDiscountForm] = useState(false)
  const [discountAmount, setDiscountAmount] = useState('')
  const [discountNote, setDiscountNote] = useState('')

  const [cashForm, setCashForm] = useState({ invoice_id: '', cashbox_id: '', amount: '', method: 'cash' as 'cash' | 'card' | 'transfer', exchange_rate: '1' })
  const [checkForm, setCheckForm] = useState({ check_number: '', bank_name: '', amount: '', currency: 'ILS', due_date: '' })
  const [checkImage, setCheckImage] = useState<File | null>(null)
  const checkImageInputRef = useRef<HTMLInputElement>(null)
  const [checkImage2, setCheckImage2] = useState<File | null>(null)
  const checkImage2InputRef = useRef<HTMLInputElement>(null)
  const [createdCheck, setCreatedCheck] = useState<{ id: number; check_number: string } | null>(null)
  const [checkImageSource, setCheckImageSource] = useState<'device' | 'telegram'>('device')
  const [telegramTarget, setTelegramTarget] = useState('')
  const [telegramSlots, setTelegramSlots] = useState<(1 | 2)[]>([1])

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function load() {
    api.get(`/patients/${patientId}/ledger`).then((res) => setLedger(res.data))
    api.get(`/patients/${patientId}/invoices`).then((res) => setInvoices(res.data.data))
  }

  useEffect(() => {
    load()
    api.get('/cashboxes').then((res) => {
      setCashboxes(res.data)
      const ils = res.data.find((c: Cashbox) => c.currency === 'ILS')
      if (ils) setCashForm((f) => ({ ...f, cashbox_id: String(ils.id) }))
    })
  }, [patientId])

  useEffect(() => {
    if (refreshSignal) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal])

  useEffect(() => {
    if (searchParams.get('pay') === '1') {
      setShowForm(true)
      setTab(canCollectCash ? 'cash' : 'check')
      searchParams.delete('pay')
      setSearchParams(searchParams, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectedCashbox = cashboxes.find((c) => c.id === Number(cashForm.cashbox_id))
  const unpaidInvoices = invoices.filter((i) => i.status !== 'paid' && i.status !== 'void')

  async function collectPayment() {
    if (!cashForm.cashbox_id || !cashForm.amount || !selectedCashbox) return
    const exchangeRate = Number(cashForm.exchange_rate) || 1
    if (selectedCashbox.currency !== 'ILS' && exchangeRate <= 0) return
    setBusy(true)
    setError(null)
    try {
      await api.post(`/patients/${patientId}/payments`, {
        invoice_id: cashForm.invoice_id || null,
        cashbox_id: Number(cashForm.cashbox_id),
        amount: Number(cashForm.amount),
        currency: selectedCashbox.currency,
        exchange_rate: exchangeRate,
        method: cashForm.method,
      })
      setShowForm(false)
      setCashForm({ invoice_id: '', cashbox_id: '', amount: '', method: 'cash', exchange_rate: '1' })
      load()
    } catch {
      setError('تعذّر تسجيل الدفعة.')
    } finally {
      setBusy(false)
    }
  }

  async function addDiscount() {
    if (!discountAmount || Number(discountAmount) <= 0) return
    setBusy(true)
    setError(null)
    try {
      await api.post(`/patients/${patientId}/discount`, {
        amount: Number(discountAmount),
        note: discountNote || null,
      })
      setShowDiscountForm(false)
      setDiscountAmount('')
      setDiscountNote('')
      load()
    } catch {
      setError('تعذّر تسجيل الخصم.')
    } finally {
      setBusy(false)
    }
  }

  async function deletePayment(paymentId: number) {
    if (!window.confirm('حذف هاي الدفعة نهائياً؟ رصيد الصندوق وحالة الفاتورة رح يترجعوا متل قبل ما تنسجل.')) return
    setBusy(true)
    setError(null)
    try {
      await api.delete(`/payments/${paymentId}`)
      load()
    } catch {
      setError('تعذّر حذف الدفعة.')
    } finally {
      setBusy(false)
    }
  }

  async function receiveCheck() {
    if (!checkForm.check_number || !checkForm.amount || !checkForm.due_date) return
    if (checkImageSource === 'telegram' && !telegramTarget) return
    setBusy(true)
    setError(null)
    try {
      const data = new FormData()
      data.append('direction', 'incoming')
      data.append('party_type', 'patient')
      data.append('party_id', String(patientId))
      data.append('check_number', checkForm.check_number)
      if (checkForm.bank_name) data.append('bank_name', checkForm.bank_name)
      data.append('amount', checkForm.amount)
      data.append('currency', checkForm.currency)
      data.append('due_date', checkForm.due_date)
      if (checkImageSource === 'device' && checkImage) data.append('image', checkImage)
      if (checkImageSource === 'device' && checkImage2) data.append('image2', checkImage2)

      const res = await api.post('/checks', data, { headers: { 'Content-Type': 'multipart/form-data' } })
      setShowForm(false)
      setCheckForm({ check_number: '', bank_name: '', amount: '', currency: 'ILS', due_date: '' })
      setCheckImage(null)
      setCheckImage2(null)
      if (checkImageInputRef.current) checkImageInputRef.current.value = ''
      if (checkImage2InputRef.current) checkImage2InputRef.current.value = ''
      if (checkImageSource === 'telegram') {
        const message = await sendTelegramCheckRequest(res.data.id, telegramTarget, telegramSlots)
        if (message) setError(message)
        setTelegramTarget('')
        setTelegramSlots([1])
        setCheckImageSource('device')
      } else if (!checkImage || !checkImage2) {
        setCreatedCheck({ id: res.data.id, check_number: res.data.check_number })
      }
      load()
    } catch {
      setError('تعذّر تسجيل الشيك.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium text-muted">كشف الحساب</h2>
          {ledger && (
            <p className={`text-lg font-semibold ${ledger.outstanding_ils > 0 ? 'text-danger' : 'text-success'}`}>
              {ledger.outstanding_ils.toFixed(2)} ₪
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canCollectCash && (
            <button
              onClick={() => {
                setShowDiscountForm((v) => !v)
                setShowForm(false)
              }}
              className="flex items-center gap-2 rounded-lg border border-ink/10 px-3 py-1.5 text-xs font-medium text-ink/70 hover:border-accent hover:text-accent"
            >
              <FontAwesomeIcon icon={faPercent} />
              خصم عام
            </button>
          )}
          {(canCollectCash || canCollectCheck) && (
            <button
              onClick={() => {
                setShowForm((v) => !v)
                setShowDiscountForm(false)
              }}
              className="flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
            >
              <FontAwesomeIcon icon={faPlus} />
              تحصيل دفعة
            </button>
          )}
        </div>
      </div>

      {showDiscountForm && (
        <div className="mb-4 space-y-2 rounded-lg bg-background p-3">
          <p className="text-xs text-ink/50">خصم على كامل حساب المريض (مو مرتبط بفاتورة معيّنة) — بيقلل الرصيد المستحق مباشرة.</p>
          <div className="flex gap-2">
            <input
              type="number"
              min={0}
              placeholder="المبلغ"
              value={discountAmount}
              onChange={(e) => setDiscountAmount(e.target.value)}
              className="w-32 rounded-lg border border-ink/10 px-2 py-1.5 text-sm"
            />
            <input
              placeholder="سبب الخصم (اختياري)"
              value={discountNote}
              onChange={(e) => setDiscountNote(e.target.value)}
              className="flex-1 rounded-lg border border-ink/10 px-2 py-1.5 text-sm"
            />
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          <button
            onClick={addDiscount}
            disabled={busy || !discountAmount}
            className="w-full rounded-lg bg-accent py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
          >
            {busy ? 'جارِ الحفظ...' : 'تسجيل الخصم'}
          </button>
        </div>
      )}

      {showForm && (
        <div className="mb-4 space-y-3 rounded-lg bg-background p-3">
          {canCollectCash && canCollectCheck && (
            <div className="flex gap-1 rounded-lg border border-ink/10 bg-white p-1">
              <button
                type="button"
                onClick={() => setTab('cash')}
                className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${tab === 'cash' ? 'bg-accent text-white' : 'text-ink/60 hover:bg-background'}`}
              >
                نقدي / بطاقة / تحويل
              </button>
              <button
                type="button"
                onClick={() => setTab('check')}
                className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${tab === 'check' ? 'bg-accent text-white' : 'text-ink/60 hover:bg-background'}`}
              >
                شيك
              </button>
            </div>
          )}

          {tab === 'cash' && canCollectCash && (
            <>
              <select
                value={cashForm.invoice_id}
                onChange={(e) => setCashForm({ ...cashForm, invoice_id: e.target.value })}
                className="w-full rounded-lg border border-ink/10 px-2 py-1.5 text-sm"
              >
                <option value="">بدون ربط بفاتورة معيّنة</option>
                {unpaidInvoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.invoice_number} — متبقي {(Number(inv.total_amount_ils) - (inv.paid_ils ?? 0)).toFixed(2)} ₪
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <SearchableSelect
                  options={cashboxes.map((c) => ({ value: String(c.id), label: c.name, sublabel: c.currency }))}
                  value={cashForm.cashbox_id}
                  onChange={(value) => setCashForm({ ...cashForm, cashbox_id: value })}
                  placeholder="الصندوق..."
                  className="flex-1"
                />
                <input
                  type="number"
                  placeholder="المبلغ"
                  value={cashForm.amount}
                  onChange={(e) => setCashForm({ ...cashForm, amount: e.target.value })}
                  className="w-28 rounded-lg border border-ink/10 px-2 py-1.5 text-sm"
                />
                <select
                  value={cashForm.method}
                  onChange={(e) => setCashForm({ ...cashForm, method: e.target.value as typeof cashForm.method })}
                  className="rounded-lg border border-ink/10 px-2 py-1.5 text-sm"
                >
                  <option value="cash">نقدي</option>
                  <option value="card">بطاقة</option>
                  <option value="transfer">تحويل</option>
                </select>
              </div>
              {selectedCashbox && selectedCashbox.currency !== 'ILS' && (
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-xs text-ink/60">سعر الصرف (1 {selectedCashbox.currency} = ? ₪)</span>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="سعر الصرف"
                    value={cashForm.exchange_rate}
                    onChange={(e) => setCashForm({ ...cashForm, exchange_rate: e.target.value })}
                    className="w-24 rounded-lg border border-ink/10 px-2 py-1.5 text-sm"
                  />
                  {cashForm.amount && (
                    <span className="text-xs text-muted">
                      = {(Number(cashForm.amount) * (Number(cashForm.exchange_rate) || 0)).toFixed(2)} ₪
                    </span>
                  )}
                </div>
              )}
              {error && <p className="text-xs text-danger">{error}</p>}
              <button
                onClick={collectPayment}
                disabled={busy}
                className="w-full rounded-lg bg-accent py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
              >
                {busy ? 'جارِ التسجيل...' : 'تسجيل الدفعة'}
              </button>
            </>
          )}

          {tab === 'check' && canCollectCheck && (
            <>
              <input
                placeholder="رقم الشيك"
                value={checkForm.check_number}
                onChange={(e) => setCheckForm({ ...checkForm, check_number: e.target.value })}
                className="w-full rounded-lg border border-ink/10 px-2 py-1.5 text-sm"
              />
              <input
                placeholder="اسم البنك"
                value={checkForm.bank_name}
                onChange={(e) => setCheckForm({ ...checkForm, bank_name: e.target.value })}
                className="w-full rounded-lg border border-ink/10 px-2 py-1.5 text-sm"
              />
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="المبلغ"
                  value={checkForm.amount}
                  onChange={(e) => setCheckForm({ ...checkForm, amount: e.target.value })}
                  className="flex-1 rounded-lg border border-ink/10 px-2 py-1.5 text-sm"
                />
                <select
                  value={checkForm.currency}
                  onChange={(e) => setCheckForm({ ...checkForm, currency: e.target.value })}
                  className="rounded-lg border border-ink/10 px-2 py-1.5 text-sm"
                >
                  <option value="ILS">ILS</option>
                  <option value="USD">USD</option>
                  <option value="JOD">JOD</option>
                </select>
              </div>
              <DatePicker value={checkForm.due_date} onChange={(v) => setCheckForm({ ...checkForm, due_date: v })} placeholder="تاريخ الاستحقاق" />

              <div className="flex gap-1 rounded-lg border border-ink/10 bg-white p-1">
                <button
                  type="button"
                  onClick={() => setCheckImageSource('device')}
                  className={`flex-1 rounded-md py-1 text-[11px] font-medium transition-colors ${checkImageSource === 'device' ? 'bg-accent text-white' : 'text-ink/60'}`}
                >
                  إرفاق صورة من هالجهاز
                </button>
                <button
                  type="button"
                  onClick={() => setCheckImageSource('telegram')}
                  className={`flex-1 rounded-md py-1 text-[11px] font-medium transition-colors ${checkImageSource === 'telegram' ? 'bg-accent text-white' : 'text-ink/60'}`}
                >
                  طلب صورة عبر تيليغرام
                </button>
              </div>

              {checkImageSource === 'device' ? (
                <>
                  <input
                    ref={checkImageInputRef}
                    type="file"
                    accept="image/*"
                    onChange={(e) => setCheckImage(e.target.files?.[0] ?? null)}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => checkImageInputRef.current?.click()}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-ink/15 px-3 py-2 text-xs text-ink/50 hover:border-accent hover:text-accent"
                  >
                    <FontAwesomeIcon icon={faCamera} />
                    {checkImage ? `تم اختيار: ${checkImage.name}` : 'إرفاق صورة الوجه (اختياري)'}
                  </button>
                  <input
                    ref={checkImage2InputRef}
                    type="file"
                    accept="image/*"
                    onChange={(e) => setCheckImage2(e.target.files?.[0] ?? null)}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => checkImage2InputRef.current?.click()}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-ink/15 px-3 py-2 text-xs text-ink/50 hover:border-accent hover:text-accent"
                  >
                    <FontAwesomeIcon icon={faCamera} />
                    {checkImage2 ? `تم اختيار: ${checkImage2.name}` : 'إرفاق صورة الظهر (اختياري)'}
                  </button>
                </>
              ) : (
                <TelegramCheckTargetPicker
                  target={telegramTarget}
                  onTargetChange={setTelegramTarget}
                  slots={telegramSlots}
                  onSlotsChange={setTelegramSlots}
                />
              )}

              <p className="text-[11px] text-ink/40">
                الشيك ما بيأثر على رصيد الصندوق أو دين المريض إلا لما يتحصّل من صفحة الشيكات.
              </p>

              {error && <p className="text-xs text-danger">{error}</p>}
              <button
                onClick={receiveCheck}
                disabled={busy || (checkImageSource === 'telegram' && !telegramTarget)}
                className="w-full rounded-lg bg-accent py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
              >
                {busy ? 'جارِ التسجيل...' : 'استلام الشيك'}
              </button>
            </>
          )}
        </div>
      )}

      {createdCheck && (
        <div className="space-y-2 rounded-lg bg-background p-3">
          <p className="text-xs text-ink/70">تم استلام الشيك رقم {createdCheck.check_number}. ناقصك صورة؟</p>
          <RequestCheckImageButton
            checkId={createdCheck.id}
            checkNumber={createdCheck.check_number}
            onSent={() => setCreatedCheck(null)}
          />
        </div>
      )}

      <Table>
        <Thead>
          <Th>النوع</Th>
          <Th>التفاصيل</Th>
          <Th>المبلغ</Th>
          <Th>الرصيد بعدها</Th>
          <Th>التاريخ</Th>
          <Th></Th>
        </Thead>
        <tbody>
          {!ledger || ledger.transactions.length === 0 ? (
            <EmptyRow colSpan={6}>لا توجد حركات مالية.</EmptyRow>
          ) : (
            ledger.transactions.map((t) => (
              <Tr key={t.id}>
                <Td>
                  <Badge variant={TYPE_VARIANTS[t.type]}>{TYPE_LABELS[t.type]}</Badge>
                </Td>
                <Td className="text-muted">
                  {t.description}
                  {t.note && <span className="block text-[11px] text-ink/40">{t.note}</span>}
                </Td>
                <Td className={t.type === 'charge' ? 'text-danger' : 'text-success'}>
                  {t.type === 'charge' ? '+' : '-'}{t.amount_ils} ₪
                </Td>
                <Td>{t.balance_after_ils} ₪</Td>
                <Td className="text-muted">{t.occurred_at}</Td>
                <Td>
                  {canCollectCash && (t.type === 'payment' || t.type === 'refund') && t.reference_type === 'payment' && t.reference_id && (
                    <button onClick={() => deletePayment(t.reference_id!)} title="حذف الدفعة" className="text-ink/30 hover:text-danger">
                      <FontAwesomeIcon icon={faTrash} />
                    </button>
                  )}
                </Td>
              </Tr>
            ))
          )}
        </tbody>
      </Table>
    </Card>
  )
}
