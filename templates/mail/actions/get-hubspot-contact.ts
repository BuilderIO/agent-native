import { defineAction } from "@agent-native/core/action";
import { getRequestOrgId } from "@agent-native/core/server";
import { z } from "zod";

import {
  HubSpotLookupError,
  lookupHubSpotContact,
} from "../server/lib/hubspot.js";
import { readIntegrationKey } from "../server/lib/integration-keys.js";
import { resolveOwnerEmail } from "./helpers.js";

export default defineAction({
  description:
    "Look up HubSpot CRM context for an email address, including contact details, associated deals, and associated tickets.",
  schema: z.object({
    email: z
      .string()
      .trim()
      .min(1)
      .describe("Email address of the contact to look up in HubSpot."),
  }),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: "search",
  run: async ({ email }) => {
    const ownerEmail = await resolveOwnerEmail();
    const apiKey = await readIntegrationKey("hubspot", {
      userEmail: ownerEmail,
      orgId: getRequestOrgId() ?? null,
    });

    if (!apiKey) {
      return { error: "HubSpot API key not configured" };
    }

    try {
      return await lookupHubSpotContact(apiKey, email);
    } catch (error) {
      if (error instanceof HubSpotLookupError) {
        return { error: error.message };
      }

      return { error: "Failed to reach HubSpot API" };
    }
  },
});
