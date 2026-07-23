import { useEffect, useMemo, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPen, faTrash } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import {
  LOWER_ARCH,
  LOWER_PERMANENT,
  LOWER_PRIMARY,
  STATUS_COLOR,
  UPPER_ARCH,
  UPPER_PERMANENT,
  UPPER_PRIMARY,
  VIEWBOX,
  archPosition,
  cuspPositions,
  primaryCanonicalIndex,
  toothCrownPath,
  toothShapeType,
  toothSize,
  type ArchConfig,
} from '../lib/dental'
import type { Doctor, Service, ToothFinding, ToothState, Visit } from '../types'

interface Props {
  patientId: number
  isChild: boolean
  toothStates: ToothState[]
  toothFindings: ToothFinding[]
  services: Service[]
  doctors: Doctor[]
  onChanged: () => void
  /** When set, teeth are picked (possibly several at once) instead of opening the finding editor — used to fill a treatment-plan item's tooth number(s) from the chart. */
  pickMode?: boolean
  onPickTooth?: (toothNumbers: number[]) => void
  /** Tooth numbers that already have an item on a draft/approved treatment plan, mapped to a short description of what — surfaced so a second plan isn't accidentally created for the same tooth. */
  busyToothNumbers?: Map<number, string[]>
}

interface LaidOutTooth {
  number: number
  isPrimary: boolean
  x: number
  y: number
  rotationDeg: number
  crownPath: string
  cusps: { x: number; y: number; r: number }[]
  labelX: number
  labelY: number
}

function layoutArch(numbers: number[], primaryNumbers: number[], isChild: boolean, arch: ArchConfig): LaidOutTooth[] {
  // A child with only primary dentition has no molars/premolars/wisdom teeth
  // erupted yet, so their chart shows just the 10 real primary tooth numbers
  // per arch — not a mix of primary teeth plus fabricated permanent numbers
  // (16/17/18 etc.) for teeth that don't exist yet.
  const list = isChild ? primaryNumbers : numbers

  return list.map((number, i) => {
    const isPrimary = number >= 51
    // Primary teeth sit at the canonical slot their permanent successor
    // would occupy (out of the full 16-slot arch) instead of being spread
    // evenly across the whole arc — a child's arch is anatomically shorter
    // since the back molar slots have nothing erupted into them yet.
    const pos = isPrimary ? archPosition(primaryCanonicalIndex(number), 16, arch) : archPosition(i, list.length, arch)
    const type = toothShapeType(number, isPrimary)
    const { w, h } = toothSize(type, isPrimary)

    return {
      number,
      isPrimary,
      x: pos.x,
      y: pos.y,
      rotationDeg: pos.rotationDeg,
      crownPath: toothCrownPath(type, w, h),
      cusps: cuspPositions(type, w, h),
      labelX: pos.labelX,
      labelY: pos.labelY,
    }
  })
}

export default function ToothChart({ patientId, isChild, toothStates, toothFindings, services, doctors, onChanged, pickMode = false, onPickTooth, busyToothNumbers }: Props) {
  const { can } = useAuth()
  const [selectedTeeth, setSelectedTeeth] = useState<number[]>([])
  const [multiSelect, setMultiSelect] = useState(false)
  const [status, setStatus] = useState<'planned' | 'in_progress' | 'done'>('planned')
  const [markMissing, setMarkMissing] = useState(false)
  const [performedExternally, setPerformedExternally] = useState(false)
  const [linkedSessionId, setLinkedSessionId] = useState<string>('')
  const [serviceId, setServiceId] = useState<string>('')
  const [doctorId, setDoctorId] = useState<string>('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [externalNoteOpen, setExternalNoteOpen] = useState(false)
  const [externalNote, setExternalNote] = useState('')
  const [savingExternalNote, setSavingExternalNote] = useState(false)
  const [editingFindingId, setEditingFindingId] = useState<number | null>(null)
  const [visits, setVisits] = useState<Visit[]>([])

  useEffect(() => {
    api.get(`/patients/${patientId}/visits`).then((res) => setVisits(res.data))
  }, [patientId])

  const stateByTooth = useMemo(() => {
    const map = new Map<number, string>()
    toothStates.forEach((s) => map.set(s.tooth_number, s.status))
    return map
  }, [toothStates])

  const activeFindingByTooth = useMemo(() => {
    const map = new Map<number, ToothFinding>()
    // A tooth's color reflects the latest actual clinical work on it (a
    // finding tied to a service), never a free-text note (general note, or
    // "busy at another clinic") — otherwise jotting down an unrelated note
    // after the real work is done would hijack the tooth's displayed status.
    // Findings are ordered newest-first from the API; keep the first
    // (latest) service-linked one per tooth.
    toothFindings.forEach((f) => {
      if (f.service_id && !map.has(f.tooth_number)) map.set(f.tooth_number, f)
    })
    return map
  }, [toothFindings])

  const teeth = useMemo(
    () => [
      ...layoutArch(UPPER_PERMANENT, UPPER_PRIMARY, isChild, UPPER_ARCH),
      ...layoutArch(LOWER_PERMANENT, LOWER_PRIMARY, isChild, LOWER_ARCH),
    ],
    [isChild]
  )

  function toothColor(tooth: number): string {
    if (stateByTooth.get(tooth) === 'missing') return STATUS_COLOR.missing
    const finding = activeFindingByTooth.get(tooth)
    if (finding && (finding.status === 'planned' || finding.status === 'in_progress')) return STATUS_COLOR.planned
    if (finding && finding.status === 'done') return STATUS_COLOR.done
    return '#fff8f0'
  }

  /** Teeth worked on by an outside party get a dashed ring instead of the usual solid one, layered on top of whatever status color already applies. */
  function performedExternallyFor(tooth: number): boolean {
    return activeFindingByTooth.get(tooth)?.performed_externally ?? false
  }

  function resetForm() {
    setStatus('planned')
    setMarkMissing(false)
    setPerformedExternally(false)
    setLinkedSessionId('')
    setServiceId('')
    setDoctorId('')
    setNote('')
    setError(null)
    setEditingFindingId(null)
  }

  function openTooth(tooth: number) {
    if (pickMode || multiSelect) {
      setSelectedTeeth((prev) => (prev.includes(tooth) ? prev.filter((n) => n !== tooth) : [...prev, tooth]))
      return
    }
    setSelectedTeeth([tooth])
    resetForm()
  }

  function editFinding(f: ToothFinding) {
    setSelectedTeeth([f.tooth_number])
    setStatus(f.status)
    setMarkMissing(f.marks_missing)
    setPerformedExternally(f.performed_externally)
    setLinkedSessionId(f.plan_item_session_id ? String(f.plan_item_session_id) : '')
    setServiceId(f.service_id ? String(f.service_id) : '')
    setDoctorId(f.doctor_id ? String(f.doctor_id) : '')
    setNote(f.note ?? '')
    setError(null)
    setEditingFindingId(f.id)
  }

  async function deleteFinding(findingId: number) {
    if (!window.confirm('حذف هذا السجل نهائياً؟')) return
    await api.delete(`/patients/${patientId}/chart/findings/${findingId}`)
    if (editingFindingId === findingId) resetForm()
    onChanged()
  }

  function confirmPick() {
    if (selectedTeeth.length === 0) return
    onPickTooth?.(selectedTeeth)
    setSelectedTeeth([])
  }

  function selectAll() {
    setMultiSelect(true)
    setSelectedTeeth(teeth.filter((t) => stateByTooth.get(t.number) !== 'missing').map((t) => t.number))
    resetForm()
  }

  function selectArch(archTeeth: number[]) {
    setMultiSelect(true)
    setSelectedTeeth(archTeeth.filter((n) => teeth.some((t) => t.number === n) && stateByTooth.get(n) !== 'missing'))
    resetForm()
  }

  function clearSelection() {
    setMultiSelect(false)
    setSelectedTeeth([])
  }

  async function saveFinding() {
    if (selectedTeeth.length === 0) return
    setSaving(true)
    setError(null)
    try {
      if (editingFindingId) {
        await api.patch(`/patients/${patientId}/chart/findings/${editingFindingId}`, {
          status,
          note: note || null,
          marks_missing: markMissing,
          performed_externally: performedExternally,
          doctor_id: doctorId || null,
          plan_item_session_id: linkedSessionId || null,
        })
      } else {
        const findingType = serviceId ? services.find((s) => String(s.id) === serviceId)?.name ?? 'ملاحظة' : 'ملاحظة'
        for (const tooth of selectedTeeth) {
          await api.post(`/patients/${patientId}/chart/findings`, {
            tooth_number: tooth,
            finding_type: findingType,
            status,
            marks_missing: markMissing,
            performed_externally: performedExternally,
            plan_item_session_id: linkedSessionId || null,
            service_id: serviceId || null,
            doctor_id: doctorId || null,
            note: note || null,
          })
        }
      }
      clearSelection()
      onChanged()
    } catch {
      setError('تعذّر الحفظ. تحقق من الحقول.')
    } finally {
      setSaving(false)
    }
  }

  const canManage = can('dental_chart.manage')
  const singleSelectedTooth = selectedTeeth.length === 1 ? selectedTeeth[0] : null
  const history = singleSelectedTooth ? toothFindings.filter((f) => f.tooth_number === singleSelectedTooth) : []

  async function saveExternalNote() {
    if (!singleSelectedTooth || !externalNote.trim()) return
    setSavingExternalNote(true)
    try {
      await api.post(`/patients/${patientId}/chart/findings`, {
        tooth_number: singleSelectedTooth,
        finding_type: 'ملاحظة: عيادة أخرى',
        status: 'planned',
        note: externalNote,
      })
      setExternalNote('')
      setExternalNoteOpen(false)
      onChanged()
    } finally {
      setSavingExternalNote(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 2xl:flex-row">
      <div className="min-w-0 flex-1 rounded-xl bg-white p-4 shadow-sm">
        {pickMode && (
          <p className="mb-3 rounded-lg bg-accent/10 px-3 py-2 text-center text-xs font-medium text-accent">
            اضغط على الأسنان المطلوبة (تقدر تحدد أكتر من سن)، وبعدين "تأكيد الاختيار"
          </p>
        )}

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={selectAll} className="rounded-lg border border-ink/10 px-2.5 py-1 text-xs text-ink/70 hover:border-accent hover:text-accent">
            تحديد الكل
          </button>
          <button
            type="button"
            onClick={() => selectArch(isChild ? UPPER_PRIMARY : UPPER_PERMANENT)}
            className="rounded-lg border border-ink/10 px-2.5 py-1 text-xs text-ink/70 hover:border-accent hover:text-accent"
          >
            النصف العلوي
          </button>
          <button
            type="button"
            onClick={() => selectArch(isChild ? LOWER_PRIMARY : LOWER_PERMANENT)}
            className="rounded-lg border border-ink/10 px-2.5 py-1 text-xs text-ink/70 hover:border-accent hover:text-accent"
          >
            النصف السفلي
          </button>
          {selectedTeeth.length > 0 && (
            <button type="button" onClick={clearSelection} className="rounded-lg border border-danger/20 px-2.5 py-1 text-xs text-danger/70 hover:border-danger hover:text-danger">
              مسح التحديد
            </button>
          )}
          {pickMode && selectedTeeth.length > 0 && (
            <button type="button" onClick={confirmPick} className="rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-hover">
              تأكيد الاختيار ({selectedTeeth.length})
            </button>
          )}
        </div>
        <svg viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`} className="w-full" style={{ maxWidth: 720 }}>
          <line
            x1={40}
            y1={VIEWBOX.height / 2}
            x2={VIEWBOX.width - 40}
            y2={VIEWBOX.height / 2}
            stroke="#e2e8f0"
            strokeDasharray="4 4"
          />
          <line x1={UPPER_ARCH.cx} y1={20} x2={UPPER_ARCH.cx} y2={VIEWBOX.height - 20} stroke="#e2e8f0" strokeDasharray="4 4" />

          {teeth.map((t) => (
            <g key={t.number} onClick={() => openTooth(t.number)} className="cursor-pointer">
              <g transform={`translate(${t.x},${t.y}) rotate(${t.rotationDeg})`}>
                <path
                  d={t.crownPath}
                  fill={toothColor(t.number)}
                  stroke={selectedTeeth.includes(t.number) ? 'var(--color-accent)' : '#c9b8a8'}
                  strokeWidth={selectedTeeth.includes(t.number) ? 2.5 : 1.2}
                  strokeDasharray={performedExternallyFor(t.number) ? '3 2' : undefined}
                />
                {t.cusps.map((c, i) => (
                  <circle key={i} cx={c.x} cy={c.y} r={c.r} fill="#00000010" />
                ))}
              </g>
              {/* Label is positioned in absolute chart coordinates (not inside the rotated
                  group) so it always sits cleanly outside the ring, regardless of this
                  tooth's rotation — prevents labels clustering/overlapping at the apex
                  and sides. */}
              <text
                x={t.labelX}
                y={t.labelY}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize="10"
                fill="var(--color-ink)"
                className="select-none"
              >
                {t.number}
              </text>
            </g>
          ))}
        </svg>

        <div className="mt-4 flex gap-4 text-xs text-ink/60">
          <span className="flex items-center gap-1">
            <span className="inline-block size-3 rounded" style={{ background: STATUS_COLOR.planned }} /> مخطط
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block size-3 rounded" style={{ background: STATUS_COLOR.done }} /> منجز
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block size-3 rounded" style={{ background: STATUS_COLOR.missing }} /> مفقود
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block size-3 rounded border border-dashed border-ink/50" /> طرف خارجي
          </span>
        </div>
      </div>

      {selectedTeeth.length > 0 && (
        <div className="w-full shrink-0 rounded-xl bg-white p-4 shadow-sm 2xl:w-72">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-medium text-ink">
              {singleSelectedTooth ? `السن ${singleSelectedTooth}` : `${selectedTeeth.length} سن محدد`}
            </h3>
            <button onClick={clearSelection} className="text-sm text-ink/50 hover:text-ink">
              إغلاق
            </button>
          </div>

          {!singleSelectedTooth && (
            <p className="mb-3 text-xs text-ink/50">
              {selectedTeeth.slice().sort((a, b) => a - b).join('، ')}
            </p>
          )}

          {singleSelectedTooth && busyToothNumbers?.has(singleSelectedTooth) && (
            <div className="mb-3 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
              <p className="font-medium">⚠ هذا السن مشغول بخطة علاج قائمة:</p>
              <ul className="mt-1 list-inside list-disc">
                {busyToothNumbers.get(singleSelectedTooth)!.map((detail, i) => (
                  <li key={i}>{detail}</li>
                ))}
              </ul>
            </div>
          )}

          {pickMode && (
            <p className="mb-3 text-xs text-ink/50">
              اضغط "تأكيد الاختيار" فوق الرسمة لإدخال الأسنان المحددة بخطة العلاج.
            </p>
          )}

          {singleSelectedTooth && (
            <div className="mb-4">
              <h4 className="mb-2 text-xs font-medium text-ink/60">السجل</h4>
              {history.length === 0 ? (
                <p className="text-xs text-ink/40">لا يوجد سجل لهذا السن.</p>
              ) : (
                <ul className="space-y-2">
                  {history.map((f) => (
                    <li key={f.id} className="flex items-start justify-between gap-2 text-xs text-ink/70">
                      <span>
                        <span className="font-medium text-ink">{f.finding_type}</span>
                        {' — '}
                        {STATUS_LABEL[f.status]}
                        {f.performed_externally && <span className="text-warning"> — طرف خارجي</span>}
                        {' — '}
                        {f.doctor_name ?? 'طبيب عام'} — {f.recorded_at}
                        {f.note && <p className="mt-0.5 text-ink/50">{f.note}</p>}
                      </span>
                      {canManage && (
                        <span className="flex shrink-0 gap-2">
                          <button onClick={() => editFinding(f)} className="text-ink/40 hover:text-accent">
                            <FontAwesomeIcon icon={faPen} />
                          </button>
                          <button onClick={() => deleteFinding(f.id)} className="text-ink/40 hover:text-danger">
                            <FontAwesomeIcon icon={faTrash} />
                          </button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {!pickMode && canManage && (
            <>
              <label className="mb-1 block text-xs text-ink/60">الحالة</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as typeof status)}
                className="mb-3 w-full rounded-lg border border-ink/10 px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
              >
                <option value="planned">مخطط</option>
                <option value="in_progress">قيد التنفيذ</option>
                <option value="done">منجز</option>
              </select>

              <label className="mb-3 flex items-center gap-2 text-xs text-ink/70">
                <input type="checkbox" checked={markMissing} onChange={(e) => setMarkMissing(e.target.checked)} className="size-3.5" />
                هذا السن مفقود (خلع، سقوط، أو غير موجود من الأساس) — بيصير مستثنى من "تحديد الكل/النصف" لاحقاً
              </label>

              <label className="mb-3 flex items-center gap-2 text-xs text-ink/70">
                <input type="checkbox" checked={performedExternally} onChange={(e) => setPerformedExternally(e.target.checked)} className="size-3.5" />
                اشتغل عليه طرف خارجي (مو إحنا) — بيتحدد بخط منقّط عالرسمة
              </label>

              {editingFindingId === null && singleSelectedTooth && (
                <>
                  <label className="mb-1 block text-xs text-ink/60">اربط بجلسة موجودة (اختياري)</label>
                  <select
                    value={linkedSessionId}
                    onChange={(e) => setLinkedSessionId(e.target.value)}
                    className="mb-3 w-full rounded-lg border border-ink/10 px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
                  >
                    <option value="">بدون ربط</option>
                    {visits
                      .filter((v) => v.tooth_number === singleSelectedTooth)
                      .map((v) => (
                        <option key={v.session_id} value={v.session_id}>
                          {v.service_name} — {v.date} — {v.price} ₪
                        </option>
                      ))}
                  </select>
                </>
              )}

              <label className="mb-1 block text-xs text-ink/60">الخدمة المرتبطة (اختياري)</label>
              <select
                value={serviceId}
                onChange={(e) => setServiceId(e.target.value)}
                disabled={editingFindingId !== null}
                className="mb-3 w-full rounded-lg border border-ink/10 px-2 py-1.5 text-sm focus:border-accent focus:outline-none disabled:opacity-50"
              >
                <option value="">بدون</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>

              <label className="mb-1 block text-xs text-ink/60">الطبيب المعالج (اختياري — لازم لاحتساب العمولة)</label>
              <select
                value={doctorId}
                onChange={(e) => setDoctorId(e.target.value)}
                className="mb-3 w-full rounded-lg border border-ink/10 px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
              >
                <option value="">بدون طبيب محدد</option>
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.full_name}
                  </option>
                ))}
              </select>

              <label className="mb-1 block text-xs text-ink/60">ملاحظة</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="mb-3 w-full rounded-lg border border-ink/10 px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
              />

              {error && <p className="mb-2 text-xs text-danger">{error}</p>}

              <div className="flex gap-2">
                <button
                  onClick={saveFinding}
                  disabled={saving}
                  className="flex-1 rounded-lg bg-accent py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
                >
                  {saving ? 'جارِ الحفظ...' : editingFindingId ? 'تحديث' : singleSelectedTooth ? 'حفظ' : `حفظ لـ${selectedTeeth.length} سن`}
                </button>
                {editingFindingId && (
                  <button onClick={resetForm} className="rounded-lg border border-ink/10 px-3 py-2 text-sm text-ink/60 hover:bg-background">
                    إلغاء
                  </button>
                )}
              </div>
            </>
          )}

          {!pickMode && singleSelectedTooth && canManage && (
            <div className="mt-3 border-t border-ink/10 pt-3">
              {!externalNoteOpen ? (
                <button
                  type="button"
                  onClick={() => setExternalNoteOpen(true)}
                  className="text-xs text-ink/50 underline hover:text-ink"
                >
                  + هذا السن مشغول بعيادة أخرى؟ أضف ملاحظة (اختياري)
                </button>
              ) : (
                <>
                  <label className="mb-1 block text-xs text-ink/60">تفاصيل (اسم العيادة، نوع العلاج...)</label>
                  <textarea
                    value={externalNote}
                    onChange={(e) => setExternalNote(e.target.value)}
                    rows={2}
                    className="mb-2 w-full rounded-lg border border-ink/10 px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
                  />
                  <button
                    onClick={saveExternalNote}
                    disabled={savingExternalNote || !externalNote.trim()}
                    className="w-full rounded-lg border border-ink/10 py-1.5 text-xs text-ink/70 hover:border-accent hover:text-accent disabled:opacity-60"
                  >
                    {savingExternalNote ? 'جارِ الحفظ...' : 'حفظ الملاحظة'}
                  </button>
                </>
              )}
            </div>
          )}

        </div>
      )}
    </div>
  )
}

const STATUS_LABEL: Record<'planned' | 'in_progress' | 'done', string> = {
  planned: 'مخطط',
  in_progress: 'قيد التنفيذ',
  done: 'منجز',
}
