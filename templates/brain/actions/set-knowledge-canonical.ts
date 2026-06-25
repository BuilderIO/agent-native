import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { setKnowledgeCanonicalResource } from "../server/lib/brain.js";
import { booleanishSchema } from "./_schemas.js";

export default defineAction({
  description:
    "Publish or unpublish an approved Brain knowledge item as canonical Dispatch workspace context under context/company-brain/.",
  schema: z.object({
    knowledgeId: z.string().min(1),
    published: booleanishSchema
      .default(true)
      .describe(
        "True mirrors the knowledge item to workspace context; false removes Brain's mirrored resource path.",
      ),
  }),
  run: async ({ knowledgeId, published }) => ({
    published,
    knowledge: await setKnowledgeCanonicalResource(knowledgeId, published),
  }),
});
