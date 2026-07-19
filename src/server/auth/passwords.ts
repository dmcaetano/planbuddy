import bcrypt from "bcryptjs";
import { logger } from "../logger.js";

const BCRYPT_COST = 12;

// Argon2id is preferred when the optional native `argon2` module is
// installed and loads successfully on the deploy target; otherwise we fall
// back to bcrypt at cost 12, exactly as specified by the product contract.
let argon2Module: typeof import("argon2") | null | undefined;

async function loadArgon2(): Promise<typeof import("argon2") | null> {
  if (argon2Module !== undefined) return argon2Module;
  try {
    argon2Module = await import("argon2");
  } catch {
    logger.info("argon2 native module unavailable; using bcrypt cost-12 fallback for password hashing");
    argon2Module = null;
  }
  return argon2Module;
}

const ARGON2_PREFIX = "$argon2";
const BCRYPT_PREFIX = "$2";

export async function hashPassword(password: string): Promise<string> {
  const argon2 = await loadArgon2();
  if (argon2) {
    return argon2.hash(password, { type: argon2.argon2id });
  }
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (hash.startsWith(ARGON2_PREFIX)) {
    const argon2 = await loadArgon2();
    if (!argon2) return false;
    return argon2.verify(hash, password);
  }
  if (hash.startsWith(BCRYPT_PREFIX)) {
    return bcrypt.compare(password, hash);
  }
  return false;
}
