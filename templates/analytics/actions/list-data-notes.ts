import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import type {
  DashboardAnnotations,
  SqlPanel,
} from "../app/pages/adhoc/sql-dashboard/types";
import { repairKnownFirstPartyDashboardQueries } from "../server/lib/canonical-first-party-dashboard-repair.js";
import { dashboardAnnotationScope } from "../server/lib/dashboard-annotation-scope.js";
import type { DashboardRecord } from "../server/lib/dashboards-store.js";
import {
  listDataNotes,
  requireDataNoteScope,
} from "../server/lib/data-notes-store.js";
import { dataNotesForPanel, type DataNote } from "../shared/data-notes.js";

/**
 * Another organization's notes as one of its dashboards shows them: only the
 * ones its charts draw, with the ones it hides unless the reader can show
 * them again, and no member emails.
 */
function notesForReader(
  notes: readonly DataNote[],
  dashboard: DashboardRecord,
): DataNote[] {
  const config = repairKnownFirstPartyDashboardQueries(
    dashboard.id,
    dashboard.config as Record<string, unknown>,
  ).config as { panels?: SqlPanel[]; annotations?: DashboardAnnotations };
  const annotations = dashboard.canEdit ? undefined : config.annotations;
  const shown = new Set(
    (config.panels ?? []).flatMap((panel) =>
      dataNotesForPanel(notes, dashboard.id, panel, annotations).map(
        (note) => note.id,
      ),
    ),
  );
  return notes
    .filter((note) => shown.has(note.id))
    .map(({ addedBy: _, ...note }) => note);
}

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
      : { notes: notesForReader(notes, drawn.dashboard), editable: false };
  },
});
