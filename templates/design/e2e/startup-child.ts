import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const STARTUP_OUTPUT_LIMIT = 2_000;
const CHILD_CLOSE_TIMEOUT_MS = 1_000;
export const E2E_CHILD_STARTUP_TIMEOUT_MS = 10_000;
export const E2E_CHILD_STARTUP_RETRY_MS = 50;

interface StartE2EChildWithReadinessOptions {
  serviceName: string;
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  pidPath: string;
  readinessTarget: string;
  readinessTimeoutMs?: number;
  readinessRetryMs?: number;
  childCloseTimeoutMs?: number;
  spawnChild?: typeof spawn;
  checkReady: () => Promise<void>;
}

interface ChildExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

function formatStartupStderr(stderr: string): string {
  const output = stderr.trim();
  return output
    ? `\nStartup stderr:\n${output}`
    : "\nStartup stderr was empty.";
}

function processExit(child: ChildProcess, observed?: ChildExit) {
  return (
    observed ??
    (child.exitCode !== null || child.signalCode !== null
      ? { code: child.exitCode, signal: child.signalCode }
      : undefined)
  );
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function startE2EChildWithReadiness(
  options: StartE2EChildWithReadinessOptions,
): Promise<void> {
  const {
    serviceName,
    command,
    args,
    env,
    pidPath,
    readinessTarget,
    readinessTimeoutMs = E2E_CHILD_STARTUP_TIMEOUT_MS,
    readinessRetryMs = E2E_CHILD_STARTUP_RETRY_MS,
    childCloseTimeoutMs = CHILD_CLOSE_TIMEOUT_MS,
    spawnChild = spawn,
    checkReady,
  } = options;
  const child = spawnChild(command, args, {
    detached: true,
    stdio: ["ignore", "ignore", "pipe"],
    env,
  });

  let spawnError: Error | undefined;
  let childExit: ChildExit | undefined;
  let childClosed = false;
  let stderrTail = "";
  let captureStartupStderr = true;
  let resolveClosed: (() => void) | undefined;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  child.stderr?.on("data", (chunk: Buffer | string) => {
    if (captureStartupStderr) {
      stderrTail = `${stderrTail}${chunk.toString()}`.slice(
        -STARTUP_OUTPUT_LIMIT,
      );
    }
  });
  child.once("error", (error) => {
    spawnError = error;
  });
  child.once("exit", (code, signal) => {
    childExit = { code, signal };
  });
  child.once("close", () => {
    childClosed = true;
    resolveClosed?.();
  });

  const waitForClose = async (timeoutMs: number): Promise<boolean> => {
    if (childClosed) return true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<false>((resolve) => {
      timeout = setTimeout(() => resolve(false), timeoutMs);
    });
    const didClose = await Promise.race([closed.then(() => true), timedOut]);
    if (timeout) clearTimeout(timeout);
    return didClose;
  };

  const stopOwnedChild = async () => {
    if (!child.pid) {
      if (!(await waitForClose(childCloseTimeoutMs))) {
        throw new Error(`${serviceName} spawn did not close after failure.`);
      }
      return;
    }

    if (!processExit(child, childExit) && !childClosed) {
      child.kill("SIGTERM");
    }
    if (await waitForClose(childCloseTimeoutMs)) return;

    child.kill("SIGKILL");
    if (!(await waitForClose(childCloseTimeoutMs))) {
      throw new Error(`${serviceName} did not close after SIGKILL.`);
    }
  };

  const assertChildRunning = async () => {
    if (spawnError) {
      await waitForClose(childCloseTimeoutMs);
      throw new Error(
        `${serviceName} spawn failed: ${spawnError.message}${formatStartupStderr(stderrTail)}`,
      );
    }
    const exit = processExit(child, childExit);
    if (exit) {
      await waitForClose(childCloseTimeoutMs);
      throw new Error(
        `${serviceName} exited before readiness (code ${exit.code ?? "none"}, signal ${exit.signal ?? "none"}).${formatStartupStderr(stderrTail)}`,
      );
    }
  };

  try {
    if (!child.pid) {
      await waitForClose(childCloseTimeoutMs);
      throw new Error(
        `${serviceName} spawn failed: ${spawnError?.message ?? "process did not start"}${formatStartupStderr(stderrTail)}`,
      );
    }

    await mkdir(path.dirname(pidPath), { recursive: true });
    await writeFile(pidPath, String(child.pid));

    const deadline = Date.now() + readinessTimeoutMs;
    let readinessAttempts = 0;
    let lastError = "no readiness response completed";
    while (Date.now() < deadline) {
      await assertChildRunning();
      readinessAttempts += 1;
      try {
        await checkReady();
        await assertChildRunning();
        const stderr = child.stderr as
          | (NodeJS.ReadableStream & { unref?: () => void })
          | null;
        if (!stderr || typeof stderr.unref !== "function") {
          throw new Error(`${serviceName} stderr pipe cannot be unreferenced.`);
        }
        captureStartupStderr = false;
        stderr.unref();
        child.unref();
        return;
      } catch (error) {
        await assertChildRunning();
        lastError = error instanceof Error ? error.message : String(error);
      }
      await wait(readinessRetryMs);
    }

    await assertChildRunning();
    throw new Error(
      `${serviceName} did not become ready ${readinessTarget} after ${readinessTimeoutMs} ms (${readinessAttempts} attempts): ${lastError}${formatStartupStderr(stderrTail)}`,
    );
  } catch (error) {
    let cleanupError: unknown;
    let childStopped = false;
    try {
      await stopOwnedChild();
      childStopped = true;
    } catch (stopError) {
      cleanupError = stopError;
    }
    if (childStopped) {
      try {
        await rm(pidPath, { force: true });
      } catch (removeError) {
        cleanupError = removeError;
      }
    }
    if (cleanupError) {
      throw new Error(
        `${serviceName} startup failed (${String(error)}) and cleanup was incomplete (${String(cleanupError)}).`,
      );
    }
    throw error;
  }
}
