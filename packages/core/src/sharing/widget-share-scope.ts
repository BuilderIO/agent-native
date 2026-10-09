import { ActionContractError, type ActionRunContext } from "../action.js";

/**
 * A directory widget's grant names one shareable resource and the share
 * actions it may run on it. The action route already binds those arguments;
 * this repeats the check inside the action, so a call that reaches it without
 * the route's normalization still cannot name another resource.
 *
 * The resource id is read from `<resourceType>Id` in the grant's resource ids
 * (`documentId` for a document), the same ids the route bound the arguments to.
 */
export function assertWidgetShareScope(
  ctx: ActionRunContext | undefined,
  actionName: string,
  args: { resourceType: string; resourceId: string },
): void {
  const writing = ctx?.caller === "mcp-widget-write";
  const grant = ctx?.mcpDirectoryWidgetWrite;
  // A read-only ticket carries no grant; its route normalization is the bound.
  if (!writing && !grant) return;

  const resourceType = grant?.resourceIds.resourceType;
  const grantedResourceId = resourceType
    ? grant?.resourceIds[`${resourceType}Id`]
    : undefined;
  if (
    !grant ||
    !resourceType ||
    !grantedResourceId ||
    args.resourceType !== resourceType ||
    args.resourceId !== grantedResourceId ||
    (writing && !grant.actionNames.includes(actionName))
  ) {
    throw new ActionContractError(
      "This widget capability is missing, or scoped to a different resource or action.",
      { errorCode: "mcp_widget_write_scope_mismatch", statusCode: 403 },
    );
  }
}
