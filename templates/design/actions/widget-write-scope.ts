import { ActionContractError } from "@agent-native/core";
import type { ActionRunContext } from "@agent-native/core/action";

export function assertDesignWidgetFileWriteScope(
  designId: string,
  context: ActionRunContext | undefined,
  write?: {
    actionName?: string;
    content?: string;
    expectedVersionHash?: string;
    syncCollab?: boolean;
  },
): void {
  const grant = context?.mcpDirectoryWidgetWrite;
  if (!grant) return;
  if (grant.appId !== "design" || grant.resourceIds.designId !== designId) {
    throw new ActionContractError(
      "This widget write capability is scoped to a different design.",
      { errorCode: "mcp_widget_resource_mismatch", statusCode: 403 },
    );
  }
  if (!grant.actionNames.includes(write?.actionName ?? "update-file")) {
    throw new ActionContractError(
      "This widget write capability does not permit this design file action.",
      { errorCode: "mcp_widget_action_not_allowed", statusCode: 403 },
    );
  }
  if (write?.content !== undefined && !write.expectedVersionHash?.trim()) {
    throw new ActionContractError(
      "Widget content updates require expectedVersionHash from a current file read.",
      { errorCode: "mcp_widget_expected_version_required", statusCode: 400 },
    );
  }
  if (write?.content !== undefined && write.syncCollab === false) {
    throw new ActionContractError(
      "Widget content updates cannot disable collaboration sync.",
      { errorCode: "mcp_widget_sync_required", statusCode: 400 },
    );
  }
}
