import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  deleteScopedSettingRecord,
  resolveRequestScope,
} from "../server/lib/scoped-settings";

const KEY_PREFIX = "config-";

export default defineAction({
  description: "Delete a saved explorer configuration by ID.",
  schema: z.object({
    id: z.string().describe("The explorer config ID to delete"),
  }),
  http: { method: "DELETE" },
  run: async (args) => {
    const scope = resolveRequestScope();
    await deleteScopedSettingRecord(scope, `${KEY_PREFIX}${args.id}`);
    return { id: args.id, success: true };
  },
});
