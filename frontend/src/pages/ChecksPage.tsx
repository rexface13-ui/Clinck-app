import { Fragment, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faMoneyCheckDollar, faCamera, faImage, faMagnifyingGlass, faPaperPlane, faChevronDown, faChevronLeft } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import DatePicker from '../components/DatePicker'
import { formatDate } from '../lib/formatDate'
import { Card, PageHeader, Badge, Button, Modal, Table, Thead, Th, Td, Tr, EmptyRow, TableSkeleton, SearchableSelect } from '../components/ui'
import type { BadgeVariant } from '../components/ui'
import type { CheckItem, Patient, Supplier, Cashbox } from '../types'

type Direction = 'incoming' | 'outgoing'

const STATUS_LABELS: Record<CheckItem['status'], string> = {
  in_wallet: 'في المحفظة',
  endorsed: 'مظهّر',
  bounced: 'راجع',
  cleared: 'محصّل',
}

const STATUS_VARIANTS: Record<CheckItem['status'], BadgeVariant> = {
  in_wallet: 'neutral',
  endorsed: 'info',
  bounced: 'danger',
  cleared: 'success',
}

const EVENT_LABELS: Record<'received' | 'endorsed' | 'bounced' | 'cleared', string> = {
  received: 'استُلم',
  endorsed: 'ظُهّر لمورد',
  bounced: 'رجع',
  cleared: 'تحصّل',
}

export default function ChecksPage() {
  const { can, data } = useAuth()
  const canManage = can('checks.manage')
  const defaultCurrency = (data?.settings.base_currency as string) ?? 'ILS'
  const [searchParams, setSearchParams] = useSearchParams()
  const [direction, setDirection] = useState<Direction>(() => (searchParams.get('direction') === 'outgoing' ? 'outgoing' : 'incoming'))
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [checks, setChecks] = useState<CheckItem[] | null>(null)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [patients, setPatients] = useState<Patient[]>([])
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([])
  const [showForm, setShowForm] = useState(() => searchParams.get('new') === '1')
  const [form, setForm] = useState({ party_id: '', check_number: '', bank_name: '', amount: '', currency: 'ILS', due_date: '' })
  useEffect(() => setForm((f) => ({ ...f, currency: defaultCurrency })), [defaultCurrency])
  const [image, setImage] = useState<File | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [endorseTarget, setEndorseTarget] = useState<CheckItem | null>(null)
  const [endorseSupplier, setEndorseSupplier] = useState('')
  const [clearTarget, setClearTarget] = useState<CheckItem | null>(null)
  const [clearCashbox, setClearCashbox] = useState('')
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [attachTargetId, setAttachTargetId] = useState<number | null>(null)
  const [requestTarget, setRequestTarget] = useState<CheckItem | null>(null)
  const [requestUserId, setRequestUserId] = useState('')
  const [requestError, setRequestError] = useState<string | null>(null)
  const [staff, setStaff] = useState<{ id: number; name: string }[]>([])
  const attachInputRef = useRef<HTMLInputElement>(null)

  function loadAll() {
    api.get('/checks', { params: { direction } }).then((res) => setChecks(res.data))
    api.get('/suppliers').then((res) => setSuppliers(res.data))
    api.get('/patients').then((res) => setPatients(res.data.data ?? res.data))
    api.get('/cashboxes').then((res) => setCashboxes(res.data))
    api.get('/users').then((res) => setStaff(res.data.data.map((u: { id: number; name: string }) => ({ id: u.id, name: u.name }))))
  }

  useEffect(loadAll, [direction])

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setShowForm(true)
      const supplierId = searchParams.get('supplier_id')
      if (supplierId) setForm((f) => ({ ...f, party_id: supplierId }))
      searchParams.delete('new')
      searchParams.delete('direction')
      searchParams.delete('supplier_id')
      setSearchParams(searchParams, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      const data = new FormData()
      data.append('direction', direction)
      data.append('party_type', partyType)
      data.append('party_id', form.party_id)
      data.append('check_number', form.check_number)
      if (form.bank_name) data.append('bank_name', form.bank_name)
      data.append('amount', form.amount)
      data.append('currency', form.currency)
      data.append('due_date', form.due_date)
      if (image) data.append('image', image)

      await api.post('/checks', data, { headers: { 'Content-Type': 'multipart/form-data' } })
      setForm({ party_id: '', check_number: '', bank_name: '', amount: '', currency: 'ILS', due_date: '' })
      setImage(null)
      if (imageInputRef.current) imageInputRef.current.value = ''
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

  async function requestPhoto() {
    if (!requestTarget || !requestUserId) return
    setBusy(true)
    setRequestError(null)
    try {
      await api.post(`/checks/${requestTarget.id}/request-image`, { user_id: Number(requestUserId) })
      setRequestTarget(null)
      setRequestUserId('')
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      setRequestError(message ?? 'تعذّر إرسال الطلب.')
    } finally {
      setBusy(false)
    }
  }

  async function bounce(check: CheckItem) {
    if (!confirm('تأكيد رجوع الشيك؟')) return
    await api.post(`/checks/${check.id}/bounce`)
    loadAll()
  }

  function openAttach(checkId: number) {
    setAttachTargetId(checkId)
    attachInputRef.current?.click()
  }

  async function attachImage(file: File) {
    if (!attachTargetId) return
    setBusy(true)
    try {
      const data = new FormData()
      data.append('image', file)
      await api.post(`/checks/${attachTargetId}/image`, data, { headers: { 'Content-Type': 'multipart/form-data' } })
      loadAll()
    } finally {
      setBusy(false)
      setAttachTargetId(null)
      if (attachInputRef.current) attachInputRef.current.value = ''
    }
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
      <PageHeader title="الشيكات" subtitle="متابعة الشيكات الواردة والصادرة" />

      <div className="mb-4 flex items-center justify-between">
        <div className="flex gap-2 rounded-xl border border-border bg-surface p-1">
          <button onClick={() => setDirection('incoming')} className={`rounded-lg px-4 py-1.5 text-sm transition-colors ${direction === 'incoming' ? 'bg-accent text-white' : 'text-ink/70 hover:bg-background'}`}>
            واردة (من مرضى)
          </button>
          <button onClick={() => setDirection('outgoing')} className={`rounded-lg px-4 py-1.5 text-sm transition-colors ${direction === 'outgoing' ? 'bg-accent text-white' : 'text-ink/70 hover:bg-background'}`}>
            صادرة (لموردين)
          </button>
        </div>
        {canManage && (
          <Button onClick={() => setShowForm((v) => !v)}>
            <FontAwesomeIcon icon={faPlus} />
            استلام شيك
          </Button>
        )}
      </div>

      {showForm && (
        <Modal title="استلام شيك" onClose={() => setShowForm(false)}>
          <div className="space-y-3">
            <select value={form.party_id} onChange={(e) => setForm({ ...form, party_id: e.target.value })} className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none">
              <option value="">{partyType === 'patient' ? 'المريض...' : 'المورد...'}</option>
              {partyOptions.map((p) => (
                <option key={p.id} value={p.id}>{'full_name' in p ? p.full_name : p.name}</option>
              ))}
            </select>
            <input placeholder="رقم الشيك" value={form.check_number} onChange={(e) => setForm({ ...form, check_number: e.target.value })} className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none" />
            <input placeholder="اسم البنك" value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none" />
            <div className="flex gap-2">
              <input type="number" placeholder="المبلغ" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="flex-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none" />
              <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none">
                <option value="ILS">ILS</option>
                <option value="USD">USD</option>
                <option value="JOD">JOD</option>
              </select>
            </div>
            <DatePicker value={form.due_date} onChange={(v) => setForm({ ...form, due_date: v })} placeholder="تاريخ الاستحقاق" />

            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => setImage(e.target.files?.[0] ?? null)}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted hover:border-accent hover:text-accent"
            >
              <FontAwesomeIcon icon={faCamera} />
              {image ? `تم اختيار: ${image.name}` : 'إرفاق صورة الشيك (اختياري)'}
            </button>

            <Button onClick={submit} loading={busy} className="w-full justify-center">
              حفظ
            </Button>
          </div>
        </Modal>
      )}

      <input
        ref={attachInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) attachImage(file)
        }}
      />

      <div className="relative mb-4 w-full sm:w-80">
        <FontAwesomeIcon icon={faMagnifyingGlass} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="بحث برقم الشيك أو اسم الطرف أو البنك..."
          className="w-full rounded-xl border border-border bg-surface py-2.5 pe-3 ps-9 text-sm focus:border-accent focus:outline-none"
        />
      </div>

      <Card>
        {!checks ? (
          <TableSkeleton />
        ) : (
          <Table>
            <Thead>
              <Th>الطرف</Th>
              <Th>رقم الشيك</Th>
              <Th>البنك</Th>
              <Th>المبلغ</Th>
              <Th>الاستحقاق</Th>
              <Th>الحالة</Th>
              {canManage && <Th></Th>}
            </Thead>
            <tbody>
              {(() => {
                const q = search.trim().toLowerCase()
                const filtered = q
                  ? checks.filter(
                      (c) =>
                        c.check_number.toLowerCase().includes(q) ||
                        (c.bank_name ?? '').toLowerCase().includes(q) ||
                        partyName(c).toLowerCase().includes(q),
                    )
                  : checks
                if (filtered.length === 0) {
                  return <EmptyRow colSpan={7}>{q ? 'لا توجد نتائج مطابقة.' : 'لا توجد شيكات.'}</EmptyRow>
                }
                return filtered.map((c) => (
                  <Fragment key={c.id}>
                  <Tr onClick={() => setExpandedId(expandedId === c.id ? null : c.id)} className="cursor-pointer">
                    <Td className="flex items-center gap-2">
                      <FontAwesomeIcon icon={expandedId === c.id ? faChevronDown : faChevronLeft} className="text-ink/30" />
                      <FontAwesomeIcon icon={faMoneyCheckDollar} className="text-ink/30" />
                      {partyName(c)}
                    </Td>
                    <Td className="text-muted">
                      <span className="flex items-center gap-2">
                        {c.check_number}
                        {c.image_path ? (
                          <a
                            href={`/api/checks/${c.id}/image`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-accent hover:text-accent-hover"
                            title="عرض صورة الشيك"
                          >
                            <FontAwesomeIcon icon={faImage} />
                          </a>
                        ) : (
                          canManage && (
                            <>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); openAttach(c.id) }}
                                disabled={busy}
                                className="text-ink/30 hover:text-accent disabled:opacity-50"
                                title="إرفاق صورة الشيك من هالجهاز"
                              >
                                <FontAwesomeIcon icon={faCamera} />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setRequestTarget(c) }}
                                disabled={busy}
                                className="text-ink/30 hover:text-accent disabled:opacity-50"
                                title="طلب الصورة من موظف عبر تيليغرام"
                              >
                                <FontAwesomeIcon icon={faPaperPlane} />
                              </button>
                            </>
                          )
                        )}
                      </span>
                    </Td>
                    <Td className="text-muted">{c.bank_name ?? '—'}</Td>
                    <Td className="text-muted">{c.amount} {c.currency === 'ILS' ? '₪' : c.currency}</Td>
                    <Td className="text-muted">{formatDate(c.due_date)}</Td>
                    <Td>
                      <Badge variant={STATUS_VARIANTS[c.status]}>{STATUS_LABELS[c.status]}</Badge>
                    </Td>
                    {canManage && (
                      <Td onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-2">
                          {c.status === 'in_wallet' && c.direction === 'incoming' && (
                            <button onClick={() => setEndorseTarget(c)} className="rounded-lg bg-info-soft px-2 py-1 text-xs text-info hover:opacity-80">تظهير</button>
                          )}
                          {c.status === 'in_wallet' || c.status === 'endorsed' ? (
                            <>
                              <button onClick={() => setClearTarget(c)} className="rounded-lg bg-success-soft px-2 py-1 text-xs text-success hover:opacity-80">تحصيل</button>
                              <button onClick={() => bounce(c)} className="rounded-lg bg-danger-soft px-2 py-1 text-xs text-danger hover:opacity-80">رجوع</button>
                            </>
                          ) : null}
                        </div>
                      </Td>
                    )}
                  </Tr>
                  {expandedId === c.id && (
                    <Tr>
                      <Td colSpan={canManage ? 7 : 6} className="bg-background">
                        {!c.events || c.events.length === 0 ? (
                          <p className="py-1 text-xs text-muted">لا يوجد سجل تتبع لهالشيك.</p>
                        ) : (
                          <ol className="space-y-1 py-1">
                            {c.events.map((ev) => (
                              <li key={ev.id} className="flex items-center gap-2 text-xs text-ink/70">
                                <span className="size-1.5 shrink-0 rounded-full bg-accent" />
                                <span className="font-medium text-ink">{EVENT_LABELS[ev.event_type]}</span>
                                {ev.event_type === 'endorsed' && ev.endorsed_to_supplier_id && (
                                  <span>— {suppliers.find((s) => s.id === ev.endorsed_to_supplier_id)?.name ?? `#${ev.endorsed_to_supplier_id}`}</span>
                                )}
                                <span className="text-muted">— {formatDate(ev.occurred_at)}</span>
                                {ev.notes && <span className="text-muted">— {ev.notes}</span>}
                              </li>
                            ))}
                          </ol>
                        )}
                      </Td>
                    </Tr>
                  )}
                  </Fragment>
                ))
              })()}
            </tbody>
          </Table>
        )}
      </Card>

      {endorseTarget && (
        <Modal title={`تظهير الشيك #${endorseTarget.check_number} لمورد`} onClose={() => setEndorseTarget(null)}>
          <div className="space-y-3">
            <select value={endorseSupplier} onChange={(e) => setEndorseSupplier(e.target.value)} className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none">
              <option value="">المورد...</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <Button onClick={endorse} loading={busy} className="w-full justify-center">
              تأكيد التظهير
            </Button>
          </div>
        </Modal>
      )}

      {clearTarget && (
        <Modal title={`تحصيل الشيك #${clearTarget.check_number}`} onClose={() => setClearTarget(null)}>
          <div className="space-y-3">
            {(clearTarget.direction === 'incoming' && clearTarget.status === 'in_wallet') || clearTarget.direction === 'outgoing' ? (
              <select value={clearCashbox} onChange={(e) => setClearCashbox(e.target.value)} className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none">
                <option value="">الصندوق...</option>
                {cashboxes.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.currency})</option>)}
              </select>
            ) : (
              <p className="text-xs text-muted">شيك مظهّر مسبقاً — لا حاجة لصندوق.</p>
            )}
            <Button onClick={clear} loading={busy} className="w-full justify-center">
              تأكيد التحصيل
            </Button>
          </div>
        </Modal>
      )}

      {requestTarget && (
        <Modal title={`طلب صورة الشيك #${requestTarget.check_number}`} onClose={() => { setRequestTarget(null); setRequestError(null) }}>
          <div className="space-y-3">
            <p className="text-xs text-muted">اختر الموظف — رح توصله رسالة تيليغرام يصوّر فيها الشيك ويبعتها، وبتنحفظ هون تلقائياً.</p>
            <SearchableSelect
              options={staff.map((s) => ({ value: String(s.id), label: s.name }))}
              value={requestUserId}
              onChange={setRequestUserId}
              placeholder="اختر موظف..."
            />
            {requestError && <p className="text-xs text-danger">{requestError}</p>}
            <Button onClick={requestPhoto} loading={busy} className="w-full justify-center">
              إرسال الطلب
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
