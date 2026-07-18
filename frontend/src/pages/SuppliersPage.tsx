import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faTruck } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import type { Cashbox, Supplier, SupplierLedger } from '../types'

export default function SuppliersPage() {
  const { can } = useAuth()
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([])
  const [selected, setSelected] = useState<Supplier | null>(null)
  const [ledger, setLedger] = useState<SupplierLedger | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '' })
  const [payForm, setPayForm] = useState({ cashbox_id: '', amount: '', currency: 'ILS' })
  const [busy, setBusy] = useState(false)

  const canManage = can('suppliers.manage')

  function loadSuppliers() {
    api.get('/suppliers').then((res) => setSuppliers(res.data))
    api.get('/cashboxes').then((res) => setCashboxes(res.data))
  }

  useEffect(loadSuppliers, [])

  function loadLedger(supplier: Supplier) {
    setSelected(supplier)
    api.get(`/suppliers/${supplier.id}/ledger`).then((res) => setLedger(res.data))
  }

  async function submit() {
    if (!form.name) return
    setBusy(true)
    try {
      await api.post('/suppliers', { name: form.name, phone: form.phone || null })
      setShowForm(false)
      setForm({ name: '', phone: '' })
      loadSuppliers()
    } finally {
      setBusy(false)
    }
  }

  async function pay() {
    if (!selected || !payForm.cashbox_id || !payForm.amount) return
    setBusy(true)
    try {
      await api.post(`/suppliers/${selected.id}/pay`, {
        cashbox_id: Number(payForm.cashbox_id),
        amount: Number(payForm.amount),
        currency: payForm.currency,
        exchange_rate: 1,
      })
      setPayForm({ cashbox_id: '', amount: '', currency: 'ILS' })
      loadLedger(selected)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold text-ink">الموردون</h1>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-1">
          {canManage && (
            <button
              onClick={() => setShowForm((v) => !v)}
              className="mb-4 flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
            >
              <FontAwesomeIcon icon={faPlus} />
              مورد جديد
            </button>
          )}

          {showForm && (
            <div className="mb-4 space-y-2 rounded-xl bg-white p-4 shadow-sm">
              <input placeholder="اسم المورد" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-lg border border-ink/10 px-2 py-1.5 text-sm" />
              <input placeholder="الهاتف (اختياري)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full rounded-lg border border-ink/10 px-2 py-1.5 text-sm" />
              <button onClick={submit} disabled={busy} className="w-full rounded-lg bg-accent px-4 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-60">
                حفظ
              </button>
            </div>
          )}

          <div className="overflow-hidden rounded-xl bg-white shadow-sm">
            {suppliers.length === 0 ? (
              <p className="p-6 text-center text-sm text-ink/40">لا يوجد موردون.</p>
            ) : (
              suppliers.map((s) => (
                <button
                  key={s.id}
                  onClick={() => loadLedger(s)}
                  className={`flex w-full items-center gap-3 border-b border-ink/5 p-4 text-right text-sm last:border-0 hover:bg-background ${selected?.id === s.id ? 'bg-background' : ''}`}
                >
                  <FontAwesomeIcon icon={faTruck} className="text-ink/40" />
                  <div>
                    <p className="font-medium text-ink">{s.name}</p>
                    <p className="text-xs text-ink/50">{s.phone ?? '—'}</p>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="col-span-2">
          {!selected ? (
            <p className="rounded-xl bg-white p-6 text-center text-sm text-ink/40 shadow-sm">اختر مورداً لعرض كشف الحساب.</p>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl bg-white p-4 shadow-sm">
                <p className="text-sm text-ink/60">الرصيد المستحق للمورد</p>
                <p className={`text-2xl font-semibold ${Number(ledger?.outstanding_ils ?? 0) > 0 ? 'text-danger' : 'text-ink'}`}>
                  {ledger?.outstanding_ils ?? 0} ₪
                </p>
              </div>

              {canManage && (
                <div className="flex flex-wrap items-end gap-2 rounded-xl bg-white p-4 shadow-sm">
                  <select value={payForm.cashbox_id} onChange={(e) => setPayForm({ ...payForm, cashbox_id: e.target.value })} className="rounded-lg border border-ink/10 px-2 py-1.5 text-sm">
                    <option value="">الصندوق...</option>
                    {cashboxes.map((c) => (
                      <option key={c.id} value={c.id}>{c.name} ({c.currency})</option>
                    ))}
                  </select>
                  <input type="number" placeholder="المبلغ" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} className="w-28 rounded-lg border border-ink/10 px-2 py-1.5 text-sm" />
                  <button onClick={pay} disabled={busy} className="rounded-lg bg-accent px-4 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-60">
                    دفع للمورد
                  </button>
                </div>
              )}

              <div className="overflow-hidden rounded-xl bg-white shadow-sm">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-ink/10 text-right text-ink/60">
                      <th className="p-4 font-medium">النوع</th>
                      <th className="p-4 font-medium">المبلغ</th>
                      <th className="p-4 font-medium">الرصيد</th>
                      <th className="p-4 font-medium">التاريخ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(ledger?.transactions ?? []).length === 0 ? (
                      <tr><td colSpan={4} className="p-6 text-center text-sm text-ink/40">لا توجد حركات.</td></tr>
                    ) : (
                      ledger!.transactions.map((t) => (
                        <tr key={t.id} className="border-b border-ink/5 last:border-0">
                          <td className="p-4">{t.type}</td>
                          <td className="p-4 text-ink/70">{t.amount_ils} ₪</td>
                          <td className="p-4 text-ink/70">{t.balance_after_ils} ₪</td>
                          <td className="p-4 text-ink/70">{t.occurred_at}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
