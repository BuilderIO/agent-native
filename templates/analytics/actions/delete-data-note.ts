import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  deleteDataNote,
  requireDataNoteScope,
} from "../server/lib/data-notes-store.js";

export default defineAction({
  description:
    "Delete one data note by id. It disappears from every chart. To keep the history, mark it fixed with save-data-note instead.",
  schema: z.object({
    id: z.string().min(1).describe("Id of the data note to delete"),
  }),
  run: async ({ id }) => deleteDataNote(requireDataNoteScope(), id),
});
