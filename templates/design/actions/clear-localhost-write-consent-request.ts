import { defineAction } from "@agent-native/core/action";
import {
  compareAndSetAppState,
  readAppState,
} from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

export default defineAction({
  description: "Clear a localhost write-consent request after editor handoff.",
  schema: z.object({
    designId: z.string(),
    requestedAt: z.string(),
  }),
  agentTool: false,
  capabilityScopes: ["visual-edit"],
  run: async ({ designId, requestedAt }) => {
    await assertAccess("design", designId, "editor");
    const key = `design-localhost-write-consent-request:${designId}`;
    const current = await readAppState(key);
    if (!current || current.requestedAt !== requestedAt) {
      return { cleared: false };
    }
    return { cleared: await compareAndSetAppState(key, current, null) };
  },
});
