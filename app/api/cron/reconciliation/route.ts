import { NextResponse } from "next/server";
import { runReconciliation } from "@/lib/observability/reconciliation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");

  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runReconciliation();
    return NextResponse.json(result, {
      status: result.ok ? 200 : 500,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "Reconciliation failed",
      },
      { status: 500 },
    );
  }
}
