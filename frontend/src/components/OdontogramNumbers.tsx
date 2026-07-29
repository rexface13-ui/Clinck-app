import { useLayoutEffect, useState, type DependencyList, type RefObject } from 'react'
import { fadeHex } from '../lib/dental'

interface Point {
  x: number
  y: number
}

interface Geometry {
  viewBox: string
  centers: Map<number, Point>
}

/**
 * react-odontogram exposes no way to read a tooth's rendered position back
 * out — this measures every tooth group's actual bounding box after mount
 * so other overlays (number labels, bridge lines) can be positioned
 * against real coordinates instead of guessed ones.
 */
export function useOdontogramGeometry(
  containerRef: RefObject<HTMLDivElement | null>,
  toothNumbers: number[],
  toLibraryId: (n: number) => string,
  deps: DependencyList,
): Geometry | null {
  const [state, setState] = useState<Geometry | null>(null)

  useLayoutEffect(() => {
    const container = containerRef.current
    const svg = container?.querySelector('svg')
    const viewBox = svg?.getAttribute('viewBox')
    if (!container || !svg || !viewBox) {
      setState(null)
      return
    }

    const byId = new Map<string, SVGGElement>()
    container.querySelectorAll<SVGGElement>('g[class^="teeth-"]').forEach((g) => {
      const id = g.getAttribute('class')?.trim().split(/\s+/)[0]
      if (id) byId.set(id, g)
    })

    // getBBox() is in the element's OWN local space — it ignores every
    // ancestor transform (each tooth sits inside its own quadrant group,
    // which is what actually rotates/positions it around the ring).
    // getCTM() carries the full transform chain up to the SVG root, so
    // mapping the local center through it gives the real rendered position.
    const svgPoint = svg.createSVGPoint()
    const centers = new Map<number, Point>()
    for (const number of toothNumbers) {
      const el = byId.get(toLibraryId(number))
      const ctm = el?.getCTM()
      if (!el || !ctm) continue
      const box = el.getBBox()
      svgPoint.x = box.x + box.width / 2
      svgPoint.y = box.y + box.height / 2
      const p = svgPoint.matrixTransform(ctm)
      centers.set(number, { x: p.x, y: p.y })
    }

    setState({ viewBox, centers })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return state
}

export function OdontogramNumberOverlay({ geometry, toothNumbers }: { geometry: Geometry; toothNumbers: number[] }) {
  const [, , w, h] = geometry.viewBox.split(' ').map(Number)
  const cx = w / 2
  const cy = h / 2

  return (
    <svg viewBox={geometry.viewBox} className="pointer-events-none absolute inset-0 size-full">
      {toothNumbers.map((number) => {
        const c = geometry.centers.get(number)
        if (!c) return null
        const dx = c.x - cx
        const dy = c.y - cy
        const dist = Math.hypot(dx, dy) || 1
        const x = c.x + (dx / dist) * 14
        const y = c.y + (dy / dist) * 14
        return (
          <text key={number} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize="9" fill="var(--color-ink)" className="select-none">
            {number}
          </text>
        )
      })}
    </svg>
  )
}

export type ToothMarker = 'filling' | 'decay'

/**
 * Small icons drawn ON the tooth (not offset outward like the number
 * label) so a filling/decay reads as "marked on this tooth" at a glance —
 * a filled steel-colored dot for a filling, a dark irregular spot for
 * decay. Both sit at the tooth's real measured center via the same
 * geometry the number/bridge overlays use.
 */
export function OdontogramMarkerOverlay({ geometry, markers }: { geometry: Geometry; markers: Map<number, ToothMarker> }) {
  return (
    <svg viewBox={geometry.viewBox} className="pointer-events-none absolute inset-0 size-full">
      {Array.from(markers.entries()).map(([number, marker]) => {
        const c = geometry.centers.get(number)
        if (!c) return null
        if (marker === 'filling') {
          return (
            <circle key={number} cx={c.x} cy={c.y} r={5} fill="#6b8cae" stroke="#fff" strokeWidth={1} />
          )
        }
        return (
          <g key={number}>
            <circle cx={c.x} cy={c.y} r={5.5} fill="#5b3a29" opacity={0.9} />
            <circle cx={c.x - 1.5} cy={c.y - 1} r={1.6} fill="#3a2318" />
          </g>
        )
      })}
    </svg>
  )
}

export interface BridgeGroup {
  color: string
  done: boolean
  teeth: number[]
}

export function OdontogramBridgeOverlay({ geometry, groups }: { geometry: Geometry; groups: BridgeGroup[] }) {
  return (
    <svg viewBox={geometry.viewBox} className="pointer-events-none absolute inset-0 size-full">
      {groups.map((g, i) => {
        const points = g.teeth.map((n) => geometry.centers.get(n)).filter((p): p is Point => !!p)
        if (points.length < 2) return null
        const sorted = [...points].sort((a, b) => a.x - b.x)
        const color = g.done ? g.color : fadeHex(g.color, 0.5)
        return (
          <polyline
            key={i}
            points={sorted.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke={color}
            strokeWidth={5}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.85}
          />
        )
      })}
    </svg>
  )
}
