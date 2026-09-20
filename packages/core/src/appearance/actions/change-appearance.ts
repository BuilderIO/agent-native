import { z } from "zod";

import { defineAction } from "../../action.js";
import { writeAppState } from "../../application-state/script-helpers.js";

const PRESET_IDS = [
  "default",
  "warm",
  "ocean",
  "forest",
  "rose",
  "slate",
] as const;

export default defineAction({
  description:
    "Set the user's appearance preset (background tint + accent color). Use when the user asks to change the theme, background color, or 'how the app looks'. Pass 'default' to clear any active preset and return to the template's base palette.",
  schema: z.object({
    preset: z
      .enum(PRESET_IDS)
      .describe(
        "Appearance preset id. One of: default (template's base palette), warm (cream/orange), ocean (light blue), forest (light green), rose (light pink), slate (cool grey).",
      ),
  }),
  run: async ({ preset }) => {
    await writeAppState("appearance", { preset });
    return {
      preset,
      message:
        preset === "default"
          ? "Cleared appearance preset — back to the template's base palette."
          : `Applied appearance preset: ${preset}.`,
    };
  },
});
