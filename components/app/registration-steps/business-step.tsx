"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const formSchema = z.object({
  businessName: z.string().min(2, "businessNameRequired"),
  rfc: z
    .string()
    .regex(/^[A-Z0-9]{13}$/, "rfcInvalid"),
  curp: z
    .string()
    .regex(/^[A-Z0-9]{18}$/, "curpInvalid"),
});

export type BusinessStepData = z.infer<typeof formSchema>;

interface Props {
  defaultValues: BusinessStepData;
  onNext: (data: BusinessStepData) => void;
  onBack: () => void;
}

export function BusinessStep({ defaultValues, onNext, onBack }: Props) {
  const t = useTranslations("auth.registroSteps.step2");
  const a = useTranslations("auth.registroSteps.actions");
  const v = useTranslations("auth.registroSteps.validation");

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<BusinessStepData>({
    resolver: zodResolver(formSchema),
    mode: "onChange",
    defaultValues,
  });

  const fieldError = (key: keyof typeof formSchema.shape) => {
    const msg = errors[key]?.message as string | undefined;
    return msg ? v(msg as any) : undefined;
  };

  return (
    <form onSubmit={handleSubmit(onNext)} className="space-y-5">
      <div>
        <p className="text-sm font-medium text-muted-foreground mb-1">
          {t("businessNameLabel")}
        </p>
        <Input
          {...register("businessName")}
          placeholder={t("businessNamePlaceholder")}
          className="h-14 rounded-full bg-secondary px-6 text-base font-medium placeholder:text-muted-foreground border-0 focus-visible:ring-1 focus-visible:ring-foreground"
        />
        {fieldError("businessName") && (
          <p className="mt-1.5 px-2 text-xs text-red-500">
            {fieldError("businessName")}
          </p>
        )}
      </div>

      <div>
        <p className="text-sm font-medium text-muted-foreground mb-1">
          {t("rfcLabel")}
        </p>
        <Input
          {...register("rfc")}
          placeholder={t("rfcPlaceholder")}
          className="h-14 rounded-full bg-secondary px-6 text-base font-medium placeholder:text-muted-foreground border-0 focus-visible:ring-1 focus-visible:ring-foreground"
        />
        {fieldError("rfc") && (
          <p className="mt-1.5 px-2 text-xs text-red-500">{fieldError("rfc")}</p>
        )}
      </div>

      <div>
        <p className="text-sm font-medium text-muted-foreground mb-1">
          {t("curpLabel")}
        </p>
        <Input
          {...register("curp")}
          placeholder={t("curpPlaceholder")}
          className="h-14 rounded-full bg-secondary px-6 text-base font-medium placeholder:text-muted-foreground border-0 focus-visible:ring-1 focus-visible:ring-foreground"
        />
        {fieldError("curp") && (
          <p className="mt-1.5 px-2 text-xs text-red-500">{fieldError("curp")}</p>
        )}
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
          {a("continue")}
        </Button>
      </div>
    </form>
  );
}
