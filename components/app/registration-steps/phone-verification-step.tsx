"use client";

import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const phoneSchema = z.string().regex(/^\d{10}$/, "phoneInvalid");
const otpSchema = z.string().regex(/^\d{6}$/, "otpInvalid");

const formSchema = z.object({
  phone: phoneSchema,
  otp: otpSchema,
});

export type PhoneVerificationData = z.infer<typeof formSchema>;

interface Props {
  defaultValues: PhoneVerificationData;
  onComplete: (data: PhoneVerificationData) => void;
  onBack: () => void;
}

export function PhoneVerificationStep({
  defaultValues,
  onComplete,
  onBack,
}: Props) {
  const t = useTranslations("auth.registroSteps.step3");
  const a = useTranslations("auth.registroSteps.actions");
  const v = useTranslations("auth.registroSteps.validation");

  const [otpSent, setOtpSent] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isValid },
  } = useForm<PhoneVerificationData>({
    resolver: zodResolver(formSchema),
    mode: "onChange",
    defaultValues,
  });

  const phoneValue = watch("phone");
  const phoneValid = phoneSchema.safeParse(phoneValue).success;

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const handleSendOtp = () => {
    setOtpSent(true);
    setCountdown(30);
    intervalRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const fieldError = (key: keyof typeof formSchema.shape) => {
    const msg = errors[key]?.message as string | undefined;
    return msg ? v(msg as any) : undefined;
  };

  return (
    <form onSubmit={handleSubmit(onComplete)} className="space-y-5">
      <div>
        <p className="text-sm font-medium text-muted-foreground mb-1">
          {t("phoneLabel")}
        </p>
        <Input
          {...register("phone")}
          type="tel"
          maxLength={10}
          placeholder={t("phonePlaceholder")}
          className="h-14 rounded-full bg-secondary px-6 text-base font-medium placeholder:text-muted-foreground border-0 focus-visible:ring-1 focus-visible:ring-foreground"
        />
        {fieldError("phone") && (
          <p className="mt-1.5 px-2 text-xs text-red-500">
            {fieldError("phone")}
          </p>
        )}
      </div>

      {!otpSent ? (
        <div className="pt-2">
          <Button
            type="button"
            size="lg"
            onClick={handleSendOtp}
            disabled={!phoneValid}
            className="w-full h-14 rounded-full bg-foreground text-background font-bold text-base hover:bg-foreground/90 transition-all disabled:opacity-40"
          >
            Enviar código
          </Button>
        </div>
      ) : (
        <>
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-1">
              {t("otpLabel")}
            </p>
            <Input
              {...register("otp")}
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder={t("otpPlaceholder")}
              className="h-14 rounded-full bg-secondary px-6 text-base font-medium placeholder:text-muted-foreground border-0 focus-visible:ring-1 focus-visible:ring-foreground text-center tracking-[0.3em]"
            />
            {fieldError("otp") && (
              <p className="mt-1.5 px-2 text-xs text-red-500">
                {fieldError("otp")}
              </p>
            )}
          </div>

          <div className="flex items-center justify-between">
            {countdown > 0 ? (
              <span className="text-xs text-muted-foreground">
                Reenviar en {countdown}s
              </span>
            ) : (
              <button
                type="button"
                onClick={handleSendOtp}
                className="text-xs font-semibold text-foreground hover:underline underline-offset-4"
              >
                {t("resend")}
              </button>
            )}
            <span className="text-xs text-muted-foreground">
              {t("sent")}
            </span>
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={onBack}
              className="h-14 w-1/3 rounded-full border border-border bg-transparent font-semibold text-foreground hover:bg-secondary"
            >
              {a("back")}
            </Button>
            <Button
              type="submit"
              size="lg"
              disabled={!isValid}
              className="h-14 flex-1 rounded-full bg-foreground text-background font-bold text-base hover:bg-foreground/90 transition-all disabled:opacity-40"
            >
              {a("verify")}
            </Button>
          </div>
        </>
      )}
    </form>
  );
}
