import { ActionContractError, type ActionRunContext } from "../action.js";

function widgetBindingError(
  message: string,
  errorCode: string,
): ActionContractError {
  return new ActionContractError(message, { errorCode, statusCode: 403 });
}

/**
 * In-action fail-closed check for the framework sharing actions when they are
 * reached through a ChatGPT-directory widget capability. The action-route gate
 * already literal-binds `resourceType` and `resourceId` to the grant; this
 * repeats the binding where the permission decision is made, because those
 * checks run against the signed-in user, not against the grant.
 *
 * Callers other than the widget are untouched. A GET made with a write
 * capability reaches the action as `mcp-widget` with the grant attached; that
 * read never lists write actions, so only the artifact binding applies to it.
 * A read-only ticket carries no ids into the action context, so it stays
 * bound by the gate alone.
 */
export function assertWidgetShareBinding(
  context: ActionRunContext | undefined,
  actionName: string,
  args: { resourceType: string; resourceId: string },
): void {
  const grant = context?.mcpDirectoryWidgetWrite;
  const isWrite = context?.caller === "mcp-widget-write";
  if (!isWrite && !(context?.caller === "mcp-widget" && grant)) return;

  if (!grant) {
    throw widgetBindingError(
      "This widget write capability is missing or invalid.",
      "mcp_widget_grant_required",
    );
  }
  if (isWrite && !grant.actionNames.includes(actionName)) {
    throw widgetBindingError(
      "This widget write capability does not permit this sharing action.",
      "mcp_widget_action_not_allowed",
    );
  }

  // Each granted value binds one argument, so the resource type cannot also
  // satisfy the id (a resource whose id equals the type string).
  const remaining = Object.values(grant.resourceIds);
  const typeIndex = remaining.indexOf(args.resourceType);
  if (typeIndex >= 0) remaining.splice(typeIndex, 1);
  if (typeIndex < 0 || !remaining.includes(args.resourceId)) {
    throw widgetBindingError(
      "This widget write capability is scoped to a different resource.",
      "mcp_widget_resource_mismatch",
    );
  }
}
