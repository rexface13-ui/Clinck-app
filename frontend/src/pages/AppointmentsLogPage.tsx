import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faMagnifyingGlass, faCalendarDays } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { formatDate, formatTime } from '../lib/formatDate'
import DatePicker from '../components/DatePicker'
import AppointmentDetailModal from '../components/AppointmentDetailModal'
import { Card, PageHeader, Select, Badge, Table, Thead, Th, Td, Tr, EmptyRow, TableSkeleton } from '../components/ui'
import type { BadgeVariant } from '../components/ui'
import type { Appointment } from '../types'

const STATUS_VARIANTS: Record<Appointment['status'], BadgeVariant> = {
  scheduled: 'info',
  confirmed: 'accent',
  done: 'success',
  cancelled: 'danger',
  no_show: 'warning',
}

const STATUS_LABELS: Record<Appointment['status'], string> = {
  scheduled: 'مجدول',
  confirmed: 'مؤكد',
  done: 'حضر',
  cancelled: 'ملغى',
  no_show: 'لم يحضر (مؤجل)',
}

function daysAgoIso(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function todayIso(): string {
  return daysAgoIso(0)
}

export default function AppointmentsLogPage() {
  const [from, setFrom] = useState(daysAgoIso(30))
  const [to, setTo] = useState(todayIso())
  const [status, setStatus] = useState<'all' | Appointment['status']>('all')
  const [search, setSearch] = useState('')
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [openAppointmentId, setOpenAppointmentId] = useState<number | null>(null)

  function loadAppointments() {
    setLoading(true)
    api
      .get('/appointments', {
        params: {
          from: `${from}T00:00:00Z`,
          to: `${to}T23:59:59Z`,
          status: status === 'all' ? undefined : status,
          search: search.trim() || undefined,
        },
      })
      .then((res) => setAppointments(res.data.data))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    const id = setTimeout(loadAppointments, 250)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, status, search])

  return (
    <div>
      <PageHeader
        title="سجل المواعيد"
        subtitle="كل المواعيد بكل حالاتها — حضور، إلغاء، عدم حضور"
        action={
          <Link
            to="/appointments"
            className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-ink/70 hover:border-accent hover:text-accent"
          >
            <FontAwesomeIcon icon={faCalendarDays} />
            رجوع للمواعيد
          </Link>
        }
      />

      <Card className="mb-6 flex flex-wrap items-end gap-4 p-4">
        <div className="w-40">
          <label className="mb-1 block text-xs text-muted">من تاريخ</label>
          <DatePicker value={from} onChange={(iso) => iso && setFrom(iso)} allowClear={false} />
        </div>
        <div className="w-40">
          <label className="mb-1 block text-xs text-muted">إلى تاريخ</label>
          <DatePicker value={to} onChange={(iso) => iso && setTo(iso)} allowClear={false} />
        </div>
        <Select label="الحالة" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="w-48">
          <option value="all">كل الحالات</option>
          <option value="done">حضر</option>
          <option value="cancelled">ملغى</option>
          <option value="no_show">لم يحضر (مؤجل)</option>
          <option value="scheduled">مجدول</option>
          <option value="confirmed">مؤكد</option>
        </Select>
        <div className="relative flex-1 min-w-48">
          <label className="mb-1 block text-xs text-muted">بحث بالمريض</label>
          <FontAwesomeIcon icon={faMagnifyingGlass} className="absolute right-3 top-[34px] text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="اسم المريض..."
            className="w-full rounded-xl border border-border bg-surface py-2 pe-3 ps-9 text-sm focus:border-accent focus:outline-none"
          />
        </div>
      </Card>

      <Card>
        {loading ? (
          <TableSkeleton />
        ) : (
          <Table>
            <Thead>
              <Th>التاريخ</Th>
              <Th>الوقت</Th>
              <Th>المريض</Th>
              <Th>الطبيب</Th>
              <Th>الحالة</Th>
            </Thead>
            <tbody>
              {appointments.length === 0 ? (
                <EmptyRow colSpan={5}>لا يوجد مواعيد بهذه الفترة/الفلتر</EmptyRow>
              ) : (
                appointments.map((a) => (
                  <Tr key={a.id} onClick={() => setOpenAppointmentId(a.id)} className="cursor-pointer">
                    <Td>{formatDate(a.starts_at)}</Td>
                    <Td className="font-mono">{formatTime(a.starts_at)}</Td>
                    <Td>{a.patient_name}</Td>
                    <Td>{a.doctor_name ?? 'بدون طبيب محدد'}</Td>
                    <Td>
                      <Badge variant={STATUS_VARIANTS[a.status]}>{STATUS_LABELS[a.status]}</Badge>
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Table>
        )}
      </Card>

      {openAppointmentId && (
        <AppointmentDetailModal
          appointmentId={openAppointmentId}
          onClose={() => setOpenAppointmentId(null)}
          onChanged={loadAppointments}
        />
      )}
    </div>
  )
}
