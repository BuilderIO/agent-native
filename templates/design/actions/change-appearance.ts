import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

// Overrides the core `change-appearance` action (see
// packages/core/src/appearance/actions/change-appearance.ts) with a
// Design-specific description. Design is the one template where the shared
// wording is actively misleading: this preset only tints the Design EDITOR's
// own chrome, but Design also generates prototypes with their own colors, so
// an agent (and users) reasonably read "change the theme" as "restyle my
// prototype" and land here instead of `index-design-tokens` +
// `apply-design-token-edit`. Same schema and run behavior as core — narrowed
// description only.
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
