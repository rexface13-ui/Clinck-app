import { useRef } from 'react'
import { Odontogram } from 'react-odontogram'
import 'react-odontogram/style.css'
import { LOWER_PERMANENT, LOWER_PRIMARY, UPPER_PERMANENT, UPPER_PRIMARY, toLibraryToothId } from '../lib/dental'
import { OdontogramNumberOverlay, useOdontogramGeometry } from './OdontogramNumbers'

/**
 * A read-only preview using the SAME realistic tooth-shape rendering as the
 * main chart/work-planning odontogram, just small and non-interactive — for
 * places (like a session's invoice popup) that only need to show "which
 * teeth" at a glance. Replaces the old flat/plain MiniToothDiagram so every
 * tooth preview in the app looks consistent, not just the main chart.
 */
export default function MiniOdontogramPreview({ teeth, isChild = false }: { teeth: number[]; isChild?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const toothNumbers = isChild ? [...UPPER_PRIMARY, ...LOWER_PRIMARY] : [...UPPER_PERMANENT, ...LOWER_PERMANENT]
  const toLibraryId = isChild ? toLibraryToothId : (n: number) => `teeth-${n}`
  const geometry = useOdontogramGeometry(containerRef, toothNumbers, toLibraryId, [isChild])
  const highlighted = teeth.map(toLibraryId)

  return (
    <div ref={containerRef} className="relative mx-auto w-full" style={{ maxWidth: 240 }}>
      <Odontogram
        layout="circle"
        notation="FDI"
        maxTeeth={8}
        defaultSelected={[]}
        singleSelect={false}
        onChange={() => {}}
        teethConditions={
          highlighted.length > 0
            ? [{ label: 'sel', fillColor: 'var(--color-accent)', outlineColor: 'var(--color-accent)', teeth: highlighted }]
            : []
        }
        showLabels={false}
        colors={{ darkBlue: 'var(--color-accent)', baseBlue: '#c9b8a8', lightBlue: 'transparent' }}
      />
      {geometry && <OdontogramNumberOverlay geometry={geometry} toothNumbers={toothNumbers} />}
    </div>
  )
}
