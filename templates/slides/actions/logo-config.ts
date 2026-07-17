import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { getLogoProviderConfig } from "../server/lib/media-search-providers.js";

export default defineAction({
  description: "Get runtime-backed logo provider configuration for the UI.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  agentTool: false,
  run: async () => getLogoProviderConfig(),
});
