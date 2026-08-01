import { FOCUS_RING } from "../../components/Button";
import { EYEBROW_CLASSES } from "../../components/typography";

const REPO_URL = "https://github.com/reetikesh17/InveniOps";

interface DocLink {
  readonly label: string;
  readonly href: string;
}

const DOC_LINKS: readonly DocLink[] = [
  { label: "README", href: `${REPO_URL}/blob/main/README.md` },
  { label: "Architecture", href: `${REPO_URL}/blob/main/docs/architecture.md` },
  { label: "Backpressure", href: `${REPO_URL}/blob/main/docs/backpressure.md` },
  { label: "Performance", href: `${REPO_URL}/blob/main/docs/performance.md` },
  { label: "Design decisions", href: `${REPO_URL}/tree/main/docs/decisions` },
];

export function Footer(): JSX.Element {
  return (
    <footer className="border-t border-border py-10">
      <div className="mx-auto flex max-w-content flex-col gap-6 px-4 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className={`${EYEBROW_CLASSES} tracking-widest`}>InveniOps</p>
            <p className="mt-2 max-w-md font-body text-prose text-ink-muted">
              Built as a take-home engineering assignment — a mission-critical incident management
              system, not a production product. <em>Invenio</em>, Latin: to find, to discover.
            </p>
          </div>

          <nav aria-label="Documentation" className="flex flex-col items-end">
            {DOC_LINKS.map((link) => (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                // py-1.5 exists purely to grow the tap target to a
                // comfortable size — the text itself stays at its compact
                // mono-micro size, only the hit area grows.
                className={`w-fit rounded-sm py-1.5 font-mono text-mono-micro text-ink-muted underline-offset-2 hover:text-ink hover:underline ${FOCUS_RING}`}
              >
                {link.label}
              </a>
            ))}
          </nav>
        </div>

        <p className="border-t border-border pt-4 font-mono text-mono-micro text-ink-muted">
          <a href={REPO_URL} target="_blank" rel="noreferrer" className={`hover:text-ink ${FOCUS_RING} rounded-sm`}>
            {REPO_URL.replace("https://", "")}
          </a>
        </p>
      </div>
    </footer>
  );
}
