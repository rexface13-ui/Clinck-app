import { Fragment, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faCheck, faTrash, faMagnifyingGlass, faPen, faChevronDown, faChevronLeft } from '@fortawesome/free-solid-svg-icons'
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
  const [expandedId, setExpandedId] = useState<number | null>(null)
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
  const [filterSupplierId, setFilterSupplierId] = useState('')
  const [filterStatus, setFilterStatus] = useState<'' | 'draft' | 'confirmed'>('')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [invoiceSearch, setInvoiceSearch] = useState('')

  function loadInvoices() {
    api
      .get('/purchase-invoices', {
        params: {
          supplier_id: filterSupplierId || undefined,
          status: filterStatus || undefined,
          from: filterFrom || undefined,
          to: filterTo || undefined,
          search: invoiceSearch || undefined,
        },
      })
      .then((res) => setInvoices(res.data))
  }

  function loadAll() {
    api.get('/suppliers').then((res) => setSuppliers(res.data))
    api.get('/branches').then((res) => setBranches(res.data))
    api.get('/items').then((res) => setItems(res.data))
    api.get('/cashboxes').then((res) => {
      setCashboxes(res.data)
      const ils = res.data.find((c: Cashbox) => c.currency === 'ILS')
      if (ils) setPayCashboxId(String(ils.id))
    })
    loadInvoices()
  }

  useEffect(loadAll, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadInvoices, [filterSupplierId, filterStatus, filterFrom, filterTo, invoiceSearch])

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setShowForm(true)
      searchParams.delete('new')
      setSearchParams(searchParams, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggleInvoice(invoice: PurchaseInvoice) {
    if (expandedId === invoice.id) {
      setExpandedId(null)
      setSelected(null)
      setMovements([])
      return
    }
    setExpandedId(invoice.id)
    openInvoice(invoice)
  }

  function openInvoice(invoice: PurchaseInvoice) {
    api.get(`/purchase-invoices/${invoice.id}`).then((res) => {
      setSelected(res.data)
      setNotesDraft(res.data.notes ?? '')
    })
    if (invoice.status === 'confirmed') {
      api
        .get('/stock-movements', { params: { reference_type: 'purchase_invoice', reference_id: invoice.id } })
        .then((res) => setMovements(res.data))
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
    setNewForm({ supplier_id: filterSupplierId || '', branch_id: '' })
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
      loadAll()
      setExpandedId(res.data.id)
      openInvoice(res.data)
    } finally {
      setBusy(false)
    }
  }

  const selectedItem = items.find((i) => i.id === Number(lineForm.item_id))

  function pickItem(itemId: string) {
    setLineForm((f) => ({ ...f, item_id: itemId }))
    if (!selected || !itemId) return
    api
      .get('/purchase-invoices/last-price', { params: { item_id: itemId, supplier_id: selected.supplier_id } })
      .then((res) => {
        if (res.data?.last_price != null) {
          setLineForm((f) => ({ ...f, unit_price: res.data.last_price, currency: res.data.currency }))
        }
      })
      .catch(() => {})
  }

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
      setExpandedId(null)
      setMovements([])
      loadAll()
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      window.alert(message ?? 'تعذّر حذف الفاتورة.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="فواتير الشراء"
        subtitle="فواتير المشتريات من الموردين وحركات المخزون الناتجة"
        action={
          canManage && (
            <Button onClick={openNewInvoiceForm}>
              <FontAwesomeIcon icon={faPlus} />
              فاتورة جديدة
            </Button>
          )
        }
      />

      <Card className="mb-4 flex flex-wrap items-end gap-2 p-3">
        <div className="relative">
          <FontAwesomeIcon icon={faMagnifyingGlass} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={invoiceSearch}
            onChange={(e) => setInvoiceSearch(e.target.value)}
            placeholder="بحث برقم الفاتورة أو اسم المورد..."
            className="w-64 rounded-xl border border-border bg-surface py-2 pe-3 ps-9 text-sm focus:border-accent focus:outline-none"
          />
        </div>
        <SearchableSelect
          options={suppliers.map((s) => ({ value: String(s.id), label: s.name, sublabel: s.phone ?? undefined }))}
          value={filterSupplierId}
          onChange={setFilterSupplierId}
          placeholder="كل الموردين"
          className="w-48"
        />
        <div className="flex gap-1 rounded-lg border border-border bg-white p-1">
          {(['', 'draft', 'confirmed'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                filterStatus === s ? 'bg-accent text-white' : 'text-ink/60 hover:bg-background'
              }`}
            >
              {s === '' ? 'الكل' : STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <DatePicker value={filterFrom} onChange={setFilterFrom} placeholder="من تاريخ" />
        <DatePicker value={filterTo} onChange={setFilterTo} placeholder="إلى تاريخ" />
      </Card>

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
                <Input placeholder="اسم المورد" value={newSupplierName} onChange={(e) => setNewSupplierName(e.target.value)} />
                <Input placeholder="الهاتف (اختياري)" value={newSupplierPhone} onChange={(e) => setNewSupplierPhone(e.target.value)} />
                <div className="flex gap-2">
                  <Button onClick={createSupplier} loading={creatingSupplier} className="flex-1 justify-center px-3 py-1.5 text-xs">
                    إضافة ومتابعة
                  </Button>
                  <button type="button" onClick={() => setNewSupplierName(null)} className="rounded-xl px-3 py-1.5 text-xs text-muted hover:bg-surface">
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
        <Table>
          <Thead>
            <Th></Th>
            <Th>المورد</Th>
            <Th>رقم الفاتورة</Th>
            <Th>الفرع</Th>
            <Th>الإجمالي</Th>
            <Th>الحالة</Th>
            <Th>التاريخ</Th>
          </Thead>
          <tbody>
            {invoices.length === 0 ? (
              <EmptyRow colSpan={7}>لا توجد فواتير مطابقة.</EmptyRow>
            ) : (
              invoices.map((inv) => {
                const isOpen = expandedId === inv.id
                return (
                  <Fragment key={inv.id}>
                    <Tr onClick={() => toggleInvoice(inv)} className={`cursor-pointer ${isOpen ? 'bg-accent-soft' : ''}`}>
                      <Td className="w-8 text-ink/30">
                        <FontAwesomeIcon icon={isOpen ? faChevronDown : faChevronLeft} />
                      </Td>
                      <Td className="font-medium text-ink">{inv.supplier?.name}</Td>
                      <Td className="text-muted">{inv.invoice_number ?? `#${inv.id}`}</Td>
                      <Td className="text-muted">{inv.branch?.name}</Td>
                      <Td className="text-muted">{inv.total_amount_ils} ₪</Td>
                      <Td>
                        <Badge variant={STATUS_VARIANTS[inv.status]}>{STATUS_LABELS[inv.status]}</Badge>
                      </Td>
                      <Td className="text-muted">{formatDate(inv.issued_at)}</Td>
                    </Tr>

                    {isOpen && (
                      <Tr>
                        <Td colSpan={7} className="bg-background" onClick={(e) => e.stopPropagation()}>
                          {!selected || selected.id !== inv.id ? (
                            <p className="py-3 text-center text-xs text-muted">جارِ التحميل...</p>
                          ) : (
                            <div className="space-y-4 py-3">
                              <div className="flex items-center justify-between">
                                <p className="text-sm text-muted">الإجمالي: <span className="font-semibold text-ink">{selected.total_amount_ils} ₪</span></p>
                                <div className="flex items-center gap-2">
                                  {canManage && selected.status === 'draft' && (
                                    <Button onClick={openConfirmForm} loading={busy} className="px-3 py-1.5 text-xs">
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

                              <div className="rounded-xl border border-border bg-surface p-3">
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

                              {canManage && selected.status === 'draft' && (
                                <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface p-3">
                                  <SearchableSelect
                                    options={items.map((i) => ({ value: String(i.id), label: i.name, sublabel: i.unit }))}
                                    value={lineForm.item_id}
                                    onChange={pickItem}
                                    placeholder="ابحث عن صنف..."
                                    className="w-56"
                                  />
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
                                </div>
                              )}

                              <div className="overflow-hidden rounded-xl border border-border bg-surface">
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
                                          <Td className="text-muted">{l.quantity} {l.item?.unit}</Td>
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
                              </div>

                              {selected.status === 'confirmed' && movements.length > 0 && (
                                <div className="overflow-hidden rounded-xl border border-border bg-surface">
                                  <p className="border-b border-border p-3 text-xs font-medium text-ink/70">حركات المخزون الناتجة</p>
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
                                </div>
                              )}
                            </div>
                          )}
                        </Td>
                      </Tr>
                    )}
                  </Fragment>
                )
              })
            )}
          </tbody>
        </Table>
      </Card>

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
