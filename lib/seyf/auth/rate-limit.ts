import { query } from "@/lib/seyf/db/client";

/**
 * Checks if the IP is allowed to perform a login attempt.
 * Returns true if allowed, false if rate-limited.
 */
export async function checkRateLimit(ip: string): Promise<boolean> {
  try {
    // Proactively clean up expired attempts (older than 15 minutes)
    await query(
      "DELETE FROM login_attempts WHERE attempted_at < NOW() - INTERVAL '15 minutes'"
    );

    // Count attempts for this IP in the last 15 minutes
    const result = await query<{ count: string }>(
      `SELECT COUNT(*) as count 
       FROM login_attempts 
       WHERE ip = $1 AND attempted_at >= NOW() - INTERVAL '15 minutes'`,
      [ip]
    );

    const count = parseInt(result.rows[0]?.count || "0", 10);
    return count < 10;
  } catch (err) {
    // If database query fails, fall back to allowing to prevent locking users out, but log it.
    console.error("Rate limit check failed:", err);
    return true;
  }
}

/**
 * Records a new login attempt from the given IP.
 */
export async function recordLoginAttempt(ip: string): Promise<void> {
  try {
    await query(
      "INSERT INTO login_attempts (ip) VALUES ($1)",
      [ip]
    );
  } catch (err) {
    console.error("Failed to record login attempt:", err);
  }
}
