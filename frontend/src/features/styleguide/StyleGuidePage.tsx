import { useState, type ReactNode } from "react";
import {
  Button,
  Card,
  DateTimeInput,
  EmptyState,
  ErrorState,
  IncidentDetailSkeleton,
  IncidentListSkeleton,
  Input,
  RelativeTime,
  Select,
  SeverityBadge,
  StateBadge,
  TextArea,
  useToast,
} from "../../components";
import { InboxIcon } from "../../components/icons";
import { COMPONENT_TYPES, ROOT_CAUSE_CATEGORIES, SEVERITIES, WORK_ITEM_STATES } from "../../types";

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }): JSX.Element {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {description && <p className="text-sm text-ink-muted">{description}</p>}
      </div>
      <Card>{children}</Card>
    </section>
  );
}

function Swatch({ name, className }: { name: string; className: string }): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <div className={`h-12 w-full rounded-md border border-border ${className}`} />
      <span className="text-xs text-ink-muted">{name}</span>
    </div>
  );
}

const SAMPLE_TIMESTAMPS = [
  { label: "just now", offsetMs: 2_000 },
  { label: "45s ago", offsetMs: 45_000 },
  { label: "4m ago", offsetMs: 4 * 60_000 },
  { label: "3h ago", offsetMs: 3 * 3_600_000 },
  { label: "2d ago", offsetMs: 2 * 86_400_000 },
  { label: "5mo ago", offsetMs: 150 * 86_400_000 },
];

export function StyleGuidePage(): JSX.Element {
  const { showToast } = useToast();
  const [buttonLoading, setButtonLoading] = useState(false);
  const [textValue, setTextValue] = useState("CACHE_CLUSTER_01");
  const [category, setCategory] = useState("");

  return (
    <div className="flex flex-col gap-8 pb-16">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Style Guide</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Every reusable primitive in every state — the visual system the rest of the dashboard is built from. Resize
          the window (375 / 768 / 1440px) and tab through the page to check responsiveness and focus order.
        </p>
      </div>

      <Section title="Design tokens" description="Neutral roles plus severity/state colours — referenced by name everywhere, never a raw hex value.">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
          <Swatch name="severity-p0" className="bg-severity-p0" />
          <Swatch name="severity-p1" className="bg-severity-p1" />
          <Swatch name="severity-p2" className="bg-severity-p2" />
          <Swatch name="severity-p3" className="bg-severity-p3" />
          <Swatch name="state-open" className="bg-state-open" />
          <Swatch name="state-investigating" className="bg-state-investigating" />
          <Swatch name="state-resolved" className="bg-state-resolved" />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-5">
          <Swatch name="surface" className="bg-surface" />
          <Swatch name="surface-muted" className="bg-surface-muted" />
          <Swatch name="border" className="bg-border" />
          <Swatch name="border-strong" className="bg-border-strong" />
          <Swatch name="ink" className="bg-ink" />
        </div>
      </Section>

      <Section title="SeverityBadge" description="Colour, text label, and a filled-bar icon all encode severity independently — never colour alone.">
        <div className="flex flex-wrap items-center gap-3">
          {SEVERITIES.map((severity) => (
            <SeverityBadge key={severity} severity={severity} />
          ))}
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
          <p className="text-sm text-ink">
            A nested Card at <code>padding=&quot;sm&quot;</code> — Cards compose (this style guide itself is built entirely from them).
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
            <p className="mb-2 text-xs font-medium text-ink-muted">IncidentListSkeleton</p>
            <IncidentListSkeleton rows={3} />
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-ink-muted">IncidentDetailSkeleton</p>
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
              <RelativeTime value={new Date(Date.now() - sample.offsetMs)} className="font-medium tabular-nums" />
              <span className="text-ink-faint">(constructed as &quot;{sample.label}&quot;)</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
