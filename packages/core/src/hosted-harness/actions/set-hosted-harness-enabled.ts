import { z } from "zod";

import { defineAction } from "../../action.js";
import { HOSTED_HARNESS_ORG_SETTING_KEY } from "../../agent/harness/hosted.js";
import { getOrgRoleForEmail } from "../../mcp/actions/service-token-access.js";
import { canManageOrg } from "../../org/permissions.js";
import {
  hostedHarnessStatusForClient,
  resolveHostedHarnessPolicy,
} from "../../server/hosted-harness-policy.js";
import { putOrgSetting } from "../../settings/org-settings.js";

export default defineAction({
  description:
    "Enable or disable the hosted tools-only harness for the current organization. Organization owners and admins only.",
  schema: z.object({ enabled: z.boolean() }),
  http: { method: "POST" },
  agentTool: false,
  run: async (args, context) => {
    const email = context?.userEmail?.trim().toLowerCase();
    const orgId = context?.orgId?.trim();
    if (!email) throw new Error("Sign in to manage hosted harnesses.");
    if (!orgId) throw new Error("Select an organization to manage harnesses.");

    const role = await getOrgRoleForEmail(orgId, email);
    if (!canManageOrg(role)) {
      throw new Error(
        "Only organization owners and admins can manage hosted harnesses.",
      );
    }

    await putOrgSetting(orgId, HOSTED_HARNESS_ORG_SETTING_KEY, {
      enabled: args.enabled,
    });
    return hostedHarnessStatusForClient(
      await resolveHostedHarnessPolicy({
        orgId,
        userEmail: email,
      }),
    );
  },
});
