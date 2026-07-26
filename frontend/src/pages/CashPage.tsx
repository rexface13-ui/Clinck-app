import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faWallet, faPen, faTrash, faMagnifyingGlass, faXmark } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import DatePicker from '../components/DatePicker'
import { Card, PageHeader, Button, Modal, Table, Thead, Th, Td, Tr, EmptyRow, TableSkeleton, CardSkeleton, SearchableSelect, Badge } from '../components/ui'
import type { Branch, Cashbox, CashEntry, ExpenseCategory, IncomeCategory } from '../types'

type Tab = 'expenses' | 'incomes'
type IncomeKind = 'all' | 'income' | 'payment'

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
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [filterCashboxId, setFilterCashboxId] = useState('')
  const [filterCategoryId, setFilterCategoryId] = useState('')
  const [filterIncomeKind, setFilterIncomeKind] = useState<IncomeKind>('all')
  const [branches, setBranches] = useState<Branch[]>([])
  const [showCashboxForm, setShowCashboxForm] = useState(false)
  const [cashboxForm, setCashboxForm] = useState({ name: '', currency: 'ILS', branch_id: '' })
  const [creatingCashbox, setCreatingCashbox] = useState(false)

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setShowForm(true)
      searchParams.delete('new')
      setSearchParams(searchParams, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function loadStatic() {
    api.get('/cashboxes').then((res) => setCashboxes(res.data))
    api.get('/expense-categories').then((res) => setExpenseCategories(res.data))
    api.get('/income-categories').then((res) => setIncomeCategories(res.data))
    api.get('/branches').then((res) => setBranches(res.data))
  }

  async function createCashbox() {
    if (!cashboxForm.name || !cashboxForm.currency || !cashboxForm.branch_id) return
    setCreatingCashbox(true)
    try {
      await api.post('/cashboxes', {
        name: cashboxForm.name,
        currency: cashboxForm.currency,
        branch_id: Number(cashboxForm.branch_id),
      })
      setShowCashboxForm(false)
      setCashboxForm({ name: '', currency: 'ILS', branch_id: '' })
      api.get('/cashboxes').then((res) => setCashboxes(res.data))
    } finally {
      setCreatingCashbox(false)
    }
  }

  function loadEntries() {
    const shared = {
      from: dateFrom || undefined,
      to: dateTo || undefined,
      cashbox_id: filterCashboxId || undefined,
      search: search || undefined,
    }
    if (tab === 'expenses') {
      api.get('/expenses', { params: { ...shared, expense_category_id: filterCategoryId || undefined } }).then((res) => setExpenses(res.data))
    } else {
      api.get('/incomes', { params: { ...shared, kind: filterIncomeKind === 'all' ? undefined : filterIncomeKind } }).then((res) => setIncomes(res.data))
    }
  }

  function loadAll() {
    loadStatic()
    loadEntries()
  }

  useEffect(loadStatic, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadEntries, [tab, dateFrom, dateTo, filterCashboxId, filterCategoryId, filterIncomeKind, search])

  const canManage = can('cash.manage')
  const categories = tab === 'expenses' ? expenseCategories : incomeCategories
  const entries = tab === 'expenses' ? expenses : incomes

  function clearFilters() {
    setSearch('')
    setDateFrom('')
    setDateTo('')
    setFilterCashboxId('')
    setFilterCategoryId('')
    setFilterIncomeKind('all')
  }

  const hasActiveFilters = !!(search || dateFrom || dateTo || filterCashboxId || filterCategoryId || filterIncomeKind !== 'all')

  const total = useMemo(
    () => (entries ?? []).reduce((sum, e) => sum + Number(e.amount_ils), 0),
    [entries],
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
    const ilsCashbox = (cashboxes ?? []).find((c) => c.currency === 'ILS')
    setForm({ category_id: '', cashbox_id: ilsCashbox ? String(ilsCashbox.id) : '', amount: '', description: '' })
    setShowForm(true)
  }

  function openEdit(e: CashEntry) {
    const targetId = tab === 'expenses' ? e.id : (e.source_id ?? e.id)
    setEditingId(targetId)
    setForm({
      category_id: String(tab === 'expenses' ? e.expense_category_id : e.income_category_id),
      cashbox_id: String(e.cashbox_id),
      amount: e.amount,
      description: e.description ?? '',
    })
    setShowForm(true)
  }

  async function deleteEntry(e: CashEntry) {
    if (!window.confirm('حذف هذه الحركة نهائياً؟ رصيد الصندوق بيترجع يتصحح تلقائياً.')) return
    const targetId = tab === 'expenses' ? e.id : (e.source_id ?? e.id)
    const endpoint = tab === 'expenses' ? `/expenses/${targetId}` : `/incomes/${targetId}`
    await api.delete(endpoint)
    loadEntries()
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

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink/70">الصناديق</h2>
        {can('cash.manage') && (
          <button onClick={() => setShowCashboxForm(true)} className="flex items-center gap-1.5 text-xs text-accent hover:underline">
            <FontAwesomeIcon icon={faPlus} />
            صندوق جديد (لعملة تانية مثلاً)
          </button>
        )}
      </div>
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

      {showCashboxForm && (
        <Modal title="صندوق جديد" onClose={() => setShowCashboxForm(false)}>
          <div className="space-y-3">
            <input
              placeholder="اسم الصندوق (مثلاً: صندوق دولار)"
              value={cashboxForm.name}
              onChange={(e) => setCashboxForm({ ...cashboxForm, name: e.target.value })}
              className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
            />
            <select
              value={cashboxForm.currency}
              onChange={(e) => setCashboxForm({ ...cashboxForm, currency: e.target.value })}
              className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
            >
              <option value="ILS">ILS — شيكل</option>
              <option value="USD">USD — دولار</option>
              <option value="JOD">JOD — دينار</option>
            </select>
            <select
              value={cashboxForm.branch_id}
              onChange={(e) => setCashboxForm({ ...cashboxForm, branch_id: e.target.value })}
              className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
            >
              <option value="">الفرع...</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <Button onClick={createCashbox} loading={creatingCashbox} className="w-full justify-center">
              حفظ
            </Button>
          </div>
        </Modal>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2 rounded-xl border border-border bg-surface p-1">
          <button
            onClick={() => { setTab('expenses'); setShowForm(false); clearFilters() }}
            className={`rounded-lg px-4 py-1.5 text-sm transition-colors ${tab === 'expenses' ? 'bg-accent text-white' : 'text-ink/70 hover:bg-background'}`}
          >
            المصاريف
          </button>
          <button
            onClick={() => { setTab('incomes'); setShowForm(false); clearFilters() }}
            className={`rounded-lg px-4 py-1.5 text-sm transition-colors ${tab === 'incomes' ? 'bg-accent text-white' : 'text-ink/70 hover:bg-background'}`}
          >
            الوارد
          </button>
        </div>
        {canManage && (
          <Button onClick={openNew}>
            <FontAwesomeIcon icon={faPlus} />
            {tab === 'expenses' ? 'مصروف جديد' : 'وارد جديد'}
          </Button>
        )}
      </div>

      <Card className="mb-4 flex flex-wrap items-end gap-3 p-3">
        <div className="relative">
          <FontAwesomeIcon icon={faMagnifyingGlass} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث بالتصنيف أو الوصف أو الصندوق..."
            className="w-56 rounded-xl border border-border bg-surface py-2 pe-3 ps-9 text-sm focus:border-accent focus:outline-none"
          />
        </div>
        <div className="w-36">
          <label className="mb-1 block text-xs text-muted">من تاريخ</label>
          <DatePicker value={dateFrom} onChange={setDateFrom} placeholder="من تاريخ" />
        </div>
        <div className="w-36">
          <label className="mb-1 block text-xs text-muted">إلى تاريخ</label>
          <DatePicker value={dateTo} onChange={setDateTo} placeholder="إلى تاريخ" />
        </div>
        <div className="w-40">
          <label className="mb-1 block text-xs text-muted">الصندوق</label>
          <select value={filterCashboxId} onChange={(e) => setFilterCashboxId(e.target.value)} className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none">
            <option value="">الكل</option>
            {(cashboxes ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        {tab === 'expenses' ? (
          <div className="w-44">
            <label className="mb-1 block text-xs text-muted">التصنيف</label>
            <select value={filterCategoryId} onChange={(e) => setFilterCategoryId(e.target.value)} className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none">
              <option value="">الكل</option>
              {expenseCategories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        ) : (
          <div className="w-44">
            <label className="mb-1 block text-xs text-muted">النوع</label>
            <select value={filterIncomeKind} onChange={(e) => setFilterIncomeKind(e.target.value as IncomeKind)} className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none">
              <option value="all">الكل</option>
              <option value="income">وارد يدوي</option>
              <option value="payment">تحصيل من مرضى</option>
            </select>
          </div>
        )}
        {hasActiveFilters && (
          <button onClick={clearFilters} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-danger/70 hover:text-danger">
            <FontAwesomeIcon icon={faXmark} />
            مسح الفلاتر
          </button>
        )}
      </Card>

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
        {!entries ? (
          <TableSkeleton />
        ) : (
          <Table>
            <Thead>
              {tab === 'incomes' && <Th>النوع</Th>}
              <Th>التصنيف</Th>
              <Th>الصندوق</Th>
              <Th>المبلغ</Th>
              <Th>الوصف</Th>
              <Th>التاريخ</Th>
              {canManage && <Th></Th>}
            </Thead>
            <tbody>
              {entries.length === 0 ? (
                <EmptyRow colSpan={canManage ? (tab === 'incomes' ? 7 : 6) : (tab === 'incomes' ? 6 : 5)}>
                  {hasActiveFilters ? 'لا توجد نتائج مطابقة' : 'لا توجد حركات.'}
                </EmptyRow>
              ) : (
                entries.map((e) => {
                  const editable = e.editable !== false
                  return (
                    <Tr key={e.id}>
                      {tab === 'incomes' && (
                        <Td>
                          <Badge variant={e.kind === 'payment' ? 'success' : 'info'}>{e.kind === 'payment' ? 'تحصيل مريض' : 'يدوي'}</Badge>
                        </Td>
                      )}
                      <Td>{e.category}</Td>
                      <Td className="text-muted">{e.cashbox}</Td>
                      <Td className="text-muted">{e.amount} {e.currency}</Td>
                      <Td className="text-muted">{e.description ?? '—'}</Td>
                      <Td className="text-muted">{e.spent_at ?? e.received_at}</Td>
                      {canManage && (
                        <Td>
                          {editable ? (
                            <div className="flex items-center gap-3">
                              <button onClick={() => openEdit(e)} className="text-ink/40 hover:text-accent">
                                <FontAwesomeIcon icon={faPen} />
                              </button>
                              <button onClick={() => deleteEntry(e)} className="text-ink/40 hover:text-danger">
                                <FontAwesomeIcon icon={faTrash} />
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted">من ملف المريض</span>
                          )}
                        </Td>
                      )}
                    </Tr>
                  )
                })
              )}
            </tbody>
          </Table>
        )}
        {entries && entries.length > 0 && (
          <div className="flex justify-between border-t border-border/70 px-4 py-3 text-sm font-semibold text-ink">
            <span>المجموع</span>
            <span>{total.toFixed(2)} ₪</span>
          </div>
        )}
      </Card>
    </div>
  )
}
