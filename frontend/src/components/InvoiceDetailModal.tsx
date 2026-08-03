import { useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPen, faCheck, faPenToSquare, faNoteSticky, faMoneyBill, faPercent, faCamera } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { Modal, Table, Thead, Th, Td, Tr, Badge, SearchableSelect } from './ui'
import type { BadgeVariant } from './ui'
import type { Cashbox, Invoice, Note } from '../types'
import MiniOdontogramPreview from './MiniOdontogramPreview'
import ToothNotesModal from './ToothNotesModal'
import DatePicker from './DatePicker'

const STATUS_LABELS: Record<string, string> = {
  unpaid: 'غير مدفوعة',
  partial: 'مدفوعة جزئياً',
  paid: 'مدفوعة',
  void: 'ملغاة (مسترجعة)',
}

const STATUS_VARIANTS: Record<string, BadgeVariant> = {
  unpaid: 'danger',
  partial: 'warning',
  paid: 'success',
  void: 'neutral',
}

/** Shows a single invoice's line items and payments, and (for billing.manage users) lets the total be corrected to whatever was actually agreed with the patient — the difference posts as a discount/adjustment, never rewriting the original charge lines. */
export default function InvoiceDetailModal({
  invoiceId,
  onClose,
  onChanged,
  sessionTeeth,
  isChild = false,
  onEditWorkItem,
  patientId,
  notes = [],
}: {
  invoiceId: number
  onClose: () => void
  onChanged?: () => void
  /** The teeth actually worked on in the session this invoice was billed for — when given, a small full-mouth diagram is shown so "what was done, exactly" is visible at a glance next to the amount, without needing to reopen the work-planning form just to see it. */
  sessionTeeth?: number[]
  isChild?: boolean
  /** Jumps straight to that session's work-planning edit form (teeth/steps editable there) — shown only when the work item behind this invoice is still open (not every invoice has one, e.g. manual charges). */
  onEditWorkItem?: () => void
  /** Needed (with `notes`) to show a per-tooth notebook shortcut next to each tooth in the session's diagram — omit both to just skip that row. */
  patientId?: number
  notes?: Note[]
}) {
  const { can } = useAuth()
  const canManage = can('billing.manage')
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [editing, setEditing] = useState(false)
  const [newTotal, setNewTotal] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notesToothNumber, setNotesToothNumber] = useState<number | null>(null)

  const [showDiscount, setShowDiscount] = useState(false)
  const [discountAmount, setDiscountAmount] = useState('')

  const [showCollect, setShowCollect] = useState(false)
  const [collectTab, setCollectTab] = useState<'cash' | 'check'>('cash')
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([])
  const [payAmount, setPayAmount] = useState('')
  const [payCashboxId, setPayCashboxId] = useState('')
  const [payMethod, setPayMethod] = useState<'cash' | 'card' | 'transfer'>('cash')
  const [checkNumber, setCheckNumber] = useState('')
  const [checkBank, setCheckBank] = useState('')
  const [checkAmount, setCheckAmount] = useState('')
  const [checkDueDate, setCheckDueDate] = useState('')
  const [checkImage, setCheckImage] = useState<File | null>(null)
  const checkImageInputRef = useRef<HTMLInputElement>(null)
  const [collecting, setCollecting] = useState(false)

  function load() {
    api.get(`/invoices/${invoiceId}`).then((res) => setInvoice(res.data.data))
  }

  useEffect(load, [invoiceId])

  useEffect(() => {
    if (!patientId) return
    api.get('/cashboxes').then((res) => {
      setCashboxes(res.data)
      const ils = res.data.find((c: Cashbox) => c.currency === 'ILS')
      if (ils) setPayCashboxId(String(ils.id))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId])

  function startEdit() {
    if (!invoice) return
    setNewTotal(invoice.total_amount_ils)
    setError(null)
    setEditing(true)
  }

  async function save() {
    if (!invoice) return
    setSaving(true)
    setError(null)
    try {
      const res = await api.patch(`/invoices/${invoice.id}`, { total_amount_ils: Number(newTotal) })
      setInvoice(res.data.data)
      setEditing(false)
      onChanged?.()
    } catch {
      setError('تعذّر الحفظ.')
    } finally {
      setSaving(false)
    }
  }

  async function applyDiscount() {
    if (!invoice || !discountAmount || Number(discountAmount) <= 0) return
    setSaving(true)
    setError(null)
    try {
      const total = Number(invoice.total_amount_ils)
      const target = Math.max(0, total - Number(discountAmount))
      const res = await api.patch(`/invoices/${invoice.id}`, { total_amount_ils: target })
      setInvoice(res.data.data)
      setShowDiscount(false)
      setDiscountAmount('')
      onChanged?.()
    } catch {
      setError('تعذّر تسجيل الخصم.')
    } finally {
      setSaving(false)
    }
  }

  async function collectCash() {
    if (!patientId || !payCashboxId || !payAmount) return
    setCollecting(true)
    setError(null)
    try {
      await api.post(`/patients/${patientId}/payments`, {
        invoice_id: invoiceId,
        cashbox_id: Number(payCashboxId),
        amount: Number(payAmount),
        currency: 'ILS',
        exchange_rate: 1,
        method: payMethod,
      })
      setShowCollect(false)
      setPayAmount('')
      load()
      onChanged?.()
    } catch {
      setError('تعذّر تسجيل الدفعة.')
    } finally {
      setCollecting(false)
    }
  }

  async function collectCheck() {
    if (!patientId || !checkNumber || !checkAmount || !checkDueDate) return
    setCollecting(true)
    setError(null)
    try {
      const data = new FormData()
      data.append('direction', 'incoming')
      data.append('party_type', 'patient')
      data.append('party_id', String(patientId))
      data.append('check_number', checkNumber)
      if (checkBank) data.append('bank_name', checkBank)
      data.append('amount', checkAmount)
      data.append('currency', 'ILS')
      data.append('due_date', checkDueDate)
      if (checkImage) data.append('image', checkImage)
      await api.post('/checks', data, { headers: { 'Content-Type': 'multipart/form-data' } })
      setShowCollect(false)
      setCheckNumber('')
      setCheckBank('')
      setCheckAmount('')
      setCheckDueDate('')
      setCheckImage(null)
      if (checkImageInputRef.current) checkImageInputRef.current.value = ''
      onChanged?.()
    } catch {
      setError('تعذّر تسجيل الشيك.')
    } finally {
      setCollecting(false)
    }
  }

  const paid = Number(invoice?.paid_ils ?? 0)
  const total = Number(invoice?.total_amount_ils ?? 0)
  const remaining = Math.max(0, total - paid)

  return (
    <Modal title={invoice ? `فاتورة ${invoice.invoice_number}` : 'فاتورة'} onClose={onClose} width="w-[560px]">
      {!invoice ? (
        <p className="text-sm text-muted">جارِ التحميل...</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Badge variant={STATUS_VARIANTS[invoice.status]}>{STATUS_LABELS[invoice.status]}</Badge>
            <span className="text-xs text-muted">{invoice.issued_at}</span>
          </div>

          {sessionTeeth && sessionTeeth.length > 0 && (
            <div className="rounded-lg bg-background p-2">
              <div className="flex justify-center">
                <MiniOdontogramPreview teeth={sessionTeeth} isChild={isChild} />
              </div>
              {patientId && (
                <div className="mt-2 flex flex-wrap justify-center gap-1.5 border-t border-border/60 pt-2">
                  {[...sessionTeeth].sort((a, b) => a - b).map((tooth) => {
                    const count = notes.filter((n) => n.tooth_number === tooth).length
                    return (
                      <button
                        key={tooth}
                        onClick={() => setNotesToothNumber(tooth)}
                        className={`flex items-center gap-1 rounded-lg border px-1.5 py-0.5 text-[11px] ${count > 0 ? 'border-accent/40 text-accent' : 'border-border text-muted'} hover:border-accent hover:text-accent`}
                      >
                        <FontAwesomeIcon icon={faNoteSticky} className="text-[10px]" />
                        سن {tooth}
                        {count > 0 && <span className="rounded-full bg-accent px-1 text-[9px] text-white">{count}</span>}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {onEditWorkItem && invoice.status !== 'void' && (
            <button
              onClick={onEditWorkItem}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-ink/15 py-1.5 text-xs font-medium text-accent hover:border-accent"
            >
              <FontAwesomeIcon icon={faPenToSquare} />
              فتح هالجلسة بفورم التعديل (الأسنان/الخطوات)
            </button>
          )}

          <Table>
            <Thead>
              <Th>الوصف</Th>
              <Th>المبلغ</Th>
            </Thead>
            <tbody>
              {(invoice.lines ?? []).map((l) => (
                <Tr key={l.id}>
                  <Td>{l.description}</Td>
                  <Td className="text-muted">{l.amount_ils} ₪</Td>
                </Tr>
              ))}
            </tbody>
          </Table>

          <div className="space-y-1 rounded-lg bg-background p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">المدفوع</span>
              <span className="text-ink">{paid.toFixed(2)} ₪</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">المتبقي</span>
              <span className="text-ink">{remaining.toFixed(2)} ₪</span>
            </div>
            <div className="flex items-center justify-between border-t border-border/70 pt-1 font-semibold">
              <span className="text-ink">الإجمالي المتفق عليه</span>
              {editing ? (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    autoFocus
                    value={newTotal}
                    onChange={(e) => setNewTotal(e.target.value)}
                    className="w-24 rounded-lg border border-border px-2 py-1 text-sm"
                  />
                  <span className="text-xs text-muted">₪</span>
                  <button onClick={save} disabled={saving} className="text-accent hover:text-accent-hover disabled:opacity-60">
                    <FontAwesomeIcon icon={faCheck} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-ink">{total.toFixed(2)} ₪</span>
                  {canManage && invoice.status !== 'void' && (
                    <button onClick={startEdit} title="تعديل الإجمالي / خصم" className="text-ink/40 hover:text-accent">
                      <FontAwesomeIcon icon={faPen} />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {invoice.status !== 'void' && (canManage || patientId) && (
            <div className="flex flex-wrap gap-2">
              {canManage && (
                <button
                  onClick={() => {
                    setShowDiscount((v) => !v)
                    setShowCollect(false)
                  }}
                  className="flex items-center gap-1.5 rounded-lg border border-ink/10 px-2.5 py-1.5 text-xs text-ink/70 hover:border-accent hover:text-accent"
                >
                  <FontAwesomeIcon icon={faPercent} />
                  إضافة خصم
                </button>
              )}
              {patientId && remaining > 0 && (
                <button
                  onClick={() => {
                    setShowCollect((v) => !v)
                    setShowDiscount(false)
                    setPayAmount(String(remaining))
                    setCheckAmount(String(remaining))
                  }}
                  className="flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
                >
                  <FontAwesomeIcon icon={faMoneyBill} />
                  تحصيل دفعة
                </button>
              )}
            </div>
          )}

          {showDiscount && (
            <div className="space-y-2 rounded-lg bg-background p-3">
              <p className="text-xs text-muted">مبلغ الخصم على هاي الفاتورة بس — بينخصم من إجماليها مباشرة.</p>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={0}
                  max={total}
                  placeholder="مبلغ الخصم"
                  value={discountAmount}
                  onChange={(e) => setDiscountAmount(e.target.value)}
                  className="w-32 rounded-lg border border-border px-2 py-1.5 text-sm"
                />
                <button
                  onClick={applyDiscount}
                  disabled={saving || !discountAmount}
                  className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
                >
                  {saving ? 'جارِ الحفظ...' : 'تسجيل الخصم'}
                </button>
              </div>
            </div>
          )}

          {showCollect && (
            <div className="space-y-3 rounded-lg bg-background p-3">
              <div className="flex gap-1 rounded-lg border border-ink/10 bg-white p-1">
                <button
                  type="button"
                  onClick={() => setCollectTab('cash')}
                  className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${collectTab === 'cash' ? 'bg-accent text-white' : 'text-ink/60 hover:bg-background'}`}
                >
                  نقدي / بطاقة / تحويل
                </button>
                <button
                  type="button"
                  onClick={() => setCollectTab('check')}
                  className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${collectTab === 'check' ? 'bg-accent text-white' : 'text-ink/60 hover:bg-background'}`}
                >
                  شيك
                </button>
              </div>

              {collectTab === 'cash' ? (
                <>
                  <div className="flex gap-2">
                    <SearchableSelect
                      options={cashboxes.map((c) => ({ value: String(c.id), label: c.name, sublabel: c.currency }))}
                      value={payCashboxId}
                      onChange={setPayCashboxId}
                      placeholder="الصندوق..."
                      className="flex-1"
                    />
                    <input
                      type="number"
                      placeholder="المبلغ"
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      className="w-28 rounded-lg border border-ink/10 px-2 py-1.5 text-sm"
                    />
                    <select
                      value={payMethod}
                      onChange={(e) => setPayMethod(e.target.value as typeof payMethod)}
                      className="rounded-lg border border-ink/10 px-2 py-1.5 text-sm"
                    >
                      <option value="cash">نقدي</option>
                      <option value="card">بطاقة</option>
                      <option value="transfer">تحويل</option>
                    </select>
                  </div>
                  <button
                    onClick={collectCash}
                    disabled={collecting}
                    className="w-full rounded-lg bg-accent py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
                  >
                    {collecting ? 'جارِ التسجيل...' : 'تسجيل الدفعة'}
                  </button>
                </>
              ) : (
                <>
                  <input
                    placeholder="رقم الشيك"
                    value={checkNumber}
                    onChange={(e) => setCheckNumber(e.target.value)}
                    className="w-full rounded-lg border border-ink/10 px-2 py-1.5 text-sm"
                  />
                  <input
                    placeholder="اسم البنك"
                    value={checkBank}
                    onChange={(e) => setCheckBank(e.target.value)}
                    className="w-full rounded-lg border border-ink/10 px-2 py-1.5 text-sm"
                  />
                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="المبلغ"
                      value={checkAmount}
                      onChange={(e) => setCheckAmount(e.target.value)}
                      className="flex-1 rounded-lg border border-ink/10 px-2 py-1.5 text-sm"
                    />
                    <DatePicker value={checkDueDate} onChange={setCheckDueDate} placeholder="تاريخ الاستحقاق" />
                  </div>
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
                    {checkImage ? `تم اختيار: ${checkImage.name}` : 'إرفاق صورة الشيك (اختياري)'}
                  </button>
                  <p className="text-[11px] text-ink/40">الشيك ما بيأثر على الرصيد إلا لما يتحصّل من صفحة الشيكات. صورة الشيك بترسل إشعار تلغرام فوراً.</p>
                  <button
                    onClick={collectCheck}
                    disabled={collecting}
                    className="w-full rounded-lg bg-accent py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
                  >
                    {collecting ? 'جارِ التسجيل...' : 'استلام الشيك'}
                  </button>
                </>
              )}
            </div>
          )}

          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
      )}

      {notesToothNumber !== null && patientId && (
        <ToothNotesModal
          patientId={patientId}
          toothNumber={notesToothNumber}
          notes={notes}
          onClose={() => setNotesToothNumber(null)}
          onChanged={() => onChanged?.()}
        />
      )}
    </Modal>
  )
}
