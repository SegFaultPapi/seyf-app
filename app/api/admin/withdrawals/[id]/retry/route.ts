import { NextResponse, type NextRequest } from "next/server";
import { assertAdminAccess } from "@/lib/seyf/admin-auth";
import { getWithdrawalById, retryStuckWithdrawal } from "@/lib/seyf/withdrawal-service";
import { logger } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    assertAdminAccess(request);

    const { id } = await context.params;

    const withdrawal = await getWithdrawalById(id);
    if (!withdrawal) {
      return NextResponse.json(
        { ok: false, error: "Retiro no encontrado" },
        { status: 404 },
      );
    }

    if (withdrawal.status !== "pending") {
      return NextResponse.json(
        {
          ok: false,
          error: `El retiro está en estado "${withdrawal.status}", no se puede re-intentar. Solo se pueden re-intentar retiros en "pending".`,
          withdrawal_id: id,
          current_status: withdrawal.status,
        },
        { status: 409 },
      );
    }

    const result = await retryStuckWithdrawal(id, "admin:retry");

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: "No se pudo re-intentar el retiro" },
        { status: 500 },
      );
    }

    logger.info(
      { withdrawalId: id, userId: withdrawal.user_id, route: "admin/withdrawals/retry" },
      `Retiro ${id} re-intentado por admin`,
    );

    return NextResponse.json({
      ok: true,
      withdrawal_id: id,
      new_status: result.withdrawal?.status ?? "processing",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to retry withdrawal";
    logger.error({ route: "admin/withdrawals/retry", error: message }, message);
    return NextResponse.json(
      { ok: false, error: message },
      { status: error instanceof Error && "statusCode" in error ? (error as any).statusCode : 500 },
    );
  }
}
