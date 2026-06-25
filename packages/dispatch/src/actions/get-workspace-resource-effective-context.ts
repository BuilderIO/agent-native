import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { getWorkspaceResourceEffectiveContext } from "../server/lib/workspace-resources-store.js";

export default defineAction({
  description:
    "Preview how a Dispatch workspace resource resolves for an app/user at runtime: workspace default, organization/app override, and personal override, plus whether the resource is all-app or selected-only.",
  schema: z.object({
    resourceId: z
      .string()
      .optional()
      .describe("Workspace resource id to inspect."),
    path: z
      .string()
      .optional()
      .describe(
        "Resource path to inspect, such as context/brand.md. Optional when resourceId is provided.",
      ),
    appId: z
      .string()
      .optional()
      .describe(
        "Workspace app id to preview. All-app resources are inherited by every app; selected-only resources require a grant.",
      ),
    userEmail: z
      .string()
      .optional()
      .describe(
        "User email for personal overrides. Defaults to the current Dispatch user.",
      ),
  }),
  http: { method: "GET" },
  run: async (args) => getWorkspaceResourceEffectiveContext(args),
});
