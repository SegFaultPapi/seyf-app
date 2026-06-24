export type CycleStatus = 'pending' | 'active' | 'completed' | 'failed'

export type CycleRecord = {
  userId: string
  /** Unique job/cycle identifier from the deploy_capital job (e.g. "cycle-auto-<depositId>"). */
  cycleId: string | null
  cycleDays: 28
  status: CycleStatus
  principalMxn: number
  etherfuseOrderId: string | null
  mxneAmount: string | null
  stablebondOrderId: string | null
  startDate: string
  expectedEndDate: string
  referenceRateAnnualPercent: number
  projectedYieldMxn: number
  confirmedOnchainTx: string | null
  updatedAt: string
}

type CycleStore = {
  activeByUserId: Map<string, CycleRecord>
}

function store(): CycleStore {
  const g = globalThis as unknown as {
    __seyfCycleStore?: CycleStore
  }

  if (!g.__seyfCycleStore) {
    g.__seyfCycleStore = {
      activeByUserId: new Map(),
    }
  }

  return g.__seyfCycleStore
}

function addDaysISO(startIso: string, days: number): string {
  const d = new Date(startIso)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString()
}

export function getActiveCycle(userId: string): CycleRecord | null {
  return store().activeByUserId.get(userId) ?? null
}

export function upsertActiveCycleOnDepositConfirmed(params: {
  userId: string
  amountMxn: number
  referenceRateAnnualPercent: number
  now?: Date
}): CycleRecord {
  const s = store()
  const now = params.now ?? new Date()
  const nowIso = now.toISOString()

  const existing = s.activeByUserId.get(params.userId)
  const startDate = existing?.startDate ?? nowIso
  const expectedEndDate = addDaysISO(startDate, 28)

  const principalMxn = (existing?.principalMxn ?? 0) + params.amountMxn

  const projectedYieldMxn = principalMxn * (params.referenceRateAnnualPercent / 100) * (28 / 365)

  const next: CycleRecord = {
    userId: params.userId,
    cycleId: existing?.cycleId ?? null,
    cycleDays: 28,
    status: existing?.status ?? 'pending',
    principalMxn,
    etherfuseOrderId: existing?.etherfuseOrderId ?? null,
    mxneAmount: existing?.mxneAmount ?? null,
    stablebondOrderId: existing?.stablebondOrderId ?? null,
    startDate,
    expectedEndDate,
    referenceRateAnnualPercent: params.referenceRateAnnualPercent,
    projectedYieldMxn,
    confirmedOnchainTx: existing?.confirmedOnchainTx ?? null,
    updatedAt: nowIso,
  }

  s.activeByUserId.set(params.userId, next)
  return next
}

export function markCycleDeployedOnchain(params: {
  userId: string
  onchainTx: string
  cycleId?: string
  etherfuseOrderId?: string
  mxneAmount?: string
  stablebondOrderId?: string
  now?: Date
}) {
  const s = store()
  const existing = s.activeByUserId.get(params.userId)
  if (!existing) return

  s.activeByUserId.set(params.userId, {
    ...existing,
    status: 'active',
    cycleId: params.cycleId ?? existing.cycleId,
    confirmedOnchainTx: params.onchainTx,
    etherfuseOrderId: params.etherfuseOrderId ?? existing.etherfuseOrderId,
    mxneAmount: params.mxneAmount ?? existing.mxneAmount,
    stablebondOrderId: params.stablebondOrderId ?? existing.stablebondOrderId,
    updatedAt: (params.now ?? new Date()).toISOString(),
  })
}

export function markCycleFailed(params: {
  userId: string
  now?: Date
}) {
  const s = store()
  const existing = s.activeByUserId.get(params.userId)
  if (!existing) return

  s.activeByUserId.set(params.userId, {
    ...existing,
    status: 'failed',
    updatedAt: (params.now ?? new Date()).toISOString(),
  })
}
