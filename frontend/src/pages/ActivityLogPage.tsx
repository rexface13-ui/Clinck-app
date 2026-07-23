import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faClockRotateLeft, faUser } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { Card, PageHeader, TableSkeleton } from '../components/ui'

interface ActivityLogRow {
  id: number
  user_name: string
  action: string
  description: string
  created_at: string
}

export default function ActivityLogPage() {
  const [logs, setLogs] = useState<ActivityLogRow[] | null>(null)

  useEffect(() => {
    api.get<ActivityLogRow[]>('/activity-logs').then((res) => setLogs(res.data))
  }, [])

  return (
    <div>
      <PageHeader title="سجل النشاط" subtitle="تعديلات وحذف حساسة تمت على النظام — من عملها ومتى" />

      <Card className="p-6">
        {logs === null ? (
          <TableSkeleton />
        ) : logs.length === 0 ? (
          <p className="text-sm text-muted">لا يوجد نشاط مسجّل بعد.</p>
        ) : (
          <div className="space-y-2">
            {logs.map((log) => (
              <div key={log.id} className="flex items-start gap-3 rounded-lg border border-ink/10 p-3 text-sm">
                <FontAwesomeIcon icon={faClockRotateLeft} className="mt-0.5 text-ink/30" />
                <div className="flex-1">
                  <p className="text-ink">{log.description}</p>
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted">
                    <FontAwesomeIcon icon={faUser} />
                    {log.user_name} — {log.created_at}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
