import { NextResponse } from "next/server";
import { assertAdminAccess } from "@/lib/seyf/admin-auth";
import { listKycCases } from "@/lib/seyf/kyc-review-service";
import type { EtherfuseKycStatus } from "@/lib/etherfuse/kyc";
import { logger } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    assertAdminAccess(req);

    const url = new URL(req.url);
    const statusParam = url.searchParams.get("status");
    const limitParam = url.searchParams.get("limit");

    const limit = limitParam ? Math.max(1, Number.parseInt(limitParam, 10)) : 50;
    const status = statusParam ? (statusParam as EtherfuseKycStatus) : "proposed";

    const cases = await listKycCases({ status, limit });

    return NextResponse.json({
      ok: true,
      count: cases.length,
      cases,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list KYC queue";
    logger.error({ route: "admin/kyc/queue", error: message }, message);
    return NextResponse.json(
      { ok: false, error: message },
      { status: error instanceof Error && "statusCode" in error ? (error as any).statusCode : 500 },
    );
  }
}
