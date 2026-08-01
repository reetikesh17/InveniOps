import type { NextFunction, Request, Response } from "express";
import {
  verifyAccessToken,
  InvalidTokenError,
  type AuthenticatedUser,
} from "../../services/auth/jwt.js";

/** The shape every protected route handler's `req` actually has, once `requireAuth` has run. Route handlers behind this middleware should type their `req` parameter as this, not the bare `Request`. */
export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

export interface UnauthorizedBody {
  readonly error: string;
  readonly message: string;
}

const BEARER_PREFIX = "Bearer ";

/**
 * Stateless: verifies the JWT's signature and expiry only, no database
 * lookup — this runs on every protected request, so keeping it a pure
 * signature check keeps that cheap. The tradeoff is real and bounded: a
 * token for a since-deleted or since-demoted user stays "valid" here until
 * it naturally expires (config.auth.accessTokenTtlSeconds, default 15
 * minutes) — GET /api/v1/auth/me is the one place that pays for a fresh,
 * canonical database read instead of trusting the token's claims. See
 * docs/decisions/ for the full reasoning.
 */
export function requireAuth(
  req: Request,
  res: Response<UnauthorizedBody>,
  next: NextFunction,
): void {
  const header = req.header("authorization");
  if (!header?.startsWith(BEARER_PREFIX)) {
    res
      .status(401)
      .json({ error: "unauthorized", message: "missing or malformed Authorization header" });
    return;
  }

  const token = header.slice(BEARER_PREFIX.length);
  try {
    (req as AuthenticatedRequest).user = verifyAccessToken(token);
  } catch (error) {
    const message = error instanceof InvalidTokenError ? error.message : "invalid token";
    res.status(401).json({ error: "unauthorized", message });
    return;
  }

  next();
}
