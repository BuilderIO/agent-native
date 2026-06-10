import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  getScopedSettingRecord,
  resolveRequestScope,
} from "../server/lib/scoped-settings";

const KEY_PREFIX = "config-";

export default defineAction({
  description: "Get a saved explorer configuration by ID.",
  schema: z.object({
    id: z.string().describe("The explorer config ID"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const scope = resolveRequestScope();
    const data = await getScopedSettingRecord(scope, `${KEY_PREFIX}${args.id}`);
    if (!data) {
      throw Object.assign(new Error("Config not found"), { statusCode: 404 });
    }
    return { id: args.id, ...(data as Record<string, unknown>) };
  },
});
