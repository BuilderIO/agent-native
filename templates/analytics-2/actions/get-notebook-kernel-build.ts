import { defineAction } from "@agent-native/core/action";
import { getAppConfig } from "@agent-native/core/server";
import { z } from "zod";

import {
  attestDevelopmentKernelBuilds,
  kernelBuildManifest,
} from "../server/execution/kernel-client.js";
import {
  isWorkspaceAdministrator,
  requireCurrentWorkspace,
} from "../server/lib/workspace-access.js";
import { CONTRACT_VERSION } from "../shared/kernel-contract.js";
import { deniedSchema } from "../shared/notebook-snapshot-contract.js";

export default defineAction({
  description: "Read the notebook kernel builds pinned to this deployment.",
  schema: z.strictObject({}),
  outputSchema: z.union([
    z.strictObject({
      appBuildSha: z.string().nullable(),
      protocolVersion: z.literal(CONTRACT_VERSION),
      builds: z.array(z.strictObject({ sha: z.string(), digest: z.string() })),
      developmentAttested: z.literal(true).optional(),
    }),
    deniedSchema,
  ]),
  http: { method: "GET" },
  requiresAuth: true,
  readOnly: true,
  persistInBrowser: false,
  agentTool: false,
  run: async () => {
    const current = await requireCurrentWorkspace();
    if (!isWorkspaceAdministrator(current)) {
      return { status: "denied", reason: "access_denied" } as const;
    }
    return {
      appBuildSha: getAppConfig().observability.buildSha ?? null,
      ...kernelBuildManifest(),
      ...((await attestDevelopmentKernelBuilds()) && {
        developmentAttested: true as const,
      }),
    };
  },
});
