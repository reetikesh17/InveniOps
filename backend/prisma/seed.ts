#!/usr/bin/env node
// Seeds one demo account so a reviewer can log in without signing up first
// (see README.md's Quickstart for the credentials). Upserted by email, not
// created-then-fail — safe to run repeatedly (`npx prisma db seed`, or
// automatically after `prisma migrate dev`/`migrate reset`).
import { prisma } from "../src/repositories/clients.js";
import { hashPassword } from "../src/services/auth/passwordHasher.js";

// Documented in README.md's Quickstart — a fixed, publicly-known demo
// credential, not a real secret. Never reuse this pattern for a real
// deployment's accounts.
const DEMO_EMAIL = "demo@inveniops.dev";
const DEMO_PASSWORD = "Demo12345!";
const DEMO_NAME = "Demo Responder";

async function main(): Promise<void> {
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { passwordHash, name: DEMO_NAME },
    create: { email: DEMO_EMAIL, passwordHash, name: DEMO_NAME, role: "RESPONDER" },
  });

  console.log(`Seeded demo account: ${user.email} (role: ${user.role})`);
}

main()
  .catch((error: unknown) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
