import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faMagnifyingGlass, faUser } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import type { Patient } from '../types'

export default function GlobalSearch() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Patient[] | null>(null)
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults(null)
      return
    }
    const id = setTimeout(() => {
      api.get('/patients', { params: { search: trimmed } }).then((res) => setResults(res.data.data))
    }, 250)
    return () => clearTimeout(id)
  }, [query])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  function goToPatient(id: number) {
    setOpen(false)
    setQuery('')
    setResults(null)
    navigate(`/patients/${id}`)
  }

  return (
    <div ref={boxRef} className="relative w-80">
      <FontAwesomeIcon icon={faMagnifyingGlass} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder="بحث عن مريض بالاسم أو رقم الهاتف..."
        className="w-full rounded-xl border border-border bg-background py-2 pe-3 ps-9 text-sm focus:border-accent focus:outline-none"
      />

      {open && query.trim().length >= 2 && (
        <div className="absolute right-0 top-full z-40 mt-1 w-full rounded-xl border border-border bg-surface shadow-lg">
          {results === null ? (
            <p className="p-4 text-center text-sm text-muted">جارِ البحث...</p>
          ) : results.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted">ما في نتائج.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => goToPatient(p.id)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-start text-sm hover:bg-accent-soft"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                      <FontAwesomeIcon icon={faUser} />
                    </span>
                    <span>
                      <span className="block font-medium text-ink">{p.full_name}</span>
                      <span className="block text-xs text-muted">{p.code}{p.phone ? ` · ${p.phone}` : ''}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
