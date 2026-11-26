import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  contactNoteSchema,
  readContactNote,
} from "../server/lib/content-notes.js";

export default defineAction({
  description:
    "Read the user's note about one person from their Mail notes collection in Content: one private page per person, a dated line for each note. Returns note: null when the user has written none. Changes nothing.",
  schema: z.object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email()
      .describe("The person's email address"),
  }),
  outputSchema: z.object({ note: contactNoteSchema.nullable() }),
  http: { method: "GET" },
  readOnly: true,
  mcpTool: "search",
  run: (args) => readContactNote(args.email),
});
