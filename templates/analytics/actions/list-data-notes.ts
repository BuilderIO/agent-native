import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { dashboardAnnotationScope } from "../server/lib/dashboard-annotation-scope.js";
import { dataNotesForReader } from "../server/lib/dashboard-data-notes.js";
import {
  listDataNotes,
  requireDataNoteScope,
} from "../server/lib/data-notes-store.js";

export default defineAction({
  description:
    "List the organization's data notes, newest first: known tracking problems (kind data) and product incidents (kind incident), each with its date range, status, the event names it applies to, and any charts it is pinned to. A note shows on every chart whose SQL filters on one of its matchEvents and none of its unlessEvents, plus its pinned charts, unless a dashboard hides it there. Read-only.",
  schema: z.object({
    dashboardId: z
      .string()
      .min(1)
      .optional()
      .describe(
        "List the notes this dashboard draws: its owner organization's. editable is false when they aren't yours to change.",
      ),
  }),
  readOnly: true,
  http: { method: "GET" },
  mcpTool: false,
  run: async ({ dashboardId }) => {
    const caller = requireDataNoteScope();
    if (!dashboardId) {
      return { notes: await listDataNotes(caller), editable: true };
    }
    const drawn = await dashboardAnnotationScope(dashboardId, caller);
    const notes = await listDataNotes(drawn.scope);
    return drawn.editable
      ? { notes, editable: true }
      : { notes: dataNotesForReader(notes, drawn.dashboard), editable: false };
  },
});
