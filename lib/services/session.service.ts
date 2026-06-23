import { Redis } from "@upstash/redis";

export async function storeRegistrationData(phone: string, data: any): Promise<void> {
  const redis = Redis.fromEnv();
  await redis.set(`reg:${phone}`, data, { ex: 300 }); // 5 minutes TTL
}

export async function getRegistrationData(phone: string): Promise<any> {
  const redis = Redis.fromEnv();
  return await redis.get(`reg:${phone}`);
}

export async function clearRegistrationData(phone: string): Promise<void> {
  const redis = Redis.fromEnv();
  await redis.del(`reg:${phone}`);
}
