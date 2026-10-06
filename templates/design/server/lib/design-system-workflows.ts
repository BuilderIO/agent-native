import { fail } from "@agent-native/core/action";
import { isFeatureFlagEnabled } from "@agent-native/core/feature-flags";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";

import { DESIGN_SYSTEM_WORKFLOWS } from "../../shared/design-flags.js";

export async function assertDesignSystemWorkflowsEnabled(): Promise<void> {
  if (
    !(await isFeatureFlagEnabled(DESIGN_SYSTEM_WORKFLOWS, {
      userEmail: getRequestUserEmail(),
      orgId: getRequestOrgId(),
    }))
  ) {
    fail("New design system workflows are not enabled.", {
      errorCode: "design_system_workflows_disabled",
      statusCode: 403,
    });
  }
}
