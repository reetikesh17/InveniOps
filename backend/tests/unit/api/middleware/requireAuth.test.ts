import { describe, expect, it, vi, type Mock } from "vitest";
import type { Request, Response } from "express";
import {
  requireAuth,
  type AuthenticatedRequest,
  type UnauthorizedBody,
} from "../../../../src/api/middleware/requireAuth.js";
import { signAccessToken } from "../../../../src/services/auth/jwt.js";

function makeReq(header?: string): Request {
  return {
    header: (name: string) => (name.toLowerCase() === "authorization" ? header : undefined),
  } as unknown as Request;
}

function makeRes(): {
  res: Response<UnauthorizedBody>;
  status: Mock<[number], { json: Mock<[UnauthorizedBody], void> }>;
  json: Mock<[UnauthorizedBody], void>;
} {
  const json: Mock<[UnauthorizedBody], void> = vi.fn();
  const status: Mock<[number], { json: typeof json }> = vi.fn(() => ({ json }));
  return { res: { status } as unknown as Response<UnauthorizedBody>, status, json };
}

const VALID_USER = {
  sub: "user-1",
  email: "operator@example.com",
  name: "Operator",
  role: "RESPONDER" as const,
};

describe("requireAuth", () => {
  it("rejects a missing Authorization header with 401", () => {
    const next = vi.fn();
    const { res, status, json } = makeRes();

    requireAuth(makeReq(undefined), res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: "unauthorized" }));
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a header that isn't 'Bearer <token>' with 401", () => {
    const next = vi.fn();
    const { res, status } = makeRes();

    requireAuth(makeReq("Basic dXNlcjpwYXNz"), res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects an invalid token with 401", () => {
    const next = vi.fn();
    const { res, status } = makeRes();

    requireAuth(makeReq("Bearer not-a-real-token"), res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("attaches the decoded user to req and calls next() for a valid token", () => {
    const token = signAccessToken(VALID_USER);
    const next = vi.fn();
    const { res, status } = makeRes();
    const req = makeReq(`Bearer ${token}`);

    requireAuth(req, res, next);

    expect(status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect((req as AuthenticatedRequest).user).toEqual(VALID_USER);
  });
});
