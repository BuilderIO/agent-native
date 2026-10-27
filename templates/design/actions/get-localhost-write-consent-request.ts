import { defineAction } from "@agent-native/core/action";
import { appStateGet } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import {
  LOCALHOST_CONSENT_REQUEST_TTL_MS,
  localhostConsentRequestStateAddress,
} from "./localhost-consent-request-state.js";

// Requests queued before IDs existed have no requestId field: a readable one
// still opens (it never matches a sign-in return marker), and an unreadable
// one is skipped. Any record carrying the field claims the current shape, so
// a malformed one fails loudly instead of passing as legacy.
function storedRequestSchemas(designId: string) {
  const legacy = z.object({
    designId: z.literal(designId),
    connectionId: z.string(),
    rootPath: z.string(),
    files: z.array(z.string()),
    requestedAt: z.iso.datetime({ offset: true }),
    requestId: z.string().optional(),
  });
  return { legacy, current: legacy.extend({ requestId: z.string().min(1) }) };
}

export default defineAction({
  description: "Internal editor handoff for pending localhost write consent.",
  schema: z.object({ designId: z.string() }),
  readOnly: true,
  agentTool: false,
  capabilityScopes: ["visual-edit"],
  http: { method: "GET" },
  run: async ({ designId }) => {
    await assertAccess("design", designId, "editor");
    const { key, sessionId } = localhostConsentRequestStateAddress(designId);
    const value = await appStateGet(sessionId, key);
    if (value == null) return { request: null };
    const { legacy, current } = storedRequestSchemas(designId);
    const request = Object.prototype.hasOwnProperty.call(value, "requestId")
      ? current.parse(value)
      : legacy.safeParse(value).data;
    if (!request) return { request: null };
    if (
      Date.now() - Date.parse(request.requestedAt) >
      LOCALHOST_CONSENT_REQUEST_TTL_MS
    ) {
      return { request: null, expired: true as const };
    }
    return { request };
  },
});
