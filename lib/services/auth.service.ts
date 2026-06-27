import bcrypt from "bcrypt";
import crypto from "crypto";
import { query } from "../seyf/db/client";
import { config } from "../config";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, config.auth.bcryptRounds);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export class DuplicateUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateUserError";
  }
}

export async function checkDuplicateUser(phone: string, email: string): Promise<void> {
  const result = await query("SELECT id, phone, email FROM users WHERE phone = $1 OR email = $2", [phone, email]);
  if (result.rows.length > 0) {
    const conflict = result.rows[0];
    if (conflict.phone === phone) throw new DuplicateUserError("Phone number is already registered.");
    if (conflict.email === email) throw new DuplicateUserError("Email is already registered.");
  }
}

export async function createUser(data: { name: string; phone: string; email: string; password_hash: string }): Promise<any> {
  const result = await query(
    `INSERT INTO users (name, phone, email, password_hash, status, deposit_limit_mxn)
     VALUES ($1, $2, $3, $4, 'pending_kyc', 500.00) RETURNING id, name, phone, email, status`,
    [data.name, data.phone, data.email, data.password_hash]
  );
  return result.rows[0];
}

export function generateOtp(): string {
  // cryptographically random 6-digit string
  return crypto.randomInt(100000, 999999).toString();
}

export async function saveOtp(phone: string, code: string): Promise<void> {
  const expiresAt = new Date(Date.now() + config.otp.expiryMinutes * 60000);
  await query(
    "INSERT INTO otp_codes (phone, code, expires_at) VALUES ($1, $2, $3)",
    [phone, code, expiresAt]
  );
}

export async function validateOtp(phone: string, code: string): Promise<boolean> {
  const result = await query(
    "SELECT id, expires_at, verified FROM otp_codes WHERE phone = $1 AND code = $2 AND verified = false ORDER BY created_at DESC LIMIT 1",
    [phone, code]
  );
  if (result.rows.length === 0) return false;
  
  const otp = result.rows[0];
  if (new Date() > new Date(otp.expires_at)) return false;
  
  await query("UPDATE otp_codes SET verified = true WHERE id = $1", [otp.id]);
  return true;
}

export async function countRecentOtps(phone: string, windowHours = 1): Promise<number> {
  const since = new Date(Date.now() - windowHours * 3600000);
  const result = await query(
    "SELECT count(*) as count FROM otp_codes WHERE phone = $1 AND created_at >= $2",
    [phone, since]
  );
  return parseInt(result.rows[0].count, 10);
}
