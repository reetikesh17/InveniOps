import { describe, expect, it, vi } from "vitest";
import { Prisma, type User } from "@prisma/client";
import { AuthService, type UserStore } from "../../../../src/services/auth/authService.js";
import { hashPassword } from "../../../../src/services/auth/passwordHasher.js";

const CLIENT_VERSION = "5.16.1";

function duplicateEmailError(): Prisma.PrismaClientKnownRequestError {
  // Prisma reports the target of a plain single-field @unique as the
  // schema field name — verified against the real error shape in
  // tests/integration/api/auth.test.ts, not assumed.
  return new Prisma.PrismaClientKnownRequestError("mock P2002", {
    code: "P2002",
    clientVersion: CLIENT_VERSION,
    meta: { target: ["email"] },
  });
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "operator@example.com",
    passwordHash: "unused-in-these-tests",
    name: "Test Operator",
    role: "RESPONDER",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("AuthService.signup", () => {
  it("creates a user and returns a token on success", async () => {
    const create = vi.fn((input: { email: string; passwordHash: string; name: string }) =>
      Promise.resolve(
        makeUser({ email: input.email, name: input.name, passwordHash: input.passwordHash }),
      ),
    );
    const users: UserStore = { create, findByEmail: vi.fn() };
    const service = new AuthService(users);

    const outcome = await service.signup(
      "operator@example.com",
      "correct-horse-battery",
      "Test Operator",
    );

    expect(outcome.outcome).toBe("created");
    if (outcome.outcome !== "created") throw new Error("expected created");
    expect(outcome.user.email).toBe("operator@example.com");
    expect(outcome.user.name).toBe("Test Operator");
    expect(typeof outcome.token).toBe("string");
    expect(outcome.token.split(".")).toHaveLength(3);
    // The public user never carries the password hash.
    expect(outcome.user).not.toHaveProperty("passwordHash");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ email: "operator@example.com", name: "Test Operator" }),
    );
  });

  it("hashes the password before storing it — never stores the plaintext", async () => {
    let storedHash = "";
    const users: UserStore = {
      create: vi.fn((input) => {
        storedHash = input.passwordHash;
        return Promise.resolve(makeUser({ passwordHash: input.passwordHash }));
      }),
      findByEmail: vi.fn(),
    };
    const service = new AuthService(users);

    await service.signup("operator@example.com", "correct-horse-battery", "Test Operator");

    expect(storedHash).not.toBe("correct-horse-battery");
    expect(storedHash.startsWith("$2")).toBe(true); // bcrypt hash prefix
  });

  it("returns duplicate_email on a unique-constraint violation, not a thrown error", async () => {
    const users: UserStore = {
      create: vi.fn().mockRejectedValue(duplicateEmailError()),
      findByEmail: vi.fn(),
    };
    const service = new AuthService(users);

    const outcome = await service.signup("taken@example.com", "correct-horse-battery", "Someone");

    expect(outcome).toEqual({ outcome: "duplicate_email" });
  });

  it("rethrows an unrelated database error rather than misreporting it as duplicate_email", async () => {
    const users: UserStore = {
      create: vi.fn().mockRejectedValue(new Error("connection reset")),
      findByEmail: vi.fn(),
    };
    const service = new AuthService(users);

    await expect(
      service.signup("operator@example.com", "correct-horse-battery", "Test"),
    ).rejects.toThrow("connection reset");
  });
});

describe("AuthService.login", () => {
  it("succeeds with the correct password and returns a token", async () => {
    const passwordHash = await hashPassword("correct-horse-battery");
    const users: UserStore = {
      create: vi.fn(),
      findByEmail: vi.fn().mockResolvedValue(makeUser({ passwordHash })),
    };
    const service = new AuthService(users);

    const outcome = await service.login("operator@example.com", "correct-horse-battery");

    expect(outcome.outcome).toBe("success");
    if (outcome.outcome !== "success") throw new Error("expected success");
    expect(outcome.user.email).toBe("operator@example.com");
    expect(typeof outcome.token).toBe("string");
  });

  it("rejects the wrong password with invalid_credentials", async () => {
    const passwordHash = await hashPassword("correct-horse-battery");
    const users: UserStore = {
      create: vi.fn(),
      findByEmail: vi.fn().mockResolvedValue(makeUser({ passwordHash })),
    };
    const service = new AuthService(users);

    const outcome = await service.login("operator@example.com", "wrong-password");

    expect(outcome).toEqual({ outcome: "invalid_credentials" });
  });

  it("rejects an unknown email with invalid_credentials — same outcome shape as a wrong password", async () => {
    const users: UserStore = { create: vi.fn(), findByEmail: vi.fn().mockResolvedValue(null) };
    const service = new AuthService(users);

    const outcome = await service.login("nobody@example.com", "whatever-password");

    expect(outcome).toEqual({ outcome: "invalid_credentials" });
  });

  it("still runs a bcrypt comparison for an unknown email, so it isn't measurably faster than a wrong-password rejection", async () => {
    const users: UserStore = { create: vi.fn(), findByEmail: vi.fn().mockResolvedValue(null) };
    const service = new AuthService(users);
    const knownUsers: UserStore = {
      create: vi.fn(),
      findByEmail: vi.fn().mockResolvedValue(makeUser({ passwordHash: await hashPassword("x") })),
    };
    const serviceWithKnownEmail = new AuthService(knownUsers);

    const unknownStart = process.hrtime.bigint();
    await service.login("nobody@example.com", "whatever-password");
    const unknownMs = Number(process.hrtime.bigint() - unknownStart) / 1e6;

    const wrongPasswordStart = process.hrtime.bigint();
    await serviceWithKnownEmail.login("operator@example.com", "wrong-password");
    const wrongPasswordMs = Number(process.hrtime.bigint() - wrongPasswordStart) / 1e6;

    // Both paths run a real bcrypt comparison — same order of magnitude,
    // not "unknown email returns near-instantly." A loose bound (not an
    // exact one) since bcrypt timing has real jitter under test-runner load.
    expect(unknownMs).toBeGreaterThan(wrongPasswordMs / 5);
  });
});
