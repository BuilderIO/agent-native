/**
 * Durable background execution for the `run-code` tool.
 *
 * The hosted agent loop runs under a soft wall-clock ceiling (~40s on
 * serverless): a foreground `run-code` call that outlives it is aborted and —
 * because `run-code` is readOnly — its result is simply lost. This module is
 * the queued, durable alternative wired through the existing sandbox-adapter
 * seam: enqueue the raw code to SQL (`sandbox_executions`), return
 * `{ executionId, status: "queued" }` immediately, and let an executor with
 * its own budget claim the row, run it through the local sandbox machinery,
 * and persist the result for later polling.
 *
 * Execution drivers, by deployment mode:
 *  1. Serverless (Netlify/Vercel/Lambda/CF): `fireInternalDispatch` POSTs to
 *     `/_agent-native/sandbox/_process-execution` on this same deployment, so
 *     the code runs in a FRESH function invocation with its own full budget —
 *     the same self-dispatch pattern A2A, integration webhooks, and Agent
 *     Teams use. HMAC-verified via the shared internal-token scheme.
 *  2. Long-lived Node (self-hosted, local dev): the execution starts in-process
 *     immediately after enqueue, detached from the enqueueing tool call.
 *  3. Opportunistic drain: every status poll re-drives a row that is still
 *     `queued` (lost dispatch) or whose lease expired (dead executor), and a
 *     periodic warm-instance sweep (`drainDueSandboxExecutions`, mounted by
 *     the core routes plugin) does the same as a backstop.
 *
 * The executor itself never re-enters adapter selection (that could recurse
 * into this queue when `AGENT_NATIVE_SANDBOX=background`): the runner
 * registered by `createRunCodeEntry` executes through the non-queued adapter
 * (the local child process by default), with the bridge/env-scrub/module
 * building unchanged from the foreground path.
 */

import crypto from "node:crypto";

import type { ActionRunContext } from "../../action.js";
import { isServerlessRuntime } from "../../db/client.js";
import { runWithRequestContext } from "../../server/request-context.js";
import { fireInternalDispatch } from "../../server/self-dispatch.js";
import type { SandboxAdapter, SandboxRunResult } from "./adapter.js";
import {
  claimSandboxExecution,
  createSandboxExecution,
  failExpiredSandboxExecution,
  finalizeSandboxExecution,
  getSandboxExecutionInternal,
  listDueSandboxExecutions,
  renewSandboxExecutionLease,
  type SandboxExecutionRow,
} from "./executions-store.js";

export const SANDBOX_PROCESS_EXECUTION_PATH =
  "/_agent-native/sandbox/_process-execution";

export const BACKGROUND_DEFAULT_TIMEOUT_MS = 10 * 60_000;
export const BACKGROUND_MAX_TIMEOUT_MS = 30 * 60_000;
export const SANDBOX_EXECUTION_LEASE_MS = 90_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
export const SANDBOX_EXECUTION_REDRIVE_AFTER_MS = 15_000;

export interface SandboxExecutionRunInput {
  code: string;
  timeoutMs: number;
  context?: ActionRunContext;
}

export interface SandboxExecutionRunOutput {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  bridgeToolsUsed: string[];
}

export interface SandboxExecutionRunner {
  execute(input: SandboxExecutionRunInput): Promise<SandboxExecutionRunOutput>;
}

let registeredRunner: SandboxExecutionRunner | undefined;

export function registerSandboxExecutionRunner(
  runner: SandboxExecutionRunner,
  options: { replace?: boolean } = {},
): void {
  if (registeredRunner && !options.replace) return;
  registeredRunner = runner;
}

export function getSandboxExecutionRunner():
  | SandboxExecutionRunner
  | undefined {
  return registeredRunner;
}

export function resetSandboxBackgroundForTests(): void {
  registeredRunner = undefined;
}

export class BackgroundQueueAdapter implements SandboxAdapter {
  readonly id = "background-queue";
  readonly queued = true as const;

  async run(): Promise<SandboxRunResult> {
    throw new Error(
      "BackgroundQueueAdapter does not execute prepared modules directly. " +
        "Background executions are enqueued by run-code with the raw code and " +
        "executed later by the registered sandbox execution runner.",
    );
  }
}

export function isQueuedSandboxAdapter(
  adapter: SandboxAdapter | null | undefined,
): boolean {
  return Boolean(adapter && (adapter as { queued?: boolean }).queued === true);
}

export interface EnqueueSandboxExecutionInput {
  code: string;
  timeoutMs: number;
  maxOutputChars: number;
  owner: string;
  orgId?: string | null;
  threadId?: string | null;
  allowedActionNames?: readonly string[];
}

export interface EnqueueSandboxExecutionResult {
  execution: SandboxExecutionRow;
  driveNote?: string;
}

export async function enqueueSandboxExecution(
  input: EnqueueSandboxExecutionInput,
): Promise<EnqueueSandboxExecutionResult> {
  const execution = await createSandboxExecution({
    owner: input.owner,
    orgId: input.orgId ?? null,
    threadId: input.threadId ?? null,
    code: input.code,
    timeoutMs: input.timeoutMs,
    maxOutputChars: input.maxOutputChars,
    allowedActionNames: input.allowedActionNames,
  });
  let driveNote: string | undefined;
  try {
    await driveSandboxExecution(execution.id);
  } catch (err) {
    driveNote =
      "Initial dispatch could not be confirmed; the execution stays queued " +
      "and will start on the next status poll or background sweep. " +
      `(${err instanceof Error ? err.message : String(err)})`;
    console.error(
      `[run-code] background execution ${execution.id} initial drive failed:`,
      err,
    );
  }
  return { execution, driveNote };
}

export async function driveSandboxExecution(
  executionId: string,
  options: { event?: unknown } = {},
): Promise<void> {
  if (isServerlessRuntime()) {
    await fireInternalDispatch({
      path: SANDBOX_PROCESS_EXECUTION_PATH,
      taskId: executionId,
      event: options.event,
      body: { executionId },
    });
    return;
  }
  void processQueuedSandboxExecution(executionId).catch((err) => {
    console.error(
      `[run-code] in-process background execution ${executionId} failed:`,
      err,
    );
  });
}

export interface ProcessSandboxExecutionResult {
  status:
    | "completed"
    | "already_claimed"
    | "not_found"
    | "not_due"
    | "runner_unavailable";
  finalStatus?: SandboxExecutionRow["status"];
}

export async function processQueuedSandboxExecution(
  executionId: string,
): Promise<ProcessSandboxExecutionResult> {
  const row = await getSandboxExecutionInternal(executionId);
  if (!row) return { status: "not_found" };
  const now = Date.now();
  const leaseExpired =
    row.status === "running" &&
    row.leaseExpiresAt !== null &&
    row.leaseExpiresAt < now;
  if (row.status !== "queued" && !leaseExpired) {
    return { status: "not_due", finalStatus: row.status };
  }

  const runner = getSandboxExecutionRunner();
  if (!runner) {
    console.error(
      `[run-code] no sandbox execution runner registered; leaving ${executionId} queued.`,
    );
    return { status: "runner_unavailable" };
  }

  const claimToken = crypto.randomUUID();
  const claimed = await claimSandboxExecution(
    executionId,
    claimToken,
    SANDBOX_EXECUTION_LEASE_MS,
    now,
  );
  if (!claimed) {
    // Either another executor won the race, or attempts ran out. Reap the
    // exhausted-expired case so the row cannot stay "running" forever.
    if (leaseExpired && row.attemptCount >= row.maxAttempts) {
      const reapedNow = await failExpiredSandboxExecution(
        executionId,
        `Executor lease expired after ${row.attemptCount} attempt(s); the execution environment was likely terminated before the code finished. Split the computation into smaller chunks or persist intermediate results (e.g. workspaceWrite) and run again.`,
        now,
      );
      if (reapedNow) return { status: "completed", finalStatus: "failed" };
      const current = await getSandboxExecutionInternal(executionId);
      return current && current.status !== "running"
        ? { status: "completed", finalStatus: current.status }
        : { status: "already_claimed" };
    }
    return { status: "already_claimed" };
  }

  const heartbeat = setInterval(() => {
    renewSandboxExecutionLease(
      executionId,
      claimToken,
      SANDBOX_EXECUTION_LEASE_MS,
    ).catch(() => {
      // Best-effort — a failed heartbeat just means the lease may expire and
      // another executor could reclaim; finalize is claim-token-guarded.
    });
  }, HEARTBEAT_INTERVAL_MS);
  (heartbeat as { unref?: () => void }).unref?.();

  try {
    const context: ActionRunContext = {
      caller: "tool",
      userEmail: claimed.owner,
      orgId: claimed.orgId,
      threadId: claimed.threadId ?? undefined,
      actionName: "run-code",
    };
    const output = await runWithRequestContext(
      {
        userEmail: claimed.owner,
        orgId: claimed.orgId ?? undefined,
        run:
          claimed.allowedActionNames === undefined
            ? undefined
            : { allowedActionNames: claimed.allowedActionNames },
      },
      () =>
        runner.execute({
          code: claimed.code,
          timeoutMs: claimed.timeoutMs,
          context,
        }),
    );
    const finalStatus = output.timedOut
      ? "timed_out"
      : output.exitCode === 0
        ? "succeeded"
        : "failed";
    await finalizeSandboxExecution(executionId, claimToken, {
      status: finalStatus,
      stdout: output.stdout,
      stderr: output.stderr,
      exitCode: output.exitCode,
      timedOut: output.timedOut,
      bridgeToolsUsed: output.bridgeToolsUsed,
      error: output.timedOut
        ? `Execution exceeded its ${claimed.timeoutMs}ms background timeout and was terminated.`
        : null,
    });
    return { status: "completed", finalStatus };
  } catch (err) {
    await finalizeSandboxExecution(executionId, claimToken, {
      status: "failed",
      error: `Sandbox executor error: ${err instanceof Error ? err.message : String(err)}`,
    });
    return { status: "completed", finalStatus: "failed" };
  } finally {
    clearInterval(heartbeat);
  }
}

export async function drainDueSandboxExecutions(
  options: { limit?: number; event?: unknown } = {},
): Promise<number> {
  let due: Awaited<ReturnType<typeof listDueSandboxExecutions>>;
  try {
    due = await listDueSandboxExecutions({
      limit: options.limit ?? 5,
      queuedOlderThanMs: SANDBOX_EXECUTION_REDRIVE_AFTER_MS,
    });
  } catch {
    return 0;
  }
  let driven = 0;
  for (const item of due) {
    try {
      const expired =
        item.status === "running" &&
        item.leaseExpiresAt !== null &&
        item.leaseExpiresAt < Date.now();
      if (expired && item.attemptCount >= item.maxAttempts) {
        await failExpiredSandboxExecution(
          item.id,
          `Executor lease expired after ${item.attemptCount} attempt(s); the execution environment was likely terminated before the code finished. Split the computation into smaller chunks or persist intermediate results (e.g. workspaceWrite) and run again.`,
        );
        driven += 1;
        continue;
      }
      await driveSandboxExecution(item.id, { event: options.event });
      driven += 1;
    } catch {
      // Best-effort per row.
    }
  }
  return driven;
}
