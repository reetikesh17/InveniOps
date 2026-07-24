# 0007 — Server-Sent Events for the incident dashboard's real-time updates

**Status:** Accepted

## Context

The Live Feed needs to reflect new incidents and state changes without the
operator manually refreshing. `GET /api/v1/incidents` already reads from the
write-through Redis dashboard cache (`dashboard:active_incidents` ZSET,
per-incident hash) — no Postgres round trip on the common path — so even
naive polling against it is cheap. The question is whether that's reason
enough to stop there, or whether push-based delivery is worth building.

## Decision

Server-Sent Events: `GET /api/v1/incidents/stream`, one-directional
(server→client), backed by Redis pub/sub so an event published by whichever
backend replica handled a mutation reaches clients connected to any replica.
Built on native platform primitives — Node's own HTTP response streaming
and the browser's native `EventSource` — no new dependency on either side.
`useIncidents` (`frontend/src/hooks/useIncidents.ts`) still falls back to
polling if the SSE connection can't be established or drops repeatedly, so
polling isn't replaced, only pre-empted when available.

Events carry the mutated work item's full summary but the hook treats them
as a **refetch trigger**, not a client-side merge source — deliberately.
Reconstructing the backend's severity-then-age sort order on the client
would duplicate logic that already exists once
(`PostgresWorkItemRepository.listActive` / the Redis ZSET's score encoding,
see `docs/data-model.md`), and duplicated sort logic is exactly the kind of
thing that drifts. A refetch against the cache is cheap enough that
"trigger a refetch" gets correctness for free at negligible extra cost;
debounced (300ms) so a debounced burst of signals creating one work item
doesn't fire a refetch per underlying event.

## Consequences

- New backend surface: `services/realtime/` (a publisher used by
  `processBatch.ts` and `WorkflowService`, and a subscriber wrapping one
  dedicated Redis connection in subscribe mode, fanned out in-process to
  every open SSE connection via a plain `EventEmitter`) plus the stream
  route itself. Publish failures are logged and swallowed — same "never
  block or fail the actual mutation" posture as the alert dispatcher and
  the metrics writer already have.
- One long-lived HTTP connection per connected dashboard client. Fine at
  this system's scale (an internal ops dashboard, not a public-facing
  product); would need a connection-count ceiling or a different transport
  at a much larger concurrent-viewer count.
- The client owns reconnection (exponential backoff, capped, closing and
  recreating the `EventSource` itself) rather than relying on the browser's
  built-in retry, which is a fixed ~3s interval with no backoff — necessary
  to satisfy "reconnect with backoff" and to have a deliberate point at
  which the hook gives up on SSE and degrades to polling instead of
  retrying forever.
- A dropped Redis pub/sub message (e.g., a subscriber briefly disconnected
  between publish and resubscribe) is simply a missed push — not a missed
  *fact*, since the client still holds whatever it last fetched and the
  next successful event (or the polling fallback, or a manual refresh)
  reconciles it. Pub/sub was chosen over a Redis Stream (which would
  preserve backlog for a reconnecting consumer) because that durability
  isn't needed here: every event's job is "prompt a refetch of already-
  durable state," not to be itself the record of what happened.

## Alternatives considered

- **Short polling only.** Genuinely viable — the cache makes it cheap, and
  it needs zero new backend infrastructure. Rejected as the primary
  transport specifically because this is an incident dashboard: the gap
  between "a new P0 shows up in ~5s" and "in well under a second" has real
  operational value here in a way it wouldn't in a lower-stakes admin UI.
  Kept as the mandatory fallback, so choosing SSE never costs correctness
  if the push path is unavailable.
- **WebSocket.** Rejected — full duplex, a new server-side dependency
  (`ws`/`socket.io`), its own connection lifecycle and ping/pong framing,
  for a channel that only ever needs to carry server→client notifications;
  every client-initiated mutation already goes through ordinary REST POSTs.
  The one capability WebSocket has that SSE doesn't (bidirectional) is
  unused here, for real added complexity.
- **Client-side merge from the event payload** (instead of refetch-on-event).
  Rejected — would need the frontend to reimplement the backend's
  severity/age sort to keep the merged list correctly ordered, a second
  copy of logic that can silently drift from `PostgresWorkItemRepository`'s
  actual `ORDER BY`. A cache-backed refetch is cheap enough that this
  correctness isn't worth trading away for the marginally lower latency of
  a pure client-side merge.
