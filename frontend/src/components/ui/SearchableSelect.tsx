import { useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronDown, faPlus } from '@fortawesome/free-solid-svg-icons'
import { normalizeArabic } from '../../lib/arabic'

export interface SearchableOption {
  value: string
  label: string
  sublabel?: string
}

interface Props {
  options: SearchableOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  /** Shown as "+ إضافة "query" ..." when the search has no matches — lets the caller open a create-new flow instead of leaving a dead end. */
  onCreateNew?: (query: string) => void
  createNewLabel?: string
  /**
   * Hand the typed query back so the caller can fetch matches from the server,
   * for lists too long to hold in the page. Filtering client-side over a
   * paginated list silently hides everything past the first page — the search
   * looks like it works and just never finds the older half of the clinic.
   *
   * When set, `options` is shown as-is: the server has already filtered it.
   */
  onSearch?: (query: string) => void
}

export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'اختر...',
  className = '',
  onCreateNew,
  createNewLabel = 'إضافة',
  onSearch,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = options.find((o) => o.value === value)

  // Server-side search replaces `options` as you type, so the chosen one can
  // drop out of the list — hold on to its label or the field goes blank the
  // moment you search for something else.
  const [lastSelectedLabel, setLastSelectedLabel] = useState<string | null>(null)

  useEffect(() => {
    if (selected) setLastSelectedLabel(selected.label)
    else if (!value) setLastSelectedLabel(null)
  }, [selected, value])

  const selectedLabel = selected?.label ?? (value ? lastSelectedLabel : null)

  // Debounced so typing a name is one request, not one per letter.
  useEffect(() => {
    if (!onSearch) return
    const id = setTimeout(() => onSearch(query.trim()), 250)

    return () => clearTimeout(id)
  }, [query, onSearch])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const filtered = onSearch
    ? options
    : options.filter((o) => {
        // normalizeArabic collapses ا/أ/إ/آ, ة/ه, etc.; toLowerCase makes an
        // English query match regardless of how it was capitalized — neither
        // should force the user to type an exact variant to find something.
        const q = normalizeArabic(query.trim()).toLowerCase()
        if (!q) return true
        return normalizeArabic(o.label).toLowerCase().includes(q) || normalizeArabic(o.sublabel ?? '').toLowerCase().includes(q)
      })

  function pick(v: string) {
    onChange(v)
    setOpen(false)
    setQuery('')
  }

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v)
          setTimeout(() => inputRef.current?.focus(), 0)
        }}
        className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2.5 text-start text-sm text-ink hover:border-accent/40 focus:border-accent focus:outline-none"
      >
        <span className={selectedLabel ? '' : 'text-muted'}>{selectedLabel ?? placeholder}</span>
        <FontAwesomeIcon icon={faChevronDown} className="text-xs text-muted" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-full min-w-56 rounded-lg border border-border bg-surface shadow-lg">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="بحث..."
            className="w-full border-b border-border px-2 py-1.5 text-sm focus:outline-none"
          />
          <ul className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-2 py-3 text-center">
                <p className="mb-2 text-xs text-muted">ما في نتائج.</p>
                {onCreateNew && query.trim() && (
                  <button
                    type="button"
                    onClick={() => {
                      onCreateNew(query.trim())
                      setOpen(false)
                      setQuery('')
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
                  >
                    <FontAwesomeIcon icon={faPlus} />
                    {createNewLabel} "{query.trim()}"
                  </button>
                )}
              </li>
            ) : (
              filtered.map((o) => (
                <li key={o.value}>
                  <button
                    type="button"
                    onClick={() => pick(o.value)}
                    className={`flex w-full flex-col items-start px-2 py-1.5 text-start text-sm hover:bg-accent-soft ${
                      o.value === value ? 'bg-accent-soft text-accent' : 'text-ink'
                    }`}
                  >
                    <span>{o.label}</span>
                    {o.sublabel && <span className="text-xs text-muted">{o.sublabel}</span>}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
