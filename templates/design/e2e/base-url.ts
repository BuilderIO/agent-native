/**
 * The one place that decides where the E2E suite points.
 *
 * This existed 44 times, in five spellings, across ~35 spec files. One of
 * them defaulted to port 9340 while the config served 9333, so all four of
 * its tests failed in ~50ms against a port nothing listens on — in CI, for
 * eight weeks, unnoticed. Seven more resolved `E2E_BASE_URL` but never
 * consulted `E2E_PORT`, so they silently ignored a custom port.
 *
 * Deliberately imports nothing: `helpers.ts` imports from `global-setup.ts`,
 * and both need this, so anything with a dependency here would be a cycle.
 *
 * Precedence is caller -> E2E_BASE_URL -> E2E_PORT -> the config default. A
 * spec that already reads Playwright's `project.use.baseURL` keeps winning:
 * `project.use.baseURL ?? e2eBaseURL()`.
 */

/** Must match `PORT` in playwright.config.ts. */
const DEFAULT_PORT = "9333";

export function e2eBaseURL(): string {
  const explicit = process.env.E2E_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const port = process.env.E2E_PORT?.trim() || DEFAULT_PORT;
  // A non-numeric port would build a URL that fails as "connection refused"
  // — indistinguishable from an app that failed to boot. Say which it is.
  if (!/^\d+$/.test(port)) {
    throw new Error(
      `E2E_PORT must be numeric, got ${JSON.stringify(process.env.E2E_PORT)}.`,
    );
  }
  return `http://127.0.0.1:${port}`; // e2e-harness-ignore — the single source
}
