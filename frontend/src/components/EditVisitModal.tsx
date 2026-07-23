import { useEffect, useMemo, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTrash, faCheck, faTooth } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { Modal, Button, SearchableSelect } from './ui'
import {
  UPPER_PERMANENT,
  LOWER_PERMANENT,
  UPPER_PRIMARY,
  LOWER_PRIMARY,
  UPPER_ARCH,
  LOWER_ARCH,
  VIEWBOX,
  archPosition,
  primaryCanonicalIndex,
  toothCrownPath,
  toothShapeType,
  toothSize,
  cuspPositions,
  type ArchConfig,
} from '../lib/dental'
import type { Service } from '../types'

interface Props {
  planId: number
  patientId: number
  patientName: string
  onClose: () => void
  onDone: () => void
}

interface Line {
  service_id: number
  name: string
  price: string
  /** Comma-separated tooth numbers, e.g. "16" or "16,17". */
  tooth_numbers: string
  per_tooth: boolean
}

function lineTotal(l: Line): number {
  const price = Number(l.price) || 0
  if (!l.per_tooth) return price
  const teethCount = l.tooth_numbers.split(',').map((t) => t.trim()).filter(Boolean).length
  return price * Math.max(1, teethCount)
}

interface LaidOutTooth {
  number: number
  x: number
  y: number
  rotationDeg: number
  crownPath: string
  cusps: { x: number; y: number; r: number }[]
  labelX: number
  labelY: number
}

function layoutArch(permanentNumbers: number[], primaryNumbers: number[], isChild: boolean, arch: ArchConfig): LaidOutTooth[] {
  const list = isChild ? primaryNumbers : permanentNumbers
  return list.map((number, i) => {
    const isPrimary = number >= 51
    const pos = isPrimary ? archPosition(primaryCanonicalIndex(number), 16, arch) : archPosition(i, list.length, arch)
    const type = toothShapeType(number, isPrimary)
    const { w, h } = toothSize(type, isPrimary)
    return {
      number,
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

/**
 * Re-opens an already-billed "اجاني هلق"/"تمّت الزيارة" visit with the exact
 * same UI used to create it, pre-filled with what's currently billed —
 * editing services/teeth/prices here and confirming voids everything
 * previously billed under this plan and rebills the new set in one shot
 * (see TreatmentPlanService::rebillVisit). The appointment itself and any
 * payment already collected are left untouched; only what was billed
 * changes, so the balance may shift and need reconciling afterward.
 */
export default function EditVisitModal({ planId, patientId, patientName, onClose, onDone }: Props) {
  const [services, setServices] = useState<Service[]>([])
  const [lines, setLines] = useState<Line[]>([])
  const [addServiceId, setAddServiceId] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isChild, setIsChild] = useState(false)
  const [pickerOpenIdx, setPickerOpenIdx] = useState<number | null>(null)

  useEffect(() => {
    api.get('/services').then((res) => setServices(res.data.data))
    api.get(`/patients/${patientId}`).then((res) => setIsChild(!!res.data.data.is_child))
    api.get(`/treatment-plans/${planId}`).then((res) => {
      const items = res.data.data.items as {
        service_id: number
        service_name: string | null
        unit_price: string
        tooth_numbers: number[] | null
        tooth_number: number | null
      }[]
      setLines(
        items.map((it) => ({
          service_id: it.service_id,
          name: it.service_name ?? 'خدمة',
          price: it.unit_price,
          tooth_numbers: (it.tooth_numbers && it.tooth_numbers.length > 0 ? it.tooth_numbers : it.tooth_number ? [it.tooth_number] : []).join(','),
          per_tooth: false,
        })),
      )
      setLoading(false)
    })
  }, [planId, patientId])

  const pickerTeeth = useMemo(
    () => [
      ...layoutArch(UPPER_PERMANENT, UPPER_PRIMARY, isChild, UPPER_ARCH),
      ...layoutArch(LOWER_PERMANENT, LOWER_PRIMARY, isChild, LOWER_ARCH),
    ],
    [isChild],
  )

  const total = lines.reduce((sum, l) => sum + lineTotal(l), 0)

  function addService(serviceId: string) {
    const svc = services.find((s) => s.id === Number(serviceId))
    if (!svc) return
    setLines([...lines, { service_id: svc.id, name: svc.name, price: svc.default_price, tooth_numbers: '', per_tooth: true }])
    setAddServiceId('')
  }

  function removeLine(idx: number) {
    setLines(lines.filter((_, i) => i !== idx))
  }

  function updatePrice(idx: number, price: string) {
    setLines(lines.map((l, i) => (i === idx ? { ...l, price } : l)))
  }

  function updateTeeth(idx: number, tooth_numbers: string) {
    setLines(lines.map((l, i) => (i === idx ? { ...l, tooth_numbers } : l)))
  }

  function togglePerTooth(idx: number) {
    setLines(lines.map((l, i) => (i === idx ? { ...l, per_tooth: !l.per_tooth } : l)))
  }

  function toggleTooth(idx: number, tooth: number) {
    const line = lines[idx]
    const current = line.tooth_numbers.split(',').map((t) => t.trim()).filter(Boolean)
    const next = current.includes(String(tooth)) ? current.filter((t) => t !== String(tooth)) : [...current, String(tooth)]
    updateTeeth(idx, next.join(','))
  }

  async function submit() {
    if (lines.length === 0) {
      setError('لازم تضيف خدمة واحدة على الأقل.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const payload = lines.map((l) => {
        const teeth = l.tooth_numbers.split(',').map((t) => t.trim()).filter(Boolean).map(Number)
        return {
          service_id: l.service_id,
          tooth_numbers: teeth.length > 0 ? teeth : null,
          price: Math.round(lineTotal(l) * 100) / 100,
        }
      })
      await api.post(`/treatment-plans/${planId}/rebill`, { lines: payload })
      onDone()
      onClose()
    } catch {
      setError('صار خطأ أثناء حفظ التعديل، تأكد من البيانات وحاول مرة ثانية.')
    } finally {
      setBusy(false)
    }
  }

  const serviceOptions = services.map((s) => ({ value: String(s.id), label: s.name, sublabel: `${s.default_price} ₪` }))

  return (
    <Modal title={`تعديل الزيارة — ${patientName}`} onClose={onClose} width="w-[560px]">
      {loading ? (
        <p className="text-sm text-muted">جارِ التحميل...</p>
      ) : (
        <div className="space-y-4">
          <p className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
            التعديل هون بيلغي كل الخدمات/الأسنان/الأسعار المسجّلة بهاي الزيارة ويسجّل بدالها اللي تحطه هلق. الموعد نفسه وأي دفعة سبق واتحصّلت ما بتتأثر — بس المبلغ المطلوب رح يتحدث.
          </p>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted">الخدمات — اختر خدمة وتنضاف فوراً</label>
            <SearchableSelect options={serviceOptions} value={addServiceId} onChange={addService} placeholder="اختر خدمة..." />
          </div>

          {lines.length > 0 && (
            <div className="space-y-2 rounded-lg bg-background p-3">
              {lines.map((l, idx) => (
                <div key={idx}>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="flex-1">{l.name}</span>
                    <button
                      type="button"
                      onClick={() => setPickerOpenIdx(pickerOpenIdx === idx ? null : idx)}
                      className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-xs ${
                        l.tooth_numbers ? 'border-accent text-accent' : 'border-border text-muted'
                      }`}
                    >
                      <FontAwesomeIcon icon={faTooth} />
                      {l.tooth_numbers ? l.tooth_numbers.split(',').join('، ') : 'اختر سن'}
                    </button>
                    <input
                      type="number"
                      value={l.price}
                      onChange={(e) => updatePrice(idx, e.target.value)}
                      className="w-20 rounded-lg border border-border px-2 py-1 text-sm"
                    />
                    <span className="text-xs text-muted">₪</span>
                    <button onClick={() => removeLine(idx)} className="text-danger">
                      <FontAwesomeIcon icon={faTrash} />
                    </button>
                  </div>

                  {l.tooth_numbers.split(',').filter((t) => t.trim()).length > 1 && (
                    <label className="mt-1 flex items-center gap-1.5 text-[11px] text-ink/60">
                      <input type="checkbox" checked={l.per_tooth} onChange={() => togglePerTooth(idx)} className="size-3.5" />
                      احتساب السعر لكل سن لحاله
                    </label>
                  )}

                  {pickerOpenIdx === idx && (
                    <div className="mt-2 space-y-2 rounded-lg border border-border bg-white p-2">
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          onClick={() => updateTeeth(idx, pickerTeeth.map((t) => t.number).join(','))}
                          className="rounded-lg border border-border px-2 py-1 text-[11px] text-ink/70 hover:border-accent hover:text-accent"
                        >
                          تحديد الكل
                        </button>
                        <button
                          type="button"
                          onClick={() => updateTeeth(idx, (isChild ? UPPER_PRIMARY : UPPER_PERMANENT).join(','))}
                          className="rounded-lg border border-border px-2 py-1 text-[11px] text-ink/70 hover:border-accent hover:text-accent"
                        >
                          النصف العلوي
                        </button>
                        <button
                          type="button"
                          onClick={() => updateTeeth(idx, (isChild ? LOWER_PRIMARY : LOWER_PERMANENT).join(','))}
                          className="rounded-lg border border-border px-2 py-1 text-[11px] text-ink/70 hover:border-accent hover:text-accent"
                        >
                          النصف السفلي
                        </button>
                        {l.tooth_numbers && (
                          <button
                            type="button"
                            onClick={() => updateTeeth(idx, '')}
                            className="rounded-lg border border-danger/20 px-2 py-1 text-[11px] text-danger/70 hover:border-danger hover:text-danger"
                          >
                            مسح التحديد
                          </button>
                        )}
                      </div>
                      <svg viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`} className="w-full" style={{ maxWidth: 380 }}>
                        <line x1={40} y1={VIEWBOX.height / 2} x2={VIEWBOX.width - 40} y2={VIEWBOX.height / 2} stroke="#e2e8f0" strokeDasharray="4 4" />
                        <line x1={UPPER_ARCH.cx} y1={20} x2={UPPER_ARCH.cx} y2={VIEWBOX.height - 20} stroke="#e2e8f0" strokeDasharray="4 4" />
                        {pickerTeeth.map((t) => {
                          const selected = l.tooth_numbers.split(',').map((v) => v.trim()).includes(String(t.number))
                          return (
                            <g key={t.number} onClick={() => toggleTooth(idx, t.number)} className="cursor-pointer">
                              <g transform={`translate(${t.x},${t.y}) rotate(${t.rotationDeg})`}>
                                <path
                                  d={t.crownPath}
                                  fill={selected ? 'var(--color-accent)' : '#fff8f0'}
                                  stroke={selected ? 'var(--color-accent)' : '#c9b8a8'}
                                  strokeWidth={selected ? 2.5 : 1.2}
                                />
                                {t.cusps.map((c, i) => (
                                  <circle key={i} cx={c.x} cy={c.y} r={c.r} fill="#00000010" />
                                ))}
                              </g>
                              <text x={t.labelX} y={t.labelY} textAnchor="middle" dominantBaseline="middle" fontSize="10" fill="var(--color-ink)" className="select-none">
                                {t.number}
                              </text>
                            </g>
                          )
                        })}
                      </svg>
                      <div className="flex justify-end">
                        <button type="button" onClick={() => setPickerOpenIdx(null)} className="text-xs text-accent hover:underline">
                          تم
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              <div className="flex justify-between border-t border-border/70 pt-2 text-sm font-semibold text-ink">
                <span>الإجمالي</span>
                <span>{total.toFixed(2)} ₪</span>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-muted hover:bg-background">
              إلغاء
            </button>
            <Button onClick={submit} disabled={busy}>
              <FontAwesomeIcon icon={faCheck} />
              {busy ? 'جارِ الحفظ...' : 'حفظ التعديل'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
