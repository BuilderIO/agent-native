import { describe, expect, it } from "vitest";

import type { ActionEntry } from "../agent/production-agent.js";
import { MCP_APPROVAL_MESSAGES } from "../localization/mcp-approval-messages.js";
import {
  describeApprovalTime,
  mcpApprovalPromptText,
  summarizeMcpApproval,
} from "./approval-summary.js";
import {
  formatApprovalTime,
  readApprovalTime,
  readWallTime,
  zoneOffsetMinutes,
} from "./approval-time.js";

const en = MCP_APPROVAL_MESSAGES["en-US"];
const labels = { yes: en.yes, no: en.no };

function entry(overrides: Partial<ActionEntry> = {}): ActionEntry {
  return {
    tool: {
      description: "Create an event",
      parameters: {
        type: "object",
        properties: { title: { type: "string", title: "Event title" } },
      },
    },
    run: async () => "ok",
    ...overrides,
  } as ActionEntry;
}

// 2026-10-22 21:00 UTC: 2:00 PM in Los Angeles (PDT), 5:00 PM in New York (EDT).
const EVENT_AT = Date.UTC(2026, 9, 22, 21, 0, 0);

describe("approval times", () => {
  it("reads an instant from an offset, and keeps a named zone as its label", () => {
    expect(readApprovalTime("2026-10-22T14:00:00-07:00", undefined)).toEqual({
      at: EVENT_AT,
      zone: "-07:00",
    });
    expect(readApprovalTime("2026-10-22T21:00:00Z", undefined)).toEqual({
      at: EVENT_AT,
      zone: "UTC",
    });
    expect(
      readApprovalTime("2026-10-22T14:00:00-07:00", "America/Los_Angeles"),
    ).toEqual({ at: EVENT_AT, zone: "America/Los_Angeles" });
  });

  it("reads a wall time in the zone the call names beside it", () => {
    expect(
      readApprovalTime("2026-10-22T14:00:00", "America/Los_Angeles"),
    ).toEqual({ at: EVENT_AT, zone: "America/Los_Angeles" });
    // Either side of the US fall-back change on 2026-11-01.
    expect(
      readApprovalTime("2026-11-01T00:30:00", "America/New_York")?.at,
    ).toBe(Date.UTC(2026, 10, 1, 4, 30));
    expect(
      readApprovalTime("2026-11-01T03:00:00", "America/New_York")?.at,
    ).toBe(Date.UTC(2026, 10, 1, 8, 0));
  });

  it("leaves a wall time with no zone, and anything that isn't a date-time, unconverted", () => {
    expect(readApprovalTime("2026-10-22T14:00:00", undefined)).toBeUndefined();
    expect(readApprovalTime("2026-10-22", "UTC")).toBeUndefined();
    expect(readApprovalTime("tomorrow at 2", "UTC")).toBeUndefined();
    expect(readWallTime("2026-10-22T14:00:00")).toBe(
      Date.UTC(2026, 9, 22, 14, 0),
    );
    expect(readWallTime("2026-10-22T14:00:00Z")).toBeUndefined();
  });

  it("names the zone it formats in", () => {
    expect(zoneOffsetMinutes(EVENT_AT, "America/New_York")).toBe(-240);
    expect(zoneOffsetMinutes(EVENT_AT, "-07:00")).toBe(-420);
    expect(
      formatApprovalTime(EVENT_AT, "America/New_York", "en-US", "time"),
    ).toBe("5:00 PM EDT");
    expect(formatApprovalTime(EVENT_AT, "-07:00", "en-US", "time")).toBe(
      "2:00 PM UTC-07:00",
    );
  });

  it("adds the call's own time only when its zone is a different offset", () => {
    const time = { at: EVENT_AT, zone: "America/Los_Angeles" };
    expect(
      describeApprovalTime(time, {
        readerZone: "America/New_York",
        locale: "en-US",
        messages: en,
      }),
    ).toBe("Thu, Oct 22, 5:00 PM EDT (Thu, Oct 22, 2:00 PM PDT as requested)");
    expect(
      describeApprovalTime(time, {
        readerZone: "America/Los_Angeles",
        locale: "en-US",
        messages: en,
      }),
    ).toBe("Thu, Oct 22, 2:00 PM PDT");
    expect(
      describeApprovalTime(time, {
        readerZone: undefined,
        locale: "en-US",
        messages: en,
      }),
    ).toBe("Thu, Oct 22, 2:00 PM PDT");
  });
});

describe("summarizeMcpApproval", () => {
  it("builds the summary from stored arguments and the action's own definition", () => {
    const summary = summarizeMcpApproval({
      entry: entry(),
      actionName: "create-event",
      argumentsJson: JSON.stringify({
        title: "Design review",
        start: "2026-10-22T14:00:00",
        startTimeZone: "America/Los_Angeles",
        attendees: [{ email: "dana@example.com", displayName: "Dana" }],
        accountEmail: "me@example.com",
        sendUpdates: "all",
        allDay: false,
      }),
      labels,
    });
    expect(summary.title).toBe("Create event");
    expect(summary.recipients).toEqual(["dana@example.com"]);
    expect(summary.arguments).toBe("stored");
    expect(summary.fields).toEqual([
      { label: "Event title", value: "Design review" },
      {
        label: "Start",
        value: "2026-10-22T14:00:00",
        time: { at: EVENT_AT, zone: "America/Los_Angeles" },
      },
      { label: "Start time zone", value: "America/Los_Angeles" },
      { label: "Attendees", value: "dana@example.com" },
      { label: "Account email", value: "me@example.com" },
      { label: "Send updates", value: "all" },
      { label: "All day", value: "No" },
    ]);
  });

  it("marks a wall time with no zone, and says when the action reads it in the calendar's zone", () => {
    const args = JSON.stringify({ start: "2026-10-22T14:00:00" });
    const wall = { at: Date.UTC(2026, 9, 22, 14, 0) };
    expect(
      summarizeMcpApproval({
        entry: entry(),
        actionName: "create-event",
        argumentsJson: args,
        labels,
      }).fields[0],
    ).toEqual({
      label: "Start",
      value: "2026-10-22T14:00:00",
      wallTime: { ...wall, zone: "none" },
    });
    expect(
      summarizeMcpApproval({
        entry: entry({ zonelessTimes: "calendar" }),
        actionName: "create-event",
        argumentsJson: args,
        labels,
      }).fields[0],
    ).toEqual({
      label: "Start",
      value: "2026-10-22T14:00:00",
      wallTime: { ...wall, zone: "calendar" },
    });
  });

  it("says when arguments weren't stored or can't be read, rather than showing none", () => {
    for (const [argumentsJson, state] of [
      [null, "not-stored"],
      ["{not json", "unreadable"],
    ] as const) {
      expect(
        summarizeMcpApproval({
          entry: undefined,
          actionName: "send-email",
          argumentsJson,
          labels,
        }),
      ).toEqual({
        title: "Send email",
        recipients: [],
        fields: [],
        details: undefined,
        arguments: state,
      });
    }
  });
});

describe("mcpApprovalPromptText", () => {
  const summary = summarizeMcpApproval({
    entry: entry({ zonelessTimes: "calendar" }),
    actionName: "create-event",
    argumentsJson: JSON.stringify({
      title: "Design review",
      start: "2026-10-22T14:00:00-07:00",
      end: "2026-10-22T14:30:00",
      attendees: "dana@example.com",
    }),
    labels,
  });

  it("gives an in-client form the same summary the review page shows, in the reader's zone", () => {
    expect(
      mcpApprovalPromptText({
        summary,
        priorRun: { at: EVENT_AT - 5 * 60_000, status: "completed" },
        messages: en,
        locale: "en-US",
        readerZone: "America/New_York",
        mode: "form",
      }),
    ).toBe(
      [
        "Create event needs your approval before it runs. Check what it will do, then choose Approve or Deny.",
        "This exact request already ran at 4:55 PM EDT. Approving runs it again.",
        "Reaches: dana@example.com",
        "Event title: Design review",
        "Start: Thu, Oct 22, 5:00 PM EDT (Thu, Oct 22, 2:00 PM UTC-07:00 as requested)",
        "End: Thu, Oct 22, 2:30 PM (in the calendar's time zone)",
        "Attendees: dana@example.com",
      ].join("\n"),
    );
  });

  it("shows a prior run in the call's own zone when the reader's zone isn't known", () => {
    expect(
      mcpApprovalPromptText({
        summary,
        priorRun: { at: EVENT_AT - 5 * 60_000, status: "unknown" },
        messages: en,
        locale: "en-US",
        readerZone: undefined,
        mode: "form",
      }).split("\n")[1],
    ).toBe(
      "This exact request started at 1:55 PM UTC-07:00 and may have finished. Approving runs it again.",
    );
  });

  it("keeps a URL prompt to the request and any prior run, since the page shows the rest", () => {
    expect(
      mcpApprovalPromptText({
        summary,
        priorRun: undefined,
        messages: en,
        locale: "en-US",
        readerZone: undefined,
        mode: "url",
      }),
    ).toBe(
      "Create event needs your approval before it runs. Open the review page, check what it will do, then choose Approve or Deny.",
    );
  });
});
