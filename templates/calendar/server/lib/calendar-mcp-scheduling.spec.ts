import { createRequire } from "node:module";

import {
  actionCallIntent,
  preparedCallNeedsApproval,
} from "@agent-native/core/action";
import { createMCPServerForRequest } from "@agent-native/core/mcp";
import { attachToolSearch } from "@agent-native/core/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireCore = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
);
const { Client } = requireCore("@modelcontextprotocol/client");
const { InMemoryTransport } = requireCore("@modelcontextprotocol/server");

const mocks = vi.hoisted(() => ({
  approval: vi.fn(),
  settings: new Map<string, unknown>(),
}));

const { approvalAuth, approvalStore, userSettings } = vi.hoisted(() => ({
  approvalAuth: () => ({
    getAuthSecret: () => "fake-test-only-mcp-approval-secret",
    findBetterAuthUserIdForEmail: async () => undefined,
  }),
  approvalStore: async (importOriginal: () => Promise<object>) => ({
    ...(await importOriginal()),
    createMcpApprovalGrant: vi.fn(),
    consumeMcpApprovalGrant: vi.fn(async () => true),
    consumeReviewedMcpApprovalGrant: vi.fn(async () => null),
    answerMcpApprovalPrompt: vi.fn(async () => true),
    findRecentMcpApprovalRun: vi.fn(async () => null),
    recordMcpApprovalRun: vi.fn(async () => undefined),
  }),
  userSettings: async (importOriginal: () => Promise<object>) => ({
    ...(await importOriginal()),
    getUserSetting: async () => null,
  }),
}));
vi.mock(
  "../../../../packages/core/dist/server/better-auth-instance.js",
  approvalAuth,
);
vi.mock(
  "../../../../packages/core/src/server/better-auth-instance.js",
  approvalAuth,
);
vi.mock("../../../../packages/core/dist/mcp/approval-store.js", approvalStore);
vi.mock("../../../../packages/core/src/mcp/approval-store.js", approvalStore);
vi.mock(
  "../../../../packages/core/dist/settings/user-settings.js",
  userSettings,
);
vi.mock(
  "../../../../packages/core/src/settings/user-settings.js",
  userSettings,
);
vi.mock("@agent-native/core/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/settings")>()),
  getUserSetting: async (email: string, key: string) =>
    mocks.settings.get(`${email}:${key}`) ?? null,
  putUserSetting: async (email: string, key: string, value: unknown) => {
    mocks.settings.set(`${email}:${key}`, value);
  },
  mutateUserSetting: async (
    email: string,
    key: string,
    updater: (current: unknown) => unknown,
  ) => {
    const next = await updater(mocks.settings.get(`${email}:${key}`) ?? null);
    mocks.settings.set(`${email}:${key}`, next);
    return next;
  },
}));
vi.mock("@agent-native/core/tracking", () => ({ track: vi.fn() }));

import addExternalCalendar from "../../actions/add-external-calendar.js";
import addOverlayPerson from "../../actions/add-overlay-person.js";
import cancelBooking from "../../actions/cancel-booking.js";
import checkAvailability from "../../actions/check-availability.js";
import connectGoogleCalendar from "../../actions/connect-google-calendar.js";
import createBookingLink from "../../actions/create-booking-link.js";
import deleteBookingLink from "../../actions/delete-booking-link.js";
import deleteEvent from "../../actions/delete-event.js";
import deleteEvents from "../../actions/delete-events.js";
import duplicateBookingLink from "../../actions/duplicate-booking-link.js";
import findATime from "../../actions/find-a-time.js";
import getAttendeeTimezones from "../../actions/get-attendee-timezones.js";
import getAvailability from "../../actions/get-availability.js";
import getEventRulesStatus from "../../actions/get-event-rules-status.js";
import getEvent from "../../actions/get-event.js";
import getHostOverlayStatus from "../../actions/get-host-overlay-status.js";
import getOverlayPeople from "../../actions/get-overlay-people.js";
import getOverlayReciprocity from "../../actions/get-overlay-reciprocity.js";
import getSettings from "../../actions/get-settings.js";
import getZoomStatus from "../../actions/get-zoom-status.js";
import listBookingLinks from "../../actions/list-booking-links.js";
import listBookings from "../../actions/list-bookings.js";
import listExternalCalendars from "../../actions/list-external-calendars.js";
import listGoogleCalendars from "../../actions/list-google-calendars.js";
import removeExternalCalendar from "../../actions/remove-external-calendar.js";
import removeOverlayPerson from "../../actions/remove-overlay-person.js";
import respondToEvent from "../../actions/respond-to-event.js";
import rsvpEvent from "../../actions/rsvp-event.js";
import searchEvents from "../../actions/search-events.js";
import searchPeople from "../../actions/search-people.js";
import sendOverlayRequest from "../../actions/send-overlay-request.js";
import setAttendeeTimezone from "../../actions/set-attendee-timezone.js";
import syncGoogleCalendar from "../../actions/sync-google-calendar.js";
import undoCalendarEventRule from "../../actions/undo-calendar-event-rule.js";
import updateAvailability from "../../actions/update-availability.js";
import updateBookingLink from "../../actions/update-booking-link.js";
import updateCalendarVisualPreferences from "../../actions/update-calendar-visual-preferences.js";
import updateEvent from "../../actions/update-event.js";
import updateEvents from "../../actions/update-events.js";
import updateExternalCalendars from "../../actions/update-external-calendars.js";
import updateOverlayPeople from "../../actions/update-overlay-people.js";
import updateOverlayPersonColor from "../../actions/update-overlay-person-color.js";
import updateSettings from "../../actions/update-settings.js";

const decided = {
  "find-a-time": findATime,
  "check-availability": checkAvailability,
  "search-events": searchEvents,
  "get-event": getEvent,
  "search-people": searchPeople,
  "list-booking-links": listBookingLinks,
  "list-bookings": listBookings,
  "create-booking-link": createBookingLink,
  "update-booking-link": updateBookingLink,
  "delete-event": deleteEvent,
  "get-attendee-timezones": getAttendeeTimezones,
  "get-availability": getAvailability,
  "get-event-rules-status": getEventRulesStatus,
  "get-host-overlay-status": getHostOverlayStatus,
  "get-overlay-people": getOverlayPeople,
  "get-overlay-reciprocity": getOverlayReciprocity,
  "list-external-calendars": listExternalCalendars,
  "list-google-calendars": listGoogleCalendars,
  "add-external-calendar": addExternalCalendar,
  "add-overlay-person": addOverlayPerson,
  "set-attendee-timezone": setAttendeeTimezone,
  "undo-calendar-event-rule": undoCalendarEventRule,
  "update-availability": updateAvailability,
  "update-external-calendars": updateExternalCalendars,
  "update-overlay-people": updateOverlayPeople,
  "cancel-booking": cancelBooking,
  "delete-events": deleteEvents,
  "delete-booking-link": deleteBookingLink,
  "duplicate-booking-link": duplicateBookingLink,
  "remove-external-calendar": removeExternalCalendar,
  "remove-overlay-person": removeOverlayPerson,
  "send-overlay-request": sendOverlayRequest,
  "update-events": updateEvents,
  "connect-google-calendar": connectGoogleCalendar,
  "get-zoom-status": getZoomStatus,
  "get-settings": getSettings,
  "update-settings": updateSettings,
  "update-calendar-visual-preferences": updateCalendarVisualPreferences,
  "update-overlay-person-color": updateOverlayPersonColor,
  "rsvp-event": rsvpEvent,
  "sync-google-calendar": syncGoogleCalendar,
};

const LISTED = [
  "check-availability",
  "create-booking-link",
  "delete-event",
  "find-a-time",
  "get-event",
  "list-booking-links",
  "list-bookings",
  "search-events",
  "search-people",
  "update-booking-link",
];
const LISTED_READS = LISTED.filter(
  (name) =>
    !["create-booking-link", "delete-event", "update-booking-link"].includes(
      name,
    ),
);
const IN_APP = [
  "connect-google-calendar",
  "get-settings",
  "get-zoom-status",
  "rsvp-event",
  "sync-google-calendar",
  "update-calendar-visual-preferences",
  "update-overlay-person-color",
  "update-settings",
];
const SEARCH_SERVED = Object.keys(decided).filter(
  (name) => !LISTED.includes(name) && !IN_APP.includes(name),
);
const OUTSIDE_APPROVAL: Array<[string, Record<string, unknown>]> = [
  ["create-booking-link", { title: "Intro", slug: "intro", duration: 30 }],
  [
    "update-booking-link",
    { id: "link-1", title: "Intro", slug: "intro", duration: 30 },
  ],
  ["delete-booking-link", { id: "link-1" }],
  [
    "duplicate-booking-link",
    { sourceId: "link-1", copies: [{ duration: 45 }] },
  ],
  ["remove-external-calendar", { id: "feed-1" }],
  ["remove-overlay-person", { email: "peer@example.com" }],
  ["send-overlay-request", { email: "peer@example.com" }],
  ["update-external-calendars", { calendars: [] }],
  ["update-overlay-people", { people: [] }],
  [
    "update-availability",
    {
      timezone: "America/New_York",
      weeklySchedule: Object.fromEntries(
        [
          "monday",
          "tuesday",
          "wednesday",
          "thursday",
          "friday",
          "saturday",
          "sunday",
        ].map((day) => [
          day,
          { enabled: true, slots: [{ start: "09:00", end: "17:00" }] },
        ]),
      ),
      bufferMinutes: 0,
      minNoticeHours: 4,
      maxAdvanceDays: 60,
      slotDurationMinutes: 30,
      bookingPageSlug: "owner",
    },
  ],
];
const ownerEmail = "owner@example.com";
const feedsKey = `${ownerEmail}:external-calendars`;
const feeds = [
  { id: "feed-1", name: "Holidays", url: "https://example.com/holidays.ics" },
  { id: "feed-2", name: "Talks", url: "https://example.com/talks.ics" },
];
const closeClients: Array<() => Promise<void>> = [];

type Action = Parameters<typeof actionCallIntent>[0] &
  Parameters<typeof preparedCallNeedsApproval>[0];

async function needsApproval(
  action: Action,
  args: Record<string, unknown>,
  caller: "mcp" | "tool",
) {
  const call = await actionCallIntent(action, args);
  if (!call.valid) throw call.error;
  return preparedCallNeedsApproval(action, call, { caller });
}

async function clientFor(oauthScopes = ["mcp:read", "mcp:write"]) {
  const actions = attachToolSearch({ ...decided } as never);
  const server = await createMCPServerForRequest(
    {
      name: "Calendar",
      description: "Calendar test server",
      appId: "calendar",
      actions,
      connectorCatalog: ["list-events"],
      externalAgents: { writes: "allowlisted" },
      askAgent: vi.fn(async () => "Unexpected delegation"),
    },
    {
      userEmail: ownerEmail,
      orgDomain: undefined,
      orgId: null,
      identityAssurance: "user",
      oauthScopes,
    },
    { origin: "http://localhost:8100", transport: "http" },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: "calendar-scheduling-test", version: "1.0.0" },
    { versionNegotiation: { mode: "auto" } },
  );
  client.registerCapabilities({ elicitation: { form: {} } });
  client.setRequestHandler("elicitation/create", mocks.approval);
  closeClients.push(async () => {
    await client.close();
    await server.close();
  });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return client;
}

function textOf(result: { content?: unknown }): string {
  return ((result.content ?? []) as Array<{ text?: string }>)
    .map((part) => part.text ?? "")
    .join("\n");
}

describe("Calendar scheduling tools for outside agents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settings.clear();
    mocks.approval.mockResolvedValue({
      action: "accept",
      content: { decision: "deny" },
    });
  });
  afterEach(async () => {
    for (const close of closeClients.splice(0)) await close();
  });

  it("decides every Calendar action the parity inventory marked", () => {
    const action = (name: string) => decided[name as keyof typeof decided];
    expect(Object.keys(decided)).toHaveLength(41);
    expect(LISTED.filter((name) => action(name).mcpTool !== true)).toEqual([]);
    expect(
      SEARCH_SERVED.filter((name) => action(name).mcpTool !== "search"),
    ).toEqual([]);
    expect(IN_APP.filter((name) => action(name).mcpTool !== false)).toEqual([]);
    expect(
      LISTED_READS.filter((name) => action(name).readOnly !== true),
    ).toEqual([]);
  });

  it.each(OUTSIDE_APPROVAL)(
    "asks outside agents, not the app's own agent, before %s",
    async (name, args) => {
      const action = decided[name as keyof typeof decided];
      expect(await needsApproval(action, args, "mcp")).toBe(true);
      expect(await needsApproval(action, args, "tool")).toBe(false);
    },
  );

  it("asks outside agents before any event delete and keeps the guest-notice rule in the app", async () => {
    const quiet = { id: "google-event-1", sendUpdates: "none" };
    expect(await needsApproval(deleteEvent, quiet, "mcp")).toBe(true);
    expect(await needsApproval(deleteEvent, quiet, "tool")).toBe(false);
    expect(
      await needsApproval(
        deleteEvent,
        { id: "google-event-1", sendUpdates: "all" },
        "tool",
      ),
    ).toBe(true);
  });

  it("asks outside agents before cancelling an event through update-event", async () => {
    const cancel = {
      id: "google-event-1",
      status: "cancelled",
      sendUpdates: "none",
    };
    expect(await needsApproval(updateEvent, cancel, "mcp")).toBe(true);
    expect(await needsApproval(updateEvent, cancel, "tool")).toBe(false);
    expect(
      await needsApproval(
        updateEvent,
        { id: "google-event-1", title: "Renamed", sendUpdates: "none" },
        "mcp",
      ),
    ).toBe(false);
  });

  it("asks outside agents before an RSVP that emails attendees", async () => {
    const rsvp = { id: "google-event-1", status: "declined" };
    expect(
      await needsApproval(
        respondToEvent,
        { ...rsvp, sendUpdates: "all" },
        "mcp",
      ),
    ).toBe(true);
    expect(
      await needsApproval(
        respondToEvent,
        { ...rsvp, sendUpdates: "none", note: "Conflict" },
        "mcp",
      ),
    ).toBe(false);
    expect(await needsApproval(respondToEvent, rsvp, "mcp")).toBe(false);
  });

  it("previews bulk event changes without approval and asks outside agents to apply them", async () => {
    const shift = { ids: ["google-event-1"], shiftMinutes: 30 };
    expect(
      await needsApproval(updateEvents, { ...shift, dryRun: true }, "mcp"),
    ).toBe(false);
    expect(
      await needsApproval(updateEvents, { ...shift, dryRun: false }, "mcp"),
    ).toBe(true);
    expect(
      await needsApproval(updateEvents, { ...shift, dryRun: false }, "tool"),
    ).toBe(false);
  });

  it("lists the scheduling tools and leaves the rest to tool-search", async () => {
    const client = await clientFor();
    const names: string[] = (await client.listTools()).tools.map(
      (tool: { name: string }) => tool.name,
    );
    expect(names).toEqual(
      expect.arrayContaining([...LISTED, "tool-search", "call-tool"]),
    );
    expect(
      names.filter((name) => [...SEARCH_SERVED, ...IN_APP].includes(name)),
    ).toEqual([]);
  });

  it("lists only the scheduling reads for a read-only connection", async () => {
    const client = await clientFor(["mcp:read"]);
    const names: string[] = (await client.listTools()).tools.map(
      (tool: { name: string }) => tool.name,
    );
    expect(names).toEqual(expect.arrayContaining(LISTED_READS));
    expect(
      names.filter((name) =>
        ["create-booking-link", "delete-event", "update-booking-link"].includes(
          name,
        ),
      ),
    ).toEqual([]);
  });

  it("finds an unlisted tool, marks it for call-tool, and hides in-app actions", async () => {
    const client = await clientFor();
    const result = await client.callTool({
      name: "tool-search",
      arguments: {
        names: ["list-external-calendars", "get-settings", "rsvp-event"],
      },
    });
    expect(result.isError).not.toBe(true);
    const { results } = JSON.parse(textOf(result)) as {
      results: Array<{ name: string; callWith?: string }>;
    };
    const byName = new Map(results.map((entry) => [entry.name, entry]));
    expect(byName.get("list-external-calendars")?.callWith).toBe("call-tool");
    expect(byName.has("get-settings")).toBe(false);
    expect(byName.has("rsvp-event")).toBe(false);
  });

  it("runs an unlisted read through call-tool as the connected user", async () => {
    mocks.settings.set(feedsKey, feeds);
    const client = await clientFor();
    const result = await client.callTool({
      name: "call-tool",
      arguments: { name: "list-external-calendars", arguments: {} },
    });
    expect(textOf(result)).toContain("Holidays");
    expect(result.isError).not.toBe(true);
    expect(mocks.approval).not.toHaveBeenCalled();
  });

  it("runs unlisted reads but no writes through call-tool for a read-only connection", async () => {
    mocks.settings.set(feedsKey, feeds);
    const client = await clientFor(["mcp:read"]);
    const read = await client.callTool({
      name: "call-tool",
      arguments: { name: "list-external-calendars", arguments: {} },
    });
    expect(textOf(read)).toContain("Holidays");
    expect(read.isError).not.toBe(true);

    const write = await client.callTool({
      name: "call-tool",
      arguments: {
        name: "remove-external-calendar",
        arguments: { id: "feed-1" },
      },
    });
    expect(write.isError).toBe(true);
    expect(mocks.approval).not.toHaveBeenCalled();
    expect(mocks.settings.get(feedsKey)).toEqual(feeds);
  });

  it("refuses an in-app action through call-tool", async () => {
    const client = await clientFor();
    const result = await client.callTool({
      name: "call-tool",
      arguments: { name: "update-settings", arguments: {} },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("isn't one");
  });

  it("removes a calendar feed through call-tool only after the user approves", async () => {
    mocks.settings.set(feedsKey, feeds);
    const client = await clientFor();
    const call = {
      name: "call-tool",
      arguments: {
        name: "remove-external-calendar",
        arguments: { id: "feed-1" },
      },
    };

    const denied = await client.callTool(call);
    expect(denied.isError).toBe(true);
    expect(textOf(denied)).toContain("was not approved");
    expect(mocks.settings.get(feedsKey)).toEqual(feeds);

    mocks.approval.mockResolvedValue({
      action: "accept",
      content: { decision: "approve" },
    });
    const approved = await client.callTool(call);
    expect(approved.isError).not.toBe(true);
    expect(mocks.approval).toHaveBeenCalledTimes(2);
    expect(mocks.settings.get(feedsKey)).toEqual([feeds[1]]);
  });
});
