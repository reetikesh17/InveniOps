# 0013 — Landing page: what it optimises for, and the constraints that follow from it

**Status:** Accepted

## Context

The console (everything now under `/app`) has one audience — an on-call operator
under stress, three-second scan, see [ADR 0008](0008-console-visual-system.md). The
public root (`/`) has a different one: a technical reviewer (an engineer evaluating
this as portfolio work, or an SRE lead deciding whether to deploy it) who spends under
a minute deciding whether to open the repo or the demo. Same product, different job,
which is why this got its own ADR instead of an addendum to 0008 — the decisions below
are judged against *that* job, not against "does it look like a landing page."

## Decision

**Extend the console's token system; add nothing chromatic.** The landing page reuses
`index.css`'s `@theme` block verbatim — the same `--color-severity-p0..p3` as the
*only* chromatic values, the same three type faces, the same components
(`Card`, `Button`, `StateBadge`, `severityColor()`). Two new type rungs
(`--text-hero`, `--text-lede`) and two layout tokens (`--spacing-section`,
`--max-width-content`) were added because the console genuinely has no equivalent —
nothing in a dense operator table needs a 48px headline or a page-scroll rhythm — but
nothing existing was overridden. The deliberate cost of this: no brand accent color,
no gradient, the thing most landing pages reach for first. A page that visibly
rations color exactly as strictly as the console does *is* the pitch to a technical
reader — inventing a marketing hue would have undercut the one rule the console never
breaks.

**The hero is a live mechanic, not a claim about one.** `SignalCollapseDemo` animates
the actual debounce rule (100 signals or 10 seconds, whichever comes first) collapsing
into a real `IncidentRow`-styled component, captioned "illustrative" rather than
presented as literally real-time. Two alternatives were considered and rejected — see
below. The demo is entirely client-generated data, no API call, which is not just an
implementation shortcut: the console's own live feed is authenticated (see
[ADR 0012](0012-jwt-authentication.md)), so there is no real "live" version of this
demo a public page could show even if it wanted to. Because it never depends on the
backend, it degrades to nothing — verified by loading the page with the backend
stopped entirely (zero console errors, zero failed requests).

**Every number is sourced, not asserted.** The measured-numbers panel quotes
`docs/performance.md` with its trial variance intact (a median and the raw trials
behind it, not a single flattering figure), and states plainly that the assignment's
"10,000 signals/sec" target was never cleanly reproduced, rather than rounding toward
it. The mechanic strip's three claims (debounce, backpressure, close gate) each cite a
real config default or enforcement point. This is slower to write than marketing copy
and was the point: a reviewer who checks one number against the source and finds it
accurate reads the whole page differently than one who catches a single rounded-up
claim.

**The architecture diagram is hand-built HTML, not the `mermaid` package.** Same
nodes and edges as the README's Mermaid source, laid out as stages instead of
auto-routed. Rejected pulling in `mermaid` for one diagram: it would be the only
runtime dependency this whole page needs, its default theme would need substantial
override work to sit inside the console's token system without a jarring visual
seam, and hand-built HTML means every text/background pairing is provably from the
same AA-audited token set as everything else (see [ADR 0008](0008-console-visual-system.md))
instead of an unfamiliar SVG output that would need its own contrast pass.

**Meta tags, favicon, and the OG image extend the same system instead of inventing a
marketing identity.** The favicon (the segmented severity ribbon, already the app's
one visual signature) was left untouched rather than redesigned — it already *is* the
mark, on every route. The Open Graph preview image is a static, hand-built 1200×630
card using the same tokens, fonts, and hero copy as the page itself, not a live
screenshot (which would drift as demo data changes) and not a generic template.
`VITE_SITE_URL` (see `.env.example`) drives the canonical/OG/Twitter URLs, defaulting
to `http://localhost:5173` rather than a fabricated production domain that doesn't
exist yet — correct for a local checkout, and one env var away from correct once this
is actually deployed somewhere.

**The console moved to `/app`; `/` became this page.** The alternative — keeping the
console at `/` and putting the landing page somewhere else — would have made the
public entry point the *less* important surface for this audience, backwards from the
stated job. `RequireAuth`'s redirect-and-return behavior is unaffected: an
unauthenticated visitor to any `/app/*` URL still lands on `/login` and is sent back
to where they were headed on success.

## Consequences

- Every internal link that assumed the console lived at `/` (`Header`'s wordmark and
  nav, `IncidentRow`'s row link, `IncidentDetailPage`'s back-link, the post-login/signup
  redirect target) now points at `/app` — path-string changes only, no behavioral or
  visual change to the console itself.
- `LoginPage`/`SignupPage` are now route-level code-split (`lazy()`), same as every
  other page — a landing-page visitor who never clicks through no longer pays for
  their bundle. (Lighthouse flagged this as unused JavaScript on the landing route
  before the split; fixed as a direct consequence of measuring, not a speculative
  optimization.)
- Google Fonts loads via the `preload` + `media="print"` swap pattern instead of a
  plain blocking `<link rel="stylesheet">` — the blocking fetch was costing roughly
  1.1s of the landing page's own LCP, which a portfolio piece being evaluated on
  first impression cannot afford to lose to its own font choice.
- A production Docker build exists (`frontend/Dockerfile.prod`, nginx, SPA fallback)
  purely as a way to verify the built artifact — this is deliberately **not** wired
  into `docker-compose.yml`, so the documented Quickstart's hot-reload dev loop is
  unchanged.
- Lighthouse against that production build: performance 99, accessibility 100,
  best-practices 100, SEO 100.

## Alternatives considered

- **The live incident feed itself as the hero.** Rejected on a concrete technical
  ground, not taste: the feed is authenticated data (ADR 0012), so a public page
  showing it "live" would either have to fake it — directly contradicting the
  every-number-is-real discipline above — or punch a hole in the auth model this
  system just added. Not worth it for a hero moment.
- **The buffer filling and shedding under load, animated, as the hero.** Also a real
  "stays calm under a flood" demonstration, and used instead in the mechanic strip,
  where a sentence of explanation fits. Rejected as the *hero* specifically because
  ring-buffer watermarks read as abstract in the few seconds a hero gets, where
  "100 signals become 1" reads immediately and happens to also be a literal
  enactment of the product name (*invenio* — to find, to discover) without ever
  putting the Latin in the headline.
- **A headline over a gradient with three stat cards.** The default answer for a
  dev-tool landing page, named explicitly to rule it out. No gradient appears
  anywhere on this page.
- **Numbered `01/02/03` section markers throughout.** Used only where the content is
  actually an ordered sequence (the architecture pipeline's real stages, the
  lifecycle's real state order) — cut everywhere else, where it would have been
  decoration pretending to be information.
- **A rounded "10,000 signals/sec" headline stat.** That number is the assignment's
  *target*, not a measurement — see `docs/performance.md`'s own honest accounting.
  Asserting it on the page a reviewer sees first would have been the single easiest
  way to lose credibility with the audience this page is written for.
