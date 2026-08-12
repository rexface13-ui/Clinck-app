import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPaperPlane } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { Button, SearchableSelect } from './ui'

interface LinkedTarget {
  id: number
  name: string
}

/**
 * Loads the staff users + doctors that can be pinged on Telegram for a check
 * photo. Shared by the inline picker (used before a check exists) and the
 * post-creation fallback button below.
 */
export function useTelegramCheckTargets() {
  const [staff, setStaff] = useState<LinkedTarget[]>([])
  const [doctors, setDoctors] = useState<LinkedTarget[]>([])
  const [loaded, setLoaded] = useState(false)

  function load() {
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

  return { staff, doctors, load }
}

interface PickerProps {
  target: string
  onTargetChange: (value: string) => void
  slots: (1 | 2)[]
  onSlotsChange: (slots: (1 | 2)[]) => void
}

/** Inline "مين يصوّر الشيك + أي وجه" picker — used directly inside a check-collection form, before the check even exists. */
export function TelegramCheckTargetPicker({ target, onTargetChange, slots, onSlotsChange }: PickerProps) {
  const { staff, doctors, load } = useTelegramCheckTargets()
  useEffect(load, []) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleSlot(slot: 1 | 2) {
    if (slots.includes(slot)) {
      if (slots.length === 1) return
      onSlotsChange(slots.filter((s) => s !== slot))
    } else {
      onSlotsChange([...slots, slot])
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => toggleSlot(1)}
          className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium ${slots.includes(1) ? 'border-accent bg-accent-soft text-accent' : 'border-ink/10 text-muted'}`}
        >
          وجه الشيك
        </button>
        <button
          type="button"
          onClick={() => toggleSlot(2)}
          className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium ${slots.includes(2) ? 'border-accent bg-accent-soft text-accent' : 'border-ink/10 text-muted'}`}
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
        onChange={onTargetChange}
        placeholder="اختر الطبيب أو الموظف اللي رح يصوّر..."
      />
    </div>
  )
}

/** Fires the actual request-image call given a picked target + slots. */
export async function sendTelegramCheckRequest(checkId: number, target: string, slots: (1 | 2)[]): Promise<string | null> {
  if (!target) return 'اختر مين رح يصوّر الشيك.'
  try {
    const [kind, id] = target.split(':')
    await api.post(`/checks/${checkId}/request-image`, {
      [kind === 'doctor' ? 'doctor_id' : 'user_id']: Number(id),
      slots,
    })
    return null
  } catch (err) {
    const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
    return message ?? 'تعذّر إرسال الطلب.'
  }
}

interface ButtonProps {
  checkId: number
  checkNumber?: string | null
  onSent?: () => void
  startOpen?: boolean
}

/**
 * Post-creation fallback: "طلب صورة الشيك عبر تيليغرام" for a check that
 * already exists (e.g. it got collected without a photo). The primary path
 * is the inline TelegramCheckTargetPicker inside the collection form itself.
 */
export default function RequestCheckImageButton({ checkId, checkNumber, onSent, startOpen }: ButtonProps) {
  const [open, setOpen] = useState(!!startOpen)
  const [target, setTarget] = useState('')
  const [slots, setSlots] = useState<(1 | 2)[]>([1])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function send() {
    setBusy(true)
    setError(null)
    const message = await sendTelegramCheckRequest(checkId, target, slots)
    setBusy(false)
    if (message) {
      setError(message)
      return
    }
    setSent(true)
    onSent?.()
  }

  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); setSent(false); setError(null) }}
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
      <TelegramCheckTargetPicker target={target} onTargetChange={setTarget} slots={slots} onSlotsChange={setSlots} />
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
