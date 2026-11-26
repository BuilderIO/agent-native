import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  CONTACT_NOTE_MAX_RESULT_CHARS,
  contactNoteSchema,
  readContactNote,
} from "../server/lib/content-notes.js";

export default defineAction({
  description:
    "Read the user's note about one person from their Mail notes collection in Content: one private page per person, a dated line for each note. Returns note: null when the user has written none, and only the newest lines of a very long page (truncated: true). Changes nothing.",
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
  maxResultChars: CONTACT_NOTE_MAX_RESULT_CHARS,
  mcpTool: "search",
  run: (args) => readContactNote(args.email),
});
