/**
 * Stop the in-flight agent runs a service principal owns.
 *
 * Suspending a principal blocks NEW work at admission, but a run that started
 * before the suspend keeps spending its tool budget until it ends. Containment
 * aborts those runs so "suspended" means stopped, not "stops eventually".
 *
 * A run's owner is its chat thread's `owner_email`. `abortRunDurably` logs and
 * swallows a failed SQL write, so the outcome is re-read from `agent_runs`:
 * a run still `running` afterwards is reported, never counted as aborted.
 */
import { ensureChatThreadTables } from "../chat-threads/store.js";
import { getDbExec } from "../db/client.js";
import { serviceIdentityEmail } from "../mcp/connect-store.js";
import { abortRunDurably } from "./run-manager.js";
import { ensureRunTables, getRunStatus } from "./run-store.js";

/** Terminal reason recorded on the aborted runs; the client shows it as a stopped run. */
export const PRINCIPAL_SUSPENDED_ABORT_REASON = "principal-suspended";

export interface ContainmentResult {
  abortedRuns: number;
  /** One entry per run that could not be confirmed stopped. Empty means contained. */
  containmentErrors: string[];
}

export async function containServicePrincipal(
  orgId: string,
  serviceName: string,
  reason: string = PRINCIPAL_SUSPENDED_ABORT_REASON,
): Promise<ContainmentResult> {
  const email = serviceIdentityEmail(serviceName, orgId).toLowerCase();
  await ensureRunTables();
  await ensureChatThreadTables();
  const { rows } = await getDbExec().execute({
    sql: `SELECT r.id FROM agent_runs r
          JOIN chat_threads t ON t.id = r.thread_id
          WHERE r.status = 'running' AND LOWER(t.owner_email) = ?`,
    args: [email],
  });

  const result: ContainmentResult = { abortedRuns: 0, containmentErrors: [] };
  for (const row of rows) {
    const runId = String(row.id);
    try {
      await abortRunDurably(runId, reason);
      const status = await getRunStatus(runId);
      if (status === "running") {
        result.containmentErrors.push(`${runId}: still running after abort`);
      } else {
        result.abortedRuns += 1;
      }
    } catch (error) {
      result.containmentErrors.push(
        `${runId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return result;
}
