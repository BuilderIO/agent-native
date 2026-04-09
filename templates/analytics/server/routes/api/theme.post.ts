import { defineEventHandler } from "h3";
import { putSetting } from "@agent-native/core/settings";
import { readBody } from "@agent-native/core/server";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const theme = body?.theme === "light" ? "light" : "dark";
  await putSetting("analytics-theme", { theme });
  return { theme };
});
