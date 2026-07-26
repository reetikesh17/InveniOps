import { useSearchParams } from "react-router-dom";
import { ActiveIncidentsView } from "./ActiveIncidentsView";
import { ClosedIncidentsView } from "./ClosedIncidentsView";
import { readFeedView } from "./FeedViewToggle";

/**
 * The incident list route. Defaults to the live active feed; ?view=closed
 * shows the closed-incident history instead. The two are separate views with
 * different data models (live/SSE + client pagination vs. cold + server
 * pagination), so they're distinct components rather than one branchy screen.
 */
export function LiveFeedPage(): JSX.Element {
  const [searchParams] = useSearchParams();
  return readFeedView(searchParams) === "closed" ? <ClosedIncidentsView /> : <ActiveIncidentsView />;
}
