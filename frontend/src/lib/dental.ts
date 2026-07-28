// FDI (ISO 3950) tooth numbering + dental-arch geometry, matching
// backend/app/Support/Dental/FdiTeeth.php. Layout mirrors the classic
// "arch from above" chart: upper arch bulges up (11/21 at the very top,
// 18/28 at the sides), lower arch bulges down (41/31 at the bottom,
// 48/38 at the sides).

export const UPPER_PERMANENT = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]
export const LOWER_PERMANENT = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]
export const UPPER_PRIMARY = [55, 54, 53, 52, 51, 61, 62, 63, 64, 65]
export const LOWER_PRIMARY = [85, 84, 83, 82, 81, 71, 72, 73, 74, 75]

export const SURFACES = ['M', 'D', 'O', 'I', 'B', 'L'] as const

/**
 * Turns a set of tooth numbers into a short, readable label instead of a
 * long raw list — "3-4 وشوية" gets spelled out, a whole arch/mouth gets its
 * name, and anything larger gets a count with a hint to expand for detail.
 */
export function describeTeeth(teeth: number[], isChild: boolean): string {
  const sorted = [...teeth].sort((a, b) => a - b)
  if (sorted.length === 0) return ''
  if (sorted.length === 1) return `سن ${sorted[0]}`

  const set = new Set(sorted)
  const upper = isChild ? UPPER_PRIMARY : UPPER_PERMANENT
  const lower = isChild ? LOWER_PRIMARY : LOWER_PERMANENT
  const sameAs = (list: number[]) => list.length === set.size && list.every((n) => set.has(n))

  if (sameAs([...upper, ...lower])) return 'كل الأسنان'
  if (sameAs(upper)) return 'النصف العلوي'
  if (sameAs(lower)) return 'النصف السفلي'
  if (sorted.length <= 4) return `أسنان ${sorted.join('، ')}`
  return `${sorted.length} سن (اضغط للتفاصيل)`
}

export const STATUS_COLOR: Record<string, string> = {
  planned: 'var(--color-tooth-planned)',
  done: 'var(--color-tooth-done)',
  missing: 'var(--color-tooth-missing)',
}

export const DEFAULT_TOOTH_FILL = '#fff8f0'

/** Mixes a hex color toward white by `amount` (0-1) — used to fade a service's color for "partially done" teeth without relying on fill-opacity (which would also fade the enamel gloss/shading layered on top). */
export function fadeHex(hex: string, amount: number): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  const mix = (c: number) => Math.round(c + (255 - c) * amount)
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`
}

export type ToothShapeType = 'incisor' | 'canine' | 'premolar' | 'molar'

export function toothShapeType(toothNumber: number, isPrimary: boolean): ToothShapeType {
  const position = toothNumber % 10
  if (position <= 2) return 'incisor'
  if (position === 3) return 'canine'
  if (isPrimary) return 'molar' // primary teeth skip premolars
  if (position <= 5) return 'premolar'
  return 'molar'
}

const SHAPE_SIZE: Record<ToothShapeType, { w: number; h: number; cusps: number }> = {
  incisor: { w: 20, h: 26, cusps: 0 },
  canine: { w: 19, h: 28, cusps: 1 },
  premolar: { w: 22, h: 24, cusps: 2 },
  molar: { w: 27, h: 26, cusps: 4 },
}

const PRIMARY_SCALE = 0.82

export function toothSize(type: ToothShapeType, isPrimary: boolean): { w: number; h: number; cusps: number } {
  const base = SHAPE_SIZE[type]
  if (!isPrimary) return base

  return { w: base.w * PRIMARY_SCALE, h: base.h * PRIMARY_SCALE, cusps: base.cusps }
}

/** Rounded-rect path centered on (0,0), local coordinates (pre-rotation). */
function roundedRectPath(w: number, h: number, r: number): string {
  const x = -w / 2
  const y = -h / 2
  return `M${x + r},${y} h${w - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${h - 2 * r} a${r},${r} 0 0 1 -${r},${r} h-${w - 2 * r} a${r},${r} 0 0 1 -${r},-${r} v-${h - 2 * r} a${r},${r} 0 0 1 ${r},-${r} z`
}

/**
 * A single friendly, uniform "cartoon tooth" blob for every tooth type —
 * matching the simple oval-with-heavy-rounding look of a classic chart
 * icon, instead of the previous per-type outlines (pointed canine tip,
 * squarer molars). Only the overall size still varies by type/arch.
 */
export function toothCrownPath(_type: ToothShapeType, w: number, h: number): string {
  const r = Math.min(w, h) * 0.46
  return roundedRectPath(w, h, r)
}

/**
 * Hairline fissure/groove lines (local coords) drawn on every tooth's
 * crown — a short central groove on all of them, plus a crossing side
 * groove on premolars/molars (their real occlusal surface has a fissure
 * pattern, not a smooth face like a front tooth).
 */
export function cuspPositions(type: ToothShapeType, w: number, h: number): { x1: number; y1: number; x2: number; y2: number }[] {
  const lines = [{ x1: 0, y1: -h * 0.28, x2: 0, y2: h * 0.28 }]
  if (type === 'molar' || type === 'premolar') {
    lines.push({ x1: -w * 0.24, y1: 0, x2: w * 0.24, y2: 0 })
  }
  return lines
}

export interface ArchPosition {
  x: number
  y: number
  rotationDeg: number
  /** Absolute (un-rotated) position for the tooth number label, sitting just outside the ring at this tooth's true circle angle. */
  labelX: number
  labelY: number
}

export interface ArchConfig {
  cx: number
  cy: number
  radius: number
  /** +1 bulges the arch downward (lower jaw), -1 bulges it upward (upper jaw). */
  direction: 1 | -1
  /** Degrees to inset the arch's start/end from the shared horizontal midline, so the upper and lower arches don't collide where they meet on each side. */
  posStartDeg: number
  posEndDeg: number
}

/**
 * Both arches share one circle (same center + radius) so they read as a
 * single continuous ring, matching a real circular dental chart. Each arch
 * only occupies its half (top for upper, bottom for lower); GAP_DEG insets
 * the start/end of each half so the outermost teeth (18/28, 48/38) don't
 * overlap the other arch's outermost teeth at the sides.
 */
const CIRCLE_CX = 260
const CIRCLE_CY = 190
const CIRCLE_RADIUS = 148
const GAP_DEG = 7

export const UPPER_ARCH: ArchConfig = {
  cx: CIRCLE_CX, cy: CIRCLE_CY, radius: CIRCLE_RADIUS, direction: -1,
  posStartDeg: 180 - GAP_DEG, posEndDeg: GAP_DEG,
}
export const LOWER_ARCH: ArchConfig = {
  cx: CIRCLE_CX, cy: CIRCLE_CY, radius: CIRCLE_RADIUS, direction: 1,
  posStartDeg: 180 + GAP_DEG, posEndDeg: 360 - GAP_DEG,
}

/**
 * Position tooth `index` of `total` along the arch (index 0 = leftmost /
 * side tooth, index total-1 = rightmost / other side tooth, center teeth
 * sit at the arch's apex — matching UPPER_PERMANENT/LOWER_PERMANENT order).
 */
/**
 * A primary tooth's slot within the SAME 16-slot canonical range used for
 * the permanent arch (not its own 0..9 index) — so it sits at the position
 * its permanent successor would occupy, rather than being stretched evenly
 * across the full adult-width arc. Primary quadrants 5/8 read first
 * (descending, mirroring permanent quadrants 1/4); 6/7 read second
 * (ascending, mirroring 2/3). Canonical positions 6/7/8 (the un-erupted
 * premolar/molar slots) are simply never used, which is what leaves a
 * child's arch visibly shorter than an adult's, matching real anatomy.
 */
export function primaryCanonicalIndex(toothNumber: number): number {
  const quadrant = Math.floor(toothNumber / 10)
  const position = toothNumber % 10
  const isFirstInList = quadrant === 5 || quadrant === 8
  return isFirstInList ? 8 - position : 7 + position
}

export function archPosition(index: number, total: number, arch: ArchConfig): ArchPosition {
  const t = total === 1 ? 0.5 : index / (total - 1)

  // x/y walk around the shared circle using the arch's own (gapped) angle range.
  const posAngle = ((arch.posStartDeg + t * (arch.posEndDeg - arch.posStartDeg)) * Math.PI) / 180
  const x = arch.cx + arch.radius * Math.cos(posAngle)
  const y = arch.cy - arch.radius * Math.sin(posAngle)

  // Label sits at the same true circle angle, just further out — computed
  // independently of tooth rotation so labels never cluster, overlap, or
  // get pushed off-canvas at the sides/apex the way a rotated local offset would.
  const labelRadius = arch.radius + 17
  const labelX = arch.cx + labelRadius * Math.cos(posAngle)
  const labelY = arch.cy - labelRadius * Math.sin(posAngle)

  // Rotation uses the un-gapped 180deg->0deg mapping so tooth orientation
  // (cusp pointing toward the center of the mouth) stays exactly as tuned before.
  const angleDeg = 180 * (1 - t)
  const rotationDeg = arch.direction === -1 ? angleDeg - 90 : 90 - angleDeg

  return { x, y, rotationDeg, labelX, labelY }
}

export const VIEWBOX = { width: 520, height: 380 }
