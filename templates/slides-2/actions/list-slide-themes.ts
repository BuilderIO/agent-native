import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listBuiltInSlideThemeSummaries } from "../server/lib/slide-themes.js";

export default defineAction({
  description:
    "List bundled slide authoring themes by id, name, description, and mode. Use get-slide-theme to read a selected theme's complete guide; themes are authoring references, separate from deck templates and SQL design systems.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  mcpApp: { compactCatalog: true },
  run: async () => {
    const themes = listBuiltInSlideThemeSummaries();
    return { count: themes.length, themes };
  },
});
