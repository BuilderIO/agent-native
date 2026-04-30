import { defineEventHandler, setResponseStatus } from "h3";
import { DEV_MODE_USER_EMAIL } from "@agent-native/core/server";
import {
  resolveSettingsScope,
  migrateGlobalSettingsPrefixesToUser,
} from "../../lib/scoped-settings";

export default defineEventHandler(async (event) => {
  const scope = await resolveSettingsScope(event);
  if (!scope.email || scope.email === DEV_MODE_USER_EMAIL) {
    setResponseStatus(event, 401);
    return { error: "Not authenticated" };
  }

  const result = await migrateGlobalSettingsPrefixesToUser(scope, [
    "dashboard-",
    "dashboard-views-",
    "sql-dashboard-",
    "config-",
  ]);

  return { ok: true, ...result };
});
