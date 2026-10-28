import { ActionContractError } from "@agent-native/core";
import type { ActionRunContext } from "@agent-native/core/action";

function widgetWriteScopeError(
  message: string,
  errorCode: string,
  statusCode = 403,
): ActionContractError {
  return new ActionContractError(message, { errorCode, statusCode });
}

export function designWidgetWriteDesignId(
  context: ActionRunContext | undefined,
  actionName: string,
): string | null {
  if (context?.caller !== "mcp-widget-write") return null;

  const grant = context.mcpDirectoryWidgetWrite;
  const designId = grant?.resourceIds.designId;
  if (!grant || typeof designId !== "string" || !designId.trim()) {
    throw widgetWriteScopeError(
      "This Design widget write capability is missing or invalid.",
      "mcp_widget_grant_required",
    );
  }
  if (grant.appId !== "design") {
    throw widgetWriteScopeError(
      "This widget write capability is scoped to a different app.",
      "mcp_widget_resource_mismatch",
    );
  }
  if (!grant.actionNames.includes(actionName)) {
    throw widgetWriteScopeError(
      "This widget write capability does not permit this Design action.",
      "mcp_widget_action_not_allowed",
    );
  }

  return designId;
}

export function assertDesignWidgetWriteScope(
  designId: string,
  context: ActionRunContext | undefined,
  write?: {
    actionName?: string;
    content?: string;
    expectedVersionHash?: string;
    syncCollab?: boolean;
  },
): void {
  const grantedDesignId = designWidgetWriteDesignId(
    context,
    write?.actionName ?? "update-file",
  );
  if (!grantedDesignId) return;

  const grant = context?.mcpDirectoryWidgetWrite;
  if (!grant || grant.resourceIds.designId !== designId) {
    throw widgetWriteScopeError(
      "This widget write capability is scoped to a different design.",
      "mcp_widget_resource_mismatch",
    );
  }
  if (write?.content !== undefined && !write.expectedVersionHash?.trim()) {
    throw widgetWriteScopeError(
      "Widget content updates require expectedVersionHash from a current file read.",
      "mcp_widget_expected_version_required",
      400,
    );
  }
  if (write?.content !== undefined && write.syncCollab === false) {
    throw widgetWriteScopeError(
      "Widget content updates cannot disable collaboration sync.",
      "mcp_widget_sync_required",
      400,
    );
  }
}
