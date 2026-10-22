import { describe, expect, it } from "vitest";

import type { ActionEntry } from "../agent/production-agent.js";
import { MCP_APPROVAL_MESSAGES } from "../localization/mcp-approval-messages.js";
import { storedApprovalArguments } from "./approval-store.js";
import {
  describeApprovalTime,
  mcpApprovalPromptText,
  summarizeMcpApproval,
} from "./approval-summary.js";
import {
  formatApprovalTime,
  isTimeZone,
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

  it("reads no time from an impossible offset or date field, rather than shifting it", () => {
    expect(isTimeZone("+99:99")).toBe(false);
    expect(isTimeZone("-07:60")).toBe(false);
    expect(isTimeZone("+15:00")).toBe(false);
    expect(isTimeZone("+14:00")).toBe(true);
    expect(readApprovalTime("2026-10-22T14:00:00+99:99", undefined)).toBe(
      undefined,
    );
    expect(readApprovalTime("2026-13-40T25:99:00Z", undefined)).toBe(undefined);
    expect(readApprovalTime("2026-02-30T14:00:00Z", undefined)).toBe(undefined);
    expect(readWallTime("2026-10-22T24:00:00")).toBeUndefined();
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

  it("reads an end with no zone of its own in its start's zone, as a calendar does", () => {
    const fields = (args: Record<string, unknown>) =>
      summarizeMcpApproval({
        entry: entry({ zonelessTimes: "calendar" }),
        actionName: "create-event",
        argumentsJson: JSON.stringify(args),
        labels,
      }).fields;
    const end = Date.UTC(2026, 9, 22, 21, 30);

    expect(
      fields({
        start: "2026-10-22T14:00:00",
        end: "2026-10-22T14:30:00",
        startTimeZone: "America/Los_Angeles",
      })[1],
    ).toMatchObject({
      label: "End",
      time: { at: end, zone: "America/Los_Angeles" },
    });
    expect(
      fields({
        end: "2026-10-22T17:30:00",
        start_time_zone: "America/Los_Angeles",
        end_time_zone: "America/New_York",
      })[0],
    ).toMatchObject({ time: { at: end, zone: "America/New_York" } });
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
        cut: false,
      });
    }
  });

  it("keeps every recipient, field and value whole", () => {
    const to = Array.from({ length: 60 }, (_, i) => `guest-${i}@example.com`);
    const body = "word ".repeat(400);
    const args: Record<string, unknown> = { to, body };
    for (let i = 0; i < 20; i++) args[`option${i}`] = `value ${i}`;

    const summary = summarizeMcpApproval({
      entry: undefined,
      actionName: "send-email",
      argumentsJson: storedApprovalArguments(args),
      labels,
    });

    expect(summary.recipients).toEqual(to);
    expect(summary.fields).toHaveLength(22);
    expect(summary.fields[1]).toEqual({
      label: "Body",
      value: body,
    });
    expect(summary.cut).toBe(false);
  });

  it("marks arguments the server cut to store them", () => {
    const summarize = (args: unknown) =>
      summarizeMcpApproval({
        entry: undefined,
        actionName: "send-email",
        argumentsJson: storedApprovalArguments(args),
        labels,
      });
    const people = (count: number) =>
      Array.from({ length: count }, (_, i) => `guest-${i}@example.com`);

    expect(summarize({ to: people(150) })).toMatchObject({ cut: true });
    expect(summarize({ body: "word ".repeat(1_800) })).toMatchObject({
      cut: true,
    });
    expect(summarize({ apiKey: "sk-live-1234567890" })).toMatchObject({
      cut: false,
    });

    // Too large to store at all: only the start of its JSON is kept.
    const tooLarge = summarize({
      to: people(5),
      parts: Array.from({ length: 10 }, () => "word ".repeat(1_400)),
    });
    expect(tooLarge).toMatchObject({
      recipients: [],
      fields: [],
      arguments: "stored",
      cut: true,
    });
    expect(tooLarge.details).toContain("guest-0@example.com");
  });
});

const REVIEW_URL =
  "https://calendar.example.com/_agent-native/mcp/approvals/grant-1";

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
        reviewUrl: REVIEW_URL,
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
        reviewUrl: REVIEW_URL,
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
        reviewUrl: REVIEW_URL,
      }),
    ).toBe(
      "Create event needs your approval before it runs. Open the review page, check what it will do, then choose Approve or Deny.",
    );
  });

  describe("a form that can't show everything", () => {
    const form = (
      args: unknown,
      argumentsJson = storedApprovalArguments(args),
    ) =>
      mcpApprovalPromptText({
        summary: summarizeMcpApproval({
          entry: undefined,
          actionName: "send-email",
          argumentsJson,
          labels,
        }),
        priorRun: undefined,
        messages: en,
        locale: "en-US",
        readerZone: undefined,
        mode: "form",
        reviewUrl: REVIEW_URL,
      }).split("\n");
    const people = (count: number) =>
      Array.from({ length: count }, (_, i) => `guest-${i}@example.com`);
    const seeAll = `See all of it on the review page: ${REVIEW_URL}`;

    it("says how many recipients and fields it leaves out, and links the page that shows them", () => {
      const body = "word ".repeat(100);
      const args: Record<string, unknown> = { body, to: people(27) };
      for (let i = 0; i < 13; i++) args[`option${i}`] = "on";

      const lines = form(args);

      expect(lines[1]).toBe(`Reaches: ${people(20).join(", ")} and 7 more`);
      expect(lines[2]).toBe(`Body: ${body.slice(0, 280)}…`);
      expect(lines.filter((line) => line.startsWith("Option"))).toHaveLength(
        10,
      );
      expect(lines.slice(-3)).toEqual([
        "Fields not shown here: 3",
        "Long values are shortened here.",
        seeAll,
      ]);
    });

    it("shows a call that fits in full, with nothing more to see", () => {
      const lines = form({ to: people(3), subject: "Hi" });
      expect(lines).toEqual([
        "Send email needs your approval before it runs. Check what it will do, then choose Approve or Deny.",
        `Reaches: ${people(3).join(", ")}`,
        `To: ${people(3).join(", ")}`,
        "Subject: Hi",
      ]);
    });

    it("says when the server couldn't keep the whole call, which the page can't show either", () => {
      const cut = form({ subject: "Hi", body: "word ".repeat(1_800) });
      expect(cut).toContain(en.argumentsCut);
      expect(cut).toContain(seeAll);

      const tooLarge = form({
        parts: Array.from({ length: 10 }, () => "word ".repeat(1_400)),
      });
      expect(tooLarge.slice(1)).toEqual([en.argumentsCut]);
    });

    it("says when it has no arguments to show", () => {
      expect(form({}, null).slice(1)).toEqual([en.argumentsNotStored]);
      expect(form({}, "{not json").slice(1)).toEqual([en.argumentsUnreadable]);
    });
  });
});
