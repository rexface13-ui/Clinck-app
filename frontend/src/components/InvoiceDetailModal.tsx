import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPen, faCheck, faPenToSquare } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { Modal, Table, Thead, Th, Td, Tr, Badge } from './ui'
import type { BadgeVariant } from './ui'
import type { Invoice } from '../types'
import MiniOdontogramPreview from './MiniOdontogramPreview'

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
}: {
  invoiceId: number
  onClose: () => void
  onChanged?: () => void
  /** The teeth actually worked on in the session this invoice was billed for — when given, a small full-mouth diagram is shown so "what was done, exactly" is visible at a glance next to the amount, without needing to reopen the work-planning form just to see it. */
  sessionTeeth?: number[]
  isChild?: boolean
  /** Jumps straight to that session's work-planning edit form (teeth/steps editable there) — shown only when the work item behind this invoice is still open (not every invoice has one, e.g. manual charges). */
  onEditWorkItem?: () => void
}) {
  const { can } = useAuth()
  const canManage = can('billing.manage')
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [editing, setEditing] = useState(false)
  const [newTotal, setNewTotal] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function load() {
    api.get(`/invoices/${invoiceId}`).then((res) => setInvoice(res.data.data))
  }

  useEffect(load, [invoiceId])

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
            <div className="flex justify-center rounded-lg bg-background p-2">
              <MiniOdontogramPreview teeth={sessionTeeth} isChild={isChild} />
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

          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
      )}
    </Modal>
  )
}
