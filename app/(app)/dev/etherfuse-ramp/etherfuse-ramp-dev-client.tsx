'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { AppBackLink } from '@/components/app/app-back-link'
import { AppPageBody } from '@/components/app/app-page-body'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Input } from '@/components/ui/input'
import { OrderTransactionDetailCard } from '@/components/app/dev/etherfuse-order-cards'
import { SpeiPaymentCard } from '@/components/app/dev/spei-payment-card'
import { cn } from '@/lib/utils'
import { useSeyfWallet } from '@/lib/seyf/use-seyf-wallet'
import { extractOrderIdFromCreateOrderResponse } from '@/lib/etherfuse/order-create-response'
import {
  speiDetailsFromOnrampOrderApiJson,
  type SpeiTransferDetails,
} from '@/lib/etherfuse/spei-transfer-details'
import {
  extractConfirmedTxSignatureFromOnrampPanelJson,
  pickRampOrderTransactionDetails,
} from '@/lib/etherfuse/orders-api'
import {
  type EtherfuseReadinessClientPayload,
  etherfuseDepositBlockedCopy,
  parseEtherfuseReadinessJson,
} from '@/lib/seyf/etherfuse-readiness-cta'
import { userFacingSeyfApiMessage } from '@/lib/seyf/parse-seyf-fetch-error'

type RampContextPayload = {
  kycApproved: boolean
  kycStatus: string | null
  kycReason: string | null
}

export type EtherfuseRampDevClientProps = {
  /**
   * - `landing`: solo CTA hacia /anadir/monto (evita tarjetas que parecen botón).
   * - `deposit`: formulario de monto + flujo SPEI (por defecto si no se pasa `anadirScreen`).
   */
  anadirScreen?: 'landing' | 'deposit'
}

export default function EtherfuseRampDevClient({ anadirScreen = 'deposit' }: EtherfuseRampDevClientProps) {
  const { wallet, etherfusePublicKeyHint } = useSeyfWallet()
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [sourceAmount, setSourceAmount] = useState('500')
  const [orderJson, setOrderJson] = useState<string>('')
  const [fiatJson, setFiatJson] = useState<string>('')
  const [speiDetails, setSpeiDetails] = useState<SpeiTransferDetails | null>(null)
  const [pendingManualOrderJson, setPendingManualOrderJson] = useState<string | null>(null)
  const [kycGate, setKycGate] = useState<RampContextPayload | null>(null)
  const [kycLoading, setKycLoading] = useState(true)
  const [readiness, setReadiness] = useState<EtherfuseReadinessClientPayload | null>(null)

  const walletAddr = etherfusePublicKeyHint?.trim() ?? wallet?.stellarAddress?.trim() ?? ''
  
  const { data: depositStatusData } = useSWR(
    walletAddr ? `/api/deposit/status?wallet=${encodeURIComponent(walletAddr)}` : null,
    (url: string) => fetch(url).then(res => res.json()),
    { refreshInterval: (data: any) => (data?.status === 'pendiente' ? 10000 : 0) }
  )

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
          reasons: [e instanceof Error ? e.message : 'No pudimos calcular readiness.'],
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

  const performFiatSimulation = useCallback(async (oJson: string): Promise<string> => {
    let parsed: unknown
    try {
      parsed = JSON.parse(oJson || '{}')
    } catch {
      throw new Error('Respuesta de orden JSON inválida')
    }
    const orderId = extractOrderIdFromCreateOrderResponse(parsed)
    if (!orderId) {
      throw new Error(
        'No encuentro orderId (revisa raíz o onramp/on_ramp en el JSON de la orden).',
      )
    }
    const res = await fetch('/api/seyf/etherfuse/sandbox/fiat-received', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(userFacingSeyfApiMessage(data, res.status))
    }

    let orderPolled: unknown = null
    let pollAttempts = 0
    for (let i = 0; i < 12; i++) {
      pollAttempts = i + 1
      if (i > 0) await new Promise((r) => setTimeout(r, 1500))
      const gr = await fetch(`/api/seyf/etherfuse/prueba/order/${encodeURIComponent(orderId)}`)
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

    return JSON.stringify(
      {
        sandboxFiatReceived: data,
        orderPolled,
        orderDisplay: pickRampOrderTransactionDetails(orderPolled),
        pollAttempts,
      },
      null,
      2,
    )
  }, [])

  const openManualSpeiReview = () =>
    run('spei-manual-prepare', async () => {
      const body: { sourceAmount: string; targetAsset?: string } = {
        sourceAmount: sourceAmount.trim() || '500',
      }
      const res = await fetch('/api/seyf/etherfuse/onramp/prepare-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(userFacingSeyfApiMessage(data, res.status))
      }
      const o = JSON.stringify(data, null, 2)
      const assetLabel = 'CETES'
      const details = speiDetailsFromOnrampOrderApiJson(o, assetLabel, 'Etherfuse')
      if (!details) {
        throw new Error(
          'No aparecen datos de transferencia (CLABE e importe). Revisa la respuesta o inténtalo de nuevo.',
        )
      }
      setOrderJson(o)
      setFiatJson('')
      setPendingManualOrderJson(o)
      setSpeiDetails(details)
    })

  const confirmSpeiPayment = useCallback(async () => {
    if (!speiDetails || !pendingManualOrderJson) return
    await run('spei-manual-confirm', async () => {
      const f = await performFiatSimulation(pendingManualOrderJson)
      setOrderJson(pendingManualOrderJson)
      setFiatJson(f)
      setPendingManualOrderJson(null)
      setSpeiDetails(null)
    })
  }, [speiDetails, pendingManualOrderJson, performFiatSimulation, run])

  const speiConfirmBusy = busy === 'spei-manual-confirm'
  const canOperate = readiness?.onrampEnabled === true
  const readinessReasons = readiness?.reasons ?? []
  const depositBlocked = etherfuseDepositBlockedCopy({
    readiness,
    kycLoading,
    mode: 'deposit',
    fallbackReason: kycGate?.kycReason ?? null,
  })

  const onrampTxSignature = useMemo(
    () => extractConfirmedTxSignatureFromOnrampPanelJson(fiatJson),
    [fiatJson],
  )

  const stellarTxExplorerUrl = useMemo(() => {
    if (!onrampTxSignature) return null
    const isMain =
      typeof process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'string' &&
      ['public', 'mainnet'].includes(
        process.env.NEXT_PUBLIC_STELLAR_NETWORK.toLowerCase(),
      )
    const base = isMain
      ? 'https://stellar.expert/explorer/public/tx/'
      : 'https://stellar.expert/explorer/testnet/tx/'
    return `${base}${encodeURIComponent(onrampTxSignature)}`
  }, [onrampTxSignature])

  /** Solo pasos en lenguaje de banca; se muestra después de tener CLABE. */
  const depositProgress = useMemo(() => {
    const hasInstructions = Boolean(speiDetails)
    const bankSent = Boolean(fiatJson)
    const credited = Boolean(onrampTxSignature)
    
    const realPending = depositStatusData?.status === 'pendiente'
    const realCompleted = depositStatusData?.status === 'completado'

    return [
      {
        label: 'Listo: tienes CLABE e importe',
        description: 'Copia los datos en tu app del banco.',
        done: hasInstructions || realPending || realCompleted,
      },
      {
        label: 'Tu banco envió el dinero',
        description: realPending ? 'Tiempo estimado: 5 minutos' : 'Esperamos tu transferencia. Si la app te lo pide, confirma abajo que ya enviaste.',
        done: bankSent || realPending || realCompleted,
      },
      {
        label: 'Saldo en tu cuenta Seyf',
        description: 'Cuando acredite verás el movimiento.',
        done: credited || realCompleted,
      },
    ]
  }, [speiDetails, fiatJson, onrampTxSignature, depositStatusData])

  const showDepositProgress = Boolean(speiDetails || fiatJson || onrampTxSignature || depositStatusData?.status === 'pendiente')

  const progressSection = showDepositProgress ? (
    <section className="rounded-[1.25rem] border border-border bg-card/60 p-4">
      <p className="text-sm font-bold text-foreground">Seguimiento del depósito</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Así va tu transferencia; no hace falta entender términos técnicos.
      </p>
      <div className="mt-3 space-y-3">
        {depositProgress.map((step) => (
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
  ) : null

  if (anadirScreen === 'landing') {
    return (
      <AppPageBody className="space-y-6 px-4 pt-3 sm:px-6 sm:pt-4">
        <AppBackLink href="/dashboard" />

        {!canOperate ? (
          <section className="rounded-[1.25rem] border border-amber-500/30 bg-amber-500/[0.08] p-4">
            <p className="text-sm font-bold text-foreground">{depositBlocked.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{depositBlocked.lead}</p>
            {readinessReasons.length ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                {readinessReasons.slice(0, 5).map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            ) : null}
            <div className="mt-3 flex flex-col gap-2">
              <Link
                href={depositBlocked.primaryLink.href}
                className="inline-flex text-sm font-semibold text-foreground underline"
              >
                {depositBlocked.primaryLink.label}
              </Link>
              {depositBlocked.extraLinks.map((item) => (
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
        ) : (
          <section className="space-y-4 rounded-[1.5rem] border border-border bg-card p-5">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                Depósito SPEI
              </p>
              <h1 className="mt-2 text-xl font-black tracking-tight text-foreground sm:text-2xl">
                Añadir fondos
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Indica en el siguiente paso cuánto vas a enviar; generamos la cotización y te mostramos la CLABE,
                el beneficiario y el importe exacto para hacer la transferencia desde tu banco.
              </p>
            </div>
            <Button
              asChild
              size="lg"
              className="h-14 w-full rounded-2xl text-base font-bold shadow-md"
            >
              <Link href="/anadir/monto">Genera datos de depósito</Link>
            </Button>
          </section>
        )}

        {progressSection}

        {err && (
          <p className="rounded-[1rem] border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {err}
          </p>
        )}
      </AppPageBody>
    )
  }

  return (
    <AppPageBody className="space-y-6 px-4 pt-3 sm:px-6 sm:pt-4">
      <AppBackLink href="/anadir" />

      {!canOperate ? (
        <section className="rounded-[1.25rem] border border-amber-500/30 bg-amber-500/[0.08] p-4">
          <p className="text-sm font-bold text-foreground">{depositBlocked.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{depositBlocked.lead}</p>
          {readinessReasons.length ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              {readinessReasons.slice(0, 5).map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
          <div className="mt-3 flex flex-col gap-2">
            <Link
              href={depositBlocked.primaryLink.href}
              className="inline-flex text-sm font-semibold text-foreground underline"
            >
              {depositBlocked.primaryLink.label}
            </Link>
            {depositBlocked.extraLinks.map((item) => (
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

      {canOperate ? (
        <section className="space-y-3 rounded-[1.5rem] border border-[#bfd6ca] bg-[#f4faf7] p-4 dark:border-border dark:bg-card/80 sm:p-5">
          {wallet && !etherfusePublicKeyHint ? (
            <p className="rounded-xl border border-amber-500/35 bg-amber-500/[0.08] px-3 py-2 text-xs leading-relaxed text-amber-900 dark:text-amber-100/90">
              Tu sesión Pollar muestra un identificador que aún no es una clave Stellar <span className="font-mono">G…</span> reconocible
              por Etherfuse. El depósito usará la sesión de <Link href="/identidad" className="font-semibold underline">/identidad</Link>.
              Si el error persiste, abre devnet y confirma KYC y cuenta bancaria.
            </p>
          ) : null}
          <div>
            <h2 className="text-base font-bold text-foreground">¿Cuánto vas a depositar?</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Monto en pesos. Necesitamos el importe exacto para generar los datos de transferencia SPEI.
            </p>
          </div>
          <Input
            id="manual-amount"
            name="deposit-amount-mxn"
            autoComplete="off"
            inputMode="decimal"
            value={sourceAmount}
            onChange={(e) => setSourceAmount(e.target.value)}
            placeholder="Ej. 500.00"
            className="h-14 rounded-2xl border-[#c6dccf] bg-background px-4 text-lg tabular-nums font-semibold"
            aria-label="Monto en pesos mexicanos"
          />
          <Button
            type="button"
            className="h-14 w-full rounded-2xl bg-foreground text-base font-bold text-background shadow-md"
            disabled={!!busy}
            onClick={() => void openManualSpeiReview()}
          >
            {busy === 'spei-manual-prepare' ? (
              <>
                <Spinner className="size-4 text-background" />
                Generando datos…
              </>
            ) : (
              'Genera datos de depósito'
            )}
          </Button>
        </section>
      ) : null}

      <SpeiPaymentCard
        details={speiDetails}
        concept={speiDetails?.orderId ?? null}
      />

      {speiDetails && pendingManualOrderJson ? (
        <Button
          type="button"
          className="h-12 w-full rounded-2xl border border-[#1b6155]/40 bg-gradient-to-br from-[#15534a] to-[#1b6155] text-[15px] font-bold text-white shadow-[0_8px_24px_rgba(21,83,74,0.35)] hover:from-[#1a5f52] hover:to-[#1f6d61] disabled:opacity-60 dark:border-emerald-950/30 dark:shadow-[0_8px_28px_rgba(8,42,36,0.45)]"
          disabled={!!busy || !canOperate}
          onClick={() => void confirmSpeiPayment()}
        >
          {speiConfirmBusy ? (
            <>
              <Spinner className="size-4 text-white" />
              Procesando…
            </>
          ) : (
            'Ya hice la transferencia desde mi banco'
          )}
        </Button>
      ) : null}

      {progressSection}

      {err && (
        <p className="mt-6 rounded-[1rem] border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {err}
        </p>
      )}

      {onrampTxSignature && stellarTxExplorerUrl ? (
        <div className="rounded-[1.5rem] border border-border bg-card p-4">
          <p className="text-sm font-bold text-foreground">Comprobante de acreditación</p>
          <p className="mt-2 break-all font-mono text-xs text-muted-foreground">{onrampTxSignature}</p>
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

      {fiatJson ? (
        <div className="space-y-4">
          <OrderTransactionDetailCard payloadJson={fiatJson} />
        </div>
      ) : null}
    </AppPageBody>
  )
}
