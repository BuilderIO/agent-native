import {
  isProviderCallGateRefusal,
  ProviderCallGateAdmissionTimeoutError,
  registerProviderCallGate,
  type ProviderCallGate,
  type ProviderCallGateRequest,
} from "@agent-native/core/provider-api/call-gates";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CalendarLookupRateLimitedError } from "./errors.js";
import {
  createGoogleCalendarProvider,
  type GoogleCalendarProviderConfig,
} from "./google-calendar.js";

const START = new Date("2030-01-07T00:00:00.000Z");
const END = new Date("2030-01-08T00:00:00.000Z");

const removers: (() => void)[] = [];

function registerGate(overrides: Partial<ProviderCallGate> = {}) {
  const prepared: ProviderCallGateRequest[] = [];
  removers.push(
    registerProviderCallGate({
      id: "example-calendar-gate",
      matches: ({ providerId }) => providerId === "google_calendar",
      prepare: (request) => {
        prepared.push(request);
        return async () => undefined;
      },
      ...overrides,
    }),
  );
  return prepared;
}

function stubFetch() {
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ calendars: { "host@example.com": { busy: [] } } }),
        { status: 200 },
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function busy(extra: Partial<GoogleCalendarProviderConfig> = {}) {
  return createGoogleCalendarProvider({
    clientId: "client-example",
    clientSecret: "secret-example",
    getAccessToken: async () => "token-example",
    ...extra,
  }).getBusy({
    credentialId: "credential-example",
    calendarExternalIds: ["host@example.com"],
    start: START,
    end: END,
  });
}

afterEach(() => {
  for (const remove of removers.splice(0)) remove();
  vi.unstubAllGlobals();
});

describe("Google Calendar provider call gates", () => {
  it("sends the request unchanged when no gate is registered", async () => {
    const fetchMock = stubFetch();

    await expect(busy()).resolves.toEqual([]);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://www.googleapis.com/calendar/v3/freeBusy");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer token-example",
    );
  });

  it("hands the gate the credential and its account identity", async () => {
    stubFetch();
    const prepared = registerGate();

    await busy({ getAccountIdentity: async () => "host@example.com" });

    expect(prepared).toHaveLength(1);
    expect(prepared[0]).toMatchObject({
      providerId: "google_calendar",
      appId: "scheduling",
      method: "POST",
      accountId: "host@example.com",
      connectionId: "credential-example",
    });
  });

  it("runs the gate precheck once per request", async () => {
    stubFetch();
    const precheck = vi.fn(async () => undefined);
    registerGate({ precheck });

    await busy();

    expect(precheck).toHaveBeenCalledOnce();
  });

  it("prechecks a gate that claims Calendar requests by URL before the token lookup", async () => {
    stubFetch();
    const order: string[] = [];
    removers.push(
      registerProviderCallGate({
        id: "url-calendar-gate",
        matches: ({ url }) =>
          url?.startsWith("https://www.googleapis.com/calendar/") === true,
        precheck: async () => {
          order.push("precheck");
        },
        prepare: () => async () => undefined,
      }),
    );

    await busy({
      getAccessToken: async () => {
        order.push("token");
        return "token-example";
      },
    });

    expect(order).toEqual(["precheck", "token"]);
  });

  it("names the consuming app to the gate when the consumer sets one", async () => {
    stubFetch();
    const prepared = registerGate();

    await busy({ appId: "calendar" });

    expect(prepared[0]).toMatchObject({
      providerId: "google_calendar",
      appId: "calendar",
    });
  });

  it("tells the gate when the account identity could not be read", async () => {
    stubFetch();
    const prepared = registerGate();
    const failure = new Error("identity unreadable");

    await busy({
      getAccountIdentity: async () => {
        throw failure;
      },
    });

    expect(prepared[0]?.accountId).toBeUndefined();
    expect(prepared[0]?.accountIdError).toBe(failure);
  });

  it("does not send a request the gate refuses", async () => {
    const fetchMock = stubFetch();
    registerGate({
      precheck: async () => {
        throw new Error("Google Calendar is paused");
      },
    });

    await expect(busy()).rejects.toThrow("Google Calendar is paused");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a budget refusal response as a retryable throttle", async () => {
    const fetchMock = stubFetch();
    registerGate({
      prepare: () => async () => {
        throw new Error("budget exhausted");
      },
      refusalResponse: () => ({
        status: 429,
        statusText: "Budget exhausted",
        headers: { "retry-after": "12" },
      }),
    });

    const error = await busy().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CalendarLookupRateLimitedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a paused provider before resolving the access token", async () => {
    const fetchMock = stubFetch();
    const getAccessToken = vi.fn(async () => "token-example");
    registerGate({
      precheck: async () => {
        throw new Error("Google Calendar is paused");
      },
    });

    await expect(busy({ getAccessToken })).rejects.toThrow(
      "Google Calendar is paused",
    );
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a precheck that never settles before resolving the access token", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = stubFetch();
      const getAccessToken = vi.fn(async () => "token-example");
      registerGate({ precheck: () => new Promise<void>(() => {}) });

      const pending = busy({ getAccessToken }).catch(
        (caught: unknown) => caught,
      );
      await vi.advanceTimersByTimeAsync(2_000);
      const error = await pending;

      expect(error).toBeInstanceOf(ProviderCallGateAdmissionTimeoutError);
      expect(isProviderCallGateRefusal(error)).toBe(true);
      expect(getAccessToken).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the credential valid when a gate answers with a 403 refusal", async () => {
    const fetchMock = stubFetch();
    const markInvalid = vi.fn(async () => undefined);
    registerGate({
      prepare: () => async () => {
        throw new Error("not allowed");
      },
      refusalResponse: () => ({ status: 403, statusText: "Forbidden" }),
    });

    const error = await busy({ markInvalid }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    expect(isProviderCallGateRefusal(error)).toBe(true);
    expect(markInvalid).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
