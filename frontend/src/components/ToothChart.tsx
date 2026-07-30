import { useMemo, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPen, faTrash, faNoteSticky, faPlay } from '@fortawesome/free-solid-svg-icons'
import { Odontogram } from 'react-odontogram'
import 'react-odontogram/style.css'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import ToothNotesModal from './ToothNotesModal'
import {
  OdontogramBridgeOverlay,
  OdontogramClickOverlay,
  OdontogramMarkerOverlay,
  OdontogramNumberOverlay,
  OdontogramSelectionOverlay,
  useOdontogramGeometry,
  type ToothMarker,
} from './OdontogramNumbers'
import {
  DEFAULT_TOOTH_FILL,
  LOWER_PERMANENT,
  LOWER_PRIMARY,
  STATUS_COLOR,
  UPPER_PERMANENT,
  UPPER_PRIMARY,
  fadeHex,
  toLibraryToothId,
} from '../lib/dental'
import type { Doctor, Note, Service, ToothFinding, ToothState } from '../types'

/**
 * Primary dentition only has 5 teeth per quadrant, but the library's
 * circular layout always reserves 8 slots per quadrant (the geometry
 * itself doesn't shrink to fit fewer teeth — using `maxTeeth` to slice
 * to 5 just leaves the missing slots as visual gaps, disconnecting the
 * ring). So a child's chart renders the full 8 slots and mutes the 3
 * that have no real tooth behind them (positions 6-8 of each quadrant)
 * instead — same continuous ring, with the "not applicable" slots
 * visually flagged and not interactive.
 */
const CHILD_PHANTOM_LIBRARY_IDS = [16, 17, 18, 26, 27, 28, 36, 37, 38, 46, 47, 48].map((n) => `teeth-${n}`)

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
  /** Per-tooth notebook entries — same patient notes list the "الملاحظات" tab uses, just scoped here to whichever tooth is selected. */
  notes?: Note[]
  /** Jumps to the Work tab with these teeth pre-selected, ready to start work — skips the manual re-select-then-switch-tabs round trip. */
  onStartWork?: (toothNumbers: number[]) => void
}

export default function ToothChart({
  patientId,
  isChild,
  toothStates,
  toothFindings,
  onChanged,
  pickMode = false,
  onPickTooth,
  busyToothNumbers,
  notes = [],
  onStartWork,
}: Props) {
  const { can } = useAuth()
  const containerRef = useRef<HTMLDivElement>(null)
  const toothNumbers = isChild ? [...UPPER_PRIMARY, ...LOWER_PRIMARY] : [...UPPER_PERMANENT, ...LOWER_PERMANENT]
  const toLibraryId = isChild ? toLibraryToothId : (n: number) => `teeth-${n}`
  const [selectedTeeth, setSelectedTeeth] = useState<number[]>([])
  // Odontogram (the realistic-tooth library) manages its own selection
  // internally after mount — the only way to push OUR selection changes
  // (select-all, clear, edit-from-history...) back into it is to force a
  // remount with a fresh `defaultSelected`. Clicks the library reports via
  // its own onChange don't need this — they already match.
  const [chartKey, setChartKey] = useState(0)
  function setSelection(next: number[]) {
    setSelectedTeeth(next)
    setChartKey((k) => k + 1)
  }
  const [multiSelect, setMultiSelect] = useState(false)
  const [markMissing, setMarkMissing] = useState(false)
  const [performedExternally, setPerformedExternally] = useState(false)
  const [markDecay, setMarkDecay] = useState(false)
  const [notesToothNumber, setNotesToothNumber] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingFindingId, setEditingFindingId] = useState<number | null>(null)
  const [editingFinding, setEditingFinding] = useState<ToothFinding | null>(null)
  const [editStatus, setEditStatus] = useState<'planned' | 'in_progress' | 'done'>('done')

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

  function toothColor(tooth: number): string {
    if (stateByTooth.get(tooth) === 'missing') return STATUS_COLOR.missing
    const finding = activeFindingByTooth.get(tooth)
    if (!finding) return DEFAULT_TOOTH_FILL
    // A bridge/appliance tooth stays plain — the connecting line (see
    // OdontogramBridgeOverlay) is what marks it as part of the bridge,
    // filling every tooth's crown with the service color too was too much.
    if (finding.service_spans_teeth) return DEFAULT_TOOTH_FILL
    // A service's own color is the primary signal once one's assigned — it's
    // what lets the same chart tell a filling apart from a cleaning at a
    // glance. Falls back to the old generic planned/done colors for
    // services that never got a color (or free-text findings).
    if (finding.service_color) {
      const done = finding.status === 'done'
      return done ? finding.service_color : fadeHex(finding.service_color, 0.55)
    }
    if (finding.status === 'planned' || finding.status === 'in_progress') return STATUS_COLOR.planned
    return STATUS_COLOR.done
  }

  /** Teeth worked on by an outside party get a distinct outline color, layered on top of whatever status color already applies (the library has no dashed-ring equivalent). */
  function performedExternallyFor(tooth: number): boolean {
    return activeFindingByTooth.get(tooth)?.performed_externally ?? false
  }

  /**
   * Decay is a free-standing note (finding_type === 'تسوس'), not tied to a
   * service, so it isn't necessarily the "active" (latest service-linked)
   * finding — check every finding on the tooth, newest first.
   */
  const decayTeeth = useMemo(() => {
    const set = new Set<number>()
    for (const f of toothFindings) {
      if (f.finding_type === 'تسوس') set.add(f.tooth_number)
    }
    return set
  }, [toothFindings])

  /** Small on-tooth icon markers: a filling dot for a service whose name says so, a decay spot for anything flagged as such — independent of (and layered on top of) the tooth's overall fill color. A tooth can carry both at once (e.g. a filled tooth that later got a decay note too). */
  const markers = useMemo(() => {
    const map = new Map<number, ToothMarker[]>()
    for (const n of toothNumbers) {
      const list: ToothMarker[] = []
      const finding = activeFindingByTooth.get(n)
      if (finding?.service_name?.includes('حشوة')) list.push('filling')
      if (decayTeeth.has(n)) list.push('decay')
      if (list.length) map.set(n, list)
    }
    return map
  }, [toothNumbers, decayTeeth, activeFindingByTooth])

  function resetForm() {
    setMarkMissing(false)
    setPerformedExternally(false)
    setMarkDecay(false)
    setError(null)
    setEditingFindingId(null)
    setEditingFinding(null)
  }

  function editFinding(f: ToothFinding) {
    setSelection([f.tooth_number])
    setMarkMissing(f.marks_missing)
    setPerformedExternally(f.performed_externally)
    setMarkDecay(f.finding_type === 'تسوس')
    setError(null)
    setEditingFindingId(f.id)
    setEditingFinding(f)
    setEditStatus(f.status)
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
    setSelection([])
  }

  function selectAll() {
    setMultiSelect(true)
    setSelection(toothNumbers.filter((n) => stateByTooth.get(n) !== 'missing'))
    resetForm()
  }

  function selectArch(archTeeth: number[]) {
    setMultiSelect(true)
    setSelection(archTeeth.filter((n) => toothNumbers.includes(n) && stateByTooth.get(n) !== 'missing'))
    resetForm()
  }

  function clearSelection() {
    setMultiSelect(false)
    setSelection([])
  }

  /**
   * The library's own click reporting is unreliable near the midline —
   * confirmed by direct testing: a click squarely inside tooth 21's own
   * measured bounding box registered as tooth 11 instead (its hand-drawn
   * crown paths overlap their neighbors more than their bbox suggests).
   * Clicks are handled entirely by our own OdontogramClickOverlay instead
   * (built from the same measured centers the number labels use), so
   * "which tooth did I click" is always consistent with "which tooth is
   * that number sitting on". The library is only used for the background
   * art and fill colors now, not for selection.
   */
  function handleToothClick(n: number) {
    if (pickMode || multiSelect) {
      setSelection(selectedTeeth.includes(n) ? selectedTeeth.filter((x) => x !== n) : [...selectedTeeth, n])
    } else {
      setSelection([n])
      resetForm()
    }
  }

  /**
   * Bridge-style services (spans_teeth) get a connecting bar drawn across
   * their teeth instead of (or alongside) each tooth's own crown color —
   * grouped by (work item, service) so only teeth actually placed together
   * under the same bridge/appliance connect, not any two teeth that happen
   * to share a service.
   */
  const bridgeGroups = useMemo(() => {
    const groups = new Map<string, { color: string; done: boolean; teeth: number[] }>()
    toothFindings.forEach((f) => {
      if (!f.service_spans_teeth || !f.service_id) return
      const key = `${f.plan_id ?? 'x'}-${f.service_id}`
      const g = groups.get(key)
      if (g) {
        g.teeth.push(f.tooth_number)
        g.done = g.done && f.status === 'done'
      } else {
        groups.set(key, { color: f.service_color ?? STATUS_COLOR.done, done: f.status === 'done', teeth: [f.tooth_number] })
      }
    })
    return Array.from(groups.values()).filter((g) => g.teeth.length > 1)
  }, [toothFindings])

  /**
   * Legend mapping each service's own color to its name, built only from
   * services actually present on this patient's chart right now (not the
   * full services catalog) so the legend stays short and relevant.
   */
  const serviceColorLegend = useMemo(() => {
    const map = new Map<string, string>()
    for (const f of toothFindings) {
      if (f.service_id && f.service_color && f.service_name && !map.has(f.service_color)) {
        map.set(f.service_color, f.service_name)
      }
    }
    return Array.from(map.entries()).map(([color, name]) => ({ color, name }))
  }, [toothFindings])

  /**
   * One condition group per distinct color actually in use, plus a
   * separate outline color for externally-performed work (no dashed-ring
   * equivalent in the library, so a distinct outline is the closest cue),
   * plus (children only) a muted group for the phantom slots.
   */
  const teethConditions = useMemo(() => {
    const groups = new Map<string, { fillColor: string; outlineColor: string; teeth: string[] }>()
    for (const n of toothNumbers) {
      const color = toothColor(n)
      if (color === DEFAULT_TOOTH_FILL) continue
      const dashed = performedExternallyFor(n)
      const key = `${color}|${dashed}`
      const g = groups.get(key)
      if (g) g.teeth.push(toLibraryId(n))
      else groups.set(key, { fillColor: color, outlineColor: dashed ? 'var(--color-tooth-planned)' : color, teeth: [toLibraryId(n)] })
    }
    const result = Array.from(groups.entries()).map(([key, g]) => ({ label: key, ...g }))
    if (isChild) result.push({ label: 'phantom', fillColor: '#e5e7eb', outlineColor: '#d1d5db', teeth: CHILD_PHANTOM_LIBRARY_IDS })
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateByTooth, activeFindingByTooth, isChild])

  async function saveFinding() {
    if (selectedTeeth.length === 0) return
    setSaving(true)
    setError(null)
    try {
      if (editingFindingId) {
        const isSession = !!editingFinding?.work_item_tooth_step_id
        await api.patch(`/patients/${patientId}/chart/findings/${editingFindingId}`, {
          marks_missing: markMissing,
          performed_externally: performedExternally,
          // Session-linked findings keep the service's own finding_type
          // (e.g. "حشوة أسنان") — only a free-standing note can be
          // relabeled as decay.
          ...(isSession ? {} : { finding_type: markDecay ? 'تسوس' : 'ملاحظة' }),
          ...(isSession ? { status: editStatus } : {}),
        })
      } else {
        for (const tooth of selectedTeeth) {
          await api.post(`/patients/${patientId}/chart/findings`, {
            tooth_number: tooth,
            finding_type: markDecay ? 'تسوس' : 'ملاحظة',
            status: 'done',
            marks_missing: markMissing,
            performed_externally: performedExternally,
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

  const geometry = useOdontogramGeometry(containerRef, toothNumbers, toLibraryId, [chartKey, isChild])

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
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
        <div ref={containerRef} className="relative mx-auto" style={{ maxWidth: 460 }}>
          <Odontogram
            key={chartKey}
            layout="circle"
            notation="FDI"
            maxTeeth={8}
            defaultSelected={selectedTeeth.map(toLibraryId)}
            singleSelect={!pickMode && !multiSelect}
            onChange={() => {}}
            teethConditions={teethConditions}
            showLabels={false}
            // The library's own "selected" tint (lightBlue) is driven by
            // its own internal click state, which we've stopped trusting
            // (see handleToothClick) — transparent here so it can't show a
            // stale highlight that contradicts our own selection ring.
            colors={{ darkBlue: 'var(--color-accent)', baseBlue: '#c9b8a8', lightBlue: 'transparent' }}
          />
          {geometry && <OdontogramBridgeOverlay geometry={geometry} groups={bridgeGroups} />}
          {geometry && <OdontogramMarkerOverlay geometry={geometry} markers={markers} />}
          {geometry && <OdontogramSelectionOverlay geometry={geometry} selected={selectedTeeth} />}
          {geometry && <OdontogramNumberOverlay geometry={geometry} toothNumbers={toothNumbers} />}
          {geometry && (
            <OdontogramClickOverlay
              geometry={geometry}
              toothNumbers={toothNumbers.filter((n) => stateByTooth.get(n) !== 'missing' || pickMode || multiSelect)}
              onSelect={handleToothClick}
            />
          )}
        </div>

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
          <span className="flex items-center gap-1">
            <span className="inline-block size-2.5 rounded-full" style={{ background: '#6b8cae' }} /> حشوة
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block size-2.5 rounded-full" style={{ background: '#5b3a29' }} /> تسوس
          </span>
        </div>

        {serviceColorLegend.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-3 border-t border-ink/10 pt-3 text-xs text-ink/60">
            {serviceColorLegend.map(({ color, name }) => (
              <span key={color} className="flex items-center gap-1">
                <span className="inline-block size-3 rounded" style={{ background: color }} /> {name}
              </span>
            ))}
          </div>
        )}
      </div>

      {selectedTeeth.length > 0 && (
        <div className="w-full shrink-0 rounded-xl bg-white p-4 shadow-sm lg:w-72">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium text-ink">
                {singleSelectedTooth ? `السن ${singleSelectedTooth}` : `${selectedTeeth.length} سن محدد`}
              </h3>
              {singleSelectedTooth && (
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
                  style={{ background: toothColor(singleSelectedTooth) }}
                >
                  {stateByTooth.get(singleSelectedTooth) === 'missing'
                    ? 'مفقود'
                    : activeFindingByTooth.has(singleSelectedTooth)
                      ? STATUS_LABEL[activeFindingByTooth.get(singleSelectedTooth)!.status]
                      : 'لا يوجد سجل'}
                </span>
              )}
            </div>
            <button onClick={clearSelection} className="text-sm text-ink/50 hover:text-ink">
              إغلاق
            </button>
          </div>

          {singleSelectedTooth && !pickMode && (
            <div className="mb-3 flex flex-wrap gap-2">
              <button
                onClick={() => setNotesToothNumber(singleSelectedTooth)}
                className="flex items-center gap-1.5 rounded-lg bg-accent-soft px-2.5 py-1.5 text-xs font-medium text-accent hover:opacity-80"
              >
                <FontAwesomeIcon icon={faNoteSticky} />
                دفتر الملاحظات
                {notes.filter((n) => n.tooth_number === singleSelectedTooth).length > 0 && (
                  <span className="rounded-full bg-accent px-1.5 text-[10px] text-white">
                    {notes.filter((n) => n.tooth_number === singleSelectedTooth).length}
                  </span>
                )}
              </button>
              {onStartWork && (
                <button
                  onClick={() => onStartWork(selectedTeeth)}
                  className="flex items-center gap-1.5 rounded-lg bg-success-soft px-2.5 py-1.5 text-xs font-medium text-success hover:opacity-80"
                >
                  <FontAwesomeIcon icon={faPlay} />
                  بدء العمل
                </button>
              )}
            </div>
          )}
          {!singleSelectedTooth && selectedTeeth.length > 0 && onStartWork && !pickMode && (
            <button
              onClick={() => onStartWork(selectedTeeth)}
              className="mb-3 flex items-center gap-1.5 rounded-lg bg-success-soft px-2.5 py-1.5 text-xs font-medium text-success hover:opacity-80"
            >
              <FontAwesomeIcon icon={faPlay} />
              بدء العمل على ({selectedTeeth.length}) سن
            </button>
          )}

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
                        {/* status (مخطط/قيد التنفيذ/منجز) only makes sense for
                            an actual service/session — a plain note (decay
                            flag, missing-tooth flag...) isn't a treatment
                            step that gets "completed", so showing "منجز"
                            next to one reads as if it was treated. */}
                        {f.service_id && (
                          <>
                            {' — '}
                            {STATUS_LABEL[f.status]}
                          </>
                        )}
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
              {editingFinding?.work_item_tooth_step_id && (
                <div className="mb-3 rounded-lg bg-background p-2">
                  <p className="mb-2 text-xs font-medium text-ink/70">تعديل جلسة: {editingFinding.finding_type}</p>

                  <label className="mb-1 block text-xs text-ink/60">الحالة</label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as typeof editStatus)}
                    className="w-full rounded-lg border border-ink/10 px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
                  >
                    <option value="planned">مخطط</option>
                    <option value="in_progress">قيد التنفيذ</option>
                    <option value="done">منجز</option>
                  </select>
                </div>
              )}

              <label className="mb-3 flex items-center gap-2 text-xs text-ink/70">
                <input type="checkbox" checked={markMissing} onChange={(e) => setMarkMissing(e.target.checked)} className="size-3.5" />
                هذا السن مفقود (خلع، سقوط، أو غير موجود من الأساس) — بيصير مستثنى من "تحديد الكل/النصف" لاحقاً
              </label>

              <label className="mb-3 flex items-center gap-2 text-xs text-ink/70">
                <input type="checkbox" checked={performedExternally} onChange={(e) => setPerformedExternally(e.target.checked)} className="size-3.5" />
                اشتغل عليه طرف خارجي (مو إحنا، أو عيادة تانية) — بيتحدد بخط منقّط عالرسمة
              </label>

              {!editingFinding?.work_item_tooth_step_id && (
                <label className="mb-3 flex items-center gap-2 text-xs text-ink/70">
                  <input type="checkbox" checked={markDecay} onChange={(e) => setMarkDecay(e.target.checked)} className="size-3.5" />
                  في تسوس بهالسن — بتنحط علامة تسوس على الرسمة
                  {/* This checkbox is for a NEW note, so it doesn't preload
                      from existing findings — flag it here instead, so
                      "is this tooth already marked decayed" is visible
                      without having to scan the السجل list below. */}
                  {!editingFindingId && singleSelectedTooth && decayTeeth.has(singleSelectedTooth) && (
                    <span className="text-warning">(مسجّل مسبقاً بسجل السن)</span>
                  )}
                </label>
              )}

              {error && <p className="mb-2 text-xs text-danger">{error}</p>}

              <div className="flex gap-2">
                <button
                  onClick={saveFinding}
                  disabled={saving}
                  className="flex-1 rounded-lg bg-accent py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
                >
                  {saving ? 'جارِ الحفظ...' : editingFindingId ? 'تحديث' : `حفظ لـ${selectedTeeth.length} سن`}
                </button>
                {editingFindingId && (
                  <button onClick={resetForm} className="rounded-lg border border-ink/10 px-3 py-2 text-sm text-ink/60 hover:bg-background">
                    إلغاء
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {notesToothNumber !== null && (
        <ToothNotesModal
          patientId={patientId}
          toothNumber={notesToothNumber}
          notes={notes}
          onClose={() => setNotesToothNumber(null)}
          onChanged={onChanged}
        />
      )}
    </div>
  )
}

const STATUS_LABEL: Record<'planned' | 'in_progress' | 'done', string> = {
  planned: 'مخطط',
  in_progress: 'قيد التنفيذ',
  done: 'منجز',
}
