import { deployCapital } from './capital-deploy'
import { markCycleDeployedOnchain, markCycleFailed } from './cycle-store'
import { notifyUser } from './notifications/notify.ts'
import { fetchEtherfuseCetes28DayRateSnapshot } from '../etherfuse/cetes-rate.ts'
import { upsertActiveCycleOnDepositConfirmed } from './cycle-store.ts'

type DepositStatus = 'confirmed' | 'deployed' | 'deploy_failed'

export type EnqueueAutoDeployForDepositInput = {
  depositId: string
  /** May be unknown depending on webhook payload. */
  amountMxn: number | null
  /** Optional userId if known by caller; MVP defaults to demo-user. */
  userId?: string | null
}

type AutoDeployJob = {
  key: string
  input: EnqueueAutoDeployForDepositInput
  createdAt: number
}

type AutoDeployStore = {
  queuedKeys: Set<string>
  depositStatus: Map<string, DepositStatus>
  onchainTxByDepositId: Map<string, string>
  jobs: AutoDeployJob[]
  running: boolean
}

function store(): AutoDeployStore {
  const g = globalThis as unknown as {
    __seyfAutoDeployStore?: AutoDeployStore
  }

  g.__seyfAutoDeployStore ??= {
    queuedKeys: new Set(),
    depositStatus: new Map(),
    onchainTxByDepositId: new Map(),
    jobs: [],
    running: false,
  }

  return g.__seyfAutoDeployStore
}

function jobKey(input: EnqueueAutoDeployForDepositInput): string {
  return `deposit:${input.depositId}`
}

function mxnToCents(amountMxn: number): number {
  return Math.round(amountMxn * 100)
}

async function runWorkerLoop() {
  const s = store()
  if (s.running) return
  s.running = true

  try {
    while (s.jobs.length > 0) {
      const job = s.jobs.shift()!
      await performAutoDeploy(job.input)
    }
  } finally {
    s.running = false
  }
}

async function performAutoDeploy(input: EnqueueAutoDeployForDepositInput) {
  const s = store()

  if (s.onchainTxByDepositId.has(input.depositId)) {
    s.depositStatus.set(input.depositId, 'deployed')
    return
  }

  try {
    const userId = input.userId?.trim() ? input.userId.trim() : 'demo-user'
    const amountMxn = input.amountMxn ?? 0

    const rateSnap = await fetchEtherfuseCetes28DayRateSnapshot()

    upsertActiveCycleOnDepositConfirmed({
      userId,
      amountMxn,
      referenceRateAnnualPercent: rateSnap.annualRatePercent,
    })

    const deployResult = await deployCapital({
      userId,
      amountMxn: mxnToCents(amountMxn),
      cycleId: `cycle-auto-${input.depositId}`,
    })

    s.depositStatus.set(input.depositId, 'deployed')
    const onchainTx = deployResult.stablebondOrder.confirmedTxSignature ?? deployResult.onrampTxHash ?? 'confirmed'
    s.onchainTxByDepositId.set(input.depositId, onchainTx)
    markCycleDeployedOnchain({
      userId,
      onchainTx,
      etherfuseOrderId: deployResult.onrampOrderId,
      mxneAmount: deployResult.mxneAmount,
      stablebondOrderId: deployResult.stablebondOrder.orderId,
    })

    void notifyUser(userId, 'deposit_deployed', {
      depositId: input.depositId,
      amountMxn,
      instrumentLabel: 'Stablebonds',
    }).catch((error) => {
      console.error('[seyf][notifications] deposit_deployed', error)
    })

    console.info('[seyf][auto-deploy] deposit deployed', {
      depositId: input.depositId,
      amountMxn,
      onrampOrderId: deployResult.onrampOrderId,
      stablebondOrderId: deployResult.stablebondOrder.orderId,
    })
  } catch (error) {
    s.depositStatus.set(input.depositId, 'deploy_failed')
    markCycleFailed({ userId: input.userId?.trim() || 'demo-user' })

    console.error('[seyf][admin-alert] auto-deploy failed', {
      depositId: input.depositId,
      error: error instanceof Error ? error.message : String(error),
    })

    throw error
  }
}

export async function enqueueAutoDeployForDeposit(input: EnqueueAutoDeployForDepositInput) {
  const s = store()
  const key = jobKey(input)

  if (s.queuedKeys.has(key)) return
  if (s.onchainTxByDepositId.has(input.depositId)) return

  s.queuedKeys.add(key)
  s.depositStatus.set(input.depositId, 'confirmed')
  s.jobs.push({ key, input, createdAt: Date.now() })

  void runWorkerLoop().catch((error) => {
    console.error('[seyf][auto-deploy] worker loop crashed', error)
  })
}

export function getAutoDeployDepositStatus(depositId: string): DepositStatus | null {
  const s = store()
  return s.depositStatus.get(depositId) ?? null
}
