import { Fragment, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faTruck, faPen, faMagnifyingGlass, faTrash, faMoneyCheckDollar, faCheck, faXmark, faChevronDown, faChevronLeft } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import DatePicker from '../components/DatePicker'
import { Card, PageHeader, Button, Table, Thead, Th, Td, Tr, EmptyRow, SearchableSelect } from '../components/ui'
import type { Cashbox, Supplier, SupplierLedger, SupplierLedgerRow } from '../types'

const TYPE_LABELS: Record<SupplierLedgerRow['type'], string> = {
  purchase: 'مشتريات',
  payment: 'دفعة',
  discount: 'خصم',
  check_endorsed: 'شيك مُظهّر',
  check_bounced: 'شيك راجع',
  adjustment: 'تسوية',
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function SuppliersPage() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([])
  const [selected, setSelected] = useState<Supplier | null>(null)
  const [ledger, setLedger] = useState<SupplierLedger | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '' })
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', phone: '' })
  const [search, setSearch] = useState('')

  const [actionTab, setActionTab] = useState<'pay' | 'discount' | null>(null)
  const [payForm, setPayForm] = useState({ cashbox_id: '', amount: '', exchange_rate: '1', notes: '', occurred_at: todayIso() })
  const payCashbox = cashboxes.find((c) => c.id === Number(payForm.cashbox_id))
  const [discountForm, setDiscountForm] = useState({ amount: '', notes: '', occurred_at: todayIso() })

  const [editingTxId, setEditingTxId] = useState<number | null>(null)
  const [editTxForm, setEditTxForm] = useState({ amount: '', notes: '', occurred_at: '' })

  const canManage = can('suppliers.manage')
  const filteredSuppliers = suppliers.filter((s) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return s.name.toLowerCase().includes(q) || (s.phone ?? '').toLowerCase().includes(q)
  })

  function loadSuppliers() {
    api.get('/suppliers').then((res) => setSuppliers(res.data))
    api.get('/cashboxes').then((res) => setCashboxes(res.data))
  }

  useEffect(loadSuppliers, [])

  function toggleSupplier(supplier: Supplier) {
    if (selected?.id === supplier.id) {
      setSelected(null)
      setLedger(null)
      return
    }
    setSelected(supplier)
    setEditing(false)
    setActionTab(null)
    setEditingTxId(null)
    setLedger(null)
    api.get(`/suppliers/${supplier.id}/ledger`).then((res) => setLedger(res.data))
  }

  function refreshLedger() {
    if (!selected) return
    api.get(`/suppliers/${selected.id}/ledger`).then((res) => setLedger(res.data))
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

  function startEdit() {
    if (!selected) return
    setEditForm({ name: selected.name, phone: selected.phone ?? '' })
    setEditing(true)
  }

  async function saveEdit() {
    if (!selected || !editForm.name) return
    setBusy(true)
    try {
      const res = await api.put(`/suppliers/${selected.id}`, { name: editForm.name, phone: editForm.phone || null })
      setSelected(res.data)
      setEditing(false)
      loadSuppliers()
    } finally {
      setBusy(false)
    }
  }

  async function deleteSupplier() {
    if (!selected) return
    if (!window.confirm('حذف هذا المورد نهائياً؟')) return
    setBusy(true)
    try {
      await api.delete(`/suppliers/${selected.id}`)
      setSelected(null)
      setLedger(null)
      loadSuppliers()
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      window.alert(message ?? 'تعذّر حذف المورد.')
    } finally {
      setBusy(false)
    }
  }

  async function pay() {
    if (!selected || !payForm.cashbox_id || !payForm.amount || !payCashbox) return
    const exchangeRate = Number(payForm.exchange_rate) || 1
    if (payCashbox.currency !== 'ILS' && exchangeRate <= 0) return
    setBusy(true)
    try {
      await api.post(`/suppliers/${selected.id}/pay`, {
        cashbox_id: Number(payForm.cashbox_id),
        amount: Number(payForm.amount),
        currency: payCashbox.currency,
        exchange_rate: exchangeRate,
        notes: payForm.notes || null,
        occurred_at: payForm.occurred_at,
      })
      setPayForm({ cashbox_id: '', amount: '', exchange_rate: '1', notes: '', occurred_at: todayIso() })
      setActionTab(null)
      refreshLedger()
      loadSuppliers()
    } finally {
      setBusy(false)
    }
  }

  async function submitDiscount() {
    if (!selected || !discountForm.amount) return
    setBusy(true)
    try {
      await api.post(`/suppliers/${selected.id}/discount`, {
        amount: Number(discountForm.amount),
        notes: discountForm.notes || null,
        occurred_at: discountForm.occurred_at,
      })
      setDiscountForm({ amount: '', notes: '', occurred_at: todayIso() })
      setActionTab(null)
      refreshLedger()
      loadSuppliers()
    } finally {
      setBusy(false)
    }
  }

  function startEditTx(row: SupplierLedgerRow) {
    setEditingTxId(row.id)
    setEditTxForm({ amount: String(Math.abs(Number(row.amount_ils))), notes: row.notes ?? '', occurred_at: row.occurred_at_iso })
  }

  async function saveEditTx() {
    if (!selected || editingTxId === null || !editTxForm.amount) return
    setBusy(true)
    try {
      await api.put(`/suppliers/${selected.id}/transactions/${editingTxId}`, {
        amount: Number(editTxForm.amount),
        notes: editTxForm.notes || null,
        occurred_at: editTxForm.occurred_at,
      })
      setEditingTxId(null)
      refreshLedger()
      loadSuppliers()
    } finally {
      setBusy(false)
    }
  }

  async function deleteTx(row: SupplierLedgerRow) {
    if (!selected) return
    if (!window.confirm('حذف هذه الحركة نهائياً؟')) return
    setBusy(true)
    try {
      await api.delete(`/suppliers/${selected.id}/transactions/${row.id}`)
      refreshLedger()
      loadSuppliers()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="الموردون"
        subtitle="كشوف حسابات وتسديد الموردين"
        action={
          canManage && (
            <Button onClick={() => setShowForm((v) => !v)}>
              <FontAwesomeIcon icon={faPlus} />
              مورد جديد
            </Button>
          )
        }
      />

      {showForm && (
        <Card className="mb-4 flex flex-wrap items-end gap-2 p-4">
          <input placeholder="اسم المورد" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-56 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none" />
          <input placeholder="الهاتف (اختياري)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-48 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none" />
          <Button onClick={submit} loading={busy}>
            حفظ
          </Button>
        </Card>
      )}

      <div className="relative mb-4 w-full sm:w-80">
        <FontAwesomeIcon icon={faMagnifyingGlass} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="بحث بالاسم أو الهاتف..."
          className="w-full rounded-xl border border-border bg-surface py-2.5 pe-3 ps-9 text-sm focus:border-accent focus:outline-none"
        />
      </div>

      <Card>
        <Table>
          <Thead>
            <Th></Th>
            <Th>المورد</Th>
            <Th>الهاتف</Th>
            <Th>المستحق</Th>
          </Thead>
          <tbody>
            {filteredSuppliers.length === 0 ? (
              <EmptyRow colSpan={4}>{search ? 'لا توجد نتائج مطابقة.' : 'لا يوجد موردون.'}</EmptyRow>
            ) : (
              filteredSuppliers.map((s) => {
                const owed = Number(s.outstanding_ils)
                const isOpen = selected?.id === s.id
                return (
                  <Fragment key={s.id}>
                    <Tr
                      onClick={() => toggleSupplier(s)}
                      className={`cursor-pointer ${isOpen ? 'bg-accent-soft' : ''} ${!s.is_active ? 'opacity-60' : ''}`}
                    >
                      <Td className="w-8 text-ink/30">
                        <FontAwesomeIcon icon={isOpen ? faChevronDown : faChevronLeft} />
                      </Td>
                      <Td className="flex items-center gap-2 font-medium text-ink">
                        <FontAwesomeIcon icon={faTruck} className="text-ink/30" />
                        {s.name}
                      </Td>
                      <Td className="text-muted">{s.phone ?? '—'}</Td>
                      <Td className={owed > 0 ? 'font-semibold text-danger' : 'text-ink'}>{owed.toFixed(2)} ₪</Td>
                    </Tr>

                    {isOpen && (
                      <Tr>
                        <Td colSpan={4} className="bg-background" onClick={(e) => e.stopPropagation()}>
                          <div className="space-y-4 py-3">
                            <div className="flex items-center justify-between">
                              <p className={`text-xl font-semibold ${Number(ledger?.outstanding_ils ?? 0) > 0 ? 'text-danger' : 'text-ink'}`}>
                                المستحق: {ledger?.outstanding_ils ?? 0} ₪
                              </p>
                              {canManage && !editing && (
                                <div className="flex items-center gap-3">
                                  <button onClick={startEdit} className="flex items-center gap-1 text-xs text-accent hover:underline">
                                    <FontAwesomeIcon icon={faPen} />
                                    تعديل بيانات المورد
                                  </button>
                                  <button onClick={deleteSupplier} className="flex items-center gap-1 text-xs text-danger hover:underline">
                                    <FontAwesomeIcon icon={faTrash} />
                                    حذف المورد
                                  </button>
                                </div>
                              )}
                            </div>

                            {editing && (
                              <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface p-3">
                                <input
                                  placeholder="اسم المورد"
                                  value={editForm.name}
                                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                  className="w-56 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
                                />
                                <input
                                  placeholder="الهاتف (اختياري)"
                                  value={editForm.phone}
                                  onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                                  className="w-48 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
                                />
                                <Button onClick={saveEdit} loading={busy} className="px-3 py-1.5 text-xs">
                                  حفظ
                                </Button>
                                <button onClick={() => setEditing(false)} className="rounded-xl px-3 py-1.5 text-xs text-muted hover:bg-surface">
                                  إلغاء
                                </button>
                              </div>
                            )}

                            {canManage && (
                              <div className="rounded-xl border border-border bg-surface p-3">
                                <div className="mb-3 flex gap-2 rounded-xl border border-border bg-background p-1">
                                  <button onClick={() => setActionTab(actionTab === 'pay' ? null : 'pay')} className={`flex-1 rounded-lg px-3 py-1.5 text-sm transition-colors ${actionTab === 'pay' ? 'bg-accent text-white' : 'text-ink/70 hover:bg-surface'}`}>
                                    دفع
                                  </button>
                                  <button onClick={() => setActionTab(actionTab === 'discount' ? null : 'discount')} className={`flex-1 rounded-lg px-3 py-1.5 text-sm transition-colors ${actionTab === 'discount' ? 'bg-accent text-white' : 'text-ink/70 hover:bg-surface'}`}>
                                    خصم
                                  </button>
                                  <button
                                    onClick={() => navigate(`/checks?new=1&direction=outgoing&supplier_id=${s.id}`)}
                                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-ink/70 hover:bg-surface"
                                  >
                                    <FontAwesomeIcon icon={faMoneyCheckDollar} />
                                    دفع بشيك
                                  </button>
                                </div>

                                {actionTab === 'pay' && (
                                  <div className="flex flex-wrap items-end gap-2">
                                    <SearchableSelect
                                      options={cashboxes.map((c) => ({ value: String(c.id), label: c.name, sublabel: c.currency }))}
                                      value={payForm.cashbox_id}
                                      onChange={(value) => setPayForm({ ...payForm, cashbox_id: value })}
                                      placeholder="الصندوق..."
                                      className="w-40"
                                    />
                                    <input type="number" placeholder="المبلغ" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} className="w-24 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none" />
                                    {payCashbox && payCashbox.currency !== 'ILS' && (
                                      <input
                                        type="number"
                                        step="0.01"
                                        placeholder={`سعر الصرف (1 ${payCashbox.currency} = ? ₪)`}
                                        value={payForm.exchange_rate}
                                        onChange={(e) => setPayForm({ ...payForm, exchange_rate: e.target.value })}
                                        className="w-36 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
                                      />
                                    )}
                                    <DatePicker value={payForm.occurred_at} onChange={(v) => setPayForm({ ...payForm, occurred_at: v })} />
                                    <input placeholder="ملاحظات (اختياري)" value={payForm.notes} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })} className="w-48 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none" />
                                    <Button onClick={pay} loading={busy} className="px-4 py-1.5">
                                      تأكيد الدفع
                                    </Button>
                                  </div>
                                )}

                                {actionTab === 'discount' && (
                                  <div className="flex flex-wrap items-end gap-2">
                                    <p className="w-full text-xs text-muted">خصم يوافق عليه المورد على المستحق — بينزل من الرصيد بدون ما يمر على أي صندوق.</p>
                                    <input type="number" placeholder="مبلغ الخصم" value={discountForm.amount} onChange={(e) => setDiscountForm({ ...discountForm, amount: e.target.value })} className="w-28 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none" />
                                    <DatePicker value={discountForm.occurred_at} onChange={(v) => setDiscountForm({ ...discountForm, occurred_at: v })} />
                                    <input placeholder="ملاحظات (اختياري)" value={discountForm.notes} onChange={(e) => setDiscountForm({ ...discountForm, notes: e.target.value })} className="w-48 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none" />
                                    <Button onClick={submitDiscount} loading={busy} className="px-4 py-1.5">
                                      تأكيد الخصم
                                    </Button>
                                  </div>
                                )}
                              </div>
                            )}

                            <div className="overflow-hidden rounded-xl border border-border bg-surface">
                              <Table>
                                <Thead>
                                  <Th>النوع</Th>
                                  <Th>المبلغ</Th>
                                  <Th>الرصيد</Th>
                                  <Th>ملاحظات</Th>
                                  <Th>التاريخ</Th>
                                  {canManage && <Th></Th>}
                                </Thead>
                                <tbody>
                                  {(ledger?.transactions ?? []).length === 0 ? (
                                    <EmptyRow colSpan={canManage ? 6 : 5}>لا توجد حركات.</EmptyRow>
                                  ) : (
                                    ledger!.transactions.map((t) =>
                                      editingTxId === t.id ? (
                                        <Tr key={t.id}>
                                          <Td colSpan={canManage ? 6 : 5}>
                                            <div className="flex flex-wrap items-end gap-2 py-1">
                                              <span className="text-xs font-medium text-ink/70">{TYPE_LABELS[t.type]}</span>
                                              <input type="number" value={editTxForm.amount} onChange={(e) => setEditTxForm({ ...editTxForm, amount: e.target.value })} className="w-24 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none" />
                                              <DatePicker value={editTxForm.occurred_at} onChange={(v) => setEditTxForm({ ...editTxForm, occurred_at: v })} />
                                              <input placeholder="ملاحظات" value={editTxForm.notes} onChange={(e) => setEditTxForm({ ...editTxForm, notes: e.target.value })} className="w-48 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none" />
                                              <button onClick={saveEditTx} disabled={busy} className="rounded-lg bg-success-soft px-2 py-1.5 text-xs text-success hover:opacity-80">
                                                <FontAwesomeIcon icon={faCheck} />
                                              </button>
                                              <button onClick={() => setEditingTxId(null)} className="rounded-lg bg-background px-2 py-1.5 text-xs text-ink/60 hover:bg-border/40">
                                                <FontAwesomeIcon icon={faXmark} />
                                              </button>
                                            </div>
                                          </Td>
                                        </Tr>
                                      ) : (
                                        <Tr key={t.id}>
                                          <Td>{TYPE_LABELS[t.type] ?? t.type}</Td>
                                          <Td className="text-muted">{t.amount_ils} ₪</Td>
                                          <Td className="text-muted">{t.balance_after_ils} ₪</Td>
                                          <Td className="text-muted">{t.notes ?? '—'}</Td>
                                          <Td className="text-muted">{t.occurred_at}</Td>
                                          {canManage && (
                                            <Td>
                                              {t.editable && (
                                                <div className="flex gap-2">
                                                  <button onClick={() => startEditTx(t)} className="text-ink/40 hover:text-accent">
                                                    <FontAwesomeIcon icon={faPen} />
                                                  </button>
                                                  <button onClick={() => deleteTx(t)} className="text-ink/40 hover:text-danger">
                                                    <FontAwesomeIcon icon={faTrash} />
                                                  </button>
                                                </div>
                                              )}
                                            </Td>
                                          )}
                                        </Tr>
                                      ),
                                    )
                                  )}
                                </tbody>
                              </Table>
                            </div>
                          </div>
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
    </div>
  )
}
