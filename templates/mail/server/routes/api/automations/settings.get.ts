import { defineEventHandler } from "h3";
import { getUserSetting } from "@agent-native/core/settings";
import { getSession } from "@agent-native/core/server";

export default defineEventHandler(async (event) => {
  const session = await getSession(event);
  if (!session?.email) {
    const { createError } = await import("h3");
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  }
  const email = session.email;
  const data = await getUserSetting(email, "automation-settings");
  return {
    model: (data as any)?.model || "claude-haiku-4-5-20251001",
  };
});
