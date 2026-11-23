import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  readHostedKernelEnvironment,
  usesBrowserNotebookKernel,
} from "../server/execution/kernel-client.js";
import {
  environmentReportSchema,
  listEnvironmentPackages,
} from "../server/model/environment-packages.js";

export default defineAction({
  description:
    "List the packages available to a notebook's Python runtime, with versions.",
  agentTool: true,
  schema: z.object({}),
  outputSchema: environmentReportSchema,
  http: { method: "GET" },
  requiresAuth: true,
  readOnly: true,
  parallelSafe: true,
  run: async (_input, ctx) => {
    if (!ctx?.userEmail) fail("Not authenticated.", { statusCode: 401 });
    return usesBrowserNotebookKernel()
      ? listEnvironmentPackages()
      : readHostedKernelEnvironment();
  },
});
