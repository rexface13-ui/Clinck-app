import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faUsers, faTruck, faMoneyCheckDollar, faArrowLeft } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { PageHeader, Card, Table, Thead, Th, Td, Tr, EmptyRow } from '../components/ui'
import SuppliersPage from './SuppliersPage'
import ChecksPage from './ChecksPage'

type Tab = 'patients' | 'suppliers' | 'checks'

interface PatientDebt {
  patient_id: number
  code: string | null
  full_name: string | null
  phone: string | null
  outstanding_ils: number
}

function PatientsDebtTab() {
  const [rows, setRows] = useState<PatientDebt[] | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    api.get('/debts/patients').then((res) => setRows(res.data))
  }, [])

  const filtered = (rows ?? []).filter((r) => {
    const q = query.trim()
    if (!q) return true
    return (r.full_name ?? '').includes(q) || (r.phone ?? '').includes(q) || (r.code ?? '').includes(q)
  })

  const total = filtered.reduce((s, r) => s + r.outstanding_ils, 0)

  return (
    <Card>
      <div className="flex items-center justify-between p-6 pb-0">
        <h2 className="text-sm font-semibold text-ink/80">الزبائن الذين لهم دين على العيادة</h2>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="بحث بالاسم أو الهاتف..."
          className="w-64 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
        />
      </div>
      <p className="px-6 pt-3 text-sm text-muted">
        إجمالي الديون: <span className="font-semibold text-danger">{total.toFixed(2)} ₪</span>
      </p>
      <Table>
        <Thead>
          <Th>الكود</Th>
          <Th>الاسم</Th>
          <Th>الهاتف</Th>
          <Th>المبلغ المستحق</Th>
          <Th></Th>
        </Thead>
        <tbody>
          {rows === null ? (
            <EmptyRow colSpan={5}>جارِ التحميل...</EmptyRow>
          ) : filtered.length === 0 ? (
            <EmptyRow colSpan={5}>ما في زبائن عليهم دين حالياً.</EmptyRow>
          ) : (
            filtered.map((r) => (
              <Tr key={r.patient_id}>
                <Td className="text-muted">{r.code}</Td>
                <Td>{r.full_name}</Td>
                <Td className="text-muted">{r.phone ?? '—'}</Td>
                <Td className="font-semibold text-danger">{r.outstanding_ils.toFixed(2)} ₪</Td>
                <Td>
                  <Link
                    to={`/patients/${r.patient_id}?pay=1`}
                    className="flex items-center gap-1 text-xs text-accent hover:underline"
                  >
                    التفاصيل والتحصيل
                    <FontAwesomeIcon icon={faArrowLeft} />
                  </Link>
                </Td>
              </Tr>
            ))
          )}
        </tbody>
      </Table>
    </Card>
  )
}

const TABS: { key: Tab; label: string; icon: typeof faUsers }[] = [
  { key: 'patients', label: 'الزبائن', icon: faUsers },
  { key: 'suppliers', label: 'الموردون', icon: faTruck },
  { key: 'checks', label: 'الشيكات', icon: faMoneyCheckDollar },
]

export default function DebtsPage() {
  const [tab, setTab] = useState<Tab>('patients')

  return (
    <div>
      <PageHeader title="دفتر الديون" subtitle="كل شيء مالي بمكان واحد — الزبائن، الموردون، والشيكات" />

      <div className="mb-6 flex gap-1 rounded-xl border border-border bg-surface p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition-colors ${
              tab === t.key ? 'bg-accent text-white' : 'text-ink/60 hover:bg-background'
            }`}
          >
            <FontAwesomeIcon icon={t.icon} />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'patients' && <PatientsDebtTab />}
      {tab === 'suppliers' && <SuppliersPage />}
      {tab === 'checks' && <ChecksPage />}
    </div>
  )
}
