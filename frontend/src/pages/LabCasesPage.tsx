import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faCheck, faBoxOpen, faTriangleExclamation, faMagnifyingGlass, faUser } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import DatePicker from '../components/DatePicker'
import { Card, PageHeader, Button, Badge, Modal, Input, SearchableSelect, Table, Thead, Th, Td, Tr, EmptyRow, TableSkeleton } from '../components/ui'
import type { BadgeVariant } from '../components/ui'
import type { LabCase, Doctor, Supplier, Patient } from '../types'

const STATUS_LABELS: Record<LabCase['status'], string> = { sent: 'مُرسلة', ready: 'جاهزة', received: 'مُستلمة' }
const STATUS_VARIANTS: Record<LabCase['status'], BadgeVariant> = { sent: 'info', ready: 'warning', received: 'success' }

function PatientPicker({ patient, onPick }: { patient: Patient | null; onPick: (p: Patient | null) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Patient[]>([])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      return
    }
    const id = setTimeout(() => {
      api.get('/patients', { params: { search: q } }).then((res) => setResults(res.data.data))
    }, 250)
    return () => clearTimeout(id)
  }, [query])

  if (patient) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-border bg-background px-3 py-2 text-sm">
        <span><FontAwesomeIcon icon={faUser} className="ml-1 text-ink/40" />{patient.full_name}</span>
        <button type="button" onClick={() => onPick(null)} className="text-xs text-danger hover:underline">تغيير</button>
      </div>
    )
  }

  return (
    <div className="relative">
      <FontAwesomeIcon icon={faMagnifyingGlass} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="ابحث عن مريض..."
        className="w-full rounded-xl border border-border bg-surface py-2 pe-3 ps-9 text-sm focus:border-accent focus:outline-none"
      />
      {results.length > 0 && (
        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onPick(p)
                setQuery('')
                setResults([])
              }}
              className="flex w-full items-center gap-2 border-b border-border/60 px-3 py-2 text-sm last:border-0 hover:bg-background"
            >
              {p.full_name} <span className="text-muted">({p.code})</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function LabCasesPage() {
  const [cases, setCases] = useState<LabCase[]>([])
  const [loading, setLoading] = useState(true)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [showForm, setShowForm] = useState(false)
  const [filterStatus, setFilterStatus] = useState<'all' | LabCase['status']>('all')
  const [busy, setBusy] = useState(false)

  const [patient, setPatient] = useState<Patient | null>(null)
  const [form, setForm] = useState({
    doctor_id: '',
    supplier_id: '',
    description: '',
    sent_at: new Date().toISOString().slice(0, 10),
    expected_return_date: '',
    notes: '',
  })

  function load() {
    setLoading(true)
    api
      .get('/lab-cases', { params: filterStatus !== 'all' ? { status: filterStatus } : undefined })
      .then((res) => setCases(res.data.data))
      .finally(() => setLoading(false))
  }

  useEffect(load, [filterStatus])
  useEffect(() => {
    api.get('/suppliers').then((res) => setSuppliers(res.data))
    api.get('/doctors').then((res) => setDoctors(res.data.data))
  }, [])

  async function submit() {
    if (!patient || !form.supplier_id || !form.description || !form.expected_return_date) return
    setBusy(true)
    try {
      await api.post('/lab-cases', {
        patient_id: patient.id,
        doctor_id: form.doctor_id ? Number(form.doctor_id) : null,
        supplier_id: Number(form.supplier_id),
        description: form.description,
        sent_at: form.sent_at,
        expected_return_date: form.expected_return_date,
        notes: form.notes || null,
      })
      setShowForm(false)
      setPatient(null)
      setForm({ doctor_id: '', supplier_id: '', description: '', sent_at: new Date().toISOString().slice(0, 10), expected_return_date: '', notes: '' })
      load()
    } finally {
      setBusy(false)
    }
  }

  async function setStatus(labCase: LabCase, status: LabCase['status']) {
    setBusy(true)
    try {
      await api.put(`/lab-cases/${labCase.id}`, { status })
      load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="تتبع المخبر"
        subtitle="حالات مرسلة للمخبر (تيجان، أطقم...) وتاريخ الاستلام المتوقع"
        action={
          <Button onClick={() => setShowForm(true)}>
            <FontAwesomeIcon icon={faPlus} />
            حالة جديدة
          </Button>
        }
      />

      <div className="mb-4 flex gap-2">
        {(['all', 'sent', 'ready', 'received'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
              filterStatus === s ? 'border-accent bg-accent text-white' : 'border-border text-ink/60 hover:bg-background'
            }`}
          >
            {s === 'all' ? 'الكل' : STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {showForm && (
        <Modal title="حالة مخبر جديدة" onClose={() => setShowForm(false)} width="w-[560px]">
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm text-muted">المريض</label>
              <PatientPicker patient={patient} onPick={setPatient} />
            </div>
            <SearchableSelect
              options={suppliers.map((s) => ({ value: String(s.id), label: s.name }))}
              value={form.supplier_id}
              onChange={(v) => setForm({ ...form, supplier_id: v })}
              placeholder="المخبر (المورد)..."
            />
            <SearchableSelect
              options={doctors.map((d) => ({ value: String(d.id), label: d.full_name }))}
              value={form.doctor_id}
              onChange={(v) => setForm({ ...form, doctor_id: v })}
              placeholder="الطبيب (اختياري)..."
            />
            <Input label="الوصف" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm text-muted">تاريخ الإرسال</label>
                <DatePicker value={form.sent_at} onChange={(v) => setForm({ ...form, sent_at: v })} />
              </div>
              <div>
                <label className="mb-1 block text-sm text-muted">تاريخ الاستلام المتوقع</label>
                <DatePicker value={form.expected_return_date} onChange={(v) => setForm({ ...form, expected_return_date: v })} />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm text-muted">ملاحظات (اختياري)</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>إلغاء</Button>
              <Button onClick={submit} loading={busy} disabled={!patient || !form.supplier_id || !form.description || !form.expected_return_date}>
                حفظ
              </Button>
            </div>
          </div>
        </Modal>
      )}

      <Card>
        {loading ? (
          <TableSkeleton />
        ) : (
          <Table>
            <Thead>
              <Th>المريض</Th>
              <Th>الوصف</Th>
              <Th>المخبر</Th>
              <Th>الطبيب</Th>
              <Th>تاريخ الإرسال</Th>
              <Th>الاستلام المتوقع</Th>
              <Th>الحالة</Th>
              <Th></Th>
            </Thead>
            <tbody>
              {cases.length === 0 ? (
                <EmptyRow colSpan={8}>لا توجد حالات مخبر.</EmptyRow>
              ) : (
                cases.map((c) => (
                  <Tr key={c.id}>
                    <Td>{c.patient_name}</Td>
                    <Td>{c.description}</Td>
                    <Td className="text-muted">{c.supplier_name}</Td>
                    <Td className="text-muted">{c.doctor_name ?? '—'}</Td>
                    <Td className="text-muted">{c.sent_at}</Td>
                    <Td className={c.is_overdue ? 'font-medium text-danger' : 'text-muted'}>
                      {c.is_overdue && <FontAwesomeIcon icon={faTriangleExclamation} className="ml-1" />}
                      {c.expected_return_date}
                    </Td>
                    <Td>
                      <Badge variant={STATUS_VARIANTS[c.status]}>{STATUS_LABELS[c.status]}</Badge>
                    </Td>
                    <Td>
                      {c.status !== 'received' && (
                        <div className="flex gap-1">
                          {c.status === 'sent' && (
                            <button
                              onClick={() => setStatus(c, 'ready')}
                              disabled={busy}
                              className="rounded-lg border border-border px-2 py-1 text-xs text-ink/70 hover:bg-background disabled:opacity-50"
                            >
                              جاهزة
                            </button>
                          )}
                          <button
                            onClick={() => setStatus(c, 'received')}
                            disabled={busy}
                            className="flex items-center gap-1 rounded-lg bg-success-soft px-2 py-1 text-xs font-medium text-success hover:opacity-80 disabled:opacity-50"
                          >
                            <FontAwesomeIcon icon={faCheck} />
                            استلمت
                          </button>
                        </div>
                      )}
                      {c.status === 'received' && (
                        <span className="flex items-center gap-1 text-xs text-muted">
                          <FontAwesomeIcon icon={faBoxOpen} />
                          {c.received_at}
                        </span>
                      )}
                    </Td>
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
