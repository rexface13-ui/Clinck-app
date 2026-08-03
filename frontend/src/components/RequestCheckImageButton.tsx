import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPaperPlane } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { Button, SearchableSelect } from './ui'

interface Props {
  checkId: number
  checkNumber?: string | null
  onSent?: () => void
  startOpen?: boolean
}

/**
 * "طلب صورة عبر تيليغرام" — lets staff pick which side of the check they
 * need (وجه/ظهر) and who to ping (a staff user or a linked doctor); the bot
 * messages that person and auto-attaches their next photo reply to this
 * check at the requested slot. Shared across every check-collection surface
 * (ChecksPage, InvoiceDetailModal, PatientLedgerPanel) so the capability is
 * consistent everywhere a check gets received.
 */
export default function RequestCheckImageButton({ checkId, checkNumber, onSent, startOpen }: Props) {
  const [open, setOpen] = useState(!!startOpen)
  const [loaded, setLoaded] = useState(false)
  const [staff, setStaff] = useState<{ id: number; name: string }[]>([])
  const [doctors, setDoctors] = useState<{ id: number; name: string }[]>([])
  const [slot, setSlot] = useState<1 | 2>(1)
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  function loadOptions() {
    if (loaded) return
    Promise.all([
      api.get('/users').then((res) => res.data.data ?? res.data),
      api.get('/telegram-registrations-linked').then((res) => res.data.doctors ?? []),
    ]).then(([users, linkedDoctors]) => {
      setStaff(users.map((u: { id: number; name: string }) => ({ id: u.id, name: u.name })))
      setDoctors(linkedDoctors.map((d: { id: number; full_name: string }) => ({ id: d.id, name: d.full_name })))
      setLoaded(true)
    })
  }

  useEffect(() => {
    if (startOpen) loadOptions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function openPanel() {
    setOpen(true)
    setSent(false)
    setError(null)
    loadOptions()
  }

  async function send() {
    if (!target) return
    setBusy(true)
    setError(null)
    try {
      const [kind, id] = target.split(':')
      await api.post(`/checks/${checkId}/request-image`, {
        [kind === 'doctor' ? 'doctor_id' : 'user_id']: Number(id),
        slot,
      })
      setSent(true)
      onSent?.()
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      setError(message ?? 'تعذّر إرسال الطلب.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={openPanel}
        className="flex items-center gap-1 text-xs font-medium text-accent hover:opacity-80"
      >
        <FontAwesomeIcon icon={faPaperPlane} />
        طلب صورة الشيك عبر تيليغرام
      </button>
    )
  }

  return (
    <div className="space-y-2 rounded-lg border border-ink/10 p-3">
      <p className="text-xs text-muted">
        {checkNumber ? `شيك رقم ${checkNumber} — ` : ''}اختر أي وجه للشيك ومين يصوّره، رح توصله رسالة تيليغرام وتنحفظ الصورة هون تلقائياً.
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => setSlot(1)}
          className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium ${slot === 1 ? 'border-accent bg-accent-soft text-accent' : 'border-ink/10 text-muted'}`}
        >
          وجه الشيك
        </button>
        <button
          onClick={() => setSlot(2)}
          className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium ${slot === 2 ? 'border-accent bg-accent-soft text-accent' : 'border-ink/10 text-muted'}`}
        >
          ظهر الشيك
        </button>
      </div>
      <SearchableSelect
        options={[
          ...doctors.map((d) => ({ value: `doctor:${d.id}`, label: `د. ${d.name}` })),
          ...staff.map((s) => ({ value: `user:${s.id}`, label: s.name })),
        ]}
        value={target}
        onChange={setTarget}
        placeholder="اختر الطبيب أو الموظف..."
      />
      {error && <p className="text-xs text-danger">{error}</p>}
      {sent ? (
        <p className="text-xs text-success">تم إرسال الطلب ✅</p>
      ) : (
        <div className="flex gap-2">
          <Button onClick={send} loading={busy} disabled={!target} className="flex-1 justify-center text-xs">
            إرسال الطلب
          </Button>
          <Button variant="secondary" onClick={() => setOpen(false)} className="text-xs">
            إلغاء
          </Button>
        </div>
      )}
    </div>
  )
}
