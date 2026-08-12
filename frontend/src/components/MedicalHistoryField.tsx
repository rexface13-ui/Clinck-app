import { useEffect, useState, type KeyboardEvent } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faXmark } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'

/** Not allergies — general medical conditions worth flagging the same way, kept as a fixed local list since there's no separate catalog for them. */
const OTHER_MEDICAL_CONDITIONS = ['سيولة دم / مميعات', 'سكري', 'ضغط دم', 'حمل', 'أمراض قلب', 'ربو']

interface Props {
  alerts: string[]
  onAlertsChange: (alerts: string[]) => void
  notes: string
  onNotesChange: (notes: string) => void
}

export default function MedicalHistoryField({ alerts, onAlertsChange, notes, onNotesChange }: Props) {
  const [customTag, setCustomTag] = useState('')
  const [allergyNames, setAllergyNames] = useState<string[]>([])

  useEffect(() => {
    api.get<{ name: string }[]>('/allergies').then((res) => setAllergyNames(res.data.map((a) => a.name)))
  }, [])

  const knownTags = [...allergyNames, ...OTHER_MEDICAL_CONDITIONS]
  const customAlerts = alerts.filter((a) => !knownTags.includes(a))

  function toggle(tag: string) {
    onAlertsChange(alerts.includes(tag) ? alerts.filter((a) => a !== tag) : [...alerts, tag])
  }

  function addCustom() {
    const tag = customTag.trim()
    if (!tag || alerts.includes(tag)) return
    onAlertsChange([...alerts, tag])
    setCustomTag('')
    // Best-effort: also grow the shared allergy catalog so this shows up
    // as a pickable tag (and on the medications page) next time, instead
    // of staying a one-off free-text string only this patient has.
    if (!allergyNames.includes(tag)) {
      api.post('/allergies', { name: tag }).then((res) => setAllergyNames((prev) => [...prev, res.data.name])).catch(() => {})
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      addCustom()
    }
  }

  return (
    <div className="col-span-2">
      <label className="mb-1 block text-sm text-muted">التاريخ الطبي والحساسيات</label>
      <div className="flex flex-wrap gap-2">
        {allergyNames.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => toggle(tag)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              alerts.includes(tag) ? 'border-danger bg-danger-soft text-danger' : 'border-ink/10 text-ink/60 hover:bg-background'
            }`}
          >
            {tag}
          </button>
        ))}
        {OTHER_MEDICAL_CONDITIONS.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => toggle(tag)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              alerts.includes(tag) ? 'border-warning bg-warning-soft text-warning' : 'border-ink/10 text-ink/60 hover:bg-background'
            }`}
          >
            {tag}
          </button>
        ))}
        {customAlerts.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => toggle(tag)}
            title="إزالة"
            className="flex items-center gap-1.5 rounded-lg border border-danger bg-danger-soft px-3 py-1.5 text-xs font-medium text-danger"
          >
            {tag}
            <FontAwesomeIcon icon={faXmark} className="text-[10px]" />
          </button>
        ))}
      </div>

      <div className="mt-2 flex gap-2">
        <input
          value={customTag}
          onChange={(e) => setCustomTag(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="حساسية/حالة تانية مش موجودة فوق..."
          className="flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          onClick={addCustom}
          disabled={!customTag.trim()}
          className="flex items-center gap-1 rounded-xl border border-accent px-3 py-2 text-xs font-medium text-accent hover:bg-accent-soft disabled:opacity-40"
        >
          <FontAwesomeIcon icon={faPlus} />
          إضافة
        </button>
      </div>

      <textarea
        value={notes}
        onChange={(e) => onNotesChange(e.target.value)}
        placeholder="أي ملاحظات طبية إضافية (اختياري)..."
        rows={2}
        className="mt-2 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none"
      />
    </div>
  )
}
