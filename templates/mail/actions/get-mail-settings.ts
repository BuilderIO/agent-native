import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import { normalizeSignature } from "../shared/signature.js";
import type { UserSettings } from "../shared/types.js";

function normalize(settings: Partial<UserSettings> | undefined, email: string) {
  return {
    name: settings?.name ?? "",
    email: settings?.email || email,
    signature: normalizeSignature(settings?.signature),
    writingStyle: settings?.writingStyle ?? "",
    autocompleteEnabled: settings?.autocompleteEnabled === true,
    sendAndArchive: settings?.sendAndArchive === true,
    readingPane: settings?.previewPane !== "off",
  };
}

export default defineAction({
  description:
    "Read the user's mail settings: signature, writing style, autocomplete, Send + Mark Done, and whether the reading pane is on. Use this before changing a durable preference so unrelated settings can be preserved.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    const settings = (await getUserSetting(ownerEmail, "mail-settings")) as
      | Partial<UserSettings>
      | undefined;
    return normalize(settings, ownerEmail);
  },
});
