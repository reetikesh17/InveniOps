export interface MiddleTruncateProps {
  readonly text: string;
  /** Trailing characters always kept visible — usually where an enumerated ID's distinguishing suffix lives (RDBMS_1 vs RDBMS_11). */
  readonly tailChars?: number;
  readonly className?: string;
}

/**
 * Ellipsizes only the head of a string, never the tail — unlike CSS
 * `truncate` (which elides from the end and can make RDBMS_1/RDBMS_11/RDBMS_110
 * render identically once the column runs out of room, hiding exactly the
 * digit that tells them apart). Widening the column pushes the same problem
 * to a longer ID; this fixes it regardless of width. Pair with a `title`
 * attribute on an ancestor for the full value on hover.
 */
export function MiddleTruncate({
  text,
  tailChars = 6,
  className = "",
}: MiddleTruncateProps): JSX.Element {
  if (text.length <= tailChars + 4) {
    // Short enough that the ordinary CSS ellipsis (if it even triggers) can't
    // obscure anything worth keeping separate — no need for the split.
    return <span className={`truncate ${className}`}>{text}</span>;
  }

  const head = text.slice(0, text.length - tailChars);
  const tail = text.slice(text.length - tailChars);

  return (
    <span className={`inline-flex min-w-0 max-w-full ${className}`}>
      <span className="min-w-0 truncate">{head}</span>
      <span className="shrink-0">{tail}</span>
    </span>
  );
}
