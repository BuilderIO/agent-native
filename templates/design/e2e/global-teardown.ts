import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

function runId(): string | undefined {
  const value = process.env.E2E_RUN_ID;
  return value && /^[A-Za-z0-9_-]+$/.test(value) ? value : undefined;
}

export interface DesignE2eCleanupPaths {
  pgliteDir?: string;
  resultsDir?: string;
}

export function designE2eRunRoot(
  designDir: string,
  configuredRoot = process.env.E2E_RUN_ROOT,
  id = runId(),
): string | undefined {
  if (configuredRoot) return path.resolve(configuredRoot);
  if (!id) return undefined;
  return path.join(designDir, "..", "..", ".tmp", "design-e2e", id);
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
  const runRoot = designE2eRunRoot(designDir, process.env.E2E_RUN_ROOT, id);
  if (!runRoot) return;
  const pgliteDir = path.join(runRoot, "pglite");
  const resultsDir = path.join(designDir, "test-results", id);
  const loopbackPidPath = path.join(runRoot, "loopback-provider.pid");
  if (
    process.env.E2E_AI_SIDEBAR_LOOPBACK === "1" &&
    existsSync(loopbackPidPath)
  ) {
    const pid = Number(readFileSync(loopbackPidPath, "utf8"));
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
    rmSync(loopbackPidPath, { force: true });
  }
  const cleanup = (exitCode: number) => {
    try {
      cleanupDesignE2eArtifacts({ pgliteDir, resultsDir }, exitCode);
    } catch (error) {
      console.error(
        `[e2e] could not clean run artifacts: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  process.once("exit", cleanup);
}
