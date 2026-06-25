import { NextResponse } from "next/server";
import { z } from "zod";
import { getOrCreatePocUserId } from "@/lib/seyf/poc-user-cookie";
import { initiateWithdrawal } from "@/lib/seyf/withdrawal-service";
import { AppError, toErrorResponse } from "@/lib/seyf/api-error";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const initiateSchema = z.object({
  clabe: z
    .string()
    .transform((val) => val.replace(/\D/g, ""))
    .refine((val) => /^\d{18}$/.test(val), {
      message: "La CLABE debe tener exactamente 18 dígitos.",
    }),
  amount_mxn: z.number().positive("El monto debe ser mayor a cero."),
  alias: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const { userId } = await getOrCreatePocUserId();
    const body = await req.json().catch(() => null);

    const parsed = initiateSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError("validation_error", {
        statusCode: 400,
        messageEs: parsed.error.issues[0]?.message ?? "Solicitud inválida.",
      });
    }

    const { clabe, amount_mxn, alias } = parsed.data;

    const result = await initiateWithdrawal({
      userId,
      amountMxn: amount_mxn,
      clabe,
      alias,
      actor: "user",
    });

    if (!result.ok || !result.withdrawal) {
      throw new AppError("validation_error", {
        statusCode: 400,
        messageEs: "Saldo insuficiente para realizar el retiro.",
      });
    }

    return NextResponse.json(
      {
        ok: true,
        withdrawal: result.withdrawal,
      },
      {
        status: 201,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (e) {
    return toErrorResponse(e, "withdrawal/initiate");
  }
}
