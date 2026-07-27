// Plain-text console formatting — no chalk/ora dependency. Symbols instead
// of color so output stays legible piped to a file or a CI log where ANSI
// codes would just show up as garbage.

export function banner(title: string): void {
  const line = "=".repeat(Math.min(78, title.length + 4));
  console.log(`\n${line}\n  ${title}\n${line}`);
}

export function section(title: string): void {
  console.log(`\n--- ${title} ---`);
}

export function ok(message: string): void {
  console.log(`  ✓ ${message}`);
}

export function fail(message: string): void {
  console.log(`  ✗ ${message}`);
}

export function info(message: string): void {
  console.log(`  → ${message}`);
}

export function note(message: string): void {
  console.log(`  ℹ ${message}`);
}

export function fmtDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

export function fmtElapsed(startedAt: number): string {
  return fmtDuration((Date.now() - startedAt) / 1000);
}
