/**
 * Resume an agent-native run by reopening the agent chat for the run's
 * thread.
 *
 * The framework's `run-manager` doesn't have a server-side "resume run"
 * primitive — runs are tied to chat threads, so the natural way to "resume"
 * is to focus the agent chat on the thread and let the user send their next
 * message. (Or, when `message` is provided, the UI / agent chat composer
 * picks it up and submits it.) This action does the server-side ownership
 * check and returns the thread id + composer payload so the UI can call
 * `sendToAgentChat({ threadId, message })`.
 *
 * Resuming a still-running run is a no-op other than focusing the chat.
 */
import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getDbExec } from "@agent-native/core/db";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";

export default defineAction({
  description:
    "Resume an agent-native run. Opens the agent chat for the run's thread and optionally pre-submits a follow-up message.",
  schema: z.object({
    runId: z.string().min(1).describe("Run id to resume"),
    message: z
      .string()
      .max(8000)
      .optional()
      .describe(
        "Optional follow-up message to send to the run's chat thread. If omitted, just focuses the chat for manual reply.",
      ),
  }),
  run: async ({ runId, message }) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) {
      return { ok: false, error: "Sign in required." };
    }

    const client = getDbExec();

    const { rows } = await client.execute({
      sql: `
        SELECT r.id, r.thread_id, r.status, t.title
        FROM agent_runs r
        INNER JOIN chat_threads t ON t.id = r.thread_id
        WHERE r.id = ? AND t.owner_email = ?
      `,
      args: [runId, userEmail],
    });

    if (rows.length === 0) {
      return { ok: false, error: "Run not found or access denied." };
    }

    const row = rows[0] as {
      id: string;
      thread_id: string;
      status: string;
      title: string | null;
    };

    // Drop a one-shot resume request the agent chat composer picks up. The
    // UI watches for `workbench-resume-run` in application_state and opens
    // the chat for the matching thread, pre-filling `message` when present.
    await writeAppState("workbench-resume-run", {
      runId,
      threadId: row.thread_id,
      message: message ?? null,
      ts: Date.now(),
    });

    return {
      ok: true,
      runId,
      threadId: row.thread_id,
      title: row.title ?? "Untitled run",
      previousStatus: row.status,
      hasMessage: Boolean(message && message.trim().length > 0),
      message: message ?? null,
    };
  },
});
