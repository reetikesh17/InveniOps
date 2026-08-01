import { describe, expect, it } from "vitest";
import {
  hashPassword,
  verifyPassword,
  DUMMY_PASSWORD_HASH,
} from "../../../../src/services/auth/passwordHasher.js";

describe("passwordHasher", () => {
  it("hashes a password to something other than the plaintext", async () => {
    const hash = await hashPassword("correct-horse-battery");
    expect(hash).not.toBe("correct-horse-battery");
    expect(hash.startsWith("$2")).toBe(true);
  });

  it("verifyPassword accepts the correct plaintext against its own hash", async () => {
    const hash = await hashPassword("correct-horse-battery");
    await expect(verifyPassword("correct-horse-battery", hash)).resolves.toBe(true);
  });

  it("verifyPassword rejects the wrong plaintext", async () => {
    const hash = await hashPassword("correct-horse-battery");
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });

  it("DUMMY_PASSWORD_HASH is a real bcrypt hash nothing legitimately hashes to", async () => {
    expect(DUMMY_PASSWORD_HASH.startsWith("$2")).toBe(true);
    await expect(verifyPassword("correct-horse-battery", DUMMY_PASSWORD_HASH)).resolves.toBe(false);
  });
});
