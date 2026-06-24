"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CheckCircle } from "lucide-react";

interface Props {
  onResendOtp?: () => void;
}

export function SuccessConfirmation({ onResendOtp }: Props) {
  const t = useTranslations("auth.registroSteps.success");
  const [resent, setResent] = useState(false);

  const handleResend = () => {
    onResendOtp?.();
    setResent(true);
    setTimeout(() => setResent(false), 3000);
  };

  return (
    <div className="flex flex-col items-center justify-center text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
        <CheckCircle className="h-10 w-10 text-emerald-600 dark:text-emerald-400" />
      </div>

      <h2 className="text-3xl font-black tracking-tight text-foreground">
        {t("heading")}
      </h2>

      <p className="mt-4 text-base text-muted-foreground leading-relaxed max-w-xs">
        {t("subtitle")}
      </p>

      <p className="mt-6 text-xs text-muted-foreground">
        {resent ? (
          <span className="text-emerald-600 font-semibold">
            {t("resent")}
          </span>
        ) : (
          <button
            type="button"
            onClick={handleResend}
            className="underline underline-offset-4 hover:text-foreground"
          >
            {t("resend")}
          </button>
        )}
      </p>

      <div className="mt-8 w-full">
        <Link href="/login">
          <Button
            size="lg"
            className="w-full h-14 rounded-full bg-foreground text-background font-bold text-base hover:bg-foreground/90 transition-all"
          >
            {t("cta")}
          </Button>
        </Link>
      </div>
    </div>
  );
}
