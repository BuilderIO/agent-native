import { rmSync } from "node:fs";
import path from "node:path";

function runId(): string | undefined {
  const value = process.env.E2E_RUN_ID;
  return value && /^[A-Za-z0-9_-]+$/.test(value) ? value : undefined;
}

export interface DesignE2eCleanupPaths {
  pgliteDir?: string;
  resultsDir?: string;
}

export function cleanupDesignE2eArtifacts(
  paths: DesignE2eCleanupPaths,
  exitCode: number,
  remove: (path: string) => void = (target) =>
    rmSync(target, { force: true, recursive: true }),
): void {
  if (exitCode !== 0) return;
  for (const target of [paths.pgliteDir, paths.resultsDir]) {
    if (target) remove(target);
  }
}

export default async function globalTeardown(): Promise<void> {
  const id = runId();
  if (!id) return;

  const designDir = path.resolve(import.meta.dirname, "..");
  const runRoot = path.join(designDir, "..", "..", ".tmp", "design-e2e", id);
  const pgliteDir = path.join(runRoot, "pglite");
  const resultsDir = path.join(designDir, "test-results", id);
  const cleanup = (exitCode: number) => {
    try {
      cleanupDesignE2eArtifacts({ pgliteDir, resultsDir }, exitCode);
    } catch (error) {
      console.error(
        `[e2e] could not clean run artifacts: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  // Playwright runs global teardown before it publishes the final status. The
  // exit event is the first boundary that reliably distinguishes pass (0) from
  // failure, while the run id keeps cleanup scoped to this invocation.
  process.once("exit", cleanup);
}
