import { NextResponse } from "next/server";
import { logger } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type HealthComponent = {
  status: "ok" | "degraded" | "down";
  latency_ms: number;
  error?: string;
};

type HealthResponse = {
  status: "ok" | "degraded" | "down";
  uptime_seconds: number;
  components: {
    redis: HealthComponent;
    etherfuse: HealthComponent;
    pollar: HealthComponent;
    spei: HealthComponent;
  };
};

async function checkRedis(): Promise<HealthComponent> {
  const start = Date.now();
  try {
    const { Redis } = await import("@upstash/redis");
    const redis = Redis.fromEnv();
    await redis.ping();
    return { status: "ok", latency_ms: Date.now() - start };
  } catch (e) {
    return {
      status: "down",
      latency_ms: Date.now() - start,
      error: "Redis connection failed",
    };
  }
}

async function checkEtherfuse(): Promise<HealthComponent> {
  const start = Date.now();
  try {
    const { verifyEtherfuseApiKey } = await import("@/lib/etherfuse/client");
    await verifyEtherfuseApiKey();
    return { status: "ok", latency_ms: Date.now() - start };
  } catch (e) {
    return {
      status: "degraded",
      latency_ms: Date.now() - start,
      error: e instanceof Error ? e.message.slice(0, 80) : "Etherfuse unavailable",
    };
  }
}

async function checkPollar(): Promise<HealthComponent> {
  const start = Date.now();
  try {
    const apiKey = process.env.NEXT_PUBLIC_POLLAR_API_KEY?.trim();
    if (!apiKey) {
      return { status: "degraded", latency_ms: Date.now() - start, error: "Pollar API key not configured" };
    }
    return { status: "ok", latency_ms: Date.now() - start };
  } catch (e) {
    return {
      status: "degraded",
      latency_ms: Date.now() - start,
      error: "Pollar check failed",
    };
  }
}

async function checkSpei(): Promise<HealthComponent> {
  const start = Date.now();
  try {
    const apiKey = process.env.BITSO_APIKEY?.trim();
    const apiSecret = process.env.BITSO_SECRET_APIKEY?.trim();
    if (!apiKey || !apiSecret) {
      return { status: "degraded", latency_ms: Date.now() - start, error: "SPEI provider not configured" };
    }
    return { status: "ok", latency_ms: Date.now() - start };
  } catch (e) {
    return {
      status: "degraded",
      latency_ms: Date.now() - start,
      error: "SPEI check failed",
    };
  }
}

export async function GET() {
  const startTime = Date.now();
  const startUptime = process.uptime();

  const [redis, etherfuse, pollar, spei] = await Promise.all([
    checkRedis(),
    checkEtherfuse(),
    checkPollar(),
    checkSpei(),
  ]);

  const components = { redis, etherfuse, pollar, spei };
  const allOk = Object.values(components).every((c) => c.status === "ok");
  const anyDown = Object.values(components).some((c) => c.status === "down");
  const overall: HealthResponse["status"] = anyDown ? "down" : allOk ? "ok" : "degraded";

  const response: HealthResponse = {
    status: overall,
    uptime_seconds: Math.floor(startUptime),
    components,
  };

  const statusCode = overall === "down" ? 503 : overall === "degraded" ? 200 : 200;

  logger.info(
    {
      route: "/api/health",
      duration_ms: Date.now() - startTime,
      status_code: statusCode,
      health_status: overall,
    },
    `Health check: ${overall}`,
  );

  return NextResponse.json(response, { status: statusCode });
}
