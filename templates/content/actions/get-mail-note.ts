import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  mailNoteEmailSchema,
  mailNoteSchema,
  readMailNote,
} from "./_mail-notes.js";

export default defineAction({
  description:
    "Read the user's private note about one person from their Mail notes collection: the person's page as Markdown and a link to open it. `note: null` means no note about that person yet. Mail calls this for the panel beside an open email. Changes nothing.",
  schema: z.object({ email: mailNoteEmailSchema }),
  outputSchema: z.object({ note: mailNoteSchema.nullable() }),
  http: { method: "GET" },
  readOnly: true,
  agentTool: false,
  mcpTool: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async ({ email }) => ({ note: await readMailNote(email) }),
});
