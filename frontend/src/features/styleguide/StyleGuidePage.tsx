import { useState, type ReactNode } from "react";
import {
  AgeDot,
  Button,
  Card,
  DateTimeInput,
  DISPLAY_HEADING_CLASSES,
  EmptyState,
  ErrorState,
  EYEBROW_CLASSES,
  IncidentDetailSkeleton,
  IncidentListSkeleton,
  Input,
  MONO_ID_CLASSES,
  MONO_MICRO_CLASSES,
  MONO_NUM_CLASSES,
  PROSE_CLASSES,
  RelativeTime,
  Select,
  SeverityBadge,
  StateBadge,
  TextArea,
  TITLE_CLASSES,
  useToast,
} from "../../components";
import { InboxIcon } from "../../components/icons";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { IncidentTable } from "../incidents/IncidentTable";
import { COMPONENT_TYPES, ROOT_CAUSE_CATEGORIES, SEVERITIES, WORK_ITEM_STATES } from "../../types";
import type { WorkItem } from "../../types";

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }): JSX.Element {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {description && <p className="font-body text-prose text-ink-muted">{description}</p>}
      </div>
      <Card>{children}</Card>
    </section>
  );
}

function Swatch({ name, className }: { name: string; className: string }): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <div className={`h-12 w-full rounded-md border border-border ${className}`} />
      {/* Token names are identifiers, not prose — mono, per the app's own "machine values render in mono" rule. */}
      <span className="font-mono text-mono-micro text-ink-muted">{name}</span>
    </div>
  );
}

/** One row of the type scale demo: its own token names rendered in the actual classes they name. */
interface ScaleRung {
  readonly name: string;
  readonly spec: string;
  readonly classes: string;
  readonly sample: string;
}

// Samples reference the real exported class constants (never a hand-copied
// literal) so this demo can never silently drift from what the app actually
// ships — see typography.ts.
const TYPE_SCALE: readonly ScaleRung[] = [
  {
    name: "eyebrow",
    spec: "10/14 · mono · uppercase — column headers, field labels",
    classes: EYEBROW_CLASSES,
    sample: "Component type",
  },
  {
    name: "wordmark",
    spec: "13/16 · display · uppercase — brand mark, page H1s",
    classes: DISPLAY_HEADING_CLASSES,
    sample: "Incident Console",
  },
  {
    name: "title",
    spec: "13/18 · body · medium — incident title",
    classes: TITLE_CLASSES,
    sample: "RDBMS incident on RDBMS_14",
  },
  {
    name: "prose",
    spec: "12/17 · body — RCA text, empty/error copy",
    classes: PROSE_CLASSES,
    sample: "Restarted the connection pool after exhausting max connections.",
  },
  {
    name: "mono-id",
    spec: "12/16 · mono — component/signal IDs",
    classes: MONO_ID_CLASSES,
    sample: "CACHE_CLUSTER_01",
  },
  {
    name: "mono-num",
    spec: "12/16 · mono · tabular — numeric columns",
    classes: MONO_NUM_CLASSES,
    sample: "1,204",
  },
  {
    name: "mono-micro",
    spec: "11/14 · mono · lowercase — state pill, connection status",
    classes: MONO_MICRO_CLASSES,
    sample: "connected",
  },
];

// Real WorkItem shapes (the same type the Live Feed renders), constructed
// purely to demo the signature: a continuous severity rail across abutting
// rows, an age dot that's hollow when fresh and filled once stale, and
// time-in-state that escalates only past its threshold. Feeding the actual
// IncidentTable/IncidentRow components — not a reimplementation — so this
// demo can never drift from what ships.
const now = Date.now();
const SAMPLE_INCIDENTS: readonly WorkItem[] = [
  {
    id: "styleguide-sample-fresh-p0",
    componentId: "RDBMS_PRIMARY_EU",
    componentType: "RDBMS",
    severity: "P0",
    state: "OPEN",
    title: "Connection pool exhausted on primary",
    firstSignalAt: new Date(now - 2 * 60_000).toISOString(),
    signalCount: 42,
    updatedAt: new Date(now - 90_000).toISOString(), // ~1.5m in state — fresh, hollow dot, quiet "in state"
  },
  {
    id: "styleguide-sample-aged-p1",
    componentId: "API_GATEWAY_07",
    componentType: "API",
    severity: "P1",
    state: "INVESTIGATING",
    title: "Elevated 5xx rate on checkout path",
    firstSignalAt: new Date(now - 45 * 60_000).toISOString(),
    signalCount: 118,
    updatedAt: new Date(now - 34 * 60_000).toISOString(), // past the critical threshold — filled dot, bold "in state" + ▲
  },
  {
    id: "styleguide-sample-fresh-p2",
    componentId: "CACHE_CLUSTER_03",
    componentType: "CACHE",
    severity: "P2",
    state: "OPEN",
    title: "Evictions above threshold",
    firstSignalAt: new Date(now - 4 * 60_000).toISOString(),
    signalCount: 9,
    updatedAt: new Date(now - 4 * 60_000).toISOString(),
  },
  {
    id: "styleguide-sample-resolved-p3",
    componentId: "QUEUE_INGEST_1",
    componentType: "QUEUE",
    severity: "P3",
    state: "RESOLVED",
    title: "Consumer lag climbing",
    firstSignalAt: new Date(now - 3 * 3_600_000).toISOString(),
    signalCount: 6,
    updatedAt: new Date(now - 90 * 60_000).toISOString(), // 90m old, but RESOLVED never escalates — stays quiet
  },
];

const SAMPLE_TIMESTAMPS = [
  { label: "just now", offsetMs: 2_000 },
  { label: "45s ago", offsetMs: 45_000 },
  { label: "4m ago", offsetMs: 4 * 60_000 },
  { label: "3h ago", offsetMs: 3 * 3_600_000 },
  { label: "2d ago", offsetMs: 2 * 86_400_000 },
  { label: "5mo ago", offsetMs: 150 * 86_400_000 },
];

export function StyleGuidePage(): JSX.Element {
  useDocumentTitle("Style Guide");
  const { showToast } = useToast();
  const [buttonLoading, setButtonLoading] = useState(false);
  const [textValue, setTextValue] = useState("CACHE_CLUSTER_01");
  const [category, setCategory] = useState("");

  return (
    <div className="flex flex-col gap-8 pb-16">
      <div>
        <h1 className="font-display text-lg font-bold uppercase tracking-[0.1em] text-ink">Style Guide</h1>
        <p className="mt-1 font-body text-prose text-ink-muted">
          Every reusable primitive in every state — the visual system the rest of the dashboard is built from. Resize
          the window (375 / 768 / 1440px) and tab through the page to check responsiveness and focus order.
        </p>
      </div>

      <Section title="Design tokens" description="Colour is rationed to the four severity hues; everything else is instrument-grey. Referenced by name, never a raw hex.">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Swatch name="severity-p0" className="bg-severity-p0" />
          <Swatch name="severity-p1" className="bg-severity-p1" />
          <Swatch name="severity-p2" className="bg-severity-p2" />
          <Swatch name="severity-p3" className="bg-severity-p3" />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Swatch name="surface-muted" className="bg-surface-muted" />
          <Swatch name="surface" className="bg-surface" />
          <Swatch name="surface-raised" className="bg-surface-raised" />
          <Swatch name="border" className="bg-border" />
          <Swatch name="border-strong" className="bg-border-strong" />
          <Swatch name="ink" className="bg-ink" />
        </div>
      </Section>

      <Section
        title="Type scale"
        description="Seven named rungs — every text size in the app is one of these, never an arbitrary value. Each sample below is rendered in its own real classes."
      >
        <div className="flex flex-col divide-y divide-border">
          {TYPE_SCALE.map((rung) => (
            <div key={rung.name} className="grid grid-cols-1 items-baseline gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[7rem_1fr_16rem] sm:gap-4">
              <span className="font-mono text-mono-micro text-ink-muted">{rung.name}</span>
              <span className={rung.classes}>{rung.sample}</span>
              <span className="font-body text-prose text-ink-muted">{rung.spec}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Signature: the severity spine"
        description="A 3px rail on each row's leading edge (rows abut, so a sorted feed reads as one continuous urgency ribbon) plus an age dot — hollow when fresh, filled once an incident has sat unaddressed past the threshold. Time-in-state escalates by weight, never a second colour. This is the real IncidentTable, not a mockup."
      >
        <IncidentTable incidents={SAMPLE_INCIDENTS} />
      </Section>

      <Section title="SeverityBadge" description="A rationed colour dot plus the mono code — colour and the P0/P1 code each carry severity independently, so it survives greyscale. (In the feed, severity is the leading spine instead.)">
        <div className="flex flex-wrap items-center gap-3">
          {SEVERITIES.map((severity) => (
            <SeverityBadge key={severity} severity={severity} />
          ))}
        </div>
      </Section>

      <Section title="AgeDot" description="The spine's age gauge, in isolation: hollow while fresh, fills solid once an OPEN/INVESTIGATING incident has sat past the threshold. A RESOLVED/CLOSED incident never fills, however old.">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2">
            <AgeDot severity="P0" state="OPEN" since={new Date(now - 60_000).toISOString()} />
            <span className="font-mono text-mono-micro text-ink-muted">fresh (hollow)</span>
          </div>
          <div className="flex items-center gap-2">
            <AgeDot severity="P0" state="OPEN" since={new Date(now - 15 * 60_000).toISOString()} />
            <span className="font-mono text-mono-micro text-ink-muted">aged in state (filled)</span>
          </div>
          <div className="flex items-center gap-2">
            <AgeDot severity="P3" state="RESOLVED" since={new Date(now - 15 * 60_000).toISOString()} />
            <span className="font-mono text-mono-micro text-ink-muted">resolved, same age (never fills)</span>
          </div>
        </div>
      </Section>

      <Section title="StateBadge">
        <div className="flex flex-wrap items-center gap-3">
          {WORK_ITEM_STATES.map((state) => (
            <StateBadge key={state} state={state} />
          ))}
        </div>
      </Section>

      <Section title="Button" description="primary / secondary / danger, each with normal, loading, and disabled states.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <Button variant="primary">Primary</Button>
            <Button variant="primary" loading>
              Loading
            </Button>
            <Button variant="primary" disabled>
              Disabled
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            <Button variant="secondary">Secondary</Button>
            <Button variant="secondary" loading>
              Loading
            </Button>
            <Button variant="secondary" disabled>
              Disabled
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            <Button variant="danger">Danger</Button>
            <Button variant="danger" loading>
              Loading
            </Button>
            <Button variant="danger" disabled>
              Disabled
            </Button>
          </div>
        </div>
        <div className="mt-4 border-t border-border pt-4">
          <Button
            variant="primary"
            loading={buttonLoading}
            onClick={() => {
              setButtonLoading(true);
              setTimeout(() => setButtonLoading(false), 1500);
            }}
          >
            Click to see a real loading transition
          </Button>
        </div>
      </Section>

      <Section title="Card">
        <Card padding="sm" className="bg-surface-muted">
          <p className="font-body text-prose text-ink">
            A nested Card at <code className="font-mono text-mono-id">padding=&quot;sm&quot;</code> — Cards compose (this
            style guide itself is built entirely from them).
          </p>
        </Card>
      </Section>

      <Section title="Form fields" description="Input, Select, TextArea, DateTimeInput — each with a default, an error, and a disabled state.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Input label="Component ID" value={textValue} onChange={(e) => setTextValue(e.target.value)} />
          <Input label="Component ID" defaultValue="" error="This field is required" />
          <Input label="Component ID" defaultValue="CACHE_CLUSTER_01" disabled />
          <Select
            label="Root cause category"
            placeholder="Select a category…"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            options={ROOT_CAUSE_CATEGORIES.map((c) => ({ value: c, label: c.replaceAll("_", " ") }))}
          />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            label="Component type"
            error="Select a component type"
            placeholder="Select…"
            options={COMPONENT_TYPES.map((c) => ({ value: c, label: c }))}
          />
          <Select label="Component type" disabled options={COMPONENT_TYPES.map((c) => ({ value: c, label: c }))} defaultValue="RDBMS" />
          <DateTimeInput label="Incident start time" />
          <DateTimeInput label="Incident end time" error="End time must be after start time" />
        </div>
        <div className="mt-4">
          <TextArea label="Fix applied" placeholder="Describe the remediation…" />
        </div>
      </Section>

      <Section title="Skeleton loaders" description="One shape per major layout — the Live Feed list and the Incident Detail page.">
        <div className="flex flex-col gap-6">
          <div>
            <p className="mb-2 font-mono text-mono-micro text-ink-muted">IncidentListSkeleton</p>
            <IncidentListSkeleton rows={3} />
          </div>
          <div>
            <p className="mb-2 font-mono text-mono-micro text-ink-muted">IncidentDetailSkeleton</p>
            <IncidentDetailSkeleton />
          </div>
        </div>
      </Section>

      <Section title="EmptyState">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <EmptyState headline="No active incidents" body="Everything is quiet — new incidents will appear here as they come in." />
          <EmptyState
            icon={<InboxIcon />}
            headline="No signals yet"
            body="This component hasn't reported anything in the selected window."
            action={<Button variant="secondary">Adjust time range</Button>}
          />
        </div>
      </Section>

      <Section title="ErrorState">
        <ErrorState message="Couldn't load incidents — the request timed out." onRetry={() => showToast("success", "Retried")} />
      </Section>

      <Section title="Toast" description="Transient success/failure feedback — auto-dismisses after 5s, or close it manually.">
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" onClick={() => showToast("success", "RCA submitted — incident closed.")}>
            Trigger success toast
          </Button>
          <Button variant="danger" onClick={() => showToast("error", "Transition failed: work item is no longer RESOLVED.")}>
            Trigger error toast
          </Button>
        </div>
      </Section>

      <Section title="RelativeTime" description="Hover any value to see the absolute timestamp; each updates itself on an interval.">
        <div className="flex flex-col gap-2 text-sm text-ink">
          {SAMPLE_TIMESTAMPS.map((sample) => (
            <div key={sample.label} className="flex items-center gap-3">
              <RelativeTime value={new Date(Date.now() - sample.offsetMs)} className="font-mono text-mono-num tabular-nums" />
              <span className="font-body text-prose text-ink-muted">(constructed as &quot;{sample.label}&quot;)</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
