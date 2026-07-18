import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import Card from './Card'

export default function StatCard({
  icon,
  label,
  value,
  tone = 'accent',
  masked,
}: {
  icon: IconDefinition
  label: string
  value: string
  tone?: 'accent' | 'danger'
  masked?: boolean
}) {
  const toneClasses = tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent'

  return (
    <Card className="flex items-start justify-between gap-4 p-6">
      <div>
        <p className="text-sm font-medium text-muted">{label}</p>
        <p className="mt-2 text-[26px] font-bold leading-none text-ink">{masked ? '••••' : value}</p>
      </div>
      <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl text-lg ${toneClasses}`}>
        <FontAwesomeIcon icon={icon} />
      </span>
    </Card>
  )
}
