// Direct, read-only Postgres access for verification only — the same
// posture as backend/tests/chaos/helpers/dataClients.ts. Every signal and
// every state transition in these scripts goes through the real HTTP API;
// this exists solely because the API has no "find the work item for this
// componentId" endpoint (by design — that's not a real product need), and
// polling the paginated active-incident list isn't reliable against a dev
// database that may already hold thousands of items from earlier testing.
//
// Raw `pg`, not `@prisma/client`: these scripts live outside backend/'s
// workspace, and the two columns this reads (signal_count, severity/state)
// carry no timezone ambiguity — table/column names are copied from
// backend/prisma/schema.prisma's @map directives, the actual source of
// truth.
import pg from "pg";

export interface WorkItemRow {
  readonly id: string;
  readonly severity: string;
  readonly state: string;
  readonly signalCount: number;
}

export class WorkItemLookup {
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 2 });
  }

  /** Most-recently-created non-CLOSED work item for a componentId, or null if none exists yet. */
  async findActive(componentId: string): Promise<WorkItemRow | null> {
    const result = await this.pool.query<{
      id: string;
      severity: string;
      state: string;
      signal_count: number;
    }>(
      `SELECT id, severity, state, signal_count
       FROM work_items
       WHERE component_id = $1 AND state <> 'CLOSED'
       ORDER BY created_at DESC
       LIMIT 1`,
      [componentId],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return { id: row.id, severity: row.severity, state: row.state, signalCount: row.signal_count };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
