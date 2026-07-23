# Architecture

## Layered structure

The backend is layered `routes → services → repositories`, with a separate `domain/`
that neither layer is allowed to skip around:

- **`api/`** — Express routes and middleware. Parses/validates HTTP input, calls a
  service, shapes the HTTP response. No DB or queue calls here.
- **`services/`** — orchestration. Coordinates one or more repositories and domain
  objects to carry out a use case (e.g., "ingest a signal," "submit an RCA").
- **`repositories/`** — the only layer that talks to Postgres, Mongo, or Redis.
- **`domain/`** — pure business logic: the work-item state machine, RCA completeness
  validation, the debounce decision. Zero I/O.

`domain/` is isolated from I/O for one reason: it's where the rules that must never be
silently bypassed live — "CLOSED requires a complete RCA," "a transition must follow
OPEN → INVESTIGATING → RESOLVED → CLOSED," "100 signals in 10s collapse to one Work
Item." If those rules were expressed as conditionals scattered across route handlers,
a second caller (a worker, a future CLI, a bulk-import script) could reach CLOSED
without ever passing through the check. Because domain code takes no dependency on
Express, Prisma, or BullMQ, it can be exhaustively unit-tested — every transition,
every malformed RCA, every debounce edge case — without a running database, and the
same domain object is reused by every caller instead of being re-implemented per entry
point. It's also what makes the State pattern (work-item lifecycle) and Strategy
pattern (alert severity selection) practical: both are plain objects implementing an
interface, defined once in `domain/`, and swapping or extending one doesn't touch a
route, a Prisma call, or a worker.

## Three-store split

| Store | Holds | Why not the others |
|---|---|---|
| **PostgreSQL** (`work_items`, `rca_records`, `state_transitions`) | The source of truth. Work item lifecycle, RCA records, the transition audit trail. | Needs real multi-row ACID transactions (a state transition + its audit row must commit together) and referential integrity (RCA is 1:1 with its work item). Mongo/Redis don't give this as ergonomically. |
| **MongoDB** (`signals`) | The raw, high-volume signal audit log — arbitrary payload shape, one document per signal, linked to a work item once debounced. | Schemaless and cheap to write at burst volume (up to 10k/sec); putting this in Postgres would couple audit-log write load to the transactional store's I/O — the exact coupling backpressure handling is meant to avoid. |
| **Redis** | Dashboard hot-path state (active-incident list, per-incident summary) and the BullMQ queue. | Sub-millisecond reads for a UI that refreshes constantly; Postgres could serve the same data but at a cost this system doesn't need to pay on every poll. |

Current status: connections to all three exist and are health-checked (`GET /health`).
The concrete Postgres schema (fields, indexes, enums) has been designed — see
[docs/decisions/](decisions/) — but is not yet migrated; `prisma/schema.prisma` still
holds only a placeholder model.

## Write path vs. read path

**Write path:** a signal source posts to the Ingestion API, which assigns a `signalId`,
buffers the signal in memory, and acks the caller — before anything touches a database.
The buffer holds signals for the debounce window; on flush, a job goes onto the BullMQ
queue. A worker dequeues the job, writes the raw document to Mongo, and — inside one
Postgres transaction — creates or updates the Work Item and appends a `StateTransition`
row. The worker then write-throughs the affected fields into Redis's dashboard cache
in the same flow.

**Read path:** the dashboard's Live Feed reads Redis's active-incident sorted set
directly — no Postgres round-trip on refresh. Incident Detail reads Redis for the
cached summary and Mongo for the linked raw signals. On a cache miss (cold start, TTL
expiry, a Redis flush), the read falls back to Postgres and repopulates Redis
(cache-aside), rather than the dashboard ever querying Postgres on the common path.

The two paths only meet at the stores themselves — nothing on the read side blocks on
or waits for the write side, which is what lets ingestion keep accepting signals even
if a worker, Mongo, or Postgres is momentarily behind.
