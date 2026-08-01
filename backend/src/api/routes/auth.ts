import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { config } from "../../config/index.js";
import { prisma, redis } from "../../repositories/clients.js";
import { PostgresUserRepository } from "../../repositories/postgres/userRepository.js";
import { AuthService, type PublicUser } from "../../services/auth/authService.js";
import {
  checkTokenBuckets,
  secondsUntilAvailable,
  type TokenBucketResult,
} from "../../rateLimit/tokenBucket.js";
import { logger } from "../../utils/logger.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/requireAuth.js";

const MIN_PASSWORD_LENGTH = 8;

const signupBodySchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  // Deliberately simple for this scope — length only, not a full
  // complexity policy (mixed case / digits / symbols). See docs/decisions/.
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `password must be at least ${MIN_PASSWORD_LENGTH} characters`),
  name: z.string().trim().min(1).max(200),
});

const loginBodySchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

interface ErrorResponseBody {
  readonly error: string;
  readonly message: string;
  readonly errors?: readonly { readonly field: string; readonly message: string }[];
}

interface AuthResponseBody {
  readonly user: PublicUser;
  readonly token: string;
}

function zodValidationErrors(
  error: z.ZodError,
): { readonly field: string; readonly message: string }[] {
  return error.issues.map((issue) => ({
    field: issue.path.join(".") || "(root)",
    message: issue.message,
  }));
}

/**
 * Same fail-open posture as signals.ts's checkRateLimitFailOpen, adapted
 * for two independently-keyed buckets (IP and email) instead of (IP and
 * global) — checkTokenBuckets doesn't care what its two keys *mean*, so
 * this reuses it rather than duplicating the Lua-scripted atomic
 * refill-and-debit logic. A Redis outage must not lock everyone out of
 * logging in; the real defense against brute-forcing here is bcrypt's own
 * cost, not this rate limit.
 */
async function checkLoginRateLimitFailOpen(ip: string, email: string): Promise<TokenBucketResult> {
  const params = {
    ipKey: `ratelimit:login:ip:${ip}`,
    globalKey: `ratelimit:login:email:${email}`,
    ip: config.auth.rateLimit.ip,
    global: config.auth.rateLimit.email,
    cost: 1,
  };
  try {
    return await checkTokenBuckets(redis, params);
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      "login rate limit check failed (Redis unreachable?) — failing open",
    );
    return {
      allowed: true,
      limitedBy: null,
      ip: { remaining: params.ip.capacity, capacity: params.ip.capacity },
      global: { remaining: params.global.capacity, capacity: params.global.capacity },
    };
  }
}

const userRepository = new PostgresUserRepository(prisma);
const authService = new AuthService(userRepository);

async function handleSignup(
  req: Request,
  res: Response<AuthResponseBody | ErrorResponseBody>,
): Promise<void> {
  const parsed = signupBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "validation_error",
      message: "invalid signup request",
      errors: zodValidationErrors(parsed.error),
    });
    return;
  }

  const outcome = await authService.signup(
    parsed.data.email,
    parsed.data.password,
    parsed.data.name,
  );
  if (outcome.outcome === "duplicate_email") {
    res
      .status(409)
      .json({ error: "duplicate_email", message: "an account with this email already exists" });
    return;
  }

  res.status(201).json({ user: outcome.user, token: outcome.token });
}

async function handleLogin(
  req: Request,
  res: Response<AuthResponseBody | ErrorResponseBody>,
): Promise<void> {
  const parsed = loginBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "validation_error",
      message: "invalid login request",
      errors: zodValidationErrors(parsed.error),
    });
    return;
  }

  const { email, password } = parsed.data;
  const rateLimitResult = await checkLoginRateLimitFailOpen(req.ip ?? "unknown", email);
  if (!rateLimitResult.allowed) {
    const limitedByIp = rateLimitResult.limitedBy === "ip";
    const limitedBucket = limitedByIp ? rateLimitResult.ip : rateLimitResult.global;
    const refillPerSecond = limitedByIp
      ? config.auth.rateLimit.ip.refillPerSecond
      : config.auth.rateLimit.email.refillPerSecond;
    res.setHeader("Retry-After", String(secondsUntilAvailable(limitedBucket, refillPerSecond, 1)));
    res
      .status(429)
      .json({ error: "rate_limited", message: "too many login attempts, try again shortly" });
    return;
  }

  // Same status, message, and body shape for "wrong password" and "no such
  // account" — the whole point is that a caller cannot tell which one it
  // was, so this doesn't branch on the outcome's internals at all.
  const outcome = await authService.login(email, password);
  if (outcome.outcome === "invalid_credentials") {
    res.status(401).json({ error: "invalid_credentials", message: "invalid email or password" });
    return;
  }

  res.status(200).json({ user: outcome.user, token: outcome.token });
}

async function handleMe(
  req: AuthenticatedRequest,
  res: Response<PublicUser | ErrorResponseBody>,
): Promise<void> {
  const user = await userRepository.findById(req.user.sub);
  if (!user) {
    res.status(404).json({ error: "not_found", message: "user no longer exists" });
    return;
  }
  res.status(200).json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt,
  });
}

/**
 * With no server-side session store, there is nothing to invalidate here —
 * this is not a placeholder standing in for a missing feature, it's the
 * correct behavior for a stateless-JWT design (see jwt.ts). The endpoint
 * exists for API symmetry and as the place a future token-blocklist would
 * hook in; the real effect of "logging out" is the frontend discarding its
 * in-memory token (see frontend/src/hooks/useAuth.tsx).
 */
function handleLogout(_req: AuthenticatedRequest, res: Response<{ readonly ok: true }>): void {
  res.status(200).json({ ok: true });
}

export const authRouter = Router();

authRouter.post(
  "/signup",
  (req: Request, res: Response<AuthResponseBody | ErrorResponseBody>, next: NextFunction): void => {
    handleSignup(req, res).catch(next);
  },
);

authRouter.post(
  "/login",
  (req: Request, res: Response<AuthResponseBody | ErrorResponseBody>, next: NextFunction): void => {
    handleLogin(req, res).catch(next);
  },
);

authRouter.get(
  "/me",
  requireAuth,
  (req: Request, res: Response<PublicUser | ErrorResponseBody>, next: NextFunction): void => {
    handleMe(req as AuthenticatedRequest, res).catch(next);
  },
);

authRouter.post(
  "/logout",
  requireAuth,
  (req: Request, res: Response<{ readonly ok: true }>): void => {
    handleLogout(req as AuthenticatedRequest, res);
  },
);
