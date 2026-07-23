# IMS — Incident Management System

Assignment spec: @docs/assignment.md

## Stack (locked — do not substitute)
- Backend: Node.js 20 + TypeScript + Express (strict mode, no `any`)
- RDBMS: PostgreSQL 16 via Prisma (source of truth: work items, RCA)
- NoSQL: MongoDB 7 (raw signal audit log)
- Cache: Redis 7 (dashboard hot-path state)
- Queue: BullMQ (async signal processing)
- Frontend: React 18 + TypeScript + Vite + Tailwind
- Tests: Vitest
- Orchestration: Docker Compose

## Non-negotiable design constraints
- Ingestion must NEVER block on persistence. Accept → buffer → ack → process async.
- Work item state transitions use the State pattern, not if/else chains.
- Alert severity selection uses the Strategy pattern.
- A work item cannot reach CLOSED without a complete RCA. Enforce in the domain
  layer, not just the API layer.
- All DB writes to Postgres go through a retry wrapper with exponential backoff.
- Transitions that touch multiple tables run inside a transaction.

## Conventions
- Layered structure: routes → services → repositories. No DB calls in routes.
- Domain logic lives in `src/domain/` and must be unit-testable with zero I/O.
- Errors: typed error classes, never throw bare strings.
- Every exported function gets an explicit return type.

## Working rules
- Before multi-file changes, propose a plan and wait for approval.
- Do not implement future phases. Stick to the scope of the current prompt.
- After each task, list which files changed and what to verify manually.