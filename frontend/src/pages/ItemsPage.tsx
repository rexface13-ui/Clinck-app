import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faBoxesStacked, faPen, faMagnifyingGlass, faTrash, faClockRotateLeft } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { Card, PageHeader, Button, Modal, Table, Thead, Th, Td, Tr, EmptyRow, TableSkeleton } from '../components/ui'
import { normalizeArabic } from '../lib/arabic'
import type { Item, ItemCategory, ItemPriceHistoryRow } from '../types'

const TYPE_LABELS: Record<Item['type'], string> = {
  direct_expense: 'مصروف مباشر',
  simple_stock: 'مخزون بسيط',
  tracked: 'دفعات وصلاحية',
}

export default function ItemsPage() {
  const { can } = useAuth()
  const canManage = can('inventory.manage')
  const [searchParams, setSearchParams] = useSearchParams()
  const [categories, setCategories] = useState<ItemCategory[]>([])
  const [items, setItems] = useState<Item[] | null>(null)
  const [showItemForm, setShowItemForm] = useState(() => searchParams.get('new') === '1')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [showCategoryForm, setShowCategoryForm] = useState(false)
  const [categoryName, setCategoryName] = useState('')
  const [form, setForm] = useState({ item_category_id: '', name: '', type: 'simple_stock' as Item['type'], unit: 'piece', default_price: '', default_currency: 'ILS' })
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [historyItem, setHistoryItem] = useState<Item | null>(null)
  const [history, setHistory] = useState<ItemPriceHistoryRow[] | null>(null)

  function loadAll() {
    api.get('/item-categories').then((res) => setCategories(res.data))
    api.get('/items').then((res) => setItems(res.data))
  }

  useEffect(loadAll, [])

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setShowItemForm(true)
      searchParams.delete('new')
      setSearchParams(searchParams, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    const payload = {
      item_category_id: form.item_category_id ? Number(form.item_category_id) : null,
      name: form.name,
      type: form.type,
      unit: form.unit || 'piece',
      default_price: form.default_price ? Number(form.default_price) : null,
      default_currency: form.default_price ? form.default_currency : null,
    }
    try {
      if (editingId) {
        await api.put(`/items/${editingId}`, payload)
      } else {
        await api.post('/items', payload)
      }
      closeItemForm()
      loadAll()
    } finally {
      setBusy(false)
    }
  }

  function closeItemForm() {
    setForm({ item_category_id: '', name: '', type: 'simple_stock', unit: 'piece', default_price: '', default_currency: 'ILS' })
    setShowItemForm(false)
    setEditingId(null)
  }

  function openHistory(item: Item) {
    setHistoryItem(item)
    setHistory(null)
    api.get<ItemPriceHistoryRow[]>(`/items/${item.id}/price-history`).then((res) => setHistory(res.data))
  }

  async function deleteItem(itemId: number) {
    if (!window.confirm('حذف هذا الصنف نهائياً؟')) return
    try {
      await api.delete(`/items/${itemId}`)
      loadAll()
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      window.alert(message ?? 'تعذّر حذف الصنف.')
    }
  }

  function startEdit(i: Item) {
    setEditingId(i.id)
    setForm({
      item_category_id: i.item_category_id ? String(i.item_category_id) : '',
      name: i.name,
      type: i.type,
      unit: i.unit,
      default_price: i.default_price ?? '',
      default_currency: i.default_currency ?? 'ILS',
    })
    setShowItemForm(true)
  }

  return (
    <div>
      <PageHeader
        title="الأصناف والمخزون"
        subtitle="إدارة أصناف العيادة وتصنيفاتها"
        action={
          canManage && (
            <div className="flex gap-2">
              <Button onClick={() => (showItemForm ? closeItemForm() : setShowItemForm(true))}>
                <FontAwesomeIcon icon={faPlus} />
                صنف جديد
              </Button>
              <Button variant="secondary" onClick={() => setShowCategoryForm((v) => !v)}>
                <FontAwesomeIcon icon={faPlus} />
                تصنيف جديد
              </Button>
            </div>
          )
        }
      />

      {showCategoryForm && (
        <Card className="mb-6 flex items-end gap-2 p-4">
          <input placeholder="اسم التصنيف" value={categoryName} onChange={(e) => setCategoryName(e.target.value)} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none" />
          <Button onClick={submitCategory} loading={busy} className="px-4 py-1.5">
            حفظ
          </Button>
        </Card>
      )}

      {showItemForm && (
        <Modal title={editingId ? 'تعديل الصنف' : 'صنف جديد'} onClose={closeItemForm}>
          <div className="space-y-3">
            <select value={form.item_category_id} onChange={(e) => setForm({ ...form, item_category_id: e.target.value })} className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none">
              <option value="">بدون تصنيف</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <input placeholder="اسم الصنف" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none" />
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as Item['type'] })} className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none">
              <option value="direct_expense">مصروف مباشر</option>
              <option value="simple_stock">مخزون بسيط</option>
              <option value="tracked">دفعات وصلاحية</option>
            </select>
            <input placeholder="الوحدة" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none" />
            <div className="flex gap-2">
              <input
                type="number"
                placeholder="السعر الافتراضي (اختياري)"
                value={form.default_price}
                onChange={(e) => setForm({ ...form, default_price: e.target.value })}
                className="flex-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
              />
              <select value={form.default_currency} onChange={(e) => setForm({ ...form, default_currency: e.target.value })} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none">
                <option value="ILS">ILS</option>
                <option value="USD">USD</option>
                <option value="JOD">JOD</option>
              </select>
            </div>
            <p className="text-xs text-muted">هذا السعر بيتعبى تلقائياً أول ما تختار هالصنف بفاتورة شراء (إذا ما في سعر أحدث مسجّل لنفس المورد).</p>
            <Button onClick={submitItem} loading={busy} className="w-full justify-center">
              {editingId ? 'حفظ التعديل' : 'حفظ'}
            </Button>
          </div>
        </Modal>
      )}

      <div className="relative mb-4 w-full sm:w-80">
        <FontAwesomeIcon icon={faMagnifyingGlass} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="بحث باسم الصنف أو التصنيف..."
          className="w-full rounded-xl border border-border bg-surface py-2.5 pe-3 ps-9 text-sm focus:border-accent focus:outline-none"
        />
      </div>

      <Card>
        {!items ? (
          <TableSkeleton />
        ) : (
          <Table>
            <Thead>
              <Th>الصنف</Th>
              <Th>التصنيف</Th>
              <Th>النوع</Th>
              <Th>الوحدة</Th>
              <Th>السعر الافتراضي</Th>
              <Th></Th>
            </Thead>
            <tbody>
              {(() => {
                const q = normalizeArabic(search.trim().toLowerCase())
                const filtered = q
                  ? items.filter((i) => normalizeArabic(i.name.toLowerCase()).includes(q) || normalizeArabic((i.category?.name ?? '').toLowerCase()).includes(q))
                  : items
                if (filtered.length === 0) {
                  return <EmptyRow colSpan={6}>{q ? 'لا توجد نتائج مطابقة.' : 'لا توجد أصناف.'}</EmptyRow>
                }
                return filtered.map((i) => (
                  <Tr key={i.id}>
                    <Td className="flex items-center gap-2">
                      <FontAwesomeIcon icon={faBoxesStacked} className="text-ink/30" />
                      {i.name}
                    </Td>
                    <Td className="text-muted">{i.category?.name ?? '—'}</Td>
                    <Td className="text-muted">{TYPE_LABELS[i.type]}</Td>
                    <Td className="text-muted">{i.unit}</Td>
                    <Td className="text-muted">{i.default_price ? `${i.default_price} ${i.default_currency}` : '—'}</Td>
                    <Td>
                      <span className="flex items-center gap-3">
                        <button onClick={() => openHistory(i)} className="text-xs text-ink/50 hover:text-accent" title="سجل الأسعار">
                          <FontAwesomeIcon icon={faClockRotateLeft} />
                        </button>
                        {canManage && (
                          <>
                            <button onClick={() => startEdit(i)} className="text-xs text-accent hover:underline">
                              <FontAwesomeIcon icon={faPen} />
                            </button>
                            <button onClick={() => deleteItem(i.id)} className="text-xs text-danger hover:underline">
                              <FontAwesomeIcon icon={faTrash} />
                            </button>
                          </>
                        )}
                      </span>
                    </Td>
                  </Tr>
                ))
              })()}
            </tbody>
          </Table>
        )}
      </Card>

      {historyItem && (
        <Modal title={`سجل أسعار — ${historyItem.name}`} onClose={() => setHistoryItem(null)}>
          {!history ? (
            <p className="text-center text-sm text-muted">جارِ التحميل...</p>
          ) : history.length === 0 ? (
            <p className="text-center text-sm text-muted">ما في سجل أسعار لهالصنف بعد.</p>
          ) : (
            <Table>
              <Thead>
                <Th>السعر</Th>
                <Th>المصدر</Th>
                <Th>التاريخ</Th>
              </Thead>
              <tbody>
                {history.map((h) => (
                  <Tr key={h.id}>
                    <Td className="font-medium text-ink">{h.price} {h.currency}</Td>
                    <Td className="text-muted">{h.supplier_name ?? 'السعر الافتراضي'}</Td>
                    <Td className="text-muted">{h.recorded_at}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Modal>
      )}
    </div>
  )
}
