import type { InvestmentRun } from "@/lib/seyf/investment-mvp";
import {
  listRunsForUser,
  MOCK_ANNUAL_RATE_PERCENT,
  getLedgerMeta,
} from "@/lib/seyf/investment-mvp";
import {
  fetchDashboardCetesSaldo,
  type DashboardCetesSaldo,
} from "@/lib/seyf/dashboard-cetes-saldo";
import { resolveEtherfuseRampContext } from "@/lib/seyf/etherfuse-ramp-context";
import { fetchUserMovements } from "@/lib/seyf/user-movements";
import {
  DASHBOARD_MOVEMENTS_PREVIEW_LIMIT,
  type DashboardViewModel,
} from "@/lib/seyf/dashboard-view-model-types";

export type { DashboardViewModel } from "@/lib/seyf/dashboard-view-model-types";
export { DASHBOARD_MOVEMENTS_PREVIEW_LIMIT } from "@/lib/seyf/dashboard-view-model-types";

function envVar(name: string): string | undefined {
  const p = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } })
    .process;
  return p?.env?.[name];
}

function investAllowed(): boolean {
  const nodeEnv = envVar("NODE_ENV");
  if (nodeEnv !== "production") return true;
  return envVar("SEYF_ALLOW_MOCK_INVEST") === "true";
}

function ledgerPrincipalMxn(runs: InvestmentRun[]): number {
  return runs
    .filter((r) => r.status === "completed")
    .reduce((s, r) => s + r.amountMxn, 0);
}

function oldestCompletedRun(runs: InvestmentRun[]): InvestmentRun | null {
  const done = runs.filter((r) => r.status === "completed");
  if (done.length === 0) return null;
  return done.reduce(
    (a, r) => (new Date(r.createdAt) < new Date(a.createdAt) ? r : a),
    done[0],
  );
}

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.min(365, Math.max(1, Math.floor(ms / 86_400_000)));
}

function cetesFootnote(s: DashboardCetesSaldo): string | null {
  if (s.kind === "ok") {
    return "Equivalente en pesos según el tipo del día (referencia, puede variar).";
  }
  if (s.kind === "no_context") {
    return "Completa Identidad para ver tu saldo en pesos al día.";
  }
  if (s.kind === "disabled") {
    return "Consulta de saldo no disponible en este momento.";
  }
  if (s.kind === "error") return s.message;
  return null;
}

/** Con polling cada pocos segundos, no paginar decenas de miles de órdenes: basta para las últimas N del preview. */
const DASHBOARD_ETHERFUSE_ORDER_PAGES = 2;

/**
 * Ensambla números en vivo: saldo CETES×MXN (Etherfuse) y, en dev o con SEYF_ALLOW_MOCK_INVEST, ledger MVP.
 */
export async function buildDashboardViewModel(options?: {
  /** Misma clave Stellar que Pollar; ayuda a resolver órdenes Etherfuse sin cookie en este dispositivo. */
  walletPublicKeyHint?: string | null;
}): Promise<DashboardViewModel> {
  const ctx = await resolveEtherfuseRampContext({
    walletPublicKeyHint: options?.walletPublicKeyHint ?? null,
  });
  const ledgerUserKey = ctx?.publicKey ?? options?.walletPublicKeyHint ?? null;
  const [cetesSaldo, investRuns, movementsAll] = await Promise.all([
    fetchDashboardCetesSaldo(ctx),
    investAllowed()
      ? ledgerUserKey
        ? listRunsForUser(ledgerUserKey, 20)
        : Promise.resolve([] as InvestmentRun[])
      : Promise.resolve([] as InvestmentRun[]),
    fetchUserMovements(ctx, {
      etherfuseMaxPages: DASHBOARD_ETHERFUSE_ORDER_PAGES,
      ledgerRunsLimit: 20,
      walletPublicKey: ledgerUserKey,
    }),
  ]);

  const ledgerPrincipal = ledgerPrincipalMxn(investRuns);
  const cyclePrincipal = activeCycle?.principalMxn ?? 0;
  let principalMxn: number;
  if (cetesSaldo.kind === "ok") principalMxn = cetesSaldo.principalMxn;
  else if (cyclePrincipal > 0) principalMxn = cyclePrincipal;
  else principalMxn = ledgerPrincipal;

  const lastRate =
    investRuns[0]?.rateSnapshotAnnualPercent ?? MOCK_ANNUAL_RATE_PERCENT;
  const tasaAnual = activeCycle?.referenceRateAnnualPercent ?? lastRate;

  const oldest = oldestCompletedRun(investRuns);
  const dias = oldest ? daysSince(oldest.createdAt) : 1;
  const rendimientoMxn =
    principalMxn > 0 ? principalMxn * (tasaAnual / 100) * (dias / 365) : 0;

  const adelantableMxn =
    rendimientoMxn > 0
      ? Math.min(rendimientoMxn * 0.78, principalMxn * 0.12)
      : 0;

  const puntos = Math.round(
    principalMxn * 10 + rendimientoMxn * 2 + investRuns.length * 25,
  );

  let saldoNote = cetesFootnote(cetesSaldo);
  if (cetesSaldo.kind === "no_context" && ledgerPrincipal > 0) {
    saldoNote =
      "Saldo según tus depósitos de prueba. Identidad te da el valor en vivo en pesos.";
  }
  if (cetesSaldo.kind === "error") {
    saldoNote =
      `${saldoNote ?? ""} El carrusel usa tu saldo CETES en la wallet (Pollar); la nota en MXN vía Etherfuse falló.`.trim();
  }

  const movementsRecent = movementsAll.slice(
    0,
    DASHBOARD_MOVEMENTS_PREVIEW_LIMIT,
  );

  // advanceUsed: Etherfuse loan-status endpoint not yet available.
  // Returns false until the ledger exposes an active-advance flag.
  const advanceUsed = false;

  return {
    principalMxn,
    rendimientoMxn,
    adelantableMxn,
    puntos,
    tasaAnual,
    saldoGastoMxn: 0,
    saldoNote,
    movementsRecent,
    advanceUsed,
  };
}

/**
 * Builds the new dashboard API response according to M07-T01 requirements.
 * Returns { no_active_cycle: true } if no active cycle exists.
 */
export async function buildDashboardApiResponse(options?: {
  walletPublicKeyHint?: string | null;
}): Promise<
  | {
      capital_working_mxn: number;
      yield_accrued_mxn: number;
      yield_projected_mxn: number;
      max_advance_mxn: number;
      cycle_end_date: string;
      advance_used: boolean;
      available_balance_mxn: number;
      yield_series?: Array<{ date: string; accrued_mxn: number }>;
    }
  | { no_active_cycle: true }
> {
  const ctx = await resolveEtherfuseRampContext({
    walletPublicKeyHint: options?.walletPublicKeyHint ?? null,
  });
  const ledgerKey = ctx?.publicKey ?? options?.walletPublicKeyHint ?? null;

  const ledgerMeta = await getLedgerMeta();

  if (!ledgerMeta.activeCycleId) {
    return { no_active_cycle: true };
  }

  if (!ledgerKey) {
    return { no_active_cycle: true };
  }

  const investRuns = investAllowed()
    ? await listRunsForUser(ledgerKey, 20)
    : [];
  if (investRuns.length === 0) {
    return { no_active_cycle: true };
  }

  const principalMxn = ledgerPrincipalMxn(investRuns);

  if (principalMxn <= 0) {
    return { no_active_cycle: true };
  }

  // Get the latest rate (use stored reference_rate from cycle record)
  const lastRate =
    investRuns[0]?.rateSnapshotAnnualPercent ?? MOCK_ANNUAL_RATE_PERCENT;

  // Calculate days elapsed in current cycle (simplified: assume cycle started with oldest run)
  const oldest = oldestCompletedRun(investRuns);
  if (!oldest) {
    return { no_active_cycle: true };
  }

  const daysElapsed = daysSince(oldest.createdAt);
  const DEFAULT_CYCLE_DAYS = 28;
  const daysTotal = DEFAULT_CYCLE_DAYS;

  // Cap daysElapsed at daysTotal to avoid showing accrued yield beyond cycle end
  const effectiveDaysElapsed = Math.min(daysElapsed, daysTotal);

  // Calculate daily rate from annual rate
  const dailyRate = lastRate / 100 / 365;

  // Calculate yield accrued: principal × daily_rate × days_elapsed
  const yieldAccruedMxn = principalMxn * dailyRate * effectiveDaysElapsed;

  // Calculate projected yield for full cycle: principal × daily_rate × days_total
  const yieldProjectedMxn = principalMxn * dailyRate * daysTotal;

  // Calculate max advance: (projected_yield × 0.90) − fee_mxn
  // Using fee_mxn = 50 (consistent with contract examples), configurable via env var
  const FEE_MXN = process.env.SEYF_ADVANCE_FEE_MXN
    ? parseInt(process.env.SEYF_ADVANCE_FEE_MXN, 10)
    : 50;
  const maxAdvanceMxn = Math.max(0, yieldProjectedMxn * 0.9 - FEE_MXN);

  // Calculate cycle end date (today + remaining days)
  const cycleEndDate = new Date();
  cycleEndDate.setDate(
    cycleEndDate.getDate() + (daysTotal - effectiveDaysElapsed),
  );

  // For MVP, assume no advance has been used yet
  const advanceUsed = false;

  // Available balance is 0 for now (to be calculated based on actual available funds)
  const availableBalanceMxn = 0;

  // Generate yield_series: one data point per day from cycle start to today
  // Formula: accrued(day_i) = principal × daily_rate × i
  const cycleStartDate = new Date(oldest.createdAt);
  const yieldSeries: Array<{ date: string; accrued_mxn: number }> = [];

  for (let i = 0; i <= effectiveDaysElapsed; i++) {
    const dayDate = new Date(cycleStartDate);
    dayDate.setDate(dayDate.getDate() + i);
    const accrued = Math.round(principalMxn * dailyRate * i * 100) / 100;
    yieldSeries.push({
      date: dayDate.toISOString().split("T")[0], // YYYY-MM-DD format
      accrued_mxn: accrued,
    });
  }

  return {
    capital_working_mxn: Math.round(principalMxn * 100) / 100,
    yield_accrued_mxn: Math.round(yieldAccruedMxn * 100) / 100,
    yield_projected_mxn: Math.round(yieldProjectedMxn * 100) / 100,
    max_advance_mxn: Math.round(maxAdvanceMxn * 100) / 100,
    cycle_end_date: cycleEndDate.toISOString().split("T")[0], // YYYY-MM-DD format
    advance_used: advanceUsed,
    available_balance_mxn: availableBalanceMxn,
    yield_series: yieldSeries,
  };
}
