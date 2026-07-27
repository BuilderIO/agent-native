import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { readSettings } from "../server/lib/mail-settings.js";

export default defineAction({
  description:
    "Read the full mail preferences object backing the Settings UI (appearance, reading, tracking, and drafting fields). Agents should use get-mail-settings for signature and writing style.",
  schema: z.object({}),
  http: { method: "GET" },
  agentTool: false,
  run: async () => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Unauthorized");
    return readSettings(ownerEmail);
  },
});
