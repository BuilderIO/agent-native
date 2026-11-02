import { ActionContractError, isOutsideAgentCall } from "@agent-native/core";
import type { ActionRunContext } from "@agent-native/core/action";

type CallProvenance = Pick<
  ActionRunContext,
  "caller" | "networkProtocol" | "automation"
>;

/**
 * Whether an agent made this call: Content's own agent, an MCP client, or
 * another outside caller. A call with no context comes from the server's own
 * code on behalf of whoever started it, so it isn't one.
 */
export function isAgentCall(ctx: CallProvenance | undefined) {
  return (
    ctx !== undefined && (ctx.caller === "tool" || isOutsideAgentCall(ctx))
  );
}

/**
 * "Agents can't edit the text of this": a person keeps a page's title, body,
 * description and tabs out of agents' reach, while agents can still comment
 * and suggest edits. It keeps connected agents out of the text; it isn't a
 * permission, since they act for someone who could turn it off.
 */
export function assertAgentsMayEditPageText(
  document: { agentTextLocked?: number | null } | undefined,
  ctx: CallProvenance | undefined,
) {
  if (!document?.agentTextLocked || !isAgentCall(ctx)) return;
  throw new ActionContractError(
    "A person has locked the text of this page against agents. Comment on it, or propose the change with suggest-document-edit for a person to accept.",
    { errorCode: "AGENT_TEXT_LOCKED", statusCode: 403 },
  );
}
