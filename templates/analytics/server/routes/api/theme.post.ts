import { defineEventHandler, readBody } from "h3";
import { putSetting } from "@agent-native/core/settings";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const theme = body?.theme === "light" ? "light" : "dark";
  await putSetting("analytics-theme", { theme });
  return { theme };
});
