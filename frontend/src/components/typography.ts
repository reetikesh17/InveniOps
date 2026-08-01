// Shared class strings for the type scale defined in index.css's @theme.
// Import these rather than hand-rolling a text size — that's what "pick up
// the change through tokens" means in practice: one place per job, not a
// bracket value copied into a dozen files.

/** Column headers, field labels — small uppercase tracked mono. */
// ink-muted, not ink-faint: this is the app's single most common label
// class (every column header and field label), and at 10px it needs the
// full 4.5:1 AA text threshold. ink-faint only clears ~2.7-3.2:1 against
// surface/surface-raised in both themes — reserved for genuinely decorative
// or disabled content, never a real label. See docs/decisions/0008-console-visual-system.md.
export const EYEBROW_CLASSES =
  "font-mono text-eyebrow font-medium uppercase tracking-wider text-ink-muted";

/** Brand mark and page H1s — the one place the display face appears. */
export const DISPLAY_HEADING_CLASSES =
  "font-display text-wordmark font-bold uppercase tracking-[0.14em] text-ink";

/** Human-authored titles (incident title) — body face, medium weight. */
export const TITLE_CLASSES = "font-body text-title font-medium text-ink";

/** Body prose — RCA text, empty/error copy. */
export const PROSE_CLASSES = "font-body text-prose text-ink";

/** Machine identity values — component IDs, signal IDs. */
export const MONO_ID_CLASSES = "font-mono text-mono-id text-ink";

/** Numeric columns — pair with `text-right` where the column right-aligns. */
export const MONO_NUM_CLASSES = "font-mono text-mono-num tabular-nums text-ink";

/** Secondary lowercase mono — state pills, connection/transport status. */
export const MONO_MICRO_CLASSES =
  "font-mono text-mono-micro lowercase tracking-tight text-ink-muted";
