import { useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCamera, faPaperPlane, faCheck } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import DatePicker from './DatePicker'
import { Modal, Button, SearchableSelect, CurrencySelect } from './ui'
import type { CheckItem } from '../types'

interface Props {
  partyType: 'patient' | 'supplier'
  partyId: number
  direction?: 'incoming' | 'outgoing'
  initialAmount?: number
  initialCurrency?: string
  onClose: () => void
  /** Called once the check row exists — same moment it starts reducing the party's ledger balance, regardless of whether a photo was attached yet. */
  onCreated: (check: CheckItem) => void
}

/**
 * The same "استلام شيك" form used on the الشيكات page, extracted so it can
 * be opened from anywhere a check is being collected (e.g. session
 * checkout) without re-navigating there. Photo attachment is offered two
 * ways, same as الشيكات: attach directly from this device now, or ping a
 * staff member over Telegram to photograph and send it later — both
 * require the check to already exist, so they only appear after step 1
 * (the check's own data) is saved.
 */
export default function ReceiveCheckModal({ partyType, partyId, direction = 'incoming', initialAmount, initialCurrency = 'ILS', onClose, onCreated }: Props) {
  const [form, setForm] = useState({
    check_number: '',
    bank_name: '',
    amount: initialAmount ? String(initialAmount) : '',
    currency: initialCurrency,
    due_date: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdCheck, setCreatedCheck] = useState<CheckItem | null>(null)
  const [imageAttached, setImageAttached] = useState(false)
  const imageInputRef = useRef<HTMLInputElement>(null)

  const [staff, setStaff] = useState<{ id: number; name: string }[]>([])
  const [requestingPhoto, setRequestingPhoto] = useState(false)
  const [requestUserId, setRequestUserId] = useState('')

  useEffect(() => {
    if (createdCheck) {
      api.get('/users').then((res) => setStaff(res.data.data.map((u: { id: number; name: string }) => ({ id: u.id, name: u.name }))))
    }
  }, [createdCheck])

  async function submit() {
    if (!form.check_number || !form.amount || !form.due_date) {
      setError('عبّي رقم الشيك والمبلغ وتاريخ الاستحقاق.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await api.post<CheckItem>('/checks', {
        direction,
        party_type: partyType,
        party_id: partyId,
        check_number: form.check_number,
        bank_name: form.bank_name || undefined,
        amount: form.amount,
        currency: form.currency,
        due_date: form.due_date,
      })
      setCreatedCheck(res.data)
      onCreated(res.data)
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      setError(message ?? 'صار خطأ أثناء حفظ الشيك.')
    } finally {
      setBusy(false)
    }
  }

  async function attachImage(file: File) {
    if (!createdCheck) return
    setBusy(true)
    try {
      const data = new FormData()
      data.append('image', file)
      await api.post(`/checks/${createdCheck.id}/image`, data, { headers: { 'Content-Type': 'multipart/form-data' } })
      setImageAttached(true)
    } finally {
      setBusy(false)
    }
  }

  async function requestPhoto() {
    if (!createdCheck || !requestUserId) return
    setBusy(true)
    try {
      await api.post(`/checks/${createdCheck.id}/request-image`, { user_id: Number(requestUserId) })
      setRequestingPhoto(false)
    } finally {
      setBusy(false)
    }
  }

  if (createdCheck) {
    return (
      <Modal title={`تم حفظ الشيك #${createdCheck.check_number}`} onClose={onClose}>
        <div className="space-y-3">
          <p className="flex items-center gap-1.5 text-sm text-success">
            <FontAwesomeIcon icon={faCheck} />
            انحفظ الشيك وانخصم من حساب المريض — رح تلاقيه بصفحة "الشيكات".
          </p>

          {!imageAttached && !requestingPhoto && (
            <div className="space-y-2 rounded-lg bg-background p-3">
              <p className="text-xs text-muted">صورة الشيك (اختياري) — بطريقتين:</p>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) attachImage(file)
                }}
              />
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted hover:border-accent hover:text-accent disabled:opacity-50"
              >
                <FontAwesomeIcon icon={faCamera} />
                إرفاق الصورة الآن من هالجهاز
              </button>
              <button
                type="button"
                onClick={() => setRequestingPhoto(true)}
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted hover:border-accent hover:text-accent disabled:opacity-50"
              >
                <FontAwesomeIcon icon={faPaperPlane} />
                اطلبها من موظف عبر تيليغرام
              </button>
            </div>
          )}

          {imageAttached && <p className="text-xs text-success">تم إرفاق الصورة.</p>}

          {requestingPhoto && (
            <div className="space-y-2 rounded-lg bg-background p-3">
              <p className="text-xs text-muted">اختر الموظف — رح توصله رسالة تيليغرام يصوّر فيها الشيك ويبعتها، وبتنحفظ هون تلقائياً.</p>
              <SearchableSelect
                options={staff.map((s) => ({ value: String(s.id), label: s.name }))}
                value={requestUserId}
                onChange={setRequestUserId}
                placeholder="اختر موظف..."
              />
              <div className="flex gap-2">
                <Button onClick={requestPhoto} loading={busy} className="flex-1 justify-center">
                  إرسال الطلب
                </Button>
                <button onClick={() => setRequestingPhoto(false)} className="rounded-lg px-3 py-1.5 text-xs text-muted hover:bg-background">
                  إلغاء
                </button>
              </div>
            </div>
          )}

          <Button onClick={onClose} variant="secondary" className="w-full justify-center">
            تم
          </Button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="استلام شيك" onClose={onClose}>
      <div className="space-y-3">
        <input
          placeholder="رقم الشيك"
          value={form.check_number}
          onChange={(e) => setForm({ ...form, check_number: e.target.value })}
          className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
        />
        <input
          placeholder="اسم البنك"
          value={form.bank_name}
          onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
          className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
        />
        <div className="flex gap-2">
          <input
            type="number"
            placeholder="المبلغ"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            className="flex-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
          />
          <CurrencySelect value={form.currency}
            onChange={(e) => setForm({ ...form, currency: e.target.value })}
            className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm focus:border-accent focus:outline-none" />
        </div>
        <DatePicker value={form.due_date} onChange={(v) => setForm({ ...form, due_date: v })} placeholder="تاريخ الاستحقاق" />

        {error && <p className="text-xs text-danger">{error}</p>}

        <Button onClick={submit} loading={busy} className="w-full justify-center">
          حفظ
        </Button>
      </div>
    </Modal>
  )
}
