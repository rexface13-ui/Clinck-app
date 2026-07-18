import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faBoxesStacked } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import type { Item, ItemCategory } from '../types'

const TYPE_LABELS: Record<Item['type'], string> = {
  direct_expense: 'مصروف مباشر',
  simple_stock: 'مخزون بسيط',
  tracked: 'دفعات وصلاحية',
}

export default function ItemsPage() {
  const { can } = useAuth()
  const canManage = can('inventory.manage')
  const [categories, setCategories] = useState<ItemCategory[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [showItemForm, setShowItemForm] = useState(false)
  const [showCategoryForm, setShowCategoryForm] = useState(false)
  const [categoryName, setCategoryName] = useState('')
  const [form, setForm] = useState({ item_category_id: '', name: '', type: 'simple_stock' as Item['type'], unit: 'piece' })
  const [busy, setBusy] = useState(false)

  function loadAll() {
    api.get('/item-categories').then((res) => setCategories(res.data))
    api.get('/items').then((res) => setItems(res.data))
  }

  useEffect(loadAll, [])

  async function submitCategory() {
    if (!categoryName) return
    setBusy(true)
    try {
      await api.post('/item-categories', { name: categoryName })
      setCategoryName('')
      setShowCategoryForm(false)
      loadAll()
    } finally {
      setBusy(false)
    }
  }

  async function submitItem() {
    if (!form.name || !form.type) return
    setBusy(true)
    try {
      await api.post('/items', {
        item_category_id: form.item_category_id ? Number(form.item_category_id) : null,
        name: form.name,
        type: form.type,
        unit: form.unit || 'piece',
      })
      setForm({ item_category_id: '', name: '', type: 'simple_stock', unit: 'piece' })
      setShowItemForm(false)
      loadAll()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold text-ink">الأصناف والمخزون</h1>

      {canManage && (
        <div className="mb-6 flex gap-2">
          <button onClick={() => setShowItemForm((v) => !v)} className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover">
            <FontAwesomeIcon icon={faPlus} />
            صنف جديد
          </button>
          <button onClick={() => setShowCategoryForm((v) => !v)} className="flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm text-ink/70 shadow-sm hover:bg-background">
            <FontAwesomeIcon icon={faPlus} />
            تصنيف جديد
          </button>
        </div>
      )}

      {showCategoryForm && (
        <div className="mb-6 flex items-end gap-2 rounded-xl bg-white p-4 shadow-sm">
          <input placeholder="اسم التصنيف" value={categoryName} onChange={(e) => setCategoryName(e.target.value)} className="rounded-lg border border-ink/10 px-2 py-1.5 text-sm" />
          <button onClick={submitCategory} disabled={busy} className="rounded-lg bg-accent px-4 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-60">
            حفظ
          </button>
        </div>
      )}

      {showItemForm && (
        <div className="mb-6 flex flex-wrap items-end gap-2 rounded-xl bg-white p-4 shadow-sm">
          <select value={form.item_category_id} onChange={(e) => setForm({ ...form, item_category_id: e.target.value })} className="rounded-lg border border-ink/10 px-2 py-1.5 text-sm">
            <option value="">بدون تصنيف</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <input placeholder="اسم الصنف" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-lg border border-ink/10 px-2 py-1.5 text-sm" />
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as Item['type'] })} className="rounded-lg border border-ink/10 px-2 py-1.5 text-sm">
            <option value="direct_expense">مصروف مباشر</option>
            <option value="simple_stock">مخزون بسيط</option>
            <option value="tracked">دفعات وصلاحية</option>
          </select>
          <input placeholder="الوحدة" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className="w-24 rounded-lg border border-ink/10 px-2 py-1.5 text-sm" />
          <button onClick={submitItem} disabled={busy} className="rounded-lg bg-accent px-4 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-60">
            حفظ
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-right text-ink/60">
              <th className="p-4 font-medium">الصنف</th>
              <th className="p-4 font-medium">التصنيف</th>
              <th className="p-4 font-medium">النوع</th>
              <th className="p-4 font-medium">الوحدة</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={4} className="p-6 text-center text-sm text-ink/40">لا توجد أصناف.</td></tr>
            ) : (
              items.map((i) => (
                <tr key={i.id} className="border-b border-ink/5 last:border-0">
                  <td className="flex items-center gap-2 p-4">
                    <FontAwesomeIcon icon={faBoxesStacked} className="text-ink/30" />
                    {i.name}
                  </td>
                  <td className="p-4 text-ink/70">{i.category?.name ?? '—'}</td>
                  <td className="p-4 text-ink/70">{TYPE_LABELS[i.type]}</td>
                  <td className="p-4 text-ink/70">{i.unit}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
