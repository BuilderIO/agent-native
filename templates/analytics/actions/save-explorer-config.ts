import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  putScopedSettingRecord,
  resolveRequestScope,
} from "../server/lib/scoped-settings";

const KEY_PREFIX = "config-";

export default defineAction({
  description: "Save (create or update) a named explorer configuration.",
  schema: z.object({
    id: z.string().describe("The explorer config ID"),
    data: z
      .preprocess(
        (v) => (typeof v === "string" ? JSON.parse(v) : v),
        z.record(z.string(), z.unknown()),
      )
      .describe("The config object to persist (or a JSON string)"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const scope = resolveRequestScope();
    await putScopedSettingRecord(
      scope,
      `${KEY_PREFIX}${args.id}`,
      args.data as Record<string, unknown>,
    );
    return { id: args.id, success: true };
  },
});
