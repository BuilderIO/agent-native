import { defineAction } from "@agent-native/core";
import { readProjectCodePack } from "@agent-native/core/code-agents";
import { z } from "zod";

export default defineAction({
  description:
    "List Agent-Native Code project commands and skills as structured code-pack metadata.",
  schema: z.object({
    cwd: z.string().optional(),
    includeReservedCommands: z.coerce.boolean().optional(),
  }),
  http: { method: "GET" },
  run: async (args) => ({
    status: "ok" as const,
    pack: readProjectCodePack(args.cwd, {
      includeReservedCommands: args.includeReservedCommands,
    }),
  }),
});
