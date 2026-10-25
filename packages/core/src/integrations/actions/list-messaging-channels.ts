import { z } from "zod";

import { defineAction } from "../../action.js";
import { listMessagingChannels } from "../channel-settings.js";

export default defineAction({
  description:
    'List the messaging channels this app mounts (Slack, Google Docs, Telegram, WhatsApp, Discord, Microsoft Teams, Email) with each one\'s state ("on", "off", "not-set-up", or "unavailable"), whether it is enabled and configured, its webhook URL, and every credential its adapter reads. For owners and admins each credential also says where its value comes from ("saved" from Channels, the deployment "environment", "elsewhere", or "unreadable"; null when unset), whether it can be saved from Settings, whether remove-credentials deletes it, and `unreadableScope` when a Channels-managed saved value can be replaced or removed at its exact scope. A usable environment fallback stays available while an unreadable saved scope is marked for repair. An unavailable state means no usable value could be resolved and a saved credential could not be read. Secret values and scope IDs are never returned. `canManage` says whether the caller may change channels with manage-messaging-channel.',
  schema: z.object({}),
  http: { method: "GET" },
  run: async (_args, ctx) => listMessagingChannels(ctx),
});
