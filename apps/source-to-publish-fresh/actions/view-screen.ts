import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

export default defineAction({
  description:
    "Return the current Source to Publish workflow context for an agent working in the local, no-auth app.",
  schema: z.object({
    recipe: z.string().optional().describe("Currently selected output recipe"),
    sourceTitle: z.string().optional().describe("Current source title"),
  }),
  http: false,
  readOnly: true,
  run: async ({ recipe, sourceTitle }) => ({
    mode: "local-fixture-or-paste",
    route: "/source-to-publish",
    recipe: recipe ?? "blog",
    sourceTitle: sourceTitle ?? "Untitled source",
    imports: "coming-soon",
  }),
});
