/**
 * Guard: the docs route ErrorBoundary must attempt stale-chunk recovery and
 * log any error it doesn't recover from.
 *
 * root.tsx has its own localized `LocalizedError` UI instead of reusing
 * `@agent-native/core/client/ui`'s ErrorBoundary (every other template does
 * `export { ErrorBoundary } from "@agent-native/core/client/ui"`, which
 * already does both of these things). Before this guard, a React.lazy()
 * chunk load failure (e.g. LazyAgentSidebar's chunk 404ing after a deploy)
 * reached this boundary as a plain render error — not an
 * unhandledrejection/error event, so installRouteChunkRecovery's global
 * listeners never fired — and the boundary rendered a static "Something
 * went wrong" screen with the underlying error discarded: no recovery
 * attempt, nothing logged to console/Sentry. That is the leading
 * explanation for the 2026-08-06 incident (Kate Venezia): clean in
 * incognito (fresh asset manifest), fixed by restarting the desktop app
 * (evicts the stale module registry), and unexplained because nothing
 * captured the real error.
 *
 * This only checks that the wiring is present in source; the recovery
 * behavior itself is covered by
 * packages/core/src/client/route-chunk-recovery.spec.ts and the
 * classification logic by ./docs-error-classification.spec.ts.
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("docs root ErrorBoundary", () => {
  const source = fs.readFileSync(
    path.join(import.meta.dirname, "root.tsx"),
    "utf8",
  );

  it("imports stale-chunk recovery", () => {
    expect(source).toContain(
      'import { recoverFromStaleChunkError } from "@agent-native/core/client/route-chunk-recovery";',
    );
  });

  it("attempts recovery before rendering the generic error screen", () => {
    expect(source).toMatch(/recoverFromStaleChunkError\(error\)/);
  });

  it("logs any error it does not recover from", () => {
    expect(source).toContain('console.error("[DocsErrorBoundary]", error)');
  });
});
