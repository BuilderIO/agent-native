import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getSetting, getUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

export default defineAction({
  description:
    "Read the engine and model used to evaluate inbox automation rules, falling back to the app's configured agent engine.",
  schema: z.object({}),
  http: { method: "GET" },
  agentTool: false,
  run: async () => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Unauthenticated");

    const data = (await getUserSetting(ownerEmail, "automation-settings")) as {
      engine?: string;
      model?: string;
    } | null;
    const agentEngine = (await getSetting("agent-engine").catch(
      () => null,
    )) as {
      engine?: string;
      model?: string;
    } | null;

    return {
      engine: data?.engine || agentEngine?.engine || "anthropic",
      model: data?.model || agentEngine?.model || "claude-haiku-4-5-20251001",
    };
  },
});
