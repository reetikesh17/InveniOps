import type { PrismaClient, User } from "@prisma/client";
import { withPostgresRetry } from "./withPostgresRetry.js";

export interface CreateUserInput {
  readonly email: string;
  readonly passwordHash: string;
  readonly name: string;
}

export class PostgresUserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** On the retry wrapper: this is a write (signup), same convention as every other Postgres write in this codebase. */
  async create(input: CreateUserInput): Promise<User> {
    return withPostgresRetry(() =>
      this.prisma.user.create({
        data: {
          email: input.email,
          passwordHash: input.passwordHash,
          name: input.name,
        },
      }),
    );
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }
}
