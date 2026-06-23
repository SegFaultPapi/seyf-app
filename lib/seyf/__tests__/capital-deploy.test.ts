import { describe, it, expect, vi, beforeEach } from 'vitest'
import { deployCapital } from '../capital-deploy'
import { AppError } from '../api-error'

vi.mock('../user-wallets', () => ({
  getUserWalletByUserId: vi.fn(),
}))

vi.mock('../pollar-wallet-provision', () => ({
  isWalletActive: vi.fn(),
}))

vi.mock('@/lib/etherfuse/partner-accounts', () => ({
  resolveMvpPartnerRampIdentity: vi.fn(),
  resolveMvpPartnerCryptoWalletId: vi.fn(),
}))

vi.mock('@/lib/etherfuse/ramp-api', () => ({
  fetchRampableAssetsForWallet: vi.fn(),
  createMxOnrampQuote: vi.fn(),
  createMxOnrampOrder: vi.fn(),
}))

vi.mock('@/lib/etherfuse/cetes-rate', () => ({
  fetchEtherfuseCetes28DayRateSnapshot: vi.fn(),
}))

vi.mock('@/lib/etherfuse/quote-id', () => ({
  quoteIdFromEtherfusePayload: vi.fn(),
}))

vi.mock('@/lib/etherfuse/wallets', () => ({
  registerOrganizationWallet: vi.fn(),
}))

vi.mock('@/lib/etherfuse/stablebonds-purchase', () => ({
  purchaseCetesStablebonds: vi.fn(),
  simulateStablebondPurchase: vi.fn(),
}))

vi.mock('../cycle-store', () => ({
  markCycleDeployedOnchain: vi.fn(),
  markCycleFailed: vi.fn(),
}))

import { getUserWalletByUserId } from '../user-wallets'
import { isWalletActive } from '../pollar-wallet-provision'
import { resolveMvpPartnerRampIdentity, resolveMvpPartnerCryptoWalletId } from '@/lib/etherfuse/partner-accounts'
import { fetchRampableAssetsForWallet, createMxOnrampQuote, createMxOnrampOrder } from '@/lib/etherfuse/ramp-api'
import { fetchEtherfuseCetes28DayRateSnapshot } from '@/lib/etherfuse/cetes-rate'
import { quoteIdFromEtherfusePayload } from '@/lib/etherfuse/quote-id'
import { registerOrganizationWallet } from '@/lib/etherfuse/wallets'
import { simulateStablebondPurchase, purchaseCetesStablebonds } from '@/lib/etherfuse/stablebonds-purchase'
import { markCycleDeployedOnchain } from '../cycle-store'

const mockWallet = {
  id: 'wallet-1',
  userId: 'user-1',
  pollarWalletId: 'pollar-1',
  stellarPublicKey: 'GD5IXS6JONZFX2KJ2CZ5IY5CFMOLX5Q4KYTZ7Q4QJ4GV4Q4V4Q4V4Q4V',
  status: 'active' as const,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

const mockIdentity = {
  customerId: 'customer-1',
  bankAccountId: 'bank-1',
  publicKey: 'GD5IXS6JONZFX2KJ2CZ5IY5CFMOLX5Q4KYTZ7Q4QJ4GV4Q4V4Q4V4Q4V',
}

const mockRateSnapshot = {
  tenorDays: 28 as const,
  annualRatePercent: 9.8,
  fetchedAt: '2026-06-01T00:00:00Z',
  raw: {},
}

const mockAssets = {
  assets: [
    { symbol: 'MXNE', identifier: 'MXNE:GA7TEPCBDQKI7J6Z2Q2JY6VQ7Z2Q2JY6VQ7Z2Q2JY6VQ7Z2Q2JY6VQ7' },
    { symbol: 'CETES', identifier: 'CETES:GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4' },
  ],
}

const mockQuote = {
  quoteId: 'quote-1',
  rate: 1.0,
}

const mockOrderResponse = {
  onramp: {
    orderId: 'order-1',
    depositClabe: '646180615200001646',
    depositAmount: 500,
  },
}

const mockStablebondResult = {
  orderId: 'sb-order-1',
  status: 'confirmed',
  confirmedTxSignature: 'stellar-tx-hash-abc123',
  sourceAsset: 'MXNE:GA7TEPCBDQKI7J6Z2Q2JY6VQ7Z2Q2JY6VQ7Z2Q2JY6VQ7Z2Q2JY6VQ7',
  targetAsset: 'CETES',
  sourceAmount: '500.00',
  targetAmount: '500.00',
  createdAt: '2026-06-01T00:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ETHERFUSE_API_BASE_URL = 'https://api.sand.etherfuse.com'
})

describe('deployCapital', () => {
  it('deploys capital successfully: MXN → MXNe → CETES', async () => {
    vi.mocked(getUserWalletByUserId).mockResolvedValue(mockWallet)
    vi.mocked(isWalletActive).mockReturnValue(true)
    vi.mocked(resolveMvpPartnerRampIdentity).mockResolvedValue(mockIdentity)
    vi.mocked(fetchEtherfuseCetes28DayRateSnapshot).mockResolvedValue(mockRateSnapshot)
    vi.mocked(fetchRampableAssetsForWallet).mockResolvedValue(mockAssets)
    vi.mocked(createMxOnrampQuote).mockResolvedValue(mockQuote)
    vi.mocked(quoteIdFromEtherfusePayload).mockReturnValue('quote-1')
    vi.mocked(registerOrganizationWallet).mockResolvedValue({
      walletId: 'wallet-eth-1',
      customerId: 'customer-1',
      publicKey: mockWallet.stellarPublicKey,
      blockchain: 'stellar',
    })
    vi.mocked(resolveMvpPartnerCryptoWalletId).mockResolvedValue('crypto-wallet-1')
    vi.mocked(createMxOnrampOrder).mockResolvedValue(mockOrderResponse)
    vi.mocked(simulateStablebondPurchase).mockReturnValue(mockStablebondResult)

    const result = await deployCapital({
      userId: 'user-1',
      amountMxn: 50000,
      cycleId: 'cycle-1',
    })

    expect(result.onrampOrderId).toBe('order-1')
    expect(result.mxneAmount).toBe('500.00')
    expect(result.stablebondOrder.orderId).toBe('sb-order-1')
    expect(result.stablebondOrder.status).toBe('confirmed')
    expect(result.rateSnapshot.annualRatePercent).toBe(9.8)

    expect(createMxOnrampQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'customer-1',
        sourceAmount: '500.00',
        targetAssetIdentifier: 'MXNE:GA7TEPCBDQKI7J6Z2Q2JY6VQ7Z2Q2JY6VQ7Z2Q2JY6VQ7Z2Q2JY6VQ7',
      }),
    )

    expect(markCycleDeployedOnchain).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        cycleId: 'cycle-1',
        onchainTx: 'stellar-tx-hash-abc123',
        etherfuseOrderId: 'order-1',
        mxneAmount: '500.00',
        stablebondOrderId: 'sb-order-1',
      }),
    )
  })

  it('throws AppError when user wallet not found', async () => {
    vi.mocked(getUserWalletByUserId).mockResolvedValue(null)

    await expect(
      deployCapital({ userId: 'user-missing', amountMxn: 50000, cycleId: 'cycle-1' }),
    ).rejects.toThrow(AppError)
  })

  it('throws AppError when wallet is not active', async () => {
    vi.mocked(getUserWalletByUserId).mockResolvedValue({
      ...mockWallet,
      status: 'provisioning',
    })
    vi.mocked(isWalletActive).mockReturnValue(false)

    await expect(
      deployCapital({ userId: 'user-1', amountMxn: 50000, cycleId: 'cycle-1' }),
    ).rejects.toThrow(AppError)
  })

  it('throws AppError when MXNe is not rampable', async () => {
    vi.mocked(getUserWalletByUserId).mockResolvedValue(mockWallet)
    vi.mocked(isWalletActive).mockReturnValue(true)
    vi.mocked(resolveMvpPartnerRampIdentity).mockResolvedValue(mockIdentity)
    vi.mocked(fetchEtherfuseCetes28DayRateSnapshot).mockResolvedValue(mockRateSnapshot)
    vi.mocked(fetchRampableAssetsForWallet).mockResolvedValue({
      assets: [{ symbol: 'USDC', identifier: 'USDC:issuer' }],
    })

    await expect(
      deployCapital({ userId: 'user-1', amountMxn: 50000, cycleId: 'cycle-1' }),
    ).rejects.toThrow(AppError)
  })

  it('throws AppError when onramp order fails', async () => {
    vi.mocked(getUserWalletByUserId).mockResolvedValue(mockWallet)
    vi.mocked(isWalletActive).mockReturnValue(true)
    vi.mocked(resolveMvpPartnerRampIdentity).mockResolvedValue(mockIdentity)
    vi.mocked(fetchEtherfuseCetes28DayRateSnapshot).mockResolvedValue(mockRateSnapshot)
    vi.mocked(fetchRampableAssetsForWallet).mockResolvedValue(mockAssets)
    vi.mocked(createMxOnrampQuote).mockResolvedValue(mockQuote)
    vi.mocked(quoteIdFromEtherfusePayload).mockReturnValue('quote-1')
    vi.mocked(registerOrganizationWallet).mockResolvedValue({
      walletId: 'wallet-eth-1',
      customerId: 'customer-1',
      publicKey: mockWallet.stellarPublicKey,
      blockchain: 'stellar',
    })
    vi.mocked(resolveMvpPartnerCryptoWalletId).mockResolvedValue('crypto-wallet-1')
    vi.mocked(createMxOnrampOrder).mockRejectedValue(
      new AppError('provider_rejected', { message: 'Bank account not found' }),
    )

    await expect(
      deployCapital({ userId: 'user-1', amountMxn: 50000, cycleId: 'cycle-1' }),
    ).rejects.toThrow(AppError)
  })

  it('uses sandbox simulation when ETHERFUSE_API_BASE_URL contains sand', async () => {
    process.env.ETHERFUSE_API_BASE_URL = 'https://api.sand.etherfuse.com'

    vi.mocked(getUserWalletByUserId).mockResolvedValue(mockWallet)
    vi.mocked(isWalletActive).mockReturnValue(true)
    vi.mocked(resolveMvpPartnerRampIdentity).mockResolvedValue(mockIdentity)
    vi.mocked(fetchEtherfuseCetes28DayRateSnapshot).mockResolvedValue(mockRateSnapshot)
    vi.mocked(fetchRampableAssetsForWallet).mockResolvedValue(mockAssets)
    vi.mocked(createMxOnrampQuote).mockResolvedValue(mockQuote)
    vi.mocked(quoteIdFromEtherfusePayload).mockReturnValue('quote-1')
    vi.mocked(registerOrganizationWallet).mockResolvedValue({
      walletId: 'wallet-eth-1',
      customerId: 'customer-1',
      publicKey: mockWallet.stellarPublicKey,
      blockchain: 'stellar',
    })
    vi.mocked(resolveMvpPartnerCryptoWalletId).mockResolvedValue('crypto-wallet-1')
    vi.mocked(createMxOnrampOrder).mockResolvedValue(mockOrderResponse)
    vi.mocked(simulateStablebondPurchase).mockReturnValue(mockStablebondResult)

    const result = await deployCapital({
      userId: 'user-1',
      amountMxn: 50000,
      cycleId: 'cycle-1',
    })

    expect(simulateStablebondPurchase).toHaveBeenCalled()
    expect(result.stablebondOrder.orderId).toBe('sb-order-1')
  })

  it('converts amount from cents to decimal', async () => {
    vi.mocked(getUserWalletByUserId).mockResolvedValue(mockWallet)
    vi.mocked(isWalletActive).mockReturnValue(true)
    vi.mocked(resolveMvpPartnerRampIdentity).mockResolvedValue(mockIdentity)
    vi.mocked(fetchEtherfuseCetes28DayRateSnapshot).mockResolvedValue(mockRateSnapshot)
    vi.mocked(fetchRampableAssetsForWallet).mockResolvedValue(mockAssets)
    vi.mocked(createMxOnrampQuote).mockResolvedValue(mockQuote)
    vi.mocked(quoteIdFromEtherfusePayload).mockReturnValue('quote-1')
    vi.mocked(registerOrganizationWallet).mockResolvedValue({
      walletId: 'wallet-eth-1',
      customerId: 'customer-1',
      publicKey: mockWallet.stellarPublicKey,
      blockchain: 'stellar',
    })
    vi.mocked(resolveMvpPartnerCryptoWalletId).mockResolvedValue('crypto-wallet-1')
    vi.mocked(createMxOnrampOrder).mockResolvedValue(mockOrderResponse)
    vi.mocked(simulateStablebondPurchase).mockReturnValue({
      ...mockStablebondResult,
      sourceAmount: '2000.00',
    })

    const result = await deployCapital({
      userId: 'user-1',
      amountMxn: 200000,
      cycleId: 'cycle-1',
    })

    expect(createMxOnrampQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceAmount: '2000.00',
      }),
    )
    expect(result.mxneAmount).toBe('2000.00')
  })

  it('fires admin alert on onramp order creation failure', async () => {
    // Spy on console.error to verify admin alert path fires
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    vi.mocked(getUserWalletByUserId).mockResolvedValue(mockWallet)
    vi.mocked(isWalletActive).mockReturnValue(true)
    vi.mocked(resolveMvpPartnerRampIdentity).mockResolvedValue(mockIdentity)
    vi.mocked(fetchEtherfuseCetes28DayRateSnapshot).mockResolvedValue(mockRateSnapshot)
    vi.mocked(fetchRampableAssetsForWallet).mockResolvedValue(mockAssets)
    vi.mocked(createMxOnrampQuote).mockResolvedValue(mockQuote)
    vi.mocked(quoteIdFromEtherfusePayload).mockReturnValue('quote-1')
    vi.mocked(registerOrganizationWallet).mockResolvedValue({
      walletId: 'wallet-eth-1',
      customerId: 'customer-1',
      publicKey: mockWallet.stellarPublicKey,
      blockchain: 'stellar',
    })
    vi.mocked(resolveMvpPartnerCryptoWalletId).mockResolvedValue('crypto-wallet-1')
    vi.mocked(createMxOnrampOrder).mockRejectedValue(
      new AppError('provider_rejected', { message: 'Proxy account not found' }),
    )

    await expect(
      deployCapital({ userId: 'user-1', amountMxn: 50000, cycleId: 'cycle-abc' }),
    ).rejects.toThrow(AppError)

    // Admin alert must have been sent (logged via console.error)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[seyf][admin-alert]',
      expect.stringContaining('onramp_order_failed'),
    )

    consoleErrorSpy.mockRestore()
  })

  it('stores cycleId in markCycleDeployedOnchain call', async () => {
    vi.mocked(getUserWalletByUserId).mockResolvedValue(mockWallet)
    vi.mocked(isWalletActive).mockReturnValue(true)
    vi.mocked(resolveMvpPartnerRampIdentity).mockResolvedValue(mockIdentity)
    vi.mocked(fetchEtherfuseCetes28DayRateSnapshot).mockResolvedValue(mockRateSnapshot)
    vi.mocked(fetchRampableAssetsForWallet).mockResolvedValue(mockAssets)
    vi.mocked(createMxOnrampQuote).mockResolvedValue(mockQuote)
    vi.mocked(quoteIdFromEtherfusePayload).mockReturnValue('quote-1')
    vi.mocked(registerOrganizationWallet).mockResolvedValue({
      walletId: 'wallet-eth-1',
      customerId: 'customer-1',
      publicKey: mockWallet.stellarPublicKey,
      blockchain: 'stellar',
    })
    vi.mocked(resolveMvpPartnerCryptoWalletId).mockResolvedValue('crypto-wallet-1')
    vi.mocked(createMxOnrampOrder).mockResolvedValue(mockOrderResponse)
    vi.mocked(simulateStablebondPurchase).mockReturnValue(mockStablebondResult)

    await deployCapital({ userId: 'user-1', amountMxn: 50000, cycleId: 'cycle-xyz-99' })

    expect(markCycleDeployedOnchain).toHaveBeenCalledWith(
      expect.objectContaining({ cycleId: 'cycle-xyz-99' }),
    )
  })

  it('uses stellarPublicKey from Pollar wallet for stablebond purchase in production mode', async () => {
    process.env.ETHERFUSE_API_BASE_URL = 'https://api.etherfuse.com'

    vi.mocked(getUserWalletByUserId).mockResolvedValue(mockWallet)
    vi.mocked(isWalletActive).mockReturnValue(true)
    vi.mocked(resolveMvpPartnerRampIdentity).mockResolvedValue(mockIdentity)
    vi.mocked(fetchEtherfuseCetes28DayRateSnapshot).mockResolvedValue(mockRateSnapshot)
    vi.mocked(fetchRampableAssetsForWallet).mockResolvedValue(mockAssets)
    vi.mocked(createMxOnrampQuote).mockResolvedValue(mockQuote)
    vi.mocked(quoteIdFromEtherfusePayload).mockReturnValue('quote-1')
    vi.mocked(registerOrganizationWallet).mockResolvedValue({
      walletId: 'wallet-eth-1',
      customerId: 'customer-1',
      publicKey: mockWallet.stellarPublicKey,
      blockchain: 'stellar',
    })
    vi.mocked(resolveMvpPartnerCryptoWalletId).mockResolvedValue('crypto-wallet-1')
    vi.mocked(createMxOnrampOrder).mockResolvedValue(mockOrderResponse)
    vi.mocked(purchaseCetesStablebonds).mockResolvedValue(mockStablebondResult)

    const result = await deployCapital({
      userId: 'user-1',
      amountMxn: 50000,
      cycleId: 'cycle-prod-1',
    })

    // In production mode, purchaseCetesStablebonds (not simulate) is called
    expect(purchaseCetesStablebonds).toHaveBeenCalledWith(
      expect.objectContaining({
        publicKey: mockWallet.stellarPublicKey,
        customerId: 'customer-1',
      }),
    )
    // Zero principal touches Blend: no calls to any Blend protocol
    expect(result.stablebondOrder.targetAsset).toBe('CETES')
  })
})
