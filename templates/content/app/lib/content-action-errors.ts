import { actionErrorCode } from "@agent-native/core/client/use-action";

export function workspaceReferenceErrorMessage(
  error: unknown,
  localizedMessage: string,
): string | undefined {
  return actionErrorCode(error) === "WORKSPACE_CATALOG_REFERENCE_PROTECTED"
    ? localizedMessage
    : undefined;
}

export function optionRemovalErrorMessage(
  error: unknown,
  messages: { inUse: string; keptByRule: string },
): string | undefined {
  switch (actionErrorCode(error)) {
    case "OPTION_IN_USE":
      return messages.inUse;
    case "COLUMN_RULE_IN_USE":
      return messages.keptByRule;
    default:
      return undefined;
  }
}
