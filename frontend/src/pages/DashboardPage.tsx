import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCalendarCheck,
  faSackDollar,
  faWallet,
  faTriangleExclamation,
  faMoneyCheckDollar,
  faUserDoctor,
  faFileInvoiceDollar,
  faEye,
  faEyeSlash,
  faClock,
  faUserPlus,
  faCalendarPlus,
  faMoneyBillWave,
  faBoxesStacked,
  faDatabase,
} from '@fortawesome/free-solid-svg-icons'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { Card, PageHeader, StatCard, Badge, Button, Table, Thead, Th, Td, Tr, EmptyRow, TableSkeleton, CardSkeleton } from '../components/ui'
import type { BadgeVariant } from '../components/ui'

interface QuickAction {
  to: string
  label: string
  icon: IconDefinition
  permission: string | null
}

const QUICK_ACTIONS: QuickAction[] = [
  { to: '/patients', label: 'مريض جديد', icon: faUserPlus, permission: 'patients.manage' },
  { to: '/appointments', label: 'حجز موعد', icon: faCalendarPlus, permission: 'appointments.view' },
  { to: '/cash', label: 'مصروف / وارد', icon: faMoneyBillWave, permission: 'cash.manage' },
  { to: '/checks', label: 'استلام شيك', icon: faMoneyCheckDollar, permission: 'checks.manage' },
  { to: '/purchase-invoices', label: 'فاتورة شراء', icon: faFileInvoiceDollar, permission: 'purchasing.manage' },
  { to: '/items', label: 'صنف جديد', icon: faBoxesStacked, permission: 'inventory.manage' },
  { to: '/backups', label: 'نسخة احتياطية', icon: faDatabase, permission: 'settings.manage' },
]

interface Appointment {
  id: number
  time: string
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

interface TopDoctor {
  doctor_name: string | null
  total_ils: number
}

interface CheckAlert {
  id: number
  check_number: string
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

interface Summary {
  kpis: {
    today_appointments: number
    month_revenue_ils: number
    outstanding_balance_ils: number
    unsettled_commissions_ils: number
    cashboxes_total: number
    checks_due_soon: number
  }
  today_appointments: Appointment[]
  recent_invoices: Invoice[]
  top_doctors: TopDoctor[]
  alerts: {
    checks_due: CheckAlert[]
    expiring_lots: ExpiringLot[]
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
}

function money(value: number) {
  return new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 0 }).format(value)
}

export default function DashboardPage() {
  const { can } = useAuth()
  const [data, setData] = useState<Summary | null>(null)
  const [now, setNow] = useState(new Date())
  const [hideMoney, setHideMoney] = useState(() => localStorage.getItem('dashboard.hideMoney') === '1')

  useEffect(() => {
    api.get<Summary>('/dashboard/summary').then((res) => setData(res.data))
  }, [])

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  function toggleHideMoney() {
    setHideMoney((prev) => {
      localStorage.setItem('dashboard.hideMoney', prev ? '0' : '1')
      return !prev
    })
  }

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
              {now.toLocaleTimeString('ar-EG')}
            </div>
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        {QUICK_ACTIONS.filter((a) => a.permission === null || can(a.permission)).map((a) => (
          <Link
            key={a.to}
            to={a.to}
            className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-surface px-3 py-4 text-center shadow-sm transition-colors hover:border-accent hover:bg-accent-soft"
          >
            <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <FontAwesomeIcon icon={a.icon} />
            </span>
            <span className="text-xs font-medium text-ink/80">{a.label}</span>
          </Link>
        ))}
      </div>

      {!data ? (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
          <StatCard icon={faCalendarCheck} label="مواعيد اليوم" value={String(data.kpis.today_appointments)} />
          <StatCard
            icon={faSackDollar}
            label="إيرادات الشهر"
            value={`${money(data.kpis.month_revenue_ils)} ₪`}
            masked={hideMoney}
          />
          <StatCard
            icon={faFileInvoiceDollar}
            label="أرصدة المرضى المستحقة"
            value={`${money(data.kpis.outstanding_balance_ils)} ₪`}
            tone="danger"
            masked={hideMoney}
          />
          <StatCard
            icon={faUserDoctor}
            label="عمولات غير مسواة"
            value={`${money(data.kpis.unsettled_commissions_ils)} ₪`}
            tone="danger"
            masked={hideMoney}
          />
          <StatCard
            icon={faWallet}
            label="رصيد الصناديق"
            value={`${money(data.kpis.cashboxes_total)} ₪`}
            masked={hideMoney}
          />
          <StatCard
            icon={faMoneyCheckDollar}
            label="شيكات مستحقة قريباً"
            value={String(data.kpis.checks_due_soon)}
            tone="danger"
          />
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-ink/70">
            <FontAwesomeIcon icon={faTriangleExclamation} className="text-danger" />
            شيكات مستحقة خلال 7 أيام
          </h2>
          {!data ? (
            <TableSkeleton rows={3} cols={2} />
          ) : data.alerts.checks_due.length === 0 ? (
            <p className="py-4 text-sm text-muted">لا يوجد شيكات مستحقة قريباً</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.alerts.checks_due.map((c) => (
                <li key={c.id} className="flex items-center justify-between border-b border-border/70 pb-2 last:border-0">
                  <span className="text-ink/80">{c.check_number}</span>
                  <span className="text-muted">
                    {hideMoney ? '••••' : `${money(c.amount)} ${c.currency}`} — {new Date(c.due_date).toLocaleDateString('ar-EG')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-ink/70">
            <FontAwesomeIcon icon={faTriangleExclamation} className="text-danger" />
            أصناف قاربت على الانتهاء
          </h2>
          {!data ? (
            <TableSkeleton rows={3} cols={2} />
          ) : data.alerts.expiring_lots.length === 0 ? (
            <p className="py-4 text-sm text-muted">لا يوجد أصناف قاربت على الانتهاء</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.alerts.expiring_lots.map((l, idx) => (
                <li key={idx} className="flex items-center justify-between border-b border-border/70 pb-2 last:border-0">
                  <span className="text-ink/80">
                    {l.item_name} <span className="text-muted">({l.lot_number})</span>
                  </span>
                  <span className="text-muted">{new Date(l.expiry_date).toLocaleDateString('ar-EG')}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="p-5 pb-0 text-sm font-medium text-ink/70">مواعيد اليوم</h2>
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
                {data.today_appointments.length === 0 ? (
                  <EmptyRow colSpan={4}>لا يوجد مواعيد اليوم</EmptyRow>
                ) : (
                  data.today_appointments.map((a) => (
                    <Tr key={a.id}>
                      <Td className="font-mono">{a.time}</Td>
                      <Td>{a.patient_name}</Td>
                      <Td>{a.doctor_name}</Td>
                      <Td>
                        <Badge variant={statusVariants[a.status] ?? 'neutral'}>{statusLabels[a.status] ?? a.status}</Badge>
                      </Td>
                    </Tr>
                  ))
                )}
              </tbody>
            </Table>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-medium text-ink/70">أعلى الأطباء (هذا الشهر)</h2>
          {!data ? (
            <TableSkeleton rows={4} cols={2} />
          ) : data.top_doctors.length === 0 ? (
            <p className="py-4 text-sm text-muted">لا توجد بيانات بعد</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.top_doctors.map((d, idx) => (
                <li key={idx} className="flex items-center justify-between border-b border-border/70 pb-2 last:border-0">
                  <span className="text-ink/80">{d.doctor_name}</span>
                  <span className="text-muted">{hideMoney ? '••••' : `${money(d.total_ils)} ₪`}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <h2 className="p-5 pb-0 text-sm font-medium text-ink/70">آخر الفواتير</h2>
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
              {data.recent_invoices.length === 0 ? (
                <EmptyRow colSpan={5}>لا توجد فواتير بعد</EmptyRow>
              ) : (
                data.recent_invoices.map((inv) => (
                  <Tr key={inv.id}>
                    <Td>{inv.invoice_number}</Td>
                    <Td>{inv.patient_name}</Td>
                    <Td>{hideMoney ? '••••' : `${money(inv.total_amount_ils)} ₪`}</Td>
                    <Td>
                      <Badge variant={statusVariants[inv.status] ?? 'neutral'}>{statusLabels[inv.status] ?? inv.status}</Badge>
                    </Td>
                    <Td className="text-muted">{new Date(inv.issued_at).toLocaleDateString('ar-EG')}</Td>
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
