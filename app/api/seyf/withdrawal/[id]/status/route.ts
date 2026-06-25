import { NextResponse } from "next/server";
import { getWithdrawalById } from "@/lib/seyf/withdrawal-service";
import { toErrorResponse } from "@/lib/seyf/api-error";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "id de retiro inválido" }, { status: 400 });
    }

    const withdrawal = await getWithdrawalById(id);
    if (!withdrawal) {
      return NextResponse.json({ error: "Retiro no encontrado" }, { status: 404 });
    }

    return NextResponse.json(
      {
        id: withdrawal.id,
        status: withdrawal.status,
        amount_mxn: withdrawal.amount_mxn,
        metadata: withdrawal.metadata,
        created_at: withdrawal.created_at,
        updated_at: withdrawal.updated_at,
      },
      {
        headers: { "Cache-Control": "no-store, max-age=0" },
      },
    );
  } catch (e) {
    return toErrorResponse(e, "withdrawal/status");
  }
}
