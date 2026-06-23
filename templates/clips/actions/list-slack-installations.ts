/**
 * list-slack-installations
 *
 * Returns Slack workspaces connected to the current user's active Clips org
 * (plus any personal install the user owns). Tokens are never returned.
 */

import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";
import { getActiveOrganizationId } from "../server/lib/recordings.js";
import { listVisibleSlackInstallations } from "../server/lib/slack-oauth.js";

export default defineAction({
  description:
    "List connected Slack workspaces for Agent-Native Clips for Slack. Tokens are never returned.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) throw new Error("Not authenticated.");
    const orgId = await getActiveOrganizationId().catch(() => null);
    const installations = await listVisibleSlackInstallations({
      userEmail,
      orgId,
    });

    return {
      oauthConfigured: Boolean(
        process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET,
      ),
      signingConfigured: Boolean(process.env.SLACK_SIGNING_SECRET),
      scopes: ["links:read", "links:write", "links.embed:write"],
      installations,
    };
  },
});
