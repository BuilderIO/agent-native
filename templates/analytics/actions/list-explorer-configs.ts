import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  listScopedSettingRecords,
  resolveRequestScope,
} from "../server/lib/scoped-settings";

const KEY_PREFIX = "config-";

export default defineAction({
  description:
    "List saved explorer (BigQuery explorer) configurations for the current user/org, " +
    "excluding the internal autosave entry.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => {
    const scope = resolveRequestScope();
    const all = await listScopedSettingRecords(scope, KEY_PREFIX);
    return Object.entries(all)
      .filter(([key]) => key !== `${KEY_PREFIX}_autosave`)
      .map(([key, data]) => ({
        id: key.slice(KEY_PREFIX.length),
        name:
          (data as Record<string, unknown>).name ??
          key.slice(KEY_PREFIX.length),
        ...(data as Record<string, unknown>),
      }));
  },
});
