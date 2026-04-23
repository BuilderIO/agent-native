/**
 * Resolve the user-facing name of this app — used in transactional emails,
 * page titles, and anywhere the framework needs to refer to "this app" by
 * name (e.g. "John invited you to Acme on Forms").
 *
 * Resolution order:
 *   1. `APP_NAME` env var — explicit override (recommended for prod)
 *   2. `displayName` from the app's package.json
 *   3. Titlecased `name` from package.json (only if it matches a known
 *      first-party template — on serverless runtimes `process.cwd()` may
 *      point at a bundler-generated package.json with a bogus name)
 *   4. First-party template label matched by package.json name
 *   5. `undefined` — caller should degrade gracefully
 */

import path from "node:path";
import fs from "node:fs";
import { TEMPLATES } from "../cli/templates-meta.js";

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
  let name: string | undefined;
  if (pkg?.displayName) {
    name = pkg.displayName;
  } else if (pkg?.name) {
    const tmpl = TEMPLATES.find((t) => t.name === pkg.name);
    name = tmpl ? tmpl.label || titlecase(tmpl.name) : undefined;
  }
  cachedFromPkg = name ?? undefined;
  return name;
}
