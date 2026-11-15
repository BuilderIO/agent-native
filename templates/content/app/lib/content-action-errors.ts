import { actionErrorCode } from "@agent-native/core/client/use-action";

export function workspaceReferenceErrorMessage(
  error: unknown,
  localizedMessage: string,
): string | undefined {
  return actionErrorCode(error) === "WORKSPACE_CATALOG_REFERENCE_PROTECTED"
    ? localizedMessage
    : undefined;
}
