import { NextResponse } from "next/server";
import { extractEtherfuseErrorMessage } from "@/lib/etherfuse/client";
import { logger } from "@/lib/observability/logger";
import type { LogContext } from "@/lib/observability/logger";

export type SeyfErrorCode =
  | "spei_timeout"
  | "deploy_failed"
  | "provider_unavailable"
  | "provider_rejected"
  | "validation_error"
  | "generic_error";

// User-facing copy (español neutro mexicano, PRD §3.1 / §2.8 US-13).
const MESSAGE_ES: Record<SeyfErrorCode, string> = {
  spei_timeout:
    "Tu transferencia SPEI sigue en proceso. Puede tardar hasta el siguiente día hábil.",
  deploy_failed: "Algo salió mal. Estamos en ello.",
  provider_unavailable:
    "El proveedor no está disponible en este momento. Intenta en unos minutos.",
  provider_rejected:
    "Etherfuse rechazó la operación. Revisa en testnet tu KYC, términos aceptados y cuenta bancaria/CLABE; luego intenta de nuevo.",
  generic_error: "Algo salió mal. Estamos en ello.",
  validation_error: "Solicitud inválida.",
};

const DEFAULT_STATUS: Record<SeyfErrorCode, number> = {
  spei_timeout: 504,
  deploy_failed: 500,
  provider_unavailable: 502,
  provider_rejected: 400,
  generic_error: 500,
  validation_error: 400,
};

const DEFAULT_RETRYABLE: Record<SeyfErrorCode, boolean> = {
  spei_timeout: true,
  deploy_failed: false,
  provider_unavailable: true,
  provider_rejected: false,
  generic_error: false,
  validation_error: false,
};

export class AppError extends Error {
  readonly code: SeyfErrorCode;
  readonly statusCode: number;
  readonly retryable: boolean;
  /**
   * Si está definido, sustituye el texto fijo de `MESSAGE_ES[code]` en el JSON de error
   * (útil para validation_error con detalle seguro para el usuario).
   */
  readonly messageEs: string | null;

  constructor(
    code: SeyfErrorCode,
    opts?: {
      statusCode?: number;
      retryable?: boolean;
      /** Internal message for server-side logs (not always sent to the client). */
      message?: string;
      /** Mensaje para `error.message_es` en la respuesta; si no se envía, se usa MESSAGE_ES[code]. */
      messageEs?: string;
    },
  ) {
    super(opts?.message ?? opts?.messageEs ?? MESSAGE_ES[code]);
    this.name = "AppError";
    this.code = code;
    this.statusCode = opts?.statusCode ?? DEFAULT_STATUS[code];
    this.retryable = opts?.retryable ?? DEFAULT_RETRYABLE[code];
    this.messageEs = opts?.messageEs?.trim() ? opts.messageEs.trim() : null;
  }
}

export type SeyfErrorBody = {
  error: {
    code: SeyfErrorCode;
    message_es: string;
    retryable: boolean;
  };
  /** Solo si `SEYF_API_DEBUG_ERRORS=true` — detalle técnico para depuración. */
  debug_message?: string;
};

function isEtherfuseError(e: unknown): e is Error {
  return e instanceof Error && e.message.startsWith("Etherfuse ");
}

/**
 * Central catch handler for route handlers.
 * - AppError            → uses stored code / statusCode / retryable
 * - Etherfuse errors    → extractEtherfuseErrorMessage for the server log,
 *                         returns provider_unavailable (502) to the client
 * - anything else       → generic_error (500)
 *
 * Pass `context` matching the existing `[route/path]` log convention
 * (e.g. "quote/onramp"). Internal detail never leaves the server.
 */
export function toErrorResponse(
  e: unknown,
  context?: string,
): NextResponse<SeyfErrorBody> {
  const route = context ? `seyf/${context}` : "seyf";
  const logCtx: LogContext = { route };

  if (e instanceof AppError) {
    logCtx.error_code = e.code;
    logCtx.status_code = e.statusCode;
    logger.error(logCtx, `[${route}] ${e.code}: ${e.message}`);

    const messageEs =
      e.messageEs ??
      (e.code === "validation_error" ? e.message : null) ??
      MESSAGE_ES[e.code];
    return NextResponse.json(
      {
        error: {
          code: e.code,
          message_es: messageEs,
          retryable: e.retryable,
        },
      },
      { status: e.statusCode },
    );
  }

  if (isEtherfuseError(e)) {
    const internal = extractEtherfuseErrorMessage(null, e.message);
    logCtx.error_code = "provider_unavailable";
    logCtx.provider = "etherfuse";
    logger.error(logCtx, `[${route}] Etherfuse provider error: ${internal}`);

    return NextResponse.json(
      {
        error: {
          code: "provider_unavailable",
          message_es: MESSAGE_ES.provider_unavailable,
          retryable: DEFAULT_RETRYABLE.provider_unavailable,
        },
      },
      { status: DEFAULT_STATUS.provider_unavailable },
    );
  }

  const internal = toErrorMessage(e, "unknown error");
  logCtx.error_code = "generic_error";
  logger.error(logCtx, `[${route}] ${internal}`);

  const body: SeyfErrorBody & { debug_message?: string } = {
    error: {
      code: "generic_error",
      message_es: MESSAGE_ES.generic_error,
      retryable: DEFAULT_RETRYABLE.generic_error,
    },
  };
  if (process.env.SEYF_API_DEBUG_ERRORS === "true") {
    body.debug_message = internal;
  }
  return NextResponse.json(body, {
    status: DEFAULT_STATUS.generic_error,
  });
}

export function toErrorMessage(e: unknown, fallback = "Error desconocido"): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string" && e.trim()) return e.trim();
  return fallback;
}
