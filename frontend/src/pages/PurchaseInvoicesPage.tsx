import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faCheck, faTrash, faFileInvoiceDollar } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import DatePicker from '../components/DatePicker'
import { Card, PageHeader, Badge, Button, Modal, Table, Thead, Th, Td, Tr, EmptyRow, SearchableSelect, Input } from '../components/ui'
import type { BadgeVariant } from '../components/ui'
import type { Branch, Item, PurchaseInvoice, StockMovement, Supplier } from '../types'

const STATUS_LABELS: Record<PurchaseInvoice['status'], string> = { draft: 'مسودة', confirmed: 'مؤكدة' }
const STATUS_VARIANTS: Record<PurchaseInvoice['status'], BadgeVariant> = { draft: 'neutral', confirmed: 'success' }

export default function PurchaseInvoicesPage() {
  const { can } = useAuth()
  const canManage = can('purchasing.manage')
  const [searchParams, setSearchParams] = useSearchParams()
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([])
  const [selected, setSelected] = useState<PurchaseInvoice | null>(null)
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [showForm, setShowForm] = useState(() => searchParams.get('new') === '1')
  const [newForm, setNewForm] = useState({ supplier_id: '', branch_id: '' })
  const [newSupplierName, setNewSupplierName] = useState<string | null>(null)
  const [newSupplierPhone, setNewSupplierPhone] = useState('')
  const [creatingSupplier, setCreatingSupplier] = useState(false)
  const [lineForm, setLineForm] = useState({ item_id: '', quantity: '', unit_price: '', currency: 'ILS', lot_number: '', expiry_date: '' })
  const [busy, setBusy] = useState(false)

  function loadAll() {
    api.get('/suppliers').then((res) => setSuppliers(res.data))
    api.get('/branches').then((res) => setBranches(res.data))
    api.get('/items').then((res) => setItems(res.data))
    api.get('/purchase-invoices').then((res) => setInvoices(res.data))
  }

  useEffect(loadAll, [])

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setShowForm(true)
      searchParams.delete('new')
      setSearchParams(searchParams, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  async function createSupplier() {
    if (!newSupplierName?.trim()) return
    setCreatingSupplier(true)
    try {
      const res = await api.post('/suppliers', { name: newSupplierName.trim(), phone: newSupplierPhone || null })
      setSuppliers((prev) => [...prev, res.data])
      setNewForm({ ...newForm, supplier_id: String(res.data.id) })
      setNewSupplierName(null)
      setNewSupplierPhone('')
    } finally {
      setCreatingSupplier(false)
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
      <PageHeader title="فواتير الشراء" subtitle="فواتير الموردين وحركات المخزون الناتجة" />

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-1">
          {canManage && (
            <Button onClick={() => setShowForm((v) => !v)} className="mb-4">
              <FontAwesomeIcon icon={faPlus} />
              فاتورة جديدة
            </Button>
          )}

          {showForm && (
            <Modal title="فاتورة شراء جديدة" onClose={() => setShowForm(false)}>
              <div className="space-y-3">
                <SearchableSelect
                  options={suppliers.map((s) => ({ value: String(s.id), label: s.name, sublabel: s.phone ?? undefined }))}
                  value={newForm.supplier_id}
                  onChange={(value) => setNewForm({ ...newForm, supplier_id: value })}
                  placeholder="المورد..."
                  onCreateNew={(query) => setNewSupplierName(query)}
                  createNewLabel="مورد جديد"
                />

                {newSupplierName !== null && (
                  <div className="space-y-2 rounded-lg bg-background p-3">
                    <p className="text-xs font-medium text-ink/70">مورد جديد</p>
                    <Input
                      placeholder="اسم المورد"
                      value={newSupplierName}
                      onChange={(e) => setNewSupplierName(e.target.value)}
                    />
                    <Input
                      placeholder="الهاتف (اختياري)"
                      value={newSupplierPhone}
                      onChange={(e) => setNewSupplierPhone(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button onClick={createSupplier} loading={creatingSupplier} className="flex-1 justify-center px-3 py-1.5 text-xs">
                        إضافة ومتابعة
                      </Button>
                      <button
                        type="button"
                        onClick={() => setNewSupplierName(null)}
                        className="rounded-xl px-3 py-1.5 text-xs text-muted hover:bg-surface"
                      >
                        إلغاء
                      </button>
                    </div>
                  </div>
                )}
                <select value={newForm.branch_id} onChange={(e) => setNewForm({ ...newForm, branch_id: e.target.value })} className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none">
                  <option value="">الفرع...</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <Button onClick={createInvoice} loading={busy} className="w-full justify-center">
                  إنشاء مسودة
                </Button>
              </div>
            </Modal>
          )}

          <Card>
            {invoices.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted">لا توجد فواتير.</p>
            ) : (
              invoices.map((inv) => (
                <button
                  key={inv.id}
                  onClick={() => openInvoice(inv)}
                  className={`flex w-full items-center justify-between gap-2 border-b border-border/70 p-4 text-right text-sm last:border-0 hover:bg-background ${selected?.id === inv.id ? 'bg-background' : ''}`}
                >
                  <div className="flex items-center gap-2">
                    <FontAwesomeIcon icon={faFileInvoiceDollar} className="text-ink/40" />
                    <div>
                      <p className="font-medium text-ink">{inv.supplier?.name}</p>
                      <p className="text-xs text-muted">{inv.total_amount_ils} ₪</p>
                    </div>
                  </div>
                  <Badge variant={STATUS_VARIANTS[inv.status]}>{STATUS_LABELS[inv.status]}</Badge>
                </button>
              ))
            )}
          </Card>
        </div>

        <div className="col-span-2">
          {!selected ? (
            <Card className="p-6 text-center text-sm text-muted">اختر فاتورة لعرض التفاصيل.</Card>
          ) : (
            <div className="space-y-4">
              <Card className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium text-ink">{selected.supplier?.name} — {selected.branch?.name}</p>
                  <p className="text-sm text-muted">الإجمالي: {selected.total_amount_ils} ₪</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={STATUS_VARIANTS[selected.status]}>{STATUS_LABELS[selected.status]}</Badge>
                  {canManage && selected.status === 'draft' && (
                    <Button onClick={confirmInvoice} loading={busy}>
                      <FontAwesomeIcon icon={faCheck} />
                      تأكيد الفاتورة
                    </Button>
                  )}
                </div>
              </Card>

              {canManage && selected.status === 'draft' && (
                <Card className="flex flex-wrap items-end gap-2 p-4">
                  <select value={lineForm.item_id} onChange={(e) => setLineForm({ ...lineForm, item_id: e.target.value })} onBlur={fillLastPrice} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none">
                    <option value="">الصنف...</option>
                    {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                  <input type="number" placeholder="الكمية" value={lineForm.quantity} onChange={(e) => setLineForm({ ...lineForm, quantity: e.target.value })} className="w-24 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none" />
                  <input type="number" placeholder="سعر الوحدة" value={lineForm.unit_price} onChange={(e) => setLineForm({ ...lineForm, unit_price: e.target.value })} className="w-28 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none" />
                  <select value={lineForm.currency} onChange={(e) => setLineForm({ ...lineForm, currency: e.target.value })} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none">
                    <option value="ILS">ILS</option>
                    <option value="USD">USD</option>
                    <option value="JOD">JOD</option>
                  </select>
                  {selectedItem?.type === 'tracked' && (
                    <>
                      <input placeholder="رقم الدفعة" value={lineForm.lot_number} onChange={(e) => setLineForm({ ...lineForm, lot_number: e.target.value })} className="w-32 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none" />
                      <div className="w-40">
                        <DatePicker value={lineForm.expiry_date} onChange={(v) => setLineForm({ ...lineForm, expiry_date: v })} placeholder="تاريخ الصلاحية" />
                      </div>
                    </>
                  )}
                  <Button onClick={addLine} loading={busy} className="px-4 py-1.5">
                    إضافة بند
                  </Button>
                </Card>
              )}

              <Card>
                <Table>
                  <Thead>
                    <Th>الصنف</Th>
                    <Th>الكمية</Th>
                    <Th>السعر</Th>
                    <Th>المبلغ</Th>
                    {canManage && selected.status === 'draft' && <Th></Th>}
                  </Thead>
                  <tbody>
                    {(selected.lines ?? []).length === 0 ? (
                      <EmptyRow colSpan={5}>لا توجد بنود.</EmptyRow>
                    ) : (
                      selected.lines!.map((l) => (
                        <Tr key={l.id}>
                          <Td>{l.item?.name}</Td>
                          <Td className="text-muted">{l.quantity}</Td>
                          <Td className="text-muted">{l.unit_price} {l.currency}</Td>
                          <Td className="text-muted">{l.amount_ils} ₪</Td>
                          {canManage && selected.status === 'draft' && (
                            <Td>
                              <button onClick={() => removeLine(l.id)} className="text-danger hover:opacity-70">
                                <FontAwesomeIcon icon={faTrash} />
                              </button>
                            </Td>
                          )}
                        </Tr>
                      ))
                    )}
                  </tbody>
                </Table>
              </Card>

              {selected.status === 'confirmed' && movements.length > 0 && (
                <Card>
                  <p className="border-b border-border p-4 text-sm font-medium text-ink">حركات المخزون الناتجة</p>
                  <Table>
                    <tbody>
                      {movements.map((m) => (
                        <Tr key={m.id}>
                          <Td>{m.item?.name}</Td>
                          <Td className="text-muted">{m.type}</Td>
                          <Td className="text-success">+{m.quantity}</Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                </Card>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
