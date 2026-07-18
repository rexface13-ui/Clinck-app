import { useMemo, useState } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import {
  LOWER_ARCH,
  LOWER_PERMANENT,
  LOWER_PRIMARY,
  STATUS_COLOR,
  SURFACES,
  UPPER_ARCH,
  UPPER_PERMANENT,
  UPPER_PRIMARY,
  VIEWBOX,
  archPosition,
  cuspPositions,
  toothCrownPath,
  toothShapeType,
  toothSize,
  type ArchConfig,
} from '../lib/dental'
import type { Service, ToothFinding, ToothState } from '../types'

interface Props {
  patientId: number
  isChild: boolean
  toothStates: ToothState[]
  toothFindings: ToothFinding[]
  services: Service[]
  onChanged: () => void
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
  // (16/17/18 etc.) for teeth that don't exist yet. archPosition spaces
  // whatever list it's given evenly across the same arc, so a shorter list
  // still fills the row correctly.
  const list = isChild ? primaryNumbers : numbers

  return list.map((number, i) => {
    const isPrimary = number >= 51
    const pos = archPosition(i, list.length, arch)
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

export default function ToothChart({ patientId, isChild, toothStates, toothFindings, services, onChanged }: Props) {
  const { can } = useAuth()
  const [selectedTooth, setSelectedTooth] = useState<number | null>(null)
  const [surfaces, setSurfaces] = useState<string[]>([])
  const [findingType, setFindingType] = useState('caries')
  const [status, setStatus] = useState<'planned' | 'in_progress' | 'done'>('planned')
  const [serviceId, setServiceId] = useState<string>('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stateByTooth = useMemo(() => {
    const map = new Map<number, string>()
    toothStates.forEach((s) => map.set(s.tooth_number, s.status))
    return map
  }, [toothStates])

  const activeFindingByTooth = useMemo(() => {
    const map = new Map<number, ToothFinding>()
    // findings are ordered newest-first from the API; keep the first (latest) per tooth
    toothFindings.forEach((f) => {
      if (!map.has(f.tooth_number)) map.set(f.tooth_number, f)
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

  function openTooth(tooth: number) {
    setSelectedTooth(tooth)
    setSurfaces([])
    setFindingType('caries')
    setStatus('planned')
    setServiceId('')
    setNote('')
    setError(null)
  }

  function toggleSurface(s: string) {
    setSurfaces((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))
  }

  async function saveFinding() {
    if (!selectedTooth) return
    setSaving(true)
    setError(null)
    try {
      await api.post(`/patients/${patientId}/chart/findings`, {
        tooth_number: selectedTooth,
        surfaces: surfaces.length ? surfaces.join('') : null,
        finding_type: findingType,
        status,
        service_id: serviceId || null,
        note: note || null,
      })
      setSelectedTooth(null)
      onChanged()
    } catch {
      setError('تعذّر الحفظ. تحقق من الحقول.')
    } finally {
      setSaving(false)
    }
  }

  const canManage = can('dental_chart.manage')
  const history = selectedTooth ? toothFindings.filter((f) => f.tooth_number === selectedTooth) : []

  return (
    <div className="flex gap-6">
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <svg viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`} width={VIEWBOX.width} height={VIEWBOX.height}>
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
                  stroke={selectedTooth === t.number ? 'var(--color-accent)' : '#c9b8a8'}
                  strokeWidth={selectedTooth === t.number ? 2.5 : 1.2}
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
        </div>
      </div>

      {selectedTooth && (
        <div className="w-72 shrink-0 rounded-xl bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-medium text-ink">السن {selectedTooth}</h3>
            <button onClick={() => setSelectedTooth(null)} className="text-sm text-ink/50 hover:text-ink">
              إغلاق
            </button>
          </div>

          {canManage && (
            <>
              <label className="mb-1 block text-xs text-ink/60">السطوح</label>
              <div className="mb-3 flex flex-wrap gap-1">
                {SURFACES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleSurface(s)}
                    className={`rounded-lg border px-2 py-1 text-xs ${
                      surfaces.includes(s) ? 'border-accent bg-accent text-white' : 'border-ink/10 text-ink/70'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>

              <label className="mb-1 block text-xs text-ink/60">نوع التشخيص/الإجراء</label>
              <input
                value={findingType}
                onChange={(e) => setFindingType(e.target.value)}
                className="mb-3 w-full rounded-lg border border-ink/10 px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
                placeholder="caries, filling, extraction..."
              />

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

              <label className="mb-1 block text-xs text-ink/60">الخدمة المرتبطة (اختياري)</label>
              <select
                value={serviceId}
                onChange={(e) => setServiceId(e.target.value)}
                className="mb-3 w-full rounded-lg border border-ink/10 px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
              >
                <option value="">بدون</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
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

              <button
                onClick={saveFinding}
                disabled={saving}
                className="w-full rounded-lg bg-accent py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
              >
                {saving ? 'جارِ الحفظ...' : 'إضافة'}
              </button>
            </>
          )}

          <div className="mt-4 border-t border-ink/10 pt-3">
            <h4 className="mb-2 text-xs font-medium text-ink/60">السجل</h4>
            {history.length === 0 ? (
              <p className="text-xs text-ink/40">لا يوجد سجل لهذا السن.</p>
            ) : (
              <ul className="space-y-2">
                {history.map((f) => (
                  <li key={f.id} className="text-xs text-ink/70">
                    <span className="font-medium text-ink">{f.finding_type}</span>
                    {f.surfaces && <span className="text-ink/50"> ({f.surfaces})</span>} — {f.status} —{' '}
                    {f.recorded_at}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
