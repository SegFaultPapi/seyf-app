import jwt from "jsonwebtoken";
import { getJwtSecret, getJwtRefreshSecret } from "../config/secrets";
import { config } from "../config";

export async function signAccessToken(payload: string | object | Buffer): Promise<string> {
  const secret = await getJwtSecret();
  return jwt.sign(payload, secret, { expiresIn: config.auth.jwt.accessExpiresIn as any });
}

export async function signRefreshToken(payload: string | object | Buffer): Promise<string> {
  const secret = await getJwtRefreshSecret();
  return jwt.sign(payload, secret, { expiresIn: config.auth.jwt.refreshExpiresIn as any });
}

export async function verifyAccessToken(token: string): Promise<any> {
  const secret = await getJwtSecret();
  return jwt.verify(token, secret);
}
