import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import { normalizeSignature } from "../shared/signature.js";
import type { UserSettings } from "../shared/types.js";

const settingsSchema = z.object({
  name: z.string().optional().describe("Display name for local fallback mail"),
  signature: z
    .string()
    .optional()
    .describe(
      "Persistent Markdown/plain-text signature for new drafts. Preserve the existing signature unless the user asks to replace it.",
    ),
  writingStyle: z
    .string()
    .optional()
    .describe(
      "Persistent writing rules for generated drafts. Read the current setting first, merge the requested change, and preserve unrelated rules.",
    ),
  autocompleteEnabled: z
    .boolean()
    .optional()
    .describe(
      "Whether to show local common-phrase autocomplete while composing.",
    ),
  sendAndArchive: z
    .boolean()
    .optional()
    .describe(
      "Whether ordinary reply sends mark the existing thread Done. Explicit Send + Mark Done remains available when this is off.",
    ),
});

export default defineAction({
  description:
    "Update the user's persistent mail drafting settings, including signature, writing style, autocomplete, and Send + Mark Done. Use this for durable preferences, not email draft content. Read the current settings first and preserve fields the user did not ask to change.",
  schema: settingsSchema,
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    const current =
      ((await getUserSetting(ownerEmail, "mail-settings")) as
        | Partial<UserSettings>
        | undefined) ?? {};

    const updates: Partial<UserSettings> = {};
    if (args.name !== undefined) updates.name = args.name.trim();
    if (args.signature !== undefined) {
      updates.signature = normalizeSignature(args.signature);
    }
    if (args.writingStyle !== undefined) {
      updates.writingStyle = args.writingStyle.trim();
    }
    if (args.autocompleteEnabled !== undefined) {
      updates.autocompleteEnabled = args.autocompleteEnabled;
    }
    if (args.sendAndArchive !== undefined) {
      updates.sendAndArchive = args.sendAndArchive;
    }

    const next = {
      ...current,
      email: current.email || ownerEmail,
      ...updates,
    };
    await putUserSetting(ownerEmail, "mail-settings", next);
    return {
      name: next.name ?? "",
      email: next.email || ownerEmail,
      signature: next.signature ?? "",
      writingStyle: next.writingStyle ?? "",
      autocompleteEnabled: next.autocompleteEnabled === true,
      sendAndArchive: next.sendAndArchive === true,
    };
  },
});
