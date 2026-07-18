import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faMagnifyingGlass, faUserPlus, faUser } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { Modal } from './ui'
import type { Patient } from '../types'

interface Props {
  onClose: () => void
  /** 'visit' opens the patient's profile; 'pay' jumps straight to the payment form on that profile. */
  mode?: 'visit' | 'pay'
}

export default function PatientSearchModal({ onClose, mode = 'visit' }: Props) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Patient[] | null>(null)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults(null)
      return
    }
    setLoading(true)
    const id = setTimeout(() => {
      api
        .get('/patients', { params: { search: trimmed } })
        .then((res) => setResults(res.data.data))
        .finally(() => setLoading(false))
    }, 250)
    return () => clearTimeout(id)
  }, [query])

  function goToPatient(id: number) {
    onClose()
    navigate(mode === 'pay' ? `/patients/${id}?pay=1` : `/patients/${id}`)
  }

  function addAsNew() {
    onClose()
    navigate(`/patients?new=1&name=${encodeURIComponent(query.trim())}`)
  }

  return (
    <Modal title={mode === 'pay' ? 'تحصيل دفعة' : 'تسجيل زيارة'} onClose={onClose} width="w-[480px]">
      <div className="relative mb-3">
        <FontAwesomeIcon icon={faMagnifyingGlass} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="اكتب اسم المريض..."
          className="w-full rounded-xl border border-border bg-surface py-2.5 pe-3 ps-9 text-sm focus:border-accent focus:outline-none"
        />
      </div>

      {query.trim().length < 2 && (
        <p className="py-6 text-center text-sm text-muted">اكتب حرفين على الأقل للبحث عن مريض مسجّل.</p>
      )}

      {query.trim().length >= 2 && loading && (
        <p className="py-6 text-center text-sm text-muted">جارِ البحث...</p>
      )}

      {query.trim().length >= 2 && !loading && results && results.length > 0 && (
        <ul className="max-h-72 space-y-1 overflow-y-auto">
          {results.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => goToPatient(p.id)}
                className="flex w-full items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-start text-sm transition-colors hover:border-accent hover:bg-accent-soft"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
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

      {query.trim().length >= 2 && !loading && results && results.length === 0 && mode === 'pay' && (
        <p className="py-6 text-center text-sm text-muted">ما في مريض مسجّل بهالاسم.</p>
      )}

      {query.trim().length >= 2 && !loading && results && results.length === 0 && mode === 'visit' && (
        <div className="py-4 text-center">
          <p className="mb-3 text-sm text-muted">ما في مريض مسجّل بهالاسم.</p>
          <button
            onClick={addAsNew}
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
          >
            <FontAwesomeIcon icon={faUserPlus} />
            إضافة "{query.trim()}" كمريض جديد
          </button>
        </div>
      )}
    </Modal>
  )
}
