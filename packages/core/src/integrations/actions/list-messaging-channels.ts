import { z } from "zod";

import { defineAction } from "../../action.js";
import { listMessagingChannels } from "../channel-settings.js";

export default defineAction({
  description:
    'List the messaging channels this app mounts (Slack, Google Docs, Telegram, WhatsApp, Discord, Microsoft Teams, Email) with each one\'s state ("on", "off", "not-set-up", or "unavailable"), whether it is enabled and configured, its webhook URL, and every credential its adapter reads. For owners and admins, each credential reports its source ("saved" from Channels, the deployment "environment", "elsewhere", or "unreadable"; null when unset), whether Settings can save it, and whether it can be removed. `unreadableScope` identifies the original unreadable scope category; `repairScope` identifies where replacement will be saved. A removable credential includes a short-lived opaque `removalConfirmation` token bound to its specific saved reference for the owner to confirm. A usable environment fallback stays available while an unreadable saved scope is marked for repair. Secret values and scope IDs are never returned. `canManage` says whether the caller may change channels with manage-messaging-channel.',
  schema: z.object({}),
  http: { method: "GET" },
  run: async (_args, ctx) => listMessagingChannels(ctx),
});
