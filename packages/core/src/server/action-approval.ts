import {
  actionCallIntent,
  ActionContractError,
  preparedCallNeedsApproval,
  type ActionCaller,
  type ActionRunContext,
} from "../action.js";
import { UI_CAPABILITY_REQUIRED_ERROR_CODE } from "../shared/action-error-codes.js";

/**
 * The refusal for an HTTP call that needs approval. No HTTP caller can grant
 * approval: it is given in the app's UI, or in an agent chat or MCP flow that
 * runs the action in-process.
 */
export function actionApprovalRequiredError(
  name: string,
  caller: ActionCaller,
  serviceIdentity: boolean,
  embedded = false,
): ActionContractError {
  // The browser client answers this code by minting its UI capability and
  // retrying once, so the app's own UI is never refused for lacking proof.
  if (caller === "frontend" && !embedded) {
    return new ActionContractError(
      `"${name}" requires approval for these arguments, which only the signed-in app can give.`,
      { errorCode: UI_CAPABILITY_REQUIRED_ERROR_CODE, statusCode: 403 },
    );
  }
  const message =
    embedded || caller === "mcp-widget" || caller === "mcp-widget-write"
      ? `"${name}" requires human approval for these arguments. Open the full app to approve and finish this action.`
      : serviceIdentity
        ? `"${name}" requires human approval for these arguments, and a service identity can never give it. Ask a person to run this action from the app.`
        : caller === "webmcp"
          ? `"${name}" requires human approval for these arguments. WebMCP tool calls cannot grant that approval themselves — ask the user to confirm this action in chat, then call it there.`
          : `"${name}" requires human approval for these arguments, which an HTTP action call cannot grant. Ask the user to approve it in the app's agent chat, or call it as an MCP tool, where the approval flow exists.`;
  return new ActionContractError(message, {
    errorCode: "approval_required",
    statusCode: 409,
  });
}

/**
 * For a dispatcher that runs `entry.run` directly instead of a prepared call
 * (the generated worker entry): the refusal when this call needs approval.
 * Arguments that fail validation get no refusal here; the run refuses them.
 */
export async function directHttpActionApprovalRefusal(
  entry: Parameters<typeof actionCallIntent>[0] &
    Parameters<typeof preparedCallNeedsApproval>[0],
  params: unknown,
  ctx: ActionRunContext & { actionName: string },
): Promise<ActionContractError | null> {
  if (entry.needsApproval === undefined || entry.needsApproval === false) {
    return null;
  }
  const prepared = await actionCallIntent(entry, params);
  if (!prepared.valid) return null;
  return (await preparedCallNeedsApproval(entry, prepared, {
    ...ctx,
    caller: ctx.caller === "frontend" ? "http" : ctx.caller,
  }))
    ? actionApprovalRequiredError(
        ctx.actionName,
        ctx.caller === "frontend" && ctx.requestHeaders?.has("authorization")
          ? "http"
          : ctx.caller,
        false,
      )
    : null;
}
