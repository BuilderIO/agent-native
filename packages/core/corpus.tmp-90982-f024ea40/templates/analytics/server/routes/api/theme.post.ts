import { readBody } from "@agent-native/core/server";
import { defineEventHandler } from "h3";

import {
  putScopedSettingRecord,
  resolveSettingsScope,
} from "../../lib/scoped-settings";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const theme = body?.theme === "light" ? "light" : "dark";
  const scope = await resolveSettingsScope(event);
  await putScopedSettingRecord(scope, "analytics-theme", { theme });
  return { theme };
});
