import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Static-analysis test, not a behavioral one: fails the build if anyone
// adds a branching construct on componentType to src/domain/alerting, even
// though every current file already avoids it. The whole point of the
// Strategy pattern here is that adding a component type is "write a class
// and register it," never "add another arm to a conditional" — this is
// what actually enforces that, rather than just hoping code review catches
// a regression.
const currentDir = dirname(fileURLToPath(import.meta.url));
const ALERTING_SRC_DIR = join(currentDir, "..", "..", "..", "..", "src", "domain", "alerting");

function collectTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectTsFiles(fullPath);
    }
    return entry.name.endsWith(".ts") ? [fullPath] : [];
  });
}

const files = collectTsFiles(ALERTING_SRC_DIR);

describe("src/domain/alerting source", () => {
  it("scanned at least the expected number of files (the scan itself isn't silently vacuous)", () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it.each(files)("contains no switch statement: %s", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).not.toMatch(/\bswitch\s*\(/);
  });

  it.each(files)("contains no if-statement branching on componentType: %s", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).not.toMatch(/if\s*\([^)]*componentType/);
  });
});
