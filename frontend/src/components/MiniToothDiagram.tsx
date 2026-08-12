import { useMemo } from 'react'
import { ToothCrown, ToothDefs } from './ToothCrown'
import {
  DEFAULT_TOOTH_FILL,
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
  type ArchConfig,
} from '../lib/dental'

interface LaidOutTooth {
  number: number
  x: number
  y: number
  rotationDeg: number
  crownPath: string
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
    return { number, x: pos.x, y: pos.y, rotationDeg: pos.rotationDeg, crownPath: toothCrownPath(type, w, h), labelX: pos.labelX, labelY: pos.labelY }
  })
}

/** Read-only compact mouth diagram — no click handling, just highlights the given teeth. Used for quick "which teeth was this?" previews (session log, etc.) */
export default function MiniToothDiagram({ teeth, isChild = false }: { teeth: number[]; isChild?: boolean }) {
  const laidOut = useMemo(
    () => [...layoutArch(UPPER_PERMANENT, UPPER_PRIMARY, isChild, UPPER_ARCH), ...layoutArch(LOWER_PERMANENT, LOWER_PRIMARY, isChild, LOWER_ARCH)],
    [isChild],
  )
  const highlighted = new Set(teeth)

  return (
    <svg viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`} className="w-full" style={{ maxWidth: 320 }}>
      <ToothDefs />
      <line x1={40} y1={VIEWBOX.height / 2} x2={VIEWBOX.width - 40} y2={VIEWBOX.height / 2} stroke="#e2e8f0" strokeDasharray="4 4" />
      <line x1={UPPER_ARCH.cx} y1={20} x2={UPPER_ARCH.cx} y2={VIEWBOX.height - 20} stroke="#e2e8f0" strokeDasharray="4 4" />
      {laidOut.map((t) => {
        const on = highlighted.has(t.number)
        return (
          <g key={t.number}>
            <g transform={`translate(${t.x},${t.y}) rotate(${t.rotationDeg})`}>
              <ToothCrown
                crownPath={t.crownPath}
                cusps={[]}
                fill={on ? 'var(--color-accent)' : DEFAULT_TOOTH_FILL}
                stroke={on ? 'var(--color-accent)' : '#c9b8a8'}
                strokeWidth={on ? 2.5 : 1.2}
              />
            </g>
            <text x={t.labelX} y={t.labelY} textAnchor="middle" dominantBaseline="middle" fontSize="10" fill={on ? 'var(--color-accent)' : 'var(--color-ink)'} fontWeight={on ? 700 : 400} className="select-none">
              {t.number}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
