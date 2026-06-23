"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const formSchema = z.object({
  nombre: z.string().min(2, "nameMin"),
  correo: z.string().email("emailInvalid"),
  password: z
    .string()
    .min(8, "passwordMin")
    .regex(/[A-Z]/, "passwordUppercase")
    .regex(/[a-z]/, "passwordLowercase")
    .regex(/[0-9]/, "passwordNumber")
    .regex(/[^A-Za-z0-9]/, "passwordSpecial"),
});

export type AccountStepData = z.infer<typeof formSchema>;

interface Props {
  defaultValues: AccountStepData;
  onNext: (data: AccountStepData) => void;
}

const PASSWORD_RULES = [
  { key: "min", test: (v: string) => v.length >= 8 },
  { key: "uppercase", test: (v: string) => /[A-Z]/.test(v) },
  { key: "lowercase", test: (v: string) => /[a-z]/.test(v) },
  { key: "number", test: (v: string) => /[0-9]/.test(v) },
  { key: "special", test: (v: string) => /[^A-Za-z0-9]/.test(v) },
] as const;

export function AccountStep({ defaultValues, onNext }: Props) {
  const t = useTranslations("auth.registroSteps.step1");
  const v = useTranslations("auth.registroSteps.validation");
  const a = useTranslations("auth.registroSteps.actions");

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isValid },
  } = useForm<AccountStepData>({
    resolver: zodResolver(formSchema),
    mode: "onChange",
    defaultValues,
  });

  const passwordValue = watch("password", "");

  const fieldError = (key: keyof typeof formSchema.shape) => {
    const msg = errors[key]?.message as string | undefined;
    return msg ? v(msg as any) : undefined;
  };

  return (
    <form onSubmit={handleSubmit(onNext)} className="space-y-5">
      <div>
        <p className="text-sm font-medium text-muted-foreground mb-1">
          {t("nameLabel")}
        </p>
        <Input
          {...register("nombre")}
          placeholder={t("namePlaceholder")}
          className="h-14 rounded-full bg-secondary px-6 text-base font-medium placeholder:text-muted-foreground border-0 focus-visible:ring-1 focus-visible:ring-foreground"
        />
        {fieldError("nombre") && (
          <p className="mt-1.5 px-2 text-xs text-red-500">
            {fieldError("nombre")}
          </p>
        )}
      </div>

      <div>
        <p className="text-sm font-medium text-muted-foreground mb-1">
          {t("emailLabel")}
        </p>
        <Input
          {...register("correo")}
          type="email"
          placeholder={t("emailPlaceholder")}
          className="h-14 rounded-full bg-secondary px-6 text-base font-medium placeholder:text-muted-foreground border-0 focus-visible:ring-1 focus-visible:ring-foreground"
        />
        {fieldError("correo") && (
          <p className="mt-1.5 px-2 text-xs text-red-500">
            {fieldError("correo")}
          </p>
        )}
      </div>

      <div>
        <p className="text-sm font-medium text-muted-foreground mb-1">
          {t("passwordLabel")}
        </p>
        <Input
          {...register("password")}
          type="password"
          placeholder={t("passwordPlaceholder")}
          className="h-14 rounded-full bg-secondary px-6 text-base font-medium placeholder:text-muted-foreground border-0 focus-visible:ring-1 focus-visible:ring-foreground"
        />
        {fieldError("password") && (
          <p className="mt-1.5 px-2 text-xs text-red-500">
            {fieldError("password")}
          </p>
        )}

        <ul className="mt-3 space-y-1.5 px-2">
          {PASSWORD_RULES.map((rule) => {
            const passed = rule.test(passwordValue);
            return (
              <li
                key={rule.key}
                className={`flex items-center gap-2 text-xs transition-colors ${
                  passed ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                <span className={`shrink-0 text-xs font-bold ${passed ? "text-foreground" : "text-muted-foreground"}`}>
                  {passed ? "✓" : "✗"}
                </span>
                {v(`password${rule.key.charAt(0).toUpperCase() + rule.key.slice(1)}` as any)}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="pt-2">
        <Button
          type="submit"
          size="lg"
          disabled={!isValid}
          className="w-full h-14 rounded-full bg-foreground text-background font-bold text-base hover:bg-foreground/90 transition-all disabled:opacity-40"
        >
          {a("continue")}
        </Button>
      </div>
    </form>
  );
}
