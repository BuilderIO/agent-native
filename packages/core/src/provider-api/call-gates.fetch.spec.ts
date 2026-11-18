import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearProviderCallGatesForTests,
  fetchWithProviderCallGate,
  isProviderCallGateRefusal,
  registerProviderCallGate,
  type ProviderCallGate,
  type ProviderCallGateRequest,
} from "./call-gates.js";

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

  it("skips the precheck a caller already ran", async () => {
    const precheck = vi.fn(async () => undefined);
    const { prepared } = gate({ precheck });
    const send = transport();

    await fetchWithProviderCallGate({ ...input(), prechecked: true }, send);
    expect(precheck).not.toHaveBeenCalled();
    expect(prepared).toHaveLength(1);

    await fetchWithProviderCallGate(input(), send);
    expect(precheck).toHaveBeenCalledOnce();
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
