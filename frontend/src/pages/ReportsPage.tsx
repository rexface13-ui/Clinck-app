import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import DatePicker from '../components/DatePicker'
import { Card, PageHeader, Tabs, Modal, Table, Thead, Th, Td, Tr } from '../components/ui'

/** Shared "from/to" range picker for the reports that support server-side date filtering. Empty values mean "all time". */
function DateRangeFilter({ from, to, onFrom, onTo }: { from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void }) {
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <div>
        <label className="mb-1 block text-xs text-muted">من تاريخ</label>
        <DatePicker value={from} onChange={onFrom} allowClear />
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted">إلى تاريخ</label>
        <DatePicker value={to} onChange={onTo} allowClear />
      </div>
      {(from || to) && (
        <button
          onClick={() => {
            onFrom('')
            onTo('')
          }}
          className="rounded-lg border border-border px-3 py-2 text-xs text-ink/60 hover:bg-background"
        >
          مسح الفلتر (كل الوقت)
        </button>
      )}
    </div>
  )
}

const MONTHS_OPTIONS = [3, 6, 12]

function MonthsFilter({ months, onChange }: { months: number; onChange: (n: number) => void }) {
  return (
    <div className="mb-4 flex gap-2">
      {MONTHS_OPTIONS.map((n) => (
        <button
          key={n}
          onClick={() => onChange(n)}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
            months === n ? 'border-accent bg-accent text-white' : 'border-border text-ink/60 hover:bg-background'
          }`}
        >
          آخر {n} أشهر
        </button>
      ))}
    </div>
  )
}

function money(n: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n)
}

/** Simple vertical bar chart — no charting library, just divs sized by percentage of the max value. Bars are clickable when onBarClick is passed, for drill-down. */
function BarChart({
  bars,
  formatValue,
  onBarClick,
  activeIndex,
}: {
  bars: { label: string; value: number; sub?: number }[]
  formatValue?: (n: number) => string
  onBarClick?: (index: number) => void
  activeIndex?: number | null
}) {
  const max = Math.max(1, ...bars.map((b) => Math.max(b.value, b.sub ?? 0)))
  const fmt = formatValue ?? ((n: number) => money(n))
  return (
    <div className="flex items-end gap-3 overflow-x-auto pb-2" style={{ minHeight: 180 }}>
      {bars.map((b, i) => (
        <button
          key={b.label}
          onClick={() => onBarClick?.(i)}
          disabled={!onBarClick}
          className={`flex min-w-[56px] flex-1 flex-col items-center gap-1.5 rounded-lg py-1 transition-colors ${
            onBarClick ? 'cursor-pointer hover:bg-background' : ''
          } ${activeIndex === i ? 'bg-background' : ''}`}
        >
          <div className="flex h-36 w-full items-end justify-center gap-1">
            <div
              title={fmt(b.value)}
              className="w-3.5 rounded-t-md bg-accent transition-all"
              style={{ height: `${Math.max(2, (b.value / max) * 100)}%` }}
            />
            {b.sub !== undefined && (
              <div
                title={fmt(b.sub)}
                className="w-3.5 rounded-t-md bg-accent/30 transition-all"
                style={{ height: `${Math.max(2, (b.sub / max) * 100)}%` }}
              />
            )}
          </div>
          <span className={`text-center text-[11px] ${activeIndex === i ? 'font-semibold text-accent' : 'text-muted'}`}>{b.label}</span>
        </button>
      ))}
    </div>
  )
}

function RevenueTab() {
  const [monthsCount, setMonthsCount] = useState(6)
  const [months, setMonths] = useState<{ month: string; label: string; total_ils: number }[]>([])
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const [detail, setDetail] = useState<{ service_name: string; total_ils: number }[] | null>(null)

  useEffect(() => {
    api.get('/reports/revenue', { params: { months: monthsCount } }).then((res) => setMonths(res.data.months))
    setOpenIndex(null)
    setDetail(null)
  }, [monthsCount])

  function toggleMonth(index: number) {
    if (openIndex === index) {
      setOpenIndex(null)
      setDetail(null)
      return
    }
    setOpenIndex(index)
    setDetail(null)
    const m = months[index]
    const [y, mo] = m.month.split('-').map(Number)
    const from = `${m.month}-01`
    const to = new Date(y, mo, 0).toISOString().slice(0, 10)
    api.get('/reports/revenue-by-service', { params: { from, to } }).then((res) => setDetail(res.data.services))
  }

  const last = months[months.length - 1]
  const prev = months[months.length - 2]
  const diff = last && prev ? last.total_ils - prev.total_ils : null
  const diffPct = last && prev && prev.total_ils > 0 ? Math.round((diff! / prev.total_ils) * 100) : null

  return (
    <Card className="p-6">
      <MonthsFilter months={monthsCount} onChange={setMonthsCount} />
      <div className="mb-4 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-ink/80">إيرادات آخر {monthsCount} أشهر</h3>
        {diff !== null && (
          <span className={`text-sm font-medium ${diff >= 0 ? 'text-success' : 'text-danger'}`}>
            {diff >= 0 ? '▲' : '▼'} {money(Math.abs(diff))} ₪ {diffPct !== null && `(${diffPct >= 0 ? '+' : ''}${diffPct}%)`} عن الشهر الماضي
          </span>
        )}
      </div>
      <BarChart
        bars={months.map((m) => ({ label: m.label, value: m.total_ils }))}
        formatValue={(n) => `${money(n)} ₪`}
        onBarClick={toggleMonth}
        activeIndex={openIndex}
      />
      {openIndex !== null && (
        <div className="mt-4 rounded-xl bg-background p-4">
          <h4 className="mb-3 text-xs font-semibold text-ink/70">تفاصيل إيرادات {months[openIndex].label} حسب الخدمة</h4>
          {!detail ? (
            <p className="text-xs text-muted">جارِ التحميل...</p>
          ) : detail.length === 0 ? (
            <p className="text-xs text-muted">لا توجد إيرادات هالشهر.</p>
          ) : (
            <div className="space-y-2">
              {detail.map((s) => (
                <div key={s.service_name} className="flex items-center justify-between text-xs">
                  <span className="text-ink/80">{s.service_name}</span>
                  <span className="font-medium text-ink">{money(s.total_ils)} ₪</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

function RevenueByServiceTab() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [services, setServices] = useState<{ service_name: string; total_ils: number }[]>([])

  useEffect(() => {
    api.get('/reports/revenue-by-service', { params: { from: from || undefined, to: to || undefined } }).then((res) => setServices(res.data.services))
  }, [from, to])

  const total = services.reduce((s, x) => s + x.total_ils, 0)

  return (
    <Card className="p-6">
      <DateRangeFilter from={from} to={to} onFrom={setFrom} onTo={setTo} />
      <h3 className="mb-4 text-sm font-semibold text-ink/80">الإيرادات حسب الخدمة {from || to ? '' : '(كل الوقت)'}</h3>
      {services.length === 0 ? (
        <p className="text-sm text-muted">لا توجد بيانات بعد.</p>
      ) : (
        <div className="space-y-3">
          {services.map((s) => (
            <div key={s.service_name}>
              <div className="mb-1 flex justify-between text-sm">
                <span className="text-ink/80">{s.service_name}</span>
                <span className="text-muted">{money(s.total_ils)} ₪ ({total > 0 ? Math.round((s.total_ils / total) * 100) : 0}%)</span>
              </div>
              <div className="h-2 w-full rounded-full bg-background">
                <div className="h-2 rounded-full bg-accent" style={{ width: `${total > 0 ? (s.total_ils / total) * 100 : 0}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function DoctorProductivityTab() {
  const navigate = useNavigate()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [doctors, setDoctors] = useState<{ doctor_id: number; doctor_name: string; sessions_count: number; revenue_ils: number; commission_ils: number }[]>([])

  useEffect(() => {
    api.get('/reports/doctor-productivity', { params: { from: from || undefined, to: to || undefined } }).then((res) => setDoctors(res.data.doctors))
  }, [from, to])

  return (
    <Card className="p-6">
      <DateRangeFilter from={from} to={to} onFrom={setFrom} onTo={setTo} />
      <h3 className="mb-1 text-sm font-semibold text-ink/80">إنتاجية الأطباء {from || to ? '' : '(كل الوقت)'}</h3>
      <p className="mb-4 text-xs text-muted">اضغط طبيب لتشوف كشف حسابه بالتفصيل.</p>
      {doctors.length === 0 ? (
        <p className="text-sm text-muted">لا يوجد أطباء نشيطين.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-right text-muted">
                <th className="p-2 font-medium">الطبيب</th>
                <th className="p-2 font-medium">عدد الجلسات</th>
                <th className="p-2 font-medium">الإيراد</th>
                <th className="p-2 font-medium">العمولة</th>
              </tr>
            </thead>
            <tbody>
              {doctors.map((d) => (
                <tr
                  key={d.doctor_id}
                  onClick={() => navigate(`/commissions?doctor_id=${d.doctor_id}`)}
                  className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-background"
                >
                  <td className="p-2 text-accent">{d.doctor_name}</td>
                  <td className="p-2 text-muted">{d.sessions_count}</td>
                  <td className="p-2 text-ink">{money(d.revenue_ils)} ₪</td>
                  <td className="p-2 text-muted">{money(d.commission_ils)} ₪</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function PatientsTab() {
  const [monthsCount, setMonthsCount] = useState(6)
  const [months, setMonths] = useState<{ month: string; label: string; new_patients: number; returning_patients: number }[]>([])

  useEffect(() => {
    api.get('/reports/patients', { params: { months: monthsCount } }).then((res) => setMonths(res.data.months))
  }, [monthsCount])

  return (
    <Card className="p-6">
      <MonthsFilter months={monthsCount} onChange={setMonthsCount} />
      <h3 className="mb-1 text-sm font-semibold text-ink/80">مرضى جدد مقابل عائدين — آخر {monthsCount} أشهر</h3>
      <p className="mb-4 text-xs text-muted">العمود الداكن = مرضى جدد، الفاتح = مرضى عائدين (زاروا هالشهر وكانوا مسجّلين قبل)</p>
      <BarChart bars={months.map((m) => ({ label: m.label, value: m.new_patients, sub: m.returning_patients }))} formatValue={(n) => `${n}`} />
    </Card>
  )
}

function NoShowTab() {
  const navigate = useNavigate()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [data, setData] = useState<{
    overall: { total: number; no_show: number; rate: number }
    by_doctor: { doctor_id: number | null; doctor_name: string; total: number; no_show: number; rate: number }[]
  } | null>(null)

  useEffect(() => {
    api.get('/reports/no-show', { params: { from: from || undefined, to: to || undefined } }).then((res) => setData(res.data))
  }, [from, to])

  return (
    <Card className="p-6">
      <DateRangeFilter from={from} to={to} onFrom={setFrom} onTo={setTo} />
      {!data ? (
        <p className="text-sm text-muted">جارِ التحميل...</p>
      ) : (
        <>
      <h3 className="mb-4 text-sm font-semibold text-ink/80">نسبة الغياب عن الموعد {from || to ? '' : '(كل الوقت)'}</h3>
      <div className="mb-6 flex items-center gap-4 rounded-xl bg-background p-4">
        <span className={`text-3xl font-bold ${data.overall.rate > 15 ? 'text-danger' : 'text-success'}`}>{data.overall.rate}%</span>
        <span className="text-sm text-muted">{data.overall.no_show} غياب من أصل {data.overall.total} موعد (منجز أو غياب)</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-right text-muted">
            <th className="p-2 font-medium">الطبيب</th>
            <th className="p-2 font-medium">الإجمالي</th>
            <th className="p-2 font-medium">غياب</th>
            <th className="p-2 font-medium">النسبة</th>
          </tr>
        </thead>
        <tbody>
          {data.by_doctor.map((d) => (
            <tr
              key={d.doctor_id ?? 'none'}
              onClick={() => d.doctor_id && navigate(`/appointments?doctor_id=${d.doctor_id}`)}
              className={`border-b border-border/60 last:border-0 ${d.doctor_id ? 'cursor-pointer hover:bg-background' : ''}`}
            >
              <td className={`p-2 ${d.doctor_id ? 'text-accent' : 'text-ink'}`}>{d.doctor_name}</td>
              <td className="p-2 text-muted">{d.total}</td>
              <td className="p-2 text-muted">{d.no_show}</td>
              <td className={`p-2 font-medium ${d.rate > 15 ? 'text-danger' : 'text-ink/70'}`}>{d.rate}%</td>
            </tr>
          ))}
        </tbody>
      </table>
        </>
      )}
    </Card>
  )
}

interface DebtBucket {
  bucket: string
  patients_count: number
  total_ils: number
  patients: { patient_id: number; patient_name: string; balance_ils: number; days: number }[]
}

function DebtsAgingTab() {
  const [buckets, setBuckets] = useState<DebtBucket[]>([])
  const [openBucket, setOpenBucket] = useState<DebtBucket | null>(null)
  const bucketLabels: Record<string, string> = { '0-30': '0-30 يوم', '31-60': '31-60 يوم', '61-90': '61-90 يوم', '90+': 'أكتر من 90 يوم' }

  useEffect(() => {
    api.get('/reports/debts-aging').then((res) => setBuckets(res.data.buckets))
  }, [])

  return (
    <Card className="p-6">
      <h3 className="mb-1 text-sm font-semibold text-ink/80">أعمار الديون — كل يوم من متى الدين مستحق</h3>
      <p className="mb-4 text-xs text-muted">اضغط أي فئة لتشوف تفاصيل المرضى.</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {buckets.map((b) => (
          <button
            key={b.bucket}
            onClick={() => b.patients_count > 0 && setOpenBucket(b)}
            disabled={b.patients_count === 0}
            className={`rounded-xl p-4 text-right transition-transform ${
              b.patients_count > 0 ? 'cursor-pointer hover:scale-[1.02]' : 'cursor-default'
            } ${b.bucket === '90+' && b.total_ils > 0 ? 'bg-danger-soft' : 'bg-background'}`}
          >
            <p className="text-xs text-muted">{bucketLabels[b.bucket]}</p>
            <p className={`mt-1 text-lg font-semibold ${b.bucket === '90+' && b.total_ils > 0 ? 'text-danger' : 'text-ink'}`}>{money(b.total_ils)} ₪</p>
            <p className="text-xs text-muted">{b.patients_count} مريض</p>
          </button>
        ))}
      </div>

      {openBucket && (
        <Modal title={`مرضى — ${bucketLabels[openBucket.bucket]}`} onClose={() => setOpenBucket(null)} width="w-[560px]">
          <Table>
            <Thead>
              <Th>المريض</Th>
              <Th>المبلغ المستحق</Th>
              <Th>عدد الأيام</Th>
            </Thead>
            <tbody>
              {openBucket.patients.map((p) => (
                <Tr key={p.patient_id}>
                  <Td>
                    <Link to={`/patients/${p.patient_id}`} className="text-accent hover:underline">
                      {p.patient_name}
                    </Link>
                  </Td>
                  <Td className="font-medium text-danger">{money(p.balance_ils)} ₪</Td>
                  <Td className="text-muted">{p.days} يوم</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Modal>
      )}
    </Card>
  )
}

function CollectionsTab() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [methods, setMethods] = useState<{ method: string; label: string; total_ils: number }[]>([])

  useEffect(() => {
    api.get('/reports/collections', { params: { from: from || undefined, to: to || undefined } }).then((res) => setMethods(res.data.methods))
  }, [from, to])

  const total = methods.reduce((s, m) => s + m.total_ils, 0)

  return (
    <Card className="p-6">
      <DateRangeFilter from={from} to={to} onFrom={setFrom} onTo={setTo} />
      <h3 className="mb-4 text-sm font-semibold text-ink/80">طرق التحصيل {from || to ? '' : '(كل الوقت)'}</h3>
      {methods.length === 0 ? (
        <p className="text-sm text-muted">لا توجد تحصيلات بعد.</p>
      ) : (
        <div className="space-y-3">
          {methods.map((m) => (
            <div key={m.method}>
              <div className="mb-1 flex justify-between text-sm">
                <span className="text-ink/80">{m.label}</span>
                <span className="text-muted">{money(m.total_ils)} ₪ ({total > 0 ? Math.round((m.total_ils / total) * 100) : 0}%)</span>
              </div>
              <div className="h-2 w-full rounded-full bg-background">
                <div className="h-2 rounded-full bg-accent" style={{ width: `${total > 0 ? (m.total_ils / total) * 100 : 0}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

export default function ReportsPage() {
  return (
    <div>
      <PageHeader title="التقارير" subtitle="نظرة شاملة على أداء العيادة المالي والسريري" />
      <Tabs
        defaultTab="revenue"
        tabs={[
          { key: 'revenue', label: 'إيرادات الشهر', content: <RevenueTab /> },
          { key: 'by-service', label: 'حسب الخدمة', content: <RevenueByServiceTab /> },
          { key: 'doctors', label: 'إنتاجية الأطباء', content: <DoctorProductivityTab /> },
          { key: 'patients', label: 'مرضى جدد/عائدين', content: <PatientsTab /> },
          { key: 'no-show', label: 'نسبة الغياب', content: <NoShowTab /> },
          { key: 'debts', label: 'أعمار الديون', content: <DebtsAgingTab /> },
          { key: 'collections', label: 'طرق التحصيل', content: <CollectionsTab /> },
        ]}
      />
    </div>
  )
}
