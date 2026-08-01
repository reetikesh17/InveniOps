import { describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import { config } from "../../../../src/config/index.js";
import {
  signAccessToken,
  verifyAccessToken,
  InvalidTokenError,
  type AccessTokenPayload,
} from "../../../../src/services/auth/jwt.js";

const USER: AccessTokenPayload = {
  sub: "user-1",
  email: "operator@example.com",
  name: "Test Operator",
  role: "RESPONDER",
};

describe("jwt", () => {
  it("round-trips a signed token through verifyAccessToken", () => {
    const token = signAccessToken(USER);
    const decoded = verifyAccessToken(token);
    expect(decoded).toEqual(USER);
  });

  it("rejects an expired token", () => {
    const expired = jwt.sign(
      { email: USER.email, name: USER.name, role: USER.role },
      config.auth.jwtSecret,
      { subject: USER.sub, expiresIn: -1, algorithm: "HS256" },
    );
    expect(() => verifyAccessToken(expired)).toThrow(InvalidTokenError);
  });

  it("rejects a token signed with a different secret (tampered signature)", () => {
    const forged = jwt.sign(
      { email: USER.email, name: USER.name, role: USER.role },
      "a-completely-different-secret-nobody-configured",
      { subject: USER.sub, expiresIn: 900, algorithm: "HS256" },
    );
    expect(() => verifyAccessToken(forged)).toThrow(InvalidTokenError);
  });

  it("rejects a malformed token string", () => {
    expect(() => verifyAccessToken("not.a.jwt")).toThrow(InvalidTokenError);
  });

  it("rejects a validly-signed token missing required claims", () => {
    const incomplete = jwt.sign({ email: USER.email }, config.auth.jwtSecret, {
      subject: USER.sub,
      expiresIn: 900,
      algorithm: "HS256",
    });
    expect(() => verifyAccessToken(incomplete)).toThrow(InvalidTokenError);
  });

  it("rejects a token with an invalid role claim", () => {
    const badRole = jwt.sign(
      { email: USER.email, name: USER.name, role: "SUPERUSER" },
      config.auth.jwtSecret,
      { subject: USER.sub, expiresIn: 900, algorithm: "HS256" },
    );
    expect(() => verifyAccessToken(badRole)).toThrow(InvalidTokenError);
  });
});
