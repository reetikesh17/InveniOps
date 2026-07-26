import { useSearchParams } from "react-router-dom";
import { FOCUS_RING } from "../../components/Button";

export type FeedView = "active" | "closed";

export function readFeedView(params: URLSearchParams): FeedView {
  return params.get("view") === "closed" ? "closed" : "active";
}

/**
 * Switches the feed between the live active list and the closed-incident
 * history. Toggling resets the other query params (filters/pagination differ
 * between the two views, so carrying them across would be stale), keeping only
 * the view itself in the URL.
 */
export function FeedViewToggle({ view }: { view: FeedView }): JSX.Element {
  const [, setSearchParams] = useSearchParams();

  function select(next: FeedView): void {
    const params = new URLSearchParams();
    if (next === "closed") {
      params.set("view", "closed");
    }
    setSearchParams(params, { replace: true });
  }

  const options: { key: FeedView; label: string }[] = [
    { key: "active", label: "Active" },
    { key: "closed", label: "Closed" },
  ];

  return (
    <div className="inline-flex overflow-hidden rounded-md border border-border-strong" role="group" aria-label="Incident view">
      {options.map((option, index) => {
        const isSelected = option.key === view;
        return (
          <button
            key={option.key}
            type="button"
            aria-pressed={isSelected}
            onClick={() => select(option.key)}
            className={`px-3 py-1 text-sm font-medium ${index > 0 ? "border-l border-border-strong" : ""} ${
              isSelected ? "bg-ink text-surface-muted" : "bg-surface text-ink-muted hover:bg-surface-raised"
            } ${FOCUS_RING}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
