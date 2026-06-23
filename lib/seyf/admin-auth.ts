import { AppError } from "@/lib/seyf/api-error";

export function assertAdminAccess(req: Request): void {
  if (process.env.NODE_ENV !== "production") return;

  const opsToken = process.env.SEYF_ETHERFUSE_OPS_TOKEN?.trim();
  const adminSecret = process.env.ADMIN_SECRET?.trim();

  if (!opsToken && !adminSecret) {
    throw new AppError("validation_error", {
      statusCode: 503,
      retryable: false,
      message: "No admin auth configured. Set SEYF_ETHERFUSE_OPS_TOKEN or ADMIN_SECRET.",
    });
  }

  const opsHeader = req.headers.get("x-seyf-ops-token")?.trim();
  const authHeader = req.headers.get("authorization")?.trim();

  if (opsToken && opsHeader === opsToken) return;
  if (adminSecret && authHeader === `Bearer ${adminSecret}`) return;

  throw new AppError("validation_error", {
    statusCode: 403,
    retryable: false,
    message: "No autorizado.",
  });
}
