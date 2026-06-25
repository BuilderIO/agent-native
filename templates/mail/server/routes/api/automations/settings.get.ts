import { getSession } from "@agent-native/core/server";
import { getSetting, getUserSetting } from "@agent-native/core/settings";
import { defineEventHandler } from "h3";

export default defineEventHandler(async (event) => {
  const session = await getSession(event);
  if (!session?.email) {
    const { createError } = await import("h3");
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  }
  const email = session.email;
  const data = await getUserSetting(email, "automation-settings");
  const agentEngine = (await getSetting("agent-engine").catch(() => null)) as {
    engine?: string;
    model?: string;
  } | null;
  return {
    engine: (data as any)?.engine || agentEngine?.engine || "anthropic",
    model:
      (data as any)?.model || agentEngine?.model || "claude-haiku-4-5-20251001",
  };
});
