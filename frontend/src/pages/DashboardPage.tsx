import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCalendarCheck,
  faTriangleExclamation,
  faMoneyCheckDollar,
  faFileInvoiceDollar,
  faEye,
  faEyeSlash,
  faClock,
  faUserPlus,
  faCalendarPlus,
  faMoneyBillWave,
  faBoxesStacked,
  faDatabase,
  faCoins,
  faMagnifyingGlass,
} from '@fortawesome/free-solid-svg-icons'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import { api } from '../lib/api'
import { formatDate, formatTime } from '../lib/formatDate'
import { useAuth } from '../contexts/AuthContext'
import PatientSearchModal from '../components/PatientSearchModal'
import CompleteVisitModal from '../components/CompleteVisitModal'
import PatientPaymentModal from '../components/PatientPaymentModal'
import AppointmentDetailModal from '../components/AppointmentDetailModal'
import DoctorOccupancyCalendar from '../components/DoctorOccupancyCalendar'
import { Card, PageHeader, StatCard, Badge, Button, Table, Thead, Th, Td, Tr, EmptyRow, TableSkeleton, CardSkeleton } from '../components/ui'
import type { BadgeVariant } from '../components/ui'
import type { Patient } from '../types'

interface QuickAction {
  to?: string
  onClick?: () => void
  label: string
  icon: IconDefinition
  permission: string | null
}

function buildQuickActions(openPatientSearch: () => void, openPaymentSearch: () => void): QuickAction[] {
  return [
    { onClick: openPatientSearch, label: 'تسجيل زيارة', icon: faUserPlus, permission: 'patients.manage' },
    { onClick: openPaymentSearch, label: 'تحصيل دفعة', icon: faCoins, permission: 'billing.manage' },
    { to: '/appointments', label: 'حجز موعد', icon: faCalendarPlus, permission: 'appointments.view' },
    { to: '/cash?new=1', label: 'مصروف / وارد', icon: faMoneyBillWave, permission: 'cash.manage' },
    { to: '/checks?new=1', label: 'استلام شيك', icon: faMoneyCheckDollar, permission: 'checks.manage' },
    { to: '/purchase-invoices?new=1', label: 'فاتورة شراء', icon: faFileInvoiceDollar, permission: 'purchasing.manage' },
    { to: '/items?new=1', label: 'صنف جديد', icon: faBoxesStacked, permission: 'inventory.manage' },
    { to: '/backups', label: 'نسخة احتياطية', icon: faDatabase, permission: 'settings.manage' },
  ]
}

interface Appointment {
  id: number
  patient_id: number
  doctor_id: number | null
  starts_at: string
  patient_name: string | null
  doctor_name: string | null
  status: string
}

interface Invoice {
  id: number
  invoice_number: string
  patient_name: string | null
  status: string
  total_amount_ils: number
  issued_at: string
}

interface CheckAlert {
  id: number
  direction: 'incoming' | 'outgoing'
  check_number: string
  bank_name: string | null
  party_name: string | null
  amount: number
  currency: string
  due_date: string
}

interface ExpiringLot {
  item_name: string | null
  lot_number: string
  expiry_date: string
  quantity_remaining: number
}

interface LabCaseAlert {
  id: number
  patient_name: string | null
  supplier_name: string | null
  description: string
  expected_return_date: string
  status: string
}

interface Summary {
  kpis: {
    today_appointments: number
    outstanding_balance_ils: number | null
    checks_due_soon: number | null
  }
  today_appointments: Appointment[]
  recent_invoices: Invoice[]
  alerts: {
    checks_due: CheckAlert[]
    expiring_lots: ExpiringLot[]
    lab_cases_due: LabCaseAlert[]
  }
}

const statusLabels: Record<string, string> = {
  scheduled: 'مجدول',
  confirmed: 'مؤكد',
  completed: 'مكتمل',
  cancelled: 'ملغي',
  no_show: 'لم يحضر',
  paid: 'مدفوعة',
  partial: 'مدفوعة جزئياً',
  unpaid: 'غير مدفوعة',
  void: 'ملغاة',
}

const statusVariants: Record<string, BadgeVariant> = {
  scheduled: 'info',
  confirmed: 'accent',
  completed: 'success',
  cancelled: 'danger',
  no_show: 'warning',
  paid: 'success',
  partial: 'warning',
  unpaid: 'danger',
  void: 'neutral',
}

function money(value: number | null) {
  if (value === null) return '—'
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
}

function formatClock(value: Date) {
  return value.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })
}

export default function DashboardPage() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const [data, setData] = useState<Summary | null>(null)
  const [now, setNow] = useState(new Date())
  const [hideMoney, setHideMoney] = useState(() => localStorage.getItem('dashboard.hideMoney') === '1')
  const [showPatientSearch, setShowPatientSearch] = useState(false)
  const [showPaymentSearch, setShowPaymentSearch] = useState(false)
  const [completingVisit, setCompletingVisit] = useState<Appointment | null>(null)
  const [payingPatient, setPayingPatient] = useState<Patient | null>(null)
  const [selectedCheck, setSelectedCheck] = useState<CheckAlert | null>(null)
  const [invoiceSearch, setInvoiceSearch] = useState('')
  const [searchedInvoices, setSearchedInvoices] = useState<Invoice[] | null>(null)
  const [appointmentsSearch, setAppointmentsSearch] = useState('')
  const [openAppointmentId, setOpenAppointmentId] = useState<number | null>(null)
  const quickActions = buildQuickActions(() => setShowPatientSearch(true), () => setShowPaymentSearch(true))

  function loadSummary() {
    api.get<Summary>('/dashboard/summary').then((res) => setData(res.data))
  }

  async function startVisitForPatient(patient: Patient) {
    const now = new Date()
    const ends = new Date(now.getTime() + 30 * 60000)
    const res = await api.post('/appointments', {
      branch_id: patient.branch_id,
      patient_id: patient.id,
      doctor_id: null,
      starts_at: now.toISOString(),
      ends_at: ends.toISOString(),
    })
    setCompletingVisit({
      id: res.data.data.id,
      patient_id: patient.id,
      doctor_id: null,
      starts_at: now.toISOString(),
      patient_name: patient.full_name,
      doctor_name: null,
      status: 'scheduled',
    })
  }

  function bookAppointmentForPatient(patient: Patient) {
    navigate(`/appointments?patient_id=${patient.id}`)
  }

  useEffect(loadSummary, [])

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const trimmed = invoiceSearch.trim()
    if (trimmed.length < 2) {
      setSearchedInvoices(null)
      return
    }
    const id = setTimeout(() => {
      api.get<Invoice[]>('/invoices', { params: { search: trimmed } }).then((res) => setSearchedInvoices(res.data))
    }, 250)
    return () => clearTimeout(id)
  }, [invoiceSearch])

  function toggleHideMoney() {
    setHideMoney((prev) => {
      localStorage.setItem('dashboard.hideMoney', prev ? '0' : '1')
      return !prev
    })
  }

  const invoicesToShow = searchedInvoices ?? data?.recent_invoices ?? []

  return (
    <div>
      <PageHeader
        title="لوحة التحكم"
        subtitle="نظرة سريعة على أداء العيادة اليوم"
        action={
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={toggleHideMoney}>
              <FontAwesomeIcon icon={hideMoney ? faEyeSlash : faEye} />
              {hideMoney ? 'إظهار المبالغ' : 'إخفاء المبالغ'}
            </Button>
            <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 font-mono text-sm text-muted">
              <FontAwesomeIcon icon={faClock} className="text-accent" />
              {formatClock(now)}
            </div>
          </div>
        }
      />

      <div className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-muted">إجراءات سريعة</h2>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-4 xl:grid-cols-8">
          {quickActions
            .filter((a) => a.permission === null || can(a.permission))
            .map((a) =>
              a.onClick ? (
                <button
                  key={a.label}
                  type="button"
                  onClick={a.onClick}
                  className="flex flex-col items-center gap-2.5 rounded-2xl border border-border bg-surface px-3 py-5 text-center shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-all hover:-translate-y-0.5 hover:border-accent hover:shadow-md"
                >
                  <span className="flex size-11 items-center justify-center rounded-xl bg-accent-soft text-lg text-accent">
                    <FontAwesomeIcon icon={a.icon} />
                  </span>
                  <span className="text-xs font-medium text-ink/80">{a.label}</span>
                </button>
              ) : (
                <Link
                  key={a.label}
                  to={a.to!}
                  className="flex flex-col items-center gap-2.5 rounded-2xl border border-border bg-surface px-3 py-5 text-center shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-all hover:-translate-y-0.5 hover:border-accent hover:shadow-md"
                >
                  <span className="flex size-11 items-center justify-center rounded-xl bg-accent-soft text-lg text-accent">
                    <FontAwesomeIcon icon={a.icon} />
                  </span>
                  <span className="text-xs font-medium text-ink/80">{a.label}</span>
                </Link>
              ),
            )}
        </div>
      </div>

      {showPatientSearch && (
        <PatientSearchModal
          onClose={() => setShowPatientSearch(false)}
          onStartVisit={startVisitForPatient}
          onBookAppointment={bookAppointmentForPatient}
        />
      )}
      {showPaymentSearch && (
        <PatientSearchModal
          mode="pay"
          onClose={() => setShowPaymentSearch(false)}
          onSelectForPayment={setPayingPatient}
        />
      )}
      {payingPatient && (
        <PatientPaymentModal
          patientId={payingPatient.id}
          patientName={payingPatient.full_name}
          onClose={() => setPayingPatient(null)}
        />
      )}
      {completingVisit && (
        <CompleteVisitModal
          appointmentId={completingVisit.id}
          patientId={completingVisit.patient_id}
          patientName={completingVisit.patient_name ?? ''}
          doctorId={completingVisit.doctor_id}
          onClose={() => setCompletingVisit(null)}
          onDone={loadSummary}
        />
      )}
      {openAppointmentId && (
        <AppointmentDetailModal
          appointmentId={openAppointmentId}
          onClose={() => setOpenAppointmentId(null)}
          onChanged={loadSummary}
        />
      )}

      <div className="mb-8">
        <DoctorOccupancyCalendar />
      </div>

      <Card className="mb-8">
        <div className="flex flex-wrap items-center justify-between gap-3 p-6 pb-0">
          <h2 className="text-sm font-semibold text-ink/80">مواعيد اليوم</h2>
          <div className="relative">
            <FontAwesomeIcon icon={faMagnifyingGlass} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={appointmentsSearch}
              onChange={(e) => setAppointmentsSearch(e.target.value)}
              placeholder="بحث باسم المريض أو الطبيب..."
              className="w-64 rounded-xl border border-border bg-surface py-2 pe-3 ps-9 text-sm focus:border-accent focus:outline-none"
            />
          </div>
        </div>
        {!data ? (
          <TableSkeleton />
        ) : (
          <Table>
            <Thead>
              <Th>الوقت</Th>
              <Th>المريض</Th>
              <Th>الطبيب</Th>
              <Th>الحالة</Th>
            </Thead>
            <tbody>
              {(() => {
                const term = appointmentsSearch.trim().toLowerCase()
                const active = data.today_appointments.filter((a) => a.status !== 'cancelled')
                const filtered = term
                  ? active.filter(
                      (a) => a.patient_name?.toLowerCase().includes(term) || a.doctor_name?.toLowerCase().includes(term),
                    )
                  : active
                if (filtered.length === 0) {
                  return <EmptyRow colSpan={4}>{term ? 'لا توجد نتائج مطابقة' : 'لا يوجد مواعيد اليوم'}</EmptyRow>
                }
                return filtered.map((a) => (
                  <Tr key={a.id} onClick={() => setOpenAppointmentId(a.id)} className="cursor-pointer">
                    <Td className="font-mono">{formatTime(a.starts_at)}</Td>
                    <Td>{a.patient_name}</Td>
                    <Td>{a.doctor_name}</Td>
                    <Td>
                      <Badge variant={statusVariants[a.status] ?? 'neutral'}>{statusLabels[a.status] ?? a.status}</Badge>
                    </Td>
                  </Tr>
                ))
              })()}
            </tbody>
          </Table>
        )}
      </Card>

      {!data ? (
        <div className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <div className="mb-8 grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="flex flex-col gap-3 lg:col-span-1">
            <StatCard icon={faCalendarCheck} label="مواعيد اليوم" value={String(data.kpis.today_appointments)} />
            {data.kpis.outstanding_balance_ils !== null && (
              <Link to="/debts">
                <StatCard
                  icon={faFileInvoiceDollar}
                  label="أرصدة المرضى المستحقة"
                  value={`${money(data.kpis.outstanding_balance_ils)} ₪`}
                  tone="danger"
                  masked={hideMoney}
                />
              </Link>
            )}
            {data.kpis.checks_due_soon !== null && (
              <Link to="/checks">
                <StatCard icon={faMoneyCheckDollar} label="شيكات مستحقة قريباً" value={String(data.kpis.checks_due_soon)} tone="danger" />
              </Link>
            )}
          </div>

          <Card className="p-6 lg:col-span-2">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-ink/80">
              <FontAwesomeIcon icon={faTriangleExclamation} className="text-danger" />
              شيكات مستحقة خلال 7 أيام
            </h2>
            {data.alerts.checks_due.length === 0 ? (
              <p className="py-4 text-sm text-muted">لا يوجد شيكات مستحقة قريباً</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {data.alerts.checks_due.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => setSelectedCheck(c)}
                      className="flex w-full items-center justify-between gap-2 rounded-lg border-b border-border/70 pb-2 text-start last:border-0 hover:text-accent"
                    >
                      <span className="flex items-center gap-2 text-ink/80">
                        <Badge variant={c.direction === 'incoming' ? 'success' : 'warning'}>
                          {c.direction === 'incoming' ? 'لي' : 'عليّ'}
                        </Badge>
                        {c.check_number}
                        {c.party_name && <span className="text-muted">— {c.party_name}</span>}
                      </span>
                      <span className="text-muted">
                        {hideMoney ? '••••' : `${money(c.amount)} ${c.currency}`} — {formatDate(c.due_date)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {selectedCheck && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setSelectedCheck(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-sm font-semibold text-ink">تفاصيل الشيك</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted">الاتجاه</dt><dd>{selectedCheck.direction === 'incoming' ? 'لي (وارد)' : 'عليّ (صادر)'}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">رقم الشيك</dt><dd>{selectedCheck.check_number}</dd></div>
              {selectedCheck.bank_name && <div className="flex justify-between"><dt className="text-muted">البنك</dt><dd>{selectedCheck.bank_name}</dd></div>}
              {selectedCheck.party_name && <div className="flex justify-between"><dt className="text-muted">الطرف</dt><dd>{selectedCheck.party_name}</dd></div>}
              <div className="flex justify-between"><dt className="text-muted">المبلغ</dt><dd>{money(selectedCheck.amount)} {selectedCheck.currency}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">تاريخ الاستحقاق</dt><dd>{formatDate(selectedCheck.due_date)}</dd></div>
            </dl>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setSelectedCheck(null)} className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-background">
                إغلاق
              </button>
              <Link to="/checks" className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover">
                فتح صفحة الشيكات
              </Link>
            </div>
          </div>
        </div>
      )}

      {data && data.alerts.lab_cases_due.length > 0 && (
        <Card className="mb-8 p-6">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-ink/80">
            <FontAwesomeIcon icon={faTriangleExclamation} className="text-danger" />
            حالات مخبر وصل تاريخها المتوقع
          </h2>
          <ul className="space-y-3 text-sm">
            {data.alerts.lab_cases_due.map((c) => (
              <li key={c.id} className="flex items-center justify-between border-b border-border/70 pb-2 last:border-0">
                <span className="text-ink/80">
                  {c.patient_name} — {c.description} <span className="text-muted">({c.supplier_name})</span>
                </span>
                <span className="text-muted">{formatDate(c.expected_return_date)}</span>
              </li>
            ))}
          </ul>
          <Link to="/lab-cases" className="mt-3 inline-block text-xs text-accent hover:underline">فتح صفحة تتبع المخبر</Link>
        </Card>
      )}

      <Card className="mb-8 p-6">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-ink/80">
          <FontAwesomeIcon icon={faTriangleExclamation} className="text-danger" />
          أصناف قاربت على الانتهاء
        </h2>
        {!data ? (
          <TableSkeleton rows={3} cols={2} />
        ) : data.alerts.expiring_lots.length === 0 ? (
          <p className="py-4 text-sm text-muted">لا يوجد أصناف قاربت على الانتهاء</p>
        ) : (
          <ul className="space-y-3 text-sm">
            {data.alerts.expiring_lots.map((l, idx) => (
              <li key={idx} className="flex items-center justify-between border-b border-border/70 pb-2 last:border-0">
                <span className="text-ink/80">
                  {l.item_name} <span className="text-muted">({l.lot_number})</span>
                </span>
                <span className="text-muted">{formatDate(l.expiry_date)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 p-6 pb-0">
          <h2 className="text-sm font-semibold text-ink/80">آخر الفواتير</h2>
          <div className="relative">
            <FontAwesomeIcon icon={faMagnifyingGlass} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={invoiceSearch}
              onChange={(e) => setInvoiceSearch(e.target.value)}
              placeholder="بحث باسم المريض أو الخدمة أو رقم الفاتورة..."
              className="w-72 rounded-xl border border-border bg-surface py-2 pe-3 ps-9 text-sm focus:border-accent focus:outline-none"
            />
          </div>
        </div>
        {!data ? (
          <TableSkeleton />
        ) : (
          <Table>
            <Thead>
              <Th>رقم الفاتورة</Th>
              <Th>المريض</Th>
              <Th>المبلغ</Th>
              <Th>الحالة</Th>
              <Th>التاريخ</Th>
            </Thead>
            <tbody>
              {invoicesToShow.length === 0 ? (
                <EmptyRow colSpan={5}>{searchedInvoices ? 'لا توجد نتائج مطابقة' : 'لا توجد فواتير بعد'}</EmptyRow>
              ) : (
                invoicesToShow.map((inv) => (
                  <Tr key={inv.id}>
                    <Td>{inv.invoice_number}</Td>
                    <Td>{inv.patient_name}</Td>
                    <Td>{hideMoney ? '••••' : `${money(inv.total_amount_ils)} ₪`}</Td>
                    <Td>
                      <Badge variant={statusVariants[inv.status] ?? 'neutral'}>{statusLabels[inv.status] ?? inv.status}</Badge>
                    </Td>
                    <Td className="text-muted">{formatDate(inv.issued_at)}</Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}
