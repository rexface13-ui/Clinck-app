import { useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faDatabase, faDownload, faTriangleExclamation, faUpload } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'

interface BackupFile {
  name: string
  size_kb: number
  created_at: string
}

export default function BackupPage() {
  const [backups, setBackups] = useState<BackupFile[]>([])
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
      <h1 className="mb-6 text-xl font-semibold text-ink">النسخ الاحتياطي</h1>

      <div className="mb-6 grid grid-cols-2 gap-6">
        <div className="rounded-xl bg-white p-6 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-ink/70">
            <FontAwesomeIcon icon={faDatabase} />
            إنشاء نسخة احتياطية
          </h2>
          <p className="mb-4 text-sm text-ink/50">تُنشئ نسخة كاملة من قاعدة البيانات الآن ويمكن تحميلها.</p>
          <button
            onClick={createBackup}
            disabled={creating}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
          >
            {creating ? 'جارِ الإنشاء...' : 'إنشاء نسخة الآن'}
          </button>
        </div>

        <div className="rounded-xl border border-danger/30 bg-danger/5 p-6">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-danger">
            <FontAwesomeIcon icon={faTriangleExclamation} />
            استعادة نسخة احتياطية
          </h2>
          <p className="mb-4 text-sm text-ink/60">
            يمسح كل البيانات الحالية ويستبدلها بمحتوى الملف المرفوع. لا يمكن التراجع.
          </p>
          <input ref={fileInputRef} type="file" accept=".dump" onChange={handleRestoreFile} className="hidden" />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={restoring}
            className="flex items-center gap-2 rounded-xl bg-danger px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            <FontAwesomeIcon icon={faUpload} />
            {restoring ? 'جارِ الاستعادة...' : 'رفع ملف واستعادة'}
          </button>
        </div>
      </div>

      {message && <p className="mb-4 rounded-xl bg-accent/10 p-3 text-sm text-accent">{message}</p>}
      {error && <p className="mb-4 rounded-xl bg-danger/10 p-3 text-sm text-danger">{error}</p>}

      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-right text-ink/60">
              <th className="p-4 font-medium">الملف</th>
              <th className="p-4 font-medium">الحجم</th>
              <th className="p-4 font-medium">التاريخ</th>
              <th className="p-4 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {backups.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-6 text-center text-sm text-ink/40">لا توجد نسخ احتياطية بعد.</td>
              </tr>
            ) : (
              backups.map((b) => (
                <tr key={b.name} className="border-b border-ink/5 last:border-0">
                  <td className="p-4 font-mono text-xs">{b.name}</td>
                  <td className="p-4 text-ink/70">{b.size_kb} KB</td>
                  <td className="p-4 text-ink/70">{b.created_at}</td>
                  <td className="p-4">
                    <button onClick={() => downloadBackup(b.name)} className="text-accent hover:text-accent-hover">
                      <FontAwesomeIcon icon={faDownload} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
