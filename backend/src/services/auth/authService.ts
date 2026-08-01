import type { User } from "@prisma/client";
import type { CreateUserInput } from "../../repositories/postgres/userRepository.js";
import { isUniqueConstraintViolation } from "../../repositories/postgres/prismaErrors.js";
import { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH } from "./passwordHasher.js";
import { signAccessToken } from "./jwt.js";

/** The narrow slice of PostgresUserRepository AuthService actually needs — same dependency-inversion convention as WorkflowService's WorkItemWorkflowStore, for the same reason: a plain mock satisfies this in unit tests, no real Postgres required. */
export interface UserStore {
  create(input: CreateUserInput): Promise<User>;
  findByEmail(email: string): Promise<User | null>;
}

export interface PublicUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: User["role"];
  readonly createdAt: Date;
}

function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt,
  };
}

export type SignupOutcome =
  | { readonly outcome: "created"; readonly user: PublicUser; readonly token: string }
  | { readonly outcome: "duplicate_email" };

export type LoginOutcome =
  | { readonly outcome: "success"; readonly user: PublicUser; readonly token: string }
  | { readonly outcome: "invalid_credentials" };

/**
 * Outcome objects, not thrown errors, for expected business results — same
 * convention as WorkflowService.transitionWorkItem/submitIncidentRca. The
 * route layer switches on `outcome` to pick an HTTP status; nothing here
 * throws for a case a caller is expected to handle.
 */
export class AuthService {
  constructor(private readonly users: UserStore) {}

  /**
   * Email validation/password-strength checks already happened in the
   * route (zod) before this is called — this assumes valid input, same as
   * WorkflowService assumes its callers already validated the request
   * shape. Duplicate detection is create-then-catch-P2002, not
   * find-then-create: a pre-check has a TOCTOU race two concurrent
   * signups for the same email could both pass, same reasoning as the
   * debouncer's own create-conflict handling (see debouncer.ts).
   */
  async signup(email: string, password: string, name: string): Promise<SignupOutcome> {
    const passwordHash = await hashPassword(password);
    try {
      const user = await this.users.create({ email, passwordHash, name });
      const publicUser = toPublicUser(user);
      const token = signAccessToken({
        sub: publicUser.id,
        email: publicUser.email,
        name: publicUser.name,
        role: publicUser.role,
      });
      return { outcome: "created", user: publicUser, token };
    } catch (error) {
      // Prisma reports the target of a plain single-field @unique as the
      // schema field name ("email"), not the physical Postgres index name
      // — unlike work_items' partial unique index (raw-SQL migration,
      // reported by its real index name), which is why that call site
      // checks a different string. Verified against the real error shape,
      // not assumed.
      if (isUniqueConstraintViolation(error, "email")) {
        return { outcome: "duplicate_email" };
      }
      throw error;
    }
  }

  /**
   * Always runs a bcrypt comparison, even when the email doesn't exist —
   * against DUMMY_PASSWORD_HASH in that case — so response timing can't be
   * used to distinguish "no such account" from "wrong password" on top of
   * the 401 body already not distinguishing them.
   */
  async login(email: string, password: string): Promise<LoginOutcome> {
    const user = await this.users.findByEmail(email);
    const passwordMatches = await verifyPassword(
      password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );

    if (!user || !passwordMatches) {
      return { outcome: "invalid_credentials" };
    }

    const publicUser = toPublicUser(user);
    const token = signAccessToken({
      sub: publicUser.id,
      email: publicUser.email,
      name: publicUser.name,
      role: publicUser.role,
    });
    return { outcome: "success", user: publicUser, token };
  }
}
