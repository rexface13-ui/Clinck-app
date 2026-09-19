import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faBoxArchive, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { Modal, Button, SearchableSelect } from './ui'

interface Preview {
  is_archived: boolean
  balance_ils: number
  credit_ils: number
  debt_ils: number
  total_paid_ils: number
  upcoming_appointments: number
  open_work_items: number
  cashboxes: { id: number; name: string; balance: string }[]
}

type Resolution = 'keep' | 'refund' | 'keep_debt' | 'write_off'

function Choice({
  checked,
  onSelect,
  title,
  hint,
}: {
  checked: boolean
  onSelect: () => void
  title: string
  hint: string
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-xl border p-3 text-start transition-colors ${
        checked ? 'border-accent bg-accent-soft' : 'border-border bg-surface hover:bg-background'
      }`}
    >
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="mt-0.5 text-xs text-muted">{hint}</p>
    </button>
  )
}

export default function ArchivePatientModal({
  patientId,
  patientName,
  onClose,
  onArchived,
}: {
  patientId: number
  patientName: string
  onClose: () => void
  onArchived: () => void
}) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [resolution, setResolution] = useState<Resolution | null>(null)
  const [cashboxId, setCashboxId] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.get<Preview>(`/patients/${patientId}/archive-preview`).then((res) => setPreview(res.data))
  }, [patientId])

  const hasCredit = (preview?.credit_ils ?? 0) > 0
  const hasDebt = (preview?.debt_ils ?? 0) > 0
  const coveringCashboxes = (preview?.cashboxes ?? []).filter((c) => Number(c.balance) + 0.001 >= (preview?.credit_ils ?? 0))

  const needsChoice = hasCredit || hasDebt
  const ready =
    preview !== null &&
    (!needsChoice || (resolution !== null && (resolution !== 'refund' || cashboxId !== '')))

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      await api.post(`/patients/${patientId}/archive`, {
        resolution: needsChoice ? resolution : undefined,
        cashbox_id: resolution === 'refund' ? Number(cashboxId) : undefined,
        note: note.trim() || undefined,
      })
      onArchived()
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      setError(message ?? 'تعذّرت الأرشفة.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="أرشفة ملف المريض" onClose={onClose} width="w-[520px]">
      {preview === null ? (
        <p className="py-6 text-center text-sm text-muted">جارِ التحميل...</p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-ink/80">
            أرشفة ملف <span className="font-semibold text-ink">{patientName}</span> مش حذف: كل الزيارات والجلسات والدفعات بتضل محفوظة وبتضل
            بالتقارير، بس الملف بيختفي من القوائم. بتقدر ترجّعه من الأرشيف بأي وقت.
          </p>

          {preview.upcoming_appointments > 0 && (
            <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
              <FontAwesomeIcon icon={faTriangleExclamation} className="mt-0.5" />
              <span>عنده {preview.upcoming_appointments} موعد قادم لسا مجدول — رح يضل بالتقويم، راجعه قبل الأرشفة.</span>
            </div>
          )}
          {preview.open_work_items > 0 && (
            <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
              <FontAwesomeIcon icon={faTriangleExclamation} className="mt-0.5" />
              <span>عنده {preview.open_work_items} شغل لسا مش منجز.</span>
            </div>
          )}

          {hasCredit && (
            <div className="space-y-2">
              <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
                <FontAwesomeIcon icon={faTriangleExclamation} className="mt-0.5" />
                <span>
                  المريض دافع ومحسوب له <span className="font-semibold">{preview.credit_ils.toFixed(2)} ₪</span> عندنا (مبلغ مش مصروف على شغل). شو بدك نعمل فيه؟
                </span>
              </div>
              <Choice
                checked={resolution === 'keep'}
                onSelect={() => setResolution('keep')}
                title="نحتفظ بالمبلغ"
                hint="بيتسجّل إيراد للعيادة والمبلغ بيضل بالصندوق."
              />
              <Choice
                checked={resolution === 'refund'}
                onSelect={() => setResolution('refund')}
                title="نرجّع المبلغ للمريض"
                hint="بينسحب من الصندوق اللي بتختاره وبيتسجّل استرجاع بحسابه."
              />
              {resolution === 'refund' &&
                (coveringCashboxes.length === 0 ? (
                  <p className="text-xs text-danger">ما في صندوق شيكل رصيده بكفي لاسترجاع {preview.credit_ils.toFixed(2)} ₪.</p>
                ) : (
                  <SearchableSelect
                    options={coveringCashboxes.map((c) => ({ value: String(c.id), label: `${c.name} — الرصيد ${Number(c.balance).toFixed(2)} ₪` }))}
                    value={cashboxId}
                    onChange={setCashboxId}
                    placeholder="اختر الصندوق..."
                  />
                ))}
            </div>
          )}

          {hasDebt && (
            <div className="space-y-2">
              <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
                <FontAwesomeIcon icon={faTriangleExclamation} className="mt-0.5" />
                <span>
                  على المريض دين <span className="font-semibold">{preview.debt_ils.toFixed(2)} ₪</span>. شو بدك نعمل فيه؟
                </span>
              </div>
              <Choice
                checked={resolution === 'keep_debt'}
                onSelect={() => setResolution('keep_debt')}
                title="نخلّيه دين"
                hint="بيضل بدفتر الديون وبالتقارير، والملف مؤرشف."
              />
              <Choice
                checked={resolution === 'write_off'}
                onSelect={() => setResolution('write_off')}
                title="نعفيه من الدين"
                hint="بيتسجّل خصم بحسابه وبيصير الرصيد صفر."
              />
            </div>
          )}

          {!needsChoice && preview.total_paid_ils > 0 && (
            <p className="rounded-xl bg-background px-3 py-2 text-xs text-muted">
              مجموع اللي دفعه المريض {preview.total_paid_ils.toFixed(2)} ₪ — كله مقابل شغل انعمل، ما في مبلغ معلّق.
            </p>
          )}

          <div>
            <label className="mb-1 block text-xs text-muted">سبب الأرشفة (اختياري)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-border bg-surface p-2 text-sm focus:border-accent focus:outline-none"
            />
          </div>

          {error && <p className="text-xs text-danger">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              إلغاء
            </Button>
            <Button variant="danger" onClick={submit} loading={saving} disabled={!ready}>
              <FontAwesomeIcon icon={faBoxArchive} />
              أرشفة الملف
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
