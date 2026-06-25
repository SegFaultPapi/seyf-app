import { NextResponse, type NextRequest } from "next/server";
import { assertAdminAccess } from "@/lib/seyf/admin-auth";
import { approveKycCase } from "@/lib/seyf/kyc-review-service";
import { logger } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ customerId: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    assertAdminAccess(request);

    const { customerId } = await context.params;
    if (!customerId) {
      return NextResponse.json(
        { ok: false, error: "customerId is required" },
        { status: 400 }
      );
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const { walletPublicKey, note } = body;
    if (!walletPublicKey || typeof walletPublicKey !== "string") {
      return NextResponse.json(
        { ok: false, error: "walletPublicKey is required and must be a string" },
        { status: 400 }
      );
    }

    const opsToken = process.env.SEYF_ETHERFUSE_OPS_TOKEN?.trim();
    const opsHeader = request.headers.get("x-seyf-ops-token")?.trim();
    const tokenActor = opsHeader && opsHeader === opsToken ? "ops_token" : "admin_secret";
    const actor = request.headers.get("x-actor-name") || request.headers.get("x-admin-email") || tokenActor;

    const result = await approveKycCase({
      customerId,
      walletPublicKey,
      actor,
      note,
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.reason },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      customerId,
      walletPublicKey,
      fromStatus: result.fromStatus,
      toStatus: "approved",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to approve KYC case";
    logger.error({ route: "admin/kyc/approve", error: message }, message);
    return NextResponse.json(
      { ok: false, error: message },
      { status: error instanceof Error && "statusCode" in error ? (error as any).statusCode : 500 },
    );
  }
}
