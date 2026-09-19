import { useEffect, useMemo, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowDown, faArrowUp, faMagnifyingGlass, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import DatePicker from './DatePicker'
import { Card, Badge } from './ui'

interface FlowRow {
  key: string
  occurred_at: string
  source: 'cashbox' | 'check'
  direction: 'in' | 'out'
  method: 'cash' | 'card' | 'transfer' | 'check'
  method_label: string
  category: string
  party: string | null
  description: string | null
  cashbox: string | null
  currency: string
  amount: number
  amount_ils: number | null
  status: string | null
  status_label?: string
  counted: boolean
}

interface MoneyFlow {
  totals: {
    in_ils: number
    out_ils: number
    net_ils: number
    in_by_method: Record<string, number>
    out_by_method: Record<string, number>
    foreign_currency_rows_not_summed: number
  }
  by_category: { direction: 'in' | 'out'; category: string; count: number; total_ils: number }[]
  pending_checks: { incoming_ils: number; incoming_count: number; outgoing_ils: number; outgoing_count: number }
  warnings: { label: string; count: number; total_ils: number }[]
  cashboxes: { id: number; name: string; currency: string; opening: number; movement: number; closing: number; current_balance: number }[]
  rows: FlowRow[]
  truncated: boolean
}

const METHODS: { key: string; label: string }[] = [
  { key: 'cash', label: 'كاش' },
  { key: 'card', label: 'بطاقة' },
  { key: 'transfer', label: 'تحويل' },
  { key: 'check', label: 'شيك' },
]

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

function Chips<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { key: T; label: string }[] }) {
  return (
    <div className="flex gap-1 rounded-lg border border-border bg-white p-1">
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${value === o.key ? 'bg-accent text-white' : 'text-ink/60 hover:bg-background'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function symbol(currency: string) {
  return currency === 'ILS' ? '₪' : currency
}

/** الداخل والخارج — every movement of money, in or out, by how it moved. */
export default function MoneyFlowReport() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [direction, setDirection] = useState<'all' | 'in' | 'out'>('all')
  const [method, setMethod] = useState<'all' | 'cash' | 'card' | 'transfer' | 'check'>('all')
  const [search, setSearch] = useState('')
  const [data, setData] = useState<MoneyFlow | null>(null)

  useEffect(() => {
    setData(null)
    api.get<MoneyFlow>('/reports/money-flow', { params: { from: from || undefined, to: to || undefined } }).then((res) => setData(res.data))
  }, [from, to])

  const visible = useMemo(() => {
    if (!data) return []
    const q = search.trim()
    return data.rows.filter(
      (r) =>
        (direction === 'all' || r.direction === direction) &&
        (method === 'all' || r.method === method) &&
        (!q || [r.category, r.party, r.description, r.cashbox].some((v) => v?.includes(q))),
    )
  }, [data, direction, method, search])

  const shown = useMemo(() => {
    const counted = visible.filter((r) => r.counted && r.amount_ils !== null)
    return {
      in: counted.filter((r) => r.direction === 'in').reduce((s, r) => s + (r.amount_ils ?? 0), 0),
      out: counted.filter((r) => r.direction === 'out').reduce((s, r) => s + (r.amount_ils ?? 0), 0),
    }
  }, [visible])

  if (!data) return <Card className="p-6 text-sm text-muted">جارِ التحميل...</Card>

  const t = data.totals

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs text-muted">من تاريخ</label>
            <DatePicker value={from} onChange={setFrom} allowClear />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">إلى تاريخ</label>
            <DatePicker value={to} onChange={setTo} allowClear />
          </div>
          {(from || to) && (
            <button
              onClick={() => {
                setFrom('')
                setTo('')
              }}
              className="rounded-lg border border-border px-3 py-2 text-xs text-ink/60 hover:bg-background"
            >
              مسح الفلتر (كل الوقت)
            </button>
          )}
        </div>
        <p className="mt-3 text-xs text-muted">
          الشيك بينحسب يوم استلامه أو دفعه (مش لما يتحصّل). الشيك المرتجع بيظهر بالقائمة بس ما بيدخل بالمجموع.
        </p>
      </Card>

      {data.warnings.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          <FontAwesomeIcon icon={faTriangleExclamation} className="mt-0.5" />
          <div>
            <p className="font-medium">فيه حركات ما انعكست على الصندوق — رصيد الصندوق ممكن يكون غلط، وهالحركات مش داخلة بالتقرير:</p>
            <ul className="mt-1 list-disc ps-5 text-xs">
              {data.warnings.map((w) => (
                <li key={w.label}>
                  {w.label}: {w.count} ({fmt(w.total_ils)} ₪)
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="p-5">
          <p className="flex items-center gap-2 text-sm text-muted">
            <FontAwesomeIcon icon={faArrowDown} className="text-success" />
            الداخل
          </p>
          <p className="mt-2 text-2xl font-bold text-success">{fmt(t.in_ils)} ₪</p>
          <div className="mt-2 space-y-0.5 text-xs text-muted">
            {METHODS.map((m) => (
              <div key={m.key} className="flex justify-between">
                <span>{m.label}</span>
                <span>{fmt(t.in_by_method[m.key] ?? 0)}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <p className="flex items-center gap-2 text-sm text-muted">
            <FontAwesomeIcon icon={faArrowUp} className="text-danger" />
            الخارج
          </p>
          <p className="mt-2 text-2xl font-bold text-danger">{fmt(t.out_ils)} ₪</p>
          <div className="mt-2 space-y-0.5 text-xs text-muted">
            {METHODS.map((m) => (
              <div key={m.key} className="flex justify-between">
                <span>{m.label}</span>
                <span>{fmt(t.out_by_method[m.key] ?? 0)}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-muted">الصافي (داخل − خارج)</p>
          <p className={`mt-2 text-2xl font-bold ${t.net_ils >= 0 ? 'text-ink' : 'text-danger'}`}>{fmt(t.net_ils)} ₪</p>
          {t.foreign_currency_rows_not_summed > 0 && (
            <p className="mt-2 text-xs text-warning">{t.foreign_currency_rows_not_summed} حركة بعملة أجنبية غير داخلة بالمجموع بالشيكل.</p>
          )}
        </Card>
        <Card className="p-5">
          <p className="text-sm text-muted">شيكات لسا ما تحصّلت</p>
          <p className="mt-2 text-sm text-ink">
            مستلمة: <span className="font-semibold text-success">{fmt(data.pending_checks.incoming_ils)} ₪</span>{' '}
            <span className="text-xs text-muted">({data.pending_checks.incoming_count})</span>
          </p>
          <p className="mt-1 text-sm text-ink">
            مدفوعة: <span className="font-semibold text-danger">{fmt(data.pending_checks.outgoing_ils)} ₪</span>{' '}
            <span className="text-xs text-muted">({data.pending_checks.outgoing_count})</span>
          </p>
          <p className="mt-2 text-xs text-muted">آخر فترة مفتوحة، مش مرتبطة بالفلتر.</p>
        </Card>
      </div>

      <Card className="p-6">
        <h3 className="mb-3 text-sm font-semibold text-ink/80">أرصدة الصناديق بالفترة</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-right text-muted">
                <th className="p-2 font-medium">الصندوق</th>
                <th className="p-2 font-medium">رصيد أول الفترة</th>
                <th className="p-2 font-medium">حركة الفترة</th>
                <th className="p-2 font-medium">رصيد آخر الفترة</th>
                <th className="p-2 font-medium">الرصيد الحالي</th>
              </tr>
            </thead>
            <tbody>
              {data.cashboxes.map((c) => (
                <tr key={c.id} className="border-b border-border/60 last:border-0">
                  <td className="p-2 text-ink">
                    {c.name} <span className="text-xs text-muted">({c.currency})</span>
                  </td>
                  <td className="p-2">{fmt(c.opening)} {symbol(c.currency)}</td>
                  <td className={`p-2 ${c.movement >= 0 ? 'text-success' : 'text-danger'}`}>{fmt(c.movement)} {symbol(c.currency)}</td>
                  <td className="p-2 font-medium text-ink">{fmt(c.closing)} {symbol(c.currency)}</td>
                  <td className="p-2 text-muted">{fmt(c.current_balance)} {symbol(c.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="mb-3 text-sm font-semibold text-ink/80">حسب البند</h3>
        {data.by_category.length === 0 ? (
          <p className="text-sm text-muted">ما في حركات بالفترة.</p>
        ) : (
          <div className="grid gap-x-8 gap-y-1 md:grid-cols-2">
            {(['in', 'out'] as const).map((dir) => (
              <div key={dir}>
                <p className={`mb-1 text-xs font-medium ${dir === 'in' ? 'text-success' : 'text-danger'}`}>{dir === 'in' ? 'داخل' : 'خارج'}</p>
                {data.by_category
                  .filter((c) => c.direction === dir)
                  .map((c) => (
                    <div key={c.category} className="flex items-center justify-between border-b border-border/60 py-1.5 text-sm last:border-0">
                      <span className="text-ink">
                        {c.category} <span className="text-xs text-muted">({c.count})</span>
                      </span>
                      <span className="font-medium text-ink">{fmt(c.total_ils)} ₪</span>
                    </div>
                  ))}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Chips
            value={direction}
            onChange={setDirection}
            options={[
              { key: 'all', label: 'الكل' },
              { key: 'in', label: 'داخل' },
              { key: 'out', label: 'خارج' },
            ]}
          />
          <Chips value={method} onChange={setMethod} options={[{ key: 'all', label: 'كل الطرق' }, ...METHODS.map((m) => ({ key: m.key as typeof method, label: m.label }))]} />
          <div className="relative">
            <FontAwesomeIcon icon={faMagnifyingGlass} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالجهة أو البند..."
              className="w-56 rounded-xl border border-border bg-surface py-2 pe-3 ps-9 text-sm focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        {visible.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">ما في حركات مطابقة.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-right text-muted">
                  <th className="p-2 font-medium">التاريخ</th>
                  <th className="p-2 font-medium"></th>
                  <th className="p-2 font-medium">الطريقة</th>
                  <th className="p-2 font-medium">البند</th>
                  <th className="p-2 font-medium">الجهة</th>
                  <th className="p-2 font-medium">تفاصيل</th>
                  <th className="p-2 font-medium">المبلغ</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.key} className={`border-b border-border/60 last:border-0 ${r.counted ? '' : 'text-ink/40'}`}>
                    <td className="whitespace-nowrap p-2 text-muted">{r.occurred_at}</td>
                    <td className="p-2">
                      <FontAwesomeIcon icon={r.direction === 'in' ? faArrowDown : faArrowUp} className={r.direction === 'in' ? 'text-success' : 'text-danger'} />
                    </td>
                    <td className="p-2">{r.method_label}</td>
                    <td className="p-2">
                      {r.category}
                      {r.status && (
                        <span className="ms-2">
                          <Badge variant={r.status === 'bounced' ? 'danger' : r.status === 'cleared' ? 'success' : 'warning'}>{r.status_label}</Badge>
                        </span>
                      )}
                      {!r.counted && r.source === 'cashbox' && <span className="ms-2 text-[11px]">(محسوب مع الشيك)</span>}
                    </td>
                    <td className="p-2">{r.party ?? '—'}</td>
                    <td className="p-2 text-xs text-muted">{r.description ?? ''}</td>
                    <td className={`whitespace-nowrap p-2 font-medium ${r.counted ? (r.direction === 'in' ? 'text-success' : 'text-danger') : ''} ${r.status === 'bounced' ? 'line-through' : ''}`}>
                      {r.direction === 'in' ? '+' : '−'}
                      {fmt(r.amount)} {symbol(r.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-sm">
          <span className="text-muted">مجموع المعروض:</span>
          <span>
            داخل <span className="font-semibold text-success">{fmt(shown.in)} ₪</span> — خارج{' '}
            <span className="font-semibold text-danger">{fmt(shown.out)} ₪</span> — صافي{' '}
            <span className="font-semibold text-ink">{fmt(shown.in - shown.out)} ₪</span>
          </span>
        </div>
        {data.truncated && <p className="mt-2 text-xs text-warning">القائمة اقتصرت على آخر 2000 حركة — ضيّق الفترة لتشوف الباقي.</p>}
      </Card>
    </div>
  )
}
