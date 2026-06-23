import { type NextRequest, NextResponse } from "next/server";
import { logger, type LogContext } from "./logger";
import { toErrorMessage } from "@/lib/seyf/api-error";

type NextRouteContext = { params: Promise<Record<string, string | string[]>> };

type RouteHandler = (
  request: NextRequest,
  context: NextRouteContext,
) => Promise<NextResponse> | NextResponse;

type LoggingOptions = {
  routeName?: string;
  provider?: string;
};

export function withLogging(
  handler: RouteHandler,
  options?: LoggingOptions,
): RouteHandler {
  return async (request: NextRequest, context: NextRouteContext) => {
    const start = Date.now();
    const route = options?.routeName ?? request.nextUrl.pathname;

    try {
      const response = await handler(request, context);
      const duration = Date.now() - start;

      const logCtx: LogContext = {
        route,
        method: request.method,
        duration_ms: duration,
        status_code: response.status,
        provider: options?.provider,
      };

      if (response.status >= 500) {
        logger.error(logCtx, `${request.method} ${route} ${response.status} ${duration}ms`);
      } else if (response.status >= 400) {
        logger.warn(logCtx, `${request.method} ${route} ${response.status} ${duration}ms`);
      } else {
        logger.info(logCtx, `${request.method} ${route} ${response.status} ${duration}ms`);
      }

      return response;
    } catch (error) {
      const duration = Date.now() - start;

      const logCtx: LogContext = {
        route,
        method: request.method,
        duration_ms: duration,
        provider: options?.provider,
        error_code: error instanceof Error ? error.name : "unknown",
      };

      logger.error(logCtx, `Unhandled error in ${request.method} ${route}: ${toErrorMessage(error)}`);

      return NextResponse.json(
        {
          error: {
            code: "generic_error",
            message_es: "Algo sali\u00f3 mal. Estamos en ello.",
            retryable: false,
          },
        },
        { status: 500 },
      );
    }
  };
}
