import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faMoneyCheckDollar } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import DatePicker from '../components/DatePicker'
import { formatDate } from '../lib/formatDate'
import type { CheckItem, Patient, Supplier, Cashbox } from '../types'

type Direction = 'incoming' | 'outgoing'

const STATUS_LABELS: Record<CheckItem['status'], string> = {
  in_wallet: 'في المحفظة',
  endorsed: 'مظهّر',
  bounced: 'راجع',
  cleared: 'محصّل',
}

const STATUS_COLORS: Record<CheckItem['status'], string> = {
  in_wallet: 'bg-ink/10 text-ink/60',
  endorsed: 'bg-blue-100 text-blue-700',
  bounced: 'bg-danger/10 text-danger',
  cleared: 'bg-green-100 text-green-700',
}

export default function ChecksPage() {
  const { can } = useAuth()
  const canManage = can('checks.manage')
  const [direction, setDirection] = useState<Direction>('incoming')
  const [checks, setChecks] = useState<CheckItem[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [patients, setPatients] = useState<Patient[]>([])
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ party_id: '', check_number: '', bank_name: '', amount: '', currency: 'ILS', due_date: '' })
  const [endorseTarget, setEndorseTarget] = useState<CheckItem | null>(null)
  const [endorseSupplier, setEndorseSupplier] = useState('')
  const [clearTarget, setClearTarget] = useState<CheckItem | null>(null)
  const [clearCashbox, setClearCashbox] = useState('')
  const [busy, setBusy] = useState(false)

  function loadAll() {
    api.get('/checks', { params: { direction } }).then((res) => setChecks(res.data))
    api.get('/suppliers').then((res) => setSuppliers(res.data))
    api.get('/patients').then((res) => setPatients(res.data.data ?? res.data))
    api.get('/cashboxes').then((res) => setCashboxes(res.data))
  }

  useEffect(loadAll, [direction])

  const partyType: CheckItem['party_type'] = direction === 'incoming' ? 'patient' : 'supplier'
  const partyOptions = partyType === 'patient' ? patients : suppliers

  function partyName(check: CheckItem): string {
    if (check.party_type === 'patient') return patients.find((p) => p.id === check.party_id)?.full_name ?? `#${check.party_id}`
    return suppliers.find((s) => s.id === check.party_id)?.name ?? `#${check.party_id}`
  }

  async function submit() {
    if (!form.party_id || !form.check_number || !form.amount || !form.due_date) return
    setBusy(true)
    try {
      await api.post('/checks', {
        direction,
        party_type: partyType,
        party_id: Number(form.party_id),
        check_number: form.check_number,
        bank_name: form.bank_name || null,
        amount: Number(form.amount),
        currency: form.currency,
        due_date: form.due_date,
      })
      setForm({ party_id: '', check_number: '', bank_name: '', amount: '', currency: 'ILS', due_date: '' })
      setShowForm(false)
      loadAll()
    } finally {
      setBusy(false)
    }
  }

  async function endorse() {
    if (!endorseTarget || !endorseSupplier) return
    setBusy(true)
    try {
      await api.post(`/checks/${endorseTarget.id}/endorse`, { supplier_id: Number(endorseSupplier) })
      setEndorseTarget(null)
      setEndorseSupplier('')
      loadAll()
    } finally {
      setBusy(false)
    }
  }

  async function bounce(check: CheckItem) {
    if (!confirm('تأكيد رجوع الشيك؟')) return
    await api.post(`/checks/${check.id}/bounce`)
    loadAll()
  }

  async function clear() {
    if (!clearTarget) return
    setBusy(true)
    try {
      await api.post(`/checks/${clearTarget.id}/clear`, clearCashbox ? { cashbox_id: Number(clearCashbox) } : {})
      setClearTarget(null)
      setClearCashbox('')
      loadAll()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold text-ink">الشيكات</h1>

      <div className="mb-4 flex items-center justify-between">
        <div className="flex gap-2">
          <button onClick={() => setDirection('incoming')} className={`rounded-xl px-4 py-2 text-sm ${direction === 'incoming' ? 'bg-accent text-white' : 'bg-white text-ink/70'}`}>
            واردة (من مرضى)
          </button>
          <button onClick={() => setDirection('outgoing')} className={`rounded-xl px-4 py-2 text-sm ${direction === 'outgoing' ? 'bg-accent text-white' : 'bg-white text-ink/70'}`}>
            صادرة (لموردين)
          </button>
        </div>
        {canManage && (
          <button onClick={() => setShowForm((v) => !v)} className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover">
            <FontAwesomeIcon icon={faPlus} />
            استلام شيك
          </button>
        )}
      </div>

      {showForm && (
        <div className="mb-6 flex flex-wrap items-end gap-2 rounded-xl bg-white p-4 shadow-sm">
          <select value={form.party_id} onChange={(e) => setForm({ ...form, party_id: e.target.value })} className="rounded-lg border border-ink/10 px-2 py-1.5 text-sm">
            <option value="">{partyType === 'patient' ? 'المريض...' : 'المورد...'}</option>
            {partyOptions.map((p) => (
              <option key={p.id} value={p.id}>{'full_name' in p ? p.full_name : p.name}</option>
            ))}
          </select>
          <input placeholder="رقم الشيك" value={form.check_number} onChange={(e) => setForm({ ...form, check_number: e.target.value })} className="w-32 rounded-lg border border-ink/10 px-2 py-1.5 text-sm" />
          <input placeholder="اسم البنك" value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} className="w-32 rounded-lg border border-ink/10 px-2 py-1.5 text-sm" />
          <input type="number" placeholder="المبلغ" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="w-28 rounded-lg border border-ink/10 px-2 py-1.5 text-sm" />
          <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className="rounded-lg border border-ink/10 px-2 py-1.5 text-sm">
            <option value="ILS">ILS</option>
            <option value="USD">USD</option>
            <option value="JOD">JOD</option>
          </select>
          <div className="w-40">
            <DatePicker value={form.due_date} onChange={(v) => setForm({ ...form, due_date: v })} placeholder="تاريخ الاستحقاق" />
          </div>
          <button onClick={submit} disabled={busy} className="rounded-lg bg-accent px-4 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-60">
            حفظ
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-right text-ink/60">
              <th className="p-4 font-medium">الطرف</th>
              <th className="p-4 font-medium">رقم الشيك</th>
              <th className="p-4 font-medium">البنك</th>
              <th className="p-4 font-medium">المبلغ</th>
              <th className="p-4 font-medium">الاستحقاق</th>
              <th className="p-4 font-medium">الحالة</th>
              {canManage && <th className="p-4"></th>}
            </tr>
          </thead>
          <tbody>
            {checks.length === 0 ? (
              <tr><td colSpan={7} className="p-6 text-center text-sm text-ink/40">لا توجد شيكات.</td></tr>
            ) : (
              checks.map((c) => (
                <tr key={c.id} className="border-b border-ink/5 last:border-0">
                  <td className="flex items-center gap-2 p-4">
                    <FontAwesomeIcon icon={faMoneyCheckDollar} className="text-ink/30" />
                    {partyName(c)}
                  </td>
                  <td className="p-4 text-ink/70">{c.check_number}</td>
                  <td className="p-4 text-ink/70">{c.bank_name ?? '—'}</td>
                  <td className="p-4 text-ink/70">{c.amount} {c.currency}</td>
                  <td className="p-4 text-ink/70">{formatDate(c.due_date)}</td>
                  <td className="p-4">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_COLORS[c.status]}`}>{STATUS_LABELS[c.status]}</span>
                  </td>
                  {canManage && (
                    <td className="flex gap-2 p-4">
                      {c.status === 'in_wallet' && c.direction === 'incoming' && (
                        <button onClick={() => setEndorseTarget(c)} className="rounded-lg bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100">تظهير</button>
                      )}
                      {c.status === 'in_wallet' || c.status === 'endorsed' ? (
                        <>
                          <button onClick={() => setClearTarget(c)} className="rounded-lg bg-green-50 px-2 py-1 text-xs text-green-700 hover:bg-green-100">تحصيل</button>
                          <button onClick={() => bounce(c)} className="rounded-lg bg-danger/10 px-2 py-1 text-xs text-danger hover:bg-danger/20">رجوع</button>
                        </>
                      ) : null}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {endorseTarget && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/30 p-4" onClick={() => setEndorseTarget(null)}>
          <div className="w-80 space-y-3 rounded-xl bg-white p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-medium text-ink">تظهير الشيك #{endorseTarget.check_number} لمورد</p>
            <select value={endorseSupplier} onChange={(e) => setEndorseSupplier(e.target.value)} className="w-full rounded-lg border border-ink/10 px-2 py-1.5 text-sm">
              <option value="">المورد...</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button onClick={endorse} disabled={busy} className="w-full rounded-lg bg-accent px-4 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-60">
              تأكيد التظهير
            </button>
          </div>
        </div>
      )}

      {clearTarget && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/30 p-4" onClick={() => setClearTarget(null)}>
          <div className="w-80 space-y-3 rounded-xl bg-white p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-medium text-ink">تحصيل الشيك #{clearTarget.check_number}</p>
            {(clearTarget.direction === 'incoming' && clearTarget.status === 'in_wallet') || clearTarget.direction === 'outgoing' ? (
              <select value={clearCashbox} onChange={(e) => setClearCashbox(e.target.value)} className="w-full rounded-lg border border-ink/10 px-2 py-1.5 text-sm">
                <option value="">الصندوق...</option>
                {cashboxes.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.currency})</option>)}
              </select>
            ) : (
              <p className="text-xs text-ink/50">شيك مظهّر مسبقاً — لا حاجة لصندوق.</p>
            )}
            <button onClick={clear} disabled={busy} className="w-full rounded-lg bg-accent px-4 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-60">
              تأكيد التحصيل
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
