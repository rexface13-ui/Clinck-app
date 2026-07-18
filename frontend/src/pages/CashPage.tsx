import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faWallet } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import type { Cashbox, CashEntry, ExpenseCategory, IncomeCategory } from '../types'

type Tab = 'expenses' | 'incomes'

export default function CashPage() {
  const { can } = useAuth()
  const [tab, setTab] = useState<Tab>('expenses')
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([])
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([])
  const [incomeCategories, setIncomeCategories] = useState<IncomeCategory[]>([])
  const [expenses, setExpenses] = useState<CashEntry[]>([])
  const [incomes, setIncomes] = useState<CashEntry[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ category_id: '', cashbox_id: '', amount: '', description: '' })
  const [busy, setBusy] = useState(false)

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
      <h1 className="mb-6 text-xl font-semibold text-ink">الصناديق والمصاريف</h1>

      <div className="mb-6 grid grid-cols-3 gap-4">
        {cashboxes.map((c) => (
          <div key={c.id} className="rounded-xl bg-white p-4 shadow-sm">
            <div className="mb-1 flex items-center gap-2 text-ink/60">
              <FontAwesomeIcon icon={faWallet} />
              <span className="text-sm">{c.name} ({c.currency})</span>
            </div>
            <p className={`text-xl font-semibold ${Number(c.balance) < 0 ? 'text-danger' : 'text-ink'}`}>
              {Number(c.balance).toFixed(2)}
            </p>
            <p className="text-xs text-ink/40">{c.branch?.name}</p>
          </div>
        ))}
      </div>

      <div className="mb-4 flex items-center justify-between">
        <div className="flex gap-2">
          <button
            onClick={() => { setTab('expenses'); setShowForm(false) }}
            className={`rounded-xl px-4 py-2 text-sm ${tab === 'expenses' ? 'bg-accent text-white' : 'bg-white text-ink/70'}`}
          >
            المصاريف
          </button>
          <button
            onClick={() => { setTab('incomes'); setShowForm(false) }}
            className={`rounded-xl px-4 py-2 text-sm ${tab === 'incomes' ? 'bg-accent text-white' : 'bg-white text-ink/70'}`}
          >
            الوارد
          </button>
        </div>
        {canManage && (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
          >
            <FontAwesomeIcon icon={faPlus} />
            {tab === 'expenses' ? 'مصروف جديد' : 'وارد جديد'}
          </button>
        )}
      </div>

      {showForm && (
        <div className="mb-6 flex flex-wrap items-end gap-2 rounded-xl bg-white p-4 shadow-sm">
          <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} className="rounded-lg border border-ink/10 px-2 py-1.5 text-sm">
            <option value="">التصنيف...</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select value={form.cashbox_id} onChange={(e) => setForm({ ...form, cashbox_id: e.target.value })} className="rounded-lg border border-ink/10 px-2 py-1.5 text-sm">
            <option value="">الصندوق...</option>
            {cashboxes.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <input type="number" placeholder="المبلغ" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="w-28 rounded-lg border border-ink/10 px-2 py-1.5 text-sm" />
          <input placeholder="وصف (اختياري)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="flex-1 rounded-lg border border-ink/10 px-2 py-1.5 text-sm" />
          <button onClick={submit} disabled={busy} className="rounded-lg bg-accent px-4 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-60">
            حفظ
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-right text-ink/60">
              <th className="p-4 font-medium">التصنيف</th>
              <th className="p-4 font-medium">الصندوق</th>
              <th className="p-4 font-medium">المبلغ</th>
              <th className="p-4 font-medium">الوصف</th>
              <th className="p-4 font-medium">التاريخ</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-6 text-center text-sm text-ink/40">لا توجد حركات.</td>
              </tr>
            ) : (
              entries.map((e) => (
                <tr key={e.id} className="border-b border-ink/5 last:border-0">
                  <td className="p-4">{e.category}</td>
                  <td className="p-4 text-ink/70">{e.cashbox}</td>
                  <td className="p-4 text-ink/70">{e.amount} {e.currency}</td>
                  <td className="p-4 text-ink/70">{e.description ?? '—'}</td>
                  <td className="p-4 text-ink/70">{e.spent_at ?? e.received_at}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
