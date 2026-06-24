import { etherfuseFetch, etherfuseReadBody, extractEtherfuseErrorMessage } from './client'
import { mapEtherfuseHttpError } from './errors'
import { getEtherfuseDefaultBlockchain } from './integration-model'
import { randomUUID } from 'node:crypto'

export type StablebondPurchaseResult = {
  orderId: string
  status: string
  confirmedTxSignature: string | null
  sourceAsset: string
  targetAsset: string
  sourceAmount: string
  targetAmount: string | null
  createdAt: string
}

const EMPTY_PURCHASE_RESULT: StablebondPurchaseResult = {
  orderId: '',
  status: 'failed',
  confirmedTxSignature: null,
  sourceAsset: '',
  targetAsset: '',
  sourceAmount: '',
  targetAmount: null,
  createdAt: '',
}

export function pickPurchaseResult(data: unknown): StablebondPurchaseResult | null {
  if (!data || typeof data !== 'object') return null
  const o = data as Record<string, unknown>
  const orderId =
    typeof o.orderId === 'string'
      ? o.orderId
      : typeof o.order_id === 'string'
        ? o.order_id
        : ''
  if (!orderId) return null

  const status =
    typeof o.status === 'string'
      ? o.status
      : typeof o.orderStatus === 'string'
        ? o.orderStatus
        : 'unknown'

  const confirmedTxSignature =
    typeof o.confirmedTxSignature === 'string'
      ? o.confirmedTxSignature
      : typeof o.confirmed_tx_signature === 'string'
        ? o.confirmed_tx_signature
        : typeof o.txHash === 'string'
          ? o.txHash
          : null

  const sourceAsset =
    typeof o.sourceAsset === 'string'
      ? o.sourceAsset
      : typeof o.source_asset === 'string'
        ? o.source_asset
        : ''

  const targetAsset =
    typeof o.targetAsset === 'string'
      ? o.targetAsset
      : typeof o.target_asset === 'string'
        ? o.target_asset
        : ''

  const sourceAmount =
    typeof o.sourceAmount === 'string'
      ? o.sourceAmount
      : typeof o.source_amount === 'string'
        ? o.source_amount
        : typeof o.amount === 'string'
          ? o.amount
          : ''

  const targetAmount =
    typeof o.targetAmount === 'string'
      ? o.targetAmount
      : typeof o.target_amount === 'string'
        ? o.target_amount
        : typeof o.receivedAmount === 'string'
          ? o.receivedAmount
          : null

  const createdAt =
    typeof o.createdAt === 'string'
      ? o.createdAt
      : typeof o.created_at === 'string'
        ? o.created_at
        : typeof o.timestamp === 'string'
          ? o.timestamp
          : ''

  return {
    orderId,
    status,
    confirmedTxSignature,
    sourceAsset,
    targetAsset,
    sourceAmount,
    targetAmount,
    createdAt,
  }
}

export async function purchaseCetesStablebonds(params: {
  customerId: string
  sourceAmount: string
  sourceAssetIdentifier: string
  publicKey: string
  orderId?: string
}): Promise<StablebondPurchaseResult> {
  const orderId = params.orderId ?? randomUUID()
  const blockchain = getEtherfuseDefaultBlockchain()

  const body: Record<string, unknown> = {
    orderId,
    customerId: params.customerId,
    publicKey: params.publicKey,
    blockchain,
    sourceAsset: params.sourceAssetIdentifier,
    sourceAmount: params.sourceAmount,
    targetAsset: 'CETES',
    type: 'stablebond_purchase',
  }

  const res = await etherfuseFetch('/ramp/stablebonds/purchase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    retryable: false,
  })

  const { json, text } = await etherfuseReadBody(res)
  if (!res.ok) {
    const msg = extractEtherfuseErrorMessage(json, text, 500)
    throw mapEtherfuseHttpError(
      res.status,
      `Etherfuse /ramp/stablebonds/purchase (${res.status}): ${msg}`,
    )
  }

  const result = pickPurchaseResult(json)
  if (!result) {
    throw new Error(
      `Etherfuse stablebond purchase: respuesta sin orderId: ${text.slice(0, 300)}`,
    )
  }

  return result
}

export async function fetchStablebondPurchaseOrder(
  orderId: string,
): Promise<StablebondPurchaseResult | null> {
  const res = await etherfuseFetch(
    `/ramp/stablebonds/purchase/${encodeURIComponent(orderId)}`,
    { method: 'GET' },
  )
  const { json, text } = await etherfuseReadBody(res)
  if (!res.ok) {
    const msg = extractEtherfuseErrorMessage(json, text, 400)
    throw mapEtherfuseHttpError(
      res.status,
      `Etherfuse /ramp/stablebonds/purchase/${orderId} (${res.status}): ${msg}`,
    )
  }
  return pickPurchaseResult(json)
}

export function simulateStablebondPurchase(params: {
  sourceAmount: string
  sourceAssetIdentifier: string
}): StablebondPurchaseResult {
  const orderId = `sb-sim-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  return {
    orderId,
    status: 'confirmed',
    confirmedTxSignature: `simulated-tx-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    sourceAsset: params.sourceAssetIdentifier,
    targetAsset: 'CETES',
    sourceAmount: params.sourceAmount,
    targetAmount: params.sourceAmount,
    createdAt: new Date().toISOString(),
  }
}
