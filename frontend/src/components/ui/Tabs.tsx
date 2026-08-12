import { useState, type ReactNode } from 'react'

interface TabDef {
  key: string
  label: string
  content: ReactNode
}

interface Props {
  tabs: TabDef[]
  defaultTab?: string
  /** Controlled mode: when set, the active tab follows this value instead of internal state (e.g. auto-switching to the chart tab when picking a tooth). */
  active?: string
  onActiveChange?: (key: string) => void
}

export default function Tabs({ tabs, defaultTab, active: controlledActive, onActiveChange }: Props) {
  const [internalActive, setInternalActive] = useState(defaultTab ?? tabs[0]?.key)
  const active = controlledActive ?? internalActive
  const setActive = onActiveChange ?? setInternalActive
  const activeTab = tabs.find((t) => t.key === active) ?? tabs[0]

  return (
    <div>
      <div className="mb-4 flex gap-1 border-b border-ink/10">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActive(t.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab?.key === t.key
                ? 'border-b-2 border-accent text-accent'
                : 'text-ink/50 hover:text-ink/80'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div>{activeTab?.content}</div>
    </div>
  )
}
