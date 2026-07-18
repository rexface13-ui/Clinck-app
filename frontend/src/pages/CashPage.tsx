import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faWallet } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { Card, PageHeader, Button, Modal, Table, Thead, Th, Td, Tr, EmptyRow, TableSkeleton, CardSkeleton } from '../components/ui'
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
  const [form, setForm] = useState({ category_id: '', cashbox_id: '', amount: '', description: '' })
  const [busy, setBusy] = useState(false)

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

  async function submit() {
    if (!form.category_id || !form.cashbox_id || !form.amount) return
    setBusy(true)
    try {
      const endpoint = tab === 'expenses' ? '/expenses' : '/incomes'
      const categoryKey = tab === 'expenses' ? 'expense_category_id' : 'income_category_id'
      await api.post(endpoint, {
        [categoryKey]: Number(form.category_id),
        cashbox_id: Number(form.cashbox_id),
        amount: Number(form.amount),
        description: form.description || null,
      })
      setShowForm(false)
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

      <div className="mb-4 flex items-center justify-between">
        <div className="flex gap-2 rounded-xl border border-border bg-surface p-1">
          <button
            onClick={() => { setTab('expenses'); setShowForm(false) }}
            className={`rounded-lg px-4 py-1.5 text-sm transition-colors ${tab === 'expenses' ? 'bg-accent text-white' : 'text-ink/70 hover:bg-background'}`}
          >
            المصاريف
          </button>
          <button
            onClick={() => { setTab('incomes'); setShowForm(false) }}
            className={`rounded-lg px-4 py-1.5 text-sm transition-colors ${tab === 'incomes' ? 'bg-accent text-white' : 'text-ink/70 hover:bg-background'}`}
          >
            الوارد
          </button>
        </div>
        {canManage && (
          <Button onClick={() => setShowForm((v) => !v)}>
            <FontAwesomeIcon icon={faPlus} />
            {tab === 'expenses' ? 'مصروف جديد' : 'وارد جديد'}
          </Button>
        )}
      </div>

      {showForm && (
        <Modal title={tab === 'expenses' ? 'مصروف جديد' : 'وارد جديد'} onClose={() => setShowForm(false)}>
          <div className="space-y-3">
            <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none">
              <option value="">التصنيف...</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select value={form.cashbox_id} onChange={(e) => setForm({ ...form, cashbox_id: e.target.value })} className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none">
              <option value="">الصندوق...</option>
              {(cashboxes ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <input type="number" placeholder="المبلغ" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none" />
            <input placeholder="وصف (اختياري)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none" />
            <Button onClick={submit} loading={busy} className="w-full justify-center">
              حفظ
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
              <Th>التصنيف</Th>
              <Th>الصندوق</Th>
              <Th>المبلغ</Th>
              <Th>الوصف</Th>
              <Th>التاريخ</Th>
            </Thead>
            <tbody>
              {entries.length === 0 ? (
                <EmptyRow colSpan={5}>لا توجد حركات.</EmptyRow>
              ) : (
                entries.map((e) => (
                  <Tr key={e.id}>
                    <Td>{e.category}</Td>
                    <Td className="text-muted">{e.cashbox}</Td>
                    <Td className="text-muted">{e.amount} {e.currency}</Td>
                    <Td className="text-muted">{e.description ?? '—'}</Td>
                    <Td className="text-muted">{e.spent_at ?? e.received_at}</Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}
