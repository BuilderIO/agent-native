import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import { normalizeContactPanelWidgets } from "../shared/contact-panel-widgets.js";
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
  readingPane: z
    .boolean()
    .optional()
    .describe(
      "Whether wide screens show the email list and the open email side by side. Off opens an email in place of the list.",
    ),
  splitInbox: z
    .boolean()
    .optional()
    .describe(
      "Whether the inbox shows the user's chosen views, labels, and saved filters as separate tabs. Off shows all inbox mail in one Inbox tab.",
    ),
  contactPanelWidgets: z
    .object({
      notes: z.boolean().optional(),
      attachments: z.boolean().optional(),
      recent: z.boolean().optional(),
    })
    .optional()
    .describe(
      "Turn built-in widgets in the person panel beside an open email on or off, for every email: notes (the user's private note about that person), attachments (files from that person, newest first), recent (recent emails with that person). Only the widgets supplied change.",
    ),
});

export default defineAction({
  description:
    "Update the user's persistent mail settings: signature, writing style, autocomplete, Send + Mark Done, the reading pane, split inbox tabs, and which built-in widgets the person panel shows. Use this for durable preferences, not email draft content. Read the current settings first and preserve fields the user did not ask to change.",
  schema: settingsSchema,
  mcpTool: false,
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
    if (args.readingPane !== undefined) {
      updates.previewPane = args.readingPane ? "right" : "off";
    }
    if (args.splitInbox !== undefined) {
      updates.combineInbox = !args.splitInbox;
    }
    if (args.contactPanelWidgets !== undefined) {
      updates.contactPanelWidgets = normalizeContactPanelWidgets(
        args.contactPanelWidgets,
        normalizeContactPanelWidgets(current.contactPanelWidgets),
      );
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
      readingPane: next.previewPane !== "off",
      splitInbox: next.combineInbox !== true,
      contactPanelWidgets: normalizeContactPanelWidgets(
        next.contactPanelWidgets,
      ),
    };
  },
});
