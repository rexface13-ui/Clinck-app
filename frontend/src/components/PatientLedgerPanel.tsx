import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import type { Cashbox, Invoice, Ledger } from '../types'

const TYPE_LABELS: Record<string, string> = {
  charge: 'فاتورة',
  payment: 'دفعة',
  refund: 'استرجاع',
  adjustment: 'تسوية',
}

export default function PatientLedgerPanel({ patientId }: { patientId: number }) {
  const { can } = useAuth()
  const [ledger, setLedger] = useState<Ledger | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ invoice_id: '', cashbox_id: '', amount: '', method: 'cash' as const })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function load() {
    api.get(`/patients/${patientId}/ledger`).then((res) => setLedger(res.data))
    api.get(`/patients/${patientId}/invoices`).then((res) => setInvoices(res.data.data))
  }

  useEffect(() => {
    load()
    api.get('/cashboxes').then((res) => setCashboxes(res.data))
  }, [patientId])

  const selectedCashbox = cashboxes.find((c) => c.id === Number(form.cashbox_id))

  async function collectPayment() {
    if (!form.cashbox_id || !form.amount || !selectedCashbox) return
    setBusy(true)
    setError(null)
    try {
      await api.post(`/patients/${patientId}/payments`, {
        invoice_id: form.invoice_id || null,
        cashbox_id: Number(form.cashbox_id),
        amount: Number(form.amount),
        currency: selectedCashbox.currency,
        exchange_rate: 1,
        method: form.method,
      })
      setShowForm(false)
      setForm({ invoice_id: '', cashbox_id: '', amount: '', method: 'cash' })
      load()
    } catch {
      setError('تعذّر تسجيل الدفعة.')
    } finally {
      setBusy(false)
    }
  }

  const unpaidInvoices = invoices.filter((i) => i.status !== 'paid' && i.status !== 'void')

  return (
    <div className="rounded-xl bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium text-ink/70">كشف الحساب</h2>
          {ledger && (
            <p className={`text-lg font-semibold ${ledger.outstanding_ils > 0 ? 'text-danger' : 'text-accent'}`}>
              {ledger.outstanding_ils.toFixed(2)} ₪
            </p>
          )}
        </div>
        {can('billing.manage') && (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
          >
            <FontAwesomeIcon icon={faPlus} />
            تحصيل دفعة
          </button>
        )}
      </div>

      {showForm && (
        <div className="mb-4 space-y-2 rounded-lg bg-background p-3">
          <select
            value={form.invoice_id}
            onChange={(e) => setForm({ ...form, invoice_id: e.target.value })}
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
            <select
              value={form.cashbox_id}
              onChange={(e) => setForm({ ...form, cashbox_id: e.target.value })}
              className="flex-1 rounded-lg border border-ink/10 px-2 py-1.5 text-sm"
            >
              <option value="">الصندوق...</option>
              {cashboxes.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.currency})</option>
              ))}
            </select>
            <input
              type="number"
              placeholder="المبلغ"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              className="w-28 rounded-lg border border-ink/10 px-2 py-1.5 text-sm"
            />
            <select
              value={form.method}
              onChange={(e) => setForm({ ...form, method: e.target.value as typeof form.method })}
              className="rounded-lg border border-ink/10 px-2 py-1.5 text-sm"
            >
              <option value="cash">نقدي</option>
              <option value="card">بطاقة</option>
              <option value="transfer">تحويل</option>
              <option value="check">شيك</option>
            </select>
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          <button
            onClick={collectPayment}
            disabled={busy}
            className="w-full rounded-lg bg-accent py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
          >
            {busy ? 'جارِ التسجيل...' : 'تسجيل الدفعة'}
          </button>
        </div>
      )}

      {!ledger || ledger.transactions.length === 0 ? (
        <p className="text-sm text-ink/40">لا توجد حركات مالية.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-ink/50">
              <th className="p-1 text-start font-normal">النوع</th>
              <th className="p-1 text-start font-normal">المبلغ</th>
              <th className="p-1 text-start font-normal">الرصيد بعدها</th>
              <th className="p-1 text-start font-normal">التاريخ</th>
            </tr>
          </thead>
          <tbody>
            {ledger.transactions.map((t) => (
              <tr key={t.id} className="border-t border-ink/5">
                <td className="p-1">{TYPE_LABELS[t.type]}</td>
                <td className={`p-1 ${t.type === 'charge' ? 'text-danger' : 'text-accent'}`}>
                  {t.type === 'charge' ? '+' : '-'}{t.amount_ils} ₪
                </td>
                <td className="p-1">{t.balance_after_ils} ₪</td>
                <td className="p-1 text-ink/60">{t.occurred_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
