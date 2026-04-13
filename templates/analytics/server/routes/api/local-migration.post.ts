import { defineEventHandler, setResponseStatus } from "h3";
import {
  resolveSettingsScope,
  migrateGlobalSettingsPrefixesToUser,
} from "../../lib/scoped-settings";

export default defineEventHandler(async (event) => {
  const scope = await resolveSettingsScope(event);
  if (!scope.email || scope.email === "local@localhost") {
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
