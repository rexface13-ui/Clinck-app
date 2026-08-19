import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faTrash, faUserGroup } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { Card, Button, SearchableSelect } from './ui'
import type { Patient, PatientRelative } from '../types'

export default function PatientRelativesPanel({
  patientId,
  canManage,
  onChanged,
}: {
  patientId: number
  canManage: boolean
  onChanged?: () => void
}) {
  const [relatives, setRelatives] = useState<PatientRelative[] | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [relatedPatientId, setRelatedPatientId] = useState('')
  const [label, setLabel] = useState('')
  const [searchResults, setSearchResults] = useState<Patient[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function load() {
    api.get(`/patients/${patientId}/relatives`).then((res) => setRelatives(res.data))
  }

  useEffect(load, [patientId])

  function searchPatients(query: string) {
    api.get('/patients', { params: query ? { search: query } : {} }).then((res) => setSearchResults(res.data.data ?? res.data))
  }

  const patientOptions = searchResults
    .filter((p) => p.id !== patientId)
    .map((p) => ({ value: String(p.id), label: p.full_name, sublabel: p.code }))

  async function addRelative() {
    if (!relatedPatientId || !label.trim()) return
    setBusy(true)
    setError(null)
    try {
      await api.post(`/patients/${patientId}/relatives`, { related_patient_id: Number(relatedPatientId), label: label.trim() })
      setRelatedPatientId('')
      setLabel('')
      setShowForm(false)
      load()
      onChanged?.()
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      setError(message ?? 'تعذّر إضافة القرابة.')
    } finally {
      setBusy(false)
    }
  }

  async function removeRelative(relationId: number) {
    if (!window.confirm('فك هالربط؟')) return
    setBusy(true)
    try {
      await api.delete(`/patients/${patientId}/relatives/${relationId}`)
      load()
      onChanged?.()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-medium text-ink/70">
          <FontAwesomeIcon icon={faUserGroup} />
          أقارب
        </h2>
        {canManage && (
          <Button onClick={() => setShowForm((v) => !v)}>
            <FontAwesomeIcon icon={faPlus} />
            إضافة قرابة
          </Button>
        )}
      </div>

      {showForm && (
        <div className="mb-4 space-y-2 rounded-lg bg-background p-3">
          <SearchableSelect
            options={patientOptions}
            value={relatedPatientId}
            onChange={setRelatedPatientId}
            onSearch={searchPatients}
            placeholder="ابحث عن المريض القريب..."
          />
          <input
            placeholder="صلة القرابة (أب، زوجة، أخ...)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full rounded-lg border border-ink/10 px-2 py-1.5 text-sm"
          />
          {error && <p className="text-xs text-danger">{error}</p>}
          <button
            onClick={addRelative}
            disabled={busy || !relatedPatientId || !label.trim()}
            className="w-full rounded-lg bg-accent py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
          >
            {busy ? 'جارِ الحفظ...' : 'حفظ'}
          </button>
        </div>
      )}

      {!relatives ? (
        <p className="text-sm text-muted">جارِ التحميل...</p>
      ) : relatives.length === 0 ? (
        <p className="text-sm text-muted">ما في أقارب مرتبطين لهالمريض.</p>
      ) : (
        <ul className="space-y-2">
          {relatives.map((r) => (
            <li key={r.relation_id} className="flex items-center justify-between border-b border-border/70 pb-2 last:border-0">
              <div className="flex items-center gap-3">
                <Link to={`/patients/${r.patient.id}`} className="font-medium text-accent hover:underline">
                  {r.patient.full_name}
                </Link>
                <span className="text-xs text-muted">({r.patient.code})</span>
                <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">{r.label}</span>
              </div>
              {canManage && (
                <button onClick={() => removeRelative(r.relation_id)} title="فك الربط" className="text-ink/30 hover:text-danger">
                  <FontAwesomeIcon icon={faTrash} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
