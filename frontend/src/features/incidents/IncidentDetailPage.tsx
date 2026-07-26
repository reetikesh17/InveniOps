import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button, Card, EmptyState, ErrorState, IncidentDetailSkeleton, Input, useToast } from "../../components";
import { XCircleIcon } from "../../components/icons";
import { friendlyErrorMessage } from "../../lib/errorMessages";
import { useDelayedFlag } from "../../hooks/useDelayedFlag";
import { RcaForm } from "../rca/RcaForm";
import { DetailHeader } from "./DetailHeader";
import { RcaReadOnly } from "./RcaReadOnly";
import { SignalsPanel } from "./SignalsPanel";
import { StateMachineControl } from "./StateMachineControl";
import { TransitionTimeline } from "./TransitionTimeline";
import { useActorName } from "./useActorName";
import { useIncidentDetail } from "./useIncidentDetail";

const CONFLICT_BANNER_MS = 6_000;

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <Card>
      <h2 className="mb-3 text-base font-semibold text-ink">{title}</h2>
      {children}
    </Card>
  );
}

export function IncidentDetailPage(): JSX.Element | null {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [actor, setActor] = useActorName();
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const { detail, loading, error, notFound, refresh } = useIncidentDetail(id ?? "");
  const showSkeleton = useDelayedFlag(loading && !detail);

  useEffect(() => {
    if (!conflictMessage) {
      return undefined;
    }
    const timer = setTimeout(() => setConflictMessage(null), CONFLICT_BANNER_MS);
    return () => clearTimeout(timer);
  }, [conflictMessage]);

  async function handleRefresh(): Promise<void> {
    await refresh();
    setRefreshNonce((n) => n + 1);
  }

  function handleConflict(message: string): void {
    setConflictMessage(message);
    void handleRefresh();
  }

  if (!id || notFound) {
    return (
      <EmptyState
        icon={<XCircleIcon className="h-8 w-8" />}
        headline="Incident not found"
        body="It may have been removed, or the link might be wrong."
        action={
          <Button variant="secondary" onClick={() => navigate("/")}>
            Back to Live Feed
          </Button>
        }
      />
    );
  }

  if (loading && !detail) {
    return showSkeleton ? <IncidentDetailSkeleton /> : null;
  }

  if (error && !detail) {
    return <ErrorState message={friendlyErrorMessage(error, "this incident")} onRetry={() => void handleRefresh()} />;
  }

  if (!detail) {
    return showSkeleton ? <IncidentDetailSkeleton /> : null;
  }

  return (
    <div className="flex flex-col gap-6">
      <Link to="/" className="w-fit text-sm text-ink-muted hover:text-ink">
        ← Back to Live Feed
      </Link>

      {conflictMessage && (
        <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          {conflictMessage}
        </div>
      )}

      <DetailHeader detail={detail} />

      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="w-48">
            <Input label="Acting as" value={actor} onChange={(e) => setActor(e.target.value)} />
          </div>
          <StateMachineControl
            incidentId={detail.id}
            legalNextStates={detail.legalNextStates}
            actor={actor}
            onTransitioned={() => void handleRefresh()}
            onConflict={handleConflict}
          />
        </div>
      </Card>

      {detail.state === "RESOLVED" && (
        <Section title="Complete the RCA to close this incident">
          <RcaForm
            incidentId={detail.id}
            firstSignalAt={detail.firstSignalAt}
            actor={actor}
            onSubmitted={() => {
              void handleRefresh();
              showToast("success", "RCA submitted — incident closed.");
            }}
            onConflict={handleConflict}
          />
        </Section>
      )}

      {detail.state === "CLOSED" && detail.rca && (
        <Section title="Root cause analysis">
          <RcaReadOnly rca={detail.rca} />
        </Section>
      )}

      <Section title="Transition history">
        <TransitionTimeline key={refreshNonce} incidentId={detail.id} />
      </Section>

      <Section title="Raw signals">
        <SignalsPanel incidentId={detail.id} />
      </Section>
    </div>
  );
}
