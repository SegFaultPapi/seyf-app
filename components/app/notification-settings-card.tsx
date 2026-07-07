'use client'

import { useEffect, useState, useTransition } from 'react'
import { BellRing } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { getFcmToken, requestNotificationPermission } from '@/lib/seyf/notifications/fcm-web'

type SettingsResponse = {
  userId: string
  settings: {
    phoneNumber: string | null
    smsEnabled: boolean
    pushEnabled: boolean
    fcmToken: string | null
    updatedAt: string
  }
}

export function NotificationSettingsCard() {
  const t = useTranslations('components.notificationSettings')
  const [pending, startTransition] = useTransition()
  const [loading, setLoading] = useState(true)
  const [phoneNumber, setPhoneNumber] = useState('')
  const [smsEnabled, setSmsEnabled] = useState(true)
  const [pushEnabled, setPushEnabled] = useState(true)
  const [fcmToken, setFcmToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetch('/api/seyf/notification-settings')
      .then(async (response) => {
        const data = (await response.json()) as SettingsResponse
        if (!response.ok) {
          throw new Error(t('errors.loadFailed'))
        }
        if (cancelled) return
        setPhoneNumber(data.settings.phoneNumber ?? '')
        setSmsEnabled(data.settings.smsEnabled)
        setPushEnabled(data.settings.pushEnabled)
        setFcmToken(data.settings.fcmToken)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : t('errors.loadFailedFallback'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [t])

  async function handlePushToggle(checked: boolean) {
    setError(null)
    setMessage(null)
    if (checked) {
      const permission = await requestNotificationPermission()
      if (permission === 'denied') {
        setError(t('errors.notificationsBlocked'))
        setPushEnabled(false)
        return
      }
      setLoading(true)
      const token = await getFcmToken()
      setLoading(false)
      if (token) {
        setFcmToken(token)
        setPushEnabled(true)
      } else {
        setError(t('errors.tokenFailed'))
        setPushEnabled(false)
      }
    } else {
      setPushEnabled(false)
    }
  }

  function handleSave() {
    setError(null)
    setMessage(null)
    startTransition(async () => {
      try {
        const response = await fetch('/api/seyf/notification-settings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            phoneNumber,
            smsEnabled,
            pushEnabled,
            fcmToken: pushEnabled ? fcmToken : null,
          }),
        })
        const data = (await response.json()) as
          | SettingsResponse
          | { error?: string }

        if (!response.ok) {
          const msg =
            typeof data === 'object' && data && 'error' in data && typeof data.error === 'string'
              ? data.error
              : t('errors.saveFailed')
          throw new Error(msg)
        }

        if ('settings' in data) {
          setPhoneNumber(data.settings.phoneNumber ?? '')
          setSmsEnabled(data.settings.smsEnabled)
          setPushEnabled(data.settings.pushEnabled)
          setFcmToken(data.settings.fcmToken)
        }
        setMessage(t('saved'))
      } catch (err) {
        setError(err instanceof Error ? err.message : t('errors.saveFailedFallback'))
      }
    })
  }

  return (
    <section className="rounded-2xl border border-border bg-secondary/25 p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-full bg-background ring-1 ring-border">
          <BellRing className="size-4 text-foreground" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-foreground">{t('title')}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t('body')}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">{t('phoneLabel')}</span>
          <Input
            type="tel"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            placeholder={t('phonePlaceholder')}
            className="mt-2 h-11 rounded-xl border-border bg-background"
            disabled={loading || pending}
          />
        </label>

        <div className="flex items-center justify-between rounded-lg border border-border bg-background px-4 py-3.5">
          <div className="pr-1">
            <p className="text-sm font-semibold text-foreground">{t('notificationsActive')}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('notificationsBody')}
            </p>
          </div>
          <Switch
            checked={smsEnabled}
            onCheckedChange={setSmsEnabled}
            disabled={loading || pending}
            aria-label={t('ariaToggle')}
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border bg-background px-4 py-3.5">
          <div className="pr-1">
            <p className="text-sm font-semibold text-foreground">{t('pushActive')}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('pushBody')}
            </p>
          </div>
          <Switch
            checked={pushEnabled}
            onCheckedChange={handlePushToggle}
            disabled={loading || pending}
            aria-label={t('ariaPushToggle')}
          />
        </div>

        <Button
          type="button"
          onClick={handleSave}
          disabled={loading || pending}
          className="h-11 w-full rounded-full font-bold"
        >
          {pending ? t('savePending') : t('save')}
        </Button>

        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {message ? <p className="text-xs text-emerald-600 dark:text-emerald-400">{message}</p> : null}
      </div>
    </section>
  )
}
