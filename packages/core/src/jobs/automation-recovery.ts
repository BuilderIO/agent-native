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
import {
  automationRunClaimLeaseMs,
  getAutomationRun,
  listAutomationRuns,
  type AutomationRun,
} from "./run-history.js";

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
      state: "unrecoverable";
      status: "error";
      error: string;
      errorCode: string;
      deliveryNote: string;
    }
  | {
      state: "settle";
      status: "success" | "error";
      history: AutomationRun;
      error?: string;
      errorCode?: string;
      deliveryNote?: string;
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
  appId?: string,
): Promise<AutomationRecovery | null> {
  const lastRun = meta.lastRun ? Date.parse(meta.lastRun) : Number.NaN;
  if (!Number.isFinite(lastRun)) return null;
  const owner = automationHistoryOwner(
    resource,
    meta.runAs === "shared" ? resource.owner : meta.createdBy || resource.owner,
    recoveredFactoryOwnerOrgId(meta, resource.path, resource.owner) ??
      meta.orgId ??
      undefined,
  );
  let history: AutomationRun | null;
  if (meta.lastHistoryId) {
    history = await getAutomationRun(meta.lastHistoryId);
    if (
      !history ||
      history.owner !== owner ||
      history.path !== resource.path ||
      (history.appId && history.appId !== appId)
    ) {
      const deliveryNote = deliveryNoteForEvents(null);
      return {
        state: "unrecoverable",
        status: "error",
        error: withDeliveryNote(
          automationRecoveryMessagesForLocale().historyUnavailable,
          deliveryNote,
        ),
        errorCode: "automation_recovery_history_unavailable",
        deliveryNote,
      };
    }
  } else {
    if ((meta.triggerType ?? "schedule") !== "schedule") return null;
    const histories = await listAutomationRuns({
      owners: [owner],
      automation: resource.path.replace(/^jobs\//, "").replace(/\.md$/, ""),
      appId,
      limit: 50,
    });
    // Older running markers lack a firing id. Ambiguous history must never
    // authorize replay or attribute another firing's deliveries to this one.
    const candidates = histories.filter(
      (run) =>
        run.path === resource.path &&
        (!run.appId || run.appId === appId) &&
        run.runId &&
        run.threadId &&
        run.startedAt >= lastRun,
    );
    if (candidates.length > 1)
      throw new Error(automationRecoveryMessagesForLocale().unreadable);
    history = candidates[0] ?? null;
  }
  if (!history) return null;
  if (history.finishedAt !== null)
    return {
      state: "settle",
      status: history.status === "success" ? "success" : "error",
      history,
      ...(history.error ? { error: history.error } : {}),
      ...(history.errorCode ? { errorCode: history.errorCode } : {}),
    };
  if (!history.runId || !history.threadId) {
    const lastQueueTouch = history.claimedAt ?? history.startedAt;
    if (
      history.dispatchPending &&
      Number.isFinite(lastQueueTouch) &&
      lastQueueTouch > now.getTime() - automationRunClaimLeaseMs()
    )
      return { state: "active" };
    return {
      state: "settle",
      status: "error",
      history,
      error: withDeliveryNote(
        automationRecoveryMessagesForLocale().stopped,
        deliveryNoteForEvents([]),
      ),
      errorCode: "background_automation_interrupted",
      deliveryNote: deliveryNoteForEvents([]),
    };
  }
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
  if (run.status === "completed") {
    const events = await getCurrentTurnEventsForThread(
      ref.threadId,
      ref.turnId,
    );
    return {
      state: "settle",
      status: "error",
      history,
      error: automationDeliveryNote(
        automationRecoveryMessagesForLocale().deliveryUnknown,
        events,
      ),
      errorCode: "background_automation_delivery_unknown",
      deliveryNote: deliveryNoteForEvents(events),
    };
  }
  const hardDeadlineAt = lastRun + resolveBackgroundRunHardTimeoutMs();
  if (
    meta.lastHistoryId &&
    (run.errorCode === "stale_run" ||
      run.errorCode === "automation_scheduler_lease_lost") &&
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
      history.error ||
        run.errorDetail ||
        automationRecoveryMessagesForLocale().stopped,
      events,
    ),
    errorCode:
      history.errorCode || run.errorCode || "background_automation_interrupted",
    deliveryNote: deliveryNoteForEvents(events),
  };
}
