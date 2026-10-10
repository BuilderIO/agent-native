import type { AgentChatEvent } from "../agent/types.js";
import {
  AUTOMATION_NO_OP_TOOL,
  automationNoOpReasonFromEvents,
} from "./actions/automation-no-op.js";

export function inspectAutomationWork(
  events: readonly AgentChatEvent[],
  options: {
    noOpReason?: string;
    confirmsWork?: (tool: string) => boolean;
  } = {},
):
  | { status: "success" }
  | { status: "skipped"; reason: string }
  | {
      status: "unconfirmed";
      noOpDeclared: boolean;
      failedTool?: Extract<AgentChatEvent, { type: "tool_done" }>;
    } {
  const hasConfirmedAction = events.some(
    (event) =>
      event.type === "tool_done" &&
      event.tool !== AUTOMATION_NO_OP_TOOL &&
      !event.isError &&
      event.completedSideEffect === true &&
      options.confirmsWork?.(event.tool) !== false,
  );
  const failedTool = [...events]
    .reverse()
    .find(
      (event): event is Extract<AgentChatEvent, { type: "tool_done" }> =>
        event.type === "tool_done" && Boolean(event.isError),
    );
  const noOpReason =
    options.noOpReason ?? automationNoOpReasonFromEvents(events);
  if (noOpReason && !hasConfirmedAction && !failedTool)
    return { status: "skipped", reason: noOpReason };
  return hasConfirmedAction
    ? { status: "success" }
    : { status: "unconfirmed", noOpDeclared: Boolean(noOpReason), failedTool };
}
