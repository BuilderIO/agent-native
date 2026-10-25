import { z } from "zod";

import { defineAction } from "../../action.js";
import { orgAdminAudit } from "../../audit/org-admin.js";
import {
  registerMessagingChannelWebhook,
  removeMessagingChannelCredentials,
  saveMessagingChannelCredentials,
  setMessagingChannelEnabled,
} from "../channel-settings.js";

export default defineAction({
  description:
    'Set up, turn on, or turn off one of this app\'s messaging channels. Owners and admins only; the change applies to everyone who messages this app\'s agent. "save-credentials" saves `values` (credential name to value, names from list-messaging-channels) in the workspace by default, or replaces the exact unreadable Channels-managed scope reported by list-messaging-channels; a credential with saveable: false can only be set in the deployment environment. "enable" turns a set-up channel on and fails with channel_not_configured while required credentials are missing, or credential_store_unavailable when saved credentials cannot be read. Replace unreadable saveable credentials or remove Channels-managed credentials before enabling. "disable" turns it off. "remove-credentials" deletes workspace credentials saved from Channels plus any exact unreadable Channels-managed scope reported for those keys, without deleting readable user or organization credentials or deployment variables; the agent stops replying there unless another scope or the deployment still provides the credentials. "register-webhook" registers the webhook URL with the provider (Telegram). Call list-messaging-channels first.',
  schema: z.object({
    operation: z
      .enum([
        "save-credentials",
        "enable",
        "disable",
        "remove-credentials",
        "register-webhook",
      ])
      .describe(
        '"save-credentials", "enable", "disable", "remove-credentials", or "register-webhook".',
      ),
    platform: z
      .string()
      .min(1)
      .max(64)
      .describe(
        'The channel id from list-messaging-channels, e.g. "slack", "telegram", "google-docs".',
      ),
    values: z
      .record(z.string(), z.string().max(16_384))
      .optional()
      .describe(
        'save-credentials only: credential name to value, e.g. {"TELEGRAM_BOT_TOKEN": "..."}. Names come from the channel\'s credentials.',
      ),
  }),
  // Credentials for a deployment-wide bot are not something a sandboxed
  // extension should be able to swap.
  toolCallable: false,
  audit: orgAdminAudit({
    targetType: "messaging-channel",
    targetId: (args) => args.platform,
    recordInputs: false,
    summary: (args) => {
      switch (args.operation) {
        case "save-credentials":
          return `Saved ${args.platform} channel credentials`;
        case "remove-credentials":
          return `Removed ${args.platform} channel credentials`;
        case "register-webhook":
          return `Registered the ${args.platform} webhook`;
        default:
          return `Turned ${args.operation === "enable" ? "on" : "off"} the ${args.platform} channel`;
      }
    },
  }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  },
  run: async ({ operation, platform, values }, ctx) => {
    switch (operation) {
      case "save-credentials":
        return saveMessagingChannelCredentials(ctx, platform, values ?? {});
      case "enable":
      case "disable":
        return setMessagingChannelEnabled(
          ctx,
          platform,
          operation === "enable",
        );
      case "remove-credentials":
        return removeMessagingChannelCredentials(ctx, platform);
      case "register-webhook":
        return registerMessagingChannelWebhook(ctx, platform);
    }
  },
});
