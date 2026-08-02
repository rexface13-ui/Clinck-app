import { useMemo, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPen, faTrash, faNoteSticky, faPlay, faFileInvoice } from '@fortawesome/free-solid-svg-icons'
import { Odontogram } from 'react-odontogram'
import 'react-odontogram/style.css'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import ToothNotesModal from './ToothNotesModal'
import InvoiceDetailModal from './InvoiceDetailModal'
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
import type { Doctor, Note, Service, ToothFinding, ToothState, WorkItem } from '../types'

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

/** Extra room reserved on each side of the chart for the worked-tooth callout labels. */
const SIDE_PAD = 130

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
  /** Every work item for this patient (any status) — drives the selected tooth's step-by-step session history and the "كم خطوة باقي" summary. */
  workItems?: WorkItem[]
  /** Jumps to the Work tab with these teeth pre-selected, ready to start work — skips the manual re-select-then-switch-tabs round trip. */
  onStartWork?: (toothNumbers: number[]) => void
}

export default function ToothChart({
  patientId,
  isChild,
  toothStates,
  toothFindings,
  services,
  onChanged,
  pickMode = false,
  onPickTooth,
  busyToothNumbers,
  notes = [],
  workItems = [],
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
  const [viewingInvoiceId, setViewingInvoiceId] = useState<number | null>(null)
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

  /** Legend mapping each active service's own color (from الخدمات) to its name — the full catalog, not just what happens to be on this patient's chart, so the same legend always means the same thing everywhere. */
  const serviceColorLegend = useMemo(
    () => services.filter((s) => s.is_active && s.color).map((s) => ({ color: s.color as string, name: s.name })),
    [services],
  )

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

  /**
   * Every step ever assigned to the selected tooth, across every (non-cancelled)
   * work item — the "كم خطوة منجزة، شو ضل" summary and the session-by-session
   * breakdown both come from here. Each row that was actually billed links to
   * its invoice, so a session can be opened straight into the edit form.
   */
  const toothStepRows = useMemo(() => {
    if (!singleSelectedTooth) return []
    const rows: { key: string; workItemId: number; serviceName: string | null; stepTitle: string; completed: boolean; completedAt: string | null; invoiceId: number | null }[] = []
    for (const wi of workItems) {
      if (wi.status === 'cancelled') continue
      for (const step of wi.steps) {
        for (const ts of step.tooth_steps) {
          if (ts.tooth_number !== singleSelectedTooth) continue
          rows.push({
            key: `${wi.id}-${ts.id}`,
            workItemId: wi.id,
            serviceName: wi.service_name,
            stepTitle: step.title,
            completed: ts.completed,
            completedAt: ts.completed_at,
            invoiceId: ts.invoice_id,
          })
        }
      }
    }
    return rows
  }, [workItems, singleSelectedTooth])

  const toothStepsCompleted = toothStepRows.filter((r) => r.completed).length
  const toothStepsTotal = toothStepRows.length

  /** Sessions = distinct invoices the tooth's steps were actually billed under, each with the steps billed in it — "أي جلسة اشتغلت فيها إيش". Not-yet-billed steps are grouped separately as the still-open work item. */
  const toothSessions = useMemo(() => {
    const byInvoice = new Map<number, typeof toothStepRows>()
    const pending: typeof toothStepRows = []
    for (const row of toothStepRows) {
      if (row.invoiceId) {
        if (!byInvoice.has(row.invoiceId)) byInvoice.set(row.invoiceId, [])
        byInvoice.get(row.invoiceId)!.push(row)
      } else {
        pending.push(row)
      }
    }
    return { byInvoice, pending }
  }, [toothStepRows])

  const geometry = useOdontogramGeometry(containerRef, toothNumbers, toLibraryId, [chartKey, isChild])

  const notesCountByTooth = useMemo(() => {
    const map = new Map<number, number>()
    notes.forEach((n) => {
      if (n.tooth_number === null) return
      map.set(n.tooth_number, (map.get(n.tooth_number) ?? 0) + 1)
    })
    return map
  }, [notes])

  /**
   * The general-overview ask: show what was done to a worked tooth right
   * on the chart, without clicking it. Every tooth with an active
   * (service-linked) finding — done or still planned — gets a short label
   * out in the side margin, connected back to the tooth by a line, sorted
   * top-to-bottom on whichever side it naturally sits. Clicking a label
   * opens that tooth's notebook directly.
   */
  const calloutTeeth = useMemo(() => {
    if (!geometry) return []
    const [, , w] = geometry.viewBox.split(' ').map(Number)
    return toothNumbers
      .map((n) => {
        const finding = activeFindingByTooth.get(n)
        if (!finding) return null
        const c = geometry.centers.get(n)
        if (!c) return null
        const label = (finding.service_name ?? finding.finding_type ?? '').slice(0, 16)
        if (!label) return null
        return { number: n, center: c, label, done: finding.status === 'done', side: c.x < w / 2 ? 'left' : 'right' } as const
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
  }, [geometry, toothNumbers, activeFindingByTooth])

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
        <div className="relative mx-auto" style={{ maxWidth: 460 + SIDE_PAD * 2 }}>
          <div ref={containerRef} className="relative mx-auto" style={{ width: 460 }}>
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

          {geometry && calloutTeeth.length > 0 && (
            <ToothCalloutOverlay
              geometry={geometry}
              teeth={calloutTeeth}
              notesCountByTooth={notesCountByTooth}
              onOpenNotes={setNotesToothNumber}
            />
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-4 text-xs text-ink/60">
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

          {singleSelectedTooth && toothStepsTotal > 0 && (
            <div className="mb-4 rounded-lg bg-background p-3">
              <p className="mb-2 text-xs font-medium text-ink/70">
                الخطوات: {toothStepsCompleted} من {toothStepsTotal} منجزة
                {toothStepsCompleted < toothStepsTotal && (
                  <span className="text-warning"> — باقي {toothStepsTotal - toothStepsCompleted}</span>
                )}
              </p>

              <div className="space-y-2">
                {Array.from(toothSessions.byInvoice.entries()).map(([invoiceId, rows]) => (
                  <button
                    key={invoiceId}
                    onClick={() => setViewingInvoiceId(invoiceId)}
                    className="flex w-full items-start justify-between gap-2 rounded-lg border border-ink/10 bg-white px-2.5 py-1.5 text-start text-xs hover:border-accent"
                  >
                    <span>
                      <span className="font-medium text-ink">{rows[0].serviceName ?? 'خدمة'}</span>
                      <span className="block text-ink/50">
                        {rows.map((r) => r.stepTitle).join('، ')}
                        {rows[0].completedAt && ` — ${rows[0].completedAt}`}
                      </span>
                    </span>
                    <FontAwesomeIcon icon={faFileInvoice} className="mt-0.5 shrink-0 text-ink/30" />
                  </button>
                ))}

                {toothSessions.pending.length > 0 && (
                  <div className="rounded-lg border border-dashed border-ink/15 px-2.5 py-1.5 text-xs">
                    <span className="font-medium text-ink/70">شغل حالي (لسا ما انحاسب):</span>
                    <span className="block text-ink/50">
                      {toothSessions.pending.map((r) => `${r.stepTitle}${r.completed ? ' (منجزة)' : ''}`).join('، ')}
                    </span>
                  </div>
                )}
              </div>
            </div>
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

      {viewingInvoiceId !== null && (
        <InvoiceDetailModal
          invoiceId={viewingInvoiceId}
          onClose={() => setViewingInvoiceId(null)}
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

interface CalloutTooth {
  number: number
  center: { x: number; y: number }
  label: string
  done: boolean
  side: 'left' | 'right'
}

/**
 * Side-panel-style callouts (like a radiology/anatomy diagram): a short
 * leader line + arrowhead from every worked tooth out to a label in the
 * chart's side margin, naming what was done — visible at a glance, no
 * click needed. Clicking a label opens that tooth's notebook directly.
 *
 * Shares the same viewBox *units* as the tooth chart's own overlays, just
 * extended with extra room on both sides (SIDE_PAD, converted to viewBox
 * units at the chart's own px-per-unit scale) so a tooth's real measured
 * position and the label position line up correctly across both SVGs.
 */
function ToothCalloutOverlay({
  geometry,
  teeth,
  notesCountByTooth,
  onOpenNotes,
}: {
  geometry: { viewBox: string }
  teeth: CalloutTooth[]
  notesCountByTooth: Map<number, number>
  onOpenNotes: (toothNumber: number) => void
}) {
  const [, , w, h] = geometry.viewBox.split(' ').map(Number)
  const padUnits = SIDE_PAD * (w / 460)
  const viewBox = `${-padUnits} 0 ${w + padUnits * 2} ${h}`

  const left = teeth.filter((t) => t.side === 'left').sort((a, b) => a.center.y - b.center.y)
  const right = teeth.filter((t) => t.side === 'right').sort((a, b) => a.center.y - b.center.y)

  function layout(list: CalloutTooth[]) {
    return list.map((t, i) => ({ ...t, labelY: ((i + 0.5) / list.length) * h }))
  }

  const rows = [
    ...layout(left).map((t) => ({ ...t, labelX: -padUnits * 0.92, anchor: 'end' as const })),
    ...layout(right).map((t) => ({ ...t, labelX: w + padUnits * 0.92, anchor: 'start' as const })),
  ]

  return (
    <svg viewBox={viewBox} className="absolute inset-0 size-full" style={{ overflow: 'visible' }}>
      <defs>
        <marker id="tooth-callout-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L8,4 L0,8 z" fill="var(--color-ink)" opacity={0.55} />
        </marker>
      </defs>
      {rows.map((t) => {
        const noteCount = notesCountByTooth.get(t.number) ?? 0
        return (
          <g key={t.number} className="cursor-pointer" onClick={() => onOpenNotes(t.number)}>
            <line
              x1={t.center.x}
              y1={t.center.y}
              x2={t.labelX + (t.anchor === 'end' ? 6 : -6)}
              y2={t.labelY}
              stroke="var(--color-ink)"
              strokeOpacity={0.4}
              strokeWidth={1}
              markerEnd="url(#tooth-callout-arrow)"
            />
            <text
              x={t.labelX}
              y={t.labelY}
              textAnchor={t.anchor}
              dominantBaseline="middle"
              fontSize="9"
              fill={t.done ? 'var(--color-ink)' : 'var(--color-tooth-planned)'}
              className="select-none hover:underline"
            >
              {t.number}: {t.label}
              {noteCount > 0 ? ` 📝${noteCount}` : ''}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
