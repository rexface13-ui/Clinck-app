/**
 * Shared "polished enamel" rendering for a single tooth crown — a base
 * color layered with a soft bottom shadow, a glassy top highlight, and a
 * subtle drop-shadow, so the flat crown outline reads as a rounded,
 * lightly 3D surface instead of a flat pastel shape. Both ToothChart and
 * WorkPlanningPanel render many of these per <svg>, so the gradient/filter
 * defs are declared once via <ToothDefs /> and referenced by id here.
 */
export function ToothDefs() {
  return (
    <defs>
      <linearGradient id="tooth-gloss" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#ffffff" stopOpacity="0.65" />
        <stop offset="35%" stopColor="#ffffff" stopOpacity="0.15" />
        <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
      </linearGradient>
      <radialGradient id="tooth-shade" cx="50%" cy="88%" r="65%">
        <stop offset="0%" stopColor="#00000022" />
        <stop offset="100%" stopColor="#00000000" />
      </radialGradient>
      <radialGradient id="cusp-bump" cx="35%" cy="30%" r="75%">
        <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
        <stop offset="55%" stopColor="#00000010" />
        <stop offset="100%" stopColor="#00000030" />
      </radialGradient>
      <filter id="tooth-depth" x="-50%" y="-50%" width="200%" height="200%">
        <feDropShadow dx="0" dy="1.2" stdDeviation="1.3" floodColor="#2b1d12" floodOpacity="0.25" />
      </filter>
    </defs>
  )
}

export function ToothCrown({
  crownPath,
  cusps,
  fill,
  stroke,
  strokeWidth = 1.2,
  dashed = false,
}: {
  crownPath: string
  cusps: { x: number; y: number; r: number }[]
  fill: string
  stroke: string
  strokeWidth?: number
  dashed?: boolean
}) {
  return (
    <g filter="url(#tooth-depth)">
      <path d={crownPath} fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeDasharray={dashed ? '3 2' : undefined} />
      <path d={crownPath} fill="url(#tooth-shade)" pointerEvents="none" />
      <path d={crownPath} fill="url(#tooth-gloss)" pointerEvents="none" />
      {cusps.map((c, i) => (
        <circle key={i} cx={c.x} cy={c.y} r={c.r} fill="url(#cusp-bump)" />
      ))}
    </g>
  )
}
