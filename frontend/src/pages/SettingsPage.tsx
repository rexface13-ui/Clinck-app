import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPaperPlane, faLink, faLinkSlash } from '@fortawesome/free-solid-svg-icons'
import { api } from '../lib/api'
import { Card, PageHeader, Button } from '../components/ui'

interface TelegramLinkStatus {
  linked: boolean
  link_code: string | null
  bot_username: string
}

export default function SettingsPage() {
  const [status, setStatus] = useState<TelegramLinkStatus | null>(null)
  const [busy, setBusy] = useState(false)

  function load() {
    api.get<TelegramLinkStatus>('/telegram-link').then((res) => setStatus(res.data))
  }

  useEffect(load, [])

  async function generateCode() {
    setBusy(true)
    try {
      const res = await api.post<TelegramLinkStatus>('/telegram-link')
      setStatus(res.data)
    } finally {
      setBusy(false)
    }
  }

  async function unlink() {
    setBusy(true)
    try {
      await api.delete('/telegram-link')
      load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader title="الإعدادات" subtitle="تفضيلات الحساب والتنبيهات" />

      <Card className="max-w-lg p-6">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-ink/70">
          <FontAwesomeIcon icon={faPaperPlane} className="text-accent" />
          ربط تيليغرام
        </h2>

        {status?.linked ? (
          <>
            <p className="mb-4 text-sm text-accent">حسابك مربوط ببوت تيليغرام. بتوصلك تنبيهات المواعيد والشيكات.</p>
            <Button variant="danger" onClick={unlink} loading={busy}>
              <FontAwesomeIcon icon={faLinkSlash} />
              فك الربط
            </Button>
          </>
        ) : (
          <>
            <p className="mb-4 text-sm text-muted">اربط حسابك ببوت تيليغرام لتصلك تنبيهات المواعيد والشيكات المستحقة.</p>

            {status?.link_code ? (
              <div className="mb-4 rounded-xl bg-background p-4 text-sm">
                <p className="mb-2 text-ink/70">
                  افتح تيليغرام، دوّر على{' '}
                  <span className="font-mono">@{status.bot_username || '(البوت لسا ما انضاف)'}</span>، وابعت:
                </p>
                <p className="font-mono text-lg font-semibold text-accent">/link {status.link_code}</p>
              </div>
            ) : null}

            <Button onClick={generateCode} loading={busy}>
              <FontAwesomeIcon icon={faLink} />
              {busy ? 'جارِ التوليد...' : 'توليد كود ربط'}
            </Button>
          </>
        )}
      </Card>
    </div>
  )
}
