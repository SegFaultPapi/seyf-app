import { NextResponse } from "next/server";
import { z } from "zod";
import { countRecentOtps, generateOtp, saveOtp } from "@/lib/services/auth.service";
import { deliverOtp } from "@/lib/services/otp.service";
import { getRegistrationData } from "@/lib/services/session.service";
import { config } from "@/lib/config";
import { AppError, toErrorResponse } from "@/lib/seyf/api-error";

const resendSchema = z.object({
  phone: z.string().regex(/^\+52[0-9]{10}$/, "El teléfono debe ser en formato mexicano"),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = resendSchema.safeParse(body);
    
    if (!parsed.success) {
      throw new AppError("validation_error", {
        messageEs: "Teléfono inválido.",
        message: parsed.error.message,
        statusCode: 400,
      });
    }

    const { phone } = parsed.data;

    const recentOtps = await countRecentOtps(phone, config.otp.resendRateLimit.windowHours);
    if (recentOtps >= config.otp.resendRateLimit.maxAttempts) {
      const retryAfter = config.otp.resendRateLimit.windowHours * 3600;
      return NextResponse.json(
        {
          error: {
            code: "rate_limited",
            message_es: "Has superado el límite de intentos. Intenta más tarde.",
          }
        },
        { 
          status: 429, 
          headers: { "Retry-After": String(retryAfter) } 
        }
      );
    }

    const registrationData = await getRegistrationData(phone);
    if (!registrationData) {
      throw new AppError("invalid_request", {
        messageEs: "Datos de registro no encontrados o expirados. Por favor, regístrate de nuevo.",
        message: "Registration data not found",
        statusCode: 400,
      });
    }

    const otp = generateOtp();
    await saveOtp(phone, otp);
    await deliverOtp(phone, registrationData.email, otp);

    return NextResponse.json(
      { message: "OTP resent" },
      { status: 200 }
    );
  } catch (error) {
    return toErrorResponse(error, "auth_resend_otp");
  }
}
