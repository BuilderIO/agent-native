import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { authorizeOrgOwnerOrAdmin } from "../server/lib/app-roles.js";
import { recordAudit } from "../server/lib/dispatch-store.js";
import { hostedAppsSettingsViewSchema } from "../server/lib/hosted-apps-settings-schema.js";
import {
  HOSTED_APPS_SETTINGS_KEY,
  setHostedAppsSettings,
} from "../server/lib/hosted-apps-settings.js";

export default defineAction({
  description:
    "Show or hide Agent-Native.com hosted apps (built-in apps) in this organization's Dispatch app lists and agent context. Organization owners and admins only. Pins are kept while hidden.",
  authorize: authorizeOrgOwnerOrAdmin,
  schema: z.object({
    showHostedApps: z
      .boolean()
      .describe("true shows Agent-Native.com hosted apps; false hides them for everyone."),
  }),
  outputSchema: hostedAppsSettingsViewSchema,
  run: async ({ showHostedApps }) => {
    const saved = await setHostedAppsSettings({ showHostedApps });
    await recordAudit({
      action: "hosted-apps.updated",
      targetType: "dispatch-settings",
      targetId: HOSTED_APPS_SETTINGS_KEY,
      summary: showHostedApps ? "Showed Agent-Native.com hosted apps" : "Hid Agent-Native.com hosted apps",
      metadata: saved,
    });
    return saved;
  },
});
