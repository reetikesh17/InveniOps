export interface PaginationParams {
  readonly limit?: number;
  readonly offset?: number;
}

// GET /api/v1/incidents/:id/signals only — the backend defaults to "asc"
// (oldest first) when omitted, unchanged from before this param existed.
export interface SignalsQuery extends PaginationParams {
  readonly order?: "asc" | "desc";
}

// Mirrors every paginated backend route's PageResponseBody<T> shape (see
// backend/src/api/routes/workitems.ts).
export interface Page<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}
