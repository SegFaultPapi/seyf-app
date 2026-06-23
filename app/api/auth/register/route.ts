import { NextResponse } from "next/server";
import { z } from "zod";
import {
  hashPassword,
  checkDuplicateUser,
  generateOtp,
  saveOtp,
  DuplicateUserError,
} from "@/lib/services/auth.service";
import { deliverOtp } from "@/lib/services/otp.service";
import { storeRegistrationData } from "@/lib/services/session.service";
import { AppError, toErrorResponse } from "@/lib/seyf/api-error";

const registerSchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio"),
  phone: z.string().regex(/^\+52[0-9]{10}$/, "El teléfono debe ser en formato mexicano (+52 seguido de 10 dígitos)"),
  email: z.string().email("Correo electrónico inválido"),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = registerSchema.safeParse(body);
    
    if (!parsed.success) {
      throw new AppError("validation_error", {
        messageEs: "Datos de registro inválidos.",
        message: parsed.error.message,
        statusCode: 400,
      });
    }

    const { name, phone, email, password } = parsed.data;

    try {
      await checkDuplicateUser(phone, email);
    } catch (error) {
      if (error instanceof DuplicateUserError) {
        throw new AppError("conflict", {
          statusCode: 409,
          messageEs: "El usuario ya está registrado.",
          message: error.message,
        });
      }
      throw error;
    }

    const passwordHash = await hashPassword(password);
    const otp = generateOtp();
    
    await saveOtp(phone, otp);
    
    await storeRegistrationData(phone, {
      name,
      phone,
      email,
      password_hash: passwordHash,
    });
    
    await deliverOtp(phone, email, otp);

    return NextResponse.json(
      { message: "OTP sent", phone },
      { status: 201 }
    );
  } catch (error) {
    return toErrorResponse(error, "auth_register");
  }
}
