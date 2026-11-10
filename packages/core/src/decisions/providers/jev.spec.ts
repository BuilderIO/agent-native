import { afterEach, describe, expect, it, vi } from "vitest";

const loadOptionalPeerMock = vi.hoisted(() => vi.fn());
const systemOneMock = vi.hoisted(() => vi.fn());
const typeSafeClientOptionsMock = vi.hoisted(() => vi.fn());
const scoreBuilderMock = vi.hoisted(() => vi.fn());

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
    urgency: {
      type: "score",
      instructions: "How soon does this need attention?",
      criteria: [
        "none: No action is needed.",
        "this_week: It can wait a few days.",
        "today: It needs attention today.",
      ],
    },
  },
};

// Schema-derived from the Builder proxy's SystemOneResponseSchema. No Jev
// credential was available, so this fixture is not an observed live response.
const responseFixture = {
  answers: {
    isRefundRequest: { type: "noul", noul: 0.96 },
    route: { type: "choice", choice: "billing" },
    urgency: {
      type: "score",
      score: 2,
      legend: {
        "answer-a": "none: No action is needed.",
        "answer-b": "this_week: It can wait a few days.",
        "answer-c": "today: It needs attention today.",
      },
      probabilities: { "answer-a": 0.2, "answer-b": 0.5, "answer-c": 0.3 },
      confidence: 0.82,
    },
  },
  usage: { input_tokens: 42, output_tokens: 8 },
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
    score: (instructions: string, criteria: readonly string[]) => {
      scoreBuilderMock(instructions, criteria);
      return { type: "score", instructions, criteria };
    },
    noul: (instructions: string, criteria?: unknown) => ({
      type: "noul",
      instructions,
      ...(criteria === undefined ? {} : { criteria }),
    }),
  });
}

describe("requestJevThroughBuilder", () => {
  it("sends mixed predicate, choice, and score questions in one Builder request", async () => {
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
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(response).toEqual(responseFixture);
  });
});

describe("requestJev direct SDK mapping", () => {
  it("passes the ordered score criteria to the same System One request shape", async () => {
    installDirectSdk();
    systemOneMock.mockResolvedValue(responseFixture);

    await requestJev({
      directApiKey: "org-jev-test-key",
      request: requestFixture,
    });

    expect(scoreBuilderMock).toHaveBeenCalledWith(
      "How soon does this need attention?",
      [
        "none: No action is needed.",
        "this_week: It can wait a few days.",
        "today: It needs attention today.",
      ],
    );
    expect(systemOneMock.mock.calls[0]?.[0]).toMatchObject({
      questions: {
        urgency: {
          type: "score",
          instructions: "How soon does this need attention?",
          criteria: [
            "none: No action is needed.",
            "this_week: It can wait a few days.",
            "today: It needs attention today.",
          ],
        },
      },
    });
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
