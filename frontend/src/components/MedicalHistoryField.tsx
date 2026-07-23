export const COMMON_MEDICAL_ALERTS = [
  'حساسية بنسلين',
  'حساسية مخدر موضعي',
  'حساسية لاتكس',
  'سيولة دم / مميعات',
  'سكري',
  'ضغط دم',
  'حمل',
  'أمراض قلب',
  'ربو',
]

interface Props {
  alerts: string[]
  onAlertsChange: (alerts: string[]) => void
  notes: string
  onNotesChange: (notes: string) => void
}

export default function MedicalHistoryField({ alerts, onAlertsChange, notes, onNotesChange }: Props) {
  function toggle(tag: string) {
    onAlertsChange(alerts.includes(tag) ? alerts.filter((a) => a !== tag) : [...alerts, tag])
  }

  return (
    <div className="col-span-2">
      <label className="mb-1 block text-sm text-muted">التاريخ الطبي والحساسيات</label>
      <div className="flex flex-wrap gap-2">
        {COMMON_MEDICAL_ALERTS.map((tag) => (
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
