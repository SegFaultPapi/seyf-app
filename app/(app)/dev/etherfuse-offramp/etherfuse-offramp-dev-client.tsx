'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { AppBackLink } from '@/components/app/app-back-link'
import { AppPageBody } from '@/components/app/app-page-body'
import { useSeyfWallet } from '@/lib/seyf/use-seyf-wallet'
import { EmptyState } from '@/components/ui/empty-state'
import { OfframpActionCard } from '@/components/app/dev/offramp-action-card'
import { OrderTransactionDetailCard, pickQuoteId } from '@/components/app/dev/etherfuse-order-cards'
import {
  WithdrawSpeiDestination,
  type WithdrawDestinationSelection,
} from '@/components/app/withdraw-spei-destination'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  extractOrderIdFromCreateOrderResponse,
  pickOfframpOrderSummary,
} from '@/lib/etherfuse/order-create-response'
import {
  extractConfirmedTxSignatureFromOnrampPanelJson,
  pickRampOrderTransactionDetails,
} from '@/lib/etherfuse/orders-api'
import {
  type EtherfuseReadinessClientPayload,
  etherfuseDepositBlockedCopy,
  parseEtherfuseReadinessJson,
} from '@/lib/seyf/etherfuse-readiness-cta'

type RampContextPayload = {
  kycApproved: boolean
  kycStatus: string | null
  kycReason: string | null
}

export default function EtherfuseOfframpDevClient() {
  const { wallet, assetBalances, loading: walletLoading } = useSeyfWallet()
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [sourceAmountTokens, setSourceAmountTokens] = useState('10')
  const [sourceAssetOverride, setSourceAssetOverride] = useState('')

  const mxne = useMemo(() => {
    const row = assetBalances.find((x) => (x.code ?? x.assetCode) === 'MXNE')
    return row?.balance ? Number.parseFloat(row.balance) : 0
  }, [assetBalances])

  const cetes = useMemo(() => {
    const row = assetBalances.find((x) => (x.code ?? x.assetCode) === 'CETES')
    return row?.balance ? Number.parseFloat(row.balance) : 0
  }, [assetBalances])

  const totalBalance = mxne + cetes
  const hasNoBalance = wallet && !walletLoading && totalBalance <= 0
  const [orderJson, setOrderJson] = useState<string>('')
  const [useAnchor, setUseAnchor] = useState(false)
  const [trackJson, setTrackJson] = useState<string>('')
  const [kycGate, setKycGate] = useState<RampContextPayload | null>(null)
  const [kycLoading, setKycLoading] = useState(true)
  const [readiness, setReadiness] = useState<EtherfuseReadinessClientPayload | null>(null)
  const [abbrClabeHint, setAbbrClabeHint] = useState<string | null>(null)
  const [bankAccountLabel, setBankAccountLabel] = useState<string | null>(null)
  const [destinationValid, setDestinationValid] = useState(true)
  const [destinationReason, setDestinationReason] = useState<string | null>(null)

  const walletAddr = wallet?.stellarAddress?.trim() ?? ''
  
  const { data: withdrawStatusData } = useSWR(
    walletAddr ? `/api/withdraw/status?wallet=${encodeURIComponent(walletAddr)}` : null,
    (url: string) => fetch(url).then(res => res.json()),
    { refreshInterval: (data: any) => (data?.status === 'pendiente' ? 10000 : 0) }
  )

  const onDestinationSelectionChange = useCallback((_s: WithdrawDestinationSelection) => {}, [])

  const onDestinationValidity = useCallback((ok: boolean, reason: string | null) => {
    setDestinationValid(ok)
    setDestinationReason(reason)
  }, [])

  const run = useCallback(async (label: string, fn: () => Promise<void>) => {
    setErr(null)
    setBusy(label)
    try {
      await fn()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error')
    } finally {
      setBusy(null)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setKycLoading(true)
    fetch('/api/seyf/etherfuse/ramp-context')
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as Partial<RampContextPayload> & { error?: string }
        if (!r.ok) {
          throw new Error(typeof j.error === 'string' ? j.error : `HTTP ${r.status}`)
        }
        if (cancelled) return
        setKycGate({
          kycApproved: j.kycApproved === true,
          kycStatus: typeof j.kycStatus === 'string' ? j.kycStatus : null,
          kycReason: typeof j.kycReason === 'string' ? j.kycReason : null,
        })
      })
      .catch((e) => {
        if (cancelled) return
        setKycGate({
          kycApproved: false,
          kycStatus: null,
          kycReason: e instanceof Error ? e.message : 'No pudimos validar tu estado KYC.',
        })
      })
      .finally(() => {
        if (!cancelled) setKycLoading(false)
      })
    fetch('/api/seyf/etherfuse/readiness')
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as { error?: string }
        if (!r.ok) {
          throw new Error(typeof j.error === 'string' ? j.error : `HTTP ${r.status}`)
        }
        if (cancelled) return
        const parsed = parseEtherfuseReadinessJson(j)
        if (parsed) {
          setReadiness(parsed)
        } else {
          setReadiness({
            onrampEnabled: false,
            reasons: ['Respuesta de readiness inesperada.'],
            kycApproved: false,
            agreementsAccepted: false,
            bankAccountReady: false,
            trustlineReady: false,
            documentsUploaded: false,
            webhookConfigured: false,
          })
        }
      })
      .catch((e) => {
        if (cancelled) return
        setReadiness({
          onrampEnabled: false,
          reasons: [e instanceof Error ? e.message : 'No pudimos verificar requisitos del retiro.'],
          kycApproved: false,
          agreementsAccepted: false,
          bankAccountReady: false,
          trustlineReady: false,
          documentsUploaded: false,
          webhookConfigured: false,
        })
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!readiness?.onrampEnabled) return
    let cancelled = false
    fetch('/api/seyf/etherfuse/deposit-info')
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as {
          kycReady?: boolean
          abbrClabe?: string | null
          bankAccountLabel?: string | null
        }
        if (!r.ok || cancelled) return
        setAbbrClabeHint(typeof j.abbrClabe === 'string' ? j.abbrClabe : null)
        setBankAccountLabel(typeof j.bankAccountLabel === 'string' ? j.bankAccountLabel : null)
      })
      .catch(() => {
        if (!cancelled) {
          setAbbrClabeHint(null)
          setBankAccountLabel(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [readiness?.onrampEnabled])

  const performQuote = useCallback(async (): Promise<string> => {
    const body: { sourceAmount: string; sourceAsset?: string } = {
      sourceAmount: sourceAmountTokens.trim().replace(',', '.') || '1',
    }
    const t = sourceAssetOverride.trim()
    if (t) body.sourceAsset = t
    const res = await fetch('/api/seyf/etherfuse/quote/offramp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const msg =
        typeof data.error === 'string'
          ? data.error
          : `${res.status} ${res.statusText}${Object.keys(data).length ? ` — ${JSON.stringify(data)}` : ''}`
      throw new Error(msg)
    }
    return JSON.stringify(data, null, 2)
  }, [sourceAmountTokens, sourceAssetOverride])

  const performOrder = useCallback(
    async (qJson: string): Promise<string> => {
      let parsed: unknown
      try {
        parsed = JSON.parse(qJson || '{}')
      } catch {
        throw new Error('Cotización JSON inválida')
      }
      const inner =
        parsed && typeof parsed === 'object' && 'quote' in (parsed as object)
          ? (parsed as { quote: unknown }).quote
          : parsed
      const quoteId = pickQuoteId(inner)
      if (!quoteId) {
        throw new Error('No encuentro quoteId en la cotización (~2 min de validez)')
      }
      const res = await fetch('/api/seyf/etherfuse/order/offramp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quoteId, useAnchor }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : res.statusText)
      }
      return JSON.stringify(data, null, 2)
    },
    [useAnchor],
  )

  const continueOfframp = useCallback(() => {
    void run('offramp-flow', async () => {
      const q = await performQuote()
      const o = await performOrder(q)
      setOrderJson(o)
      setTrackJson('')
    })
  }, [performOrder, performQuote, run])

  const trackOrder = useCallback(() => {
    void run('track', async () => {
      let parsed: unknown
      try {
        parsed = JSON.parse(orderJson || '{}')
      } catch {
        throw new Error('Primero crea una orden offramp válida')
      }
      const orderId = extractOrderIdFromCreateOrderResponse(parsed)
      if (!orderId) {
        throw new Error('No encuentro orderId en la respuesta de orden')
      }

      let orderPolled: unknown = null
      let pollAttempts = 0
      for (let i = 0; i < 12; i++) {
        pollAttempts = i + 1
        if (i > 0) await new Promise((r) => setTimeout(r, 1500))
        const gr = await fetch(
          `/api/seyf/etherfuse/prueba/order/${encodeURIComponent(orderId)}`,
        )
        if (!gr.ok) continue
        const gj = (await gr.json().catch(() => ({}))) as { order?: unknown }
        orderPolled = gj.order ?? null
        const det = pickRampOrderTransactionDetails(orderPolled)
        const st = (det.status ?? '').toLowerCase()
        if (
          (det.confirmedTxSignature && det.confirmedTxSignature.length > 0) ||
          st === 'completed' ||
          st === 'funded' ||
          st === 'failed' ||
          st === 'canceled'
        ) {
          break
        }
      }

      setTrackJson(
        JSON.stringify(
          {
            orderPolled,
            orderDisplay: pickRampOrderTransactionDetails(orderPolled),
            pollAttempts,
            offrampTrack: true,
          },
          null,
          2,
        ),
      )
    })
  }, [orderJson, run])

  const offrampSummary = useMemo(() => {
    if (!orderJson.trim()) return null
    try {
      const root = JSON.parse(orderJson) as { order?: unknown }
      if (!root.order) return null
      return pickOfframpOrderSummary(root.order)
    } catch {
      return null
    }
  }, [orderJson])

  const offrampTxSignature = useMemo(
    () => extractConfirmedTxSignatureFromOnrampPanelJson(trackJson),
    [trackJson],
  )

  const stellarTxExplorerUrl = useMemo(() => {
    if (!offrampTxSignature) return null
    const isMain =
      typeof process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'string' &&
      ['public', 'mainnet'].includes(
        process.env.NEXT_PUBLIC_STELLAR_NETWORK.toLowerCase(),
      )
    const base = isMain
      ? 'https://stellar.expert/explorer/public/tx/'
      : 'https://stellar.expert/explorer/testnet/tx/'
    return `${base}${encodeURIComponent(offrampTxSignature)}`
  }, [offrampTxSignature])

  const continueBusy = busy === 'offramp-flow'
  const trackBusy = busy === 'track'
  const canOperate = readiness?.onrampEnabled === true
  const readinessReasons = readiness?.reasons ?? []
  const withdrawBlocked = etherfuseDepositBlockedCopy({
    readiness,
    kycLoading,
    mode: 'withdraw',
    fallbackReason: kycGate?.kycReason ?? null,
  })

  const realPending = withdrawStatusData?.status === 'pendiente'
  const realCompleted = withdrawStatusData?.status === 'completado'

  const withdrawProgress = useMemo(() => {
    return [
      {
        label: 'Retiro solicitado',
        description: 'Hemos recibido tu solicitud de retiro.',
        done: realPending || realCompleted,
      },
      {
        label: 'Procesando',
        description: realPending ? 'Tiempo estimado: 2 horas en horario hábil' : 'El retiro está siendo procesado.',
        done: realCompleted,
      },
      {
        label: 'Completado',
        description: 'El dinero fue enviado a tu cuenta bancaria.',
        done: realCompleted,
      },
    ]
  }, [realPending, realCompleted])

  const showWithdrawProgress = realPending

  return (
    <AppPageBody className="space-y-6 pt-4">
      <AppBackLink href="/dashboard" />

      <section className="relative overflow-hidden rounded-[1.5rem] border border-[#bfd6ca] bg-gradient-to-br from-[#edf6f2] via-[#e6f0ea] to-[#dce9e3] p-5 dark:border-[#2b4a43] dark:from-[#0d3531] dark:via-[#15534a] dark:to-[#1f6559]">
        <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-[#9ec7b3]/25 blur-3xl dark:bg-[#6ba690]/25" />
        <div className="pointer-events-none absolute -bottom-20 -left-14 h-44 w-44 rounded-full bg-[#b8b8b5]/20 blur-3xl dark:bg-[#22433c]/40" />
        <div className="relative">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="inline-flex rounded-full border border-[#b8b8b5]/60 bg-white/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#5f7168] dark:border-white/20 dark:bg-white/15 dark:text-[#d2e9df]">
            Retiro SPEI
            </p>
          </div>
          <h1 className="text-2xl font-black tracking-tight text-[#41534b] dark:text-white">Retirar fondos</h1>
          <p className="mt-1.5 text-sm text-[#7b8f86] dark:text-[#d2e9df]">
            Vendemos tu posición en CETES (u otro activo) y enviamos pesos a la CLABE que diste en tu verificación.
          </p>
        </div>
      </section>

      {!canOperate ? (
        <section className="rounded-[1.25rem] border border-amber-500/30 bg-amber-500/[0.08] p-4">
          <p className="text-sm font-bold text-foreground">{withdrawBlocked.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{withdrawBlocked.lead}</p>
          {readinessReasons.length ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              {readinessReasons.slice(0, 5).map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
          <div className="mt-3 flex flex-col gap-2">
            <Link
              href={withdrawBlocked.primaryLink.href}
              className="inline-flex text-sm font-semibold text-foreground underline"
            >
              {withdrawBlocked.primaryLink.label}
            </Link>
            {withdrawBlocked.extraLinks.map((item) => (
              <Link
                key={item.href + item.label}
                href={item.href}
                className="inline-flex text-xs font-medium text-muted-foreground underline decoration-muted-foreground/60"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {showWithdrawProgress ? (
        <section className="rounded-[1.25rem] border border-border bg-card/60 p-4">
          <p className="text-sm font-bold text-foreground">Seguimiento del retiro</p>
          <div className="mt-3 space-y-3">
            {withdrawProgress.map((step) => (
              <div
                key={step.label}
                className="rounded-xl border border-border/70 bg-background/50 px-3 py-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">{step.label}</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                      {step.description}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 text-xs font-bold',
                      step.done ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground',
                    )}
                  >
                    {step.done ? 'Listo' : 'Pendiente'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {canOperate ? (
        (kycLoading || readiness == null) ? (
          <>
            <div className="mx-auto w-full max-w-lg px-3 pb-1 pt-3 sm:px-6 sm:pt-4">
              <div className="rounded-[1.25rem] border border-border bg-card p-3 sm:p-4">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-9 h-9 w-9 rounded-full" />
                  <div className="flex-1">
                    <Skeleton className="h-4 w-48 rounded-md mb-2" />
                    <Skeleton className="h-3 w-64 rounded-md" />
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  <Skeleton className="h-12 rounded-xl" />
                </div>
              </div>
            </div>

            <div className="space-y-3 rounded-[1.5rem] border border-[#bfd6ca] bg-[#f4faf7] p-5 dark:border-border dark:bg-card/80">
              <Skeleton className="h-6 w-64 rounded-md" />
              <Skeleton className="h-14 rounded-2xl" />
              <Skeleton className="h-12 rounded-full" />
            </div>
          </>
        ) : hasNoBalance ? (
          <EmptyState
            variant="full"
            illustration="balance"
            title="Sin saldo disponible"
            description="No tienes fondos en tu cuenta para realizar un retiro SPEI en este momento."
            primaryAction={{
              label: "Agregar fondos",
              href: "/anadir",
            }}
            secondaryAction={{
              label: "Volver al inicio",
              href: "/dashboard",
            }}
          />
        ) : (
          <>
            <WithdrawSpeiDestination
              abbrClabeHint={abbrClabeHint}
              bankAccountLabel={bankAccountLabel}
              disabled={!!busy}
              onSelectionChange={onDestinationSelectionChange}
              onValidityChange={onDestinationValidity}
            />

            <section className="space-y-3 rounded-[1.5rem] border border-[#bfd6ca] bg-[#f4faf7] p-5 dark:border-border dark:bg-card/80">
              <div className="space-y-1">
                <Label htmlFor="withdraw-amount-input" className="text-base font-bold text-foreground">
                  ¿Cuánto quieres retirar?
                </Label>
                <p className="text-xs text-muted-foreground">
                  Cantidad del activo en tu wallet (el cotizador convierte a pesos para el SPEI).
                </p>
              </div>
              <Input
                id="withdraw-amount-input"
                inputMode="decimal"
                value={sourceAmountTokens}
                onChange={(e) => setSourceAmountTokens(e.target.value)}
                placeholder="Ej. 10"
                className="h-14 rounded-2xl border-[#c6dccf] bg-background px-4 text-lg tabular-nums font-semibold focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                aria-label="Cantidad del activo a retirar"
              />
              <details className="rounded-xl border border-border/60 bg-background/50 px-3 py-2 text-xs text-muted-foreground">
                <summary className="cursor-pointer font-medium text-foreground">
                  Opciones avanzadas (sandbox)
                </summary>
                <div className="mt-3 space-y-3">
                  <div>
                    <Label htmlFor="source-asset-offramp" className="text-[11px] text-muted-foreground">
                      Activo fuente (opcional)
                    </Label>
                    <Input
                      id="source-asset-offramp"
                      value={sourceAssetOverride}
                      onChange={(e) => setSourceAssetOverride(e.target.value)}
                      placeholder="Identificador del activo"
                      className="mt-1 h-11 rounded-xl border-border bg-background px-3 font-mono text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      aria-label="Identificador de activo opcional"
                    />
                  </div>
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id="use-anchor"
                      checked={useAnchor}
                      onCheckedChange={(v) => setUseAnchor(v === true)}
                      className="mt-0.5"
                    />
                    <Label
                      htmlFor="use-anchor"
                      className="cursor-pointer leading-relaxed font-normal"
                    >
                      Modo anchor en Stellar (solo pruebas).{' '}
                      <a
                        href="https://docs.etherfuse.com/guides/testing-offramps#anchor-mode-stellar-only"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-foreground underline underline-offset-2"
                      >
                        Documentación
                      </a>
                    </Label>
                  </div>
                </div>
              </details>
              {destinationReason ? (
                <p className="rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {destinationReason}
                </p>
              ) : null}
              <Button
                type="button"
                className="h-14 w-full rounded-2xl bg-foreground text-base font-bold text-background shadow-md"
                disabled={!!busy || !destinationValid}
                onClick={() => void continueOfframp()}
              >
                {continueBusy ? (
                  <>
                    <Spinner className="size-4 text-background" />
                    Preparando retiro…
                  </>
                ) : (
                  'Continuar con el retiro'
                )}
              </Button>
            </section>
          </>
        )
      ) : null}

      {canOperate || orderJson.trim() ? (
        <OfframpActionCard summary={offrampSummary} />
      ) : null}

      {orderJson ? (
        <Button
          type="button"
          className="h-12 w-full rounded-2xl border border-border font-semibold"
          variant="secondary"
          disabled={!!busy || !canOperate}
          onClick={() => void trackOrder()}
        >
          {trackBusy ? (
            <>
              <Spinner className="size-4" />
              Consultando…
            </>
          ) : (
            'Actualizar estado del retiro'
          )}
        </Button>
      ) : null}

      {err ? (
        <p className="rounded-[1rem] border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {err}
        </p>
      ) : null}

      {offrampTxSignature && stellarTxExplorerUrl ? (
        <div className="rounded-[1.5rem] border border-border bg-card p-4">
          <p className="text-sm font-bold text-foreground">Comprobante</p>
          <p className="mt-2 break-all font-mono text-xs text-muted-foreground">{offrampTxSignature}</p>
          <a
            href={stellarTxExplorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block text-sm font-semibold text-foreground underline-offset-2 hover:underline"
          >
            Ver comprobante
          </a>
        </div>
      ) : null}

      {trackJson ? (
        <div className="space-y-4">
          <OrderTransactionDetailCard payloadJson={trackJson} />
        </div>
      ) : null}
    </AppPageBody>
  )
}
