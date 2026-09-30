import { useState } from 'react'
import { UPPER_PERMANENT, LOWER_PERMANENT } from '../lib/dental'

const PERMANENT_TEETH = new Set([...UPPER_PERMANENT, ...LOWER_PERMANENT])

/**
 * A child's chart only ever draws the 20 primary (baby) teeth — the wheel
 * has no slot for a permanent number at all. But mixed dentition is common:
 * a permanent tooth can already be erupted (or a primary one already gone)
 * well before the whole mouth is adult. Forcing a full "حوّل لبالغ" just to
 * work on that one tooth was the actual complaint — this lets a specific
 * permanent FDI number (11-48) be added to the pending selection directly,
 * without touching the patient's own child/adult flag or the chart layout.
 */
export default function PermanentToothPicker({ onAdd }: { onAdd: (toothNumber: number) => void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  function add() {
    const n = Number(value)
    if (!PERMANENT_TEETH.has(n)) {
      setError('رقم سن دائم غير صحيح (بين 11 و48)')
      return
    }
    onAdd(n)
    setValue('')
    setError(null)
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-ink/15 bg-surface/50 px-3 py-2">
      <span className="whitespace-nowrap text-xs text-ink/60">عند طفل عنده سن دائم طالع بدون ما تحول الملف لبالغ:</span>
      <input
        type="number"
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          setError(null)
        }}
        onKeyDown={(e) => e.key === 'Enter' && add()}
        placeholder="رقم السن الدائم"
        className="w-28 rounded-lg border border-border bg-background px-2 py-1 text-xs"
      />
      <button type="button" onClick={add} className="rounded-lg border border-accent px-2.5 py-1 text-xs text-accent hover:bg-accent-soft">
        إضافة للتحديد
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  )
}
