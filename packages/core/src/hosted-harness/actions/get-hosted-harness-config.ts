import { z } from "zod";

import { defineAction } from "../../action.js";
import {
  hostedHarnessStatusForClient,
  resolveHostedHarnessPolicy,
} from "../../server/hosted-harness-policy.js";

export default defineAction({
  description:
    "Return whether this app's hosted tools-only harness is enabled for the current organization and which runtimes are available.",
  schema: z.object({}),
  http: { method: "GET" },
  agentTool: false,
  run: async (_args, context) =>
    hostedHarnessStatusForClient(
      await resolveHostedHarnessPolicy({
        orgId: context?.orgId,
        userEmail: context?.userEmail,
      }),
    ),
});
