import { NextResponse } from "next/server";
import { query } from "@/lib/seyf/db/client";
import { signJWT, getJwtSecret } from "@/lib/seyf/auth/jwt";
import { verifyPassword } from "@/lib/seyf/auth/password";
import { checkRateLimit, recordLoginAttempt } from "@/lib/seyf/auth/rate-limit";
import { createHash, randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function POST(req: Request) {
  try {
    // 1. Get client IP address
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "127.0.0.1";

    // 2. Check rate limiting (10 attempts per 15 minutes)
    const allowed = await checkRateLimit(ip);
    if (!allowed) {
      return NextResponse.json(
        { error: "Demasiados intentos. Inténtalo de nuevo en 15 minutos." },
        { status: 429 }
      );
    }

    // 3. Record login attempt
    await recordLoginAttempt(ip);

    // 4. Parse request body
    const body = await req.json().catch(() => ({}));
    const email = body.email?.trim().toLowerCase();
    const password = body.password;

    if (!email || !password) {
      return NextResponse.json(
        { error: "Correo electrónico y contraseña son obligatorios." },
        { status: 400 }
      );
    }

    // 5. Look up user in database
    const userRes = await query<{
      id: string;
      email: string;
      display_name: string | null;
      kyc_status: string;
      deposit_limit_mxn: string;
      password_hash: string | null;
    }>(
      `SELECT id, email, display_name, kyc_status, deposit_limit_mxn, password_hash 
       FROM users 
       WHERE LOWER(email) = $1`,
      [email]
    );

    if (userRes.rowCount === 0) {
      return NextResponse.json({ error: "Credenciales inválidas." }, { status: 401 });
    }

    const user = userRes.rows[0];

    // 6. Verify password
    if (!user.password_hash) {
      return NextResponse.json({ error: "Credenciales inválidas." }, { status: 401 });
    }

    const validPassword = await verifyPassword(password, user.password_hash);
    if (!validPassword) {
      return NextResponse.json({ error: "Credenciales inválidas." }, { status: 401 });
    }

    // Map DB state machines status to jwt status.
    // JWT status: pending_kyc, approved, rejected, not_submitted
    let jwtStatus = "not_submitted";
    if (user.kyc_status === "APPROVED") jwtStatus = "approved";
    else if (user.kyc_status === "REJECTED") jwtStatus = "rejected";
    else if (user.kyc_status === "KYC_UNDER_REVIEW") jwtStatus = "pending_kyc";

    // 7. Generate access token
    const now = Math.floor(Date.now() / 1000);
    const accessTtl = 15 * 60; // 15 minutes
    const accessTokenPayload = {
      userId: user.id,
      status: jwtStatus,
      depositLimitMxn: Number(user.deposit_limit_mxn),
      iat: now,
      exp: now + accessTtl,
    };

    const secret = getJwtSecret();
    const accessToken = await signJWT(accessTokenPayload, secret);

    // 8. Generate and store refresh token (30 days TTL)
    const refreshToken = randomUUID() + randomUUID(); // Cryptographically secure long random token
    const refreshTokenHash = hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await query(
      `INSERT INTO refresh_tokens (token_hash, user_id, expires_at) 
       VALUES ($1, $2, $3)`,
      [refreshTokenHash, user.id, expiresAt]
    );

    // 9. Build response with cookies
    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        kycStatus: jwtStatus,
      },
    });

    const cookieOptions = "; Path=/; SameSite=Strict; HttpOnly; Secure";
    
    // Set Cookies via headers to ensure they are httpOnly, Secure, SameSite=Strict
    response.headers.append(
      "Set-Cookie",
      `seyf_access_token=${accessToken}${cookieOptions}; Max-Age=${accessTtl}`
    );
    response.headers.append(
      "Set-Cookie",
      `seyf_refresh_token=${refreshToken}${cookieOptions}; Max-Age=${30 * 24 * 60 * 60}`
    );

    return response;
  } catch (err) {
    console.error("Login endpoint failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    return NextResponse.json({ error: "Error interno del servidor.", message, stack }, { status: 500 });
  }
}
