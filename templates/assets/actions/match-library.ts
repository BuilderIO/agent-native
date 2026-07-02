import { defineAction } from "@agent-native/core";
import { z } from "zod";

import listLibraries from "./list-libraries.js";

export default defineAction({
  description:
    "Find the best asset library for a free-text use case. Use this before generating when the caller does not know which library to use.",
  schema: z.object({
    description: z.string().min(1),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ description }) => {
    const result = await listLibraries.run({ compact: false });
    const libraries = Array.isArray((result as any).libraries)
      ? (result as any).libraries
      : [];
    const query = description.toLowerCase();
    const scored = libraries
      .map((library: any) => {
        const haystack = [
          library.title,
          library.description,
          library.styleBrief?.description,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        const score = query
          .split(/\W+/)
          .filter((word) => word.length > 2 && haystack.includes(word)).length;
        return { library, score };
      })
      .sort((a: any, b: any) => b.score - a.score);
    return {
      description,
      match: scored[0]?.library ?? null,
      alternatives: scored.slice(1, 4).map((item: any) => item.library),
    };
  },
});
