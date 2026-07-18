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
    <Card className="p-5">
      <span className={`flex size-10 items-center justify-center rounded-xl ${toneClasses}`}>
        <FontAwesomeIcon icon={icon} />
      </span>
      <p className="mt-4 text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-ink">{masked ? '••••' : value}</p>
    </Card>
  )
}
