import { z } from "zod";

import { defineAction } from "../../action.js";
import { listMessagingChannels } from "../channel-settings.js";

export default defineAction({
  description:
    'List the messaging channels this app mounts (Slack, Google Docs, Telegram, WhatsApp, Discord, Microsoft Teams, Email) with each one\'s state ("on", "off", or "not-set-up"), whether it is enabled and configured, its webhook URL, and every credential its adapter reads. For owners and admins each credential also says where its value comes from ("saved" from Channels, the deployment "environment", or "elsewhere"; null when unset), whether it can be saved from Settings, and whether remove-credentials deletes it. Secret values are never returned. `canManage` says whether the caller may change channels with manage-messaging-channel.',
  schema: z.object({}),
  http: { method: "GET" },
  run: async (_args, ctx) => listMessagingChannels(ctx),
});
