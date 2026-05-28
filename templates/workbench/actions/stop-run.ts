/**
 * Stop a running agent-native run. Verifies the caller owns the run's
 * parent thread, then flips the `agent_runs` row to `status = 'aborted'`.
 *
 * The framework's in-process `abortRun()` (run-manager) checks SQL for the
 * aborted flag every ~3s and tears down the in-memory producer when it
 * notices — so writing to SQL is sufficient even if this request runs in a
 * different isolate from the producer. (This is the same path the framework
 * uses internally to support cross-isolate aborts on Workers.)
 */
import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getDbExec } from "@agent-native/core/db";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";

export default defineAction({
  description: "Stop a running agent-native run.",
  schema: z.object({
    runId: z.string().min(1).describe("Run id to stop"),
    reason: z
      .string()
      .max(120)
      .optional()
      .describe("Optional abort reason (defaults to 'user')."),
  }),
  run: async ({ runId, reason }) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) {
      return { ok: false, error: "Sign in required." };
    }

    const client = getDbExec();

    // Ownership check via the parent thread.
    const { rows } = await client.execute({
      sql: `
        SELECT r.id, r.status
        FROM agent_runs r
        INNER JOIN chat_threads t ON t.id = r.thread_id
        WHERE r.id = ? AND t.owner_email = ?
      `,
      args: [runId, userEmail],
    });

    if (rows.length === 0) {
      return { ok: false, error: "Run not found or access denied." };
    }

    const row = rows[0] as { id: string; status: string };
    if (row.status !== "running") {
      return {
        ok: true,
        runId,
        status: row.status,
        message: `Run is already ${row.status}.`,
      };
    }

    // Flip the row to aborted. The producer's heartbeat polls the abort
    // state every ~3s and tears down the in-memory run when it sees this.
    await client.execute({
      sql: `UPDATE agent_runs
            SET status = 'aborted', abort_reason = ?, completed_at = ?
            WHERE id = ?`,
      args: [reason ?? "user", Date.now(), runId],
    });

    return {
      ok: true,
      runId,
      status: "aborted",
      message: "Run stopped.",
    };
  },
});
