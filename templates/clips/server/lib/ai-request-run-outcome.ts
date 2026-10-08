import { parseAiRequestTabId } from "../../shared/ai-request-status.js";
import { settleAiRequestStatus } from "../../actions/lib/ai-request-status.js";

interface FinishedRun {
  threadId: string;
  status: "running" | "completed" | "truncated" | "errored" | "aborted";
  abortReason?: string;
  events: ReadonlyArray<{ event: { type: string; error?: unknown } }>;
}

function lastErrorMessage(run: FinishedRun): string | null {
  for (let i = run.events.length - 1; i >= 0; i -= 1) {
    const { event } = run.events[i];
    if (event.type === "error" && typeof event.error === "string") {
      return event.error.slice(0, 500);
    }
  }
  return null;
}

/**
 * Background AI requests run on a thread named by `aiRequestTabId`. When the
 * turn ends without the agent reporting a result, record what actually
 * happened instead of leaving the request looking busy forever.
 */
export async function settleAiRequestRunOutcome(
  run: FinishedRun,
  outcome: { turnContinues: boolean },
): Promise<void> {
  if (outcome.turnContinues || run.status === "running") return;
  const request = parseAiRequestTabId(run.threadId);
  if (!request) return;

  switch (run.status) {
    case "aborted":
      await settleAiRequestStatus(
        request,
        "cancelled",
        run.abortReason ?? null,
      );
      return;
    case "errored":
      await settleAiRequestStatus(
        request,
        "failed",
        lastErrorMessage(run) ?? "The agent run failed.",
      );
      return;
    case "truncated":
      await settleAiRequestStatus(
        request,
        "failed",
        "The agent run stopped before finishing.",
      );
      return;
    case "completed":
      await settleAiRequestStatus(
        request,
        "failed",
        "The agent finished without reporting a result. Check the clip before retrying.",
      );
      return;
  }
}
