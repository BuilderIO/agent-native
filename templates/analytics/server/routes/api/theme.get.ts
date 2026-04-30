import { defineEventHandler } from "h3";
import {
  getScopedSettingRecord,
  resolveSettingsScope,
} from "../../lib/scoped-settings";

export default defineEventHandler(async (event) => {
  try {
    const scope = await resolveSettingsScope(event);
    const data = await getScopedSettingRecord(scope, "analytics-theme");
    if (data) return data;
    return { theme: "dark" };
  } catch {
    return { theme: "dark" };
  }
});
