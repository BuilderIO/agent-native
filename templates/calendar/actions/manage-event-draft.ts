import { defineAction, embedApp } from "@agent-native/core";
import {
  readAppState,
  writeAppState,
  deleteAppState,
  deleteAppStateByPrefix,
} from "@agent-native/core/application-state";
import { buildDeepLink, getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import type { CalendarEventDraft } from "../shared/api.js";
import {
  attachmentsInput,
  availabilityInput,
  buildReminderOverrides,
  cliBoolean,
  eventTypeInput,
  googleColorIdInput,
  reminderMethodInput,
  reminderMinutesInput,
  remindersInput,
  visibilityInput,
  workingLocationTypeInput,
} from "./event-action-helpers.js";

const DRAFT_PREFIX = "calendar-draft-";

const attendeesInput = z
  .union([
    z.array(
      z.object({
        email: z.string(),
        displayName: z.string().optional(),
      }),
    ),
    z.string(),
  ])
  .optional();

function sanitizeDraftId(id: string): string | null {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id) ? id : null;
}

function draftKey(id: string) {
  return `${DRAFT_PREFIX}${id}`;
}

function normalizeAttendees(
  input: z.infer<typeof attendeesInput>,
): CalendarEventDraft["attendees"] | undefined {
  if (input === undefined) return undefined;
  if (typeof input === "string") {
    const emails = input
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.includes("@"));
    return emails.map((email) => ({ email }));
  }
  return input
    .filter((a) => a.email && a.email.includes("@"))
    .map((a) => ({
      email: a.email,
      ...(a.displayName ? { displayName: a.displayName } : {}),
    }));
}

/**
 * Deep link that reopens an unsent calendar event draft.
 *
 * The link is an opaque pointer (draft id + date only). The full draft —
 * title, attendees, description, location — lives in the
 * `calendar-draft-{id}` app-state row written by this action, so the
 * calendar reads it from there on render. We deliberately do NOT inline the
 * draft contents into the URL: external MCP hosts (ChatGPT / Claude)
 * surface this link in their UI, the host LLM can see and remember query
 * strings, and shared / exported chat transcripts would otherwise leak
 * private meeting content.
 */
function eventDraftDeepLink(draft: CalendarEventDraft): string {
  return buildDeepLink({
    app: "calendar",
    view: "calendar",
    to: "/",
    params: {
      eventDraftId: draft.id,
      date: draft.start?.slice(0, 10),
    },
  });
}

function setIfPresent<T extends keyof CalendarEventDraft>(
  target: CalendarEventDraft,
  key: T,
  value: CalendarEventDraft[T] | undefined,
) {
  if (value !== undefined) target[key] = value;
}

export default defineAction({
  description:
    "Create, update, or delete an unsent calendar invite draft. Opening a draft shows a visible placeholder on the calendar with the event detail editor so the user can review it before creating/sending.",
  schema: z.object({
    action: z
      .enum(["create", "update", "delete", "delete-all"])
      .optional()
      .describe("Action to perform. Defaults to create."),
    id: z
      .string()
      .optional()
      .describe(
        "Draft ID (auto-generated for create; required for update/delete)",
      ),
    title: z.string().optional().describe("Event title"),
    start: z.string().optional().describe("Start time, ISO format"),
    end: z.string().optional().describe("End time, ISO format"),
    startTimeZone: z
      .string()
      .optional()
      .describe("IANA timezone for the event start, e.g. America/New_York"),
    endTimeZone: z
      .string()
      .optional()
      .describe("IANA timezone for the event end, e.g. America/New_York"),
    description: z.string().optional().describe("Event description"),
    location: z.string().optional().describe("Event location"),
    allDay: cliBoolean.optional().describe("Whether the event is all-day"),
    eventType: eventTypeInput.describe(
      "Native Google Calendar event type: default, outOfOffice, focusTime, or workingLocation.",
    ),
    transparency: availabilityInput.describe(
      "Google Calendar availability: opaque blocks time (Busy), transparent does not block time (Free).",
    ),
    visibility: visibilityInput.describe(
      "Google Calendar visibility: default, public, private, or confidential.",
    ),
    remindersUseDefault: cliBoolean
      .optional()
      .describe(
        "Whether to use calendar default reminders. Set false with no reminders for no alerts.",
      ),
    reminders: remindersInput.describe(
      "Custom reminder overrides, max 5, such as [{method:'popup', minutes:10}].",
    ),
    reminderMinutes: reminderMinutesInput.describe(
      "Convenience field for a single reminder in minutes before the event.",
    ),
    reminderMethod: reminderMethodInput.describe(
      "Reminder method for reminderMinutes. Defaults to popup.",
    ),
    attachments: attachmentsInput.describe(
      "Google Calendar attachments, max 25. Use Drive or https file URLs, e.g. [{fileUrl,title}].",
    ),
    colorId: googleColorIdInput.describe(
      "Google Calendar event color id, 1 through 11.",
    ),
    workingLocationType: workingLocationTypeInput.describe(
      "For eventType=workingLocation: homeOffice, officeLocation, or customLocation.",
    ),
    workingLocationLabel: z
      .string()
      .optional()
      .describe(
        "For eventType=workingLocation: label shown in Google Calendar.",
      ),
    addGoogleMeet: cliBoolean
      .optional()
      .describe("Preselect Google Meet for this draft"),
    addZoom: cliBoolean.optional().describe("Preselect Zoom for this draft"),
    attendees: attendeesInput.describe(
      "Invitees — either an array of {email, displayName?} or a comma-separated string of emails",
    ),
    accountEmail: z
      .string()
      .optional()
      .describe("Account email to create the event on"),
  }),
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Review calendar invite",
      description:
        "Open the draft in the real Calendar event editor so the user can review attendees, time, location, conferencing, and reminders.",
      iframeTitle: "Agent-Native Calendar",
      openLabel: "Open in Calendar",
      height: 900,
    }),
  },
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    const action = args.action ?? "create";
    if (args.addGoogleMeet && args.addZoom) {
      throw new Error("Choose either Google Meet or Zoom, not both.");
    }

    if (action === "delete-all") {
      const count = await deleteAppStateByPrefix(DRAFT_PREFIX);
      return `Deleted ${count} calendar event draft(s)`;
    }

    if (action === "delete") {
      if (!args.id) throw new Error("--id is required for delete");
      const safeId = sanitizeDraftId(args.id);
      if (!safeId) throw new Error(`Invalid draft ID "${args.id}"`);
      const deleted = await deleteAppState(draftKey(safeId));
      if (!deleted)
        throw new Error(`Calendar event draft "${safeId}" not found`);
      return `Deleted calendar event draft ${safeId}`;
    }

    const rawId = args.id || `draft-${Date.now()}`;
    const id = sanitizeDraftId(rawId) ?? `draft-${Date.now()}`;
    const existing =
      action === "update"
        ? ((await readAppState(
            draftKey(id),
          )) as unknown as CalendarEventDraft | null)
        : null;

    if (action === "update" && !existing) {
      throw new Error(`Calendar event draft "${id}" not found`);
    }

    const now = new Date().toISOString();
    const draft: CalendarEventDraft = {
      ...(existing ?? { id, createdAt: now }),
      id,
      updatedAt: now,
    };

    setIfPresent(draft, "title", args.title);
    setIfPresent(draft, "description", args.description);
    setIfPresent(draft, "start", args.start);
    setIfPresent(draft, "end", args.end);
    setIfPresent(draft, "startTimeZone", args.startTimeZone);
    setIfPresent(draft, "endTimeZone", args.endTimeZone);
    setIfPresent(draft, "location", args.location);
    setIfPresent(draft, "allDay", args.allDay);
    setIfPresent(draft, "eventType", args.eventType);
    setIfPresent(draft, "transparency", args.transparency);
    setIfPresent(draft, "visibility", args.visibility);
    setIfPresent(draft, "colorId", args.colorId);
    setIfPresent(draft, "attachments", args.attachments);
    setIfPresent(draft, "workingLocationType", args.workingLocationType);
    setIfPresent(draft, "workingLocationLabel", args.workingLocationLabel);
    setIfPresent(draft, "addGoogleMeet", args.addGoogleMeet);
    setIfPresent(draft, "addZoom", args.addZoom);
    setIfPresent(draft, "accountEmail", args.accountEmail);

    const attendees = normalizeAttendees(args.attendees);
    setIfPresent(draft, "attendees", attendees);

    const reminderFields = buildReminderOverrides({
      reminders: args.reminders,
      reminderMinutes: args.reminderMinutes,
      reminderMethod: args.reminderMethod,
      useDefaultReminders: args.remindersUseDefault,
    });
    Object.assign(draft, reminderFields);

    await writeAppState(
      draftKey(id),
      draft as unknown as Record<string, unknown>,
    );

    return {
      id,
      draft,
      deepLink: eventDraftDeepLink(draft),
      message: `Saved calendar event draft ${id}`,
    };
  },
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const draft = (result as { draft?: CalendarEventDraft }).draft;
    const id = (result as { id?: string }).id;
    if (!draft || !id) return null;
    return {
      url: eventDraftDeepLink(draft),
      label: "Review invite in Calendar",
      view: "calendar",
    };
  },
});
