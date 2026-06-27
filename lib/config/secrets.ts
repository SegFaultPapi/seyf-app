import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

// Cache secrets in memory to avoid repeated calls
let jwtSecretCache: string | null = null;
let jwtRefreshSecretCache: string | null = null;

const getSecretFromManager = async (secretId: string): Promise<string> => {
  try {
    const client = new SecretsManagerClient({ region: process.env.AWS_REGION || "us-east-1" });
    const command = new GetSecretValueCommand({ SecretId: secretId });
    const response = await client.send(command);
    if (!response.SecretString) {
      throw new Error(`Secret ${secretId} is empty`);
    }
    // If it's stored as JSON, try to parse it, else assume it's a raw string
    try {
      const parsed = JSON.parse(response.SecretString);
      if (parsed[secretId]) {
        return parsed[secretId];
      }
    } catch {
      // not json, return as is
    }
    return response.SecretString;
  } catch (error) {
    throw new Error(`Failed to load ${secretId} from secrets manager: ${error instanceof Error ? error.message : String(error)}`);
  }
};

export async function getJwtSecret(): Promise<string> {
  if (jwtSecretCache) return jwtSecretCache;
  
  // Local development fallback
  if (process.env.NODE_ENV !== "production" && process.env.JWT_SECRET) {
    jwtSecretCache = process.env.JWT_SECRET;
    return jwtSecretCache;
  }

  jwtSecretCache = await getSecretFromManager(process.env.JWT_SECRET_NAME || "JWT_SECRET");
  return jwtSecretCache;
}

export async function getJwtRefreshSecret(): Promise<string> {
  if (jwtRefreshSecretCache) return jwtRefreshSecretCache;
  
  // Local development fallback
  if (process.env.NODE_ENV !== "production" && process.env.JWT_REFRESH_SECRET) {
    jwtRefreshSecretCache = process.env.JWT_REFRESH_SECRET;
    return jwtRefreshSecretCache;
  }

  jwtRefreshSecretCache = await getSecretFromManager(process.env.JWT_REFRESH_SECRET_NAME || "JWT_REFRESH_SECRET");
  return jwtRefreshSecretCache;
}
