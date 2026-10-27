import { afterEach, describe, expect, it, vi } from "vitest";

const loadOptionalPeerMock = vi.hoisted(() => vi.fn());
const systemOneMock = vi.hoisted(() => vi.fn());
const typeSafeClientOptionsMock = vi.hoisted(() => vi.fn());

vi.mock("../../shared/optional-peer.js", () => ({
  loadOptionalPeer: (...args: unknown[]) => loadOptionalPeerMock(...args),
}));

import {
  JevProviderRequestError,
  isJevEnabled,
  requestJev,
  requestJevThroughBuilder,
  type JevRequest,
} from "./jev.js";

const requestFixture: JevRequest = {
  model: "jev-latest",
  state: { input: "The customer asks for a refund." },
  questions: {
    isRefundRequest: {
      type: "noul",
      instructions: "Is the customer asking for a refund?",
    },
    route: {
      type: "choice",
      instructions: "Which team should handle this?",
      criteria: {
        billing: "Payment questions",
        support: "Product questions",
      },
    },
  },
};

const responseFixture = {
  answers: {
    isRefundRequest: { type: "noul", noul: 0.96 },
    route: { type: "choice", choice: "billing" },
  },
};

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function installDirectSdk(): void {
  class FakeTypeSafeClient {
    constructor(options: unknown) {
      typeSafeClientOptionsMock(options);
    }

    systemOne(request: unknown): Promise<unknown> {
      return systemOneMock(request);
    }
  }
  loadOptionalPeerMock.mockResolvedValue({
    TypeSafeClient: FakeTypeSafeClient,
    choice: (instructions: string, criteria: Record<string, string>) => ({
      type: "choice",
      instructions,
      criteria,
    }),
    score: vi.fn(),
    noul: vi.fn(),
  });
}

describe("requestJevThroughBuilder", () => {
  it("sends verified predicate and choice questions through the Builder proxy", async () => {
    vi.stubEnv("BUILDER_PROXY_ORIGIN", "https://proxy.example.test");
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        Response.json(responseFixture),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await requestJevThroughBuilder(
      {
        authorization: "Bearer fake-builder-session",
        spaceId: "space-test",
        userId: "user-test",
      },
      requestFixture,
    );

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "https://proxy.example.test/agent-native/jev/v1/system-one",
    );
    expect(init).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        "Content-Type": "application/json",
        Authorization: "Bearer fake-builder-session",
        "x-builder-api-key": "space-test",
        "x-builder-user-id": "user-test",
      }),
      body: JSON.stringify(requestFixture),
    });
    expect(response).toEqual(responseFixture);
  });
});

describe("requestJev timeout budget", () => {
  it("gives direct fallback only the time left after a Builder failure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    vi.stubEnv("BUILDER_PROXY_ORIGIN", "https://proxy.example.test");
    installDirectSdk();
    systemOneMock.mockResolvedValue(responseFixture);

    let resolveFetch!: (response: Response) => void;
    const pendingFetch = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => pendingFetch),
    );

    const pendingRequest = requestJev({
      builderAuth: { authorization: "Bearer fake-builder-session" },
      directApiKey: "org-jev-test-key",
      request: requestFixture,
      timeoutMs: 1_000,
    });
    await vi.advanceTimersByTimeAsync(400);
    resolveFetch(new Response("proxy unavailable", { status: 503 }));

    await expect(pendingRequest).resolves.toEqual(responseFixture);
    expect(typeSafeClientOptionsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "org-jev-test-key",
        timeout: expect.any(Number),
      }),
    );
    const directTimeout = typeSafeClientOptionsMock.mock.calls[0]?.[0]?.timeout;
    expect(directTimeout).toBeGreaterThan(0);
    expect(directTimeout).toBeLessThan(1_000);
  });

  it("does not start direct fallback after the Builder budget expires", async () => {
    vi.useFakeTimers();
    vi.stubEnv("BUILDER_PROXY_ORIGIN", "https://proxy.example.test");
    installDirectSdk();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Timed out", "AbortError")),
              { once: true },
            );
          }),
      ),
    );

    const pendingRequest = requestJev({
      builderAuth: { authorization: "Bearer fake-builder-session" },
      directApiKey: "org-jev-test-key",
      request: requestFixture,
      timeoutMs: 1_000,
    });
    const expectedTimeout = expect(pendingRequest).rejects.toMatchObject({
      name: "JevProviderRequestError",
      reason: "timeout",
    } satisfies Partial<JevProviderRequestError>);
    await vi.advanceTimersByTimeAsync(1_000);

    await expectedTimeout;
    expect(loadOptionalPeerMock).not.toHaveBeenCalled();
  });

  it("normalizes direct Jev SDK timeouts and preserves caller cancellation", async () => {
    installDirectSdk();
    systemOneMock.mockRejectedValueOnce(
      new DOMException("Timed out", "AbortError"),
    );

    await expect(
      requestJev({ directApiKey: "org-jev-test-key", request: requestFixture }),
    ).rejects.toMatchObject({ reason: "timeout" });

    const controller = new AbortController();
    controller.abort();
    await expect(
      requestJev({
        directApiKey: "org-jev-test-key",
        request: requestFixture,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ reason: "aborted" });
  });
});

describe("isJevEnabled request options", () => {
  const auth = { authorization: "Bearer fake-builder-session" };
  const credentials = {
    apiKey: undefined,
    personalApiKey: undefined,
    directApiKey: undefined,
    builderAuth: auth,
  };

  it("uses the supplied remaining timeout for the Builder entitlement check", async () => {
    vi.useFakeTimers();
    vi.stubEnv("BUILDER_PROXY_ORIGIN", "https://proxy.example.test");
    const fetchMock = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init?.signal?.reason),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = isJevEnabled(credentials, { timeoutMs: 450 });
    const expectedTimeout = expect(pending).rejects.toMatchObject({
      name: "JevProviderRequestError",
      reason: "timeout",
    });
    await vi.advanceTimersByTimeAsync(449);
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expectedTimeout;
  });

  it("preserves caller cancellation for the Builder entitlement check", async () => {
    vi.stubEnv("BUILDER_PROXY_ORIGIN", "https://proxy.example.test");
    const fetchMock = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init?.signal?.reason),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const pending = isJevEnabled(credentials, {
      signal: controller.signal,
      timeoutMs: 3_000,
    });

    controller.abort();

    await expect(pending).rejects.toMatchObject({
      name: "JevProviderRequestError",
      reason: "aborted",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
