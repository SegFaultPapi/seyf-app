import { NextResponse } from "next/server";
import { assertAdminAccess } from "@/lib/seyf/admin-auth";
import { approveKyc } from "@/lib/seyf/kyc-state-machine";
import { logger } from "@/lib/observability/logger";
import { AppError } from "@/lib/seyf/api-error";

export async function PATCH(
  req: Request,
  { params }: { params: { userId: string } }
) {
  try {
    assertAdminAccess(req);

    const { userId } = params;
    if (!userId) {
      throw new AppError("validation_error", {
        statusCode: 400,
        message: "ID de usuario es requerido",
      });
    }

    const updatedUser = await approveKyc(userId);

    return NextResponse.json({
      ok: true,
      user: {
        id: updatedUser.id,
        kyc_status: updatedUser.kyc_status,
        deposit_limit_mxn: updatedUser.deposit_limit_mxn,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error al aprobar KYC";
    const status = error instanceof AppError ? error.statusCode : 500;
    
    logger.error({ route: "admin/kyc/approve", userId: params.userId, error: message }, message);
    
    return NextResponse.json(
      { ok: false, error: message },
      { status }
    );
  }
}
