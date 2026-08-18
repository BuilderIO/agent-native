/**
 * Deployment identity shared by every error-reporting backend.
 *
 * These were originally Sentry-private helpers. They describe the deployment,
 * not the vendor, and a second backend that reports errors without them
 * produces issues nobody can tie to a release.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function firstNonEmpty(
  ...values: Array<string | undefined>
): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

/** The deploy environment name, e.g. `production`, `deploy-preview`. */
export function resolveDeployEnvironment(): string {
  return (
    firstNonEmpty(
      process.env.SENTRY_ENVIRONMENT,
      process.env.NETLIFY_CONTEXT,
      process.env.VERCEL_ENV,
      process.env.NODE_ENV,
    ) ?? "production"
  );
}

/**
 * Resolve the agent-native version baked into core's package.json so the
 * reported "release" reflects the running framework version. Mirrors how the
 * CLI computes `_version` — same dist layout, same fallback string. Guarded so
 * a missing/unreadable package.json never crashes server boot.
 */
export function resolveServerRelease(): string {
  const explicit = process.env.AGENT_NATIVE_RELEASE;
  if (explicit) return explicit;
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // dist/server/deploy-environment.js → ../../package.json
    const pkgPath = path.resolve(here, "../../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
      version?: string;
    };
    if (pkg?.version) return `agent-native-server@${pkg.version}`;
    // coercion-ok: falls through to the distinct "unknown" release marker
  } catch {
    // ignore — fall through to "unknown"
  }
  return "agent-native-server@unknown";
}
