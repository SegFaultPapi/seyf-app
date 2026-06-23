import { describe, it, expect } from 'vitest'
import { simulateStablebondPurchase, pickPurchaseResult } from '../stablebonds-purchase'

describe('simulateStablebondPurchase', () => {
  it('returns a confirmed order with source and target amounts', () => {
    const result = simulateStablebondPurchase({
      sourceAmount: '500.00',
      sourceAssetIdentifier: 'MXNE:GA7TEPCBDQKI7J6Z2Q2JY6VQ7Z2Q2JY6VQ7Z2Q2JY6VQ7Z2Q2JY6VQ7',
    })

    expect(result.status).toBe('confirmed')
    expect(result.sourceAmount).toBe('500.00')
    expect(result.targetAsset).toBe('CETES')
    expect(result.targetAmount).toBe('500.00')
    expect(result.orderId).toMatch(/^sb-sim-\d+-[a-z0-9]+$/)
    expect(result.confirmedTxSignature).toMatch(/^simulated-tx-\d+-[a-z0-9]+$/)
    expect(result.createdAt).toBeTruthy()
  })

  it('produces different order IDs on successive calls', () => {
    const a = simulateStablebondPurchase({ sourceAmount: '100', sourceAssetIdentifier: 'MXNE:issuer' })
    const b = simulateStablebondPurchase({ sourceAmount: '100', sourceAssetIdentifier: 'MXNE:issuer' })

    expect(a.orderId).not.toBe(b.orderId)
    expect(a.confirmedTxSignature).not.toBe(b.confirmedTxSignature)
  })
})

describe('pickPurchaseResult', () => {
  it('extracts fields from a full response object', () => {
    const data = {
      orderId: 'sb-1',
      status: 'confirmed',
      confirmedTxSignature: 'tx-hash-123',
      sourceAsset: 'MXNE:issuer',
      targetAsset: 'CETES',
      sourceAmount: '500.00',
      targetAmount: '500.00',
      createdAt: '2026-06-01T00:00:00Z',
    }

    const result = pickPurchaseResult(data)
    expect(result).not.toBeNull()
    expect(result!.orderId).toBe('sb-1')
    expect(result!.confirmedTxSignature).toBe('tx-hash-123')
    expect(result!.targetAmount).toBe('500.00')
  })

  it('extracts fields from snake_case response', () => {
    const data = {
      order_id: 'sb-2',
      status: 'confirmed',
      confirmed_tx_signature: 'tx-hash-456',
      source_asset: 'MXNE:issuer',
      target_asset: 'CETES',
      source_amount: '250.00',
      target_amount: '250.00',
      created_at: '2026-06-01T00:00:00Z',
    }

    const result = pickPurchaseResult(data)
    expect(result).not.toBeNull()
    expect(result!.orderId).toBe('sb-2')
    expect(result!.confirmedTxSignature).toBe('tx-hash-456')
    expect(result!.sourceAsset).toBe('MXNE:issuer')
  })

  it('returns null when no orderId is present', () => {
    expect(pickPurchaseResult({ status: 'error' })).toBeNull()
    expect(pickPurchaseResult(null)).toBeNull()
    expect(pickPurchaseResult('not an object')).toBeNull()
  })

  it('handles txHash as fallback for confirmedTxSignature', () => {
    const data = {
      orderId: 'sb-3',
      status: 'confirmed',
      txHash: 'stellar-tx-789',
      sourceAsset: 'MXNE:issuer',
      targetAsset: 'CETES',
      sourceAmount: '100.00',
    }

    const result = pickPurchaseResult(data)
    expect(result).not.toBeNull()
    expect(result!.confirmedTxSignature).toBe('stellar-tx-789')
  })

  it('handles receivedAmount as fallback for targetAmount', () => {
    const data = {
      orderId: 'sb-4',
      status: 'confirmed',
      sourceAsset: 'MXNE:issuer',
      targetAsset: 'CETES',
      sourceAmount: '100.00',
      receivedAmount: '99.50',
    }

    const result = pickPurchaseResult(data)
    expect(result).not.toBeNull()
    expect(result!.targetAmount).toBe('99.50')
  })
})
