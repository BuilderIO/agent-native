import { ActionContractError } from "@agent-native/core";
import type { ActionRunContext } from "@agent-native/core/action";

export function assertDesignWidgetFileWriteScope(
  designId: string,
  context: ActionRunContext | undefined,
): void {
  const grant = context?.mcpDirectoryWidgetWrite;
  if (!grant) return;
  if (grant.appId !== "design" || grant.resourceIds.designId !== designId) {
    throw new ActionContractError(
      "This widget write capability is scoped to a different design.",
      { errorCode: "mcp_widget_resource_mismatch", statusCode: 403 },
    );
  }
}
