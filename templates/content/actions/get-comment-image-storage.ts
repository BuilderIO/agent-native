import { defineAction } from "@agent-native/core/action";
import { isPrivateBlobConfiguredForRequest } from "@agent-native/core/private-blob";
import { z } from "zod";

export default defineAction({
  description:
    "Read whether the current workspace has private storage for comment images, so the comment box can say so before anyone picks one.",
  readOnly: true,
  agentTool: false,
  toolCallable: false,
  http: { method: "GET" },
  schema: z.object({}),
  outputSchema: z.object({ configured: z.boolean() }),
  run: async () => ({ configured: await isPrivateBlobConfiguredForRequest() }),
});
