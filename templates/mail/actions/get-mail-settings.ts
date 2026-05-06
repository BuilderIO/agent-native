import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import { z } from "zod";
import type { UserSettings } from "../shared/types.js";

function normalize(settings: Partial<UserSettings> | undefined, email: string) {
  return {
    name: settings?.name ?? "",
    email: settings?.email || email,
    signature: settings?.signature ?? "",
    writingStyle: settings?.writingStyle ?? "",
  };
}

export default defineAction({
  description:
    "Read the user's mail drafting settings, including configured signature and writing style.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    const settings = (await getUserSetting(
      ownerEmail,
      "mail-settings",
    )) as Partial<UserSettings> | undefined;
    return normalize(settings, ownerEmail);
  },
});
