# 0012 — Stateless JWT authentication, short-lived, no refresh token yet

**Status:** Accepted

## Context

The system had no identity: `StateTransition.actor` and RCA submissions recorded
whatever string a caller sent, and the frontend sourced that string from a freeform
"Acting as" text box. The audit trail was real and tested, but nothing behind it was
authenticated — anyone could claim to be anyone. This adds real login, scoped
deliberately as a supporting feature: signup, JWT-backed sessions, and protecting the
incident/analytics routes — not a rewrite, not a full IAM system.

## Decision

**Stateless JWT (HS256), signed with a required `JWT_SECRET`, no database-backed
session.** `requireAuth` middleware verifies the token's signature and expiry only —
no per-request database lookup — and attaches the decoded claims to `req.user`.
`GET /api/v1/auth/me` is the one route that pays for a fresh, canonical database read,
specifically so a role change or account deletion is visible there even though
`requireAuth` itself won't notice until the token expires.

**Access tokens are short-lived (15 minutes, `JWT_ACCESS_TOKEN_TTL_SECONDS`) and there
is no refresh-token flow.** This is stated scope, not a gap discovered later: a
refresh flow (rotating refresh tokens, a server-side revocation list) is real
additional surface — another table or a Redis-backed allowlist, rotation logic, a
second class of token to secure — that this pass deliberately didn't build. The short
TTL is the interim mitigation: a stolen token is only useful for 15 minutes. The cost
lands entirely on the frontend, honestly: a page reload always ends the session (see
below), and there's no silent re-authentication.

**Passwords are hashed with `bcryptjs`, not native `bcrypt`.** The backend's Docker
images are `node:20-alpine` with no build toolchain (`python3`/`make`/`g++`) installed
— native `bcrypt` needs those to compile its binding. `bcryptjs` is pure JS,
API-compatible, and needs zero Dockerfile changes for a feature that isn't on any hot
path (login is low-frequency, unlike signal ingestion).

**The frontend keeps the access token in memory only** (a `useState` inside
`AuthContext`), never `localStorage`/`sessionStorage`. A token in `localStorage` is
readable by any script that ever runs on the page, for as long as the token remains
valid, across tabs and reloads — a materially larger and longer exposure window than
"while this tab is open." The token is attached to requests via an explicit
`Authorization` header (see `lib/api.ts`), never a cookie, so there's no ambient
credential for CSRF to ride on — a cross-site form or `<img>` tag cannot make a
request carry it. This does **not** eliminate XSS as a risk: a live XSS payload
running in the page can still read the in-memory token and call any authenticated API
directly, the same way `AuthContext` itself can. In-memory storage narrows the
persistent-exposure window; it does not remove client-side script execution as an
attack surface. The real cost of this choice is that a page reload always loses the
session — consistent with, and made necessary by, no refresh-token flow existing to
silently re-establish it.

**Signal ingestion (`POST /api/v1/signals`, its `bulk-test` sibling) and the
infrastructure endpoints (`/health`, `/ready`, `/metrics`) stay public — no
`requireAuth`.** This is a real, separate design decision, not an oversight: ingestion
is machine-to-machine (monitoring agents posting signals, not a logged-in human at a
browser), and locking it down needs a different mechanism — API keys or service
credentials issued to those agents — not a human-login JWT. Building that wasn't in
scope here; the boundary is documented at the `app.ts` mount point so it reads as a
decision the next time someone looks at it, not a hole.

## Consequences

- Every protected route needs a valid, unexpired `Authorization: Bearer <token>` —
  `workitemsRouter`, `analyticsRouter`, and the incident SSE stream (which can't set a
  header, so it authenticates via a `?token=` query param instead, verified the same
  way inline — see `incidentStream.ts`).
- `StateTransition.actor` and the RCA submitter are now the authenticated caller's
  email — sourced from `req.user.email`, not a client-supplied field. The request body
  schemas for transition/RCA no longer accept (or need) an `actor` field at all.
- Role (`RESPONDER` | `ADMIN`) is stored and returned by `GET /me`, but nothing yet
  enforces it — any authenticated user can act on any incident. Role-gated actions are
  a natural, separate follow-up, not attempted here.
- A demo account is seeded (`backend/prisma/seed.ts`, `npx prisma db seed`) so a
  reviewer can log in without signing up first — credentials in README.md's
  Quickstart, clearly marked as a demo credential, not a real secret.

## Alternatives considered

- **Server-side sessions (a `sessions` table or Redis-backed session store), cookie-based.**
  Rejected for this scope: sessions need their own storage, expiry sweeping, and CSRF
  protection (cookies are an ambient credential, unlike a header the client attaches
  explicitly) — real infrastructure for a feature explicitly scoped as "supporting,"
  not the system's primary concern. JWT's statelessness also means `requireAuth`
  never pays a database round trip on the hot path, which a session lookup would.
- **A refresh-token flow from the start.** Rejected for this pass, explicitly, not
  silently dropped — see "Decision" above. The short access-token TTL is the stated
  interim tradeoff.
- **Native `bcrypt`.** Rejected only for the Dockerfile/build-toolchain cost described
  above — `bcryptjs` is the same algorithm, same cost-factor semantics, slower per-hash
  but irrelevant at login's actual request volume.
- **Token in `localStorage`.** Rejected — see "Decision" above for the exposure-window
  reasoning. Would have made "stay logged in across a reload" free, at a real,
  persistent XSS-readable-storage cost this system chose not to accept.
- **Locking down signal ingestion behind the same `requireAuth`.** Rejected — ingestion
  callers are monitoring agents, not humans with a login; forcing them through a
  human-auth flow would be the wrong mechanism even if it were in scope. API keys are
  the right tool for that boundary, left as explicit future work.
