"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import useSWR from "swr";
import { animate, useMotionValue, useReducedMotion } from "framer-motion";
import {
  ChevronRight,
  Eye,
  EyeOff,
  TrendingUp,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { useSeyfWallet } from "@/lib/seyf/use-seyf-wallet";
import { AppPageBody } from "@/components/app/app-page-body";
import { DashboardHeroCarousel } from "@/components/app/dashboard-hero-carousel";
import { MovementDetailSheet } from "@/components/app/movement-detail-sheet";
import { YieldTrendChart } from "@/components/app/yield-trend-chart";
import { iconForMovimientoTipo } from "@/components/app/movement-tipo-icons";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { balanceForAssetCode } from "@/lib/seyf/accesly-balances";
import { cetesBalanceEquivMxne } from "@/lib/seyf/cetes-mxne-equiv";
import { cetesStablebondDisplayFromRow } from "@/lib/seyf/stablebond-cetes-display";
import type { EtherfuseStablebondInfo } from "@/lib/etherfuse/stablebonds-lookup";
import { DASHBOARD_POLL_EXTRA_DELAYS_MS } from "@/lib/seyf/balance-poll-intervals";
import { POLL_FETCH_INIT } from "@/lib/seyf/poll-fetch";
import {
  DASHBOARD_MOVEMENTS_PREVIEW_LIMIT,
  type DashboardViewModel,
} from "@/lib/seyf/dashboard-view-model-types";
import {
  formatMovementListSubtitle,
  type UserMovement,
} from "@/lib/seyf/user-movements-types";
import { formatMXN, formatLoUltimoMonto, mxnToSpanishWords } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import type { EtherfuseKycSnapshot } from "@/lib/etherfuse/kyc";
import { isPublicStellarTestnet } from "@/lib/seyf/stellar-wallet-network";

function formatMontoOculto() {
  return "••••";
}

function movementEstadoBadgeClass(estado: UserMovement["estado"]): string {
  if (estado === "completado")
    return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/25";
  if (estado === "fallido")
    return "bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/25";
  return "bg-amber-500/10 text-amber-800 dark:text-amber-200 ring-amber-500/25";
}

function formatMovementMeta(mov: UserMovement): string {
  const d = new Date(mov.createdAt);
  const hora = d.toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return hora;
}

function RendimientoCounter({ value }: { value: number }) {
  const shouldReduce = useReducedMotion();
  const motionVal = useMotionValue(value);
  const [display, setDisplay] = useState(() => formatMXN(value));

  useEffect(() => {
    if (shouldReduce) {
      setDisplay(formatMXN(value));
      return;
    }
    const controls = animate(motionVal, value, {
      duration: 0.8,
      ease: "easeOut",
      onUpdate: (v) => setDisplay(formatMXN(v)),
    });
    return controls.stop;
  }, [value, shouldReduce, motionVal]);

  return <>{display}</>;
}

const dashboardFetcher = (url: string): Promise<DashboardViewModel> =>
  fetch(url, POLL_FETCH_INIT).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json() as Promise<DashboardViewModel>;
  });

const kycStatusFetcher = (url: string): Promise<EtherfuseKycSnapshot | null> =>
  fetch(url, POLL_FETCH_INIT).then(async (r) => {
    if (!r.ok) throw new Error(`${r.status}`);
    const body = (await r.json()) as { kyc?: EtherfuseKycSnapshot | null };
    return body.kyc ?? null;
  });

const advanceSimFetcher = (
  url: string,
): Promise<{
  max_advance_mxn?: number;
  error?: string;
  advance_available?: boolean;
}> =>
  fetch(url, POLL_FETCH_INIT).then(async (r) => {
    if (!r.ok) throw new Error(`${r.status}`);
    return (await r.json()) as {
      max_advance_mxn?: number;
      error?: string;
      advance_available?: boolean;
    };
  });

export default function DashboardClient({ vm }: { vm: DashboardViewModel }) {
  const t = useTranslations("dashboard");
  const { wallet, assetBalances, loading, refreshBalance } = useSeyfWallet();
  const [selected, setSelected] = useState<UserMovement | null>(null);
  const [hideBalances, setHideBalances] = useState(false);
  const [lastUpdateAt, setLastUpdateAt] = useState<Date>(new Date());
  const [heroIndex, setHeroIndex] = useState(0);
  const [stablebondCetes, setStablebondCetes] = useState<{
    loading: boolean;
    annualPercent: number | null;
    priceMx: number | null;
    calculatedAt?: string;
  }>({ loading: false, annualPercent: null, priceMx: null });
  const [stellarMovements, setStellarMovements] = useState<UserMovement[]>([]);
  const [welcomeBonusBusy, setWelcomeBonusBusy] = useState(false);
  const [welcomeBonusClaimed, setWelcomeBonusClaimed] = useState(false);
  const [welcomeBonusMessage, setWelcomeBonusMessage] = useState<string | null>(
    null,
  );
  const [referralDismissCount, setReferralDismissCount] = useState(0);
  const [referralHiddenUntil, setReferralHiddenUntil] = useState(0);
  const [completedBanner, setCompletedBanner] = useState<{ id: string; message: string } | null>(null);

  const dashboardSwrKey =
    wallet?.stellarAddress?.trim().length === 56 &&
    wallet.stellarAddress.startsWith("G")
      ? `/api/seyf/dashboard?wallet=${encodeURIComponent(wallet.stellarAddress.trim())}`
      : "/api/seyf/dashboard";

  const {
    data = vm,
    error,
    mutate,
  } = useSWR<DashboardViewModel>(
    wallet?.stellarAddress ? dashboardSwrKey : "/api/seyf/dashboard",
    dashboardFetcher,
    {
      fallbackData: vm,
      refreshInterval: 60_000,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      dedupingInterval: 2_000,
      onSuccess: () => setLastUpdateAt(new Date()),
    },
  );
  const { data: kycStatus } = useSWR<EtherfuseKycSnapshot | null>(
    "/api/seyf/kyc/status",
    kycStatusFetcher,
    {
      refreshInterval: 45_000,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      dedupingInterval: 2_000,
    },
  );
  const { data: advanceSim } = useSWR<{
    max_advance_mxn?: number;
    error?: string;
    advance_available?: boolean;
  }>("/api/seyf/advance/simulate?years=1", advanceSimFetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    dedupingInterval: 2_000,
  });

  // Push updated SSR prop into SWR cache on navigation (vm prop identity change).
  const prevVmRef = useRef(vm);
  useEffect(() => {
    if (vm === prevVmRef.current) return;
    prevVmRef.current = vm;
    void mutate(vm, { revalidate: false });
    setLastUpdateAt(new Date());
  }, [vm, mutate]);

  // Burst revalidations after mount to catch slow Etherfuse propagation.
  useEffect(() => {
    const timers = DASHBOARD_POLL_EXTRA_DELAYS_MS.map((ms) =>
      setTimeout(() => void mutate(), ms),
    );
    return () => timers.forEach(clearTimeout);
  }, [mutate]);

  const activeCycle = data.principalMxn > 0;
  const effectiveAdelantableMxn = Math.max(
    0,
    advanceSim?.max_advance_mxn ?? data.adelantableMxn ?? 0,
  );
  const effectiveAdvanceUsed =
    advanceSim?.error === "advance_already_used" ? true : data.advanceUsed;
  const kycBadge =
    kycStatus?.status === "approved" ||
    kycStatus?.status === "approved_chain_deploying"
      ? {
          label: "Identidad verificada",
          tone: "ok" as const,
          href: "/identidad",
          action: "Ver estado",
        }
      : kycStatus?.status === "proposed"
        ? {
            label: "Pendiente de verificación",
            tone: "wait" as const,
            href: "/identidad",
            action: "Actualizar estado",
          }
        : kycStatus?.status === "rejected"
          ? {
              label: "Verificación fallida",
              tone: "bad" as const,
              href: "/identidad",
              action: "Corregir datos",
            }
          : {
              label: "Verificación pendiente",
              tone: "muted" as const,
              href: "/identidad",
              action: "Verificar ahora",
            };

  const lastBonusWalletKeyRef = useRef<string>("");
  useEffect(() => {
    if (activeCycle) return;
    const addr = wallet?.stellarAddress?.trim() ?? "";
    const walletKey = addr || "(none)";
    if (lastBonusWalletKeyRef.current !== walletKey) {
      lastBonusWalletKeyRef.current = walletKey;
      setWelcomeBonusMessage(null);
    }
    const bonusUrl = addr
      ? `/api/seyf/etherfuse/bonus/welcome?wallet=${encodeURIComponent(addr)}`
      : "/api/seyf/etherfuse/bonus/welcome";
    void fetch(bonusUrl, { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as {
          claimed?: boolean;
          claim?: { amountMxn?: number };
        };
        if (!r.ok) {
          setWelcomeBonusClaimed(false);
          return;
        }
        const claimed = Boolean(j.claimed);
        setWelcomeBonusClaimed(claimed);
        if (claimed) {
          setWelcomeBonusMessage(
            typeof j.claim?.amountMxn === "number"
              ? `Bono activado por ${formatMXN(j.claim.amountMxn)} en testnet.`
              : "Bono de bienvenida ya activado en testnet.",
          );
        }
      })
      .catch(() => {
        setWelcomeBonusClaimed(false);
      });
  }, [activeCycle, wallet?.stellarAddress]);

  useEffect(() => {
    try {
      const count = Number.parseInt(
        window.localStorage.getItem("seyf_referral_dismiss_count") ?? "0",
        10,
      );
      const until = Number.parseInt(
        window.localStorage.getItem("seyf_referral_hidden_until") ?? "0",
        10,
      );
      if (Number.isFinite(count)) setReferralDismissCount(Math.max(0, count));
      if (Number.isFinite(until)) setReferralHiddenUntil(Math.max(0, until));
    } catch {
      // noop
    }
  }, []);

  const claimWelcomeBonus = async () => {
    setWelcomeBonusBusy(true);
    setWelcomeBonusMessage(null);
    try {
      const addr = wallet?.stellarAddress?.trim() ?? "";
      if (!addr) {
        setWelcomeBonusMessage(
          "Conecta tu cuenta y espera a que cargue la dirección antes de activar el bono.",
        );
        return;
      }
      const r = await fetch("/api/seyf/etherfuse/bonus/welcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: addr }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        alreadyClaimed?: boolean;
        amountMxn?: number;
        error?: { message_es?: string; code?: string };
        debug_message?: string;
      };
      if (!r.ok || !j.ok) {
        setWelcomeBonusMessage(
          j.error?.message_es ??
            (typeof j.debug_message === "string" ? j.debug_message : null) ??
            `No se pudo activar el bono (HTTP ${r.status}).`,
        );
        try {
          const sync = await fetch(
            `/api/seyf/etherfuse/bonus/welcome?wallet=${encodeURIComponent(addr)}`,
            { cache: "no-store" },
          );
          const sj = (await sync.json().catch(() => ({}))) as {
            claimed?: boolean;
          };
          if (sync.ok) setWelcomeBonusClaimed(Boolean(sj.claimed));
        } catch {
          setWelcomeBonusClaimed(false);
        }
        return;
      }
      setWelcomeBonusClaimed(true);
      const amount = typeof j.amountMxn === "number" ? j.amountMxn : 300;
      setWelcomeBonusMessage(
        j.alreadyClaimed
          ? "Bono de bienvenida ya estaba activado para esta cuenta."
          : `Bono de bienvenida activado: ${formatMXN(amount)} acreditados (sandbox).`,
      );
      await mutate();
      await refreshBalance();
    } catch {
      setWelcomeBonusMessage("No se pudo activar el bono en este momento.");
    } finally {
      setWelcomeBonusBusy(false);
    }
  };

  const dismissReferralCard = () => {
    const nextCount = referralDismissCount + 1;
    // Se vuelve a mostrar solo: tiempo de ocultación incremental.
    const hideMinutes = Math.min(10 + nextCount * 5, 60);
    const until = Date.now() + hideMinutes * 60_000;
    setReferralDismissCount(nextCount);
    setReferralHiddenUntil(until);
    try {
      window.localStorage.setItem(
        "seyf_referral_dismiss_count",
        String(nextCount),
      );
      window.localStorage.setItem("seyf_referral_hidden_until", String(until));
    } catch {
      // noop
    }
  };

  const referralVisible =
    welcomeBonusClaimed && Date.now() >= referralHiddenUntil;
  const whatsappInviteHref = useMemo(() => {
    const base =
      typeof window !== "undefined"
        ? window.location.origin
        : "https://seyf.mx";
    const text =
      `Estoy probando Seyf y ya recibí mi bono de bienvenida. ` +
      `Únete con mi invitación y recibe 200 CETES al instante: ${base}`;
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("seyf-hide-balances");
      setHideBalances(raw === "1");
    } catch {}
  }, []);

  useEffect(() => {
    if (wallet?.stellarAddress) void refreshBalance();
  }, [wallet?.stellarAddress, refreshBalance]);

  useEffect(() => {
    if (!wallet) {
      setStablebondCetes({
        loading: false,
        annualPercent: null,
        priceMx: null,
      });
      return;
    }
    let cancelled = false;
    setStablebondCetes((s) => ({ ...s, loading: true }));
    void fetch("/api/seyf/etherfuse/lookup/stablebonds?cetesOnly=1")
      .then(async (r) => {
        const payload = (await r.json().catch(() => ({}))) as {
          cetes?: EtherfuseStablebondInfo | null;
          calculatedAt?: string;
          error?: string;
        };
        if (cancelled) return;
        if (!r.ok) {
          setStablebondCetes({
            loading: false,
            annualPercent: null,
            priceMx: null,
          });
          return;
        }
        const parsed = cetesStablebondDisplayFromRow(payload.cetes ?? null);
        setStablebondCetes({
          loading: false,
          annualPercent: parsed.annualPercent,
          priceMx: parsed.priceMx,
          calculatedAt: payload.calculatedAt,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setStablebondCetes({
          loading: false,
          annualPercent: null,
          priceMx: null,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [wallet?.stellarAddress]);

  useEffect(() => {
    const addr = wallet?.stellarAddress?.trim();
    if (!addr) {
      setStellarMovements([]);
      return;
    }
    let cancelled = false;
    void fetch(
      `/api/seyf/stellar-movements?account=${encodeURIComponent(addr)}`,
    )
      .then(async (r) => {
        if (!r.ok) return [] as UserMovement[];
        const rows = (await r.json()) as unknown;
        if (!Array.isArray(rows)) return [];
        return rows as UserMovement[];
      })
      .then((rows) => {
        if (!cancelled) setStellarMovements(rows);
      })
      .catch(() => {
        if (!cancelled) setStellarMovements([]);
      });
    return () => {
      cancelled = true;
    };
  }, [wallet?.stellarAddress]);

  const baseMovements = Array.isArray(data.movementsRecent)
    ? data.movementsRecent
    : [];

  const loUltimoMovements = useMemo(() => {
    const byId = new Map<string, UserMovement>();
    for (const m of baseMovements) byId.set(m.id, m);
    for (const m of stellarMovements) byId.set(m.id, m);
    const merged = [...byId.values()].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return merged.slice(0, DASHBOARD_MOVEMENTS_PREVIEW_LIMIT);
  }, [baseMovements, stellarMovements]);

  useEffect(() => {
    if (!baseMovements || baseMovements.length === 0) return;
    try {
      const storedPending = JSON.parse(
        window.localStorage.getItem("seyf_pending_movements") || "[]"
      ) as string[];

      const currentPending: string[] = [];
      const newlyCompleted: UserMovement[] = [];

      for (const mov of baseMovements) {
        if (mov.estado === "pendiente") {
          currentPending.push(mov.id);
        } else if (mov.estado === "completado" && storedPending.includes(mov.id)) {
          newlyCompleted.push(mov);
        }
      }

      if (newlyCompleted.length > 0) {
        const mov = newlyCompleted[0];
        if (mov.tipo === "deposito") {
          setCompletedBanner({
            id: mov.id,
            message: "¡Tu depósito llegó! Tu capital ya genera rendimiento.",
          });
        } else if (mov.tipo === "retiro") {
          setCompletedBanner({
            id: mov.id,
            message: "¡Tu retiro se completó con éxito!",
          });
        }
      }

      window.localStorage.setItem(
        "seyf_pending_movements",
        JSON.stringify(currentPending)
      );
    } catch {
      // noop
    }
  }, [baseMovements]);

  useEffect(() => {
    if (!selected) return;
    const next = baseMovements.find((m) => m.id === selected.id);
    if (next) setSelected(next);
  }, [baseMovements, selected]);

  const mxne = useMemo(
    () => balanceForAssetCode(assetBalances, "MXNE"),
    [assetBalances],
  );
  const cetesBalance = useMemo(
    () => balanceForAssetCode(assetBalances, "CETES"),
    [assetBalances],
  );
  const cetesEquivMxne = useMemo(
    () => cetesBalanceEquivMxne(cetesBalance, stablebondCetes.priceMx),
    [cetesBalance, stablebondCetes.priceMx],
  );
  const testnetWalletTotalMxn = useMemo(() => {
    const cetes = cetesEquivMxne ?? 0;
    return mxne + cetes;
  }, [mxne, cetesEquivMxne]);
  const principalForHero = isPublicStellarTestnet()
    ? testnetWalletTotalMxn
    : mxne;

  if (loading && !wallet) {
    return (
      <AppPageBody className="space-y-6 pt-4">
        <Skeleton className="h-20 rounded-2xl border border-border" />
        <Skeleton className="h-[22rem] rounded-[1.75rem] border border-border" />
        <Skeleton className="h-48 rounded-[1.5rem] border border-border" />
        <Skeleton className="h-40 rounded-[1.5rem] border border-border" />
      </AppPageBody>
    );
  }

  return (
    <AppPageBody className="space-y-6 pt-4">
      <section className="flex items-center justify-between rounded-2xl border border-border bg-card px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-foreground">
            Cuenta principal
          </p>
          <p className="text-[11px] text-muted-foreground">
            Última actualización{" "}
            {lastUpdateAt.toLocaleTimeString("es-MX", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
          <p
            className={cn(
              "mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold",
              kycBadge.tone === "ok" &&
                "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
              kycBadge.tone === "wait" &&
                "border-amber-500/30 bg-amber-500/10 text-amber-700",
              kycBadge.tone === "bad" &&
                "border-destructive/30 bg-destructive/10 text-destructive",
              kycBadge.tone === "muted" &&
                "border-border bg-secondary/60 text-muted-foreground",
            )}
          >
            {kycBadge.label}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-9 rounded-full border-border bg-transparent px-3 text-xs font-semibold"
          onClick={() => {
            setHideBalances((prev) => {
              const next = !prev;
              try {
                window.localStorage.setItem(
                  "seyf-hide-balances",
                  next ? "1" : "0",
                );
              } catch {}
              return next;
            });
          }}
        >
          {hideBalances ? (
            <Eye className="mr-1.5 size-4" />
          ) : (
            <EyeOff className="mr-1.5 size-4" />
          )}
          {hideBalances ? "Mostrar saldos" : "Ocultar saldos"}
        </Button>
      </section>

      {error && (
        <section className="flex items-center justify-between rounded-2xl border border-amber-500/30 bg-amber-500/[0.08] px-4 py-3">
          <p className="text-xs font-medium text-amber-200">
            {t('loadError')}
          </p>
          <Button
            type="button"
            variant="outline"
            className="ml-3 h-8 shrink-0 rounded-full border-amber-500/30 bg-transparent px-3 text-xs font-semibold text-amber-300 hover:bg-amber-500/10"
            onClick={() => void mutate()}
          >
            {t('retry')}
          </Button>
        </section>
      )}

      {completedBanner && (
        <section className="relative overflow-hidden rounded-[1.25rem] border border-emerald-500/30 bg-emerald-500/10 p-4">
          <button
            type="button"
            onClick={() => setCompletedBanner(null)}
            className="absolute right-3 top-3 text-emerald-600 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300"
          >
            <X className="size-4" />
          </button>
          <p className="text-sm font-bold text-emerald-800 dark:text-emerald-300">
            ¡Operación completada!
          </p>
          <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
            {completedBanner.message}
          </p>
        </section>
      )}

      <div className="relative">
        <DashboardHeroCarousel
          data={{
            principal: hideBalances ? 0 : principalForHero,
            adelantable: hideBalances ? 0 : effectiveAdelantableMxn,
            puntos: data.puntos,
            tasaAnual: data.tasaAnual,
            advanceUsed: effectiveAdvanceUsed,
            stablebondCetes,
            cetesWallet: {
              balance: hideBalances ? 0 : cetesBalance,
              equivMxne: hideBalances ? null : cetesEquivMxne,
              priceLoading: stablebondCetes.loading,
            },
            isTestnet: isPublicStellarTestnet(),
          }}
          onIndexChange={setHeroIndex}
        />
        {hideBalances ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-[1.75rem] bg-background/35 backdrop-blur-[2px]">
            <span className="rounded-full border border-border bg-card/90 px-3 py-1 text-xs font-bold text-foreground">
              {t('balancesHidden')}
            </span>
          </div>
        ) : null}
      </div>

      {data.saldoNote ? (
        <p className="-mt-2 px-1 text-center text-[11px] leading-snug text-muted-foreground">
          {data.saldoNote}
        </p>
      ) : null}

      {/* Yield trend chart (daily series from dashboard API -> yield_series) */}
      <div className="pt-4 px-1">
        {/* If the backend provides `yield_series`, use it. Otherwise derive a daily series
            client-side from: accrued = principal × (tasaAnual/100/365) × days_elapsed
            We compute days_elapsed = rendimientoMxn / (principal × dailyRate)
            and build points from day 0..days_elapsed. This mirrors server-side logic
            and is safe (no PII, read-only). */}
        {(() => {
          const backendSeries = (data as any).yield_series as
            | { date: string; accrued_mxn: number }[]
            | undefined;

          if (backendSeries && Array.isArray(backendSeries)) {
            return (
              <YieldTrendChart
                data={backendSeries.map((p) => ({
                  date: p.date,
                  accrued_mxn: p.accrued_mxn,
                }))}
                isLoading={false}
                error={null}
                principal={data.principalMxn}
              />
            );
          }

          // Fallback derivation
          const principal = data.principalMxn ?? 0;
          const tasa = data.tasaAnual ?? 0;
          const rendimiento = data.rendimientoMxn ?? 0;
          const dailyRate = tasa / 100 / 365;

          let daysElapsed = 0;
          if (principal > 0 && dailyRate > 0) {
            daysElapsed = Math.floor(rendimiento / (principal * dailyRate));
            if (!Number.isFinite(daysElapsed) || daysElapsed < 0)
              daysElapsed = 0;
          }

          const DEFAULT_CYCLE_DAYS = 28;
          const effectiveDays = Math.min(daysElapsed, DEFAULT_CYCLE_DAYS);

          const series: { date: string; accrued_mxn: number }[] = [];
          const start = new Date();
          // Assume cycle started `effectiveDays` ago
          start.setDate(start.getDate() - effectiveDays);
          for (let i = 0; i <= effectiveDays; i++) {
            const d = new Date(start);
            d.setDate(d.getDate() + i);
            const accrued = Math.round(principal * dailyRate * i * 100) / 100;
            series.push({
              date: d.toISOString().split("T")[0],
              accrued_mxn: accrued,
            });
          }

          return (
            <YieldTrendChart
              data={series}
              isLoading={false}
              error={null}
              principal={principal}
            />
          );
        })()}
      </div>

      {!activeCycle && !welcomeBonusClaimed && (
        <section className="relative overflow-hidden rounded-[1.65rem] border border-[#c6d9d0] bg-gradient-to-br from-[#0d3531] via-[#15534a] to-[#1f6559] p-5">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.18),transparent_55%)]" />
          <div className="relative flex items-stretch gap-3">
            <div className="min-w-0 flex-1">
              <p className="inline-flex rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#d8efe5]">
                {t('bonus.badge')}
              </p>
              <p className="mt-3 text-xl font-black leading-tight tracking-tight text-white">
                Bono bienvenida
                <br />
                300 MXN a CETES
              </p>
              <p className="mt-2 text-xs leading-relaxed text-[#d2e9df]">
                Creamos una orden onramp de prueba y simulamos el depósito para
                fondear tu wallet y probar la app.
              </p>
              <div className="mt-4">
                <Button
                  type="button"
                  onClick={() => void claimWelcomeBonus()}
                  disabled={welcomeBonusBusy || welcomeBonusClaimed}
                  className="h-10 rounded-full bg-white px-4 text-sm font-bold text-[#184e46] hover:bg-white/90 disabled:bg-white/70"
                >
                  {welcomeBonusBusy
                    ? "Activando..."
                    : welcomeBonusClaimed
                      ? "Bono activado"
                      : "Activar bono"}
                </Button>
              </div>
              {welcomeBonusMessage ? (
                <p className="mt-2 text-xs leading-relaxed text-[#d2e9df]">
                  {welcomeBonusMessage}
                </p>
              ) : null}
            </div>
            <div className="relative w-[40%] min-w-[7.5rem] overflow-hidden rounded-2xl border border-white/20 bg-white/10">
              <Image
                src="/seyf-card.png"
                alt="Tarjeta Seyf"
                fill
                sizes="(max-width: 640px) 35vw, 240px"
                className="object-cover"
                priority={false}
              />
            </div>
          </div>
        </section>
      )}

      {referralVisible && (
        <section className="relative overflow-hidden rounded-[1.65rem] border border-[#c6d9d0] bg-gradient-to-br from-[#123b35] via-[#18584f] to-[#23695c] p-5 text-white">
          <button
            type="button"
            onClick={dismissReferralCard}
            className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/25 bg-white/10 hover:bg-white/20 outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#123b35]"
            aria-label="Cerrar invitación"
          >
            <X className="size-4" />
          </button>
          <p className="inline-flex rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#d8efe5]">
            {t('referral.badge')}
          </p>
          <p className="mt-3 text-xl font-black leading-tight tracking-tight">
            Refiere a un amigo y recibe
            <br />
            200 CETES al instante
          </p>
          <p className="mt-2 text-xs leading-relaxed text-[#d2e9df]">
            Comparte tu invitación por WhatsApp. Cuando entre con tu enlace,
            activas recompensa.
          </p>
          <div className="mt-4">
            <Button
              asChild
              className="h-10 rounded-full bg-white px-4 text-sm font-bold text-[#184e46] hover:bg-white/90"
            >
              <a href={whatsappInviteHref} target="_blank" rel="noreferrer">
                {t('referral.cta')}
              </a>
            </Button>
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-[1.5rem] border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-bold text-foreground">{t('loUltimo')}</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Últimos {DASHBOARD_MOVEMENTS_PREVIEW_LIMIT} movimientos de tu cuenta
            · toca para ver detalle
          </p>
        </div>
        <ul className="divide-y divide-border">
          {loUltimoMovements.length === 0 ? (
            <li className="px-4 py-8 text-center text-sm text-muted-foreground">
              Aquí aparecerán depósitos, retiros, transferencias y demás
              movimientos.
            </li>
          ) : (
            loUltimoMovements.map((mov) => {
              const esPositivo = mov.monto >= 0;
              return (
                <li key={mov.id} className="px-2">
                  <button
                    type="button"
                    onClick={() => setSelected(mov)}
                    className="flex w-full items-center gap-3 rounded-xl px-2 py-3.5 text-left transition hover:bg-secondary/80 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground">
                      {iconForMovimientoTipo(mov.tipo)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {mov.titulo}
                        </p>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ring-1",
                            movementEstadoBadgeClass(mov.estado),
                          )}
                        >
                          {mov.estado}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatMovementListSubtitle(mov.createdAt)} ·{" "}
                        {formatMovementMeta(mov)}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "max-w-[42%] shrink-0 text-right text-sm font-bold tabular-nums",
                        esPositivo ? "text-emerald-600 dark:text-emerald-400" : "text-foreground",
                      )}
                    >
                      {hideBalances
                        ? formatMontoOculto()
                        : formatLoUltimoMonto(mov)}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
        <div className="border-t border-border px-2 py-2">
          <Link
            href="/historial"
            className="flex w-full items-center justify-center rounded-xl py-2.5 text-sm font-semibold text-muted-foreground transition hover:bg-secondary hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('viewHistory')}
          </Link>
        </div>
      </section>

      <section className="relative overflow-hidden rounded-[1.5rem] border border-[#c9ddd2] bg-gradient-to-br from-[#f4f8f6] via-[#edf4f0] to-[#e3ece7] dark:border-[#2b4a43] dark:bg-gradient-to-br dark:from-[#0d3531] dark:via-[#15534a] dark:to-[#1f6559]">
        <div className="pointer-events-none absolute -right-16 -top-20 h-44 w-44 rounded-full bg-[#9ec7b3]/18 blur-3xl dark:bg-[#6ba690]/20" />
        <div className="pointer-events-none absolute -bottom-24 -left-12 h-40 w-40 rounded-full bg-[#b8b8b5]/14 blur-3xl dark:bg-[#22433c]/40" />

        <div className="relative p-4">
          {heroIndex === 0 && (
            <div className="space-y-4">
              <Link
                href="/historial"
                className="flex items-center justify-between rounded-xl py-1 transition hover:opacity-90 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <div>
                  <p className="text-sm font-bold text-foreground">
                    Tu resumen de saldos en tiempo real
                  </p>
                  <p className="text-[11px] text-muted-foreground dark:text-[#d2e9df]">
                    {t('balanceSummarySubtitle')}
                  </p>
                </div>
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 ring-1 ring-[#cad9d1] dark:bg-white/15 dark:ring-white/20">
                  <ChevronRight className="size-4 text-foreground dark:text-white" />
                </span>
              </Link>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-[#cad9d1] bg-white/70 p-3.5 ring-1 ring-[#dbe7e1] dark:border-[#2b4a43] dark:bg-white/10 dark:ring-white/10">
                  <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-foreground/5 dark:bg-white/10">
                    <Wallet
                      className="size-4 text-foreground dark:text-white"
                      strokeWidth={2.25}
                    />
                  </div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground dark:text-[#cde5db]">
                    {t('principal')}
                  </p>
                  <p className="mt-1 text-base font-black tabular-nums text-foreground dark:text-white">
                    {hideBalances ? (
                      formatMontoOculto()
                    ) : (
                      <>
                        <span className="sr-only">
                          Principal: {mxnToSpanishWords(mxne)}
                        </span>
                        <span aria-hidden="true">{formatMXN(mxne)}</span>
                      </>
                    )}
                  </p>
                </div>
                <div className="rounded-2xl border border-[#cad9d1] bg-white/70 p-3.5 ring-1 ring-[#dbe7e1] dark:border-[#2b4a43] dark:bg-white/10 dark:ring-white/10">
                  <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-foreground/5 dark:bg-white/10">
                    <TrendingUp
                      className="size-4 text-foreground dark:text-white"
                      strokeWidth={2.25}
                    />
                  </div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground dark:text-[#cde5db]">
                    {t('rendimiento')}
                  </p>
                  <p className="mt-1 text-base font-black tabular-nums text-foreground dark:text-white">
                    {hideBalances ? (
                      formatMontoOculto()
                    ) : (
                      <>
                        <span className="sr-only">
                          Rendimiento: {mxnToSpanishWords(data.rendimientoMxn)}
                        </span>
                        <span aria-hidden="true">
                          <RendimientoCounter value={data.rendimientoMxn} />
                        </span>
                      </>
                    )}
                  </p>
                </div>
              </div>
            </div>
          )}

          {heroIndex === 1 && (
            <div className="space-y-4">
              <Link
                href="/adelanto"
                className="flex items-center justify-between rounded-xl py-1 transition hover:opacity-90 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <div>
                  <p className="text-sm font-bold text-foreground">
                    {effectiveAdelantableMxn > 0
                      ? "Adelanto disponible para este ciclo"
                      : "Aún no tienes adelanto habilitado"}
                  </p>
                  <p className="text-[11px] text-muted-foreground dark:text-[#d2e9df]">
                    {t('adelantoSubtitle')}
                  </p>
                </div>
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 ring-1 ring-[#cad9d1] dark:bg-white/15 dark:ring-white/20">
                  <ChevronRight className="size-4 text-foreground dark:text-white" />
                </span>
              </Link>

              <div className="relative overflow-hidden rounded-2xl border border-[#c0d6ca] bg-gradient-to-br from-[#dcebe4] via-[#d3e5dc] to-[#c8ddd3] p-4 ring-1 ring-[#b9d1c4]/70 dark:border-[#2b4a43] dark:from-[#10413a] dark:via-[#15534a] dark:to-[#1b6155] dark:ring-[#2b4a43]/80">
                <div className="pointer-events-none absolute -right-10 -top-12 h-28 w-28 rounded-full bg-[#8ab9a3]/25 blur-2xl dark:bg-[#4d8c77]/30" />
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#4d6a5f] dark:text-[#d2e9df]">
                  {t('adelantableLabel')}
                </p>
                <p className="mt-1 text-3xl font-black tracking-tight text-foreground dark:text-white">
                  {hideBalances ? (
                    formatMontoOculto()
                  ) : (
                    <>
                      <span className="sr-only">
                        Monto adelantable: {mxnToSpanishWords(effectiveAdelantableMxn)}
                      </span>
                      <span aria-hidden="true">
                        {formatMXN(effectiveAdelantableMxn)}
                      </span>
                    </>
                  )}
                </p>
                <p className="mt-1 text-xs text-muted-foreground dark:text-[#d2e9df]">
                  {effectiveAdelantableMxn > 0
                    ? "Disponible para solicitar ahora."
                    : "Completa verificación y ciclo activo para habilitarlo."}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-[#c0d6ca] bg-white/70 p-3.5 ring-1 ring-[#d7e5df] dark:border-[#2b4a43] dark:bg-white/10 dark:ring-white/10">
                  <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-[#dcebe4] dark:bg-[#1f4f46]">
                    <TrendingUp
                      className="size-4 text-[#46665a] dark:text-[#d2e9df]"
                      strokeWidth={2.25}
                    />
                  </div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground dark:text-[#d9e7e1]">
                    {t('rendimiento')}
                  </p>
                  <p className="mt-1 text-base font-black tabular-nums text-foreground dark:text-white">
                    {hideBalances ? (
                      formatMontoOculto()
                    ) : (
                      <>
                        <span className="sr-only">
                          Rendimiento: {mxnToSpanishWords(data.rendimientoMxn)}
                        </span>
                        <span aria-hidden="true">
                          <RendimientoCounter value={data.rendimientoMxn} />
                        </span>
                      </>
                    )}
                  </p>
                </div>
                <div className="rounded-2xl border border-[#c0d6ca] bg-white/70 p-3.5 ring-1 ring-[#d7e5df] dark:border-[#2b4a43] dark:bg-white/10 dark:ring-white/10">
                  <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-[#dcebe4] dark:bg-[#1f4f46]">
                    <Zap
                      className="size-4 text-[#46665a] dark:text-[#d2e9df]"
                      strokeWidth={2.25}
                    />
                  </div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground dark:text-[#d9e7e1]">
                    {t('adelantoStatus')}
                  </p>
                  <p className="mt-1 text-sm font-black text-foreground dark:text-white">
                    {effectiveAdelantableMxn > 0
                      ? "Listo para pedir"
                      : "Bloqueado"}
                  </p>
                </div>
              </div>
            </div>
          )}

          {heroIndex === 2 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-xl py-1">
                <div>
                  <p className="text-sm font-bold text-foreground">
                    Seyf Puntos
                  </p>
                  <p className="text-[11px] text-muted-foreground dark:text-[#d2e9df]">
                    Acumula por uso y referidos. Canjes en la siguiente fase.
                  </p>
                </div>
                <span className="rounded-full border border-border bg-white/80 px-2 py-1 text-[10px] font-bold text-muted-foreground dark:bg-white/10 dark:text-[#d2e9df]">
                  Próximamente
                </span>
              </div>

              <div className="rounded-2xl border border-[#cad9d1] bg-white/70 p-4 ring-1 ring-[#dbe7e1] dark:border-[#2b4a43] dark:bg-white/10 dark:ring-white/10">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground dark:text-[#d9e7e1]">
                  Puntos acumulados
                </p>
                <p className="mt-1 text-3xl font-black tracking-tight text-foreground dark:text-white">
                  {data.puntos.toLocaleString("es-MX")}
                </p>
                <p className="mt-2 text-xs text-muted-foreground dark:text-[#d2e9df]">
                  En el siguiente paso pulimos catálogo y niveles de beneficios.
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      {activeCycle ? (
        <section className="relative overflow-hidden rounded-[1.6rem] border border-[#c0d6ca] bg-gradient-to-br from-[#e4efe9] via-[#d9e9e1] to-[#cde1d7] p-5 shadow-[0_16px_45px_rgba(35,94,77,0.16)] dark:border-[#2b4a43] dark:from-[#0f3b36] dark:via-[#15534a] dark:to-[#1b5b50] dark:shadow-[0_16px_45px_rgba(20,83,74,0.35)]">
          <div className="pointer-events-none absolute -right-14 -top-20 h-44 w-44 rounded-full bg-[#8ab9a3]/30 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 -left-12 h-40 w-40 rounded-full bg-[#9bc4b2]/25 blur-3xl" />
          <div className="relative">
            <div className="inline-flex items-center rounded-full border border-[#9fc5b5]/40 bg-background/65 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#46665a] dark:border-white/25 dark:bg-black/20 dark:text-[#d2e9df]">
              Adelanto disponible
            </div>
            <p className="mt-2 text-3xl font-black tabular-nums tracking-tight text-foreground dark:text-white">
              {hideBalances ? (
                formatMontoOculto()
              ) : (
                <>
                  <span className="sr-only">
                    Adelanto disponible: {mxnToSpanishWords(effectiveAdelantableMxn)}
                  </span>
                  <span aria-hidden="true">
                    {formatMXN(effectiveAdelantableMxn)}
                  </span>
                </>
              )}
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground dark:text-[#d2e9df]">
              Recibe una parte de tu rendimiento hoy, sin retirar tu capital.
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {[
                { label: "Proceso", value: "Digital" },
                { label: "Respuesta", value: "Rápida" },
                { label: "Liquidación", value: "Al cierre" },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-xl border border-[#b5d0c3]/60 bg-background/55 px-2.5 py-2 text-center backdrop-blur-[2px] dark:border-white/15 dark:bg-black/20"
                >
                  <p className="text-[10px] text-muted-foreground dark:text-[#d2e9df]/85">
                    {item.label}
                  </p>
                  <p className="mt-0.5 text-[11px] font-bold text-foreground dark:text-white">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
            {effectiveAdelantableMxn > 0 || effectiveAdvanceUsed ? (
              <Link href="/adelanto" className="mt-4 block">
                <Button className="h-12 w-full rounded-full text-base font-black">
                  {effectiveAdvanceUsed ? 'Ver mi adelanto' : 'Pedir adelanto'}
                </Button>
              </Link>
            ) : (
              <Button
                disabled
                className="mt-4 h-12 w-full rounded-full bg-secondary text-base font-black text-muted-foreground cursor-not-allowed"
              >
                Pedir adelanto
              </Button>
            )}
            <p className="mt-2 text-center text-[11px] text-muted-foreground dark:text-[#d2e9df]/80">
              Simula monto, tasa y plazo en el siguiente paso.
            </p>
          </div>
        </section>
      ) : (
        <section className="relative overflow-hidden rounded-[1.6rem] border border-border bg-card p-5">
          <EmptyState
            variant="compact"
            illustration="balance"
            title={t('emptyStateTitle')}
            description={t('emptyStateBody')}
            primaryAction={{
              label: t('emptyStateCta'),
              href: "/depositar",
            }}
          />
        </section>
      )}

      {data.saldoGastoMxn > 0 && (
        <section className="flex items-center justify-between rounded-[1.5rem] border border-border bg-card px-4 py-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              Saldo para gastar
            </p>
            <p className="text-xl font-black tabular-nums text-foreground">
              {hideBalances ? (
                formatMontoOculto()
              ) : (
                <>
                  <span className="sr-only">
                    Saldo para gastar: {mxnToSpanishWords(data.saldoGastoMxn)}
                  </span>
                  <span aria-hidden="true">
                    {formatMXN(data.saldoGastoMxn)}
                  </span>
                </>
              )}
            </p>
          </div>
          <Link href="/gastar">
            <Button
              variant="outline"
              className="h-10 rounded-full border-border bg-transparent px-5 font-semibold text-foreground hover:bg-secondary"
            >
              Usar
            </Button>
          </Link>
        </section>
      )}

      <section className="flex gap-3 rounded-[1.25rem] border border-[#cad9d1] bg-[#edf4f0] p-4 dark:border-[#2b4a43] dark:bg-gradient-to-br dark:from-[#0f3b36] dark:via-[#15534a] dark:to-[#1b5b50]">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#d9e9e1] text-[#5f7168] dark:bg-white/15 dark:text-[#d2e9df]">
          <span className="text-sm font-bold">!</span>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-foreground dark:text-white">
            {kycBadge.label}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground dark:text-[#d2e9df]">
            {kycBadge.tone === "ok"
              ? "Tu cuenta ya está validada. Puedes operar normalmente en depósitos y retiros."
              : kycBadge.tone === "wait"
                ? "Tus datos ya se enviaron a Etherfuse. Mantén este estado mientras termina la validación."
                : kycBadge.tone === "bad"
                  ? "Etherfuse rechazó la validación. Corrige tus datos y vuelve a enviarlos."
                  : "Completa tu verificación para habilitar operaciones sensibles."}
          </p>
          <Link
            href={kycBadge.href}
            className="mt-2 inline-block text-xs font-bold text-[#5f7168] underline-offset-4 hover:underline dark:text-[#d2e9df] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
          >
            {kycBadge.action}
          </Link>
        </div>
      </section>

      {selected ? (
        <MovementDetailSheet
          movement={selected}
          onClose={() => setSelected(null)}
          icon={iconForMovimientoTipo(selected.tipo)}
        />
      ) : null}
    </AppPageBody>
  );
}
