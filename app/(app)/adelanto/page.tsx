'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { AppPageBody } from '@/components/app/app-page-body'
import { AppBackLink } from '@/components/app/app-back-link'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

function formatMXN(amount: number) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
  }).format(amount)
}

export default function AdelantoPage() {
  const t = useTranslations('adelanto')
  const router = useRouter()
  const [ledger, setLedger] = useState<{
    balances: {
      mxn_available: number
      mxn_blocked: number
      mxn_settling: number
      mxn_total: number
      advance_outstanding_mxn: number
    }
    constraints: {
      mxn_spendable: number
    }
  } | null>(null)
  const [readiness, setReadiness] = useState<{
    onrampEnabled: boolean
    reasons: string[]
  } | null>(null)
  const [simulation, setSimulation] = useState<{
    principal_mxn?: number
    real_cetes_apy_percent?: number
    advance_rate_percent?: number
    years_selected?: number
    years_max_allowed?: number
    max_advance_ratio_percent?: number
    max_advance_mxn: number
    fee_mxn: number
    net_to_user_mxn: number
    cycle_end_date: string
    advance_available: boolean
    error?: string
  } | null>(null)
  const [advances, setAdvances] = useState<Array<{ id: string }>>([])
  const [years, setYears] = useState(1)
  const [initialLoading, setInitialLoading] = useState(true)
  const [simLoading, setSimLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [exito, setExito] = useState(false)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [uiError, setUiError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetch(`/api/seyf/advance/simulate?years=${years}`).then((res) => res.json()),
      fetch('/api/seyf/ledger/mxn').then((res) => res.json()),
      fetch('/api/seyf/etherfuse/readiness').then((res) => res.json()),
      fetch('/api/seyf/advance/list').then((res) => res.json()),
    ])
      .then(([simData, ledgerData, readinessData, advanceData]) => {
        setSimulation(simData)
        setLedger(ledgerData)
        setAdvances(Array.isArray(advanceData?.items) ? advanceData.items : [])
        setReadiness({
          onrampEnabled: readinessData?.onrampEnabled === true,
          reasons: Array.isArray(readinessData?.reasons)
            ? readinessData.reasons.filter((x: unknown): x is string => typeof x === 'string')
            : [],
        })
      })
      .catch(() => {
        setUiError(t('errors.loadFailed'))
      })
      .finally(() => setInitialLoading(false))
  }, [years, t])

  useEffect(() => {
    if (initialLoading) return
    setSimLoading(true)
    fetch(`/api/seyf/advance/simulate?years=${years}`)
      .then((res) => res.json())
      .then((simData) => {
        setSimulation(simData)
      })
      .catch(() => {
        setUiError(t('errors.simFailed'))
      })
      .finally(() => setSimLoading(false))
  }, [years, initialLoading, t])

  const refreshAdvanceList = async () => {
    const res = await fetch('/api/seyf/advance/list')
    const data = await res.json()
    setAdvances(Array.isArray(data?.items) ? data.items : [])
  }

  useEffect(() => {
    if (!simulation?.years_max_allowed) return
    if (years > simulation.years_max_allowed) {
      setYears(simulation.years_max_allowed)
    }
  }, [simulation?.years_max_allowed, years])

  const maxAdvanceBusiness = useMemo(() => {
    return Math.max(0, simulation?.max_advance_mxn ?? 0)
  }, [simulation?.max_advance_mxn])

  const handleConfirmar = async () => {
    if (!simulation) return
    if (readiness && !readiness.onrampEnabled) {
      setUiError(t('errors.setupIncomplete'))
      return
    }
    if (maxAdvanceBusiness <= 0) {
      setUiError(t('errors.noBalance'))
      return
    }
    setConfirming(true)
    setUiError(null)
    try {
      const res = await fetch('/api/seyf/advance/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount_mxn: maxAdvanceBusiness, years }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        status?: string
        stellar_tx_hash?: string
        error?: { code?: string; message_es?: string; retryable?: boolean } | string
        message_es?: string
      }
      if (!res.ok) {
        const errMsg =
          typeof data.error === 'object'
            ? (data.error?.message_es ?? t('errors.processFailed'))
            : (data.error ?? data.message_es ?? t('errors.processFailedHttp', { status: res.status }))
        setUiError(errMsg)
        return
      }
      if (data.status === 'completed') {
        setTxHash(data.stellar_tx_hash ?? null)
        setExito(true)
        await refreshAdvanceList()
      } else {
        const errMsg =
          typeof data.error === 'object'
            ? (data.error?.message_es ?? t('errors.processFailedDefault'))
            : (data.error ?? t('errors.processFailedDefault'))
        setUiError(errMsg)
      }
    } catch {
      setUiError(t('errors.networkError'))
    } finally {
      setConfirming(false)
    }
  }

  if (initialLoading) {
    return (
      <AppPageBody className="space-y-6 pt-2">
        <Skeleton className="h-5 w-24 rounded-full" />
        <Skeleton className="h-40 rounded-[1.5rem]" />
        <div className="rounded-[1.5rem] border border-border bg-card p-6 shadow-[0_8px_28px_rgba(0,0,0,0.14)]">
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-14 rounded-xl" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-14 rounded-xl" />
            </div>
            <Skeleton className="h-[5.75rem] rounded-xl" />
            <Skeleton className="h-12 w-1/2" />
            <div className="space-y-3 border-t border-border pt-4">
              <Skeleton className="h-5 rounded-md" />
              <Skeleton className="h-5 rounded-md" />
              <Skeleton className="h-5 rounded-md" />
            </div>
          </div>
        </div>
        <Skeleton className="h-12 rounded-full" />
      </AppPageBody>
    )
  }

  if (simulation?.advance_available === false) {
    return (
      <AppPageBody className="space-y-6 pt-2">
        <AppBackLink href="/dashboard" />
        <section className="rounded-[1.5rem] border border-border bg-card p-6 text-center">
          <h2 className="text-xl font-bold">{t('noCycle.title')}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t('noCycle.body')}</p>
          <Button onClick={() => router.push('/dashboard')} className="mt-6 rounded-full font-bold">
            {t('noCycle.button')}
          </Button>
        </section>
      </AppPageBody>
    )
  }

  if (exito) {
    return (
      <AppPageBody className="space-y-6 pt-2">
        <AppBackLink href="/dashboard" />

        <section className="relative overflow-hidden rounded-[1.5rem] border border-[#bfd6ca] bg-gradient-to-br from-[#edf6f2] via-[#e6f0ea] to-[#dce9e3] p-5 dark:border-[#2b4a43] dark:bg-gradient-to-br dark:from-[#0d3531] dark:via-[#15534a] dark:to-[#1f6559]">
          <div className="pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full bg-[#9ec7b3]/25 blur-3xl dark:bg-[#6ba690]/25" />
          <div className="relative flex flex-col items-center text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#9ec7b3]/35 dark:bg-[#6ba690]/30">
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-[#2e7d69] dark:text-[#d2e9df]"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p className="inline-flex rounded-full bg-white/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#5f7168] dark:bg-white/15 dark:text-[#d2e9df]">
              {t('success.badge')}
            </p>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-[#41534b] dark:text-white">{t('success.title')}</h2>
            <p className="mt-2 text-sm text-[#5f7168] dark:text-[#d2e9df]">
              {t('success.body')}
            </p>
          </div>
        </section>

        <div className="space-y-3 rounded-[1.5rem] bg-card p-5 shadow-[0_8px_28px_rgba(0,0,0,0.14)]">
          <SummaryRow label={t('success.receivedLabel')} value={formatMXN(simulation?.net_to_user_mxn || 0)} bold />
          <div className="border-t border-border/60 pt-3">
            <SummaryRow label={t('success.refLabel')} value={txHash ? txHash.slice(0, 8) + '...' + txHash.slice(-8) : '—'} dim />
          </div>
        </div>

        <Link href="/tarjeta" className="block">
          <Button className="h-12 w-full rounded-full bg-foreground text-base font-bold text-background shadow-[0_10px_28px_rgba(255,255,255,0.12)] hover:bg-foreground/90">
            {t('success.useButton')}
          </Button>
        </Link>
        <button
          type="button"
          onClick={() => router.push('/dashboard')}
          className="w-full py-2 text-sm font-semibold text-muted-foreground transition hover:text-foreground"
        >
          {t('success.backLink')}
        </button>
      </AppPageBody>
    )
  }

  const fechaLiberacion = simulation?.cycle_end_date
    ? new Date(simulation.cycle_end_date).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
    : '--'

  return (
    <AppPageBody className="space-y-6 pt-2">
      <AppBackLink href="/dashboard" />

      <section className="relative overflow-hidden rounded-[1.5rem] border border-[#bfd6ca] bg-gradient-to-br from-[#edf6f2] via-[#e6f0ea] to-[#dce9e3] p-5 dark:border-[#2b4a43] dark:bg-gradient-to-br dark:from-[#0d3531] dark:via-[#15534a] dark:to-[#1f6559]">
        <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-[#9ec7b3]/25 blur-3xl dark:bg-[#6ba690]/25" />
        <div className="pointer-events-none absolute -bottom-20 -left-12 h-44 w-44 rounded-full bg-[#b8b8b5]/20 blur-3xl dark:bg-[#22433c]/40" />
        <div className="relative">
          <p className="inline-flex items-center gap-1.5 rounded-full border border-[#b8b8b5]/60 bg-white/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#5f7168] dark:border-white/20 dark:bg-white/15 dark:text-[#d2e9df]">
            <Sparkles className="size-3 text-[#5f7168] dark:text-[#d2e9df]" />
            {t('hero.badge')}
          </p>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-[#41534b] dark:text-white">{t('hero.title')}</h1>
          <p className="mt-1.5 text-sm text-[#7b8f86] dark:text-[#d2e9df]">
            {t('hero.body')}
            <span className="mt-1 block font-bold text-[#41534b] dark:text-white">{t('hero.bold')}</span>
          </p>
        </div>
      </section>

      <section className="space-y-4 rounded-[1.5rem] bg-card p-6 shadow-[0_8px_28px_rgba(0,0,0,0.14)]">
        <div className="grid gap-3 sm:grid-cols-2">
          <MiniStat
            label={t('stats.baseMxn')}
            value={formatMXN(simulation?.principal_mxn ?? (ledger?.constraints?.mxn_spendable ?? 0))}
          />
          <MiniStat label={t('stats.maxRatio')} value={`${(simulation?.max_advance_ratio_percent ?? 90).toFixed(0)}%`} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <MiniStat
            label={t('stats.cetesApy')}
            value={`${(simulation?.real_cetes_apy_percent ?? 0).toFixed(2)}%`}
          />
          <MiniStat
            label={t('stats.advanceApy')}
            value={`${(simulation?.advance_rate_percent ?? 0).toFixed(2)}%`}
          />
        </div>
        <div className="rounded-xl bg-secondary/40 px-3 py-3">
          <p className="text-[11px] text-muted-foreground">
            {t('yearsSlider.label', { max: simulation?.years_max_allowed ?? 1 })}
          </p>
          <input
            type="range"
            min={1}
            max={simulation?.years_max_allowed ?? 1}
            step={1}
            value={Math.min(years, simulation?.years_max_allowed ?? 1)}
            onChange={(e) => setYears(Number.parseInt(e.target.value, 10) || 1)}
            className="mt-2 w-full"
          />
          <p className="mt-2 text-center text-sm font-bold text-foreground">
            {t('yearsSlider.value', { count: years })}{simLoading ? t('yearsSlider.updating') : ''}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t('maxAdvanceLabel')}
          </p>
          <p className="mt-1 text-3xl font-black tabular-nums tracking-tight text-foreground">
            {formatMXN(maxAdvanceBusiness)}
          </p>
        </div>

        <div className="space-y-3 pt-4 border-t border-border">
          <SummaryRow label={t('summary.netLabel')} value={formatMXN(Math.max(0, (simulation?.net_to_user_mxn || 0) > 0 ? Math.min(simulation?.net_to_user_mxn || 0, maxAdvanceBusiness) : 0))} bold />
          <SummaryRow label={t('summary.feeLabel')} value={formatMXN(simulation?.fee_mxn || 0)} dim />
          <SummaryRow label={t('summary.dateLabel')} value={fechaLiberacion} dim />
        </div>
      </section>

      {readiness && !readiness.onrampEnabled ? (
        <div className="rounded-[1.25rem] border border-amber-500/25 bg-amber-500/10 p-4">
          <p className="text-sm font-semibold text-amber-200">{t('missingSteps.title')}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-100/80">
            {readiness.reasons.slice(0, 4).map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="outline" className="rounded-full" onClick={() => router.push('/identidad')}>
              {t('missingSteps.btnVerify')}
            </Button>
            <Button size="sm" variant="outline" className="rounded-full" onClick={() => router.push('/anadir')}>
              {t('missingSteps.btnDeposit')}
            </Button>
          </div>
        </div>
      ) : null}

      {uiError ? (
        <div className="rounded-[1rem] border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {uiError}
        </div>
      ) : null}

      <div className="bg-secondary/30 rounded-[1.25rem] p-4 border border-border/50">
        <p className="text-[11px] text-muted-foreground leading-relaxed" dangerouslySetInnerHTML={{ __html: t.raw('noteHtml') }} />
      </div>

      <Button
        onClick={handleConfirmar}
        disabled={confirming || !maxAdvanceBusiness || (readiness ? !readiness.onrampEnabled : false)}
        className="h-12 w-full rounded-full bg-foreground text-base font-bold text-background shadow-[0_10px_28px_rgba(255,255,255,0.12)] hover:bg-foreground/90 disabled:opacity-60"
      >
        {confirming ? t('confirming') : t('confirmButton', { years, plural: years !== 1 ? 's' : '' })}
      </Button>

      <section className="rounded-[1.5rem] bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-foreground">{t('history.title')}</h2>
            <p className="text-xs text-muted-foreground">
              {advances.length > 0 ? t('history.records', { count: advances.length }) : t('history.noRecords')}
            </p>
          </div>
          <Button asChild variant="outline" className="rounded-full">
            <Link href="/adelantos">{t('history.detailsButton')}</Link>
          </Button>
        </div>
      </section>

      <p className="text-center text-[10px] text-muted-foreground">
        {t('footerNote')}
      </p>
    </AppPageBody>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-secondary/40 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-bold tabular-nums text-foreground">{value}</p>
    </div>
  )
}

function SummaryRow({
  label,
  value,
  dim,
  bold,
}: {
  label: string
  value: string
  dim?: boolean
  bold?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <p className={cn('text-sm', dim ? 'text-muted-foreground' : 'text-muted-foreground/90')}>{label}</p>
      <p
        className={cn(
          'max-w-[58%] text-right text-sm tabular-nums',
          bold ? 'font-bold text-foreground' : dim ? 'text-muted-foreground' : 'font-semibold text-foreground',
        )}
      >
        {value}
      </p>
    </div>
  )
}
