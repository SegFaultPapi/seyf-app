import pg from "pg";
import { webcrypto } from "node:crypto";

const iterations = 100000;
const keyLen = 32;

async function hashPassword(password) {
  const cryptoObj = globalThis.crypto || webcrypto;
  const salt = cryptoObj.getRandomValues(new Uint8Array(16));
  const encoder = new TextEncoder();
  const passwordKey = await cryptoObj.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  
  const derivedKeyBits = await cryptoObj.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: iterations,
      hash: "SHA-256"
    },
    passwordKey,
    keyLen * 8
  );
  
  const hashHex = Array.from(new Uint8Array(derivedKeyBits))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
    
  const saltHex = Array.from(salt)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
    
  return `${saltHex}:${hashHex}`;
}

async function run() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not configured in environment.");
    process.exit(1);
  }

  const pool = new pg.Pool({
    connectionString: databaseUrl,
  });

  try {
    const email = "user@example.com";
    const password = "Password123!";
    const hash = await hashPassword(password);

    console.log(`Hashing password...`);
    console.log(`Hash: ${hash}`);

    console.log(`Inserting test user...`);
    
    // Check if user already exists
    const checkRes = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (checkRes.rowCount > 0) {
      console.log(`User already exists, updating password hash...`);
      await pool.query(
        `UPDATE users 
         SET password_hash = $1, kyc_status = 'APPROVED', deposit_limit_mxn = 10000 
         WHERE email = $2`,
        [hash, email]
      );
    } else {
      await pool.query(
        `INSERT INTO users (email, password_hash, kyc_status, deposit_limit_mxn, display_name) 
         VALUES ($1, $2, 'APPROVED', 10000, 'Test User')`,
        [email, hash]
      );
    }

    console.log(`Test user successfully seeded!`);
    console.log(`Email: ${email}`);
    console.log(`Password: ${password}`);
  } catch (err) {
    console.error("Failed to seed user:", err);
  } finally {
    await pool.end();
  }
}

run();
