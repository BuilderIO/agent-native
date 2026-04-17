/**
 * Resolve the user-facing name of this app — used in transactional emails,
 * page titles, and anywhere the framework needs to refer to "this app" by
 * name (e.g. "John invited you to Acme on Forms").
 *
 * Resolution order:
 *   1. `APP_NAME` env var — explicit override (recommended for prod)
 *   2. `displayName` from the app's package.json
 *   3. Titlecased `name` from package.json
 *   4. `undefined` — caller should degrade gracefully
 */

import path from "node:path";
import fs from "node:fs";

let cachedFromPkg: string | undefined | null = null;

function readPkg(): { name?: string; displayName?: string } | null {
  try {
    const pkgPath = path.join(process.cwd(), "package.json");
    return JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  } catch {
    return null;
  }
}

function titlecase(s: string): string {
  return s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

export function getAppName(): string | undefined {
  if (process.env.APP_NAME) return process.env.APP_NAME;
  if (cachedFromPkg !== null) return cachedFromPkg ?? undefined;
  const pkg = readPkg();
  const name =
    pkg?.displayName ?? (pkg?.name ? titlecase(pkg.name) : undefined);
  cachedFromPkg = name ?? undefined;
  return name;
}
