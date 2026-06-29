import { NextResponse } from "next/server";
import { z } from "zod";
import { validateOtp, createUser } from "@/lib/services/auth.service";
import { getRegistrationData, clearRegistrationData } from "@/lib/services/session.service";
import { signAccessToken, signRefreshToken } from "@/lib/utils/jwt";
import { AppError, toErrorResponse } from "@/lib/seyf/api-error";

const verifySchema = z.object({
  phone: z.string().regex(/^\+52[0-9]{10}$/, "El teléfono debe ser en formato mexicano"),
  code: z.string().length(6, "El código debe ser de 6 dígitos"),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = verifySchema.safeParse(body);
    
    if (!parsed.success) {
      throw new AppError("validation_error", {
        messageEs: "Datos de verificación inválidos.",
        message: parsed.error.message,
        statusCode: 400,
      });
    }

    const { phone, code } = parsed.data;

    const isValid = await validateOtp(phone, code);
    if (!isValid) {
      throw new AppError("invalid_request", {
        messageEs: "Código inválido o expirado.",
        message: "Invalid or expired OTP",
        statusCode: 400,
      });
    }

    const registrationData = await getRegistrationData(phone);
    if (!registrationData) {
      throw new AppError("invalid_request", {
        messageEs: "Datos de registro no encontrados o expirados. Por favor, regístrate de nuevo.",
        message: "Registration data not found",
        statusCode: 400,
      });
    }

    const user = await createUser(registrationData);
    await clearRegistrationData(phone);

    const accessToken = await signAccessToken({ sub: user.id });
    const refreshToken = await signRefreshToken({ sub: user.id });

    return NextResponse.json(
      { accessToken, refreshToken, user },
      { status: 200 }
    );
  } catch (error) {
    return toErrorResponse(error, "auth_verify");
  }
}
