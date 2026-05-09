import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listAvailableWorkspaceTemplates } from "../server/lib/app-creation-store.js";

export default defineAction({
  description:
    "List first-party templates that can be scaffolded into this workspace via the Apps page. Excludes templates already installed under apps/. The agent should usually call start-workspace-app-creation for natural-language requests; this list is for the static 'Add a template' tiles.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => listAvailableWorkspaceTemplates(),
});
