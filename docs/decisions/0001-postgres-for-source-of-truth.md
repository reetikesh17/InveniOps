# 0001 — PostgreSQL as the source of truth for work items and RCA

**Status:** Accepted

## Context

The work-item lifecycle (`OPEN → INVESTIGATING → RESOLVED → CLOSED`) must transition
atomically with its audit trail, and a transition to `CLOSED` must be gated on a
complete RCA record existing — never a partially-written one. That means at least two
tables (the work item and its state-transition log, sometimes the RCA record too) need
to change together with no observable partial-write state, and the RCA "completeness"
check needs to be cheap and unambiguous.

## Decision

PostgreSQL 16, accessed via Prisma, is the source of truth for `WorkItem`, `RcaRecord`,
and `StateTransition`. Every multi-table write runs inside a single database
transaction (Prisma `$transaction`). RCA completeness is enforced at the schema level,
not just in application code: every `RcaRecord` field is `NOT NULL`, so "is the RCA
complete" reduces to "does a row exist for this work item" rather than checking N
nullable columns.

## Consequences

- Real ACID transactions and relational integrity (foreign keys, a unique constraint
  enforcing the 1:1 WorkItem↔RcaRecord relationship) come from the database itself,
  not from application-level discipline.
- Schema evolution requires a migration step (Prisma), which is more ceremony than a
  schemaless store for early iteration.
- The dashboard's live view must not query Postgres on every refresh — that's what the
  Redis hot-path cache exists for (see [docs/architecture.md](../architecture.md)).
- Postgres's write throughput becomes the ceiling for state-transition writes
  specifically — but not for raw signal ingestion, which never touches Postgres.

## Alternatives considered

- **MongoDB for everything.** Rejected — no multi-document ACID transactions as
  ergonomic as Postgres's, and this data is genuinely relational (1:1 RCA, 1:many
  transitions per work item).
- **Event-sourced store** (append-only event log as the sole source of truth, current
  state derived by replay). Rejected as unnecessary complexity for this scope — the
  `StateTransition` table already gives an audit trail without full event-sourcing
  machinery (snapshotting, replay, etc.).
- **DynamoDB / single-table NoSQL.** Rejected for the same transactional-integrity gap
  as MongoDB, plus a worse fit for local Docker Compose development.
