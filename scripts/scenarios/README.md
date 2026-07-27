# Cascading-failure scenario

Sample data + a narrated, replayable demo for the assignment's "mock a failure event
across the stack" requirement. Full write-up (what it proves, why, and how): see the
repo root [README.md's "Sample Data" section](../../README.md#sample-data).

## Quick start

```bash
docker compose up -d             # from the repo root, if not already running

npm install                                # one-time
npm run cascading-failure                  # real time — ~3 minutes
npm run cascading-failure -- --speed 30    # compressed — ~10 seconds, for CI
npm run replay-lifecycle                   # then this — closes the incident work items
```

## Files

- `cascading-failure.json` — the canonical, static event sequence. Read this to see
  exactly what the scenario does without running anything.
- `cascading-failure.ts` — replays `cascading-failure.json` against the real running
  stack over the real HTTP API, narrates each beat, then verifies (against Postgres
  and the backend's own logs — not inferred) that debouncing, the alerting Strategy's
  severity floor, signal linkage, and the ingestion buffer all behaved as expected.
  Writes `.output/last-run.json`.
- `replay-lifecycle.ts` — reads `.output/last-run.json` and walks the resulting
  incident work items through `INVESTIGATING → RESOLVED → RCA → CLOSED`, with a real
  MTTR computed from the actual timeline.
- `helpers/` — thin HTTP client, read-only Postgres lookup, and `docker logs`
  reader; same posture as `backend/tests/chaos/helpers/`.

## Flags

| Script | Flag | Default | Meaning |
|---|---|---|---|
| `cascading-failure.ts` | `--speed <n>` | `1` | Time-compression multiplier — `--speed 30` runs ~30x faster |
| | `--api-url <url>` | `http://localhost:3000` | Backend base URL |
| | `--database-url <url>` | `postgresql://ims_user:ims_password@localhost:5432/ims` | For read-only verification queries |
| | `--container <name>` | `inveniops-ims-backend-1` | For reading alert logs via `docker logs` |
| | `--output <path>` | `.output/last-run.json` | Where the run record is written |
| `replay-lifecycle.ts` | `--input <path>` | `.output/last-run.json` | Run record to read |
| | `--api-url <url>` | `http://localhost:3000` | Backend base URL |
| | `--actor <name>` | `demo-responder` | Actor recorded on each transition/RCA |
