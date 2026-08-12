import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faInfoCircle } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { Card, PageHeader, Badge, Button, Table, Thead, Th, Td, Tr, EmptyRow, Modal, SearchableSelect } from '../components/ui'
import type { BadgeVariant } from '../components/ui'
import { ToothCrown, ToothDefs } from '../components/ToothCrown'
import { toothShapeType, toothSize, toothCrownPath, cuspPositions } from '../lib/dental'
import type { Cashbox, CommissionStatement, Doctor } from '../types'

const MONTH_LABELS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
]

const CONTRACT_LABELS: Record<Doctor['contract_type'], string> = {
  salary: 'راتب ثابت',
  salary_commission: 'راتب + عمولة',
  commission: 'عمولة',
  independent: 'مستقل',
}

function currentYear(): number {
  return new Date().getFullYear()
}

function currentMonthNum(): number {
  return new Date().getMonth() + 1
}

function money(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)
}

const FINDING_STATUS_LABELS: Record<string, string> = {
  planned: 'مخطط',
  in_progress: 'قيد التنفيذ',
  done: 'منجز',
}

const INVOICE_STATUS_LABELS: Record<string, string> = {
  unpaid: 'غير مدفوعة',
  partial: 'مدفوعة جزئياً',
  paid: 'مدفوعة بالكامل',
  void: 'ملغاة',
}

const INVOICE_STATUS_VARIANTS: Record<string, BadgeVariant> = {
  unpaid: 'danger',
  partial: 'warning',
  paid: 'success',
  void: 'neutral',
}

/** A single tooth crown, drawn standalone (no arch) — just to visually identify which tooth this session was on. */
function ToothPreview({ toothNumber }: { toothNumber: number }) {
  const isPrimary = toothNumber >= 51
  const type = toothShapeType(toothNumber, isPrimary)
  const { w, h } = toothSize(type, isPrimary)
  const crownPath = toothCrownPath(type, w * 2.2, h * 2.2)
  const cusps = cuspPositions(type, w * 2.2, h * 2.2)
  return (
    <svg viewBox="-40 -40 80 80" className="mx-auto" style={{ width: 90, height: 90 }}>
      <ToothDefs />
      <ToothCrown crownPath={crownPath} cusps={cusps} fill="var(--color-accent-soft)" stroke="var(--color-accent)" strokeWidth={2} />
      <text x={0} y={5} textAnchor="middle" fontSize="16" fontWeight="bold" fill="var(--color-ink)">
        {toothNumber}
      </text>
    </svg>
  )
}

export default function CommissionsPage() {
  const { can } = useAuth()
  const [searchParams] = useSearchParams()
  const preselectedDoctorId = searchParams.get('doctor_id')
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [doctorId, setDoctorId] = useState<number | null>(preselectedDoctorId ? Number(preselectedDoctorId) : null)
  const [year, setYear] = useState(currentYear())
  const [monthNum, setMonthNum] = useState(currentMonthNum())
  const month = `${year}-${String(monthNum).padStart(2, '0')}`
  const [statement, setStatement] = useState<CommissionStatement | null>(null)
  const [selectedSession, setSelectedSession] = useState<CommissionStatement['transactions'][number] | null>(null)
  const [showPayForm, setShowPayForm] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [payNotes, setPayNotes] = useState('')
  const [payCashboxId, setPayCashboxId] = useState('')
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.get('/doctors').then((res) => {
      setDoctors(res.data.data)
      if (!preselectedDoctorId && res.data.data.length > 0) setDoctorId(res.data.data[0].id)
    })
    api.get('/cashboxes').then((res) => {
      const ils = (res.data as Cashbox[]).filter((c) => c.currency === 'ILS')
      setCashboxes(ils)
      if (ils.length > 0) setPayCashboxId(String(ils[0].id))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function load() {
    if (!doctorId) return
    api.get(`/doctors/${doctorId}/commission-statement`, { params: { month: `${month}-01` } }).then((res) => setStatement(res.data))
  }

  useEffect(load, [doctorId, month])

  function openPayForm() {
    setPayAmount(statement ? Math.max(0, statement.remaining_ils).toFixed(2) : '')
    setPayNotes('')
    setShowPayForm(true)
  }

  async function submitPay() {
    if (!doctorId || !payAmount || Number(payAmount) <= 0 || !payCashboxId) return
    setBusy(true)
    try {
      await api.post(`/doctors/${doctorId}/commission-statement/pay`, {
        month: `${month}-01`,
        amount: Number(payAmount),
        notes: payNotes || null,
        cashbox_id: Number(payCashboxId),
      })
      setShowPayForm(false)
      load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader title="الرواتب والعمولات" subtitle="مستحقات كل طبيب شهرياً — عمولات، راتب، وسجل الصرف" />

      <Card className="mb-6 flex flex-wrap items-center gap-3 p-4">
        <select value={doctorId ?? ''} onChange={(e) => setDoctorId(Number(e.target.value))} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm focus:border-accent focus:outline-none">
          {doctors.map((d) => (
            <option key={d.id} value={d.id}>{d.full_name}</option>
          ))}
        </select>
        <select value={monthNum} onChange={(e) => setMonthNum(Number(e.target.value))} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm focus:border-accent focus:outline-none">
          {MONTH_LABELS.map((label, i) => (
            <option key={i} value={i + 1}>{label}</option>
          ))}
        </select>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm focus:border-accent focus:outline-none">
          {Array.from({ length: 6 }, (_, i) => currentYear() - 2 + i).map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </Card>

      {statement && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Card className="p-4">
              <p className="text-xs text-muted">نوع التعاقد</p>
              <p className="mt-1 text-sm font-medium text-ink"><Badge variant="accent">{CONTRACT_LABELS[statement.doctor.contract_type]}</Badge></p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted">عمولات الشهر</p>
              <p className="mt-1 text-lg font-semibold text-ink">{money(statement.commission_total_ils)} ₪</p>
            </Card>
            {statement.salary_due_ils > 0 && (
              <Card className="p-4">
                <p className="text-xs text-muted">الراتب الثابت</p>
                <p className="mt-1 text-lg font-semibold text-ink">{money(statement.salary_due_ils)} ₪</p>
              </Card>
            )}
            <Card className="p-4">
              <p className="text-xs text-muted">إجمالي المستحق</p>
              <p className="mt-1 text-lg font-semibold text-ink">{money(statement.total_due_ils)} ₪</p>
            </Card>
          </div>

          <Card className="mb-6 flex items-center justify-between p-6">
            <div>
              <p className="text-sm text-muted">المتبقي بعد الصرف</p>
              <p className={`text-2xl font-semibold ${statement.remaining_ils > 0 ? 'text-danger' : 'text-success'}`}>
                {money(statement.remaining_ils)} ₪
              </p>
              <p className="mt-1 text-xs text-muted">مصروف حتى الآن: {money(statement.paid_ils)} ₪</p>
            </div>
            {can('commissions.view') && statement.total_due_ils > 0 && (
              <Button onClick={openPayForm}>صرف مستحق</Button>
            )}
          </Card>

          {showPayForm && (
            <Modal title={`صرف مستحق — ${statement.doctor.full_name}`} onClose={() => setShowPayForm(false)} width="w-[420px]">
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">المبلغ (₪)</label>
                  <input
                    type="number"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
                  />
                  <p className="mt-1 text-xs text-muted">المتبقي: {money(statement.remaining_ils)} ₪ — عبّي المبلغ الكامل أو جزء منه.</p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">الصندوق</label>
                  <SearchableSelect
                    options={cashboxes.map((c) => ({ value: String(c.id), label: c.name, sublabel: c.currency }))}
                    value={payCashboxId}
                    onChange={setPayCashboxId}
                    placeholder="الصندوق..."
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">ملاحظات (اختياري)</label>
                  <textarea
                    value={payNotes}
                    onChange={(e) => setPayNotes(e.target.value)}
                    rows={3}
                    placeholder="مثلاً: دفعة نقدية، أو تحويل بنكي..."
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
                  />
                </div>
                <Button onClick={submitPay} loading={busy} disabled={!payAmount || Number(payAmount) <= 0 || !payCashboxId} className="w-full justify-center">
                  تأكيد الصرف
                </Button>
              </div>
            </Modal>
          )}

          {selectedSession && (
            <Modal title="تفاصيل الجلسة" onClose={() => setSelectedSession(null)} width="w-[420px]">
              {selectedSession.tooth_number && <ToothPreview toothNumber={selectedSession.tooth_number} />}
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-muted">المريض</dt><dd>{selectedSession.patient_name}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">السن</dt><dd>{selectedSession.tooth_number ?? '—'}</dd></div>
                {selectedSession.surfaces && (
                  <div className="flex justify-between"><dt className="text-muted">السطوح</dt><dd>{selectedSession.surfaces}</dd></div>
                )}
                <div className="flex justify-between"><dt className="text-muted">الخدمة</dt><dd>{selectedSession.service_name ?? '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">نوع الإجراء</dt><dd>{selectedSession.finding_type ?? '—'}</dd></div>
                {selectedSession.finding_status && (
                  <div className="flex justify-between">
                    <dt className="text-muted">حالة الإجراء</dt>
                    <dd>{FINDING_STATUS_LABELS[selectedSession.finding_status] ?? selectedSession.finding_status}</dd>
                  </div>
                )}
                {selectedSession.note && (
                  <div className="flex justify-between"><dt className="text-muted">ملاحظة</dt><dd className="text-end">{selectedSession.note}</dd></div>
                )}
                <div className="flex justify-between"><dt className="text-muted">التاريخ</dt><dd>{selectedSession.recorded_at ?? '—'}</dd></div>
                <div className="flex justify-between border-t border-border/70 pt-2 font-semibold text-ink"><dt>العمولة</dt><dd>{selectedSession.amount_ils} ₪</dd></div>
              </dl>

              <div className="mt-3 border-t border-border/70 pt-3">
                <h4 className="mb-2 text-xs font-medium text-muted">دفعة المريض</h4>
                {selectedSession.invoice_status ? (
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-muted">حالة الفاتورة</dt>
                      <dd>
                        <Badge variant={INVOICE_STATUS_VARIANTS[selectedSession.invoice_status] ?? 'neutral'}>
                          {INVOICE_STATUS_LABELS[selectedSession.invoice_status] ?? selectedSession.invoice_status}
                        </Badge>
                      </dd>
                    </div>
                    {selectedSession.invoice_number && (
                      <div className="flex justify-between"><dt className="text-muted">رقم الفاتورة</dt><dd>{selectedSession.invoice_number}</dd></div>
                    )}
                    <div className="flex justify-between"><dt className="text-muted">إجمالي الفاتورة</dt><dd>{money(selectedSession.invoice_total_ils ?? 0)} ₪</dd></div>
                    <div className="flex justify-between"><dt className="text-muted">المدفوع</dt><dd>{money(selectedSession.invoice_paid_ils ?? 0)} ₪</dd></div>
                    <div className="flex justify-between font-semibold text-ink">
                      <dt>المتبقي على المريض</dt>
                      <dd>{money((selectedSession.invoice_total_ils ?? 0) - (selectedSession.invoice_paid_ils ?? 0))} ₪</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="text-sm text-muted">مافي فاتورة مرتبطة بهاي الجلسة.</p>
                )}
              </div>
            </Modal>
          )}

          <Card className="mb-6">
            <h2 className="p-6 pb-0 text-sm font-semibold text-ink/80">جلسات العمولة</h2>
            <Table>
              <Thead>
                <Th>المريض</Th>
                <Th>السن</Th>
                <Th>الخدمة</Th>
                <Th>المبلغ</Th>
                <Th></Th>
              </Thead>
              <tbody>
                {statement.transactions.length === 0 ? (
                  <EmptyRow colSpan={5}>لا توجد عمولات لهذا الشهر.</EmptyRow>
                ) : (
                  statement.transactions.map((t) => (
                    <Tr key={t.id} onClick={() => setSelectedSession(t)} className="cursor-pointer">
                      <Td>{t.patient_name}</Td>
                      <Td className="text-muted">{t.tooth_number ?? '—'}</Td>
                      <Td className="text-muted">{t.service_name ?? '—'}</Td>
                      <Td className="text-muted">{t.amount_ils} ₪</Td>
                      <Td className="text-accent">
                        <FontAwesomeIcon icon={faInfoCircle} />
                      </Td>
                    </Tr>
                  ))
                )}
              </tbody>
            </Table>
          </Card>

          <Card>
            <h2 className="p-6 pb-0 text-sm font-semibold text-ink/80">سجل الصرف</h2>
            <Table>
              <Thead>
                <Th>المبلغ</Th>
                <Th>ملاحظات</Th>
                <Th>التاريخ</Th>
              </Thead>
              <tbody>
                {statement.payouts.length === 0 ? (
                  <EmptyRow colSpan={3}>ما انصرف شي لهاي الشهر بعد.</EmptyRow>
                ) : (
                  statement.payouts.map((p) => (
                    <Tr key={p.id}>
                      <Td className="font-medium text-ink">{p.amount_ils} ₪</Td>
                      <Td className="text-muted">{p.notes ?? '—'}</Td>
                      <Td className="text-muted">{p.paid_at}</Td>
                    </Tr>
                  ))
                )}
              </tbody>
            </Table>
          </Card>
        </>
      )}
    </div>
  )
}
