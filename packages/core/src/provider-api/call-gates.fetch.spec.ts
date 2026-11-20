import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearProviderCallGatesForTests,
  fetchWithProviderCallGate,
  isProviderCallGateRefusal,
  ProviderAccountLookupTimeoutError,
  ProviderCallGateAdmissionTimeoutError,
  precheckGatedProviderCall,
  registerProviderCallGate,
  type ProviderCallGate,
  type ProviderCallGateRequest,
} from "./call-gates.js";
import { runWithProviderDispatchTracking } from "./provider-dispatch.js";

const URL_ = "https://www.googleapis.com/calendar/v3/freeBusy";

function transport() {
  return vi.fn(async () => new Response("{}", { status: 200 }));
}

function input(
  extra: Partial<Parameters<typeof fetchWithProviderCallGate>[0]> = {},
) {
  return {
    providerId: "google_calendar",
    appId: "example-app",
    url: URL_,
    init: { method: "POST", body: '{"items":[]}' },
    connectionId: "credential-1",
    ...extra,
  };
}

function gate(overrides: Partial<ProviderCallGate> = {}) {
  const prepared: ProviderCallGateRequest[] = [];
  const g: ProviderCallGate = {
    id: "example-gate",
    matches: ({ providerId }) => providerId === "google_calendar",
    prepare: (request) => {
      prepared.push(request);
      return async () => undefined;
    },
    ...overrides,
  };
  registerProviderCallGate(g);
  return { gate: g, prepared };
}

afterEach(() => clearProviderCallGatesForTests());

describe("fetchWithProviderCallGate", () => {
  it("is a plain transport call when no gate owns the request", async () => {
    registerProviderCallGate({
      id: "other",
      matches: ({ providerId }) => providerId === "gmail",
      prepare: () => async () => {
        throw new Error("must not run");
      },
    });
    const send = transport();
    const resolveAccountId = vi.fn(async () => "ada@example.com");
    const init = { method: "POST", body: "x" };

    const response = await fetchWithProviderCallGate(
      input({ init, resolveAccountId }),
      send,
    );

    expect(response.status).toBe(200);
    expect(send).toHaveBeenCalledWith(URL_, init);
    expect(resolveAccountId).not.toHaveBeenCalled();
  });

  it("hands the gate the account, connection, app, method and body", async () => {
    const { prepared } = gate();
    const send = transport();

    await fetchWithProviderCallGate(
      input({ resolveAccountId: async () => " Ada@example.com " }),
      send,
    );

    expect(prepared).toHaveLength(1);
    expect(prepared[0]).toMatchObject({
      providerId: "google_calendar",
      appId: "example-app",
      url: URL_,
      method: "POST",
      body: '{"items":[]}',
      accountId: "Ada@example.com",
      connectionId: "credential-1",
    });
    expect(prepared[0]).not.toHaveProperty("accountIdError");
    expect(send).toHaveBeenCalledOnce();
  });

  it("keeps an unreadable account apart from an absent one", async () => {
    const { prepared } = gate();
    const failure = new Error("identity store down");

    await fetchWithProviderCallGate(
      input({
        resolveAccountId: async () => {
          throw failure;
        },
      }),
      transport(),
    );
    await fetchWithProviderCallGate(
      input({ resolveAccountId: async () => null }),
      transport(),
    );

    expect(prepared[0]?.accountId).toBeUndefined();
    expect(prepared[0]?.accountIdError).toBe(failure);
    expect(prepared[1]?.accountId).toBeUndefined();
    expect(prepared[1]).not.toHaveProperty("accountIdError");
  });

  it("bounds a hanging account lookup by the admission deadline", async () => {
    vi.useFakeTimers();
    try {
      const { prepared } = gate();
      const send = transport();

      const pending = fetchWithProviderCallGate(
        input({ resolveAccountId: () => new Promise<never>(() => {}) }),
        send,
      );
      await vi.advanceTimersByTimeAsync(2_000);
      const response = await pending;

      expect(response.status).toBe(200);
      expect(prepared).toHaveLength(1);
      expect(prepared[0]?.accountId).toBeUndefined();
      expect(prepared[0]?.accountIdError).toBeInstanceOf(
        ProviderAccountLookupTimeoutError,
      );
      expect(prepared[0]?.deadline).toBe(Date.now());
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["precheck", { precheck: () => new Promise<void>(() => {}) }],
    ["admission", { prepare: () => () => new Promise<never>(() => {}) }],
    [
      "attempt recheck",
      {
        admission: "attempt" as const,
        recheck: () => new Promise<void>(() => {}),
      },
    ],
  ])(
    "refuses a %s that outlasts the admission deadline without sending",
    async (_label, overrides) => {
      vi.useFakeTimers();
      try {
        gate(overrides);
        const send = transport();
        const pending = fetchWithProviderCallGate(input(), send).catch(
          (caught: unknown) => caught,
        );
        await vi.advanceTimersByTimeAsync(2_000);
        const error = await pending;
        expect(error).toBeInstanceOf(ProviderCallGateAdmissionTimeoutError);
        expect(isProviderCallGateRefusal(error)).toBe(true);
        expect(send).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("refuses at precheck without preparing or sending", async () => {
    const paused = new Error("paused");
    const { prepared } = gate({
      precheck: async () => {
        throw paused;
      },
    });
    const send = transport();

    const error = await fetchWithProviderCallGate(input(), send).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBe(paused);
    expect(isProviderCallGateRefusal(error)).toBe(true);
    expect(prepared).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("skips the precheck once, only for a receipt from the bounded precheck", async () => {
    const precheck = vi.fn(async () => undefined);
    const { prepared } = gate({ precheck });
    const send = transport();
    const request = input();

    const receipt = await precheckGatedProviderCall(
      request.providerId,
      request.url,
    );
    expect(precheck).toHaveBeenCalledOnce();

    await fetchWithProviderCallGate(
      { ...request, url: `${request.url}?other=1`, prechecked: receipt },
      send,
    );
    expect(precheck).toHaveBeenCalledTimes(2);

    await fetchWithProviderCallGate(
      {
        ...request,
        prechecked: { providerId: request.providerId, url: request.url },
      },
      send,
    );
    expect(precheck).toHaveBeenCalledTimes(3);

    await fetchWithProviderCallGate({ ...request, prechecked: receipt }, send);
    expect(precheck).toHaveBeenCalledTimes(3);

    await fetchWithProviderCallGate({ ...request, prechecked: receipt }, send);
    expect(precheck).toHaveBeenCalledTimes(4);
    expect(prepared).toHaveLength(4);
  });

  it("runs the precheck again for a receipt past its precheck's deadline", async () => {
    vi.useFakeTimers();
    try {
      const precheck = vi.fn(async () => undefined);
      gate({ precheck });
      const send = transport();
      const request = input();

      const fresh = await precheckGatedProviderCall(
        request.providerId,
        request.url,
      );
      await vi.advanceTimersByTimeAsync(2_000);
      await fetchWithProviderCallGate({ ...request, prechecked: fresh }, send);
      expect(precheck).toHaveBeenCalledOnce();

      const stale = await precheckGatedProviderCall(
        request.providerId,
        request.url,
      );
      await vi.advanceTimersByTimeAsync(2_001);
      await fetchWithProviderCallGate({ ...request, prechecked: stale }, send);
      expect(precheck).toHaveBeenCalledTimes(3);
      expect(send).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a caller-run precheck that outlasts the admission deadline", async () => {
    vi.useFakeTimers();
    try {
      gate({ precheck: () => new Promise<void>(() => {}) });
      const request = input();
      const pending = precheckGatedProviderCall(
        request.providerId,
        request.url,
      ).catch((caught: unknown) => caught);
      await vi.advanceTimersByTimeAsync(2_000);
      const error = await pending;
      expect(error).toBeInstanceOf(ProviderCallGateAdmissionTimeoutError);
      expect(isProviderCallGateRefusal(error)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers a refusal the gate turns into a response without sending", async () => {
    gate({
      prepare: () => async () => {
        throw new Error("budget exhausted");
      },
      refusalResponse: () => ({
        status: 429,
        statusText: "Budget exhausted",
        headers: { "retry-after": "7" },
        json: { error: "budget" },
      }),
    });
    const send = transport();

    const response = await fetchWithProviderCallGate(input(), send);

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("7");
    expect(await response.json()).toEqual({ error: "budget" });
    expect(isProviderCallGateRefusal(response)).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses at the final check right before sending", async () => {
    const late = new Error("paused while queued");
    gate({
      prepare: () => async () => () => {
        throw late;
      },
    });
    const send = transport();

    const error = await fetchWithProviderCallGate(input(), send).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBe(late);
    expect(isProviderCallGateRefusal(error)).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it("runs an attempt gate's recheck and never maps its refusal to a response", async () => {
    const recheck = vi.fn(async () => {
      throw new Error("paused");
    });
    const refusalResponse = vi.fn(() => ({ status: 429, statusText: "x" }));
    gate({ admission: "attempt", recheck, refusalResponse });
    const send = transport();

    await expect(fetchWithProviderCallGate(input(), send)).rejects.toThrow(
      "paused",
    );
    expect(recheck).toHaveBeenCalledOnce();
    expect(refusalResponse).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("claims a request by URL when the gate does not know the provider id", async () => {
    const { prepared } = gate({
      matches: ({ url }) =>
        url !== undefined && new URL(url).hostname === "www.googleapis.com",
    });

    await fetchWithProviderCallGate(
      input({ providerId: "custom" }),
      transport(),
    );

    expect(prepared).toHaveLength(1);
  });
});

it.each([false, true])(
  "tracks actual mutations after read-only POSTs with registered gate=%s",
  async (registered) => {
    if (registered) gate();
    const tracking = { writes: 0 };
    const send = transport();
    await runWithProviderDispatchTracking(tracking, async () => {
      await fetchWithProviderCallGate(input(), send);
      expect(tracking.writes).toBe(0);
      await fetchWithProviderCallGate(
        input({
          url: "https://www.googleapis.com/calendar/v3/calendars/primary/events",
        }),
        send,
      );
      expect(tracking.writes).toBe(1);
    });
    expect(send).toHaveBeenCalledTimes(2);
  },
);
