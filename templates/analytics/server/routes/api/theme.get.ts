import { defineEventHandler } from "h3";
import { getSetting } from "@agent-native/core/settings";

export default defineEventHandler(async () => {
  try {
    const data = await getSetting("analytics-theme");
    if (data) return data;
    return { theme: "dark" };
  } catch {
    return { theme: "dark" };
  }
});
