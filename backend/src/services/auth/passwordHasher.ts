import bcrypt from "bcryptjs";
import { config } from "../../config/index.js";

export function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, config.auth.bcryptCost);
}

export function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}

/**
 * A real bcrypt hash of an unguessable, never-used password — compared
 * against on every login attempt for an email that doesn't exist, so a
 * timing attack can't distinguish "unknown email" from "wrong password"
 * by how fast the response comes back (see authService.ts's login()).
 * Fixed cost 12: independent of config.auth.bcryptCost, so the dummy
 * comparison's timing doesn't itself leak the configured cost factor.
 */
export const DUMMY_PASSWORD_HASH: string = bcrypt.hashSync(
  "not-a-real-password-this-is-only-for-timing-parity",
  12,
);
