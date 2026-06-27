import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/seyf/api-error";
import {
  buildDashboardViewModel,
  buildDashboardApiResponse,
} from "@/lib/seyf/dashboard-view-model";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const wallet =
      new URL(request.url).searchParams.get("wallet")?.trim() ?? "";
    const userId = request.headers.get("x-user-id");
    // For backward compatibility with frontend, we still need the full view model
    const vm = await buildDashboardViewModel({
      userId,
      walletPublicKeyHint: wallet.length > 0 ? wallet : null,
    });

    // Get the new API response format
    const apiResponse = await buildDashboardApiResponse({
      walletPublicKeyHint: wallet.length > 0 ? wallet : null,
    });

    // If no active cycle, keep API compatibility by returning both:
    // - the new shape signal (`no_active_cycle`)
    // - the legacy dashboard fields consumed by current UI
    if ("no_active_cycle" in apiResponse) {
      return NextResponse.json(
        {
          no_active_cycle: true,
          principalMxn: vm.principalMxn,
          rendimientoMxn: vm.rendimientoMxn,
          adelantableMxn: vm.adelantableMxn,
          puntos: vm.puntos,
          tasaAnual: vm.tasaAnual,
          saldoGastoMxn: vm.saldoGastoMxn,
          saldoNote: vm.saldoNote,
          movementsRecent: vm.movementsRecent,
          advanceUsed: vm.advanceUsed,
        },
        {
          headers: { "Cache-Control": "private, max-age=60" },
        },
      );
    }

    // Otherwise, return the combined response with both formats for now
    // In the future, we might want to return only the new format
    const response = {
      // New API format
      capital_working_mxn: apiResponse.capital_working_mxn,
      yield_accrued_mxn: apiResponse.yield_accrued_mxn,
      yield_series: (apiResponse as any).yield_series ?? undefined,
      yield_projected_mxn: apiResponse.yield_projected_mxn,
      max_advance_mxn: apiResponse.max_advance_mxn,
      cycle_end_date: apiResponse.cycle_end_date,
      advance_used: apiResponse.advance_used,
      available_balance_mxn: apiResponse.available_balance_mxn,
      // Legacy fields for backward compatibility
      principalMxn: vm.principalMxn,
      rendimientoMxn: vm.rendimientoMxn,
      adelantableMxn: vm.adelantableMxn,
      puntos: vm.puntos,
      tasaAnual: vm.tasaAnual,
      saldoGastoMxn: vm.saldoGastoMxn,
      saldoNote: vm.saldoNote,
      movementsRecent: vm.movementsRecent,
    };

    return NextResponse.json(response, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (e) {
    return toErrorResponse(e, "dashboard");
  }
}
