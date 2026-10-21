import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { getBuiltInSlideTheme } from "../server/lib/slide-themes.js";

export default defineAction({
  description:
    "Read a bundled slide theme's complete authoring guide with Slides 2 compatibility notes. Treat examples as visual references: keep design type sizes at or below 320px, omit remote font loading, DOM/browser globals and effects, map only supported SQL theme tokens, and store the selected ID in every generated slide's static meta.theme.",
  schema: z.object({
    id: z
      .string()
      .min(1)
      .max(100)
      .describe("Theme ID returned by list-slide-themes"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ id }) => {
    const theme = getBuiltInSlideTheme(id);
    if (!theme) {
      fail("Slide theme not found.", {
        errorCode: "slide_theme_not_found",
        statusCode: 404,
      });
    }
    const compatibilityNotes = [
      "## Slides 2 runtime and persistence notes",
      "Treat the following bundled theme guide as a visual reference, not paste-ready Slides 2 source. Put this static export in every generated slide module so the selected theme stays attached to each saved source page:",
      "```tsx",
      `export const meta = { theme: ${JSON.stringify(theme.id)} };`,
      "```",
      "`create-deck` preserves module-level `meta` exports when it splits a static page array into separate SQL slides. Repeat the export in each `add-slide` source module.",
      "",
      "The Worker accepts static `design` values, but `design.typeScale.hero` and `.body` are pixel sizes capped at 320; reduce Aero's 620px hero value before using it. Do not copy Google Fonts URLs or code that inserts `link`/`style` nodes through `document`. Use available system font stacks and static scoped CSS. Do not copy `window`, `document`, `performance`, `requestAnimationFrame`, or effect-driven behavior such as `useEffect`; the Worker renders statically. Use only the supported `Step`, `Steps`, `useSlidePageNumber()`, and `useIsActivePage()` runtime APIs for page/reveal behavior.",
      "",
      "Theme guide `design` exports and Slides 2 SQL deck tokens are different contracts. Map `design.palette.bg`, `.text`, and `.accent` to token `background`, `text`, and `accent`. Choose token fonts from Arial, Courier New, Georgia, Helvetica, system-ui, Times New Roman, Trebuchet MS, or Verdana; the guide's Barlow, Inter, Newsreader, Gabarito, and DM Mono families cannot be saved as SQL font tokens. `design.typeScale` values are pixels, while SQL `heroScale` and `bodyScale` are multipliers from 0.5 to 2; choose multipliers instead of passing pixel sizes. Map `radius` only when it is within the SQL token range of 0 to 48. Read and write deck tokens through `get-deck-design-tokens` and `update-deck-design-tokens` with the current `updatedAt`.",
      "",
      "---",
      "",
      theme.guide,
    ].join("\n");
    return { ...theme, guide: compatibilityNotes };
  },
});
