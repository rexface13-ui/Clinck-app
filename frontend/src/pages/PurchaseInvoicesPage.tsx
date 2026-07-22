import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faCheck, faTrash, faFileInvoiceDollar, faMagnifyingGlass, faTruck, faPen } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { formatDate } from '../lib/formatDate'
import DatePicker from '../components/DatePicker'
import { Card, PageHeader, Badge, Button, Modal, Table, Thead, Th, Td, Tr, EmptyRow, SearchableSelect, Input } from '../components/ui'
import type { BadgeVariant } from '../components/ui'
import type { Branch, Cashbox, Item, PurchaseInvoice, StockMovement, Supplier } from '../types'

const STATUS_LABELS: Record<PurchaseInvoice['status'], string> = { draft: 'مسودة', confirmed: 'مؤكدة' }
const STATUS_VARIANTS: Record<PurchaseInvoice['status'], BadgeVariant> = { draft: 'neutral', confirmed: 'success' }

type PaymentMethod = 'credit' | 'cash' | 'check'

export default function PurchaseInvoicesPage() {
  const { can } = useAuth()
  const canManage = can('purchasing.manage')
  const [searchParams, setSearchParams] = useSearchParams()
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([])
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([])
  const [supplierSearch, setSupplierSearch] = useState('')
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null)
  const [selected, setSelected] = useState<PurchaseInvoice | null>(null)
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [showForm, setShowForm] = useState(() => searchParams.get('new') === '1')
  const [newForm, setNewForm] = useState({ supplier_id: '', branch_id: '' })
  const [newSupplierName, setNewSupplierName] = useState<string | null>(null)
  const [newSupplierPhone, setNewSupplierPhone] = useState('')
  const [creatingSupplier, setCreatingSupplier] = useState(false)
  const [lineForm, setLineForm] = useState({ item_id: '', quantity: '', unit_price: '', currency: 'ILS', lot_number: '', expiry_date: '' })
  const [busy, setBusy] = useState(false)
  const [showConfirmForm, setShowConfirmForm] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('credit')
  const [payCashboxId, setPayCashboxId] = useState('')
  const [payCheck, setPayCheck] = useState({ check_number: '', bank_name: '', due_date: '' })
  const [notesDraft, setNotesDraft] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)

  function loadAll() {
    api.get('/suppliers').then((res) => setSuppliers(res.data))
    api.get('/branches').then((res) => setBranches(res.data))
    api.get('/items').then((res) => setItems(res.data))
    api.get('/cashboxes').then((res) => {
      setCashboxes(res.data)
      const ils = res.data.find((c: Cashbox) => c.currency === 'ILS')
      if (ils) setPayCashboxId(String(ils.id))
    })
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

  function selectSupplier(supplier: Supplier) {
    setSelectedSupplier(supplier)
    setSelected(null)
    setMovements([])
  }

  function openInvoice(invoice: PurchaseInvoice) {
    api.get(`/purchase-invoices/${invoice.id}`).then((res) => {
      setSelected(res.data)
      setNotesDraft(res.data.notes ?? '')
    })
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

  function openNewInvoiceForm() {
    setNewForm({ supplier_id: selectedSupplier ? String(selectedSupplier.id) : '', branch_id: '' })
    setShowForm(true)
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
      const supplier = suppliers.find((s) => s.id === Number(newForm.supplier_id))
      if (supplier) setSelectedSupplier(supplier)
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

  function openConfirmForm() {
    setPaymentMethod('credit')
    setPayCheck({ check_number: '', bank_name: '', due_date: '' })
    setShowConfirmForm(true)
  }

  async function confirmInvoice() {
    if (!selected) return
    if (paymentMethod === 'cash' && !payCashboxId) return
    if (paymentMethod === 'check' && (!payCheck.check_number || !payCheck.due_date)) return
    setBusy(true)
    try {
      const payload: Record<string, unknown> = { payment_method: paymentMethod }
      if (paymentMethod === 'cash') payload.cashbox_id = Number(payCashboxId)
      if (paymentMethod === 'check') {
        payload.check_number = payCheck.check_number
        payload.bank_name = payCheck.bank_name || null
        payload.due_date = payCheck.due_date
      }
      const res = await api.post(`/purchase-invoices/${selected.id}/confirm`, payload)
      setShowConfirmForm(false)
      setSelected(res.data)
      openInvoice(res.data)
      loadAll()
    } finally {
      setBusy(false)
    }
  }

  async function saveNotes() {
    if (!selected) return
    setSavingNotes(true)
    try {
      const res = await api.put(`/purchase-invoices/${selected.id}`, { notes: notesDraft || null })
      setSelected(res.data)
    } finally {
      setSavingNotes(false)
    }
  }

  async function revertInvoice() {
    if (!selected) return
    if (!confirm('تعديل الفاتورة بيلغي كل أثر تركته (حركات المخزون، دين المورد، أي دفعة أو شيك)، وبتصير قابلة للتعديل من جديد. متابعة؟'))
      return
    setBusy(true)
    try {
      const res = await api.post(`/purchase-invoices/${selected.id}/revert`)
      setSelected(res.data)
      setMovements([])
      loadAll()
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      window.alert(message ?? 'تعذّر تعديل الفاتورة.')
    } finally {
      setBusy(false)
    }
  }

  async function deleteInvoice() {
    if (!selected) return
    const warning =
      selected.status === 'confirmed'
        ? 'حذف هذي الفاتورة نهائي — بيلغي كل أثر تركته (حركات المخزون، دين المورد، أي دفعة أو شيك) وما فيه رجعة. متابعة؟'
        : 'حذف هذي الفاتورة نهائياً؟'
    if (!confirm(warning)) return
    setBusy(true)
    try {
      await api.delete(`/purchase-invoices/${selected.id}`)
      setSelected(null)
      setMovements([])
      loadAll()
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      window.alert(message ?? 'تعذّر حذف الفاتورة.')
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
      // No purchase history for this item/supplier yet returns `{}` — don't
      // let that wipe out the currency field's default ('ILS') with undefined.
      if (res.data?.last_price != null) {
        setLineForm((f) => ({ ...f, unit_price: res.data.last_price, currency: res.data.currency }))
      }
    } catch {
      // no price memory yet — ignore
    }
  }

  const filteredSuppliers = suppliers.filter((s) => {
    const q = supplierSearch.trim().toLowerCase()
    if (!q) return true
    return s.name.toLowerCase().includes(q) || (s.phone ?? '').toLowerCase().includes(q)
  })

  const supplierInvoices = selectedSupplier ? invoices.filter((inv) => inv.supplier_id === selectedSupplier.id) : []

  return (
    <div>
      <PageHeader title="فواتير الشراء" subtitle="اختر مورداً لعرض فواتيره، وحركات المخزون الناتجة" />

      <div className="grid grid-cols-4 gap-6">
        <div className="col-span-1">
          <div className="relative mb-3">
            <FontAwesomeIcon icon={faMagnifyingGlass} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={supplierSearch}
              onChange={(e) => setSupplierSearch(e.target.value)}
              placeholder="بحث بالاسم أو الهاتف..."
              className="w-full rounded-xl border border-border bg-surface py-2.5 pe-3 ps-9 text-sm focus:border-accent focus:outline-none"
            />
          </div>
          <Card>
            {filteredSuppliers.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted">{supplierSearch ? 'لا توجد نتائج مطابقة.' : 'لا يوجد موردون.'}</p>
            ) : (
              filteredSuppliers.map((s) => (
                <button
                  key={s.id}
                  onClick={() => selectSupplier(s)}
                  className={`flex w-full items-center gap-3 border-b border-border/70 p-4 text-right text-sm last:border-0 hover:bg-background ${selectedSupplier?.id === s.id ? 'bg-background' : ''}`}
                >
                  <FontAwesomeIcon icon={faTruck} className="text-ink/40" />
                  <div>
                    <p className="font-medium text-ink">{s.name}</p>
                    <p className="text-xs text-muted">{s.phone ?? '—'}</p>
                  </div>
                </button>
              ))
            )}
          </Card>
        </div>

        <div className="col-span-1">
          {!selectedSupplier ? (
            <Card className="p-6 text-center text-sm text-muted">اختر مورداً لعرض فواتيره.</Card>
          ) : (
            <>
              {canManage && (
                <Button onClick={openNewInvoiceForm} className="mb-4 w-full justify-center">
                  <FontAwesomeIcon icon={faPlus} />
                  فاتورة جديدة لـ{selectedSupplier.name}
                </Button>
              )}
              <Card>
                {supplierInvoices.length === 0 ? (
                  <p className="p-6 text-center text-sm text-muted">لا توجد فواتير لهذا المورد.</p>
                ) : (
                  supplierInvoices.map((inv) => (
                    <button
                      key={inv.id}
                      onClick={() => openInvoice(inv)}
                      className={`flex w-full items-center justify-between gap-2 border-b border-border/70 p-4 text-right text-sm last:border-0 hover:bg-background ${selected?.id === inv.id ? 'bg-background' : ''}`}
                    >
                      <div className="flex items-center gap-2">
                        <FontAwesomeIcon icon={faFileInvoiceDollar} className="text-ink/40" />
                        <div>
                          <p className="font-medium text-ink">{inv.invoice_number ?? `#${inv.id}`}</p>
                          <p className="text-xs text-muted">{inv.total_amount_ils} ₪</p>
                        </div>
                      </div>
                      <Badge variant={STATUS_VARIANTS[inv.status]}>{STATUS_LABELS[inv.status]}</Badge>
                    </button>
                  ))
                )}
              </Card>
            </>
          )}
        </div>

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

        <div className="col-span-2">
          {!selected ? (
            <Card className="p-6 text-center text-sm text-muted">اختر فاتورة لعرض التفاصيل.</Card>
          ) : (
            <div className="space-y-4">
              <Card className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-ink">{selected.supplier?.name} — {selected.branch?.name}</p>
                    <p className="text-sm text-muted">الإجمالي: {selected.total_amount_ils} ₪ — {formatDate(selected.issued_at)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={STATUS_VARIANTS[selected.status]}>{STATUS_LABELS[selected.status]}</Badge>
                    {canManage && selected.status === 'draft' && (
                      <Button onClick={openConfirmForm} loading={busy}>
                        <FontAwesomeIcon icon={faCheck} />
                        تأكيد الفاتورة
                      </Button>
                    )}
                    {canManage && selected.status === 'confirmed' && (
                      <button onClick={revertInvoice} disabled={busy} className="flex items-center gap-1 rounded-lg bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent hover:text-white disabled:opacity-50">
                        <FontAwesomeIcon icon={faPen} />
                        تعديل
                      </button>
                    )}
                    {canManage && (
                      <button onClick={deleteInvoice} disabled={busy} className="flex items-center gap-1 rounded-lg bg-danger-soft px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger hover:text-white disabled:opacity-50">
                        <FontAwesomeIcon icon={faTrash} />
                        حذف
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-3 border-t border-border/70 pt-3">
                  <label className="mb-1 block text-xs font-medium text-muted">ملاحظات</label>
                  <textarea
                    value={notesDraft}
                    onChange={(e) => setNotesDraft(e.target.value)}
                    rows={2}
                    placeholder="أي ملاحظة على هذي الفاتورة..."
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
                  />
                  {canManage && (
                    <button
                      onClick={saveNotes}
                      disabled={savingNotes || notesDraft === (selected.notes ?? '')}
                      className="mt-2 rounded-lg bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent hover:text-white disabled:opacity-50"
                    >
                      {savingNotes ? 'جارِ الحفظ...' : 'حفظ الملاحظة'}
                    </button>
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

      {showConfirmForm && selected && (
        <Modal title="تأكيد الفاتورة والدفع" onClose={() => setShowConfirmForm(false)} width="w-[420px]">
          <div className="space-y-3">
            <p className="text-xs text-ink/50">تأكيد الفاتورة يحرّك المخزون ولا يمكن التراجع عنه.</p>
            <div className="flex gap-1 rounded-lg border border-border bg-white p-1">
              <button
                type="button"
                onClick={() => setPaymentMethod('credit')}
                className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${paymentMethod === 'credit' ? 'bg-accent text-white' : 'text-ink/60 hover:bg-background'}`}
              >
                على الدين
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod('cash')}
                className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${paymentMethod === 'cash' ? 'bg-accent text-white' : 'text-ink/60 hover:bg-background'}`}
              >
                نقداً
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod('check')}
                className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${paymentMethod === 'check' ? 'bg-accent text-white' : 'text-ink/60 hover:bg-background'}`}
              >
                شيك
              </button>
            </div>

            {paymentMethod === 'credit' && (
              <p className="text-xs text-muted">المبلغ بيضل ديناً على العيادة للمورد، تقدر تسدده لاحقاً من صفحة الموردون.</p>
            )}

            {paymentMethod === 'cash' && (
              <select value={payCashboxId} onChange={(e) => setPayCashboxId(e.target.value)} className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none">
                <option value="">الصندوق...</option>
                {cashboxes.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.currency})</option>)}
              </select>
            )}

            {paymentMethod === 'check' && (
              <div className="space-y-2">
                <input
                  placeholder="رقم الشيك"
                  value={payCheck.check_number}
                  onChange={(e) => setPayCheck({ ...payCheck, check_number: e.target.value })}
                  className="w-full rounded-lg border border-border px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
                />
                <input
                  placeholder="اسم البنك (اختياري)"
                  value={payCheck.bank_name}
                  onChange={(e) => setPayCheck({ ...payCheck, bank_name: e.target.value })}
                  className="w-full rounded-lg border border-border px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
                />
                <DatePicker value={payCheck.due_date} onChange={(v) => setPayCheck({ ...payCheck, due_date: v })} placeholder="تاريخ الاستحقاق" />
                <p className="text-[11px] text-ink/40">الدين بيضل قائم على المورد لحد ما الشيك يتحصّل فعلياً — إذا رجع، بيرجع يضاف تلقائياً.</p>
              </div>
            )}

            <Button onClick={confirmInvoice} loading={busy} className="w-full justify-center">
              تأكيد الفاتورة
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
