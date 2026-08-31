import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { mutateUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import {
  mergePinnedLabels,
  mergeSavedFilters,
  mergeSettings,
  normalizeMailSettings,
} from "../server/lib/mail-settings.js";
import type { UserSettings } from "../shared/types.js";

const mobileActionId = z.enum([
  "archive",
  "trash",
  "star",
  "reply",
  "replyAll",
  "forward",
  "markUnread",
  "prev",
  "next",
]);
const savedFilterSchema = z.object({
  id: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(80),
  query: z.string().trim().min(1).max(500),
});

const patchSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  avatar: z.string().optional(),
  signature: z.string().optional(),
  writingStyle: z.string().optional(),
  theme: z.enum(["light", "dark", "system"]).optional(),
  density: z.enum(["compact", "comfortable", "spacious"]).optional(),
  previewPane: z.enum(["right", "bottom", "off"]).optional(),
  sendAndArchive: z.boolean().optional(),
  undoSendDelay: z.coerce.number().optional(),
  pinnedLabels: z.array(z.string()).optional(),
  pinnedLabelsBase: z.array(z.string()).optional(),
  savedFilters: z.array(savedFilterSchema).max(20).optional(),
  savedFiltersBase: z.array(savedFilterSchema).max(20).optional(),
  labelAliases: z.record(z.string(), z.string()).optional(),
  imagePolicy: z.enum(["show", "block-trackers", "block-all"]).optional(),
  trustedSenders: z.array(z.string()).optional(),
  mobileActions: z.array(mobileActionId).optional(),
  tracking: z.object({ opens: z.boolean(), clicks: z.boolean() }).optional(),
  requestSource: z
    .string()
    .min(1)
    .max(256)
    .optional()
    .describe("Stable browser tab id used to suppress the caller's own echo"),
});

export default defineAction({
  description:
    "Update the mail preferences backing the Settings UI. Only the supplied fields change. Agents should use update-mail-settings for signature and writing style.",
  schema: patchSchema,
  http: { method: "PUT" },
  agentTool: false,
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Unauthorized");

    const { requestSource, pinnedLabelsBase, savedFiltersBase, ...patch } =
      args;
    const updated = await mutateUserSetting(
      ownerEmail,
      "mail-settings",
      (current) => {
        const base = normalizeMailSettings(current, ownerEmail);
        const next = mergeSettings(base, patch as Partial<UserSettings>);
        if ("pinnedLabels" in patch) {
          next.pinnedLabels = mergePinnedLabels(
            base.pinnedLabels,
            patch.pinnedLabels,
            pinnedLabelsBase,
          );
        }
        if ("savedFilters" in patch) {
          next.savedFilters = mergeSavedFilters(
            base.savedFilters,
            patch.savedFilters,
            savedFiltersBase,
          );
        }
        return next as unknown as Record<string, unknown>;
      },
      { requestSource },
    );
    return normalizeMailSettings(updated, ownerEmail);
  },
});
