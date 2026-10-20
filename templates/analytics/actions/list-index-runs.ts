import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  listSourceIndexRuns,
  requireSourceIndexReadOrg,
} from "../server/lib/source-index-runs.js";

export default defineAction({
  description:
    "List the most recent source index build runs for the organization, newest first. Each run reports its status, trigger, start and finish times, entry count, indexed source revisions, and error. Read-only; does not return index contents.",
  schema: z.object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10)
      .describe("Maximum runs to return, 1 to 50; defaults to 10"),
  }),
  readOnly: true,
  http: { method: "GET" },
  mcpTool: false,
  run: async ({ limit }) =>
    listSourceIndexRuns(requireSourceIndexReadOrg(), limit),
});
