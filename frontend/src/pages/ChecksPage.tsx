import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faMoneyCheckDollar, faCamera, faImage, faMagnifyingGlass, faPaperPlane, faChevronDown, faChevronLeft } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import DatePicker from '../components/DatePicker'
import { formatDate } from '../lib/formatDate'
import { normalizeArabic } from '../lib/arabic'
import { Card, PageHeader, Badge, Button, Modal, Table, Thead, Th, Td, Tr, EmptyRow, TableSkeleton, CurrencySelect, SearchableSelect } from '../components/ui'
import type { BadgeVariant } from '../components/ui'
import type { CheckItem, Patient, Supplier, Cashbox } from '../types'
import RequestCheckImageButton from '../components/RequestCheckImageButton'

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
  const [image2, setImage2] = useState<File | null>(null)
  const image2InputRef = useRef<HTMLInputElement>(null)
  const [outgoingPartyType, setOutgoingPartyType] = useState<'supplier' | 'patient'>('supplier')
  const [endorseTarget, setEndorseTarget] = useState<CheckItem | null>(null)
  const [endorseTargetType, setEndorseTargetType] = useState<'supplier' | 'patient'>('supplier')
  const [endorseSupplier, setEndorseSupplier] = useState('')
  const [clearTarget, setClearTarget] = useState<CheckItem | null>(null)
  const [clearCashbox, setClearCashbox] = useState('')
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [attachTargetId, setAttachTargetId] = useState<number | null>(null)
  const [attachSlot, setAttachSlot] = useState<1 | 2>(1)
  const [requestTarget, setRequestTarget] = useState<CheckItem | null>(null)
  const attachInputRef = useRef<HTMLInputElement>(null)

  function loadAll() {
    api.get('/checks', { params: { direction } }).then((res) => setChecks(res.data))
    api.get('/suppliers').then((res) => setSuppliers(res.data))
    api.get('/patients').then((res) => setPatients(res.data.data ?? res.data))
    api.get('/cashboxes').then((res) => setCashboxes(res.data))
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

  const partyType: CheckItem['party_type'] = direction === 'incoming' ? 'patient' : outgoingPartyType

  // `patients` above is the paginated first page — it's what puts a name on the
  // rows in the table, so it stays as-is. The picker needs its own list,
  // because a clinic past 25 patients otherwise cannot record a check against
  // anyone older: they simply aren't among the options.
  const [patientResults, setPatientResults] = useState<Patient[]>([])

  const searchPatients = useCallback((query: string) => {
    api
      .get('/patients', { params: query ? { search: query } : {} })
      .then((res) => setPatientResults(res.data.data ?? res.data))
  }, [])

  const patientPickerOptions = (patientResults.length > 0 ? patientResults : patients).map((p) => ({
    value: String(p.id),
    label: p.full_name,
    sublabel: p.code,
  }))

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
      if (image2) data.append('image2', image2)

      await api.post('/checks', data, { headers: { 'Content-Type': 'multipart/form-data' } })
      setForm({ party_id: '', check_number: '', bank_name: '', amount: '', currency: 'ILS', due_date: '' })
      setImage(null)
      setImage2(null)
      if (imageInputRef.current) imageInputRef.current.value = ''
      if (image2InputRef.current) image2InputRef.current.value = ''
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
      await api.post(`/checks/${endorseTarget.id}/endorse`, endorseTargetType === 'patient'
        ? { patient_id: Number(endorseSupplier) }
        : { supplier_id: Number(endorseSupplier) })
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

  function openAttach(checkId: number, slot: 1 | 2 = 1) {
    setAttachTargetId(checkId)
    setAttachSlot(slot)
    attachInputRef.current?.click()
  }

  /**
   * Fetches the image through the authenticated axios client (same cookie
   * handling as every other API call) instead of a plain <a href> browser
   * navigation — a raw link can drop the session depending on the browser's
   * referrer/cookie policy for cross-tab navigations, which showed up as
   * "Unauthenticated" even while logged in.
   */
  async function viewImage(checkId: number, slot: 1 | 2) {
    const res = await api.get(`/checks/${checkId}/image`, { params: slot === 2 ? { slot: 2 } : undefined, responseType: 'blob' })
    const url = URL.createObjectURL(res.data)
    window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  async function attachImage(file: File) {
    if (!attachTargetId) return
    setBusy(true)
    try {
      const data = new FormData()
      data.append('image', file)
      data.append('slot', String(attachSlot))
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
            {direction === 'outgoing' && (
              <div className="flex gap-1 rounded-lg border border-border bg-surface p-1">
                <button
                  type="button"
                  onClick={() => { setOutgoingPartyType('supplier'); setForm((f) => ({ ...f, party_id: '' })) }}
                  className={`flex-1 rounded-md py-1 text-xs font-medium transition-colors ${outgoingPartyType === 'supplier' ? 'bg-accent text-white' : 'text-ink/60'}`}
                >
                  دفع لمورد
                </button>
                <button
                  type="button"
                  onClick={() => { setOutgoingPartyType('patient'); setForm((f) => ({ ...f, party_id: '' })) }}
                  className={`flex-1 rounded-md py-1 text-xs font-medium transition-colors ${outgoingPartyType === 'patient' ? 'bg-accent text-white' : 'text-ink/60'}`}
                >
                  دفع لمريض (استرجاع)
                </button>
              </div>
            )}
            {partyType === 'patient' ? (
              <SearchableSelect
                options={patientPickerOptions}
                value={form.party_id}
                onChange={(v) => setForm({ ...form, party_id: v })}
                onSearch={searchPatients}
                placeholder="ابحث عن مريض بالاسم..."
              />
            ) : (
              <select value={form.party_id} onChange={(e) => setForm({ ...form, party_id: e.target.value })} className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none">
                <option value="">المورد...</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            )}
            <input placeholder="رقم الشيك" value={form.check_number} onChange={(e) => setForm({ ...form, check_number: e.target.value })} className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none" />
            <input placeholder="اسم البنك" value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none" />
            <div className="flex gap-2">
              <input type="number" placeholder="المبلغ" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="flex-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none" />
              <CurrencySelect value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none" />
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
              {image ? `تم اختيار: ${image.name}` : 'إرفاق صورة الوجه (اختياري)'}
            </button>

            <input
              ref={image2InputRef}
              type="file"
              accept="image/*"
              onChange={(e) => setImage2(e.target.files?.[0] ?? null)}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => image2InputRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted hover:border-accent hover:text-accent"
            >
              <FontAwesomeIcon icon={faCamera} />
              {image2 ? `تم اختيار: ${image2.name}` : 'إرفاق صورة الظهر (اختياري)'}
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
                const q = normalizeArabic(search.trim().toLowerCase())
                const filtered = q
                  ? checks.filter(
                      (c) =>
                        c.check_number.toLowerCase().includes(q) ||
                        normalizeArabic((c.bank_name ?? '').toLowerCase()).includes(q) ||
                        normalizeArabic(partyName(c).toLowerCase()).includes(q),
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
                        {/* Slot 1 (الوجه) */}
                        {c.image_path && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); viewImage(c.id, 1) }}
                            className="text-accent hover:text-accent-hover"
                            title="عرض صورة الوجه"
                          >
                            <FontAwesomeIcon icon={faImage} />
                          </button>
                        )}
                        {canManage && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); openAttach(c.id, 1) }}
                            disabled={busy}
                            className="text-ink/30 hover:text-accent disabled:opacity-50"
                            title={c.image_path ? 'استبدال صورة الوجه' : 'إرفاق صورة الوجه من هالجهاز'}
                          >
                            <FontAwesomeIcon icon={faCamera} />
                          </button>
                        )}
                        {/* Slot 2 (الظهر) */}
                        {c.image_path_2 && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); viewImage(c.id, 2) }}
                            className="text-accent hover:text-accent-hover"
                            title="عرض صورة الظهر"
                          >
                            <FontAwesomeIcon icon={faImage} className="opacity-70" />
                          </button>
                        )}
                        {canManage && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); openAttach(c.id, 2) }}
                            disabled={busy}
                            className="text-ink/20 hover:text-accent disabled:opacity-50"
                            title={c.image_path_2 ? 'استبدال صورة الظهر' : 'إرفاق صورة الظهر من هالجهاز'}
                          >
                            <FontAwesomeIcon icon={faCamera} className="text-[11px]" />
                          </button>
                        )}
                        {canManage && (!c.image_path || !c.image_path_2) && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setRequestTarget(c) }}
                            disabled={busy}
                            className="text-ink/30 hover:text-accent disabled:opacity-50"
                            title="طلب الصورة عبر تيليغرام"
                          >
                            <FontAwesomeIcon icon={faPaperPlane} />
                          </button>
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
                            <button onClick={() => { setEndorseTarget(c); setEndorseTargetType('supplier'); setEndorseSupplier('') }} className="rounded-lg bg-info-soft px-2 py-1 text-xs text-info hover:opacity-80">تظهير</button>
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
        <Modal title={`تظهير الشيك #${endorseTarget.check_number}`} onClose={() => setEndorseTarget(null)}>
          <div className="space-y-3">
            <div className="flex gap-1 rounded-lg border border-border bg-surface p-1">
              <button
                type="button"
                onClick={() => { setEndorseTargetType('supplier'); setEndorseSupplier('') }}
                className={`flex-1 rounded-md py-1 text-xs font-medium transition-colors ${endorseTargetType === 'supplier' ? 'bg-accent text-white' : 'text-ink/60'}`}
              >
                لمورد
              </button>
              <button
                type="button"
                onClick={() => { setEndorseTargetType('patient'); setEndorseSupplier('') }}
                className={`flex-1 rounded-md py-1 text-xs font-medium transition-colors ${endorseTargetType === 'patient' ? 'bg-accent text-white' : 'text-ink/60'}`}
              >
                لمريض (استرجاع)
              </button>
            </div>
            {endorseTargetType === 'patient' ? (
              <SearchableSelect
                options={patientPickerOptions}
                value={endorseSupplier}
                onChange={setEndorseSupplier}
                onSearch={searchPatients}
                placeholder="ابحث عن مريض بالاسم..."
              />
            ) : (
              <select value={endorseSupplier} onChange={(e) => setEndorseSupplier(e.target.value)} className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none">
                <option value="">المورد...</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            )}
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
        <Modal title={`طلب صورة الشيك #${requestTarget.check_number}`} onClose={() => setRequestTarget(null)}>
          <RequestCheckImageButton
            checkId={requestTarget.id}
            startOpen
            onSent={() => { setRequestTarget(null); loadAll() }}
          />
        </Modal>
      )}
    </div>
  )
}
