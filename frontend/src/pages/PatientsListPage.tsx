import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faUser, faBolt, faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import MedicalHistoryField from '../components/MedicalHistoryField'
import { Card, PageHeader, Badge, Button, Modal, Table, Thead, Th, Td, Tr, EmptyRow, TableSkeleton, Input, Select } from '../components/ui'
import type { Branch, Doctor, Patient } from '../types'

export default function PatientsListPage() {
  const { data, can } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [patients, setPatients] = useState<Patient[]>([])
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(() => searchParams.get('new') === '1')
  const [submitting, setSubmitting] = useState(false)
  const [search, setSearch] = useState('')
  const telegramLinkId = searchParams.get('telegram_link_id')

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setShowForm(true)
      searchParams.delete('new')
      searchParams.delete('name')
      searchParams.delete('phone')
      setSearchParams(searchParams, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const branches: Branch[] = data?.branches ?? []

  const [form, setForm] = useState({
    branch_id: branches[0]?.id ?? 1,
    full_name: searchParams.get('name') ?? '',
    gender: 'male' as 'male' | 'female',
    age: '',
    isChildOverride: null as boolean | null,
    phone: searchParams.get('phone') ?? '',
    guardian_name: '',
    guardian_phone: '',
    medical_alerts: [] as string[],
    medical_notes: '',
    walkIn: false,
    walkInDoctorId: '',
  })
  const [error, setError] = useState<string | null>(null)

  // The unfiltered list is paginated at 25 and nothing ever asked for page two,
  // so a clinic past 25 patients could only reach the rest by searching — the
  // list itself quietly stopped a quarter of the way down.
  const [page, setPage] = useState(1)
  const [lastPage, setLastPage] = useState(1)
  const [total, setTotal] = useState(0)

  function loadPatients(searchTerm?: string, pageNumber = 1) {
    setLoading(true)
    api
      .get('/patients', {
        params: searchTerm ? { search: searchTerm } : { page: pageNumber },
      })
      .then((res) => {
        setPatients(res.data.data)
        // A search comes back as a plain list with no paginator behind it.
        setLastPage(res.data.meta?.last_page ?? 1)
        setTotal(res.data.meta?.total ?? res.data.data.length)
      })
      .finally(() => setLoading(false))
  }

  // Typing a new search has to start again from the first page, or a query
  // typed while on page 3 comes back empty and reads as "no such patient".
  useEffect(() => {
    setPage(1)
    const id = setTimeout(() => loadPatients(search.trim() || undefined, 1), 250)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  useEffect(() => {
    if (page === 1) return
    loadPatients(search.trim() || undefined, page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])
  useEffect(() => {
    api.get('/doctors').then((res) => setDoctors(res.data.data))
  }, [])

  const inferredIsChild = form.age !== '' ? Number(form.age) < 12 : null
  const effectiveIsChild = form.isChildOverride ?? inferredIsChild

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const payload = {
        branch_id: form.branch_id,
        full_name: form.full_name,
        gender: form.gender,
        age: form.age ? Number(form.age) : null,
        is_child: form.isChildOverride ?? undefined,
        guardian_name: form.guardian_name || null,
        guardian_phone: form.guardian_phone || null,
        phone: form.phone || null,
        medical_alerts: form.medical_alerts,
        medical_notes: form.medical_notes || null,
      }
      const res = await api.post('/patients', payload)
      const patientId = res.data.data.id

      if (form.walkIn) {
        const now = new Date()
        const ends = new Date(now.getTime() + 30 * 60 * 1000)
        try {
          await api.post('/appointments', {
            branch_id: form.branch_id,
            patient_id: patientId,
            doctor_id: form.walkInDoctorId ? Number(form.walkInDoctorId) : null,
            starts_at: now.toISOString(),
            ends_at: ends.toISOString(),
          })
        } catch {
          // doctor busy right now — patient is still created, just no walk-in slot booked
        }
      }

      if (telegramLinkId) {
        await api.post(`/telegram-registrations/${telegramLinkId}/link-patient`, { patient_id: patientId })
        setShowForm(false)
        navigate('/telegram')
        return
      }

      setShowForm(false)
      navigate(`/patients/${patientId}`)
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'حدث خطأ أثناء الحفظ.'
      setError(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="المرضى"
        subtitle="إدارة ملفات المرضى وحجز الزيارات الفورية"
        action={
          can('patients.manage') && (
            <Button onClick={() => setShowForm((v) => !v)}>
              <FontAwesomeIcon icon={faPlus} />
              مريض جديد
            </Button>
          )
        }
      />

      <div className="relative mb-4 w-full sm:w-80">
        <FontAwesomeIcon icon={faMagnifyingGlass} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="بحث بالاسم أو رقم الهاتف..."
          className="w-full rounded-xl border border-border bg-surface py-2.5 pe-3 ps-9 text-sm focus:border-accent focus:outline-none"
        />
      </div>

      {showForm && (
        <Modal title="مريض جديد" onClose={() => setShowForm(false)} width="w-[640px]">
        {telegramLinkId && (
          <p className="mb-4 flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2 text-xs text-accent">
            رح ينربط هالمريض تلقائياً بمحادثة التيليغرام بعد الحفظ.
          </p>
        )}
        <form onSubmit={handleCreate} className="grid grid-cols-2 gap-4">
          <Input
            label="الاسم الكامل"
            required
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          />
          <Select
            label="الفرع"
            value={form.branch_id}
            onChange={(e) => setForm({ ...form, branch_id: Number(e.target.value) })}
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
          <Select
            label="الجنس"
            value={form.gender}
            onChange={(e) => setForm({ ...form, gender: e.target.value as 'male' | 'female' })}
          >
            <option value="male">ذكر</option>
            <option value="female">أنثى</option>
          </Select>
          <Input
            type="number"
            label="العمر"
            min={0}
            max={120}
            value={form.age}
            onChange={(e) => setForm({ ...form, age: e.target.value, isChildOverride: null })}
          />

          <div className="col-span-2 flex items-center gap-3 rounded-xl bg-background px-4 py-3">
            <span className="text-sm text-ink/70">الفئة العمرية:</span>
            <button
              type="button"
              onClick={() => setForm({ ...form, isChildOverride: false })}
              className={`rounded-lg border px-3 py-1 text-xs ${
                effectiveIsChild === false ? 'border-accent bg-accent text-white' : 'border-ink/10 text-ink/70'
              }`}
            >
              بالغ
            </button>
            <button
              type="button"
              onClick={() => setForm({ ...form, isChildOverride: true })}
              className={`rounded-lg border px-3 py-1 text-xs ${
                effectiveIsChild === true ? 'border-accent bg-accent text-white' : 'border-ink/10 text-ink/70'
              }`}
            >
              طفل
            </button>
            {inferredIsChild !== null && form.isChildOverride === null && (
              <span className="text-xs text-ink/40">(محسوبة تلقائياً من العمر — بإمكانك تغييرها)</span>
            )}
          </div>

          <Input label="الهاتف" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <div />
          <Input
            label="اسم ولي الأمر (اختياري)"
            value={form.guardian_name}
            onChange={(e) => setForm({ ...form, guardian_name: e.target.value })}
          />
          <Input
            label="هاتف ولي الأمر"
            value={form.guardian_phone}
            onChange={(e) => setForm({ ...form, guardian_phone: e.target.value })}
          />

          <MedicalHistoryField
            alerts={form.medical_alerts}
            onAlertsChange={(medical_alerts) => setForm({ ...form, medical_alerts })}
            notes={form.medical_notes}
            onNotesChange={(medical_notes) => setForm({ ...form, medical_notes })}
          />

          <div className="col-span-2 rounded-xl border border-accent/30 bg-accent-soft p-4">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={form.walkIn}
                onChange={(e) => setForm({ ...form, walkIn: e.target.checked })}
                className="size-4 accent-[var(--color-accent)]"
              />
              <FontAwesomeIcon icon={faBolt} className="text-accent" />
              زيارة بدون موعد مسبق — ابدأ الكشف الآن (Walk-in)
            </label>
            {form.walkIn && (
              <div className="mt-3">
                <Select
                  label="الطبيب المناوب (اختياري)"
                  value={form.walkInDoctorId}
                  onChange={(e) => setForm({ ...form, walkInDoctorId: e.target.value })}
                >
                  <option value="">بدون طبيب محدد</option>
                  {doctors.map((d) => (
                    <option key={d.id} value={d.id}>{d.full_name}</option>
                  ))}
                </Select>
                <p className="mt-1 text-xs text-muted">
                  رح يتسجّل الموعد فوراً بالوقت الحالي، وبتقدر تفتح ملف المريض وترسم أسنانه على طول.
                </p>
              </div>
            )}
          </div>

          {error && <p className="col-span-2 text-sm text-danger">{error}</p>}

          <div className="col-span-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
              إلغاء
            </Button>
            <Button type="submit" loading={submitting}>
              {submitting ? 'جارِ الحفظ...' : 'حفظ'}
            </Button>
          </div>
        </form>
        </Modal>
      )}

      <Card>
        {loading ? (
          <TableSkeleton />
        ) : (
          <Table>
            <Thead>
              <Th>الكود</Th>
              <Th>الاسم</Th>
              <Th>الفئة</Th>
              <Th>الهاتف</Th>
              <Th>تاريخ التسجيل</Th>
            </Thead>
            <tbody>
              {patients.length === 0 ? (
                <EmptyRow colSpan={5}>لا يوجد مرضى بعد.</EmptyRow>
              ) : (
                patients.map((p) => (
                  <Tr key={p.id}>
                    <Td>
                      <Link to={`/patients/${p.id}`} className="flex items-center gap-2 text-accent hover:underline">
                        <FontAwesomeIcon icon={faUser} className="text-ink/30" />
                        {p.code}
                      </Link>
                    </Td>
                    <Td>
                      <Link to={`/patients/${p.id}`} className="hover:underline">{p.full_name}</Link>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <Badge variant={p.is_child ? 'accent' : 'neutral'}>{p.is_child ? 'طفل' : 'بالغ'}</Badge>
                        {p.telegram_linked && (
                          <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs text-success">تيليغرام</span>
                        )}
                      </div>
                    </Td>
                    <Td className="text-muted">{p.phone ?? '—'}</Td>
                    <Td className="text-muted">{p.created_at}</Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Table>
        )}

        {!search.trim() && lastPage > 1 && (
          <div className="mt-4 flex items-center justify-between border-t border-border/70 pt-3 text-sm">
            <span className="text-muted">
              صفحة {page} من {lastPage} · {total} مريض
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-ink/70 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                السابق
              </button>
              <button
                onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
                disabled={page >= lastPage}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-ink/70 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                التالي
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
