import pino from "pino";

const isDev = process.env.NODE_ENV === "development";

const transport = isDev
  ? pino.transport({
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
        ignore: "pid,hostname",
      },
    })
  : undefined;

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers['x-api-key']",
        "body.password",
        "body.token",
        "body.secret",
        "body.clabe",
        "body.phone",
        "body.email",
        "body.curp",
        "body.rfc",
        "body.ine",
        "body.account_number",
        "body.identity",
        "body.identity.*",
        "body.publicKey",
        "body.walletPublicKey",
        "body.customerId",
      ],
      censor: "[REDACTED]",
    },
    serializers: {
      req: (req) => ({
        method: req.method,
        url: req.url,
        headers: {
          "content-type": req.headers?.["content-type"],
          "user-agent": req.headers?.["user-agent"],
          "x-forwarded-for": req.headers?.["x-forwarded-for"],
        },
      }),
      err: pino.stdSerializers.err,
    },
    base: {
      env: process.env.NODE_ENV,
      service: "seyf-api",
    },
  },
  transport,
);

export type LogContext = {
  route?: string;
  userId?: string;
  duration_ms?: number;
  status_code?: number;
  provider?: string;
  error_code?: string;
  request_id?: string;
  method?: string;
};
