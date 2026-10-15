import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  listKeyDateSets,
  requireKeyDateScope,
} from "../server/lib/key-dates-store.js";

export default defineAction({
  description:
    "List the organization's key-date sets (for example Launches, Product changes) by name, each with its dates oldest first. Every set shows on every time chart of every dashboard unless that dashboard hides it in config.annotations.hiddenKeyDateSets. Read-only.",
  schema: z.object({}),
  readOnly: true,
  http: { method: "GET" },
  mcpTool: false,
  run: async () => ({ sets: await listKeyDateSets(requireKeyDateScope()) }),
});
