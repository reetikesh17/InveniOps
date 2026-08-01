import jwt from "jsonwebtoken";
import type { UserRole } from "@prisma/client";
import { config } from "../../config/index.js";

export interface AccessTokenPayload {
  readonly sub: string;
  readonly email: string;
  readonly name: string;
  readonly role: UserRole;
}

export type AuthenticatedUser = AccessTokenPayload;

export class InvalidTokenError extends Error {
  constructor(reason: string) {
    super(`invalid access token: ${reason}`);
    this.name = "InvalidTokenError";
  }
}

/**
 * Short-lived by design (config.auth.accessTokenTtlSeconds, default 15
 * minutes) — there is no refresh-token flow in this system yet. A stolen
 * token is only useful for its remaining TTL; the cost is that the
 * frontend cannot silently renew a session and must send the user back
 * through login once it expires. See docs/decisions/ for the full
 * reasoning; this is stated scope, not an oversight.
 */
export function signAccessToken(user: AccessTokenPayload): string {
  return jwt.sign({ email: user.email, name: user.name, role: user.role }, config.auth.jwtSecret, {
    subject: user.sub,
    expiresIn: config.auth.accessTokenTtlSeconds,
    algorithm: "HS256",
  });
}

/** Throws InvalidTokenError for anything wrong with the token (expired, tampered signature, malformed) — callers (requireAuth) catch this once, uniformly, rather than branching on jsonwebtoken's own error hierarchy. */
export function verifyAccessToken(token: string): AuthenticatedUser {
  let decoded: string | jwt.JwtPayload;
  try {
    decoded = jwt.verify(token, config.auth.jwtSecret, { algorithms: ["HS256"] });
  } catch (error) {
    throw new InvalidTokenError(error instanceof Error ? error.message : "verification failed");
  }

  if (typeof decoded === "string") {
    throw new InvalidTokenError("payload is not an object");
  }
  const { sub, email, name, role } = decoded;
  if (
    typeof sub !== "string" ||
    typeof email !== "string" ||
    typeof name !== "string" ||
    (role !== "RESPONDER" && role !== "ADMIN")
  ) {
    throw new InvalidTokenError("payload is missing required claims");
  }

  // Only `role` needs this — sub/email/name are typeof-narrowed to string
  // above, but the equality-based exclusion check above doesn't narrow
  // `role` away from `any` the same way, so this cast makes the already-
  // proven runtime shape visible to the type checker.
  return { sub, email, name, role: role as "RESPONDER" | "ADMIN" };
}
