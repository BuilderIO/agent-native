import type { ActionRunContext } from "@agent-native/core/action";

function canEmitToolActivity(
  context: ActionRunContext | undefined,
): context is ActionRunContext & Required<Pick<ActionRunContext, "send">> {
  return context?.caller === "tool" && typeof context.send === "function";
}

/**
 * Emit one activity line into the live chat transcript, e.g. announcing the
 * start or result of a discrete sub-step (a Creative Context lookup) rather
 * than a long-running operation's periodic "still working" ping. A no-op
 * outside the agent tool loop (no `context`, or a non-"tool" caller such as
 * `frontend`/`http`), matching the assets template's `withToolActivity` gate.
 */
export function sendToolActivity(
  context: ActionRunContext | undefined,
  label: string,
  tool?: string,
): void {
  if (!canEmitToolActivity(context)) return;
  context.send({
    type: "activity",
    label,
    tool: tool ?? context.actionName,
  });
}
