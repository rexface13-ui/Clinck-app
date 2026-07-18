import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { Card, PageHeader, Badge, Button, Table, Thead, Th, Td, Tr, EmptyRow } from '../components/ui'
import type { CommissionStatement, Doctor } from '../types'

const MONTH_LABELS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
]

function currentYear(): number {
  return new Date().getFullYear()
}

function currentMonthNum(): number {
  return new Date().getMonth() + 1
}

export default function CommissionsPage() {
  const { can } = useAuth()
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [doctorId, setDoctorId] = useState<number | null>(null)
  const [year, setYear] = useState(currentYear())
  const [monthNum, setMonthNum] = useState(currentMonthNum())
  const month = `${year}-${String(monthNum).padStart(2, '0')}`
  const [statement, setStatement] = useState<CommissionStatement | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.get('/doctors').then((res) => {
      setDoctors(res.data.data)
      if (res.data.data.length > 0) setDoctorId(res.data.data[0].id)
    })
  }, [])

  function load() {
    if (!doctorId) return
    api.get(`/doctors/${doctorId}/commission-statement`, { params: { month: `${month}-01` } }).then((res) => setStatement(res.data))
  }

  useEffect(load, [doctorId, month])

  async function settle() {
    if (!doctorId) return
    setBusy(true)
    try {
      await api.post(`/doctors/${doctorId}/commission-statement/settle`, { month: `${month}-01` })
      load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader title="كشف عمولات الأطباء" subtitle="متابعة وتسوية العمولات الشهرية" />

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
          <Card className="mb-6 flex items-center justify-between p-6">
            <div>
              <p className="text-sm text-muted">إجمالي عمولات {statement.doctor.full_name} — {statement.month}</p>
              <p className="text-2xl font-semibold text-ink">{statement.total_ils.toFixed(2)} ₪</p>
            </div>
            {can('commissions.view') && (
              <div className="text-end">
                <div className="mb-2">
                  <Badge variant={statement.settled ? 'success' : 'danger'}>
                    {statement.settled ? 'مُسوّى' : 'غير مُسوّى'}
                  </Badge>
                </div>
                {!statement.settled && statement.transactions.length > 0 && (
                  <Button onClick={settle} loading={busy}>
                    تسوية الشهر
                  </Button>
                )}
              </div>
            )}
          </Card>

          <Card>
            <Table>
              <Thead>
                <Th>المريض</Th>
                <Th>السن</Th>
                <Th>المبلغ</Th>
                <Th>التسوية</Th>
              </Thead>
              <tbody>
                {statement.transactions.length === 0 ? (
                  <EmptyRow colSpan={4}>لا توجد عمولات لهذا الشهر.</EmptyRow>
                ) : (
                  statement.transactions.map((t) => (
                    <Tr key={t.id}>
                      <Td>{t.patient_name}</Td>
                      <Td className="text-muted">{t.tooth_number ?? '—'}</Td>
                      <Td className="text-muted">{t.amount_ils} ₪</Td>
                      <Td className="text-muted">{t.settled_at ?? '—'}</Td>
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
