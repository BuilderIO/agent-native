import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  CONTACT_NOTE_MAX_RESULT_CHARS,
  addContactNote,
  contactNoteSchema,
} from "../server/lib/content-notes.js";

export default defineAction({
  description:
    "Add a dated line to the user's note about one person, saved on that person's private page in the user's Mail notes collection in Content. The first note about someone creates the page. Pass threadId and subject to link the line back to the email it is about.",
  schema: z.object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email()
      .describe("The person's email address"),
    text: z.string().trim().min(1).max(2000).describe("The note"),
    name: z
      .string()
      .max(200)
      .optional()
      .describe("The person's name, used as the page title on a new page"),
    threadId: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe("The email thread the note is about, linked from the line"),
    subject: z
      .string()
      .max(300)
      .optional()
      .describe("That email's subject, used as the link text"),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("The user's local date as YYYY-MM-DD (default: today in UTC)"),
  }),
  outputSchema: z.object({
    note: contactNoteSchema,
    created: z.boolean(),
    appended: z.boolean(),
  }),
  maxResultChars: CONTACT_NOTE_MAX_RESULT_CHARS,
  audit: { recordInputs: false },
  mcpTool: "search",
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  run: (args) => addContactNote(args),
});
