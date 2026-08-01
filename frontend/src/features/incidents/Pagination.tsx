import { Button } from "../../components";

export interface PaginationProps {
  readonly page: number;
  readonly pageCount: number;
  readonly totalCount: number;
  readonly pageSize: number;
  readonly onPageChange: (page: number) => void;
}

/** Page-based, not virtualized scroll — simpler to keyboard-navigate, and the filtered result sets here are small enough (bounded by the Live Feed's own fetch cap) that a full virtualization library isn't warranted. */
export function Pagination({
  page,
  pageCount,
  totalCount,
  pageSize,
  onPageChange,
}: PaginationProps): JSX.Element {
  const start = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalCount);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-ink-muted">
      <span>
        {start}–{end} of {totalCount}
      </span>
      <div className="flex items-center gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Previous
        </Button>
        <span className="tabular-nums">
          Page {page} of {pageCount}
        </span>
        <Button
          variant="secondary"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
