import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CalendarCredentialInvalidError,
  CalendarLookupRateLimitedError,
} from "./errors.js";
import { createGoogleCalendarProvider } from "./google-calendar.js";
import { createOffice365Provider } from "./office365.js";

const START = new Date("2030-01-07T00:00:00.000Z");
const END = new Date("2030-01-08T00:00:00.000Z");
const OUTLOOK_CALENDAR_ID = "AAMkAGI2TGuLAAA=";

function respondWith(...bodies: unknown[]) {
  const fetchMock = vi.fn(async () => {
    const body = bodies.length > 1 ? bodies.shift() : bodies[0];
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function respondWithStatus(
  status: number,
  body = "denied",
  headers: Record<string, string> = {},
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status, headers })),
  );
}

function googleError(code: number, reason: string) {
  return JSON.stringify({
    error: {
      code,
      message: "Error",
      errors: [{ domain: "usageLimits", reason, message: "Error" }],
    },
  });
}

function providerConfig() {
  return {
    clientId: "client-example",
    clientSecret: "secret-example",
    getAccessToken: async () => "token-example",
    markInvalid: vi.fn(async () => {}),
  };
}

function googleBusy(calendarExternalIds: string[], config = providerConfig()) {
  return createGoogleCalendarProvider(config).getBusy({
    credentialId: "credential-example",
    calendarExternalIds,
    start: START,
    end: END,
  });
}

function outlookBusy(calendarExternalIds: string[], config = providerConfig()) {
  return createOffice365Provider(config).getBusy({
    credentialId: "credential-example",
    calendarExternalIds,
    start: START,
    end: END,
  });
}

function requestedUrl(fetchMock: ReturnType<typeof vi.fn>, call: number) {
  return new URL(String(fetchMock.mock.calls[call]?.[0]));
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

  it("throws a credential-invalid error and marks the credential on 401", async () => {
    respondWithStatus(401);
    const config = providerConfig();

    await expect(
      googleBusy(["host@example.com"], config),
    ).rejects.toBeInstanceOf(CalendarCredentialInvalidError);
    expect(config.markInvalid).toHaveBeenCalledWith("credential-example");
  });
});

describe("Google Calendar getBusy throttling", () => {
  it.each(["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"])(
    "treats a 403 %s as a retryable throttle without invalidating the credential",
    async (reason) => {
      respondWithStatus(403, googleError(403, reason), {
        "retry-after": "30",
      });
      const config = providerConfig();

      const error = await googleBusy(["host@example.com"], config).then(
        () => null,
        (thrown: unknown) => thrown,
      );

      expect(error).toBeInstanceOf(CalendarLookupRateLimitedError);
      expect(error).not.toBeInstanceOf(CalendarCredentialInvalidError);
      expect((error as CalendarLookupRateLimitedError).retryAfterSeconds).toBe(
        30,
      );
      expect(config.markInvalid).not.toHaveBeenCalled();
    },
  );

  it("treats a 429 as a retryable throttle", async () => {
    respondWithStatus(429, googleError(429, "rateLimitExceeded"));
    const config = providerConfig();

    await expect(
      googleBusy(["host@example.com"], config),
    ).rejects.toBeInstanceOf(CalendarLookupRateLimitedError);
    expect(config.markInvalid).not.toHaveBeenCalled();
  });

  it("still invalidates the credential on a 403 that is not a throttle", async () => {
    respondWithStatus(403, googleError(403, "insufficientPermissions"));
    const config = providerConfig();

    await expect(
      googleBusy(["host@example.com"], config),
    ).rejects.toBeInstanceOf(CalendarCredentialInvalidError);
    expect(config.markInvalid).toHaveBeenCalledWith("credential-example");
  });
});

describe("Office 365 getBusy concurrency", () => {
  function calendarViewFor(_url: string) {
    return {
      value: [
        {
          start: { dateTime: "2030-01-07T10:00:00" },
          end: { dateTime: "2030-01-07T11:00:00" },
          showAs: "busy",
        },
      ],
    };
  }

  it("reads several calendars at most four at a time and keeps their order", async () => {
    const ids = Array.from({ length: 6 }, (_, index) => `calendar-${index}`);
    let active = 0;
    let maximumActive = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return new Response(JSON.stringify(calendarViewFor(url)), {
          status: 200,
        });
      }),
    );

    const busy = await outlookBusy(ids);

    expect(maximumActive).toBeGreaterThan(1);
    expect(maximumActive).toBeLessThanOrEqual(4);
    expect(busy.map((interval) => interval.source)).toEqual(ids);
  });

  it("fails the whole lookup when any one calendar can't be read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("calendar-broken")
          ? new Response("boom", { status: 500 })
          : new Response(JSON.stringify(calendarViewFor(url)), {
              status: 200,
            }),
      ),
    );

    await expect(
      outlookBusy(["calendar-ok-1", "calendar-broken", "calendar-ok-2"]),
    ).rejects.toThrow("Graph 500");
  });

  it("treats a Graph 429 as a retryable throttle with its Retry-After", async () => {
    respondWithStatus(429, "throttled", { "retry-after": "12" });
    const config = providerConfig();

    const error = await outlookBusy([OUTLOOK_CALENDAR_ID], config).then(
      () => null,
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(CalendarLookupRateLimitedError);
    expect((error as CalendarLookupRateLimitedError).retryAfterSeconds).toBe(
      12,
    );
    expect(config.markInvalid).not.toHaveBeenCalled();
  });
});

describe("Office 365 getBusy", () => {
  it("reads each selected calendar's calendarView by its Graph calendar id", async () => {
    const fetchMock = respondWith({
      value: [
        {
          start: { dateTime: "2030-01-07T10:00:00.0000000" },
          end: { dateTime: "2030-01-07T11:00:00.0000000" },
          showAs: "busy",
          isCancelled: false,
        },
        {
          start: { dateTime: "2030-01-07T12:00:00.0000000" },
          end: { dateTime: "2030-01-07T13:00:00.0000000" },
          showAs: "free",
          isCancelled: false,
        },
        {
          start: { dateTime: "2030-01-07T14:00:00.0000000" },
          end: { dateTime: "2030-01-07T15:00:00.0000000" },
          showAs: "busy",
          isCancelled: true,
        },
      ],
    });

    await expect(outlookBusy([OUTLOOK_CALENDAR_ID])).resolves.toEqual([
      {
        start: "2030-01-07T10:00:00.0000000Z",
        end: "2030-01-07T11:00:00.0000000Z",
        source: OUTLOOK_CALENDAR_ID,
      },
    ]);
    const url = requestedUrl(fetchMock, 0);
    expect(url.origin).toBe("https://graph.microsoft.com");
    expect(url.pathname).toBe(
      `/v1.0/me/calendars/${encodeURIComponent(OUTLOOK_CALENDAR_ID)}/calendarView`,
    );
    expect(url.searchParams.get("startDateTime")).toBe(START.toISOString());
    expect(url.searchParams.get("endDateTime")).toBe(END.toISOString());
  });

  it("follows calendarView paging links", async () => {
    const nextLink =
      "https://graph.microsoft.com/v1.0/me/calendars/next-page?$skip=250";
    const fetchMock = respondWith(
      {
        value: [
          {
            start: { dateTime: "2030-01-07T10:00:00" },
            end: { dateTime: "2030-01-07T11:00:00" },
            showAs: "busy",
          },
        ],
        "@odata.nextLink": nextLink,
      },
      {
        value: [
          {
            start: { dateTime: "2030-01-07T15:00:00" },
            end: { dateTime: "2030-01-07T16:00:00" },
            showAs: "tentative",
          },
        ],
      },
    );

    const busy = await outlookBusy([OUTLOOK_CALENDAR_ID]);

    expect(busy.map((interval) => interval.start)).toEqual([
      "2030-01-07T10:00:00Z",
      "2030-01-07T15:00:00Z",
    ]);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(nextLink);
  });

  it("refuses a paging link that leaves Graph", async () => {
    respondWith({
      value: [],
      "@odata.nextLink": "https://example.com/steal-token",
    });

    await expect(outlookBusy([OUTLOOK_CALENDAR_ID])).rejects.toThrow(
      "Refusing to call a non-Graph URL",
    );
  });

  it("throws when calendarView returns no events list", async () => {
    respondWith({ error: { code: "ErrorItemNotFound" } });

    await expect(outlookBusy([OUTLOOK_CALENDAR_ID])).rejects.toThrow(
      `Graph calendarView returned no events list for ${OUTLOOK_CALENDAR_ID}`,
    );
  });

  it("throws a credential-invalid error and marks the credential on 403", async () => {
    respondWithStatus(403);
    const config = providerConfig();

    await expect(
      outlookBusy([OUTLOOK_CALENDAR_ID], config),
    ).rejects.toBeInstanceOf(CalendarCredentialInvalidError);
    expect(config.markInvalid).toHaveBeenCalledWith("credential-example");
  });
});
