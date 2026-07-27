import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description:
    "Navigate the UI to a specific view, date, or event. Writes a navigate command to application state which the UI reads and auto-deletes.",
  schema: z.object({
    view: z
      .string()
      .optional()
      .describe(
        "View to navigate to (calendar, availability, booking-links, bookings, settings, extensions)",
      ),
    calendarViewMode: z
      .enum(["day", "week", "month"])
      .optional()
      .describe(
        "Calendar display mode: day, week, or month. Use this to switch between day/week/month views.",
      ),
    date: z
      .string()
      .optional()
      .describe("Date to jump to on the calendar (YYYY-MM-DD)"),
    eventId: z.string().optional().describe("Event ID to open"),
    eventDraftId: z
      .string()
      .optional()
      .describe("Unsent calendar invite draft ID to open for review"),
    extensionId: z.string().optional().describe("Extension ID to open"),
  }),
  http: false,
  run: async (args) => {
    if (
      !args.view &&
      !args.date &&
      !args.eventId &&
      !args.eventDraftId &&
      !args.calendarViewMode &&
      !args.extensionId
    ) {
      throw new Error(
        "At least view, date, calendarViewMode, eventId, eventDraftId, or extensionId is required.",
      );
    }
    const nav: Record<string, string> = {};
    if (args.view) nav.view = args.view;
    if (args.calendarViewMode) nav.calendarViewMode = args.calendarViewMode;
    if (args.date) nav.date = args.date;
    if (args.eventId) nav.eventId = args.eventId;
    if (args.eventDraftId) {
      nav.view = args.view ?? "calendar";
      nav.eventDraftId = args.eventDraftId;
    }
    if (args.extensionId) {
      nav.view = args.view ?? "extensions";
      nav.extensionId = args.extensionId;
    }
    await writeAppState("navigate", nav);

    const parts: string[] = [];
    if (args.view) parts.push(args.view);
    if (args.calendarViewMode) parts.push(`mode:${args.calendarViewMode}`);
    if (args.date) parts.push(`date:${args.date}`);
    if (args.eventId) parts.push(`event:${args.eventId}`);
    if (args.eventDraftId) parts.push(`event-draft:${args.eventDraftId}`);
    if (args.extensionId) parts.push(`extension:${args.extensionId}`);
    return `Navigating to ${parts.join(" ")}`;
  },
});
