import { useLayoutEffect, useState, type DependencyList, type RefObject } from 'react'

interface LabelPos {
  number: number
  x: number
  y: number
}

/**
 * react-odontogram never shows a persistent per-tooth number (only a
 * hover tooltip) — this measures each rendered tooth group's actual
 * position after mount and computes a label spot pushed radially
 * outward from the chart's center, so numbers sit just outside the ring
 * regardless of the library's own internal layout math.
 */
export function useOdontogramNumberLabels(
  containerRef: RefObject<HTMLDivElement | null>,
  toothNumbers: number[],
  toLibraryId: (n: number) => string,
  deps: DependencyList,
) {
  const [state, setState] = useState<{ viewBox: string; labels: LabelPos[] } | null>(null)

  useLayoutEffect(() => {
    const container = containerRef.current
    const svg = container?.querySelector('svg')
    const viewBox = svg?.getAttribute('viewBox')
    if (!container || !svg || !viewBox) {
      setState(null)
      return
    }

    const [, , w, h] = viewBox.split(' ').map(Number)
    const cx = w / 2
    const cy = h / 2

    const byId = new Map<string, SVGGElement>()
    container.querySelectorAll<SVGGElement>('g[class^="teeth-"]').forEach((g) => {
      const id = g.getAttribute('class')?.trim().split(/\s+/)[0]
      if (id) byId.set(id, g)
    })

    const labels: LabelPos[] = []
    for (const number of toothNumbers) {
      const el = byId.get(toLibraryId(number))
      if (!el) continue
      const box = el.getBBox()
      const ex = box.x + box.width / 2
      const ey = box.y + box.height / 2
      const dx = ex - cx
      const dy = ey - cy
      const dist = Math.hypot(dx, dy) || 1
      labels.push({ number, x: ex + (dx / dist) * 14, y: ey + (dy / dist) * 14 })
    }

    setState({ viewBox, labels })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return state
}

export function OdontogramNumberOverlay({ viewBox, labels }: { viewBox: string; labels: LabelPos[] }) {
  return (
    <svg viewBox={viewBox} className="pointer-events-none absolute inset-0 size-full">
      {labels.map((l) => (
        <text
          key={l.number}
          x={l.x}
          y={l.y}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="9"
          fill="var(--color-ink)"
          className="select-none"
        >
          {l.number}
        </text>
      ))}
    </svg>
  )
}
