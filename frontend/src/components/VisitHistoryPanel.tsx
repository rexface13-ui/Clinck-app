import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faMoneyBill, faChevronDown, faChevronLeft, faTooth, faPrint, faTriangleExclamation, faFileMedical, faNoteSticky } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { formatDate } from '../lib/formatDate'
import { printDocument, metaRow } from '../lib/print'
import { useClinicProfile } from '../lib/useClinicProfile'
import { Card, Badge, SearchableSelect } from './ui'
import type { BadgeVariant } from './ui'
import { describeTeeth } from '../lib/dental'
import MiniOdontogramPreview from './MiniOdontogramPreview'
import ToothNotesModal from './ToothNotesModal'
import InvoiceDetailModal from './InvoiceDetailModal'
import type { Medication, Note, Prescription, Visit } from '../types'

interface VisitGroup {
  key: string
  visits: Visit[]
}

/** All teeth a visit covers. */
function visitTeeth(v: Visit): number[] {
  if (v.tooth_numbers && v.tooth_numbers.length > 0) return v.tooth_numbers
  return v.tooth_number ? [v.tooth_number] : []
}

/**
 * One group per real visit/session — everything charged under the same
 * appointment (regardless of how many different services or invoice
 * lines it was split across) shows together, not one row per tooth.
 * Falls back to the old per-invoice-line grouping (batch_id) for rows
 * with no linked appointment (legacy data, or a work item since moved
 * to a follow-up appointment).
 */
function groupVisits(visits: Visit[]): VisitGroup[] {
  const order: string[] = []
  const map = new Map<string, Visit[]>()
  for (const v of visits) {
    const key = v.appointment_id ? `appt-${v.appointment_id}` : (v.batch_id ?? `single-${v.session_id ?? v.invoice_id}`)
    if (!map.has(key)) {
      map.set(key, [])
      order.push(key)
    }
    map.get(key)!.push(v)
  }
  return order.map((key) => ({ key, visits: map.get(key)! }))
}

/** Group header label: the shared service name if every row is the same service, otherwise a count — a session can now mix several different services under one appointment. */
function groupServiceLabel(visits: Visit[]): string {
  const names = Array.from(new Set(visits.map((v) => v.service_name).filter((n): n is string => !!n)))
  if (names.length === 1) return names[0]
  if (names.length === 0) return 'خدمة'
  return `${names.length} خدمات`
}

const INVOICE_STATUS_LABELS: Record<string, string> = {
  unpaid: 'غير مدفوعة',
  partial: 'مدفوعة جزئياً',
  paid: 'مدفوعة',
  void: 'ملغاة (مسترجعة)',
}

const INVOICE_STATUS_VARIANTS: Record<string, BadgeVariant> = {
  unpaid: 'danger',
  partial: 'warning',
  paid: 'success',
  void: 'neutral',
}

export default function VisitHistoryPanel({
  patientId,
  patientName,
  isChild = false,
  medicalAlerts = [],
  onChanged,
  notes = [],
  onOpenWorkItem,
}: {
  patientId: number
  patientName?: string
  isChild?: boolean
  medicalAlerts?: string[]
  onChanged?: () => void
  /** Same patient notes list the tooth notebooks use — surfaced per visit here, filtered to that visit's own teeth, so a session's notes are visible without hunting through the notebook separately. */
  notes?: Note[]
  /** Jumps to the Work tab and opens that session's work item straight into edit mode — surfaced from the invoice-detail popup so a session can be corrected without hunting for it in the tooth chart. */
  onOpenWorkItem?: (workItemId: number) => void
}) {
  const { can } = useAuth()
  const canCollect = can('billing.manage')
  const clinic = useClinicProfile()
  const [prescribingFor, setPrescribingFor] = useState<string | null>(null)
  const [medsText, setMedsText] = useState<Record<string, string>>({})
  const [prescriptionsVersion, setPrescriptionsVersion] = useState(0)
  const [notesFor, setNotesFor] = useState<{ toothNumber: number; workItemId?: number; sessionLabel?: string } | null>(null)
  const [viewingInvoice, setViewingInvoice] = useState<{ invoiceId: number; teeth: number[]; itemId: number | null } | null>(null)

  function printPrescriptionFor(key: string, v: Visit) {
    const meds = medsText[key] ?? ''
    if (!meds.trim()) return
    const body = `
      ${metaRow([
        ['المريض', patientName ?? ''],
        ['التاريخ', formatDate(new Date().toISOString())],
        ...(v.doctor_name ? ([['الطبيب', v.doctor_name]] as [string, string][]) : []),
      ])}
      <p style="font-size:13px;margin-bottom:6px;"><b>الأدوية:</b></p>
      <div style="white-space:pre-wrap;font-size:14px;line-height:1.9;border:1px solid #ddd;border-radius:8px;padding:14px;min-height:120px;">${meds.replace(/\n/g, '<br/>')}</div>
      <div class="signature"><div>توقيع الطبيب</div></div>
    `
    printDocument('وصفة طبية', body, clinic)
    api.post('/prescriptions', { patient_id: patientId, medications: meds }).then(() => setPrescriptionsVersion((n) => n + 1))
    setPrescribingFor(null)
  }

  const [visits, setVisits] = useState<Visit[]>([])
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([])
  const [showPrescriptions, setShowPrescriptions] = useState(false)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [diagramFor, setDiagramFor] = useState<string | null>(null)

  function toggleDiagram(key: string) {
    setDiagramFor((prev) => (prev === key ? null : key))
  }

  function toggleGroup(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const [medications, setMedications] = useState<Medication[]>([])
  const [pickedMedicationId, setPickedMedicationId] = useState<Record<string, string>>({})

  function load() {
    api.get(`/patients/${patientId}/visits`).then((res) => setVisits(res.data))
  }

  useEffect(() => {
    load()
    api.get<Medication[]>('/medications').then((res) => setMedications(res.data)).catch(() => {})
  }, [patientId])

  /** Appends the medication's name + usage instructions to the prescription textarea instead of replacing it — a prescription is usually more than one drug. */
  function insertMedication(rowKey: string, medicationId: string) {
    const med = medications.find((m) => String(m.id) === medicationId)
    if (!med) return
    const line = med.usage_instructions ? `${med.name} — ${med.usage_instructions}` : med.name
    const current = medsText[rowKey] ?? ''
    setMedsText({ ...medsText, [rowKey]: current ? `${current}\n${line}` : line })
    // Reset instead of keeping the picked value shown, so the field reads as
    // ready to add another medication right away, not "stuck" on one choice.
    setPickedMedicationId({ ...pickedMedicationId, [rowKey]: '' })
  }

  /** Medications picked for this prescription (by name match in the free-text box) that are linked to one of the patient's own known allergies — a safety net since the box itself stays free text. */
  function conflictingMedications(rowKey: string): Medication[] {
    const text = medsText[rowKey] ?? ''
    if (!text.trim() || medicalAlerts.length === 0) return []
    return medications.filter(
      (m) => text.includes(m.name) && m.allergies.some((a) => medicalAlerts.includes(a.name)),
    )
  }

  useEffect(() => {
    api.get('/prescriptions', { params: { patient_id: patientId } }).then((res) => setPrescriptions(res.data.data))
  }, [patientId, prescriptionsVersion])

  function open(key: string) {
    setOpenKey(openKey === key ? null : key)
  }

  return (
    <div>
      {prescriptions.length > 0 && (
        <Card className="mb-4 p-6">
          <button
            onClick={() => setShowPrescriptions((v) => !v)}
            className="flex w-full items-center justify-between text-sm font-medium text-muted"
          >
            <span className="flex items-center gap-2">
              <FontAwesomeIcon icon={faFileMedical} className="text-accent" />
              سجل الوصفات ({prescriptions.length})
            </span>
            <FontAwesomeIcon icon={showPrescriptions ? faChevronDown : faChevronLeft} className="text-ink/40" />
          </button>
          {showPrescriptions && (
            <div className="mt-3 space-y-2">
              {prescriptions.map((p) => (
                <div key={p.id} className="rounded-lg border border-ink/10 p-3 text-sm">
                  <div className="mb-1 flex items-center justify-between text-xs text-muted">
                    <span>{p.created_at}</span>
                    {p.doctor_name && <span>{p.doctor_name}</span>}
                  </div>
                  <p className="whitespace-pre-wrap text-ink">{p.medications}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    <Card className="p-6">
      <h2 className="mb-3 text-sm font-medium text-muted">سجل الجلسات</h2>
      {visits.length === 0 ? (
        <p className="text-sm text-muted">لا توجد زيارات محسوبة بعد.</p>
      ) : (
        <div className="space-y-2">
          {groupVisits(visits).map((group) => {
            const isSingle = group.visits.length === 1
            const isExpanded = isSingle || expandedGroups.has(group.key)
            const first = group.visits[0]
            const teeth = group.visits.flatMap(visitTeeth)
            const totalPrice = group.visits.reduce((sum, v) => sum + Number(v.price), 0)

            if (isSingle) {
              return <VisitRow key={group.key} rowKey={group.key} v={first} />
            }

            return (
              <div key={group.key} className="relative rounded-lg border border-ink/10">
                <div
                  onClick={() => toggleGroup(group.key)}
                  className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-sm hover:bg-background"
                >
                  <div className="flex items-center gap-2">
                    <FontAwesomeIcon icon={isExpanded ? faChevronDown : faChevronLeft} className="text-ink/40" />
                    <span className="font-medium text-ink">{groupServiceLabel(group.visits)}</span>
                    {teeth.length > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleDiagram(group.key)
                        }}
                        className={`flex items-center gap-1 rounded-lg border px-1.5 py-0.5 text-xs ${diagramFor === group.key ? 'border-accent text-accent' : 'border-ink/10 text-muted hover:border-accent hover:text-accent'}`}
                      >
                        <FontAwesomeIcon icon={faTooth} />
                        {describeTeeth(teeth, isChild)}
                      </button>
                    )}
                    {first.doctor_name && <span className="text-xs text-muted">— {first.doctor_name}</span>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-ink">{totalPrice.toFixed(2)} ₪</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setViewingInvoice({ invoiceId: first.invoice_id, teeth, itemId: first.item_id ?? null })
                      }}
                      title="عرض تفاصيل الفاتورة"
                    >
                      <Badge variant={INVOICE_STATUS_VARIANTS[first.invoice_status]}>{INVOICE_STATUS_LABELS[first.invoice_status]}</Badge>
                    </button>
                    <span className="text-xs text-muted">{first.appointment_date ?? first.date}</span>
                  </div>
                </div>

                {diagramFor === group.key && (
                  <div className="absolute right-3 top-full z-20 mt-1 rounded-xl border border-ink/10 bg-white p-3 shadow-lg">
                    <MiniOdontogramPreview teeth={teeth} isChild={isChild} />
                  </div>
                )}

                {isExpanded && (
                  <div className="space-y-1 border-t border-ink/10 p-2">
                    {group.visits.map((v, i) => (
                      <VisitRow key={`${group.key}-${i}`} rowKey={`${group.key}-${i}`} v={v} nested />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Card>

    {notesFor && (
      <ToothNotesModal
        patientId={patientId}
        toothNumber={notesFor.toothNumber}
        notes={notes}
        onClose={() => setNotesFor(null)}
        onChanged={() => onChanged?.()}
        workItemId={notesFor.workItemId}
        sessionLabel={notesFor.sessionLabel}
      />
    )}

    {viewingInvoice && (
      <InvoiceDetailModal
        invoiceId={viewingInvoice.invoiceId}
        onClose={() => setViewingInvoice(null)}
        onChanged={() => {
          load()
          onChanged?.()
        }}
        sessionTeeth={viewingInvoice.teeth}
        isChild={isChild}
        patientId={patientId}
        notes={notes}
        onEditWorkItem={
          onOpenWorkItem && viewingInvoice.itemId
            ? () => {
                const itemId = viewingInvoice.itemId!
                setViewingInvoice(null)
                onOpenWorkItem(itemId)
              }
            : undefined
        }
      />
    )}
    </div>
  )

  function VisitRow({ rowKey, v, nested = false }: { rowKey: string; v: Visit; nested?: boolean }) {
    const teeth = visitTeeth(v)
    const diagramKey = `visit-${rowKey}`
    return (
      <div className={`relative ${nested ? 'rounded-lg bg-background/60' : 'rounded-lg border border-ink/10'}`}>
        <div
          onClick={() => open(rowKey)}
          className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-sm hover:bg-background"
        >
          <div className="flex items-center gap-2">
            <span className="font-medium text-ink">{v.service_name ?? 'خدمة'}</span>
            {v.step_title && <span className="text-xs text-muted">— {v.step_title}</span>}
            {teeth.length > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  toggleDiagram(diagramKey)
                }}
                className={`flex items-center gap-1 rounded-lg border px-1.5 py-0.5 text-xs ${diagramFor === diagramKey ? 'border-accent text-accent' : 'border-ink/10 text-muted hover:border-accent hover:text-accent'}`}
              >
                <FontAwesomeIcon icon={faTooth} />
                {describeTeeth(teeth, isChild)}
              </button>
            )}
            {!nested && v.doctor_name && <span className="text-xs text-muted">— {v.doctor_name}</span>}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-ink">{v.price} ₪</span>
            {!nested && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setViewingInvoice({ invoiceId: v.invoice_id, teeth, itemId: v.item_id ?? null })
                }}
                title="عرض تفاصيل الفاتورة"
              >
                <Badge variant={INVOICE_STATUS_VARIANTS[v.invoice_status]}>{INVOICE_STATUS_LABELS[v.invoice_status]}</Badge>
              </button>
            )}
            <span className="text-xs text-muted">{v.date}</span>
          </div>
        </div>

        {diagramFor === diagramKey && (
          <div className="absolute right-3 top-full z-20 mt-1 rounded-xl border border-ink/10 bg-white p-3 shadow-lg">
            <MiniOdontogramPreview teeth={teeth} isChild={isChild} />
          </div>
        )}

        {openKey === rowKey && (
                <div className="space-y-3 border-t border-ink/10 p-3">
                  {v.note && <p className="text-sm text-ink">{v.note}</p>}

                  {teeth.length > 0 && (() => {
                    const toothNotes = notes
                      .filter((n) => n.tooth_number !== null && teeth.includes(n.tooth_number))
                      .sort((a, b) => b.id - a.id)
                    const sessionLabel = `${v.service_name ?? 'جلسة'} — ${v.appointment_date ?? v.date}`
                    return (
                      <div className="space-y-1.5 rounded-lg bg-background p-2">
                        <p className="text-[11px] font-medium text-muted">ملاحظات الأسنان المشمولة بهالجلسة</p>
                        {toothNotes.map((n) => (
                          <p key={n.id} className="text-xs text-ink">
                            <span className="font-medium text-accent">سن {n.tooth_number}:</span> {n.body}
                            <span className="text-muted"> — {n.created_at}</span>
                          </p>
                        ))}
                        <div className="flex flex-wrap gap-2 pt-1">
                          {teeth.map((t) => (
                            <button
                              key={t}
                              onClick={() => setNotesFor({ toothNumber: t, workItemId: v.item_id ?? undefined, sessionLabel })}
                              className="flex items-center gap-1 rounded-lg border border-ink/10 px-2 py-1 text-[11px] text-accent hover:border-accent"
                            >
                              <FontAwesomeIcon icon={faNoteSticky} />
                              دفتر ملاحظات سن {t}
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  })()}

                  <div className="border-t border-ink/5 pt-2">
                    {prescribingFor === rowKey ? (
                      <div className="space-y-2">
                        {medicalAlerts.length > 0 && (
                          <div className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
                            <FontAwesomeIcon icon={faTriangleExclamation} className="mt-0.5" />
                            <span>تنبيه حساسية: {medicalAlerts.join('، ')}</span>
                          </div>
                        )}
                        {medications.length > 0 && (
                          <SearchableSelect
                            options={medications.map((m) => ({ value: String(m.id), label: m.name, sublabel: m.form ?? undefined }))}
                            value={pickedMedicationId[rowKey] ?? ''}
                            onChange={(value) => insertMedication(rowKey, value)}
                            placeholder="أضف دواء من القائمة..."
                          />
                        )}
                        {conflictingMedications(rowKey).map((m) => (
                          <div key={m.id} className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-xs font-medium text-danger">
                            <FontAwesomeIcon icon={faTriangleExclamation} className="mt-0.5" />
                            <span>
                              "{m.name}" مرتبط بحساسية عند هذا المريض ({m.allergies.filter((a) => medicalAlerts.includes(a.name)).map((a) => a.name).join('، ')}) — تأكد قبل الطباعة.
                            </span>
                          </div>
                        ))}
                        <textarea
                          value={medsText[rowKey] ?? ''}
                          onChange={(e) => setMedsText({ ...medsText, [rowKey]: e.target.value })}
                          placeholder={'الأدوية...\nمثال: Amoxicillin 500mg — كل 8 ساعات لمدة 5 أيام'}
                          rows={3}
                          className="w-full rounded-lg border border-ink/10 px-2 py-1.5 text-sm"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => printPrescriptionFor(rowKey, v)}
                            disabled={!(medsText[rowKey] ?? '').trim()}
                            className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent-hover disabled:opacity-40"
                          >
                            <FontAwesomeIcon icon={faPrint} />
                            طباعة
                          </button>
                          <button onClick={() => setPrescribingFor(null)} className="rounded-lg px-3 py-1.5 text-xs text-muted hover:bg-background">
                            إلغاء
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setPrescribingFor(rowKey)}
                        className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-ink/60 hover:bg-background hover:text-accent"
                      >
                        <FontAwesomeIcon icon={faPrint} />
                        كتابة وصفة طبية وطباعتها
                      </button>
                    )}
                  </div>

                  {canCollect && v.invoice_status !== 'void' && (
                    <div className="border-t border-ink/5 pt-2">
                      <button
                        onClick={() => setViewingInvoice({ invoiceId: v.invoice_id, teeth, itemId: v.item_id ?? null })}
                        className="flex items-center gap-1 rounded-lg bg-success-soft px-3 py-1.5 text-xs font-medium text-success hover:opacity-80"
                      >
                        <FontAwesomeIcon icon={faMoneyBill} />
                        تحصيل دفعة / خصم على هاي الجلسة
                      </button>
                    </div>
                  )}
                </div>
              )}
      </div>
    )
  }
}
