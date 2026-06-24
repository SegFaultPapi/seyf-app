import { NextResponse } from "next/server";
import { assertAdminAccess } from "@/lib/seyf/admin-auth";
import { listStuckWithdrawals } from "@/lib/seyf/withdrawal-service";
import { logger } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    assertAdminAccess(req);

    const url = new URL(req.url);
    const hoursParam = url.searchParams.get("hours");
    const hours = hoursParam ? Math.max(1, Number.parseInt(hoursParam, 10)) : 4;

    const withdrawals = await listStuckWithdrawals(hours);

    const result = withdrawals.map((w) => ({
      id: w.id,
      user_id: w.user_id,
      amount_mxn: w.amount_mxn,
      status: w.status,
      created_at: w.created_at.toISOString(),
      updated_at: w.updated_at.toISOString(),
      age_hours: (Date.now() - new Date(w.created_at).getTime()) / 3600000,
    }));

    return NextResponse.json({
      ok: true,
      count: result.length,
      threshold_hours: hours,
      withdrawals: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list stuck withdrawals";
    logger.error({ route: "admin/withdrawals/stuck", error: message }, message);
    return NextResponse.json(
      { ok: false, error: message },
      { status: error instanceof Error && "statusCode" in error ? (error as any).statusCode : 500 },
    );
  }
}
