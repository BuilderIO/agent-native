import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getSchedulingContext } from "../server/context.js";
import { currentUserEmail } from "./_helpers.js";

// Profile data lives in consumer-provided settings (not the scheduling schema);
// this action delegates to the core `settings` subsystem via a well-known key.
export default defineAction({
  description:
    "Update the current user's profile (name, bio, timezone, brand colors, etc.)",
  schema: z.object({
    name: z.string().optional(),
    bio: z.string().optional(),
    avatarUrl: z.string().optional(),
    timezone: z.string().optional(),
    weekStart: z.enum(["sunday", "monday"]).optional(),
    timeFormat: z.enum(["12h", "24h"]).optional(),
    brandColor: z.string().optional(),
    darkBrandColor: z.string().optional(),
    hideBranding: z.boolean().optional(),
  }),
  run: async (args) => {
    // The consumer template wires a `profile-settings` settings key; we just
    // read/merge/write it. Accessed via dynamic import to avoid a hard dep on
    // the core settings API here (different consumers may use alternate stores).
    const core: any = await import("@agent-native/core");
    if (core.writeSetting) {
      const existing = (await core.readSetting?.("profile-settings")) ?? {};
      await core.writeSetting("profile-settings", {
        ...(existing as object),
        ...args,
      });
    }
    return { ok: true, userEmail: currentUserEmail() };
  },
});
