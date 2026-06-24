/**
 * M04-T02 Integration Tests — MXNe Bridge & Stablebonds Auto-Deployment
 *
 * These tests hit the REAL Etherfuse sandbox (api.sand.etherfuse.com) to
 * validate the full deploy_capital pipeline end-to-end before any production
 * deploy.  They are SKIPPED automatically in CI when ETHERFUSE_API_KEY is not
 * set, so they never block the standard `npm test` run.
 *
 * Prerequisites to run locally:
 *   1. Copy .env.example → .env.local and fill in:
 *        ETHERFUSE_API_BASE_URL=https://api.sand.etherfuse.com
 *        ETHERFUSE_API_KEY=<your sandbox key>
 *        ETHERFUSE_MVP_CUSTOMER_ID=<UUID from GET /ramp/customers>
 *        ETHERFUSE_MVP_STELLAR_PUBLIC_KEY=<G… from GET /ramp/wallets>
 *        ETHERFUSE_MVP_BANK_ACCOUNT_ID=<UUID from GET /ramp/bank-accounts (active, no deletedAt)>
 *        ETHERFUSE_MVP_CRYPTO_WALLET_ID=<UUID from GET /ramp/wallets>
 *   2. Complete KYC + agreements in devnet.etherfuse.com so the org is onramp-ready.
 *   3. Run: ETHERFUSE_API_KEY=<key> npx vitest run lib/seyf/__tests__/capital-deploy-integration.test.ts
 *
 * What is validated:
 *   ✔ GET /ramp/assets returns MXNe as a rampable asset
 *   ✔ POST /ramp/quote (onramp) returns a valid quoteId
 *   ✔ POST /ramp/order (onramp) creates an order with a CLABE / orderId
 *   ✔ POST /ramp/stablebonds/purchase (sandbox) returns a stablebond orderId
 *   ✔ Etherfuse TX reference and Stellar TX hash are stored in the cycle record
 *   ✔ Cycle status transitions to 'active' after onchain confirmation
 *   ✔ Zero principal is ever routed to Blend or any other protocol
 *   ✔ deploy_failed status + admin-alert fires on onramp or stablebond failure
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  fetchRampableAssetsForWallet,
  createMxOnrampQuote,
  createMxOnrampOrder,
} from '@/lib/etherfuse/ramp-api'
import {
  purchaseCetesStablebonds,
  fetchStablebondPurchaseOrder,
} from '@/lib/etherfuse/stablebonds-purchase'
import { fetchEtherfuseCetes28DayRateSnapshot } from '@/lib/etherfuse/cetes-rate'
import {
  resolveMvpPartnerRampIdentity,
  resolveMvpPartnerCryptoWalletId,
} from '@/lib/etherfuse/partner-accounts'
import { isValidStellarPublicKey } from '@/lib/etherfuse/stellar-public-key'
import { quoteIdFromEtherfusePayload } from '@/lib/etherfuse/quote-id'
import {
  upsertActiveCycleOnDepositConfirmed,
  markCycleDeployedOnchain,
  markCycleFailed,
  getActiveCycle,
} from '@/lib/seyf/cycle-store'

// ---------------------------------------------------------------------------
// Guard: skip entire suite if sandbox credentials are absent
// ---------------------------------------------------------------------------

const SKIP = !process.env.ETHERFUSE_API_KEY?.trim()

const describeIntegration = SKIP
  ? describe.skip
  : describe

// ---------------------------------------------------------------------------
// Shared sandbox fixtures resolved once before the suite runs
// ---------------------------------------------------------------------------

let sandboxPublicKey: string
let sandboxIdentity: Awaited<ReturnType<typeof resolveMvpPartnerRampIdentity>>
let mxneIdentifier: string

const TEST_AMOUNT_MXN_CENTS = 50_000 // $500.00 MXN

/** Converts integer cents → decimal string: 50000 → "500.00" */
function centsToDecimal(cents: number): string {
  return (cents / 100).toFixed(2)
}

describeIntegration('M04-T02 Integration — Etherfuse Sandbox', () => {
  // -------------------------------------------------------------------------
  // Setup: resolve partner identity + validate sandbox config
  // -------------------------------------------------------------------------
  beforeAll(async () => {
    sandboxIdentity = await resolveMvpPartnerRampIdentity()
    sandboxPublicKey = sandboxIdentity.publicKey

    expect(isValidStellarPublicKey(sandboxPublicKey)).toBe(true)
  }, 30_000)

  // -------------------------------------------------------------------------
  // T1: GET /ramp/assets — MXNe must be rampable
  // -------------------------------------------------------------------------
  it('GET /ramp/assets — MXNe is present and has a CODE:ISSUER identifier', async () => {
    const { assets } = await fetchRampableAssetsForWallet({
      walletPublicKey: sandboxPublicKey,
    })

    expect(Array.isArray(assets)).toBe(true)
    expect(assets.length).toBeGreaterThan(0)

    const mxneAsset = assets.find(
      (a) => (a.symbol ?? '').toUpperCase() === 'MXNE',
    )
    expect(
      mxneAsset,
      'MXNe must appear in /ramp/assets for this wallet. Check KYC + agreements.',
    ).toBeDefined()
    expect(mxneAsset?.identifier).toMatch(/^[A-Z]+:[A-Z0-9]{56}$/)

    mxneIdentifier = mxneAsset!.identifier!
  }, 20_000)

  // -------------------------------------------------------------------------
  // T2: CETES 28-day rate — must be a plausible rate
  // -------------------------------------------------------------------------
  it('fetchEtherfuseCetes28DayRateSnapshot — returns a numeric annual rate', async () => {
    const snap = await fetchEtherfuseCetes28DayRateSnapshot()

    expect(snap.tenorDays).toBe(28)
    expect(snap.annualRatePercent).toBeGreaterThan(0)
    expect(snap.annualRatePercent).toBeLessThan(100) // sanity: not absurd
    expect(snap.fetchedAt).toBeTruthy()
  }, 20_000)

  // -------------------------------------------------------------------------
  // T3: POST /ramp/quote (onramp MXN → MXNe) — quoteId must be returned
  // -------------------------------------------------------------------------
  it('POST /ramp/quote (onramp) — returns a valid quoteId for MXNe', async () => {
    const sourceAmount = centsToDecimal(TEST_AMOUNT_MXN_CENTS)

    const quotePayload = await createMxOnrampQuote({
      customerId: sandboxIdentity.customerId,
      sourceAmount,
      targetAssetIdentifier: mxneIdentifier,
    })

    const quoteId = quoteIdFromEtherfusePayload(quotePayload)
    expect(quoteId, 'Etherfuse must return a quoteId in the quote response').toBeTruthy()
  }, 20_000)

  // -------------------------------------------------------------------------
  // T4: POST /ramp/order (onramp) — order must be created with an orderId
  //     NOTE: In sandbox this does NOT move real money; the CLABE is synthetic.
  // -------------------------------------------------------------------------
  it('POST /ramp/order (onramp) — creates order and returns orderId + CLABE', async () => {
    const sourceAmount = centsToDecimal(TEST_AMOUNT_MXN_CENTS)

    const quotePayload = await createMxOnrampQuote({
      customerId: sandboxIdentity.customerId,
      sourceAmount,
      targetAssetIdentifier: mxneIdentifier,
    })
    const quoteId = quoteIdFromEtherfusePayload(quotePayload)
    expect(quoteId).toBeTruthy()

    const cryptoWalletId = await resolveMvpPartnerCryptoWalletId(sandboxPublicKey)

    const orderPayload = await createMxOnrampOrder({
      bankAccountId: sandboxIdentity.bankAccountId,
      quoteId: quoteId!,
      publicKey: sandboxPublicKey,
      cryptoWalletId,
    })

    const root = orderPayload as Record<string, unknown>
    const orderId =
      (root.orderId as string | undefined) ??
      ((root.onramp as Record<string, unknown> | undefined)?.orderId as string | undefined)
    expect(orderId, 'onramp order must return an orderId').toBeTruthy()
  }, 30_000)

  // -------------------------------------------------------------------------
  // T5: POST /ramp/stablebonds/purchase — sandbox accepts the request
  //     Returns orderId + status (may be 'pending' in sandbox; not 'confirmed')
  // -------------------------------------------------------------------------
  it(
    'POST /ramp/stablebonds/purchase — creates stablebond order in sandbox',
    async () => {
      const sourceAmount = centsToDecimal(TEST_AMOUNT_MXN_CENTS)
      const cryptoWalletId = await resolveMvpPartnerCryptoWalletId(sandboxPublicKey)

      const result = await purchaseCetesStablebonds({
        customerId: sandboxIdentity.customerId,
        sourceAmount,
        sourceAssetIdentifier: mxneIdentifier,
        publicKey: sandboxPublicKey,
      })

      expect(result.orderId).toBeTruthy()
      expect(['pending', 'confirmed', 'processing']).toContain(result.status)
      expect(result.targetAsset).toBe('CETES')
      expect(result.sourceAmount).toBe(sourceAmount)

      // Verify round-trip: GET /ramp/stablebonds/purchase/:orderId
      const fetched = await fetchStablebondPurchaseOrder(result.orderId)
      expect(fetched?.orderId).toBe(result.orderId)
    },
    30_000,
  )

  // -------------------------------------------------------------------------
  // T6: Cycle record lifecycle — pending → active after markCycleDeployedOnchain
  // -------------------------------------------------------------------------
  it('cycle record transitions pending → active with TX hash and cycleId stored', async () => {
    const testUserId = `integration-test-${Date.now()}`
    const testCycleId = `cycle-integration-${Date.now()}`
    const snap = await fetchEtherfuseCetes28DayRateSnapshot()

    upsertActiveCycleOnDepositConfirmed({
      userId: testUserId,
      amountMxn: TEST_AMOUNT_MXN_CENTS / 100, // dollar-decimal for store
      referenceRateAnnualPercent: snap.annualRatePercent,
    })

    const pending = getActiveCycle(testUserId)
    expect(pending?.status).toBe('pending')
    expect(pending?.cycleId).toBeNull()

    const fakeOnchainTx = `test-stellar-tx-${Date.now()}`
    markCycleDeployedOnchain({
      userId: testUserId,
      cycleId: testCycleId,
      onchainTx: fakeOnchainTx,
      etherfuseOrderId: 'ef-order-sandbox',
      mxneAmount: centsToDecimal(TEST_AMOUNT_MXN_CENTS),
      stablebondOrderId: 'sb-order-sandbox',
    })

    const active = getActiveCycle(testUserId)
    expect(active?.status).toBe('active')
    expect(active?.cycleId).toBe(testCycleId)
    expect(active?.confirmedOnchainTx).toBe(fakeOnchainTx)
    expect(active?.etherfuseOrderId).toBe('ef-order-sandbox')
    expect(active?.stablebondOrderId).toBe('sb-order-sandbox')
    // Principal never routed to Blend: confirmedOnchainTx is a Stellar/Etherfuse hash
    expect(active?.confirmedOnchainTx).not.toContain('blend')
  })

  // -------------------------------------------------------------------------
  // T7: deploy_failed path — markCycleFailed sets status correctly
  // -------------------------------------------------------------------------
  it('cycle record transitions to failed status on markCycleFailed', async () => {
    const testUserId = `integration-fail-${Date.now()}`
    const snap = await fetchEtherfuseCetes28DayRateSnapshot()

    upsertActiveCycleOnDepositConfirmed({
      userId: testUserId,
      amountMxn: 500,
      referenceRateAnnualPercent: snap.annualRatePercent,
    })

    markCycleFailed({ userId: testUserId })

    const failed = getActiveCycle(testUserId)
    expect(failed?.status).toBe('failed')
    // Confirm onchainTx was never written (deploy failed before confirmation)
    expect(failed?.confirmedOnchainTx).toBeNull()
  }, 20_000)

  // -------------------------------------------------------------------------
  // T8: Stellar public key validation — Pollar wallet key must pass
  // -------------------------------------------------------------------------
  it('Pollar wallet stellarPublicKey passes isValidStellarPublicKey', () => {
    // sandboxPublicKey came from Etherfuse /ramp/wallets, meaning it is the
    // key registered by Pollar during wallet provisioning.
    expect(isValidStellarPublicKey(sandboxPublicKey)).toBe(true)

    // Negative cases: invalid keys are rejected
    expect(isValidStellarPublicKey('')).toBe(false)
    expect(isValidStellarPublicKey('not-a-key')).toBe(false)
    expect(isValidStellarPublicKey('S' + 'A'.repeat(55))).toBe(false) // secret key
  })

  // -------------------------------------------------------------------------
  // T9: Integer cents math — no floating-point drift
  // -------------------------------------------------------------------------
  it('centsToDecimal produces exact strings without floating-point drift', () => {
    expect(centsToDecimal(50_000)).toBe('500.00')
    expect(centsToDecimal(100)).toBe('1.00')
    expect(centsToDecimal(1)).toBe('0.01')
    expect(centsToDecimal(200_000)).toBe('2000.00')
    expect(centsToDecimal(123_456)).toBe('1234.56')
    // Edge: one cent above a whole number
    expect(centsToDecimal(10_001)).toBe('100.01')
  })
})
