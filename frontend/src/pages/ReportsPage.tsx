import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Card, PageHeader, Tabs } from '../components/ui'

function money(n: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n)
}

/** Simple vertical bar chart — no charting library, just divs sized by percentage of the max value. */
function BarChart({ bars, formatValue }: { bars: { label: string; value: number; sub?: number }[]; formatValue?: (n: number) => string }) {
  const max = Math.max(1, ...bars.map((b) => Math.max(b.value, b.sub ?? 0)))
  const fmt = formatValue ?? ((n: number) => money(n))
  return (
    <div className="flex items-end gap-3 overflow-x-auto pb-2" style={{ minHeight: 180 }}>
      {bars.map((b) => (
        <div key={b.label} className="flex min-w-[56px] flex-1 flex-col items-center gap-1.5">
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
          <span className="text-center text-[11px] text-muted">{b.label}</span>
        </div>
      ))}
    </div>
  )
}

function RevenueTab() {
  const [months, setMonths] = useState<{ month: string; label: string; total_ils: number }[]>([])

  useEffect(() => {
    api.get('/reports/revenue', { params: { months: 6 } }).then((res) => setMonths(res.data.months))
  }, [])

  const last = months[months.length - 1]
  const prev = months[months.length - 2]
  const diff = last && prev ? last.total_ils - prev.total_ils : null
  const diffPct = last && prev && prev.total_ils > 0 ? Math.round((diff! / prev.total_ils) * 100) : null

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-ink/80">إيرادات آخر 6 أشهر</h3>
        {diff !== null && (
          <span className={`text-sm font-medium ${diff >= 0 ? 'text-success' : 'text-danger'}`}>
            {diff >= 0 ? '▲' : '▼'} {money(Math.abs(diff))} ₪ {diffPct !== null && `(${diffPct >= 0 ? '+' : ''}${diffPct}%)`} عن الشهر الماضي
          </span>
        )}
      </div>
      <BarChart bars={months.map((m) => ({ label: m.label, value: m.total_ils }))} formatValue={(n) => `${money(n)} ₪`} />
    </Card>
  )
}

function RevenueByServiceTab() {
  const [services, setServices] = useState<{ service_name: string; total_ils: number }[]>([])

  useEffect(() => {
    api.get('/reports/revenue-by-service').then((res) => setServices(res.data.services))
  }, [])

  const total = services.reduce((s, x) => s + x.total_ils, 0)

  return (
    <Card className="p-6">
      <h3 className="mb-4 text-sm font-semibold text-ink/80">الإيرادات حسب الخدمة (كل الوقت)</h3>
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
  const [doctors, setDoctors] = useState<{ doctor_id: number; doctor_name: string; sessions_count: number; revenue_ils: number; commission_ils: number }[]>([])

  useEffect(() => {
    api.get('/reports/doctor-productivity').then((res) => setDoctors(res.data.doctors))
  }, [])

  return (
    <Card className="p-6">
      <h3 className="mb-4 text-sm font-semibold text-ink/80">إنتاجية الأطباء (كل الوقت)</h3>
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
                <tr key={d.doctor_id} className="border-b border-border/60 last:border-0">
                  <td className="p-2 text-ink">{d.doctor_name}</td>
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
  const [months, setMonths] = useState<{ month: string; label: string; new_patients: number; returning_patients: number }[]>([])

  useEffect(() => {
    api.get('/reports/patients', { params: { months: 6 } }).then((res) => setMonths(res.data.months))
  }, [])

  return (
    <Card className="p-6">
      <h3 className="mb-1 text-sm font-semibold text-ink/80">مرضى جدد مقابل عائدين — آخر 6 أشهر</h3>
      <p className="mb-4 text-xs text-muted">العمود الداكن = مرضى جدد، الفاتح = مرضى عائدين (زاروا هالشهر وكانوا مسجّلين قبل)</p>
      <BarChart bars={months.map((m) => ({ label: m.label, value: m.new_patients, sub: m.returning_patients }))} formatValue={(n) => `${n}`} />
    </Card>
  )
}

function NoShowTab() {
  const [data, setData] = useState<{
    overall: { total: number; no_show: number; rate: number }
    by_doctor: { doctor_id: number | null; doctor_name: string; total: number; no_show: number; rate: number }[]
  } | null>(null)

  useEffect(() => {
    api.get('/reports/no-show').then((res) => setData(res.data))
  }, [])

  if (!data) return <Card className="p-6 text-sm text-muted">جارِ التحميل...</Card>

  return (
    <Card className="p-6">
      <h3 className="mb-4 text-sm font-semibold text-ink/80">نسبة الغياب عن الموعد (كل الوقت)</h3>
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
            <tr key={d.doctor_id ?? 'none'} className="border-b border-border/60 last:border-0">
              <td className="p-2 text-ink">{d.doctor_name}</td>
              <td className="p-2 text-muted">{d.total}</td>
              <td className="p-2 text-muted">{d.no_show}</td>
              <td className={`p-2 font-medium ${d.rate > 15 ? 'text-danger' : 'text-ink/70'}`}>{d.rate}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

function DebtsAgingTab() {
  const [buckets, setBuckets] = useState<{ bucket: string; patients_count: number; total_ils: number }[]>([])
  const bucketLabels: Record<string, string> = { '0-30': '0-30 يوم', '31-60': '31-60 يوم', '61-90': '61-90 يوم', '90+': 'أكتر من 90 يوم' }

  useEffect(() => {
    api.get('/reports/debts-aging').then((res) => setBuckets(res.data.buckets))
  }, [])

  return (
    <Card className="p-6">
      <h3 className="mb-4 text-sm font-semibold text-ink/80">أعمار الديون — كل يوم من متى الدين مستحق</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {buckets.map((b) => (
          <div key={b.bucket} className={`rounded-xl p-4 ${b.bucket === '90+' && b.total_ils > 0 ? 'bg-danger-soft' : 'bg-background'}`}>
            <p className="text-xs text-muted">{bucketLabels[b.bucket]}</p>
            <p className={`mt-1 text-lg font-semibold ${b.bucket === '90+' && b.total_ils > 0 ? 'text-danger' : 'text-ink'}`}>{money(b.total_ils)} ₪</p>
            <p className="text-xs text-muted">{b.patients_count} مريض</p>
          </div>
        ))}
      </div>
    </Card>
  )
}

function CollectionsTab() {
  const [methods, setMethods] = useState<{ method: string; label: string; total_ils: number }[]>([])

  useEffect(() => {
    api.get('/reports/collections').then((res) => setMethods(res.data.methods))
  }, [])

  const total = methods.reduce((s, m) => s + m.total_ils, 0)

  return (
    <Card className="p-6">
      <h3 className="mb-4 text-sm font-semibold text-ink/80">طرق التحصيل (كل الوقت)</h3>
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
