import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  addMailNote,
  mailNoteEmailSchema,
  mailNoteSchema,
} from "./_mail-notes.js";

export default defineAction({
  description:
    "Add a dated line to the user's private note about one person, in their Mail notes collection in Personal. The first note about someone creates their page, keyed by email, and the first note ever creates the collection. Mail calls this when the user adds a note beside an email; `created` is true when this made the person's page.",
  schema: z.object({
    email: mailNoteEmailSchema,
    text: z.string().trim().min(1).max(2000).describe("The note, one line"),
    name: z
      .string()
      .trim()
      .max(200)
      .optional()
      .describe("The person's name, for the page title of a new note"),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe(
        "The day the line is dated, YYYY-MM-DD; defaults to today (UTC)",
      ),
    link: z
      .object({
        label: z.string().trim().min(1).max(300),
        url: z.url({ protocol: /^https?$/ }),
      })
      .optional()
      .describe(
        "The email the note was written beside, linked at the end of the line",
      ),
  }),
  outputSchema: z.object({ note: mailNoteSchema, created: z.boolean() }),
  agentTool: false,
  mcpTool: true,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  publicAgent: {
    expose: true,
    readOnly: false,
    requiresAuth: true,
    directWrite: true,
  },
  audit: { recordInputs: false },
  run: (args, ctx) => addMailNote(args, ctx),
});
