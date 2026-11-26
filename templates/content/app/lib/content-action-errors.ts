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
  const code = actionErrorCode(error);
  if (code === "OPTION_IN_USE") return messages.inUse;
  if (code === "COLUMN_RULE_IN_USE") return messages.keptByRule;
  return undefined;
}
