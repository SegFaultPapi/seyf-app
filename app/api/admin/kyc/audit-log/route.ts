import { NextResponse } from "next/server";
import { assertAdminAccess } from "@/lib/seyf/admin-auth";
import { listKycAuditLog } from "@/lib/seyf/kyc-review-service";
import { logger } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    assertAdminAccess(req);

    const url = new URL(req.url);
    const customerId = url.searchParams.get("customer_id") || undefined;
    const limitParam = url.searchParams.get("limit");

    const limit = limitParam ? Math.max(1, Number.parseInt(limitParam, 10)) : 50;

    const logs = await listKycAuditLog({ customerId, limit });

    return NextResponse.json({
      ok: true,
      count: logs.length,
      logs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list KYC audit logs";
    logger.error({ route: "admin/kyc/audit-log", error: message }, message);
    return NextResponse.json(
      { ok: false, error: message },
      { status: error instanceof Error && "statusCode" in error ? (error as any).statusCode : 500 },
    );
  }
}
