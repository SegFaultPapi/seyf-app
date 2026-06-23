"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { ProgressIndicator } from "@/components/app/registration-steps/progress-indicator";
import { AccountStep } from "@/components/app/registration-steps/account-step";
import { BusinessStep } from "@/components/app/registration-steps/business-step";
import { PhoneVerificationStep } from "@/components/app/registration-steps/phone-verification-step";
import { SuccessConfirmation } from "@/components/app/registration-steps/success-confirmation";

export default function RegistroPage() {
  const [step, setStep] = useState(0);
  const [phone, setPhone] = useState("");
  const prevStep = useRef(0);

  const goingForward = step >= prevStep.current;
  prevStep.current = step;

  return (
    <div className="flex min-h-screen flex-col bg-background px-6 py-12">
      <style>{`
        @keyframes slideInFromRight {
          from { opacity: 0; transform: translateX(30px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes slideInFromLeft {
          from { opacity: 0; transform: translateX(-30px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        .slide-forward {
          animation: slideInFromRight 0.35s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .slide-backward {
          animation: slideInFromLeft 0.35s cubic-bezier(0.16, 1, 0.3, 1);
        }
      `}</style>

      <div className="mx-auto w-full max-w-md">
        <div className="mb-12">
          <h1 className="text-4xl font-black tracking-tight text-foreground">
            Seyf
          </h1>
        </div>

        <div className="flex flex-1 flex-col justify-center">
          <div className="mb-10">
            <h2 className="text-4xl font-black tracking-tight text-foreground leading-none">
              Crea tu cuenta.
            </h2>
            <p className="mt-4 text-base text-muted-foreground font-normal">
              Tu dinero, siempre disponible.
            </p>
          </div>

          {step < 3 && <ProgressIndicator current={step} />}

          <div
            key={step}
            className={`w-full ${goingForward ? "slide-forward" : "slide-backward"}`}
          >
            {step === 0 && (
              <>
                <h2 className="text-4xl font-black tracking-tight text-foreground leading-none">
                  Tu cuenta
                </h2>
                <p className="mt-4 mb-8 text-base text-muted-foreground">
                  Ingresa tus datos personales para empezar.
                </p>
                <AccountStep
                  defaultValues={{ nombre: "", correo: "", password: "" }}
                  onNext={() => setStep(1)}
                />
              </>
            )}

            {step === 1 && (
              <>
                <h2 className="text-4xl font-black tracking-tight text-foreground leading-none">
                  Tu negocio
                </h2>
                <p className="mt-4 mb-8 text-base text-muted-foreground">
                  Información de tu empresa o actividad profesional.
                </p>
                <BusinessStep
                  defaultValues={{ businessName: "", rfc: "", curp: "" }}
                  onNext={() => setStep(2)}
                  onBack={() => setStep(0)}
                />
              </>
            )}

            {step === 2 && (
              <>
                <h2 className="text-4xl font-black tracking-tight text-foreground leading-none">
                  Verifica tu teléfono
                </h2>
                <p className="mt-4 mb-8 text-base text-muted-foreground">
                  Ingresa tu número para recibir un código de verificación.
                </p>
                <PhoneVerificationStep
                  defaultValues={{ phone, otp: "" }}
                  onComplete={(data) => {
                    setPhone(data.phone);
                    setStep(3);
                  }}
                  onBack={() => setStep(1)}
                />
              </>
            )}

            {step === 3 && (
              <SuccessConfirmation
                onResendOtp={() => setStep(2)}
              />
            )}
          </div>
        </div>

        <p className="mt-8 text-center text-sm text-muted-foreground">
          Ya tienes cuenta?{" "}
          <Link
            href="/login"
            className="font-bold text-foreground hover:underline"
          >
            Iniciar sesión
          </Link>
        </p>
      </div>
    </div>
  );
}
