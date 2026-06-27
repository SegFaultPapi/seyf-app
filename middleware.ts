import { type NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/observability/logger";
import { verifyJWT, getJwtSecret } from "@/lib/seyf/auth/jwt";

const EXCLUDED_PATHS = ["/_next", "/favicon.ico", "/static", "/__nextjs"];


function extractCookieValue(setCookies: string[], name: string): string {
  for (const cookieStr of setCookies) {
    const parts = cookieStr.split(";")[0].split("=");
    if (parts[0].trim() === name) {
      return parts[1].trim();
    }
  }
  return "";
}

function decodeJwtPayload(token: string): any {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = base64.length % 4;
    const padded = pad ? base64 + "=".repeat(4 - pad) : base64;
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const shouldSkip = EXCLUDED_PATHS.some((p) => pathname.startsWith(p));
  if (shouldSkip) {
    return NextResponse.next();
  }

  const start = Date.now();
  const requestId =
    request.headers.get("x-request-id") ??
    `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const isPublicPage = pathname === "/" || pathname.startsWith("/login") || pathname.startsWith("/registro");
  const isProtectedPage = !isPublicPage && !pathname.startsWith("/api");
  const isProtectedApi =
    pathname.startsWith("/api") &&
    !pathname.startsWith("/api/auth/login") &&
    !pathname.startsWith("/api/auth/refresh") &&
    !pathname.startsWith("/api/auth/logout") &&
    !pathname.startsWith("/api/health") &&
    !pathname.startsWith("/api/webhooks");

  const isProtected = isProtectedPage || isProtectedApi;
  const isApiRoute = pathname.startsWith("/api");

  let response: NextResponse | null = null;
  let userId: string | null = null;
  let status: string | null = null;
  let depositLimitMxn: number | null = null;
  let authError: string | null = null;

  if (isProtected) {
    let accessToken = request.cookies.get("seyf_access_token")?.value || "";
    const authHeader = request.headers.get("authorization");
    if (!accessToken && authHeader && authHeader.startsWith("Bearer ")) {
      accessToken = authHeader.substring(7).trim();
    }

    let payload: any = null;
    if (accessToken) {
      payload = await verifyJWT(accessToken, getJwtSecret());
    }

    if (payload) {
      userId = payload.userId;
      status = payload.status;
      depositLimitMxn = payload.depositLimitMxn;
    } else {
      // Access token expired or missing. Try silent refresh.
      const refreshToken = request.cookies.get("seyf_refresh_token")?.value;
      if (refreshToken) {
        try {
          const refreshUrl = new URL("/api/auth/refresh", request.nextUrl);
          const refreshRes = await fetch(refreshUrl, {
            method: "POST",
            headers: {
              cookie: request.headers.get("cookie") || "",
            },
          });

          if (refreshRes.status === 200) {
            let setCookies: string[] = [];
            if (typeof refreshRes.headers.getSetCookie === "function") {
              setCookies = refreshRes.headers.getSetCookie();
            } else {
              const rawCookie = refreshRes.headers.get("set-cookie");
              if (rawCookie) {
                setCookies = rawCookie.split(/,\s*/);
              }
            }

            const newAccessToken = extractCookieValue(setCookies, "seyf_access_token");
            if (newAccessToken) {
              const newPayload = decodeJwtPayload(newAccessToken);
              if (newPayload) {
                userId = newPayload.userId;
                status = newPayload.status;
                depositLimitMxn = newPayload.depositLimitMxn;

                const requestHeaders = new Headers(request.headers);
                requestHeaders.set("x-user-id", userId!);
                requestHeaders.set("x-user-status", status!);
                requestHeaders.set("x-user-deposit-limit-mxn", String(depositLimitMxn!));

                response = NextResponse.next({
                  request: {
                    headers: requestHeaders,
                  },
                });

                for (const cookieStr of setCookies) {
                  response.headers.append("Set-Cookie", cookieStr);
                }
              }
            }
          }
        } catch (refreshErr) {
          console.error("Silent refresh failed in middleware:", refreshErr);
        }
      }

      if (!userId) {
        authError = "session_expired";
      }
    }

    if (authError) {
      const clearCookie = "; Path=/; SameSite=Strict; HttpOnly; Secure; Max-Age=0";
      if (isApiRoute) {
        response = NextResponse.json({ error: "No autorizado" }, { status: 401 });
      } else {
        response = NextResponse.redirect(new URL(`/login?reason=${authError}`, request.url));
      }
      response.headers.append("Set-Cookie", `seyf_access_token=${clearCookie}`);
      response.headers.append("Set-Cookie", `seyf_refresh_token=${clearCookie}`);
    } else {
      // Authenticated: perform role/status checks
      if (status === "pending_kyc" || status === "rejected" || status === "not_submitted") {
        if (pathname.startsWith("/depositar")) {
          response = NextResponse.redirect(new URL("/dashboard", request.url));
        } else if (isApiRoute && pathname.startsWith("/api/deposit/clabe") && request.method === "POST") {
          response = NextResponse.json({ error: "KYC no aprobado. No se pueden iniciar depósitos." }, { status: 403 });
        }
      }
    }
  }

  if (!response) {
    const requestHeaders = new Headers(request.headers);
    if (userId) {
      requestHeaders.set("x-user-id", userId);
      requestHeaders.set("x-user-status", status || "not_submitted");
      requestHeaders.set("x-user-deposit-limit-mxn", String(depositLimitMxn || 0));
    }
    response = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }

  response.headers.set("x-request-id", requestId);

  const duration = Date.now() - start;

  logger.info(
    {
      route: pathname,
      method: request.method,
      duration_ms: duration,
      status_code: response.status,
      request_id: requestId,
    },
    `${request.method} ${pathname} ${response.status} ${duration}ms`,
  );

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|static).*)",
  ],
};
