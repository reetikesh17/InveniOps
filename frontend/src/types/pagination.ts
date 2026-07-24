export interface PaginationParams {
  readonly limit?: number;
  readonly offset?: number;
}

// Mirrors every paginated backend route's PageResponseBody<T> shape (see
// backend/src/api/routes/workitems.ts).
export interface Page<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}
