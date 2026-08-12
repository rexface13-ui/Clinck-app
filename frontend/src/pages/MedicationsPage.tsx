import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faPen, faTrash, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { Card, PageHeader, Button, Table, Thead, Th, Td, Tr, EmptyRow, TableSkeleton, Tabs, Modal } from '../components/ui'
import type { Allergy, Medication } from '../types'

/** Just suggestions in a datalist — the field itself stays free text since clinics use whatever labels make sense to them. */
const MEDICATION_FORM_SUGGESTIONS = ['حبوب', 'شراب', 'مرهم', 'حقنة', 'قطرة', 'بخاخ', 'تحاميل', 'كبسولات']

export default function MedicationsPage() {
  const { can } = useAuth()
  const canManage = can('medications.manage')

  return (
    <div>
      <PageHeader title="الأدوية" subtitle="قائمة الأدوية وحساسياتها المرتبطة، تُستخدم عند كتابة الروشتات" />
      <Tabs
        tabs={[
          { key: 'medications', label: 'الأدوية', content: <MedicationsTab canManage={canManage} /> },
          { key: 'allergies', label: 'الحساسيات', content: <AllergiesTab canManage={canManage} /> },
        ]}
      />
    </div>
  )
}

function MedicationsTab({ canManage }: { canManage: boolean }) {
  const [medications, setMedications] = useState<Medication[] | null>(null)
  const [allergies, setAllergies] = useState<Allergy[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({ name: '', form_: '', usage_instructions: '', allergy_ids: [] as number[] })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function load() {
    api.get('/medications').then((res) => setMedications(res.data))
    api.get('/allergies').then((res) => setAllergies(res.data))
  }

  useEffect(load, [])

  function closeForm() {
    setShowForm(false)
    setEditingId(null)
    setForm({ name: '', form_: '', usage_instructions: '', allergy_ids: [] })
    setError(null)
  }

  function startEdit(m: Medication) {
    setEditingId(m.id)
    setForm({ name: m.name, form_: m.form ?? '', usage_instructions: m.usage_instructions ?? '', allergy_ids: m.allergies.map((a) => a.id) })
    setError(null)
    setShowForm(true)
  }

  async function submit() {
    if (!form.name.trim()) return
    setBusy(true)
    setError(null)
    const payload = {
      name: form.name,
      form: form.form_ || null,
      usage_instructions: form.usage_instructions || null,
      allergy_ids: form.allergy_ids,
    }
    try {
      if (editingId) {
        await api.put(`/medications/${editingId}`, payload)
      } else {
        await api.post('/medications', payload)
      }
      closeForm()
      load()
    } catch {
      setError('تعذّر الحفظ — تحقق من الحقول.')
    } finally {
      setBusy(false)
    }
  }

  async function deleteMedication(id: number) {
    if (!window.confirm('حذف هذا الدواء نهائياً؟')) return
    try {
      await api.delete(`/medications/${id}`)
      load()
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      window.alert(message ?? 'تعذّر الحذف.')
    }
  }

  function toggleAllergy(id: number) {
    setForm((f) => ({ ...f, allergy_ids: f.allergy_ids.includes(id) ? f.allergy_ids.filter((x) => x !== id) : [...f.allergy_ids, id] }))
  }

  return (
    <div>
      {canManage && (
        <div className="mb-4">
          <Button onClick={() => (showForm ? closeForm() : setShowForm(true))}>
            <FontAwesomeIcon icon={faPlus} />
            دواء جديد
          </Button>
        </div>
      )}

      {showForm && (
        <Modal title={editingId ? 'تعديل دواء' : 'دواء جديد'} onClose={closeForm}>
          <div className="space-y-3">
            <input
              placeholder="اسم الدواء"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
            />
            <input
              list="medication-forms"
              placeholder="النوع (حبوب، شراب...)"
              value={form.form_}
              onChange={(e) => setForm({ ...form, form_: e.target.value })}
              className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
            />
            <datalist id="medication-forms">
              {MEDICATION_FORM_SUGGESTIONS.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
            <textarea
              placeholder="طريقة الاستخدام (تُدرج تلقائياً عند اختيار الدواء بالروشتة)"
              value={form.usage_instructions}
              onChange={(e) => setForm({ ...form, usage_instructions: e.target.value })}
              rows={3}
              className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
            />
            <div>
              <label className="mb-1 block text-xs text-muted">حساسيات مرتبطة بهالدواء (اختياري) — بينبّه لو المريض عنده وحدة منهم</label>
              <div className="flex flex-wrap gap-2">
                {allergies.length === 0 && <p className="text-xs text-muted">ما في حساسيات معرّفة بعد — ضيفها من تبويب "الحساسيات".</p>}
                {allergies.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => toggleAllergy(a.id)}
                    className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                      form.allergy_ids.includes(a.id) ? 'border-danger bg-danger text-white' : 'border-border text-ink/70 hover:border-danger/40'
                    }`}
                  >
                    {a.name}
                  </button>
                ))}
              </div>
            </div>
            {error && <p className="text-xs text-danger">{error}</p>}
            <Button onClick={submit} loading={busy} className="w-full justify-center">
              {editingId ? 'حفظ التعديل' : 'حفظ'}
            </Button>
          </div>
        </Modal>
      )}

      <Card>
        {!medications ? (
          <TableSkeleton />
        ) : (
          <Table>
            <Thead>
              <Th>الاسم</Th>
              <Th>النوع</Th>
              <Th>طريقة الاستخدام</Th>
              <Th>حساسيات مرتبطة</Th>
              {canManage && <Th></Th>}
            </Thead>
            <tbody>
              {medications.length === 0 ? (
                <EmptyRow colSpan={5}>لا توجد أدوية بعد.</EmptyRow>
              ) : (
                medications.map((m) => (
                  <Tr key={m.id}>
                    <Td>{m.name}</Td>
                    <Td className="text-muted">{m.form ?? '—'}</Td>
                    <Td className="max-w-xs truncate text-muted">{m.usage_instructions ?? '—'}</Td>
                    <Td>
                      {m.allergies.length > 0 ? (
                        <span className="flex flex-wrap items-center gap-1 text-xs text-danger">
                          <FontAwesomeIcon icon={faTriangleExclamation} />
                          {m.allergies.map((a) => a.name).join('، ')}
                        </span>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </Td>
                    {canManage && (
                      <Td>
                        <div className="flex items-center gap-3">
                          <button onClick={() => startEdit(m)} className="text-xs text-accent hover:underline">
                            <FontAwesomeIcon icon={faPen} />
                          </button>
                          <button onClick={() => deleteMedication(m.id)} className="text-xs text-danger hover:underline">
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
      </Card>
    </div>
  )
}

function AllergiesTab({ canManage }: { canManage: boolean }) {
  const [allergies, setAllergies] = useState<Allergy[] | null>(null)
  const [name, setName] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')
  const [busy, setBusy] = useState(false)

  function load() {
    api.get('/allergies').then((res) => setAllergies(res.data))
  }

  useEffect(load, [])

  async function add() {
    if (!name.trim()) return
    setBusy(true)
    try {
      await api.post('/allergies', { name: name.trim() })
      setName('')
      load()
    } finally {
      setBusy(false)
    }
  }

  async function saveEdit() {
    if (!editingId || !editingName.trim()) return
    await api.put(`/allergies/${editingId}`, { name: editingName.trim() })
    setEditingId(null)
    load()
  }

  async function remove(id: number) {
    if (!window.confirm('حذف هذي الحساسية نهائياً؟')) return
    try {
      await api.delete(`/allergies/${id}`)
      load()
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      window.alert(message ?? 'تعذّر الحذف.')
    }
  }

  return (
    <div>
      {canManage && (
        <Card className="mb-4 flex items-end gap-2 p-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="اسم حساسية جديدة (مثلاً: حساسية بنسلين)"
            className="flex-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
          />
          <Button onClick={add} loading={busy} className="px-4 py-1.5">
            <FontAwesomeIcon icon={faPlus} />
            إضافة
          </Button>
        </Card>
      )}

      <Card>
        {!allergies ? (
          <TableSkeleton />
        ) : (
          <Table>
            <Thead>
              <Th>الحساسية</Th>
              {canManage && <Th></Th>}
            </Thead>
            <tbody>
              {allergies.length === 0 ? (
                <EmptyRow colSpan={2}>لا توجد حساسيات معرّفة بعد.</EmptyRow>
              ) : (
                allergies.map((a) => (
                  <Tr key={a.id}>
                    <Td>
                      {editingId === a.id ? (
                        <input
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                          className="rounded-lg border border-border px-2 py-1 text-sm"
                        />
                      ) : (
                        a.name
                      )}
                    </Td>
                    {canManage && (
                      <Td>
                        <div className="flex items-center gap-3">
                          {editingId === a.id ? (
                            <>
                              <button onClick={saveEdit} className="text-xs text-accent hover:underline">حفظ</button>
                              <button onClick={() => setEditingId(null)} className="text-xs text-muted hover:underline">إلغاء</button>
                            </>
                          ) : (
                            <button
                              onClick={() => {
                                setEditingId(a.id)
                                setEditingName(a.name)
                              }}
                              className="text-xs text-accent hover:underline"
                            >
                              <FontAwesomeIcon icon={faPen} />
                            </button>
                          )}
                          <button onClick={() => remove(a.id)} className="text-xs text-danger hover:underline">
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
      </Card>
    </div>
  )
}
