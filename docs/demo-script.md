# Demo script — five minutes, live

A walkthrough to run in an interview: exact commands, what to point at, and one
sentence to say at each step. Times are cumulative and assume the stack is already
built (`docker compose build` done ahead of time) — only `up` happens on camera.
Companion to the recorded 45-second cut in the [README's Demo section](../README.md#demo),
which is this same scenario, pre-run.

Two moments are worth slowing down for — they're the two things a screenshot can't
show: debouncing collapsing a burst in real time, and the console line proving the
process is still alive while a dependency is down. Everything else can move fast.

## Before you start

- `docker compose up -d` from the repo root — Postgres, Mongo, Redis, backend,
  frontend. Give it ~10s for the health checks to go green (`docker compose ps`).
- A second terminal, already `cd`'d to `scripts/scenarios/`, with `npm install` already
  run once beforehand (silent on camera otherwise).
- Browser open to `http://localhost:5173`, dashboard visible, nothing seeded yet —
  an empty Live Feed is the correct starting state.

## 0:00 — What this is (25s)

**Say:** "This is an incident management system for a distributed stack — it ingests
error signals from things like a database or a cache, collapses repeated noise from
the same failure into one trackable incident, routes it to the right severity, and
won't let you close it without a root cause."

**Point at:** the empty Live Feed and the header's live severity counts (all zero).

No command yet — just orient the viewer before the screen gets busy.

## 0:25 — Seed a real cascading failure (50s)

**Command** (second terminal):

```bash
npm run cascading-failure -- --speed 30
```

**Say while it runs:** "This replays a canned failure — an RDBMS connection pool
exhausting, which cascades into API timeouts, an MCP host failure, and a cache miss
storm — over the real HTTP ingestion API, at 30x speed. Nothing here is mocked in the
UI; every signal goes through the same buffer → debounce → persist → alert pipeline a
real monitoring agent would hit."

### ⏸ Pause here — debouncing

The script's own output prints the proof directly — let it finish, then point at this
line before moving on:

```
✓ debouncing: 86 RDBMS signals collapsed into exactly 1 work item (...)
  — enforced by the Postgres partial unique index, not just the Redis fast path
```

**Say:** "86 separate error signals for the same component, and exactly one work item
was created — that's [docs/backpressure.md](backpressure.md)'s debounce logic. A Redis
session collapses repeats fast, but the thing that actually *guarantees* only one
work item exists is a partial unique index in Postgres, not the Redis check — see
[ADR 0010](decisions/0010-redis-fast-path-with-postgres-backstop-for-debouncing.md). If
two requests raced past the Redis check simultaneously, the database still only lets
one insert win."

**Point at:** switch to the browser — the Live Feed now shows a handful of incidents,
not 314 (the total signal count the script just sent). Severity is mixed — P0 down to
P3 — because the alerting Strategy's severity floor corrected the RDBMS incident's
under-reported P1 up to P0 (also visible in the terminal output, one line above the
debounce proof).

## 1:15 — Open an incident, transition it (60s)

**Point at:** click the P0/P1 `DB_PRIMARY_01` row.

**Say:** "This is the incident detail page — component, first-seen time, and every
raw signal linked to it from Mongo, paginated because a real incident can have
thousands." Click one signal row open. "Each one keeps its full original payload —
this is the audit log side of the system, kept separate from the structured work item
in Postgres."

**Command:** click **Start investigating**, then **Mark resolved**.

**Say while clicking:** "State transitions go through the State pattern, not an
if/else chain — [docs/design-patterns.md](design-patterns.md#state--work-item-lifecycle)
has the actual class per state. Concurrency is optimistic, not locked — two people
racing to transition the same incident, one gets a 409, proven under
[50 simultaneous requests in `concurrency.test.ts`](decisions/0011-optimistic-concurrency-for-state-transitions.md)."

**Point at:** the transition history section — each entry has who made it and when.

## 2:15 — Reject a close, then submit a real RCA (60s)

**Command:** with the form empty, click **Submit RCA and close incident**.

**Say:** "This is the mandatory-RCA requirement — enforced in the domain layer,
not just the API. The form won't even send an incomplete request; the backend has the
same rule if you skip the client." Point at the inline field errors.

**Command:** fill in a root cause category, description, fix applied, and prevention
steps (real sentences, not placeholder text — the backend rejects anything under 10
characters). Point at the **MTTR to be recorded** figure at the top of the form before
submitting — it's live, ticking every second, computed from the incident's actual
first-signal timestamp.

**Command:** click **Submit RCA and close incident**.

**Say:** "And now it's closed, with a real computed MTTR — first signal to RCA
submission, not a fabricated number."

## 3:15 — Analytics (45s)

**Point at:** nav to **Analytics**.

**Say:** "Everything here reads from a MongoDB time-series aggregation sink, not a
live query over every signal — [ADR 0005](decisions/0005-mongodb-timeseries-for-aggregation.md)
has the reasoning. Incident volume by component, MTTR trend with a rolling average,
and worst-first component health, ranked by open incidents then slowest repair."

**Point at:** the **System status** panel at the top of the same page — dependency
latency, ingestion buffer fill, queue depth. "This is the same `/health` endpoint the
assignment asked for, rendered instead of just returned as JSON."

## 4:00 — Stay responsive while Mongo is down (45s)

**Command:**

```bash
docker pause inveniops-ims-mongo-1
```

**Say as you run it:** "This freezes the Mongo process entirely — not a graceful
shutdown, a frozen container, closer to a real outage than `docker stop` would be."

**Command**, second terminal:

```bash
curl -i -X POST http://localhost:3000/api/v1/signals \
  -H "Content-Type: application/json" \
  -d '[{"signalId":"demo-mongo-outage-1","componentId":"DEMO_01","componentType":"API","severity":"P2","rawPayload":{},"occurredAt":"'"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"'"}]'
```

### ⏸ Pause here — still responsive

**Point at:** the `202` and the response body, back within the browser at the System
status panel — MongoDB now shows **down**, everything else stays up, and the
ingestion buffer fill starts climbing (signals are being accepted and buffered, just
not persisted yet).

**Say:** "The signal was still accepted in well under the same latency budget as
before — ingestion never blocks on persistence, by design. It's sitting in the buffer
now, and it'll drain the instant Mongo comes back, nothing is lost. This exact
scenario is [`slowPersistence.test.ts`](../backend/tests/chaos/README.md) in the
chaos suite — not just what I'm claiming live, something the test suite pins down on
every run."

**Command:**

```bash
docker unpause inveniops-ims-mongo-1
```

**Say:** "And it drains." Point at the buffer fill dropping back toward zero over the
next few seconds.

## 4:45 — Close (15s)

**Point at:** the backend's own terminal (`docker compose logs -f backend`, or
whatever's already scrolled), and the `[metrics]` line printing every 5 seconds.

**Say:** "This line is the other observability requirement — throughput, buffer
fill, queue depth, active items, drops, and end-to-end latency percentiles, printed
to the console every 5 seconds without needing a dashboard open at all. That's
everything — ingestion, debouncing, the workflow, and it staying up under load."

## Cleanup after

```bash
docker unpause inveniops-ims-mongo-1   # if you stopped partway through the pause step
```

The seeded data is harmless to leave in place, but for a clean slate before the next
run: `make reset` (`docker compose down -v` — destructive, wipes every volume) then
`docker compose up -d` again.
