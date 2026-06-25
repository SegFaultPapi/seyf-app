"use client";

import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import {
  Fragment,
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { AppBackLink } from "@/components/app/app-back-link";
import { AppPageBody } from "@/components/app/app-page-body";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { EtherfuseKycSnapshot } from "@/lib/etherfuse/kyc";
import type { EtherfuseOnboardingSession } from "@/lib/etherfuse/onboarding-session";
import { cn } from "@/lib/utils";
import { normalizeDateOfBirthToIso } from "@/lib/seyf/normalize-date-of-birth";
import { isPublicStellarTestnet } from "@/lib/seyf/stellar-wallet-network";
import { useSeyfWallet } from "@/lib/seyf/use-seyf-wallet";
import { useEnsureCetesTrustline } from "@/lib/seyf/use-ensure-cetes-trustline";
import {
  MAX_KYC_IMAGE_FILE_BYTES,
  kycDocumentsFailureMessageEs,
} from "@/lib/seyf/kyc-upload-limits";
import { validateCurpChecksum } from "@/lib/seyf/curp-validator";

const KYC_PENDING_UI_KEY = "seyf_kyc_pending_ui";
/** Datos del formulario KYC para pre-rellenar el alta CLABE cuando el usuario ya esté aprobado. */
const KYC_BANK_PREFILL_KEY = "seyf_kyc_bank_prefill_v1";

/** Tamaño legible para mensajes al usuario (es-MX). */
function formatFileSizeForUser(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb >= 10 ? mb.toFixed(0) : mb.toFixed(1)} MB`;
  const kb = bytes / 1024;
  return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No pudimos leer el archivo."));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("No pudimos convertir el archivo."));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function validateImageFile(file: File | null, label: string): string | null {
  if (!file) return `${label} es requerido.`;
  const allowed = ["image/jpeg", "image/png"];
  if (!allowed.includes(file.type)) return `${label} debe ser JPG o PNG.`;
  if (file.size > MAX_KYC_IMAGE_FILE_BYTES) {
    return `${label}: el archivo pesa ${formatFileSizeForUser(file.size)}; el máximo permitido es ${formatFileSizeForUser(MAX_KYC_IMAGE_FILE_BYTES)} (evita errores al subir en móvil).`;
  }
  return null;
}

function KycDocumentPicker({
  name,
  label,
  hint,
  disabled,
  selectedFileName,
  onSelect,
}: {
  name: string;
  label: string;
  hint: string;
  disabled: boolean;
  selectedFileName: string | null;
  onSelect: (file: File | null) => void;
}) {
  const [pickError, setPickError] = useState<string | null>(null);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0] ?? null;
    if (!file) {
      setPickError(null);
      onSelect(null);
      return;
    }
    const allowed: readonly string[] = ["image/jpeg", "image/png"];
    if (!allowed.includes(file.type)) {
      setPickError("Formato no válido. Usa JPG o PNG.");
      onSelect(null);
      input.value = "";
      return;
    }
    if (file.size > MAX_KYC_IMAGE_FILE_BYTES) {
      setPickError(
        `El archivo pesa ${formatFileSizeForUser(file.size)}; el máximo es ${formatFileSizeForUser(MAX_KYC_IMAGE_FILE_BYTES)}.`,
      );
      onSelect(null);
      input.value = "";
      return;
    }
    setPickError(null);
    onSelect(file);
  };

  return (
    <div
      className={cn(
        "rounded-xl border-2 border-dashed px-4 py-4 text-center transition-colors sm:px-5 sm:py-5",
        pickError
          ? "border-destructive/70 bg-destructive/[0.06] dark:border-destructive/60 dark:bg-destructive/[0.08]"
          : selectedFileName
            ? "border-[#2d7a5e] bg-[#e8f5ef] dark:border-emerald-500/55 dark:bg-emerald-950/30"
            : "border-border bg-secondary/25",
      )}
    >
      <p className="text-[11px] font-bold leading-snug text-foreground sm:text-xs">
        {label}
      </p>
      <p className="mx-auto mt-1.5 max-w-[18rem] text-[10px] leading-snug text-muted-foreground sm:text-[11px]">
        {hint} · máx. {formatFileSizeForUser(MAX_KYC_IMAGE_FILE_BYTES)}
      </p>
      <div className="mt-3 w-full min-w-0 px-0.5">
        <Input
          type="file"
          name={name}
          accept="image/jpeg,image/png"
          required
          disabled={disabled}
          className={cn(
            "h-auto min-h-[2.75rem] w-full min-w-0 cursor-pointer rounded-lg border-border bg-background py-2 pl-2 pr-2 text-[10px] leading-tight",
            "file:mr-2 file:inline-flex file:shrink-0 file:rounded-md file:border-0 file:bg-secondary file:px-2.5 file:py-1.5 file:text-[10px] file:font-medium file:leading-tight",
            "sm:file:mr-3 sm:file:px-3 sm:file:text-[11px]",
          )}
          onChange={handleChange}
          aria-invalid={pickError ? true : undefined}
          aria-describedby={pickError ? `${name}-file-error` : undefined}
        />
      </div>
      {pickError ? (
        <p
          id={`${name}-file-error`}
          className="mt-2 text-[10px] font-medium text-destructive sm:text-[11px]"
          role="alert"
        >
          {pickError}
        </p>
      ) : null}
      {selectedFileName && !pickError ? (
        <p className="mt-3 flex items-center justify-center gap-2 text-[11px] font-semibold leading-snug text-[#1f6b4a] dark:text-emerald-300">
          <CheckCircle2 className="size-3.5 shrink-0 sm:size-4" aria-hidden />
          <span className="max-w-full break-all text-left">
            {selectedFileName}
          </span>
        </p>
      ) : null}
    </div>
  );
}

function formatApprovedDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("es-MX", { dateStyle: "long" });
}

function VerifiedField({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  if (!value) return null;
  return (
    <div className="border-b border-border py-3 last:border-b-0 last:pb-0">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function kycSummary(status: EtherfuseKycSnapshot["status"]): {
  title: string;
  tone: "ok" | "wait" | "bad" | "muted";
} {
  switch (status) {
    case "approved":
    case "approved_chain_deploying":
      return { title: "Identidad verificada", tone: "ok" };
    case "proposed":
      return { title: "En revisión", tone: "wait" };
    case "rejected":
      return { title: "No se pudo verificar", tone: "bad" };
    case "not_started":
    default:
      return { title: "Falta completar el proceso", tone: "muted" };
  }
}

function kycStatusHint(status: EtherfuseKycSnapshot["status"]): string {
  switch (status) {
    case "proposed":
      return "Tu información ya fue enviada. La validación puede tardar unos minutos.";
    case "rejected":
      return "Revisa tus datos y vuelve a enviar la verificación.";
    case "approved":
    case "approved_chain_deploying":
      return "Tu verificación está aprobada.";
    case "not_started":
    default:
      return "Completa el formulario para iniciar tu verificación.";
  }
}

const STEP_LABELS = ["Datos personales", "Tu negocio", "Documentos"] as const;

function StepIndicator({ current }: { current: 1 | 2 | 3 }) {
  return (
    <div className="mb-8 flex items-start gap-0">
      {STEP_LABELS.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;
        return (
          <Fragment key={n}>
            <div className="flex flex-col items-center gap-1.5 min-w-0 flex-shrink-0">
              <div
                className={cn(
                  "flex size-7 items-center justify-center rounded-full text-xs font-bold transition-colors",
                  done && "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400",
                  active && "bg-foreground text-background",
                  !done && !active && "bg-secondary text-muted-foreground",
                )}
                aria-current={active ? "step" : undefined}
              >
                {done ? "✓" : n}
              </div>
              <span
                className={cn(
                  "text-[10px] font-medium text-center whitespace-nowrap",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div
                className={cn(
                  "flex-1 h-px mt-3.5 mx-2",
                  done ? "bg-emerald-400/50" : "bg-border",
                )}
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

export default function IdentidadClient({
  initialSession,
  initialKyc,
}: {
  initialSession: EtherfuseOnboardingSession | null;
  initialKyc: EtherfuseKycSnapshot | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [docUploadError, setDocUploadError] = useState<string | null>(null);
  const [kycState, setKycState] = useState<EtherfuseKycSnapshot | null>(
    initialKyc,
  );
  const [pendingConfirmation, setPendingConfirmation] = useState(
    initialKyc?.status === "proposed",
  );
  const [pending, startTransition] = useTransition();
  const [refreshing, setRefreshing] = useState(false);
  const { wallet, loading, connect } = useSeyfWallet();
  const { ensure: ensureCetesTrustline, busy: trustlineBusy } =
    useEnsureCetesTrustline();
  const [trustlineStatus, setTrustlineStatus] = useState<
    "idle" | "done" | "error"
  >("idle");
  const [docFileNames, setDocFileNames] = useState<{
    idFront: string | null;
    idBack: string | null;
    selfie: string | null;
  }>({ idFront: null, idBack: null, selfie: null });

  // Multi-step form state
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [step1, setStep1] = useState({
    givenName: "", paternalLastName: "", maternalLastName: "",
    email: "", phoneNumber: "", occupation: "", dateOfBirth: "",
    curp: "", rfc: "",
    street: "", city: "", region: "", postalCode: "", country: "MX",
  });
  const [step2, setStep2] = useState({
    businessName: "", businessCategory: "", businessAddress: "",
  });
  const [step1Error, setStep1Error] = useState<string | null>(null);
  const [step2Error, setStep2Error] = useState<string | null>(null);
  const [idFrontFile, setIdFrontFile] = useState<File | null>(null);
  const [idBackFile, setIdBackFile] = useState<File | null>(null);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);

  const [speiClabe, setSpeiClabe] = useState("");
  const [baGiven, setBaGiven] = useState("");
  const [baPaternal, setBaPaternal] = useState("");
  const [baMaternal, setBaMaternal] = useState("");
  const [baBirth, setBaBirth] = useState("");
  const [baCurp, setBaCurp] = useState("");
  const [baRfc, setBaRfc] = useState("");
  const [bankBusy, setBankBusy] = useState(false);
  const [bankErr, setBankErr] = useState<string | null>(null);
  const [bankOk, setBankOk] = useState<string | null>(null);
  const [bankPrefillApplied, setBankPrefillApplied] = useState(false);

  const approved =
    kycState?.status === "approved" ||
    kycState?.status === "approved_chain_deploying";
  const inReview = kycState?.status === "proposed";
  const showPendingScreen = inReview || pendingConfirmation;
  const rejected = kycState?.status === "rejected";
  const canSubmitForm = !inReview;
  const statusHint = useMemo(
    () =>
      kycState
        ? kycStatusHint(kycState.status)
        : "Completa tus datos para validar identidad.",
    [kycState],
  );

  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(KYC_PENDING_UI_KEY);
      if (stored === "1") {
        setPendingConfirmation(true);
      }
    } catch {
      // noop
    }
  }, []);

  useEffect(() => {
    if (!approved || trustlineStatus !== "idle") return;
    void ensureCetesTrustline().then((r) => {
      setTrustlineStatus(r.ok ? "done" : "error");
      if (!r.ok) console.warn("[identidad] trustline CETES:", r.error);
    });
  }, [approved, trustlineStatus, ensureCetesTrustline]);

  useEffect(() => {
    if (!approved) return;
    if (typeof window === "undefined") return;
    if (window.location.hash !== "#cuenta-spei") return;
    const t = window.setTimeout(() => {
      document
        .getElementById("cuenta-spei")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 350);
    return () => window.clearTimeout(t);
  }, [approved]);

  useEffect(() => {
    if (!approved || !kycState || bankPrefillApplied) return;
    if (typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem(KYC_BANK_PREFILL_KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as Partial<{
        givenName: string;
        paternalLastName: string;
        maternalLastName: string;
        dateOfBirth: string;
        curp: string;
        rfc: string;
      }>;
      setBaGiven(
        (v) => v || (typeof p.givenName === "string" ? p.givenName : "") || "",
      );
      setBaPaternal(
        (v) =>
          v ||
          (typeof p.paternalLastName === "string" ? p.paternalLastName : "") ||
          "",
      );
      setBaMaternal(
        (v) =>
          v ||
          (typeof p.maternalLastName === "string" ? p.maternalLastName : "") ||
          "",
      );
      setBaBirth((v) => {
        if (v) return v;
        const dob =
          typeof p.dateOfBirth === "string" ? p.dateOfBirth.trim() : "";
        const iso = normalizeDateOfBirthToIso(dob);
        return iso ?? dob;
      });
      setBaCurp(
        (v) =>
          v || (typeof p.curp === "string" ? p.curp.toUpperCase() : "") || "",
      );
      setBaRfc(
        (v) =>
          v || (typeof p.rfc === "string" ? p.rfc.toUpperCase() : "") || "",
      );
      setBankPrefillApplied(true);
    } catch {
      // noop
    }
  }, [approved, kycState, bankPrefillApplied]);

  const runRefresh = useCallback(
    async (origin: "submit" | "button" | "reset") => {
      const res = await fetch("/api/seyf/kyc/status", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as {
        kyc?: EtherfuseKycSnapshot | null;
      };
      if (res.ok) {
        const next = data.kyc ?? null;
        if (next?.status === "proposed") {
          setPendingConfirmation(true);
          try {
            window.sessionStorage.setItem(KYC_PENDING_UI_KEY, "1");
          } catch {
            // noop
          }
        }
        if (
          next &&
          (next.status === "approved" ||
            next.status === "approved_chain_deploying" ||
            next.status === "rejected")
        ) {
          setPendingConfirmation(false);
          try {
            window.sessionStorage.removeItem(KYC_PENDING_UI_KEY);
          } catch {
            // noop
          }
        }
        setKycState((prev) => {
          if (!next && (pendingConfirmation || prev?.status === "proposed"))
            return prev;
          return next;
        });
      } else {
        console.warn("[identidad] status refresh failed", {
          origin,
          status: res.status,
        });
      }
    },
    [pendingConfirmation],
  );

  const submitSpeiBankLink = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBankErr(null);
    setBankOk(null);
    const clabeDigits = speiClabe.replace(/\D/g, "");
    if (clabeDigits.length !== 18) {
      setBankErr("La CLABE debe tener 18 dígitos.");
      return;
    }
    const birthIso = normalizeDateOfBirthToIso(baBirth.trim());
    const birthCompact = birthIso
      ? birthIso.replace(/-/g, "")
      : baBirth.replace(/\D/g, "");
    if (birthCompact.length !== 8) {
      setBankErr("Indica una fecha de nacimiento válida.");
      return;
    }
    if (!baGiven.trim() || !baPaternal.trim() || !baMaternal.trim()) {
      setBankErr("Nombre y ambos apellidos son obligatorios.");
      return;
    }
    const curpNorm = baCurp.trim().toUpperCase();
    const rfcNorm = baRfc.trim().toUpperCase();
    if (!/^[A-Z0-9]{18}$/.test(curpNorm)) {
      setBankErr("La CURP debe tener 18 caracteres.");
      return;
    }
    if (!/^[A-Z0-9]{13}$/.test(rfcNorm)) {
      setBankErr("El RFC de persona física debe tener 13 caracteres.");
      return;
    }
    setBankBusy(true);
    try {
      const res = await fetch("/api/seyf/etherfuse/bank-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "personal",
          account: {
            firstName: baGiven.trim(),
            paternalLastName: baPaternal.trim(),
            maternalLastName: baMaternal.trim(),
            birthDate: birthCompact,
            birthCountryIsoCode: "MX",
            curp: curpNorm,
            rfc: rfcNorm,
            clabe: clabeDigits,
          },
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: { message_es?: string } | string;
      };
      if (!res.ok || data.ok !== true) {
        const err = data.error;
        const msg =
          typeof err === "string"
            ? err
            : err &&
                typeof err === "object" &&
                typeof err.message_es === "string"
              ? err.message_es
              : "No se pudo registrar la cuenta.";
        setBankErr(msg);
        return;
      }
      setBankOk(
        "Cuenta registrada. Puede tardar unos minutos en activarse; luego puedes usar Añadir fondos.",
      );
      try {
        window.sessionStorage.removeItem(KYC_BANK_PREFILL_KEY);
      } catch {
        // noop
      }
    } catch (err) {
      setBankErr(err instanceof Error ? err.message : "Error de red.");
    } finally {
      setBankBusy(false);
    }
  };

  const handleNext = () => {
    if (step === 1) {
      const { givenName, paternalLastName, dateOfBirth, curp } = step1;
      if (!givenName.trim() || !paternalLastName.trim() || !dateOfBirth) {
        setStep1Error("Completa nombre, apellido paterno y fecha de nacimiento.");
        return;
      }
      const curpNorm = curp.trim().toUpperCase();
      if (
        curpNorm.length > 0 &&
        !/^[A-Z]{4}\d{6}[HM][A-Z]{2}[A-Z]{3}[A-Z0-9]\d$/.test(curpNorm)
      ) {
        setStep1Error("La CURP tiene formato inválido (18 caracteres requeridos).");
        return;
      }
      if (curpNorm.length > 0 && !validateCurpChecksum(curpNorm)) {
        setStep1Error("El CURP ingresado no es válido (error de dígito verificador).");
        return;
      }
      setStep1Error(null);
      setStep(2);
    } else if (step === 2) {
      const { businessName, businessCategory, businessAddress } = step2;
      if (!businessName.trim() || !businessCategory || !businessAddress.trim()) {
        setStep2Error("Completa todos los campos de tu negocio.");
        return;
      }
      setStep2Error(null);
      setStep(3);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setDocUploadError(null);
    startTransition(async () => {
      const connectedPublicKey = wallet?.publicKey?.trim() ?? "";
      if (!connectedPublicKey) {
        setError(
          "Primero inicia sesión con tu cuenta para continuar con la verificación.",
        );
        return;
      }

      const curpValue = step1.curp.trim().toUpperCase();
      const rfcValue = step1.rfc.trim().toUpperCase();
      const givenName = step1.givenName.trim();
      const paternalLastName = step1.paternalLastName.trim();
      const maternalLastName = step1.maternalLastName.trim();
      const familyName = [paternalLastName, maternalLastName]
        .filter(Boolean)
        .join(" ")
        .trim();

      const frontErr = validateImageFile(idFrontFile, "Frente de identificación");
      const backErr = validateImageFile(idBackFile, "Reverso de identificación");
      const selfieErr = validateImageFile(selfieFile, "Selfie");
      const validationErr = frontErr ?? backErr ?? selfieErr;
      if (validationErr) {
        setDocUploadError(validationErr);
        return;
      }

      const dateOfBirth = normalizeDateOfBirthToIso(step1.dateOfBirth);
      if (!dateOfBirth) {
        setError("Indica una fecha de nacimiento válida (usa el selector de fecha).");
        return;
      }

      const countryCode = step1.country.trim().slice(0, 2).toUpperCase() || "MX";

      const rawIdNumbers = [
        curpValue ? { type: "mx_curp", value: curpValue } : null,
        rfcValue ? { type: "mx_rfc", value: rfcValue } : null,
      ].filter(Boolean) as Array<{ type: string; value: string }>;

      if (rawIdNumbers.length === 0) {
        setError("Por favor captura tu CURP y RFC para continuar.");
        return;
      }

      const payload = {
        publicKey: connectedPublicKey,
        identity: {
          email: step1.email,
          phoneNumber: step1.phoneNumber,
          occupation: step1.occupation,
          name: { givenName, familyName },
          dateOfBirth,
          address: {
            street: step1.street,
            city: step1.city,
            region: step1.region,
            postalCode: step1.postalCode,
            country: countryCode,
          },
          idNumbers: rawIdNumbers,
        },
        businessData: step2.businessName
          ? {
              businessName: step2.businessName,
              businessCategory: step2.businessCategory,
              businessAddress: step2.businessAddress,
            }
          : undefined,
      };
      const http = await fetch("/api/seyf/kyc/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await http.json().catch(() => ({}))) as
        | { ok: true; status: string; message?: string | null }
        | { error?: { message_es?: string }; debug_message?: string };
      if (!http.ok || !("ok" in json && json.ok)) {
        const debugDetail =
          json &&
          typeof json === "object" &&
          "debug_message" in json &&
          typeof json.debug_message === "string"
            ? json.debug_message
            : null;
        if (debugDetail)
          console.warn("[identidad] KYC submit debug:", debugDetail);
        console.warn("[identidad] KYC submit failed", {
          status: http.status,
          response: json,
          payload,
        });
        setError(
          json && "error" in json && json.error?.message_es
            ? json.error.message_es
            : "Error al enviar KYC.",
        );
        return;
      }
      let documentsStatus = json.status;
      try {
        const [idFront, idBack, selfie] = await Promise.all([
          fileToDataUrl(idFrontFile as File),
          fileToDataUrl(idBackFile as File),
          fileToDataUrl(selfieFile as File),
        ]);
        /** Dos peticiones: el límite ~4.5 MB de Vercel por request se superaba con 3 fotos en JSON. */
        const parseDocsJson = async (res: Response) =>
          (await res.json().catch(() => ({}))) as {
            ok?: boolean;
            status?: string;
            error?: { message_es?: string };
            debug_message?: string;
          };

        const docsIneRes = await fetch("/api/seyf/kyc/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            publicKey: connectedPublicKey,
            document: {
              idFront: { label: "id_front", image: idFront },
              idBack: { label: "id_back", image: idBack },
            },
          }),
        });
        const docsIneJson = await parseDocsJson(docsIneRes);
        if (!docsIneRes.ok || !docsIneJson.ok) {
          const detail = docsIneJson.debug_message;
          if (detail)
            console.warn("[identidad] documents (INE) debug:", detail);
          setDocUploadError(
            kycDocumentsFailureMessageEs(
              docsIneRes.status,
              "identification",
              docsIneJson.error?.message_es,
            ),
          );
          return;
        }
        if (docsIneJson.status) documentsStatus = docsIneJson.status;

        const docsSelfieRes = await fetch("/api/seyf/kyc/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            publicKey: connectedPublicKey,
            selfie: { label: "selfie", image: selfie },
          }),
        });
        const docsSelfieJson = await parseDocsJson(docsSelfieRes);
        if (!docsSelfieRes.ok || !docsSelfieJson.ok) {
          const detail = docsSelfieJson.debug_message;
          if (detail)
            console.warn("[identidad] documents (selfie) debug:", detail);
          setDocUploadError(
            kycDocumentsFailureMessageEs(
              docsSelfieRes.status,
              "selfie",
              docsSelfieJson.error?.message_es,
            ),
          );
          return;
        }
        if (docsSelfieJson.status) documentsStatus = docsSelfieJson.status;
      } catch (uploadErr) {
        setDocUploadError(
          uploadErr instanceof Error
            ? uploadErr.message
            : "No pudimos procesar tus imágenes para KYC.",
        );
        return;
      }

      try {
        const agreementsRes = await fetch("/api/seyf/kyc/agreements", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerInfo: {
              email: step1.email || undefined,
              phone: step1.phoneNumber || undefined,
              occupation: step1.occupation || undefined,
              additionalInfo: {
                curp: curpValue || undefined,
                rfc: rfcValue || undefined,
              },
            },
          }),
        });
        const agreementsJson = (await agreementsRes
          .json()
          .catch(() => ({}))) as {
          ok?: boolean;
          error?: { message_es?: string };
          debug_message?: string;
        };
        if (!agreementsRes.ok || !agreementsJson.ok) {
          const detail = agreementsJson.debug_message;
          if (detail) console.warn("[identidad] agreements debug:", detail);
          setDocUploadError(
            agreementsJson.error?.message_es ??
              "No pudimos registrar los acuerdos legales. Reintenta.",
          );
          return;
        }
      } catch (agreementsErr) {
        setDocUploadError(
          agreementsErr instanceof Error
            ? agreementsErr.message
            : "No pudimos completar los acuerdos legales.",
        );
        return;
      }

      try {
        window.sessionStorage.setItem(
          KYC_BANK_PREFILL_KEY,
          JSON.stringify({
            givenName: step1.givenName.trim(),
            paternalLastName: step1.paternalLastName.trim(),
            maternalLastName: step1.maternalLastName.trim(),
            dateOfBirth,
            curp: curpValue,
            rfc: rfcValue,
          }),
        );
      } catch {
        // noop
      }

      // En testnet la cuenta bancaria requiere verificación manual en el dashboard de Etherfuse.
      // La llamada automática a bank-account-testnet-auto está desactivada para evitar
      // errores falsos post-KYC. El usuario debe crear/verificar la cuenta desde el dashboard.
      if (isPublicStellarTestnet()) {
        console.info(
          "[identidad] testnet: omitiendo alta bancaria automática — verificar en dashboard Etherfuse",
        );
      }

      setSuccess("Tu información se envió correctamente.");
      if (
        documentsStatus === "proposed" ||
        documentsStatus === "approved" ||
        documentsStatus === "approved_chain_deploying" ||
        documentsStatus === "rejected"
      ) {
        if (documentsStatus === "proposed") {
          setPendingConfirmation(true);
          try {
            window.sessionStorage.setItem(KYC_PENDING_UI_KEY, "1");
          } catch {
            // noop
          }
        }
        if (
          documentsStatus === "approved" ||
          documentsStatus === "approved_chain_deploying" ||
          documentsStatus === "rejected"
        ) {
          setPendingConfirmation(false);
          try {
            window.sessionStorage.removeItem(KYC_PENDING_UI_KEY);
          } catch {
            // noop
          }
        }
        setKycState((prev) =>
          prev
            ? {
                ...prev,
                status: documentsStatus as EtherfuseKycSnapshot["status"],
              }
            : {
                customerId: "",
                walletPublicKey: connectedPublicKey,
                status: documentsStatus as EtherfuseKycSnapshot["status"],
                approvedAt: null,
                currentRejectionReason: null,
                verifiedProfile: null,
                documentsCount: 0,
                selfiesCount: 0,
              },
        );
      }
      void runRefresh("submit");
    });
  };

  const refresh = () => {
    setRefreshing(true);
    void runRefresh("button").finally(() => {
      setRefreshing(false);
    });
  };

  if (approved && kycState) {
    const profile = kycState.verifiedProfile;
    const approvedLabel = formatApprovedDate(kycState.approvedAt);
    const hasDetails =
      profile &&
      (profile.fullName ||
        profile.email ||
        profile.phoneNumber ||
        profile.addressLine);

    return (
      <AppPageBody>
        <AppBackLink href="/dashboard" />

        <div className="mb-6 flex justify-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/20 ring-1 ring-emerald-400/30">
            <svg
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-emerald-400"
              aria-hidden
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        </div>

        <div className="mb-8 text-center">
          <h1 className="text-4xl font-black tracking-tight text-foreground leading-none">
            Cuenta verificada
          </h1>
          <p className="mt-4 text-base text-muted-foreground font-normal">
            Tu identidad quedó confirmada. Ya puedes usar Seyf según los límites
            de tu cuenta.
          </p>
        </div>

        <div className="mb-8 rounded-[1.5rem] border border-border bg-card/50 p-5">
          <p className="text-sm font-bold text-foreground">Datos verificados</p>
          {hasDetails && profile ? (
            <div className="mt-1">
              <VerifiedField label="Nombre" value={profile.fullName} />
              <VerifiedField label="Correo" value={profile.email} />
              <VerifiedField label="Teléfono" value={profile.phoneNumber} />
              <VerifiedField label="Dirección" value={profile.addressLine} />
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              Aún no mostramos todos los datos del perfil aquí; tu cuenta sigue
              verificada.
            </p>
          )}
          {approvedLabel && (
            <p className="mt-4 text-xs text-muted-foreground">
              Verificación efectiva:{" "}
              <span className="font-semibold text-foreground">
                {approvedLabel}
              </span>
            </p>
          )}
        </div>

        {!isPublicStellarTestnet() ? (
          <section
            id="cuenta-spei"
            className="mb-8 scroll-mt-6 rounded-[1.5rem] border border-border bg-card/50 p-5"
          >
            <p className="text-sm font-bold text-foreground">
              Vincular tu CLABE bancaria
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Para depósitos y retiros necesitamos la CLABE de tu banco en
              México (18 dígitos). Es distinta de la que verás al crear un
              depósito: esa es solo para recibir esa transferencia.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Si aún no tienes cuenta bancaria con CLABE en México, este paso no
              aplicará hasta que exista una.
            </p>
            <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-[11px] leading-relaxed text-muted-foreground sm:text-xs">
              <span className="font-semibold text-foreground">Importante:</span>{" "}
              aceptar los acuerdos legales (en el envío de identidad){" "}
              <span className="font-semibold text-foreground">no registra</span>{" "}
              tu CLABE automáticamente: debes hacerlo aquí con tus 18 dígitos.
              Cuando termines, es posible que se active tu acceso a
              rendimientos.
            </p>
            <form
              className="mt-4 grid gap-3"
              onSubmit={(e) => {
                void submitSpeiBankLink(e);
              }}
            >
              <Input
                value={speiClabe}
                onChange={(ev) => setSpeiClabe(ev.target.value)}
                placeholder="CLABE (18 dígitos)"
                inputMode="numeric"
                autoComplete="off"
                className="h-12 rounded-xl font-mono tabular-nums"
                aria-label="CLABE interbancaria"
              />
              <div className="grid gap-3 sm:grid-cols-3">
                <Input
                  value={baGiven}
                  onChange={(ev) => setBaGiven(ev.target.value)}
                  placeholder="Nombre(s)"
                  className="h-12 rounded-xl"
                  autoComplete="given-name"
                />
                <Input
                  value={baPaternal}
                  onChange={(ev) => setBaPaternal(ev.target.value)}
                  placeholder="Apellido paterno"
                  className="h-12 rounded-xl"
                  autoComplete="family-name"
                />
                <Input
                  value={baMaternal}
                  onChange={(ev) => setBaMaternal(ev.target.value)}
                  placeholder="Apellido materno"
                  className="h-12 rounded-xl"
                />
              </div>
              <Input
                type="date"
                value={baBirth}
                onChange={(ev) => setBaBirth(ev.target.value)}
                className="h-12 rounded-xl"
                aria-label="Fecha de nacimiento"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  value={baCurp}
                  onChange={(ev) => setBaCurp(ev.target.value.toUpperCase())}
                  placeholder="CURP"
                  className="h-12 rounded-xl font-mono uppercase"
                />
                <Input
                  value={baRfc}
                  onChange={(ev) => setBaRfc(ev.target.value.toUpperCase())}
                  placeholder="RFC"
                  className="h-12 rounded-xl font-mono uppercase"
                />
              </div>
              {bankErr ? (
                <p className="text-sm text-destructive">{bankErr}</p>
              ) : null}
              {bankOk ? (
                <p className="text-sm text-emerald-600 dark:text-emerald-400">
                  {bankOk}
                </p>
              ) : null}
              <Button
                type="submit"
                disabled={bankBusy}
                className="h-12 w-full rounded-full bg-foreground text-sm font-bold text-background"
              >
                {bankBusy ? "Enviando…" : "Registrar cuenta"}
              </Button>
            </form>
          </section>
        ) : null}

        {trustlineBusy && (
          <div className="mb-4 rounded-[1.5rem] border border-blue-500/20 bg-blue-500/[0.07] p-4">
            <p className="text-sm text-muted-foreground">
              Configurando activos en tu cuenta…
            </p>
          </div>
        )}
        {trustlineStatus === "error" && (
          <div className="mb-4 rounded-[1.5rem] border border-amber-500/20 bg-amber-500/[0.07] p-4">
            <p className="text-sm text-muted-foreground">
              No se pudo agregar CETES a tu cuenta automáticamente. Puedes
              hacerlo manualmente desde la configuración de tu cuenta.
            </p>
          </div>
        )}

        <div className="mb-8 rounded-[1.5rem] border border-emerald-500/20 bg-emerald-500/[0.07] p-5">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Si actualizas datos en el futuro, te avisaremos desde la app.
          </p>
        </div>

        <Link href="/dashboard" className="block">
          <Button className="h-14 w-full rounded-full bg-foreground text-base font-bold text-background transition-all hover:bg-foreground/90">
            Volver al inicio
          </Button>
        </Link>
      </AppPageBody>
    );
  }

  if (showPendingScreen) {
    return (
      <AppPageBody>
        <AppBackLink href="/dashboard" />

        <div className="mb-6 flex justify-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-amber-500/20 ring-1 ring-amber-400/30">
            <svg
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-amber-500"
              aria-hidden
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
          </div>
        </div>

        <div className="mb-8 text-center">
          <h1 className="text-4xl font-black tracking-tight text-foreground leading-none">
            Verificación pendiente
          </h1>
          <p className="mt-4 text-base text-muted-foreground font-normal">
            Tu información ya fue enviada correctamente y está en proceso de
            aprobación.
          </p>
        </div>

        <div className="mb-6 rounded-[1.5rem] border border-[#bfd6ca] bg-gradient-to-br from-[#edf6f2] via-[#e5efea] to-[#d6e3dd] p-5 dark:border-[#2b4a43] dark:bg-gradient-to-br dark:from-[#0f3b36] dark:via-[#15534a] dark:to-[#1b5b50]">
          <p className="text-sm font-bold text-amber-700 dark:text-amber-300">
            Estado actual: pendiente de aprobación
          </p>
          <p className="mt-2 text-sm text-[#4f6b5f] dark:text-[#d2e9df]">
            Estamos validando tus datos. El proceso de revisión toma aproximadamente{" "}
            <span className="font-semibold">24 horas</span> en el piloto.
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          disabled={refreshing}
          onClick={refresh}
          className="h-12 w-full rounded-full border-border bg-transparent font-semibold text-foreground hover:bg-secondary"
        >
          {refreshing ? "Actualizando…" : "Actualizar estado"}
        </Button>

        <Link href="/dashboard" className="mt-3 block">
          <Button className="h-12 w-full rounded-full bg-foreground text-sm font-bold text-background hover:bg-foreground/90">
            Volver al inicio
          </Button>
        </Link>
      </AppPageBody>
    );
  }

  const statusBlock = kycState ? kycSummary(kycState.status) : null;

  return (
    <AppPageBody>
      <AppBackLink href="/dashboard" />

      <div className="mb-8">
        <h1 className="text-4xl font-black tracking-tight text-foreground leading-none">
          Verificar
          <br />
          identidad
        </h1>
        <p className="mt-4 text-base text-muted-foreground font-normal">
          Un proceso seguro para cumplir la regulación. Completa tus datos de
          identidad en Seyf para enviarlos a validación con Etherfuse.
        </p>
      </div>

      {(initialSession || kycState) && (
        <div className="mb-8 rounded-[1.5rem] border border-border bg-card/50 p-5">
          {statusBlock ? (
            <div className="mb-4">
              <p className="text-xs font-medium text-muted-foreground">
                Estado
              </p>
              <p
                className={cn(
                  "mt-1 text-sm font-bold text-foreground",
                  statusBlock.tone === "ok" &&
                    "text-emerald-600 dark:text-emerald-400",
                  statusBlock.tone === "wait" && "text-amber-200/90",
                  statusBlock.tone === "bad" && "text-destructive",
                )}
              >
                {statusBlock.title}
              </p>
              {kycState?.status === "rejected" &&
                kycState.currentRejectionReason && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {kycState.currentRejectionReason}
                  </p>
                )}
              <p className="mt-2 text-xs text-muted-foreground">{statusHint}</p>
            </div>
          ) : null}
          {!kycState && initialSession && (
            <p className="mb-4 text-sm text-muted-foreground">
              Guardamos tu sesión en este dispositivo. Cuando completes el
              portal, pulsa actualizar.
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={refreshing}
            onClick={refresh}
            className="rounded-full border-border bg-transparent font-semibold text-foreground hover:bg-secondary"
          >
            {refreshing ? "Actualizando…" : "Actualizar estado"}
          </Button>
        </div>
      )}

      {rejected ? (
        <section className="mb-6 rounded-[1.25rem] border border-destructive/30 bg-destructive/10 px-4 py-4">
          <p className="text-sm font-bold text-destructive">
            Verificación fallida
          </p>
          <p className="mt-1 text-sm text-destructive/90">
            Revisa tus datos y vuelve a enviar la verificación.
          </p>
        </section>
      ) : null}

      <StepIndicator current={step} />

      <form onSubmit={onSubmit} className="space-y-6">
        {!wallet?.publicKey ? (
          <div className="rounded-[1.25rem] border border-border bg-secondary p-4">
            <p className="text-sm text-muted-foreground">
              Conecta tu cuenta para iniciar la verificación de identidad.
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-3 rounded-full"
              disabled={loading}
              onClick={() => void connect()}
            >
              {loading ? "Cargando cuenta..." : "Conectar cuenta"}
            </Button>
          </div>
        ) : null}
        {inReview ? (
          <div className="rounded-[1rem] border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
            Tu verificación está en revisión. Mientras tanto, no es necesario
            reenviar datos.
          </div>
        ) : null}

        {/* ── Step 1: Datos personales ── */}
        {step === 1 && (
          <>
            <Input
              placeholder="Nombre(s)"
              required
              className="h-12 rounded-xl"
              disabled={!canSubmitForm}
              autoComplete="given-name"
              value={step1.givenName}
              onChange={(e) => setStep1((s) => ({ ...s, givenName: e.target.value }))}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                placeholder="Apellido paterno"
                required
                className="h-12 rounded-xl"
                disabled={!canSubmitForm}
                autoComplete="family-name"
                value={step1.paternalLastName}
                onChange={(e) => setStep1((s) => ({ ...s, paternalLastName: e.target.value }))}
              />
              <Input
                placeholder="Apellido materno"
                className="h-12 rounded-xl"
                disabled={!canSubmitForm}
                value={step1.maternalLastName}
                onChange={(e) => setStep1((s) => ({ ...s, maternalLastName: e.target.value }))}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                type="email"
                placeholder="Correo electrónico"
                required
                className="h-12 rounded-xl"
                disabled={!canSubmitForm}
                value={step1.email}
                onChange={(e) => setStep1((s) => ({ ...s, email: e.target.value }))}
              />
              <Input
                placeholder="Teléfono (+521234567890)"
                required
                minLength={7}
                className="h-12 rounded-xl"
                disabled={!canSubmitForm}
                value={step1.phoneNumber}
                onChange={(e) => setStep1((s) => ({ ...s, phoneNumber: e.target.value }))}
              />
            </div>
            <Input
              placeholder="Ocupación"
              required
              className="h-12 rounded-xl"
              disabled={!canSubmitForm}
              value={step1.occupation}
              onChange={(e) => setStep1((s) => ({ ...s, occupation: e.target.value }))}
            />
            <Input
              type="date"
              required
              className="h-12 rounded-xl"
              aria-label="Fecha de nacimiento"
              disabled={!canSubmitForm}
              value={step1.dateOfBirth}
              onChange={(e) => setStep1((s) => ({ ...s, dateOfBirth: e.target.value }))}
            />
            <Input
              placeholder="Calle y número"
              required
              className="h-12 rounded-xl"
              disabled={!canSubmitForm}
              value={step1.street}
              onChange={(e) => setStep1((s) => ({ ...s, street: e.target.value }))}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                placeholder="Ciudad"
                required
                className="h-12 rounded-xl"
                disabled={!canSubmitForm}
                value={step1.city}
                onChange={(e) => setStep1((s) => ({ ...s, city: e.target.value }))}
              />
              <Input
                placeholder="Estado"
                required
                className="h-12 rounded-xl"
                disabled={!canSubmitForm}
                value={step1.region}
                onChange={(e) => setStep1((s) => ({ ...s, region: e.target.value }))}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                placeholder="Código postal"
                required
                className="h-12 rounded-xl"
                disabled={!canSubmitForm}
                value={step1.postalCode}
                onChange={(e) => setStep1((s) => ({ ...s, postalCode: e.target.value }))}
              />
              <Input
                placeholder="País ISO-2 (MX)"
                maxLength={2}
                className="h-12 rounded-xl uppercase"
                disabled={!canSubmitForm}
                value={step1.country}
                onChange={(e) => setStep1((s) => ({ ...s, country: e.target.value.toUpperCase() }))}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                placeholder="CURP"
                required
                className="h-12 rounded-xl font-mono uppercase"
                disabled={!canSubmitForm}
                value={step1.curp}
                onChange={(e) => setStep1((s) => ({ ...s, curp: e.target.value.toUpperCase() }))}
              />
              <Input
                placeholder="RFC"
                required
                className="h-12 rounded-xl font-mono uppercase"
                disabled={!canSubmitForm}
                value={step1.rfc}
                onChange={(e) => setStep1((s) => ({ ...s, rfc: e.target.value.toUpperCase() }))}
              />
            </div>
            {step1Error && (
              <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {step1Error}
              </p>
            )}
            <Button
              type="button"
              disabled={!canSubmitForm}
              onClick={handleNext}
              className="h-14 w-full rounded-full bg-foreground text-base font-bold text-background transition-all hover:bg-foreground/90 disabled:opacity-40"
            >
              Siguiente
            </Button>
          </>
        )}

        {/* ── Step 2: Datos del negocio ── */}
        {step === 2 && (
          <>
            <Input
              placeholder="Nombre del negocio o razón social"
              required
              className="h-12 rounded-xl"
              disabled={!canSubmitForm}
              value={step2.businessName}
              onChange={(e) => setStep2((s) => ({ ...s, businessName: e.target.value }))}
            />
            <select
              required
              disabled={!canSubmitForm}
              value={step2.businessCategory}
              onChange={(e) => setStep2((s) => ({ ...s, businessCategory: e.target.value }))}
              className="h-12 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground disabled:opacity-50"
            >
              <option value="" disabled>Categoría del negocio</option>
              <option value="comercio">Comercio al por menor</option>
              <option value="servicios">Servicios profesionales</option>
              <option value="tecnologia">Tecnología</option>
              <option value="restaurante">Alimentos y bebidas</option>
              <option value="salud">Salud y bienestar</option>
              <option value="educacion">Educación</option>
              <option value="otro">Otro</option>
            </select>
            <Input
              placeholder="Dirección del negocio"
              required
              className="h-12 rounded-xl"
              disabled={!canSubmitForm}
              value={step2.businessAddress}
              onChange={(e) => setStep2((s) => ({ ...s, businessAddress: e.target.value }))}
            />
            {step2Error && (
              <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {step2Error}
              </p>
            )}
            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep(1)}
                className="h-14 flex-1 rounded-full font-bold"
              >
                Atrás
              </Button>
              <Button
                type="button"
                onClick={handleNext}
                className="h-14 flex-1 rounded-full bg-foreground text-base font-bold text-background transition-all hover:bg-foreground/90"
              >
                Siguiente
              </Button>
            </div>
          </>
        )}

        {/* ── Step 3: Documentos ── */}
        {step === 3 && (
          <>
            <p className="rounded-xl border border-[#bfd6ca] bg-[#f4faf7] px-4 py-3 text-center text-[11px] leading-relaxed text-[#4a6358] dark:border-[#2b4a43] dark:bg-secondary/40 dark:text-[#d2e9df] sm:text-xs">
              No necesitas capturar tu CLABE aquí: la registrarás cuando
              habilitemos transferencias SPEI hacia tu banco.
            </p>
            <section className="rounded-[1.25rem] border border-border bg-card/50 p-4 sm:p-5">
              <p className="text-center text-sm font-bold text-foreground">
                Documentos KYC
              </p>
              <p className="mx-auto mt-2 max-w-md text-center text-[11px] leading-relaxed text-muted-foreground sm:text-xs">
                JPG o PNG, bien iluminadas. Máximo{" "}
                {formatFileSizeForUser(MAX_KYC_IMAGE_FILE_BYTES)} por archivo.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-3 sm:gap-3">
                <KycDocumentPicker
                  name="idFront"
                  label="Identificación · frente"
                  hint="INE o pasaporte, lado principal"
                  disabled={!canSubmitForm}
                  selectedFileName={docFileNames.idFront}
                  onSelect={(f) => {
                    setIdFrontFile(f);
                    setDocFileNames((s) => ({ ...s, idFront: f?.name ?? null }));
                  }}
                />
                <KycDocumentPicker
                  name="idBack"
                  label="Identificación · reverso"
                  hint="Lado con código y datos adicionales"
                  disabled={!canSubmitForm}
                  selectedFileName={docFileNames.idBack}
                  onSelect={(f) => {
                    setIdBackFile(f);
                    setDocFileNames((s) => ({ ...s, idBack: f?.name ?? null }));
                  }}
                />
                <KycDocumentPicker
                  name="selfie"
                  label="Selfie"
                  hint="Tu rostro, bien iluminado"
                  disabled={!canSubmitForm}
                  selectedFileName={docFileNames.selfie}
                  onSelect={(f) => {
                    setSelfieFile(f);
                    setDocFileNames((s) => ({ ...s, selfie: f?.name ?? null }));
                  }}
                />
              </div>
            </section>

            {error && (
              <section className="rounded-[1.25rem] border border-destructive/30 bg-destructive/10 px-4 py-4">
                <p className="text-sm font-semibold text-destructive">
                  No pudimos enviar tu verificación
                </p>
                <p className="mt-1 text-sm text-destructive">{error}</p>
              </section>
            )}
            {docUploadError && (
              <section className="rounded-[1.25rem] border border-destructive/30 bg-destructive/10 px-4 py-4">
                <p className="text-sm font-semibold text-destructive">
                  No pudimos subir tus documentos
                </p>
                <p className="mt-1 text-sm text-destructive">{docUploadError}</p>
              </section>
            )}
            {success && (
              <p className="rounded-[1.25rem] border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
                {success}
              </p>
            )}

            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep(2)}
                className="h-14 flex-1 rounded-full font-bold"
              >
                Atrás
              </Button>
              <Button
                type="submit"
                disabled={pending || !wallet?.publicKey || !canSubmitForm}
                className="h-14 flex-1 rounded-full bg-foreground text-base font-bold text-background transition-all hover:bg-foreground/90 disabled:opacity-40"
              >
                {pending
                  ? "Enviando…"
                  : inReview
                    ? "En revisión"
                    : "Enviar verificación"}
              </Button>
            </div>
          </>
        )}
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {inReview
          ? 'Tu estado está en revisión. Pulsa "Actualizar estado" para consultar cambios.'
          : "Cuando envíes tus datos, verás aquí el estado de validación."}
      </p>
    </AppPageBody>
  );
}
