import { defineAction } from "@agent-native/core/action";
import {
  appStateCompareAndSet,
  appStateGet,
} from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { localhostConsentRequestStateAddress } from "./localhost-consent-request-state.js";

export default defineAction({
  description: "Clear a localhost write-consent request after editor handoff.",
  schema: z.object({
    designId: z.string(),
    requestedAt: z.string(),
    // Two requests can share a millisecond; the ID tells them apart.
    requestId: z.string().optional(),
  }),
  agentTool: false,
  capabilityScopes: ["visual-edit"],
  run: async ({ designId, requestedAt, requestId }) => {
    await assertAccess("design", designId, "editor");
    const { key, sessionId } = localhostConsentRequestStateAddress(designId);
    const current = await appStateGet(sessionId, key);
    if (
      !current ||
      current.requestedAt !== requestedAt ||
      (requestId !== undefined && current.requestId !== requestId)
    ) {
      return { cleared: false };
    }
    return {
      cleared: await appStateCompareAndSet(sessionId, key, current, null, {
        requestSource: "agent",
      }),
    };
  },
});
