import { getDbExec } from "@agent-native/core/db";
import { defineEventHandler } from "h3";

export default defineEventHandler(async () => {
  try {
    await getDbExec().execute("SELECT 1");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown" };
  }
});
