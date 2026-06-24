"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const t = useTranslations("auth.login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => setLoading(false), 1500);
  };

  return (
    <div className="flex min-h-screen flex-col bg-background px-6 py-12">
      <div className="mx-auto w-full max-w-md">
      {/* Header */}
      <div className="mb-12">
        <h1 className="text-4xl font-black tracking-tight text-foreground">
          Seyf
        </h1>
      </div>

      <div className="flex flex-1 flex-col justify-center">
        <div className="mb-10">
          <h2 className="text-4xl font-black tracking-tight text-foreground leading-none">
            Bienvenido de vuelta.
          </h2>
          <p className="mt-4 text-base text-muted-foreground font-normal">
            Inicia sesión para ver tu ahorro y rendimientos.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            type="email"
            placeholder="Correo electrónico"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="h-14 rounded-full bg-secondary px-6 text-base font-medium placeholder:text-muted-foreground border-0 focus-visible:ring-1 focus-visible:ring-foreground"
          />
          <Input
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="h-14 rounded-full bg-secondary px-6 text-base font-medium placeholder:text-muted-foreground border-0 focus-visible:ring-1 focus-visible:ring-foreground"
          />

          <div className="pt-2">
            <Button
              type="submit"
              size="lg"
              disabled={loading}
              className="w-full h-14 rounded-full bg-foreground text-background font-bold text-base hover:bg-foreground/90 transition-all disabled:opacity-60"
            >
              {loading ? "Entrando..." : "Iniciar sesión"}
            </Button>
          </div>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link
            href="/recuperar"
            className="underline underline-offset-4 hover:text-foreground"
          >
            {t("forgotPassword")}
          </Link>
        </p>
      </div>

        <p className="mt-8 text-center text-sm text-muted-foreground">
          No tienes cuenta?{" "}
          <Link
            href="/registro"
            className="font-bold text-foreground hover:underline"
          >
            Crear cuenta
          </Link>
        </p>
      </div>
    </div>
  );
}
