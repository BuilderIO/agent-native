import { afterEach, describe, expect, it, vi } from "vitest";

import { createGoogleCalendarProvider } from "./google-calendar.js";
import { createOffice365Provider } from "./office365.js";

const START = new Date("2030-01-07T00:00:00.000Z");
const END = new Date("2030-01-08T00:00:00.000Z");

function respondWith(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
  );
}

const providerConfig = {
  clientId: "client-example",
  clientSecret: "secret-example",
  getAccessToken: async () => "token-example",
};

function googleBusy(calendarExternalIds: string[]) {
  return createGoogleCalendarProvider(providerConfig).getBusy({
    credentialId: "credential-example",
    calendarExternalIds,
    start: START,
    end: END,
  });
}

function outlookBusy(calendarExternalIds: string[]) {
  return createOffice365Provider(providerConfig).getBusy({
    credentialId: "credential-example",
    calendarExternalIds,
    start: START,
    end: END,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Google Calendar getBusy", () => {
  it("returns busy intervals for every requested calendar", async () => {
    respondWith({
      calendars: {
        "host@example.com": {
          busy: [
            { start: "2030-01-07T10:00:00Z", end: "2030-01-07T11:00:00Z" },
          ],
        },
      },
    });

    await expect(googleBusy(["host@example.com"])).resolves.toEqual([
      {
        start: "2030-01-07T10:00:00Z",
        end: "2030-01-07T11:00:00Z",
        source: "host@example.com",
      },
    ]);
  });

  it("throws when free/busy reports an error for a calendar", async () => {
    respondWith({
      calendars: {
        "host@example.com": {
          busy: [],
          errors: [{ domain: "global", reason: "notFound" }],
        },
      },
    });

    await expect(googleBusy(["host@example.com"])).rejects.toThrow(
      "Google Calendar free/busy failed for host@example.com: notFound",
    );
  });

  it("throws when a requested calendar is missing from the response", async () => {
    respondWith({ calendars: {} });

    await expect(googleBusy(["host@example.com"])).rejects.toThrow(
      "missing from response",
    );
  });
});

describe("Office 365 getBusy", () => {
  it("returns non-free schedule items for every requested calendar", async () => {
    respondWith({
      value: [
        {
          scheduleId: "host@example.com",
          scheduleItems: [
            {
              start: { dateTime: "2030-01-07T10:00:00" },
              end: { dateTime: "2030-01-07T11:00:00" },
              status: "busy",
            },
            {
              start: { dateTime: "2030-01-07T12:00:00" },
              end: { dateTime: "2030-01-07T13:00:00" },
              status: "free",
            },
          ],
        },
      ],
    });

    await expect(outlookBusy(["host@example.com"])).resolves.toEqual([
      {
        start: "2030-01-07T10:00:00Z",
        end: "2030-01-07T11:00:00Z",
        source: "host@example.com",
      },
    ]);
  });

  it("throws when getSchedule reports an error for a calendar", async () => {
    respondWith({
      value: [
        {
          scheduleId: "host@example.com",
          error: { responseCode: "ErrorMailboxNotFound" },
        },
      ],
    });

    await expect(outlookBusy(["host@example.com"])).rejects.toThrow(
      "Graph getSchedule failed for host@example.com: ErrorMailboxNotFound",
    );
  });
});
