import { useLayoutEffect, useRef, useState, type DependencyList, type MouseEvent, type RefObject } from 'react'
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
    //
    // getCTM() maps to the nearest ancestor VIEWPORT, not necessarily the
    // outer <svg> our overlays share a viewBox with — the library nests
    // an inner <svg>/viewport, so getCTM() silently stops there and gives
    // a wrong, systematically-shifted point (confirmed live: it placed
    // tooth 11's label squarely on tooth 21's real position). getScreenCTM()
    // accounts for the FULL chain (nested viewports and any CSS transform)
    // all the way to actual screen pixels; inverting the root <svg>'s own
    // getScreenCTM() then maps that screen point back into the shared
    // viewBox space our overlays use — verified pixel-accurate against
    // getBoundingClientRect().
    const svgPoint = svg.createSVGPoint()
    const rootInverse = svg.getScreenCTM()?.inverse()
    const centers = new Map<number, Point>()
    if (rootInverse) {
      for (const number of toothNumbers) {
        const el = byId.get(toLibraryId(number))
        const elScreenCTM = el?.getScreenCTM()
        if (!el || !elScreenCTM) continue
        const box = el.getBBox()
        svgPoint.x = box.x + box.width / 2
        svgPoint.y = box.y + box.height / 2
        const screenPoint = svgPoint.matrixTransform(elScreenCTM)
        const rootPoint = screenPoint.matrixTransform(rootInverse)
        centers.set(number, { x: rootPoint.x, y: rootPoint.y })
      }
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
export function OdontogramMarkerOverlay({ geometry, markers }: { geometry: Geometry; markers: Map<number, ToothMarker[]> }) {
  return (
    <svg viewBox={geometry.viewBox} className="pointer-events-none absolute inset-0 size-full">
      {Array.from(markers.entries()).map(([number, list]) =>
        list.map((marker, i) => {
          const c = geometry.centers.get(number)
          if (!c) return null
          // A tooth can carry more than one marker (e.g. decay noted on a
          // tooth that already got a filling) — offset each one so they
          // don't sit exactly on top of each other.
          const dx = (i - (list.length - 1) / 2) * 7
          if (marker === 'filling') {
            return <circle key={`${number}-${i}`} cx={c.x + dx} cy={c.y} r={5} fill="#6b8cae" stroke="#fff" strokeWidth={1} />
          }
          return (
            <g key={`${number}-${i}`}>
              <circle cx={c.x + dx} cy={c.y} r={5.5} fill="#5b3a29" opacity={0.9} />
              <circle cx={c.x + dx - 1.5} cy={c.y - 1} r={1.6} fill="#3a2318" />
            </g>
          )
        }),
      )}
    </svg>
  )
}

/**
 * A safe click-target radius: half the smallest center-to-center gap
 * between any two teeth, with a margin — guarantees neighboring click
 * circles never overlap, however tight the arch gets (e.g. near the
 * midline where two crowns sit closest together).
 */
export function safeClickRadius(geometry: Geometry): number {
  const points = Array.from(geometry.centers.values())
  let min = Infinity
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y)
      if (d < min) min = d
    }
  }
  return Number.isFinite(min) ? (min / 2) * 0.85 : 12
}

/**
 * The library's own hit-testing is unreliable near the midline — its
 * hand-drawn crown paths for adjacent teeth (e.g. 11/21) can overlap far
 * enough that a click squarely inside one tooth's own measured bounding
 * box actually registers on its neighbor instead (confirmed by direct
 * testing: a click at teeth-21's own bbox center reported tooth 11).
 * This overlay replaces click handling entirely with our own
 * non-overlapping regions, built from the same measured centers the
 * number/marker overlays already use — so "which tooth did I click"
 * always matches "which tooth is that number sitting on".
 */
export function OdontogramClickOverlay({
  geometry,
  toothNumbers,
  onSelect,
}: {
  geometry: Geometry
  toothNumbers: number[]
  /** Passes along the click's ctrlKey/metaKey so callers can support "click one tooth, ctrl+click another to select the range between them" without a separate mode toggle. */
  onSelect: (n: number, event: MouseEvent) => void
}) {
  const radius = safeClickRadius(geometry)
  return (
    <svg viewBox={geometry.viewBox} className="absolute inset-0 size-full">
      {toothNumbers.map((number) => {
        const c = geometry.centers.get(number)
        if (!c) return null
        return (
          <circle
            key={number}
            cx={c.x}
            cy={c.y}
            r={radius}
            fill="transparent"
            style={{ pointerEvents: 'all', cursor: 'pointer' }}
            onClick={(e) => onSelect(number, e)}
          />
        )
      })}
    </svg>
  )
}

/** Our own selection indicator, driven by the same trusted geometry — replaces the library's native highlight, which follows its own (unreliable) internal click state rather than our authoritative selection. */
export function OdontogramSelectionOverlay({ geometry, selected }: { geometry: Geometry; selected: number[] }) {
  return (
    <svg viewBox={geometry.viewBox} className="pointer-events-none absolute inset-0 size-full">
      {selected.map((number) => {
        const c = geometry.centers.get(number)
        if (!c) return null
        return <circle key={number} cx={c.x} cy={c.y} r={safeClickRadius(geometry) + 2} fill="none" stroke="var(--color-accent)" strokeWidth={2.5} />
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

/** Extra room reserved on each side of the chart for the worked-tooth callout labels — just enough for a short label sitting right next to its tooth, not a distant side panel. Shared by every odontogram that shows callouts (overview, work planning). */
export const CALLOUT_SIDE_PAD = 135

export interface CalloutTooth {
  /** The representative tooth — lowest number in the group, used as the drag/click/override key. */
  number: number
  /** Every tooth this one label covers — more than one for a multi-tooth session (bridge, several teeth done together). */
  teeth: number[]
  center: Point
  label: string
  done: boolean
  side: 'left' | 'right'
}

/**
 * Side-panel-style callouts (like a radiology/anatomy diagram): a short
 * leader line + arrowhead from every worked tooth out to a label in the
 * chart's side margin, naming what was done — visible at a glance, no
 * click needed. Clicking a label selects that tooth, opening the same
 * detail panel a tooth click would.
 *
 * Shares the same viewBox *units* as the tooth chart's own overlays, just
 * extended with extra room on both sides (CALLOUT_SIDE_PAD, converted to
 * viewBox units at the chart's own px-per-unit scale) so a tooth's real
 * measured position and the label position line up correctly across both
 * SVGs. Used by both the overview chart and the work-planning chart so a
 * worked tooth shows what it's for in either place, the same way.
 */
export function ToothCalloutOverlay({
  geometry,
  teeth,
  notesCountByTooth,
  onSelectTooth,
  containerWidthPx,
  editMode = false,
  offsetOverrides,
  onDragOffset,
}: {
  geometry: { viewBox: string }
  teeth: CalloutTooth[]
  notesCountByTooth: Map<number, number>
  onSelectTooth: (toothNumber: number) => void
  /** The chart container's real, currently-rendered pixel width — used (not a hardcoded constant) so the side margin stays correctly proportioned at any screen size, including once the layout shrinks responsively. */
  containerWidthPx: number
  /** While on, labels can be dragged instead of opening the tooth on click. */
  editMode?: boolean
  /** Manually-placed positions (viewBox units, relative to the tooth's own center) saved as a shared template — takes over from the default radial guess for any tooth that has one. */
  offsetOverrides?: Map<number, { dx: number; dy: number }>
  onDragOffset?: (toothNumber: number, dx: number, dy: number) => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [, , w, h] = geometry.viewBox.split(' ').map(Number)
  const padUnits = CALLOUT_SIDE_PAD * (w / containerWidthPx)
  const viewBox = `${-padUnits} 0 ${w + padUnits * 2} ${h}`

  // Each label sits a short distance straight out from its own tooth, in the
  // direction away from the arch's center — "حوالين السن" — instead of the
  // old design that pushed every label out to a shared side margin far from
  // the tooth it described. Distance is in real pixels (via containerWidthPx)
  // so it looks the same short hop at any screen size. A manually-dragged
  // override (see labelEditMode above) replaces this guess entirely once set.
  const offsetUnits = 80 * (w / containerWidthPx)
  const cx = w / 2
  const cy = h / 2
  const rows = teeth.map((t) => {
    const override = offsetOverrides?.get(t.number)
    let dx: number
    let dy: number
    if (override) {
      dx = override.dx
      dy = override.dy
    } else {
      const rawDx = t.center.x - cx
      const rawDy = t.center.y - cy
      const len = Math.hypot(rawDx, rawDy) || 1
      dx = (rawDx / len) * offsetUnits
      dy = (rawDy / len) * offsetUnits
    }
    const labelX = t.center.x + dx
    const labelY = t.center.y + dy
    const anchor: 'start' | 'middle' | 'end' = dx > 8 ? 'start' : dx < -8 ? 'end' : 'middle'
    return { ...t, labelX, labelY, anchor }
  })

  /** Converts a mouse event's screen position into this SVG's own viewBox coordinate space — same getScreenCTM technique the rest of the chart's overlays already rely on for pixel-accurate placement. */
  function toSvgPoint(clientX: number, clientY: number): { x: number; y: number } | null {
    const svg = svgRef.current
    if (!svg) return null
    const ctm = svg.getScreenCTM()
    if (!ctm) return null
    const pt = svg.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    const local = pt.matrixTransform(ctm.inverse())
    return { x: local.x, y: local.y }
  }

  function startDrag(toothNumber: number, center: Point, e: MouseEvent) {
    if (!editMode || !onDragOffset) return
    e.preventDefault()
    e.stopPropagation()
    function onMove(ev: globalThis.MouseEvent) {
      const p = toSvgPoint(ev.clientX, ev.clientY)
      if (!p) return
      onDragOffset!(toothNumber, p.x - center.x, p.y - center.y)
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    // pointer-events-none on the root is essential — this overlay's pixel
    // box fully covers the tooth chart underneath (including the real
    // click-target overlay), so without it every label/line here would
    // swallow clicks meant for the teeth themselves. Only the label text
    // opts back in (pointer-events-auto) to stay clickable.
    <svg ref={svgRef} viewBox={viewBox} className="pointer-events-none absolute inset-0 size-full" style={{ overflow: 'visible' }}>
      <defs>
        <marker id="tooth-callout-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L8,4 L0,8 z" fill="var(--color-ink)" opacity={0.75} />
        </marker>
      </defs>
      {rows.map((t) => {
        const noteCount = t.teeth.reduce((sum, n) => sum + (notesCountByTooth.get(n) ?? 0), 0)
        return (
          <g key={t.number}>
            <line
              x1={t.center.x}
              y1={t.center.y}
              x2={t.labelX + (t.anchor === 'end' ? 8 : -8)}
              y2={t.labelY}
              stroke="var(--color-ink)"
              strokeOpacity={0.6}
              strokeWidth={1.25}
              markerEnd="url(#tooth-callout-arrow)"
            />
            <text
              x={t.labelX}
              y={t.labelY}
              textAnchor={t.anchor}
              dominantBaseline="middle"
              fontSize="11"
              fontWeight={600}
              fill={t.done ? 'var(--color-ink)' : 'var(--color-tooth-planned)'}
              className={`pointer-events-auto select-none ${editMode ? 'cursor-move' : 'cursor-pointer hover:underline'}`}
              onMouseDown={(e) => startDrag(t.number, t.center, e)}
              onClick={() => {
                if (!editMode) onSelectTooth(t.number)
              }}
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
