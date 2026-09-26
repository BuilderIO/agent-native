import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

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
    "Set the Design EDITOR's own workspace chrome (background tint + accent " +
    "color around the canvas) — not the user's generated design. Use only " +
    "when the user asks to change how the Design app itself looks. Does not " +
    "restyle the design/prototype; for that, call `index-design-tokens` then " +
    "`apply-design-token-edit`. Pass 'default' to clear the editor preset.",
  schema: z.object({
    preset: z
      .enum(PRESET_IDS)
      .describe(
        "Editor chrome preset id. One of: default (template's base palette), warm (cream/orange), ocean (light blue), forest (light green), rose (light pink), slate (cool grey).",
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
