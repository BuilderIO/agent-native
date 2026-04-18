import { defineAction } from "@agent-native/core";
import { z } from "zod";

export default defineAction({
  description:
    "Set appearance settings (theme, brand colors, hide branding) — a convenience wrapper over update-profile",
  schema: z.object({
    theme: z.enum(["light", "dark", "system"]).optional(),
    brandColor: z.string().optional(),
    darkBrandColor: z.string().optional(),
    hideBranding: z.boolean().optional(),
  }),
  run: async (args) => {
    const core: any = await import("@agent-native/core");
    if (core.writeSetting) {
      const existing = (await core.readSetting?.("profile-settings")) ?? {};
      await core.writeSetting("profile-settings", {
        ...(existing as object),
        ...args,
      });
    }
    return { ok: true };
  },
});
