import { defineAction, fail } from "@agent-native/core/action";
import { getOrgSetting } from "@agent-native/core/settings";
import { z } from "zod";

import { requireCurrentWorkspace } from "../server/lib/workspace-access.js";

const optionsSchema = z
  .object({
    keywordCase: z.enum(["upper", "lower", "preserve"]),
    newlineBeforeClauses: z.boolean(),
  })
  .strict();

export default defineAction({
  description:
    "Read the active workspace's SQL formatting preferences as an organization administrator. Distinguishes built-in defaults from saved preferences; invalid stored values are errors.",
  schema: z.object({}).strict(),
  outputSchema: z
    .object({ state: z.enum(["default", "stored"]), options: optionsSchema })
    .strict(),
  readOnly: true,
  http: { method: "GET" },
  run: async () => {
    const current = await requireCurrentWorkspace();
    if (
      current.access.orgRole !== "owner" &&
      current.access.orgRole !== "admin"
    )
      fail("Workspace administrator access is required.", { statusCode: 403 });
    const stored = await getOrgSetting(
      current.orgId,
      "analytics-2.sql-formatting-options",
    );
    if (stored === null)
      return {
        state: "default" as const,
        options: { keywordCase: "upper" as const, newlineBeforeClauses: true },
      };
    const parsed = optionsSchema.safeParse(stored);
    if (!parsed.success)
      fail("The workspace SQL formatting preferences could not be read.", {
        statusCode: 503,
      });
    return { state: "stored" as const, options: parsed.data };
  },
});
