import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faWallet, faPen, faTrash, faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { Card, PageHeader, Button, Modal, Table, Thead, Th, Td, Tr, EmptyRow, TableSkeleton, CardSkeleton, SearchableSelect } from '../components/ui'
import type { Cashbox, CashEntry, ExpenseCategory, IncomeCategory } from '../types'

type Tab = 'expenses' | 'incomes'

export default function CashPage() {
  const { can } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTab] = useState<Tab>('expenses')
  const [cashboxes, setCashboxes] = useState<Cashbox[] | null>(null)
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([])
  const [incomeCategories, setIncomeCategories] = useState<IncomeCategory[]>([])
  const [expenses, setExpenses] = useState<CashEntry[] | null>(null)
  const [incomes, setIncomes] = useState<CashEntry[] | null>(null)
  const [showForm, setShowForm] = useState(() => searchParams.get('new') === '1')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({ category_id: '', cashbox_id: '', amount: '', description: '' })
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setShowForm(true)
      searchParams.delete('new')
      setSearchParams(searchParams, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function loadAll() {
    api.get('/cashboxes').then((res) => setCashboxes(res.data))
    api.get('/expense-categories').then((res) => setExpenseCategories(res.data))
    api.get('/income-categories').then((res) => setIncomeCategories(res.data))
    api.get('/expenses').then((res) => setExpenses(res.data))
    api.get('/incomes').then((res) => setIncomes(res.data))
  }

  useEffect(loadAll, [])

  const canManage = can('cash.manage')
  const categories = tab === 'expenses' ? expenseCategories : incomeCategories
  const entries = tab === 'expenses' ? expenses : incomes

  const filteredEntries = useMemo(() => {
    if (!entries) return null
    const term = search.trim().toLowerCase()
    if (!term) return entries
    return entries.filter(
      (e) =>
        e.category.toLowerCase().includes(term) ||
        e.cashbox.toLowerCase().includes(term) ||
        (e.description ?? '').toLowerCase().includes(term),
    )
  }, [entries, search])

  const total = useMemo(
    () => (filteredEntries ?? []).reduce((sum, e) => sum + Number(e.amount_ils), 0),
    [filteredEntries],
  )

  async function createCategory(name: string) {
    const endpoint = tab === 'expenses' ? '/expense-categories' : '/income-categories'
    const res = await api.post(endpoint, { name })
    if (tab === 'expenses') setExpenseCategories((prev) => [...prev, res.data])
    else setIncomeCategories((prev) => [...prev, res.data])
    setForm((f) => ({ ...f, category_id: String(res.data.id) }))
  }

  function openNew() {
    setEditingId(null)
    setForm({ category_id: '', cashbox_id: '', amount: '', description: '' })
    setShowForm(true)
  }

  function openEdit(e: CashEntry) {
    setEditingId(e.id)
    setForm({
      category_id: String(tab === 'expenses' ? e.expense_category_id : e.income_category_id),
      cashbox_id: String(e.cashbox_id),
      amount: e.amount,
      description: e.description ?? '',
    })
    setShowForm(true)
  }

  async function deleteEntry(id: number) {
    if (!window.confirm('حذف هذه الحركة نهائياً؟ رصيد الصندوق بيترجع يتصحح تلقائياً.')) return
    const endpoint = tab === 'expenses' ? `/expenses/${id}` : `/incomes/${id}`
    await api.delete(endpoint)
    loadAll()
  }

  async function submit() {
    if (!form.category_id || !form.cashbox_id || !form.amount) return
    setBusy(true)
    try {
      const categoryKey = tab === 'expenses' ? 'expense_category_id' : 'income_category_id'
      const payload = {
        [categoryKey]: Number(form.category_id),
        cashbox_id: Number(form.cashbox_id),
        amount: Number(form.amount),
        description: form.description || null,
      }
      if (editingId) {
        const endpoint = tab === 'expenses' ? `/expenses/${editingId}` : `/incomes/${editingId}`
        await api.put(endpoint, payload)
      } else {
        const endpoint = tab === 'expenses' ? '/expenses' : '/incomes'
        await api.post(endpoint, payload)
      }
      setShowForm(false)
      setEditingId(null)
      setForm({ category_id: '', cashbox_id: '', amount: '', description: '' })
      loadAll()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader title="الصناديق والمصاريف" subtitle="متابعة أرصدة الصناديق والحركات المالية" />

      <div className="mb-6 grid grid-cols-3 gap-4">
        {!cashboxes ? (
          <>
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </>
        ) : (
          cashboxes.map((c) => (
            <Card key={c.id} className="p-4">
              <div className="mb-1 flex items-center gap-2 text-muted">
                <FontAwesomeIcon icon={faWallet} className="text-accent" />
                <span className="text-sm">{c.name} ({c.currency})</span>
              </div>
              <p className={`text-xl font-semibold ${Number(c.balance) < 0 ? 'text-danger' : 'text-ink'}`}>
                {Number(c.balance).toFixed(2)}
              </p>
              <p className="text-xs text-muted">{c.branch?.name}</p>
            </Card>
          ))
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2 rounded-xl border border-border bg-surface p-1">
          <button
            onClick={() => { setTab('expenses'); setShowForm(false); setSearch('') }}
            className={`rounded-lg px-4 py-1.5 text-sm transition-colors ${tab === 'expenses' ? 'bg-accent text-white' : 'text-ink/70 hover:bg-background'}`}
          >
            المصاريف
          </button>
          <button
            onClick={() => { setTab('incomes'); setShowForm(false); setSearch('') }}
            className={`rounded-lg px-4 py-1.5 text-sm transition-colors ${tab === 'incomes' ? 'bg-accent text-white' : 'text-ink/70 hover:bg-background'}`}
          >
            الوارد
          </button>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <FontAwesomeIcon icon={faMagnifyingGlass} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالتصنيف أو الوصف أو الصندوق..."
              className="w-64 rounded-xl border border-border bg-surface py-2 pe-3 ps-9 text-sm focus:border-accent focus:outline-none"
            />
          </div>
          {canManage && (
            <Button onClick={openNew}>
              <FontAwesomeIcon icon={faPlus} />
              {tab === 'expenses' ? 'مصروف جديد' : 'وارد جديد'}
            </Button>
          )}
        </div>
      </div>

      {showForm && (
        <Modal title={editingId ? (tab === 'expenses' ? 'تعديل مصروف' : 'تعديل وارد') : (tab === 'expenses' ? 'مصروف جديد' : 'وارد جديد')} onClose={() => setShowForm(false)}>
          <div className="space-y-3">
            <SearchableSelect
              options={categories.map((c) => ({ value: String(c.id), label: c.name }))}
              value={form.category_id}
              onChange={(value) => setForm({ ...form, category_id: value })}
              placeholder="التصنيف..."
              onCreateNew={(query) => createCategory(query)}
              createNewLabel="تصنيف جديد"
            />
            <select value={form.cashbox_id} onChange={(e) => setForm({ ...form, cashbox_id: e.target.value })} className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none">
              <option value="">الصندوق...</option>
              {(cashboxes ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <input type="number" placeholder="المبلغ" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none" />
            <input placeholder="وصف (اختياري)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none" />
            <Button onClick={submit} loading={busy} className="w-full justify-center">
              {editingId ? 'حفظ التعديل' : 'حفظ'}
            </Button>
          </div>
        </Modal>
      )}

      <Card>
        {!filteredEntries ? (
          <TableSkeleton />
        ) : (
          <Table>
            <Thead>
              <Th>التصنيف</Th>
              <Th>الصندوق</Th>
              <Th>المبلغ</Th>
              <Th>الوصف</Th>
              <Th>التاريخ</Th>
              {canManage && <Th></Th>}
            </Thead>
            <tbody>
              {filteredEntries.length === 0 ? (
                <EmptyRow colSpan={canManage ? 6 : 5}>{search ? 'لا توجد نتائج مطابقة' : 'لا توجد حركات.'}</EmptyRow>
              ) : (
                filteredEntries.map((e) => (
                  <Tr key={e.id}>
                    <Td>{e.category}</Td>
                    <Td className="text-muted">{e.cashbox}</Td>
                    <Td className="text-muted">{e.amount} {e.currency}</Td>
                    <Td className="text-muted">{e.description ?? '—'}</Td>
                    <Td className="text-muted">{e.spent_at ?? e.received_at}</Td>
                    {canManage && (
                      <Td>
                        <div className="flex items-center gap-3">
                          <button onClick={() => openEdit(e)} className="text-ink/40 hover:text-accent">
                            <FontAwesomeIcon icon={faPen} />
                          </button>
                          <button onClick={() => deleteEntry(e.id)} className="text-ink/40 hover:text-danger">
                            <FontAwesomeIcon icon={faTrash} />
                          </button>
                        </div>
                      </Td>
                    )}
                  </Tr>
                ))
              )}
            </tbody>
          </Table>
        )}
        {filteredEntries && filteredEntries.length > 0 && (
          <div className="flex justify-between border-t border-border/70 px-4 py-3 text-sm font-semibold text-ink">
            <span>المجموع</span>
            <span>{total.toFixed(2)} ₪</span>
          </div>
        )}
      </Card>
    </div>
  )
}
