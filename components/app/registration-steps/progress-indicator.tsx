"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

const STEP_COUNT = 3;

export function ProgressIndicator({ current }: { current: number }) {
  const t = useTranslations("auth.registroSteps.progress");

  return (
    <div className="mb-10 mt-6">
      <div className="flex items-center justify-center gap-2">
        {Array.from({ length: STEP_COUNT }, (_, i) => {
          const isActive = i === current;
          const isCompleted = i < current;
          const label = t(`step${i + 1}` as "step1" | "step2" | "step3");

          return (
            <div key={i} className="flex items-center gap-2">
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all duration-300",
                    isCompleted &&
                      "bg-foreground text-background",
                    isActive &&
                      "border-2 border-foreground bg-background text-foreground",
                    !isActive &&
                      !isCompleted &&
                      "border border-muted-foreground/30 bg-secondary text-muted-foreground",
                  )}
                >
                  {isCompleted ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    i + 1
                  )}
                </div>
                <span
                  className={cn(
                    "mt-1.5 text-[10px] font-medium transition-colors",
                    isActive || isCompleted
                      ? "text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {label}
                </span>
              </div>
              {i < STEP_COUNT - 1 && (
                <div
                  className={cn(
                    "mx-1 h-px w-8 transition-colors",
                    isCompleted
                      ? "bg-foreground"
                      : "bg-muted-foreground/20",
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
