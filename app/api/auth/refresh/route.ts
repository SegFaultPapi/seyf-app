import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { query } from "@/lib/seyf/db/client";
import { signJWT, getJwtSecret } from "@/lib/seyf/auth/jwt";
import { createHash, randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function POST(req: Request) {
  try {
    const jar = await cookies();
    const oldRefreshToken = jar.get("seyf_refresh_token")?.value;

    if (!oldRefreshToken) {
      return NextResponse.json({ error: "Refresh token missing." }, { status: 401 });
    }

    const oldHash = hashToken(oldRefreshToken);

    // 1. Verify token in database
    const tokenRes = await query<{
      id: string;
      user_id: string;
      expires_at: Date;
    }>(
      `SELECT id, user_id, expires_at 
       FROM refresh_tokens 
       WHERE token_hash = $1`,
      [oldHash]
    );

    if (tokenRes.rowCount === 0) {
      // Clear cookies on failure
      const response = NextResponse.json({ error: "Refresh token invalid." }, { status: 401 });
      const clearCookie = "; Path=/; SameSite=Strict; HttpOnly; Secure; Max-Age=0";
      response.headers.append("Set-Cookie", `seyf_access_token=${clearCookie}`);
      response.headers.append("Set-Cookie", `seyf_refresh_token=${clearCookie}`);
      return response;
    }

    const tokenRecord = tokenRes.rows[0];

    // Check expiration
    if (new Date() >= new Date(tokenRecord.expires_at)) {
      // Clean up expired token
      await query("DELETE FROM refresh_tokens WHERE id = $1", [tokenRecord.id]);
      
      const response = NextResponse.json({ error: "Refresh token expired." }, { status: 401 });
      const clearCookie = "; Path=/; SameSite=Strict; HttpOnly; Secure; Max-Age=0";
      response.headers.append("Set-Cookie", `seyf_access_token=${clearCookie}`);
      response.headers.append("Set-Cookie", `seyf_refresh_token=${clearCookie}`);
      return response;
    }

    // 2. Load latest user status
    const userRes = await query<{
      id: string;
      email: string;
      kyc_status: string;
      deposit_limit_mxn: string;
    }>(
      `SELECT id, email, kyc_status, deposit_limit_mxn 
       FROM users 
       WHERE id = $1`,
      [tokenRecord.user_id]
    );

    if (userRes.rowCount === 0) {
      await query("DELETE FROM refresh_tokens WHERE id = $1", [tokenRecord.id]);
      const response = NextResponse.json({ error: "User not found." }, { status: 401 });
      const clearCookie = "; Path=/; SameSite=Strict; HttpOnly; Secure; Max-Age=0";
      response.headers.append("Set-Cookie", `seyf_access_token=${clearCookie}`);
      response.headers.append("Set-Cookie", `seyf_refresh_token=${clearCookie}`);
      return response;
    }

    const user = userRes.rows[0];

    // 3. Rotate refresh token: invalidate (delete) old one and issue a new one
    await query("DELETE FROM refresh_tokens WHERE id = $1", [tokenRecord.id]);

    const newRefreshToken = randomUUID() + randomUUID();
    const newHash = hashToken(newRefreshToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await query(
      `INSERT INTO refresh_tokens (token_hash, user_id, expires_at) 
       VALUES ($1, $2, $3)`,
      [newHash, user.id, expiresAt]
    );

    // 4. Generate new access token
    let jwtStatus = "not_submitted";
    if (user.kyc_status === "APPROVED") jwtStatus = "approved";
    else if (user.kyc_status === "REJECTED") jwtStatus = "rejected";
    else if (user.kyc_status === "KYC_UNDER_REVIEW") jwtStatus = "pending_kyc";

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

    // 5. Send rotated cookies
    const response = NextResponse.json({ success: true });
    const cookieOptions = "; Path=/; SameSite=Strict; HttpOnly; Secure";

    response.headers.append(
      "Set-Cookie",
      `seyf_access_token=${accessToken}${cookieOptions}; Max-Age=${accessTtl}`
    );
    response.headers.append(
      "Set-Cookie",
      `seyf_refresh_token=${newRefreshToken}${cookieOptions}; Max-Age=${30 * 24 * 60 * 60}`
    );

    return response;
  } catch (err) {
    console.error("Refresh endpoint failed:", err);
    return NextResponse.json({ error: "Error interno del servidor." }, { status: 500 });
  }
}
