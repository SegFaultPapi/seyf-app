import { NextResponse } from "next/server";
import { assertAdminAccess } from "@/lib/seyf/admin-auth";
import { rejectKyc } from "@/lib/seyf/kyc-state-machine";
import { logger } from "@/lib/observability/logger";
import { AppError } from "@/lib/seyf/api-error";

export async function PATCH(
  req: Request,
  { params }: { params: { userId: string } }
) {
  try {
    assertAdminAccess(req);

    const { userId } = params;
    const body = await req.json();
    const { reason } = body;

    if (!userId) {
      throw new AppError("validation_error", {
        statusCode: 400,
        message: "ID de usuario es requerido",
      });
    }

    if (!reason || typeof reason !== "string") {
      throw new AppError("validation_error", {
        statusCode: 400,
        message: "La razón de rechazo es requerida",
      });
    }

    const updatedUser = await rejectKyc(userId, reason);

    return NextResponse.json({
      ok: true,
      user: {
        id: updatedUser.id,
        kyc_status: updatedUser.kyc_status,
        kyc_rejection_reason: updatedUser.kyc_rejection_reason,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error al rechazar KYC";
    const status = error instanceof AppError ? error.statusCode : 500;
    
    logger.error({ route: "admin/kyc/reject", userId: params.userId, error: message }, message);
    
    return NextResponse.json(
      { ok: false, error: message },
      { status }
    );
  }
}
