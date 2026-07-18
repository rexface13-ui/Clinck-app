import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faBoxesStacked } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { Card, PageHeader, Button, Modal, Table, Thead, Th, Td, Tr, EmptyRow, TableSkeleton } from '../components/ui'
import type { Item, ItemCategory } from '../types'

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
  const [showCategoryForm, setShowCategoryForm] = useState(false)
  const [categoryName, setCategoryName] = useState('')
  const [form, setForm] = useState({ item_category_id: '', name: '', type: 'simple_stock' as Item['type'], unit: 'piece' })
  const [busy, setBusy] = useState(false)

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
      <PageHeader
        title="الأصناف والمخزون"
        subtitle="إدارة أصناف العيادة وتصنيفاتها"
        action={
          canManage && (
            <div className="flex gap-2">
              <Button onClick={() => setShowItemForm((v) => !v)}>
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
        <Modal title="صنف جديد" onClose={() => setShowItemForm(false)}>
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
            <Button onClick={submitItem} loading={busy} className="w-full justify-center">
              حفظ
            </Button>
          </div>
        </Modal>
      )}

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
            </Thead>
            <tbody>
              {items.length === 0 ? (
                <EmptyRow colSpan={4}>لا توجد أصناف.</EmptyRow>
              ) : (
                items.map((i) => (
                  <Tr key={i.id}>
                    <Td className="flex items-center gap-2">
                      <FontAwesomeIcon icon={faBoxesStacked} className="text-ink/30" />
                      {i.name}
                    </Td>
                    <Td className="text-muted">{i.category?.name ?? '—'}</Td>
                    <Td className="text-muted">{TYPE_LABELS[i.type]}</Td>
                    <Td className="text-muted">{i.unit}</Td>
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
