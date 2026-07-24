import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const currentDir = dirname(fileURLToPath(import.meta.url));

interface PackageJson {
  readonly version?: string;
}

function readVersion(): string {
  try {
    // dist/utils/version.js and src/utils/version.ts are both exactly two
    // directories below the backend root (dist/../.. and src/../.. both
    // land on package.json), so this resolves identically in dev (tsx,
    // running src/ directly) and in the built/Docker image (dist/).
    const raw = readFileSync(join(currentDir, "..", "..", "package.json"), "utf-8");
    const pkg = JSON.parse(raw) as PackageJson;
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** Read once at module load — package.json doesn't change at runtime. */
export const appVersion: string = readVersion();
