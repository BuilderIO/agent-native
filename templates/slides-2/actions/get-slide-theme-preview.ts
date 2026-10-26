import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { hashSlideSource } from "../server/lib/slide-source.js";
import { getBuiltInSlideThemeDemoSource } from "../server/lib/slide-theme-demo-sources.js";
import { getBuiltInSlideTheme } from "../server/lib/slide-themes.js";
import { buildReactSlideRuntime } from "../server/lib/slide-worker-runtime.js";

export default defineAction({
  title: "Render slide theme preview",
  description:
    "Render one built-in theme demo page in the same bounded Worker and opaque-origin iframe used by saved slides. Use the theme gallery's preview for visual selection; this does not create a deck or save slide data.",
  agentTool: false,
  schema: z.object({
    id: z.string().min(1).max(100).describe("Built-in slide theme ID"),
    pageIndex: z
      .number()
      .int()
      .min(0)
      .max(2)
      .describe("Zero-based demo page index: 0, 1, or 2"),
  }),
  http: { method: "GET" },
  readOnly: true,
  retrySafe: true,
  run: async ({ id, pageIndex }) => {
    const theme = getBuiltInSlideTheme(id);
    const sourceTsx = getBuiltInSlideThemeDemoSource(id, pageIndex);
    if (!theme || !sourceTsx) {
      fail("Slide theme preview not found.", {
        errorCode: "slide_theme_preview_not_found",
        statusCode: 404,
      });
    }

    const pageCount = 3;
    const runtime = await buildReactSlideRuntime(sourceTsx, {
      current: pageIndex + 1,
      total: pageCount,
      assetUrls: new Map(),
    });
    const slideId = `theme-${id}-${pageIndex}`;

    return {
      pageIndex,
      pageCount,
      artifact: {
        protocolVersion: 1,
        deckId: `theme-${id}`,
        slideId,
        revision: 1,
        sourceHash: hashSlideSource(sourceTsx),
        width: 1920,
        height: 1080,
        html: "",
        assetOrigins: [],
        fontOrigins: [],
        fontAssets: [],
        runtime,
      },
      theme: { id: theme.id, name: theme.name },
    };
  },
});
