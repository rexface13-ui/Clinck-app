import { useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faDatabase, faDownload, faTriangleExclamation, faUpload } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { Card, PageHeader, Button, Table, Thead, Th, Td, Tr, EmptyRow, TableSkeleton } from '../components/ui'

interface BackupFile {
  name: string
  size_kb: number
  created_at: string
}

export default function BackupPage() {
  const [backups, setBackups] = useState<BackupFile[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function load() {
    api.get('/backups').then((res) => setBackups(res.data))
  }

  useEffect(load, [])

  async function createBackup() {
    setCreating(true)
    setError(null)
    setMessage(null)
    try {
      const res = await api.post('/backups')
      setMessage(res.data.message)
      load()
    } catch {
      setError('فشل إنشاء النسخة الاحتياطية.')
    } finally {
      setCreating(false)
    }
  }

  function downloadBackup(name: string) {
    window.open(`/api/backups/${name}/download`, '_blank')
  }

  async function handleRestoreFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const confirmed = window.confirm(
      'تحذير: استعادة نسخة احتياطية رح تمسح كل البيانات الحالية وتستبدلها بالكامل. هل أنت متأكد؟'
    )
    if (!confirmed) {
      e.target.value = ''
      return
    }

    setRestoring(true)
    setError(null)
    setMessage(null)
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await api.post('/backups/restore', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setMessage(res.data.message + ' — يُفضّل إعادة تحميل الصفحة الآن.')
    } catch {
      setError('فشلت عملية الاستعادة.')
    } finally {
      setRestoring(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div>
      <PageHeader title="النسخ الاحتياطي" subtitle="حفظ واستعادة نسخ قاعدة البيانات" />

      <div className="mb-6 grid grid-cols-2 gap-6">
        <Card className="p-6">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-ink/70">
            <FontAwesomeIcon icon={faDatabase} className="text-accent" />
            إنشاء نسخة احتياطية
          </h2>
          <p className="mb-4 text-sm text-muted">تُنشئ نسخة كاملة من قاعدة البيانات الآن ويمكن تحميلها.</p>
          <Button onClick={createBackup} loading={creating}>
            {creating ? 'جارِ الإنشاء...' : 'إنشاء نسخة الآن'}
          </Button>
        </Card>

        <Card className="border-danger/30 bg-danger-soft p-6">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-danger">
            <FontAwesomeIcon icon={faTriangleExclamation} />
            استعادة نسخة احتياطية
          </h2>
          <p className="mb-4 text-sm text-ink/60">
            يمسح كل البيانات الحالية ويستبدلها بمحتوى الملف المرفوع. لا يمكن التراجع.
          </p>
          <input ref={fileInputRef} type="file" accept=".dump" onChange={handleRestoreFile} className="hidden" />
          <Button variant="danger" onClick={() => fileInputRef.current?.click()} loading={restoring}>
            <FontAwesomeIcon icon={faUpload} />
            {restoring ? 'جارِ الاستعادة...' : 'رفع ملف واستعادة'}
          </Button>
        </Card>
      </div>

      {message && <p className="mb-4 rounded-xl bg-accent-soft p-3 text-sm text-accent">{message}</p>}
      {error && <p className="mb-4 rounded-xl bg-danger-soft p-3 text-sm text-danger">{error}</p>}

      <Card>
        {!backups ? (
          <TableSkeleton />
        ) : (
          <Table>
            <Thead>
              <Th>الملف</Th>
              <Th>الحجم</Th>
              <Th>التاريخ</Th>
              <Th></Th>
            </Thead>
            <tbody>
              {backups.length === 0 ? (
                <EmptyRow colSpan={4}>لا توجد نسخ احتياطية بعد.</EmptyRow>
              ) : (
                backups.map((b) => (
                  <Tr key={b.name}>
                    <Td className="font-mono text-xs">{b.name}</Td>
                    <Td className="text-muted">{b.size_kb} KB</Td>
                    <Td className="text-muted">{b.created_at}</Td>
                    <Td>
                      <button onClick={() => downloadBackup(b.name)} className="text-accent hover:text-accent-hover">
                        <FontAwesomeIcon icon={faDownload} />
                      </button>
                    </Td>
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
