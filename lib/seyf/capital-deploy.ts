import { getUserWalletByUserId } from './user-wallets'
import { isWalletActive } from './pollar-wallet-provision'
import { markCycleDeployedOnchain, markCycleFailed } from './cycle-store'
import { AppError } from './api-error'
import {
  createMxOnrampQuote,
  createMxOnrampOrder,
  fetchRampableAssetsForWallet,
} from '@/lib/etherfuse/ramp-api'
import { fetchEtherfuseCetes28DayRateSnapshot } from '@/lib/etherfuse/cetes-rate'
import {
  resolveMvpPartnerCryptoWalletId,
  resolveMvpPartnerRampIdentity,
  type MvpPartnerRampIdentity,
} from '@/lib/etherfuse/partner-accounts'
import {
  purchaseCetesStablebonds,
  simulateStablebondPurchase,
  type StablebondPurchaseResult,
} from '@/lib/etherfuse/stablebonds-purchase'
import { quoteIdFromEtherfusePayload } from '@/lib/etherfuse/quote-id'
import { registerOrganizationWallet } from '@/lib/etherfuse/wallets'
import { isValidStellarPublicKey } from '@/lib/etherfuse/stellar-public-key'

type SandboxMode = 'sandbox' | 'production'

function detectSandboxMode(): SandboxMode {
  const baseUrl = process.env.ETHERFUSE_API_BASE_URL?.trim().toLowerCase() ?? ''
  if (baseUrl.includes('sand') || baseUrl.includes('test') || baseUrl.includes('dev')) {
    return 'sandbox'
  }
  return 'production'
}

function mxnCentsToDecimal(cents: number): string {
  return (cents / 100).toFixed(2)
}

function findMxneIdentifier(
  assets: Array<{ symbol?: string; identifier?: string }>,
): string | null {
  const row = assets.find(
    (a) => (a.symbol ?? '').toUpperCase() === 'MXNE',
  )
  return row?.identifier?.trim() ?? null
}

export type DeployCapitalInput = {
  userId: string
  /** Amount in integer cents (e.g. 50000 = $500.00 MXN) */
  amountMxn: number
  /** Unique cycle identifier for this deploy job — stored onchain in the cycle record. */
  cycleId: string
}

export type DeployCapitalResult = {
  onrampOrderId: string
  onrampTxHash: string | null
  stablebondOrder: StablebondPurchaseResult
  mxneAmount: string
  rateSnapshot: { annualRatePercent: number; tenorDays: 28 }
}

export async function deployCapital(
  input: DeployCapitalInput,
): Promise<DeployCapitalResult> {
  const { userId, amountMxn } = input
  const amountDecimal = mxnCentsToDecimal(amountMxn)
  const sandbox = detectSandboxMode()

  const wallet = await getUserWalletByUserId(userId)
  if (!wallet || !isWalletActive(wallet)) {
    throw new AppError('validation_error', {
      messageEs:
        'Tu wallet Stellar aún no está activa. Completa tu registro primero.',
    })
  }

  const stellarPublicKey = wallet.stellarPublicKey
  if (!stellarPublicKey || !isValidStellarPublicKey(stellarPublicKey)) {
    throw new AppError('validation_error', {
      messageEs: 'No encontramos tu clave Stellar. Contacta a soporte.',
    })
  }

  const rateSnap = await fetchEtherfuseCetes28DayRateSnapshot()

  let identity: MvpPartnerRampIdentity
  try {
    identity = await resolveMvpPartnerRampIdentity()
  } catch (e) {
    throw new AppError('deploy_failed', {
      message:
        'No se pudo resolver la identidad de rampa: ' +
        (e instanceof Error ? e.message : String(e)),
      messageEs:
        'Error de configuración del proveedor. Notifica a soporte.',
    })
  }

  const { assets } = await fetchRampableAssetsForWallet({
    walletPublicKey: stellarPublicKey,
  })
  const mxneIdentifier = findMxneIdentifier(assets)
  if (!mxneIdentifier) {
    throw new AppError('deploy_failed', {
      messageEs:
        'MXNe no está disponible como activo de rampa en este momento.',
    })
  }

  const quote = await createMxOnrampQuote({
    customerId: identity.customerId,
    sourceAmount: amountDecimal,
    targetAssetIdentifier: mxneIdentifier,
  })
  const quoteId = quoteIdFromEtherfusePayload(quote)
  if (!quoteId) {
    throw new AppError('deploy_failed', {
      messageEs:
        'Etherfuse no devolvió quoteId. Reintenta el depósito.',
    })
  }

  await registerOrganizationWallet({
    publicKey: stellarPublicKey,
    blockchain: 'stellar',
    claimOwnership: true,
  }).catch(() => {})

  let cryptoWalletId: string
  try {
    cryptoWalletId = await resolveMvpPartnerCryptoWalletId(stellarPublicKey)
  } catch (e) {
    throw new AppError('deploy_failed', {
      message: e instanceof Error ? e.message : String(e),
      messageEs:
        'Tu wallet Stellar no aparece registrada en Etherfuse. Completa /identidad.',
    })
  }

  let orderJson: unknown
  try {
    orderJson = await createMxOnrampOrder({
      bankAccountId: identity.bankAccountId,
      quoteId,
      publicKey: stellarPublicKey,
      cryptoWalletId,
    })
  } catch (e) {
    const onrampErr = new AppError('deploy_failed', {
      message: e instanceof Error ? e.message : String(e),
      messageEs:
        'Error al crear la orden de conversión MXN → MXNe. Reintenta.',
    })

    await sendAdminAlert({
      event: 'onramp_order_failed',
      userId,
      cycleId: input.cycleId,
      error: onrampErr.message,
      onrampOrderId: null,
      amountCents: amountMxn,
    })

    throw onrampErr
  }

  const onrampOrderId = extractOnrampOrderId(orderJson)
  if (!onrampOrderId) {
    throw new AppError('deploy_failed', {
      messageEs:
        'Etherfuse creó la orden pero no devolvió un identificador.',
    })
  }

  const onrampTxHash = extractOnrampTxHash(orderJson)

  let stablebondOrder: StablebondPurchaseResult
  try {
    if (sandbox === 'sandbox') {
      stablebondOrder = simulateStablebondPurchase({
        sourceAmount: amountDecimal,
        sourceAssetIdentifier: mxneIdentifier,
      })
    } else {
      stablebondOrder = await purchaseCetesStablebonds({
        customerId: identity.customerId,
        sourceAmount: amountDecimal,
        sourceAssetIdentifier: mxneIdentifier,
        publicKey: stellarPublicKey,
      })
    }
  } catch (e) {
    const cycleErr = new AppError('deploy_failed', {
      message: e instanceof Error ? e.message : String(e),
      messageEs:
        'La conversión MXNe → CETES falló. El equipo está al tanto.',
    })

    await sendAdminAlert({
      event: 'stablebond_purchase_failed',
      userId,
      cycleId: input.cycleId,
      error: cycleErr.message,
      onrampOrderId,
      amountCents: amountMxn,
    })

    throw cycleErr
  }

  const onchainTx =
    stablebondOrder.confirmedTxSignature ?? onrampTxHash ?? 'pending'

  markCycleDeployedOnchain({
    userId,
    cycleId: input.cycleId,
    onchainTx,
    etherfuseOrderId: onrampOrderId,
    mxneAmount: amountDecimal,
    stablebondOrderId: stablebondOrder.orderId,
  })

  return {
    onrampOrderId,
    onrampTxHash,
    stablebondOrder,
    mxneAmount: amountDecimal,
    rateSnapshot: {
      annualRatePercent: rateSnap.annualRatePercent,
      tenorDays: 28,
    },
  }
}

function extractOnrampOrderId(orderJson: unknown): string | null {
  if (!orderJson || typeof orderJson !== 'object') return null
  const root = orderJson as Record<string, unknown>
  const onramp = root.onramp ?? root.onRamp ?? root.on_ramp
  if (onramp && typeof onramp === 'object') {
    const o = onramp as Record<string, unknown>
    const id =
      typeof o.orderId === 'string'
        ? o.orderId
        : typeof o.order_id === 'string'
          ? o.order_id
          : null
    if (id) return id
  }
  const direct =
    typeof root.orderId === 'string'
      ? root.orderId
      : typeof root.order_id === 'string'
        ? root.order_id
        : null
  return direct
}

function extractOnrampTxHash(orderJson: unknown): string | null {
  if (!orderJson || typeof orderJson !== 'object') return null
  const root = orderJson as Record<string, unknown>
  const onramp = root.onramp ?? root.onRamp ?? root.on_ramp
  if (onramp && typeof onramp === 'object') {
    const o = onramp as Record<string, unknown>
    const tx =
      typeof o.confirmedTxSignature === 'string'
        ? o.confirmedTxSignature
        : typeof o.confirmed_tx_signature === 'string'
          ? o.confirmed_tx_signature
          : typeof o.txHash === 'string'
            ? o.txHash
            : null
    if (tx) return tx
  }
  const direct =
    typeof root.confirmedTxSignature === 'string'
      ? root.confirmedTxSignature
      : typeof root.confirmed_tx_signature === 'string'
        ? root.confirmed_tx_signature
        : null
  return direct
}

type AdminAlertPayload = {
  event: 'onramp_order_failed' | 'stablebond_purchase_failed'
  userId: string
  cycleId: string
  error: string
  /** null when the order was never created (onramp_order_failed). */
  onrampOrderId: string | null
  amountCents: number
}

async function sendAdminAlert(payload: AdminAlertPayload): Promise<void> {
  console.error('[seyf][admin-alert]', JSON.stringify(payload))
  const webhookUrl = process.env.ADMIN_ALERT_WEBHOOK_URL?.trim()
  if (!webhookUrl) return
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    // Do not mask the original deploy failure
  }
}
