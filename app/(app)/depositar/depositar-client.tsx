"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  Landmark,
  Copy,
  Check,
  RefreshCw,
  AlertCircle,
  Sparkles,
  CheckCircle2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ClabeData = {
  clabe: string;
  bankName: string;
  beneficiaryName: string;
  reference: string;
  depositLimitMxn: number;
};

type Props = {
  initialClabe: ClabeData | null;
  wallet?: string | null;
};

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value).catch(() => null);
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  }

  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-border/50 bg-secondary/30 px-3 py-2.5">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
        {label}
      </span>
      <button
        type="button"
        onClick={() => void copy()}
        className="flex items-center justify-between gap-2 text-left"
        aria-label={`Copiar ${label}`}
      >
        <span
          className={cn(
            "text-[13px] font-semibold text-foreground",
            label === "CLABE" && "font-mono tracking-widest",
          )}
        >
          {value}
        </span>
        {copied ? (
          <Check className="size-3.5 shrink-0 text-emerald-400" />
        ) : (
          <Copy className="size-3.5 shrink-0 text-muted-foreground/60 transition hover:text-foreground" />
        )}
      </button>
    </div>
  );
}

function DepositBanner({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 8000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 shadow-sm"
    >
      <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-400" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-emerald-300">Depósito recibido</p>
        <p className="text-[12px] text-emerald-300/70 mt-0.5">
          Tu transferencia SPEI fue registrada y está siendo procesada.
        </p>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="shrink-0 text-emerald-400/60 hover:text-emerald-400 transition"
        aria-label="Cerrar notificación"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

export default function DepositarClient({ initialClabe, wallet }: Props) {
  const [clabe, setClabe] = useState<ClabeData | null>(initialClabe);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showBanner, setShowBanner] = useState(false);

  const lastDepositRef = useRef<string | null>(null);

  async function provision() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/deposit/clabe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet }),
        });
        const data = await res.json().catch(() => ({})) as Partial<ClabeData> & { error?: { message_es?: string } };
        if (!res.ok) {
          setError(data.error?.message_es ?? "Error activando CLABE");
          return;
        }
        if (data.clabe) setClabe(data as ClabeData);
      } catch {
        setError("Error de conexión. Intenta de nuevo.");
      }
    });
  }

  useEffect(() => {
    if (!clabe) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/deposit/status");
        if (!res.ok) return;
        const { movement } = await res.json() as { movement?: { id?: string; estado?: string } | null };
        if (!movement?.id) return;
        if (movement.estado === "pendiente" || movement.estado === "completado") {
          if (lastDepositRef.current !== movement.id) {
            lastDepositRef.current = movement.id;
            setShowBanner(true);
          }
        }
      } catch {
        // no-op — silent poll failure
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [clabe]);

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 px-4 pt-4 pb-6 sm:px-6">
      {showBanner && <DepositBanner onClose={() => setShowBanner(false)} />}

      <section
        className="relative overflow-hidden rounded-[1.75rem] border border-border"
        aria-label="Tu CLABE de depósito"
      >
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-violet-950/80 via-card to-blue-950/60" />
        <div className="pointer-events-none absolute -right-14 -top-20 h-52 w-52 rounded-full bg-violet-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 -left-10 h-44 w-44 rounded-full bg-blue-500/15 blur-3xl" />

        <div className="relative px-5 pb-6 pt-5">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/15">
              <Landmark className="size-4 text-foreground/80" strokeWidth={1.75} />
            </div>
            <span className="text-[13px] font-semibold text-muted-foreground">
              Cuenta interbancaria SPEI
            </span>
          </div>

          <div className="mt-5">
            {clabe ? (
              <div className="space-y-2.5">
                <CopyField label="CLABE" value={clabe.clabe} />
                <CopyField label="Banco" value={clabe.bankName} />
                <CopyField label="Beneficiario" value={clabe.beneficiaryName} />
                <CopyField label="Referencia" value={clabe.reference} />

                <div className="rounded-xl border border-border/40 bg-secondary/20 px-3.5 py-2.5 mt-1">
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Mínimo <span className="font-semibold text-foreground">$500 MXN</span> por depósito
                    {" · "}Límite{" "}
                    <span className="font-semibold text-foreground">
                      ${clabe.depositLimitMxn.toLocaleString("es-MX")} MXN
                    </span>
                    . Los depósitos fuera de rango se reembolsan automáticamente.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-5 py-4 text-center">
                <div className="flex size-14 items-center justify-center rounded-full bg-secondary/80 ring-1 ring-border">
                  <Landmark className="size-6 text-muted-foreground" strokeWidth={1.75} />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">Sin CLABE activa</p>
                  <p className="text-[13px] leading-snug text-muted-foreground">
                    Activa tu cuenta para recibir depósitos SPEI desde cualquier banco mexicano.
                  </p>
                </div>
                {error && (
                  <div className="flex w-full items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-left text-xs text-destructive">
                    <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}
                <Button
                  onClick={() => void provision()}
                  disabled={isPending}
                  className="h-11 w-full max-w-xs rounded-full bg-foreground text-sm font-bold text-background hover:bg-foreground/90"
                  id="btn-activar-clabe"
                >
                  {isPending ? (
                    <>
                      <RefreshCw className="size-4 animate-spin" />
                      Activando…
                    </>
                  ) : (
                    <>
                      <Sparkles className="size-4" />
                      Activar CLABE
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
