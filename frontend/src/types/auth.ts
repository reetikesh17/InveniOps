// Mirrors backend src/services/auth/authService.ts's PublicUser — never
// carries a password hash, by construction on the server side.
export type UserRole = "RESPONDER" | "ADMIN";

export interface User {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: UserRole;
  readonly createdAt: string;
}
