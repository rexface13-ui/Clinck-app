import { useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faStar, faTrash } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { Modal } from './ui'
import type { Note } from '../types'

interface Props {
  patientId: number
  toothNumber: number
  notes: Note[]
  onClose: () => void
  /** Called after any add/toggle/delete so the caller (patient profile) refreshes its notes list. */
  onChanged: () => void
  /** When opened from inside an active work session, new notes get tagged with it so the notebook can show which session they were written during. */
  workItemId?: number
  sessionLabel?: string
  /** When opened from within a specific step (e.g. a tooth with several steps under one session), new notes get tagged with that exact step, and the list is filtered to only that step's notes — not every note ever left on this tooth. Omit to see everything for the tooth, each still labeled with its own step/session. */
  workItemToothStepId?: number
  stepTitle?: string
}

/**
 * A per-tooth notebook: every entry is its own timestamped line (never
 * overwritten), newest first, with a star to flag one as important —
 * replaces the old single free-text "note" field on the finding form,
 * which only ever held the last thing typed.
 */
export default function ToothNotesModal({ patientId, toothNumber, notes, onClose, onChanged, workItemId, sessionLabel, workItemToothStepId, stepTitle }: Props) {
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const toothNotes = notes
    .filter((n) => n.tooth_number === toothNumber)
    .filter((n) => (workItemToothStepId ? n.work_item_tooth_step_id === workItemToothStepId : true))
    .sort((a, b) => b.id - a.id)

  async function addLine() {
    if (!draft.trim()) return
    setSaving(true)
    try {
      await api.post(`/patients/${patientId}/notes`, {
        body: draft.trim(),
        tooth_number: toothNumber,
        work_item_id: workItemId ?? null,
        work_item_tooth_step_id: workItemToothStepId ?? null,
      })
      setDraft('')
      onChanged()
    } finally {
      setSaving(false)
    }
  }

  async function toggleImportant(note: Note) {
    await api.patch(`/patients/${patientId}/notes/${note.id}`, { is_important: !note.is_important })
    onChanged()
  }

  async function deleteNote(noteId: number) {
    if (!window.confirm('حذف هذا السطر نهائياً؟')) return
    await api.delete(`/patients/${patientId}/notes/${noteId}`)
    onChanged()
  }

  return (
    <Modal title={`دفتر ملاحظات — السن ${toothNumber}${stepTitle ? ` — ${stepTitle}` : ''}`} onClose={onClose} width="w-[28rem]">
      {sessionLabel && (
        <p className="mb-2 text-xs text-accent">
          أي ملاحظة تضيفها هلق بتترّبط تلقائياً بجلسة: {sessionLabel}
          {stepTitle && ` — خطوة: ${stepTitle}`}
          {workItemToothStepId && <span className="block text-ink/40">(بتظهر هون بس ملاحظات هالخطوة تحديداً)</span>}
        </p>
      )}
      <div className="mb-3 flex items-start gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              addLine()
            }
          }}
          rows={2}
          placeholder="اكتب سطر جديد... (Enter للحفظ)"
          className="flex-1 rounded-lg border border-ink/10 px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
        />
        <button
          onClick={addLine}
          disabled={saving || !draft.trim()}
          className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          إضافة
        </button>
      </div>

      {toothNotes.length === 0 ? (
        <p className="text-xs text-ink/40">لا يوجد ملاحظات لهالسن بعد.</p>
      ) : (
        <ul className="max-h-96 space-y-2 overflow-y-auto">
          {toothNotes.map((n) => (
            <li
              key={n.id}
              className={`rounded-lg border p-2 text-sm ${n.is_important ? 'border-warning/40 bg-warning-soft' : 'border-ink/10 bg-background'}`}
            >
              <p className="whitespace-pre-wrap text-ink">{n.body}</p>
              {n.session_label && (
                <p className="mt-1 text-[11px] text-accent">
                  🗓 تم تسجيلها أثناء جلسة: {n.session_label}
                  {n.step_title && ` — خطوة: ${n.step_title}`}
                </p>
              )}
              <div className="mt-1 flex items-center justify-between text-[11px] text-ink/40">
                <span>{n.author ?? '—'} — {n.created_at}</span>
                <span className="flex items-center gap-2">
                  <button onClick={() => toggleImportant(n)} title="تعليم كمهم" className={n.is_important ? 'text-warning' : 'text-ink/20 hover:text-warning'}>
                    <FontAwesomeIcon icon={faStar} />
                  </button>
                  <button onClick={() => deleteNote(n.id)} className="text-ink/30 hover:text-danger">
                    <FontAwesomeIcon icon={faTrash} />
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
