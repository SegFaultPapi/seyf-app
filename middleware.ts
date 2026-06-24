import { type NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/observability/logger";

const EXCLUDED_PATHS = ["/_next", "/favicon.ico", "/static", "/__nextjs"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const shouldSkip = EXCLUDED_PATHS.some((p) => pathname.startsWith(p));
  if (shouldSkip) {
    return NextResponse.next();
  }

  const start = Date.now();
  const requestId =
    request.headers.get("x-request-id") ??
    `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const response = NextResponse.next();

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
  matcher: "/api/:path*",
};
