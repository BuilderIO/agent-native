import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { hostedAppsSettingsViewSchema } from "../server/lib/hosted-apps-settings-schema.js";
import {
  InvalidHostedAppsSettingsError,
  readHostedAppsSettings,
} from "../server/lib/hosted-apps-settings.js";

export default defineAction({
  description:
    "Read whether this organization shows Agent-Native.com hosted apps (built-in apps such as Mail or Analytics) in Dispatch app lists and agent context. When showHostedApps is false they are hidden; call-agent by name still reaches them. list-connected-agents lists them, marked hiddenFromLaunchers while hidden.",
  schema: z.object({}),
  outputSchema: hostedAppsSettingsViewSchema,
  http: { method: "GET" },
  readOnly: true,
  run: async () => {
    if (!getRequestUserEmail()) {
      fail("Sign in to read the Agent-Native.com hosted apps setting.", {
        errorCode: "dispatch_user_identity_missing",
        statusCode: 401,
      });
    }
    const { showHostedApps, invalid } = await readHostedAppsSettings();
    if (invalid) throw new InvalidHostedAppsSettingsError();
    return { showHostedApps };
  },
});
