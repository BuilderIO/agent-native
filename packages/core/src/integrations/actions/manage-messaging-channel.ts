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
    "Manage a messaging channel in this app from the signed-in Channels settings UI. Owners and admins only. Enable and disable apply to everyone who messages the app agent. Save-credentials saves values (credential name to value, names from list-messaging-channels) in the workspace by default, or replaces the exact unreadable scope reported by list-messaging-channels. A user repair changes only the caller credential, not credentials belonging to other users. A credential marked saveable false can only be set in the deployment environment. Enable fails while required credentials are missing or saved credentials cannot be read. Replace unreadable saveable credentials or remove Channels-managed credentials before enabling. Remove-credentials deletes only the exact removable credential references listed by list-messaging-channels; agent calls require human approval even when supplied a listed removalConfirmation. In Settings, the owner reviews and confirms selected credential keys and removal confirmations. Refresh the list and ask the owner to confirm again if a token is stale. This removes only Channels-managed credentials, not credentials stored elsewhere or deployment variables. Register-webhook registers the webhook URL with the provider Telegram. Call list-messaging-channels first.",
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
    confirmedCredentials: z
      .array(
        z.object({
          key: z.string().min(1),
          removalConfirmation: z.string().min(1),
        }),
      )
      .optional()
      .describe(
        "remove-credentials only: the exact {key, removalConfirmation} pairs for credentials listed as removable by list-messaging-channels and explicitly confirmed by the owner. Refresh the list and confirm again if the token is stale.",
      ),
  }),
  needsApproval: (args) => args.operation === "remove-credentials",
  // Credentials for a deployment-wide bot are not something a sandboxed
  // extension should be able to swap.
  toolCallable: false,
  agentTool: false,
  uiOnly: true,
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
  run: async ({ operation, platform, values, confirmedCredentials }, ctx) => {
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
        return removeMessagingChannelCredentials(
          ctx,
          platform,
          confirmedCredentials ?? [],
        );
      case "register-webhook":
        return registerMessagingChannelWebhook(ctx, platform);
    }
  },
});
