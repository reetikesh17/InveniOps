# 0008 — Incident console visual system: severity-rationed colour, a three-face type system, and the severity spine

**Status:** Accepted

## Context

The dashboard's original visual pass used fully-saturated primary colours,
sparse row density, and no distinction between machine-generated values
(IDs, timestamps, payloads) and human-authored text. That reads as a generic
admin CRUD screen, not an instrument a specific person reaches for under
specific stress. The redesign brief was narrow on purpose: **the audience is
an on-call engineer at 3am who just got paged, and the single job is to show
what's broken, how bad, and how long — scannable in under three seconds.**
Every decision below is judged against that job, not against "does it look
good" in the abstract.

## Decision

**Colour is rationed to severity alone.** Four hues (`--color-severity-p0`
through `-p3`) are the *only* chromatic values anywhere in the system —
everything else (surfaces, borders, three ink tiers) is desaturated grey, in
two parallel palettes rather than one flipped: dark **"instrument slate"**
(`#0e1315` panel) is the primary mode, light **"daylight triage"**
(`#eef1f2` panel, cool grey — deliberately not the cream a light mode
defaults to by habit) is a first-class alternative designed alongside it, not
derived from it afterward. Severity splits by urgency tier, not just by
distinctness: P0/P1 are warm (red/amber, "act now"), P2/P3 are cool
(teal/slate, "be aware"), so a row's *temperature* is legible before its code
is even read. All four hues are drawn from one source
(`frontend/src/components/severity.ts`) so the row spine, the age dot, the
header's urgency ribbon, and every analytics chart are guaranteed to agree.

**Type is a three-face system that encodes machine vs. human at the font
level, not just at the value level.** Archivo (tracked, uppercase) for
equipment-style labels — the wordmark, page headings, column headers. IBM
Plex Sans for human-authored prose — incident titles, RCA narrative,
empty/error copy. JetBrains Mono, with tabular figures, for every
machine-generated value — component/signal IDs, timestamps, counts, raw JSON.
An operator should never have to parse *content* to know whether they're
looking at something a person wrote or something a system emitted; the
typeface already tells them. Seven named rungs (`eyebrow` … `mono-micro`,
defined once in `index.css`'s `@theme` block, demoed live on `/styleguide`)
mean no component reaches for an arbitrary pixel size.

**Density and the severity spine.** Feed rows run close to twice the density
of the original pass (~28px), because the job is "the whole picture on one
screen," not comfortable whitespace. The signature is a 3px colour rail on
each row's leading edge; rows abut with no divider, so a severity-sorted feed
reads as one continuous ribbon rather than fifty separate coloured chips. An
age dot in the same gutter (hollow → filled) answers "how long," and a
separate "time in state" readout escalates by ink weight — never a second
colour — so "how bad" (hue) and "how stale" (weight) stay visually distinct
axes instead of blurring into one.

## Consequences

- **A dedicated, scriptable contrast audit was necessary and caught real
  bugs.** Every text/background pairing in both themes was checked against
  WCAG AA (4.5:1 for real text, 3:1 for graphical elements) with a small
  luminance-ratio script rather than eyeballed. It found that `ink-faint`
  (the third, quietest ink tier) fails AA as *text* in both themes
  (~2.7–3.2:1 against every surface) despite being visually reasonable at a
  glance — it had been used for `EYEBROW_CLASSES` (every field/column label
  in the app), several machine-value captions, a couple of functional icons
  (dropdown chevrons, an expand affordance), and one state badge. Fix:
  `ink-faint` is now reserved strictly for genuinely decorative or
  WCAG-exempt content (disabled controls, redundant icons, an
  `aria-hidden` separator glyph); every informational use was promoted to
  `ink-muted`, which clears AA with margin in both themes. Where that
  promotion would have collapsed a meaningful distinction — CLOSED badges
  "receding further" than other states, and the time-in-state readout's
  quietest rung — the distinction was rebuilt on a non-colour axis (no
  border, and italics, respectively) instead of restoring the failing
  colour.
- **Colour-alone meaning was checked structurally, not just spot-checked.**
  Severity is always paired with the mono "P0"–"P3" code, never the rail
  alone; workflow state carries no colour at all; the header's segmented
  urgency ribbon is a `role="img"` with a full text `aria-label`; the age
  dot's fresh/aged states differ by *shape* (hollow vs. filled), not only
  colour, and the same "how long" fact is independently available as text
  elsewhere in the row.
- **Every focus ring uses the same neutral `ring-ink` token, deliberately
  never a severity hue** — a desaturated accent colour is exactly the kind
  of thing that loses visibility as a focus indicator, so focus state was
  kept on the strongest, highest-contrast ink token instead (11.7:1+ in dark,
  14.4:1+ in light against every surface in the app).
- **A pre-paint inline script in `index.html`** sets `data-theme` before the
  stylesheet resolves, reading the same storage key and OS-preference
  fallback as `useTheme.ts`. Without it, a user who forced a theme against
  their OS preference would see one frame of the *other* theme on every load
  (the CSS's own `prefers-color-scheme` fallback would win the race against
  React's mount-time effect); this makes the two agree from the very first
  paint.
- **`/styleguide` is a development artifact, not a product surface** —
  deliberately not linked from primary nav, reachable only by typing the URL.
  It exists purely so every primitive, in every state, can be reviewed and
  regression-checked independent of any one real screen, and it feeds the
  real `IncidentTable`/`IncidentRow` components (not a reimplementation) so
  its demo of the severity spine can never drift from what ships.

## Alternatives considered

- **A single palette with a `prefers-color-scheme` flip (invert lightness,
  keep hues).** Rejected — a mechanically inverted dark mode routinely
  produces glare (pure-white ink, oversaturated hues that were tuned for a
  light background) and was exactly the failure mode the brief called out.
  Designing dark and light as two tuned palettes sharing one set of token
  *names* costs more up front and pays for itself in a mode that's actually
  comfortable at 3am.
- **Colour-coding workflow state** (e.g., amber for INVESTIGATING, green for
  RESOLVED) in addition to severity. Rejected — it would double the
  chromatic surface area the eye has to parse and dilute the one signal that
  actually matters under time pressure (severity). State is legible from its
  label; it doesn't need a second colour channel competing with severity.
- **Restoring `ink-faint`'s contrast by darkening/lightening the token
  itself**, instead of reclassifying call sites. Rejected — pushing it to
  clear 4.5:1 would land it within a hair of `ink-muted`'s existing contrast,
  erasing the three-tier hierarchy for every caller that *did* intend a
  merely decorative, sub-AA tone (disabled controls, redundant icons).
  Reclassifying case-by-case keeps the tier meaningful and keeps disabled/
  decorative content honestly exempt rather than papering over the
  distinction.
