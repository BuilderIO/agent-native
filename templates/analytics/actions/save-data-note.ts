import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { readDashboardForPlacement } from "../server/lib/dashboard-annotation-reads.js";
import { dataNotePlacement } from "../server/lib/dashboard-annotation-summary.js";
import {
  requireDataNoteScope,
  saveDataNote,
} from "../server/lib/data-notes-store.js";
import { DATA_NOTE_KINDS, DATA_NOTE_STATUSES } from "../shared/data-notes.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use "YYYY-MM-DD"');

export default defineAction({
  description:
    'Add a data note, or change the given fields of one by id. A data note explains a stretch of data on charts: kind "data" for tracking problems such as an undercount, a gap, or a renamed event, kind "incident" for a product outage. It draws as a shaded band over its dates on time charts (red for incidents, amber for open data problems, grey once fixed) and as a line under charts without a date axis. It shows on every chart whose SQL filters on one of matchEvents, unless the SQL also filters on one of unlessEvents (the replacement event that covers the gap), and on the charts listed in panels. Leave endDate empty while the problem is ongoing; mark it fixed with status "fixed", endDate, and fix. State facts the data shows; leave out causes nobody has confirmed. Pass dashboardId for the dashboard on screen: then `dashboard.shownOn` in the result lists the charts there that draw the note, and `hint` says why when none do.',
  schema: z.object({
    id: z
      .string()
      .min(1)
      .optional()
      .describe("Id of the note to change; omit to add one"),
    kind: z
      .enum(DATA_NOTE_KINDS)
      .optional()
      .describe('"data" or "incident"; required when adding'),
    title: z
      .string()
      .min(1)
      .max(120)
      .optional()
      .describe(
        'Short title shown on the band, for example "Connect clicks undercounted"; required when adding',
      ),
    note: z
      .string()
      .min(1)
      .max(1000)
      .optional()
      .describe(
        "What happened to the data and when, in a sentence or two; required when adding",
      ),
    startDate: isoDate
      .nullable()
      .optional()
      .describe(
        "First affected day; null or omitted when it has no known start",
      ),
    endDate: isoDate
      .nullable()
      .optional()
      .describe("Last affected day, inclusive; null while ongoing"),
    status: z
      .enum(DATA_NOTE_STATUSES)
      .optional()
      .describe('"open" (default) or "fixed"; fixed needs endDate'),
    fix: z
      .string()
      .max(500)
      .nullable()
      .optional()
      .describe("What fixed it, shown with the note once fixed"),
    matchEvents: z
      .array(z.string().min(1).max(200))
      .max(20)
      .optional()
      .describe(
        'Event names exactly as charts filter on them, for example ["builder connect clicked"]',
      ),
    unlessEvents: z
      .array(z.string().min(1).max(200))
      .max(20)
      .optional()
      .describe(
        "Event names that cover the gap: charts that also count one of these do not show the note",
      ),
    panels: z
      .array(
        z.object({
          dashboardId: z.string().min(1).describe("Dashboard id"),
          panelId: z.string().min(1).describe("Panel id on that dashboard"),
        }),
      )
      .max(50)
      .optional()
      .describe("Charts the note shows on whatever their SQL counts"),
    dashboardId: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Dashboard to check the note against, usually the one on screen; not stored",
      ),
  }),
  run: async ({ dashboardId, ...input }) => {
    const scope = requireDataNoteScope();
    const check = dashboardId
      ? await readDashboardForPlacement(dashboardId, scope)
      : undefined;
    const note = await saveDataNote(scope, input);
    if (!dashboardId || !check) return note;
    return {
      ...note,
      dashboard:
        "config" in check
          ? dataNotePlacement(note, dashboardId, check.config)
          : { dashboardId, hint: check.unavailable },
    };
  },
});
