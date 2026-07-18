import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faCheck, faTrash, faFileInvoiceDollar } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import DatePicker from '../components/DatePicker'
import type { Branch, Item, PurchaseInvoice, StockMovement, Supplier } from '../types'

const STATUS_LABELS: Record<PurchaseInvoice['status'], string> = { draft: 'مسودة', confirmed: 'مؤكدة' }
const STATUS_COLORS: Record<PurchaseInvoice['status'], string> = {
  draft: 'bg-ink/10 text-ink/60',
  confirmed: 'bg-green-100 text-green-700',
}

export default function PurchaseInvoicesPage() {
  const { can } = useAuth()
  const canManage = can('purchasing.manage')
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([])
  const [selected, setSelected] = useState<PurchaseInvoice | null>(null)
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [showForm, setShowForm] = useState(false)
  const [newForm, setNewForm] = useState({ supplier_id: '', branch_id: '' })
  const [lineForm, setLineForm] = useState({ item_id: '', quantity: '', unit_price: '', currency: 'ILS', lot_number: '', expiry_date: '' })
  const [busy, setBusy] = useState(false)

  function loadAll() {
    api.get('/suppliers').then((res) => setSuppliers(res.data))
    api.get('/branches').then((res) => setBranches(res.data))
    api.get('/items').then((res) => setItems(res.data))
    api.get('/purchase-invoices').then((res) => setInvoices(res.data))
  }

  useEffect(loadAll, [])

  function openInvoice(invoice: PurchaseInvoice) {
    api.get(`/purchase-invoices/${invoice.id}`).then((res) => setSelected(res.data))
    if (invoice.status === 'confirmed') {
      api.get('/stock-movements').then((res) =>
        setMovements(res.data.filter((m: StockMovement & { reference_id?: number; reference_type?: string }) =>
          (m as unknown as { reference_id: number }).reference_id === invoice.id)),
      )
    } else {
      setMovements([])
    }
  }

  async function createInvoice() {
    if (!newForm.supplier_id || !newForm.branch_id) return
    setBusy(true)
    try {
      const res = await api.post('/purchase-invoices', {
        supplier_id: Number(newForm.supplier_id),
        branch_id: Number(newForm.branch_id),
      })
      setShowForm(false)
      setNewForm({ supplier_id: '', branch_id: '' })
      loadAll()
      openInvoice(res.data)
    } finally {
      setBusy(false)
    }
  }

  const selectedItem = items.find((i) => i.id === Number(lineForm.item_id))

  async function addLine() {
    if (!selected || !lineForm.item_id || !lineForm.quantity || !lineForm.unit_price) return
    setBusy(true)
    try {
      await api.post(`/purchase-invoices/${selected.id}/lines`, {
        item_id: Number(lineForm.item_id),
        quantity: Number(lineForm.quantity),
        unit_price: Number(lineForm.unit_price),
        currency: lineForm.currency,
        lot_number: lineForm.lot_number || null,
        expiry_date: lineForm.expiry_date || null,
      })
      setLineForm({ item_id: '', quantity: '', unit_price: '', currency: 'ILS', lot_number: '', expiry_date: '' })
      openInvoice(selected)
      loadAll()
    } finally {
      setBusy(false)
    }
  }

  async function removeLine(lineId: number) {
    if (!selected) return
    await api.delete(`/purchase-invoices/${selected.id}/lines/${lineId}`)
    openInvoice(selected)
    loadAll()
  }

  async function confirmInvoice() {
    if (!selected) return
    if (!confirm('تأكيد الفاتورة يحرّك المخزون ولا يمكن التراجع عنه. متابعة؟')) return
    setBusy(true)
    try {
      const res = await api.post(`/purchase-invoices/${selected.id}/confirm`)
      setSelected(res.data)
      openInvoice(res.data)
      loadAll()
    } finally {
      setBusy(false)
    }
  }

  async function fillLastPrice() {
    if (!selected || !lineForm.item_id) return
    try {
      const res = await api.get('/purchase-invoices/last-price', {
        params: { item_id: lineForm.item_id, supplier_id: selected.supplier_id },
      })
      if (res.data) {
        setLineForm((f) => ({ ...f, unit_price: res.data.last_price, currency: res.data.currency }))
      }
    } catch {
      // no price memory yet — ignore
    }
  }

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold text-ink">فواتير الشراء</h1>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-1">
          {canManage && (
            <button onClick={() => setShowForm((v) => !v)} className="mb-4 flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover">
              <FontAwesomeIcon icon={faPlus} />
              فاتورة جديدة
            </button>
          )}

          {showForm && (
            <div className="mb-4 space-y-2 rounded-xl bg-white p-4 shadow-sm">
              <select value={newForm.supplier_id} onChange={(e) => setNewForm({ ...newForm, supplier_id: e.target.value })} className="w-full rounded-lg border border-ink/10 px-2 py-1.5 text-sm">
                <option value="">المورد...</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <select value={newForm.branch_id} onChange={(e) => setNewForm({ ...newForm, branch_id: e.target.value })} className="w-full rounded-lg border border-ink/10 px-2 py-1.5 text-sm">
                <option value="">الفرع...</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <button onClick={createInvoice} disabled={busy} className="w-full rounded-lg bg-accent px-4 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-60">
                إنشاء مسودة
              </button>
            </div>
          )}

          <div className="overflow-hidden rounded-xl bg-white shadow-sm">
            {invoices.length === 0 ? (
              <p className="p-6 text-center text-sm text-ink/40">لا توجد فواتير.</p>
            ) : (
              invoices.map((inv) => (
                <button
                  key={inv.id}
                  onClick={() => openInvoice(inv)}
                  className={`flex w-full items-center justify-between gap-2 border-b border-ink/5 p-4 text-right text-sm last:border-0 hover:bg-background ${selected?.id === inv.id ? 'bg-background' : ''}`}
                >
                  <div className="flex items-center gap-2">
                    <FontAwesomeIcon icon={faFileInvoiceDollar} className="text-ink/40" />
                    <div>
                      <p className="font-medium text-ink">{inv.supplier?.name}</p>
                      <p className="text-xs text-ink/50">{inv.total_amount_ils} ₪</p>
                    </div>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_COLORS[inv.status]}`}>{STATUS_LABELS[inv.status]}</span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="col-span-2">
          {!selected ? (
            <p className="rounded-xl bg-white p-6 text-center text-sm text-ink/40 shadow-sm">اختر فاتورة لعرض التفاصيل.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-xl bg-white p-4 shadow-sm">
                <div>
                  <p className="font-medium text-ink">{selected.supplier?.name} — {selected.branch?.name}</p>
                  <p className="text-sm text-ink/60">الإجمالي: {selected.total_amount_ils} ₪</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-3 py-1 text-xs ${STATUS_COLORS[selected.status]}`}>{STATUS_LABELS[selected.status]}</span>
                  {canManage && selected.status === 'draft' && (
                    <button onClick={confirmInvoice} disabled={busy} className="flex items-center gap-2 rounded-xl bg-green-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60">
                      <FontAwesomeIcon icon={faCheck} />
                      تأكيد الفاتورة
                    </button>
                  )}
                </div>
              </div>

              {canManage && selected.status === 'draft' && (
                <div className="flex flex-wrap items-end gap-2 rounded-xl bg-white p-4 shadow-sm">
                  <select value={lineForm.item_id} onChange={(e) => setLineForm({ ...lineForm, item_id: e.target.value })} onBlur={fillLastPrice} className="rounded-lg border border-ink/10 px-2 py-1.5 text-sm">
                    <option value="">الصنف...</option>
                    {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                  <input type="number" placeholder="الكمية" value={lineForm.quantity} onChange={(e) => setLineForm({ ...lineForm, quantity: e.target.value })} className="w-24 rounded-lg border border-ink/10 px-2 py-1.5 text-sm" />
                  <input type="number" placeholder="سعر الوحدة" value={lineForm.unit_price} onChange={(e) => setLineForm({ ...lineForm, unit_price: e.target.value })} className="w-28 rounded-lg border border-ink/10 px-2 py-1.5 text-sm" />
                  <select value={lineForm.currency} onChange={(e) => setLineForm({ ...lineForm, currency: e.target.value })} className="rounded-lg border border-ink/10 px-2 py-1.5 text-sm">
                    <option value="ILS">ILS</option>
                    <option value="USD">USD</option>
                    <option value="JOD">JOD</option>
                  </select>
                  {selectedItem?.type === 'tracked' && (
                    <>
                      <input placeholder="رقم الدفعة" value={lineForm.lot_number} onChange={(e) => setLineForm({ ...lineForm, lot_number: e.target.value })} className="w-32 rounded-lg border border-ink/10 px-2 py-1.5 text-sm" />
                      <div className="w-40">
                        <DatePicker value={lineForm.expiry_date} onChange={(v) => setLineForm({ ...lineForm, expiry_date: v })} placeholder="تاريخ الصلاحية" />
                      </div>
                    </>
                  )}
                  <button onClick={addLine} disabled={busy} className="rounded-lg bg-accent px-4 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-60">
                    إضافة بند
                  </button>
                </div>
              )}

              <div className="overflow-hidden rounded-xl bg-white shadow-sm">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-ink/10 text-right text-ink/60">
                      <th className="p-4 font-medium">الصنف</th>
                      <th className="p-4 font-medium">الكمية</th>
                      <th className="p-4 font-medium">السعر</th>
                      <th className="p-4 font-medium">المبلغ</th>
                      {canManage && selected.status === 'draft' && <th className="p-4"></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {(selected.lines ?? []).length === 0 ? (
                      <tr><td colSpan={5} className="p-6 text-center text-sm text-ink/40">لا توجد بنود.</td></tr>
                    ) : (
                      selected.lines!.map((l) => (
                        <tr key={l.id} className="border-b border-ink/5 last:border-0">
                          <td className="p-4">{l.item?.name}</td>
                          <td className="p-4 text-ink/70">{l.quantity}</td>
                          <td className="p-4 text-ink/70">{l.unit_price} {l.currency}</td>
                          <td className="p-4 text-ink/70">{l.amount_ils} ₪</td>
                          {canManage && selected.status === 'draft' && (
                            <td className="p-4">
                              <button onClick={() => removeLine(l.id)} className="text-danger hover:opacity-70">
                                <FontAwesomeIcon icon={faTrash} />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {selected.status === 'confirmed' && movements.length > 0 && (
                <div className="overflow-hidden rounded-xl bg-white shadow-sm">
                  <p className="border-b border-ink/10 p-4 text-sm font-medium text-ink">حركات المخزون الناتجة</p>
                  <table className="w-full text-sm">
                    <tbody>
                      {movements.map((m) => (
                        <tr key={m.id} className="border-b border-ink/5 last:border-0">
                          <td className="p-4">{m.item?.name}</td>
                          <td className="p-4 text-ink/70">{m.type}</td>
                          <td className="p-4 text-green-600">+{m.quantity}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
