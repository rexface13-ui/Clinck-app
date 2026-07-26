import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faTruck, faPen, faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { Card, PageHeader, Button, Table, Thead, Th, Td, Tr, EmptyRow, SearchableSelect } from '../components/ui'
import type { Cashbox, Supplier, SupplierLedger } from '../types'

const TYPE_LABELS: Record<SupplierLedger['transactions'][number]['type'], string> = {
  purchase: 'مشتريات',
  payment: 'دفعة',
  check_endorsed: 'شيك مُظهّر',
  check_bounced: 'شيك راجع',
  adjustment: 'تسوية',
}

export default function SuppliersPage() {
  const { can } = useAuth()
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([])
  const [selected, setSelected] = useState<Supplier | null>(null)
  const [ledger, setLedger] = useState<SupplierLedger | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '' })
  const [payForm, setPayForm] = useState({ cashbox_id: '', amount: '', exchange_rate: '1' })
  const payCashbox = cashboxes.find((c) => c.id === Number(payForm.cashbox_id))
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', phone: '' })
  const [search, setSearch] = useState('')

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

  function loadLedger(supplier: Supplier) {
    setSelected(supplier)
    setEditing(false)
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
      })
      setPayForm({ cashbox_id: '', amount: '', exchange_rate: '1' })
      loadLedger(selected)
      loadSuppliers()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader title="الموردون" subtitle="كشوف حسابات وتسديد الموردين" />

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-1">
          {canManage && (
            <Button onClick={() => setShowForm((v) => !v)} className="mb-4">
              <FontAwesomeIcon icon={faPlus} />
              مورد جديد
            </Button>
          )}

          {showForm && (
            <Card className="mb-4 space-y-2 p-4">
              <input placeholder="اسم المورد" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none" />
              <input placeholder="الهاتف (اختياري)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none" />
              <Button onClick={submit} loading={busy} className="w-full justify-center">
                حفظ
              </Button>
            </Card>
          )}

          <div className="relative mb-3">
            <FontAwesomeIcon icon={faMagnifyingGlass} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالاسم أو الهاتف..."
              className="w-full rounded-xl border border-border bg-surface py-2.5 pe-3 ps-9 text-sm focus:border-accent focus:outline-none"
            />
          </div>

          {filteredSuppliers.length === 0 ? (
            <Card className="p-6 text-center text-sm text-muted">{search ? 'لا توجد نتائج مطابقة.' : 'لا يوجد موردون.'}</Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-1">
              {filteredSuppliers.map((s) => {
                const owed = Number(s.outstanding_ils)
                return (
                  <button
                    key={s.id}
                    onClick={() => loadLedger(s)}
                    className={`rounded-xl border p-4 text-right transition-colors hover:border-accent ${
                      selected?.id === s.id ? 'border-accent bg-accent-soft' : 'border-border bg-surface'
                    } ${!s.is_active ? 'opacity-60' : ''}`}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <FontAwesomeIcon icon={faTruck} className="text-ink/40" />
                      <p className="font-medium text-ink">{s.name}</p>
                    </div>
                    <p className="mb-2 text-xs text-muted">{s.phone ?? '—'}</p>
                    <div className="flex items-center justify-between border-t border-border/70 pt-2">
                      <span className="text-xs text-muted">المستحق</span>
                      <span className={`text-sm font-semibold ${owed > 0 ? 'text-danger' : 'text-ink'}`}>{owed.toFixed(2)} ₪</span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="col-span-2">
          {!selected ? (
            <Card className="p-6 text-center text-sm text-muted">اختر مورداً لعرض كشف الحساب.</Card>
          ) : (
            <div className="space-y-4">
              <Card className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted">{selected.name}</p>
                    <p className={`text-2xl font-semibold ${Number(ledger?.outstanding_ils ?? 0) > 0 ? 'text-danger' : 'text-ink'}`}>
                      {ledger?.outstanding_ils ?? 0} ₪
                    </p>
                  </div>
                  {canManage && !editing && (
                    <button onClick={startEdit} className="flex items-center gap-1 text-xs text-accent hover:underline">
                      <FontAwesomeIcon icon={faPen} />
                      تعديل
                    </button>
                  )}
                </div>
                {editing && (
                  <div className="mt-3 space-y-2 border-t border-border/70 pt-3">
                    <input
                      placeholder="اسم المورد"
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
                    />
                    <input
                      placeholder="الهاتف (اختياري)"
                      value={editForm.phone}
                      onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                      className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
                    />
                    <div className="flex gap-2">
                      <Button onClick={saveEdit} loading={busy} className="flex-1 justify-center px-3 py-1.5 text-xs">
                        حفظ
                      </Button>
                      <button onClick={() => setEditing(false)} className="rounded-xl px-3 py-1.5 text-xs text-muted hover:bg-background">
                        إلغاء
                      </button>
                    </div>
                  </div>
                )}
              </Card>

              {canManage && (
                <Card className="flex flex-wrap items-end gap-2 p-4">
                  <SearchableSelect
                    options={cashboxes.map((c) => ({ value: String(c.id), label: c.name, sublabel: c.currency }))}
                    value={payForm.cashbox_id}
                    onChange={(value) => setPayForm({ ...payForm, cashbox_id: value })}
                    placeholder="الصندوق..."
                    className="w-48"
                  />
                  <input type="number" placeholder="المبلغ" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} className="w-28 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none" />
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
                  <Button onClick={pay} loading={busy} className="px-4 py-1.5">
                    دفع للمورد
                  </Button>
                </Card>
              )}

              <Card>
                <Table>
                  <Thead>
                    <Th>النوع</Th>
                    <Th>المبلغ</Th>
                    <Th>الرصيد</Th>
                    <Th>التاريخ</Th>
                  </Thead>
                  <tbody>
                    {(ledger?.transactions ?? []).length === 0 ? (
                      <EmptyRow colSpan={4}>لا توجد حركات.</EmptyRow>
                    ) : (
                      ledger!.transactions.map((t) => (
                        <Tr key={t.id}>
                          <Td>{TYPE_LABELS[t.type] ?? t.type}</Td>
                          <Td className="text-muted">{t.amount_ils} ₪</Td>
                          <Td className="text-muted">{t.balance_after_ils} ₪</Td>
                          <Td className="text-muted">{t.occurred_at}</Td>
                        </Tr>
                      ))
                    )}
                  </tbody>
                </Table>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
