import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { query } from "@/lib/seyf/db/client";
import { createHash } from "node:crypto";

export const dynamic = "force-dynamic";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function POST(req: Request) {
  try {
    const jar = await cookies();
    const refreshToken = jar.get("seyf_refresh_token")?.value;

    if (refreshToken) {
      const hash = hashToken(refreshToken);
      // Invalidate the refresh token in the database
      await query("DELETE FROM refresh_tokens WHERE token_hash = $1", [hash]);
    }

    const response = NextResponse.json({ success: true });
    
    // Clear both cookies
    const clearCookie = "; Path=/; SameSite=Strict; HttpOnly; Secure; Max-Age=0";
    response.headers.append("Set-Cookie", `seyf_access_token=${clearCookie}`);
    response.headers.append("Set-Cookie", `seyf_refresh_token=${clearCookie}`);

    return response;
  } catch (err) {
    console.error("Logout endpoint failed:", err);
    return NextResponse.json({ error: "Error interno del servidor." }, { status: 500 });
  }
}
