import { resolveBackgroundRunHardTimeoutMs } from "../agent/run-manager.js";
import {
  countRunsForTurn,
  getCurrentTurnEventsForThread,
  getRunById,
  getRunTurnRef,
  reapIfStale,
  STALE_RUN_RECOVERY_MAX_SUCCESSORS_PER_TURN,
} from "../agent/run-store.js";
import type { AgentChatEvent } from "../agent/types.js";
import { automationRecoveryMessagesForLocale } from "../localization/automation-recovery-messages.js";
import type { LocaleCode } from "../localization/shared.js";
import {
  organizationResourceOwner,
  type Resource,
} from "../resources/store.js";
import { withDeliveryNote } from "./automation-outcome.js";
import {
  recoveredFactoryOwnerOrgId,
  type JobFrontmatter,
} from "./frontmatter.js";
import { listAutomationRuns, type AutomationRun } from "./run-history.js";

export interface AutomationResume {
  historyId: string;
  threadId: string;
  turnId: string;
  previousRunId: string;
  hardDeadlineAt: number;
}

export function automationHistoryOwner(
  resource: Resource,
  ownerEmail: string,
  orgId?: string,
): string {
  return orgId
    ? organizationResourceOwner(orgId)
    : resource.owner === "__shared__"
      ? ownerEmail
      : resource.owner;
}

export type AutomationRecovery =
  | { state: "active" }
  | { state: "resume"; resume: AutomationResume }
  | {
      state: "settle";
      status: "success" | "error";
      history: AutomationRun;
      error?: string;
      errorCode?: string;
    };

export function deliveryNoteForEvents(
  events: readonly AgentChatEvent[] | null,
  locale?: LocaleCode,
): string {
  const messages = automationRecoveryMessagesForLocale(locale);
  if (events === null) return messages.unreadable;
  const confirmed = events
    .filter(
      (event) =>
        event.type === "tool_done" &&
        event.completedSideEffect === true &&
        event.isError !== true &&
        !event.replayed,
    )
    .map(
      (event) => (event as Extract<AgentChatEvent, { type: "tool_done" }>).tool,
    );
  return confirmed.length > 0
    ? messages.confirmed.replace(
        "{{tools}}",
        [...new Set(confirmed)].join(", "),
      )
    : messages.unknown;
}

export function automationDeliveryNote(
  message: string,
  events: readonly AgentChatEvent[],
): string {
  return withDeliveryNote(message, deliveryNoteForEvents(events));
}

export async function inspectAutomationRecovery(
  resource: Resource,
  meta: JobFrontmatter,
  now: Date,
): Promise<AutomationRecovery | null> {
  const lastRun = meta.lastRun ? Date.parse(meta.lastRun) : Number.NaN;
  if (!Number.isFinite(lastRun)) return null;
  const histories = await listAutomationRuns({
    owners: [
      automationHistoryOwner(
        resource,
        meta.runAs === "shared"
          ? resource.owner
          : meta.createdBy || resource.owner,
        recoveredFactoryOwnerOrgId(meta, resource.path, resource.owner) ??
          meta.orgId ??
          undefined,
      ),
    ],
    automation: resource.path.replace(/^jobs\//, "").replace(/\.md$/, ""),
    limit: 50,
  });
  // Queued Run now rows have no agent run yet and do not identify the worker
  // holding this resource's lock. Never recover them by newest-row position.
  const history = histories.find(
    (run) =>
      run.path === resource.path &&
      run.runId &&
      run.threadId &&
      run.startedAt >= lastRun,
  );
  if (!history?.runId || !history.threadId) return null;
  if (history.finishedAt !== null)
    return {
      state: "settle",
      status: history.status === "success" ? "success" : "error",
      history,
      ...(history.error ? { error: history.error } : {}),
      ...(history.errorCode ? { errorCode: history.errorCode } : {}),
    };
  await reapIfStale(history.runId);
  const run = await getRunById(history.runId);
  if (!run)
    throw new Error(
      `Automation worker ${history.runId} has no durable run record`,
    );
  if (run.status === "running") return { state: "active" };
  if (run.status === "completed" && !meta.deliveryDestination)
    return { state: "settle", status: "success", history };
  const ref = await getRunTurnRef(run.id);
  if (!ref || ref.threadId !== history.threadId)
    throw new Error(`Automation worker ${run.id} has no matching turn`);
  const hardDeadlineAt =
    history.startedAt + resolveBackgroundRunHardTimeoutMs();
  if (
    run.errorCode === "stale_run" &&
    now.getTime() < hardDeadlineAt &&
    (await countRunsForTurn(ref.threadId, ref.turnId)) <=
      STALE_RUN_RECOVERY_MAX_SUCCESSORS_PER_TURN
  ) {
    return {
      state: "resume",
      resume: {
        historyId: history.id,
        threadId: ref.threadId,
        turnId: ref.turnId,
        previousRunId: run.id,
        hardDeadlineAt,
      },
    };
  }
  const events = await getCurrentTurnEventsForThread(ref.threadId, ref.turnId);
  return {
    state: "settle",
    status: "error",
    history,
    error: automationDeliveryNote(
      run.errorDetail || automationRecoveryMessagesForLocale().stopped,
      events,
    ),
    errorCode: run.errorCode || "background_automation_interrupted",
  };
}
