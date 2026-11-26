import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearProviderCallGatesForTests,
  type ProviderCallGate,
  type ProviderCallGateRequest,
} from "./call-gates.js";
import {
  createProviderApiRuntime,
  fetchProviderApiDocs,
  registerProviderCallGate,
  type ProviderApiRuntimeOptions,
} from "./index.js";
import { resetProviderQuotaStateForTests } from "./quota-governor.js";

vi.mock("../extensions/url-safety.js", () => ({
  createSsrfSafeDispatcher: async () => ({ dispatch: vi.fn() }),
  isBlockedExtensionUrlWithDns: async () => false,
}));

const runtimeOptions: ProviderApiRuntimeOptions = {
  appId: "example-app",
  providerIds: ["hubspot"],
  getCredentialContext: () => ({
    userEmail: "ada@example.com",
    orgId: "org-1",
  }),
};

function request(path = "/records", extra: Record<string, unknown> = {}) {
  return createProviderApiRuntime(runtimeOptions).executeRequest({
    provider: "hubspot",
    path,
    auth: "none",
    ...extra,
  });
}

function okResponse() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function fakeGate(overrides: Partial<ProviderCallGate> = {}): {
  gate: ProviderCallGate;
  prepared: ProviderCallGateRequest[];
  admissions: number;
  finalChecks: number;
} {
  const state = {
    prepared: [] as ProviderCallGateRequest[],
    admissions: 0,
    finalChecks: 0,
    gate: undefined as unknown as ProviderCallGate,
  };
  state.gate = {
    id: "example-gate",
    matches: ({ providerId, url }) =>
      providerId === "hubspot" ||
      (url !== undefined && new URL(url).hostname === "api.hubapi.com"),
    prepare: (input) => {
      state.prepared.push(input);
      return async () => {
        state.admissions += 1;
        return () => {
          state.finalChecks += 1;
        };
      };
    },
    ...overrides,
  };
  return state;
}

beforeEach(() => {
  resetProviderQuotaStateForTests();
  clearProviderCallGatesForTests();
  vi.stubEnv("AGENT_NATIVE_PROVIDER_API_PERSIST_COOLDOWNS", "0");
});

afterEach(() => {
  clearProviderCallGatesForTests();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("provider call gates", () => {
  it("sends requests unchanged when no gate is registered", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse());
    await expect(request()).resolves.toMatchObject({
      response: { status: 200 },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("admits a claimed request and runs its final check right before dispatch", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse());
    const state = fakeGate();
    registerProviderCallGate(state.gate);

    await expect(
      request("/records", { connectionId: "connection-1" }),
    ).resolves.toMatchObject({ response: { status: 200 } });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(state.admissions).toBe(1);
    expect(state.finalChecks).toBe(1);
    expect(state.prepared).toEqual([
      expect.objectContaining({
        providerId: "hubspot",
        url: "https://api.hubapi.com/records",
        method: "GET",
        path: "/records",
        appId: "example-app",
        connectionId: "connection-1",
        runtime: expect.objectContaining({ appId: "example-app" }),
      }),
    ]);
  });

  it("refuses before credentials resolve and passes the gate's error through unchanged", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const paused = Object.assign(new Error("Example provider is paused."), {
      errorCode: "example_paused",
      statusCode: 503,
    });
    const { gate } = fakeGate({
      precheck: async () => {
        throw paused;
      },
    });
    registerProviderCallGate(gate);

    await expect(request()).rejects.toBe(paused);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("attributes a docs fetch to the asking provider and app", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse());
    const { gate, prepared } = fakeGate();
    registerProviderCallGate(gate);

    await fetchProviderApiDocs(
      { provider: "hubspot", url: "https://api.hubapi.com/docs" },
      runtimeOptions,
    );

    expect(prepared).toEqual([
      expect.objectContaining({
        providerId: "hubspot",
        appId: "example-app",
        url: "https://api.hubapi.com/docs",
      }),
    ]);
  });

  it("hands a custom provider's request to its gate with the provider identity", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse());
    const { gate, prepared } = fakeGate();
    registerProviderCallGate({
      ...gate,
      matches: ({ providerId }) => providerId === "test-api",
    });

    await createProviderApiRuntime({
      ...runtimeOptions,
      providerIds: ["hubspot"],
      getCustomProviders: async () => [
        {
          id: "test-api",
          scope: "org" as const,
          scopeId: "org-1",
          label: "Custom",
          baseUrl: "https://api.example.test",
          auth: { type: "bearer" as const, credentialKey: "CUSTOM_TOKEN" },
          docsUrls: [],
          allowedHostSuffixes: [],
          defaultHeaders: {},
          notes: "",
          createdAt: 0,
          updatedAt: 0,
        },
      ],
    }).executeRequest({
      provider: "test-api",
      path: "/records",
      auth: "none",
    });

    expect(prepared).toEqual([
      expect.objectContaining({
        providerId: "test-api",
        appId: "example-app",
      }),
    ]);
  });

  it("admits each page of a paged request against that page's own URL", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    fetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ next: "p2", items: [1] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ next: null, items: [2] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const { gate, prepared } = fakeGate();
    registerProviderCallGate(gate);

    await request("/records", {
      fetchAllPages: { cursorPath: "next", cursorParam: "cursor" },
    });

    expect(prepared.map((entry) => entry.url).slice(-2)).toEqual([
      expect.stringContaining("/records"),
      expect.stringContaining("cursor=p2"),
    ]);
  });

  it("runs only the owning gate's precheck", async () => {
    const owner = vi.fn(async () => {});
    const later = vi.fn(async () => {
      throw new Error("Not the owner");
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse());
    registerProviderCallGate(fakeGate({ precheck: owner }).gate);
    registerProviderCallGate({
      ...fakeGate({ precheck: later }).gate,
      id: "later-gate",
    });

    await expect(request()).resolves.toBeDefined();
    expect(owner).toHaveBeenCalledTimes(1);
    expect(later).not.toHaveBeenCalled();
  });

  it("does not wrap a refusal from admission or the final check as a network failure", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const paused = new Error("Example provider is paused.");
    const lateRefusal = new Error("Paused while queued.");

    const admitting = fakeGate({
      prepare: () => async () => {
        throw paused;
      },
    });
    const unregister = registerProviderCallGate(admitting.gate);
    await expect(request()).rejects.toBe(paused);
    unregister();

    const lastMoment = fakeGate({
      prepare: () => async () => () => {
        throw lateRefusal;
      },
    });
    registerProviderCallGate(lastMoment.gate);
    await expect(request()).rejects.toBe(lateRefusal);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("answers with the gate's refusal response, which never cools down the provider's quota", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse());
    let exhausted = true;
    const budget = new Error("budget exhausted");
    const { gate } = fakeGate({
      prepare: () => async () => {
        if (exhausted) throw budget;
      },
      refusalResponse: (error) =>
        error === budget
          ? {
              status: 429,
              statusText: "Example budget exhausted",
              headers: { "retry-after": "600" },
              json: { error: { code: "example_budget_exhausted" } },
            }
          : undefined,
    });
    registerProviderCallGate(gate);

    await expect(request()).resolves.toMatchObject({
      response: {
        status: 429,
        json: { error: { code: "example_budget_exhausted" } },
      },
    });
    expect(fetch).not.toHaveBeenCalled();

    // A provider 429 would have put this quota key into cooldown; the gate's
    // own refusal leaves the next request free to go out.
    exhausted = false;
    await expect(request()).resolves.toMatchObject({
      response: { status: 200 },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("admits an attempt gate once per attempt and rechecks before each dispatch", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse());
    const order: string[] = [];
    const { gate } = fakeGate({
      admission: "attempt",
      prepare: () => async () => {
        order.push("admit");
      },
      recheck: async () => {
        order.push("recheck");
      },
    });
    registerProviderCallGate(gate);

    await request();
    expect(order).toEqual(["admit", "recheck"]);
  });

  it("refuses a second module registering a different gate under the same id", () => {
    const first = fakeGate();
    const unregister = registerProviderCallGate(first.gate);
    expect(registerProviderCallGate(first.gate)).toBeTypeOf("function");
    expect(() => registerProviderCallGate(fakeGate().gate)).toThrow(
      /already registered/,
    );
    unregister();
    expect(() => registerProviderCallGate(fakeGate().gate)).not.toThrow();
  });
});
