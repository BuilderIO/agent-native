import {
  actionChangeTarget,
  type NotifyActionChangeOptions,
  writeActionChangeMarker,
} from "./action-change-marker-write.js";
import { recordChange } from "./poll.js";

export { actionCallIsReadOnly } from "../action-call-classification.js";
export type { NotifyActionChangeOptions } from "./action-change-marker-write.js";

/**
 * Whether THIS invocation should announce a change.
 *
 * `readOnly` describes an action name, but a tool that discriminates on an
 * argument reads on some calls and writes on others — `manage-agent-engine`
 * with `action: "list"` is a status poll, with `action: "set"` a write. Such
 * actions already publish the per-call answer as a Plan-mode `effect`
 * predicate, so read it here instead of treating every call as a write: a poll
 * that bumps the `"action"` change version makes every query keyed on it
 * refetch forever.
 *
 * `readOnly` stays authoritative otherwise. Widening the flag to cover mixed
 * tools would also open them to read-only A2A peers and to the agent's
 * read-result cache, where it would be false.
 */
function recordActionChange(
  options: NotifyActionChangeOptions,
): NotifyActionChangeOptions {
  const target = actionChangeTarget(options);
  recordChange({
    source: "action",
    type: "change",
    key: target.actionName,
    ...(target.owner ? { owner: target.owner } : {}),
    ...(target.orgId ? { orgId: target.orgId } : {}),
    ...(target.requestSource ? { requestSource: target.requestSource } : {}),
  });
  return {
    actionName: options.actionName,
    ...(target.owner ? { owner: target.owner } : {}),
    ...(target.orgId ? { orgId: target.orgId } : {}),
    ...(target.requestSource ? { requestSource: target.requestSource } : {}),
  };
}

export async function notifyActionChange(
  options: NotifyActionChangeOptions,
): Promise<void> {
  await writeActionChangeMarker(recordActionChange(options));
}

/**
 * Publish the fast in-memory invalidation without holding a user-visible run
 * on the durable marker write. The marker remains scheduled for other
 * processes and its failure is logged instead of becoming an invisible gap.
 */
export function notifyActionChangeInBackground(
  options: NotifyActionChangeOptions,
): void {
  const normalizedOptions = recordActionChange(options);
  void writeActionChangeMarker(normalizedOptions).catch((error: unknown) => {
    console.warn(
      "[action-change] durable marker write failed:",
      error instanceof Error ? error.message : String(error),
    );
  });
}
