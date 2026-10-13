import { fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess, currentAccess } from "@agent-native/core/sharing";

export function requireVisualEditCollaboration(
  enabled: boolean | null | undefined,
): void {
  if (enabled !== true) {
    fail("Live collaboration is disabled for this design.", {
      errorCode: "visual_edit_collaboration_disabled",
      statusCode: 409,
    });
  }
}

export function requireVisualEditAccount(userEmail?: string): void {
  if (!userEmail) {
    fail("Sign in to enable live collaboration for this design.", {
      errorCode: "visual_edit_account_required",
      statusCode: 401,
    });
  }
}

export async function assertVisualEditAccountEditor(designId: string) {
  requireVisualEditAccount(getRequestUserEmail());
  return assertAccess("design", designId, "editor", {
    ...currentAccess(),
    authCapability: undefined,
  });
}
