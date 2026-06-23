/**
 * disconnect-slack
 *
 * Stops Clips from using a connected Slack workspace by deleting the encrypted
 * bot token and marking the install disconnected.
 */

import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";
import { getActiveOrganizationId } from "../server/lib/recordings.js";
import { disconnectSlackInstallation } from "../server/lib/slack-oauth.js";

export default defineAction({
  description:
    "Disconnect Agent-Native Clips for Slack for a Slack workspace. This deletes the stored bot token and disables future unfurls.",
  schema: z.object({
    id: z.string().describe("slack_installations.id"),
  }),
  run: async (args) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) throw new Error("Not authenticated.");
    const orgId = await getActiveOrganizationId().catch(() => null);
    const installation = await disconnectSlackInstallation({
      id: args.id,
      userEmail,
      orgId,
    });
    if (!installation) {
      throw new Error(`Slack installation not found: ${args.id}`);
    }
    return { id: args.id, disconnected: true };
  },
});
