import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolvePocUserIdFromRequest } from "@/lib/seyf/poc-user-cookie";
import {
  getUserClabe,
  upsertUserClabe,
} from "@/lib/seyf/spei-deposit-service";
import { resolveEtherfuseRampContext } from "@/lib/seyf/etherfuse-ramp-context";
import { etherfuseFetch, etherfuseReadBody } from "@/lib/etherfuse/client";
import { toErrorResponse } from "@/lib/seyf/api-error";
import { logger } from "@/lib/observability/logger";
import { withLogging } from "@/lib/observability/with-logging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BankAccountItem = {
  bankAccountId?: string;
  id?: string;
  etherfuseDepositClabe?: string | null;
  deletedAt?: string | null;
  status?: string;
  label?: string | null;
};

async function fetchEtherfuseDepositClabe(
  customerId: string,
): Promise<{ clabe: string; raw: Record<string, unknown> } | null> {
  const res = await etherfuseFetch(
    `/ramp/customer/${encodeURIComponent(customerId)}/bank-accounts`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageSize: 30, pageNumber: 0 }),
    },
  );
  const { json } = await etherfuseReadBody<{ items?: BankAccountItem[] }>(res);
  const items: BankAccountItem[] = json?.items ?? [];

  const active = items.find(
    (x) => !x.deletedAt && x.etherfuseDepositClabe?.trim(),
  );
  if (!active?.etherfuseDepositClabe) return null;

  return {
    clabe: active.etherfuseDepositClabe.trim(),
    raw: active as unknown as Record<string, unknown>,
  };
}

async function handleGet(req: Request) {
  try {
    const { userId } = resolvePocUserIdFromRequest(req);
    const record = await getUserClabe(userId);

    if (!record) {
      return NextResponse.json({ clabe: null });
    }

    return NextResponse.json({
      clabe: record.clabe,
      bankName: record.bank_name,
      beneficiaryName: record.beneficiary_name,
      reference: userId.slice(0, 8).toUpperCase(),
      depositLimitMxn: record.deposit_limit_mxn,
    });
  } catch (e) {
    return toErrorResponse(e, "deposit/clabe GET");
  }
}

async function handlePost(req: Request) {
  try {
    const { userId } = resolvePocUserIdFromRequest(req);

    const existing = await getUserClabe(userId);
    if (existing) {
      return NextResponse.json({
        clabe: existing.clabe,
        bankName: existing.bank_name,
        beneficiaryName: existing.beneficiary_name,
        reference: userId.slice(0, 8).toUpperCase(),
        depositLimitMxn: existing.deposit_limit_mxn,
      });
    }

    const body = await req.json().catch(() => ({})) as { wallet?: string };
    const ctx = await resolveEtherfuseRampContext({
      walletPublicKeyHint: body.wallet ?? null,
    });

    if (!ctx) {
      return NextResponse.json(
        { error: { code: "validation_error", message_es: "No se encontró contexto Etherfuse. Completa /identidad primero.", retryable: false } },
        { status: 422 },
      );
    }

    const found = await fetchEtherfuseDepositClabe(ctx.customerId);
    if (!found) {
      return NextResponse.json(
        { error: { code: "validation_error", message_es: "Tu cuenta bancaria aún no tiene CLABE de depósito activa en Etherfuse.", retryable: true } },
        { status: 422 },
      );
    }

    logger.info({ userId, clabe: found.clabe }, "[deposit/clabe] provisioning CLABE");

    const record = await upsertUserClabe({
      userId,
      clabe: found.clabe,
      bankName: "Etherfuse",
      beneficiaryName: "Seyf / Etherfuse",
      rawProviderData: found.raw,
    });

    return NextResponse.json({
      clabe: record.clabe,
      bankName: record.bank_name,
      beneficiaryName: record.beneficiary_name,
      reference: userId.slice(0, 8).toUpperCase(),
      depositLimitMxn: record.deposit_limit_mxn,
    });
  } catch (e) {
    return toErrorResponse(e, "deposit/clabe POST");
  }
}

export const GET = withLogging(handleGet as Parameters<typeof withLogging>[0], { routeName: "deposit/clabe" });
export const POST = withLogging(handlePost as Parameters<typeof withLogging>[0], { routeName: "deposit/clabe" });
