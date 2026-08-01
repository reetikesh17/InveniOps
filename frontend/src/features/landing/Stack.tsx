import { EYEBROW_CLASSES } from "../../components/typography";

const STACK = [
  "Node.js 20 + TypeScript",
  "Express",
  "PostgreSQL 16 + Prisma",
  "MongoDB 7",
  "Redis 7",
  "BullMQ",
  "React 18 + Vite + Tailwind",
  "Docker Compose",
  "Vitest",
  "zod",
  "pino",
] as const;

export function Stack(): JSX.Element {
  return (
    <section className="border-t border-border py-16 md:py-section" aria-labelledby="stack-heading">
      <div className="mx-auto max-w-content px-4 sm:px-6">
        <h2 id="stack-heading" className={`${EYEBROW_CLASSES} tracking-widest`}>
          Stack
        </h2>
        <ul className="mt-5 flex flex-wrap gap-2">
          {STACK.map((item) => (
            <li
              key={item}
              className="rounded-md border border-border-strong bg-surface px-2.5 py-1 font-mono text-mono-micro text-ink"
            >
              {item}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
