import { afterEach, describe, expect, it, vi } from "vitest";

const analyticsMocks = vi.hoisted(() => ({
  trackEvent: vi.fn(),
}));
vi.mock("./analytics.js", () => analyticsMocks);

const sessionMocks = vi.hoisted(() => ({
  recheckSessionAfterUnauthorized: vi.fn(),
}));
vi.mock("./use-session.js", () => sessionMocks);

import {
  ACTION_KEEPALIVE_BODY_BUDGET_BYTES,
  actionErrorMessage,
  callAction,
  callActionWithRetry,
  computePageHidden,
  defaultActionQueryRetry,
  defaultActionQueryRetryDelay,
  guardActionQueryRefetchInterval,
  serializeActionQueryParams,
  shouldRetryActionQueryForError,
  tryCallActionKeepalive,
} from "./use-action.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  delete (
    globalThis as typeof globalThis & {
      __AGENT_NATIVE_BUILD_ID__?: string;
      __AGENT_NATIVE_CLIENT_COMPATIBILITY_VERSION__?: string;
    }
  ).__AGENT_NATIVE_BUILD_ID__;
  delete (
    globalThis as typeof globalThis & {
      __AGENT_NATIVE_CLIENT_COMPATIBILITY_VERSION__?: string;
    }
  ).__AGENT_NATIVE_CLIENT_COMPATIBILITY_VERSION__;
});

describe("serializeActionQueryParams", () => {
  it("serializes array GET params with bracket keys so single values stay arrays", () => {
    const query = serializeActionQueryParams({
      libraryId: "lib-1",
      candidateRunIds: ["run-1", "run-2"],
      empty: undefined,
      none: null,
    });

    const params = new URLSearchParams(query);
    expect(params.get("libraryId")).toBe("lib-1");
    expect(params.getAll("candidateRunIds[]")).toEqual(["run-1", "run-2"]);
    expect(params.has("empty")).toBe(false);
    expect(params.has("none")).toBe(false);
  });

  it("serializes nested object GET params as JSON", () => {
    const tableQuery = {
      filters: [
        {
          propertyId: "status",
          operator: "equals",
          value: "published",
        },
      ],
      sorts: [{ propertyId: "date", direction: "desc" }],
    };

    const query = serializeActionQueryParams({
      documentId: "doc-1",
      tableQuery,
    });

    const params = new URLSearchParams(query);
    expect(params.get("documentId")).toBe("doc-1");
    expect(params.get("tableQuery")).toBe(JSON.stringify(tableQuery));
    expect(query).not.toContain("%5Bobject+Object%5D");
  });
});

describe("callAction", () => {
  it("does not commit a response whose signal was aborted while its body was reading", async () => {
    let resolveBody!: (body: string) => void;
    const body = new Promise<string>((resolve) => {
      resolveBody = resolve;
    });
    const response = {
      headers: new Headers({ "Content-Type": "application/json" }),
      ok: true,
      status: 200,
      statusText: "OK",
      text: vi.fn(() => body),
    } as unknown as Response;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    const controller = new AbortController();
    const request = callAction(
      "read-thing",
      {},
      {
        method: "GET",
        signal: controller.signal,
      },
    );
    await vi.waitFor(() => expect(response.text).toHaveBeenCalled());

    controller.abort();
    resolveBody(JSON.stringify({ ok: true }));

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });

  it("preserves safe structured action error metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: "Verification timed out",
            errorCode: "workspace_feature_flag_verification_timeout",
            details: { phase: "verification-timeout" },
          },
          { status: 500 },
        ),
      ),
    );

    const error = await callAction("set-workspace-feature-flag", {}).catch(
      (caught) => caught,
    );

    expect(error).toMatchObject({
      status: 500,
      errorCode: "workspace_feature_flag_verification_timeout",
      details: { phase: "verification-timeout" },
    });
    expect(error.message).toContain("Verification timed out");
  });

  it("sends build compatibility and hard-refreshes once on a mismatch", async () => {
    Object.assign(globalThis, {
      __AGENT_NATIVE_BUILD_ID__: "client-build",
      __AGENT_NATIVE_CLIENT_COMPATIBILITY_VERSION__: "spaces-v1",
    });
    const replace = vi.fn();
    vi.stubGlobal("window", {
      location: { href: "https://content.example/page/one", replace },
      history: { state: null, replaceState: vi.fn() },
      sessionStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        { code: "client_build_mismatch" },
        {
          status: 409,
          headers: {
            "Content-Type": "application/json",
            "X-Agent-Native-Client-Mismatch": "1",
            "X-Agent-Native-Build-Id": "server-build",
            "X-Agent-Native-Client-Compatibility": "spaces-v2",
          },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callAction("list-files", {}, { method: "GET" }),
    ).rejects.toMatchObject({ status: 409, code: "client_build_mismatch" });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      "X-Agent-Native-Client-Compatibility": "spaces-v1",
      "X-Agent-Native-Build-Id": "client-build",
    });
    expect(replace).toHaveBeenCalledWith(
      "https://content.example/page/one?__an_build=server-build",
    );
  });

  it("correlates browser timing with server and database phases", async () => {
    vi.stubEnv("VITE_AGENT_NATIVE_ACTION_TELEMETRY_SAMPLE_RATE", "1");
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        { ok: true },
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": "11",
            "X-Agent-Native-Request-Id": "request-123",
            "Server-Timing":
              "app;dur=120, startup;dur=45, startup-db;dur=44, startup-db-connect;dur=30, db;dur=60, db-connect;dur=35, db-slowest;dur=40",
          },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callAction("list-plans", {}, { method: "GET" }),
    ).resolves.toEqual({ ok: true });

    expect(analyticsMocks.trackEvent).toHaveBeenCalledWith(
      "action.response",
      expect.objectContaining({
        action: "list-plans",
        request_id: "request-123",
        sample_rate: 1,
        sample_weight: 1,
        sampled: false,
        status_code: 200,
        outcome: "success",
        server_duration_ms: 120,
        framework_ready_wait_ms: 45,
        db_operation_wall_ms: 60,
        db_connect_total_ms: 35,
        db_slowest_operation_ms: 40,
        startup_db_operation_wall_ms: 44,
        startup_db_connect_total_ms: 30,
        response_bytes: 11,
      }),
    );
  });

  it("reports cold-start boot/init timing and response_bytes only when the server sent them", async () => {
    vi.stubEnv("VITE_AGENT_NATIVE_ACTION_TELEMETRY_SAMPLE_RATE", "1");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          { ok: true },
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Server-Timing": "app;dur=120, boot;dur=2400, init;dur=900",
              // No Content-Length header on this response.
            },
          },
        ),
      ),
    );

    await callAction("list-plans", {}, { method: "GET" });

    expect(analyticsMocks.trackEvent).toHaveBeenCalledWith(
      "action.response",
      expect.objectContaining({
        server_boot_ms: 2400,
        server_init_ms: 900,
        cold_start: true,
        response_bytes: undefined,
        timeout_ms: 60_000,
      }),
    );
  });

  it("reports cold_start:false on a warm server-timing header, not just absence of boot", async () => {
    vi.stubEnv("VITE_AGENT_NATIVE_ACTION_TELEMETRY_SAMPLE_RATE", "1");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          { ok: true },
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Server-Timing": "app;dur=45",
            },
          },
        ),
      ),
    );

    await callAction("list-plans", {}, { method: "GET" });

    expect(analyticsMocks.trackEvent).toHaveBeenCalledWith(
      "action.response",
      expect.objectContaining({ cold_start: false }),
    );
  });

  it("leaves cold_start absent for a shared-cacheable response's origin-only Server-Timing, instead of guessing warm", async () => {
    vi.stubEnv("VITE_AGENT_NATIVE_ACTION_TELEMETRY_SAMPLE_RATE", "1");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          { ok: true },
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Server-Timing": 'origin;dur=8,desc="2026-01-01T00:00:00.000Z"',
            },
          },
        ),
      ),
    );

    await callAction("list-plans", {}, { method: "GET" });

    expect(analyticsMocks.trackEvent).toHaveBeenCalledWith(
      "action.response",
      expect.objectContaining({ cold_start: undefined }),
    );
  });

  it("leaves cold_start absent when no Server-Timing header ever arrived", async () => {
    vi.stubEnv("VITE_AGENT_NATIVE_ACTION_TELEMETRY_SAMPLE_RATE", "1");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ ok: true }, { status: 200, headers: {} }),
        ),
    );

    await callAction("list-plans", {}, { method: "GET" });

    expect(analyticsMocks.trackEvent).toHaveBeenCalledWith(
      "action.response",
      expect.objectContaining({ cold_start: undefined }),
    );
  });

  it("passes a custom timeoutMs through to timeout_ms", async () => {
    vi.stubEnv("VITE_AGENT_NATIVE_ACTION_TELEMETRY_SAMPLE_RATE", "1");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ ok: true }, { status: 200 })),
    );

    await callAction("list-plans", {}, { method: "GET", timeoutMs: 10_000 });

    expect(analyticsMocks.trackEvent).toHaveBeenCalledWith(
      "action.response",
      expect.objectContaining({ timeout_ms: 10_000 }),
    );
  });

  it("reports page_hidden as undefined with no document to ask (SSR-safe)", async () => {
    vi.stubEnv("VITE_AGENT_NATIVE_ACTION_TELEMETRY_SAMPLE_RATE", "1");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ ok: true }, { status: 200 })),
    );

    await callAction("list-plans", {}, { method: "GET" });

    expect(analyticsMocks.trackEvent).toHaveBeenCalledWith(
      "action.response",
      expect.objectContaining({ page_hidden: undefined }),
    );
  });

  it("always tracks 4xx action responses when success sampling is disabled", async () => {
    vi.stubEnv("VITE_AGENT_NATIVE_ACTION_TELEMETRY_SAMPLE_RATE", "0");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          { error: "Forbidden" },
          {
            status: 403,
            headers: {
              "Content-Type": "application/json",
              "X-Agent-Native-Request-Id": "request-forbidden",
            },
          },
        ),
      ),
    );

    await expect(
      callAction("get-visual-plan", {}, { method: "GET" }),
    ).rejects.toMatchObject({ status: 403 });

    expect(analyticsMocks.trackEvent).toHaveBeenCalledWith(
      "action.response",
      expect.objectContaining({
        action: "get-visual-plan",
        request_id: "request-forbidden",
        sample_rate: 1,
        sample_weight: 1,
        sampled: false,
        status_code: 403,
        status_class: "4xx",
        outcome: "http-error",
      }),
    );
  });

  it("records the inclusion rate and weight for sampled fast successes", async () => {
    vi.stubEnv("VITE_AGENT_NATIVE_ACTION_TELEMETRY_SAMPLE_RATE", "0.25");
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ ok: true }, { status: 200 })),
    );

    try {
      await expect(
        callAction("list-plans", {}, { method: "GET" }),
      ).resolves.toEqual({ ok: true });

      expect(analyticsMocks.trackEvent).toHaveBeenCalledWith(
        "action.response",
        expect.objectContaining({
          action: "list-plans",
          sample_rate: 0.25,
          sample_weight: 4,
          sampled: true,
        }),
      );
    } finally {
      random.mockRestore();
    }
  });

  it("re-resolves the session when an action is refused as unauthenticated", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: "Unauthorized" }, { status: 401 }),
        ),
    );

    await expect(
      callAction("list-designs", {}, { method: "GET" }),
    ).rejects.toMatchObject({ status: 401 });

    expect(sessionMocks.recheckSessionAfterUnauthorized).toHaveBeenCalledTimes(
      1,
    );
  });

  it("leaves the session alone when an action is refused as forbidden", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: "Forbidden" }, { status: 403 }),
        ),
    );

    await expect(
      callAction("list-designs", {}, { method: "GET" }),
    ).rejects.toMatchObject({ status: 403 });

    expect(sessionMocks.recheckSessionAfterUnauthorized).not.toHaveBeenCalled();
  });

  it("calls mutating actions through the framework action transport", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ok: true, id: "meal-1" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(callAction("log-meal", { name: "Salad" })).resolves.toEqual({
      ok: true,
      id: "meal-1",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/_agent-native/actions/log-meal",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
        cache: "no-store",
        body: JSON.stringify({ name: "Salad" }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).not.toHaveProperty(
      "X-Request-Source",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      "X-Agent-Native-Browser-Tab": expect.any(String),
    });
  });

  it("passes scoped capability headers through imperative action calls", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await callAction(
      "open-visual-edit",
      { devServerUrl: "http://localhost:5173" },
      {
        headers: {
          Authorization: "Bearer capability-token",
          "X-Agent-Native-Embed-Target": "/visual-edit",
        },
      },
    );

    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer capability-token",
      "X-Agent-Native-Embed-Target": "/visual-edit",
    });
  });

  it("sends the browser session id so actions share the agent run's session", async () => {
    const store = new Map<string, string>([
      ["agent-native.session_id_pin", "run-42"],
    ]);
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await callAction("log-meal", { name: "Salad" });

    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      "X-Agent-Native-Session-Id": "run-42",
    });
  });

  it("serializes GET params for imperative reads", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse([{ id: "meal-1" }]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callAction("list-meals", { tags: ["lunch", "fresh"] }, { method: "GET" }),
    ).resolves.toEqual([{ id: "meal-1" }]);

    expect(fetchMock).toHaveBeenCalledWith(
      "/_agent-native/actions/list-meals?tags%5B%5D=lunch&tags%5B%5D=fresh",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).not.toHaveProperty(
      "X-Request-Source",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      "X-Agent-Native-Browser-Tab": expect.any(String),
    });
  });

  it("times out hung requests with a typed, non-retryable error", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(
                new DOMException("The operation was aborted.", "AbortError"),
              ),
            );
          }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const promise = callAction("slow-action", {}, { timeoutMs: 1_000 });
      const assertion = expect(promise).rejects.toMatchObject({
        message: expect.stringContaining("slow-action timed out after 1s"),
        timedOut: true,
        status: 408,
      });
      await vi.advanceTimersByTimeAsync(1_001);
      await assertion;
      const timeoutError = await promise.catch((err) => err);
      expect(defaultActionQueryRetry(0, timeoutError)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out when the response body hangs after headers arrive", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
        Promise.resolve({
          ok: true,
          status: 200,
          text: () =>
            new Promise<string>((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () =>
                reject(
                  new DOMException("The operation was aborted.", "AbortError"),
                ),
              );
            }),
        } as unknown as Response),
      );
      vi.stubGlobal("fetch", fetchMock);

      const promise = callAction("slow-body", {}, { timeoutMs: 1_000 });
      const assertion = expect(promise).rejects.toMatchObject({
        timedOut: true,
        status: 408,
      });
      await vi.advanceTimersByTimeAsync(1_001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("propagates caller aborts as cancellation, not an action failure", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(
              new DOMException("The operation was aborted.", "AbortError"),
            ),
          );
          if (init?.signal?.aborted) {
            reject(
              new DOMException("The operation was aborted.", "AbortError"),
            );
          }
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const promise = callAction("any-action", {}, { signal: controller.signal });
    const assertion = expect(promise).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await assertion;
    const error = await promise.catch((err) => err);
    expect(String(error.message)).not.toContain("Action any-action failed");
    expect(analyticsMocks.trackEvent).toHaveBeenCalledWith(
      "action.response",
      expect.objectContaining({
        action: "any-action",
        outcome: "cancelled",
        sample_rate: 1,
        sample_weight: 1,
        sampled: false,
        success: false,
      }),
    );
  });

  it("surfaces a transport-level abort as a retryable error, not a cancellation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.reject(
          new DOMException("The operation was aborted.", "AbortError"),
        ),
      ),
    );

    const error = await callAction("list-meetings").catch((err) => err);

    expect(String(error.message)).toContain("Action list-meetings failed");
    expect(defaultActionQueryRetry(0, error)).toBe(true);
  });

  it("times out a transport that never settles and ignores the abort signal", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(() => new Promise<Response>(() => {})),
      );

      const promise = callAction("stuck-action", {}, { timeoutMs: 1_000 });
      const assertion = expect(promise).rejects.toMatchObject({
        timedOut: true,
        status: 408,
      });
      await vi.advanceTimersByTimeAsync(1_001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends the caller's default POST even when the action declares DELETE, then fails loudly naming the fix", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { error: "Method not allowed. Use DELETE." },
          { status: 405 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const error = await callAction("delete-todo", { id: "1" }).catch(
      (err) => err,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/_agent-native/actions/delete-todo",
      expect.objectContaining({ method: "POST" }),
    );
    expect(error).toMatchObject({
      status: 405,
      code: "action_method_mismatch",
      sentMethod: "POST",
      requiredMethod: "DELETE",
    });
    expect(String(error.message)).toContain("delete-todo");
    expect(String(error.message)).toContain('{ method: "DELETE" }');
    expect(defaultActionQueryRetry(0, error)).toBe(false);
  });

  it("times out an unabortable body stream after headers arrive", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          status: 200,
          text: () => new Promise<string>(() => {}),
        })),
      );

      const promise = callAction("stuck-body", {}, { timeoutMs: 1_000 });
      const assertion = expect(promise).rejects.toMatchObject({
        timedOut: true,
        status: 408,
      });
      await vi.advanceTimersByTimeAsync(1_001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("callActionWithRetry", () => {
  it("spends the transient budget on a gateway failure instead of surfacing it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    vi.useFakeTimers();
    try {
      const promise = callActionWithRetry("list-things", {}, { method: "GET" });
      await vi.advanceTimersByTimeAsync(600);
      await expect(promise).resolves.toEqual({ ok: true });
    } finally {
      vi.useRealTimers();
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces a deterministic refusal on the first attempt", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "Nope" }, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callActionWithRetry("read-thing", {}, { method: "GET" }),
    ).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves Retry-After milliseconds and the action error code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: "Gmail is temporarily limiting requests.",
            errorCode: "gmail_quota_cooldown",
          },
          { status: 429, headers: { "Retry-After": "45" } },
        ),
      ),
    );

    await expect(
      callAction("mark-thread-read", { threadId: "thread-1" }),
    ).rejects.toMatchObject({
      status: 429,
      errorCode: "gmail_quota_cooldown",
      retryAfterMs: 45_000,
    });
  });

  it("refuses a write method instead of risking a duplicated mutation", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callActionWithRetry("send-thing", {}, {
        method: "POST",
      } as Parameters<typeof callActionWithRetry>[2]),
    ).rejects.toThrow(/refuses POST/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends GET even when the caller passes no method", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await callActionWithRetry("read-thing");

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "GET" });
  });

  it("stops the backoff as soon as the caller aborts", async () => {
    const controller = new AbortController();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    vi.useFakeTimers();
    try {
      const promise = callActionWithRetry(
        "read-thing",
        {},
        { method: "GET", signal: controller.signal },
      );
      const assertion = expect(promise).rejects.toMatchObject({ status: 503 });

      for (let tick = 0; tick < 10; tick++) {
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(fetchMock).toHaveBeenCalledTimes(1);

      controller.abort();
      await assertion;

      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry an aborted call", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(() => {
      controller.abort();
      const error = new Error("The operation was aborted.");
      error.name = "AbortError";
      return Promise.reject(error);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callActionWithRetry(
        "read-thing",
        {},
        { method: "GET", signal: controller.signal },
      ),
    ).rejects.toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("tryCallActionKeepalive", () => {
  it("uses the normal action transport and exposes response completion", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ok: true, version: 3 }));
    vi.stubGlobal("fetch", fetchMock);

    const attempt = tryCallActionKeepalive<{ ok: boolean; version: number }>(
      "update-file",
      { id: "file-1", content: "updated" },
    );

    expect(attempt.accepted).toBe(true);
    if (!attempt.accepted) throw new Error("Expected keepalive to be accepted");
    await expect(attempt.completion).resolves.toEqual({ ok: true, version: 3 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/_agent-native/actions/update-file",
      expect.objectContaining({
        method: "POST",
        keepalive: true,
        cache: "no-store",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-Agent-Native-Frontend": "1",
        }),
        body: JSON.stringify({ id: "file-1", content: "updated" }),
      }),
    );
  });

  it("holds the aggregate reservation until the response body completes", async () => {
    let resolveFirst: ((response: Response) => void) | undefined;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const payload = { content: "x".repeat(30_000) };

    const first = tryCallActionKeepalive("save-one", payload);
    const blocked = tryCallActionKeepalive("save-two", payload);
    expect(first.accepted).toBe(true);
    expect(blocked).toMatchObject({
      accepted: false,
      reason: "budget-exhausted",
    });

    resolveFirst?.(jsonResponse({ ok: true }));
    if (!first.accepted)
      throw new Error("Expected first request to be accepted");
    await first.completion;

    const afterCompletion = tryCallActionKeepalive("save-three", payload);
    expect(afterCompletion.accepted).toBe(true);
    if (!afterCompletion.accepted) {
      throw new Error("Expected released reservation to be reusable");
    }
    await afterCompletion.completion;
  });

  it("releases the aggregate reservation after a rejected fetch", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const payload = { content: "x".repeat(30_000) };

    const failed = tryCallActionKeepalive("save-one", payload);
    expect(failed.accepted).toBe(true);
    if (!failed.accepted) throw new Error("Expected request to be accepted");
    await expect(failed.completion).rejects.toThrow(/network unavailable/);

    const retry = tryCallActionKeepalive("save-two", payload);
    expect(retry.accepted).toBe(true);
    if (!retry.accepted) {
      throw new Error("Expected rejected request to release its reservation");
    }
    await retry.completion;
  });

  it("releases the aggregate reservation after caller abort", async () => {
    const controller = new AbortController();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      )
      .mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const payload = { content: "x".repeat(30_000) };

    const aborted = tryCallActionKeepalive("save-one", payload, {
      signal: controller.signal,
    });
    expect(aborted.accepted).toBe(true);
    if (!aborted.accepted) throw new Error("Expected request to be accepted");
    controller.abort();
    await expect(aborted.completion).rejects.toMatchObject({
      name: "AbortError",
    });

    const retry = tryCallActionKeepalive("save-two", payload);
    expect(retry.accepted).toBe(true);
    if (!retry.accepted) {
      throw new Error("Expected aborted request to release its reservation");
    }
    await retry.completion;
  });

  it("rejects a body larger than the conservative keepalive budget", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const attempt = tryCallActionKeepalive("update-file", {
      content: "x".repeat(ACTION_KEEPALIVE_BODY_BUDGET_BYTES),
    });

    expect(attempt).toMatchObject({
      accepted: false,
      reason: "body-too-large",
      completion: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("actionErrorMessage", () => {
  it("returns the action's own text without the console framing", async () => {
    vi.stubGlobal("fetch", async () =>
      jsonResponse(
        { error: "No such meeting", errorCode: "not_found" },
        { status: 404 },
      ),
    );

    const error: any = await callAction("get-meeting").catch((err) => err);

    expect(error.message).toBe("Action get-meeting failed: No such meeting");
    expect(actionErrorMessage(error)).toBe("No such meeting");
    expect(error.errorCode).toBe("not_found");
  });

  it("returns undefined when nothing authored a message", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response("<html><body>502 Bad Gateway</body></html>", {
          status: 502,
          headers: { "Content-Type": "text/html" },
        }),
    );

    const error: any = await callAction("get-meeting").catch((err) => err);

    expect(actionErrorMessage(error)).toBeUndefined();
    expect(error.status).toBe(502);
  });

  it("returns undefined for a network failure and for a non-error value", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });

    const error = await callAction("get-meeting").catch((err) => err);

    expect(actionErrorMessage(error)).toBeUndefined();
    expect(actionErrorMessage(undefined)).toBeUndefined();
    expect(actionErrorMessage("boom")).toBeUndefined();
  });
});

describe("action query retry defaults", () => {
  it("does not retry auth failures or timeouts, retries other errors up to 3 times", () => {
    const authError = Object.assign(new Error("nope"), { status: 401 });
    const timeoutError = Object.assign(new Error("slow"), { timedOut: true });
    const flakyError = new Error("ECONNRESET");

    expect(defaultActionQueryRetry(0, authError)).toBe(false);
    expect(defaultActionQueryRetry(0, timeoutError)).toBe(false);
    expect(defaultActionQueryRetry(0, flakyError)).toBe(true);
    expect(defaultActionQueryRetry(2, flakyError)).toBe(true);
    expect(defaultActionQueryRetry(3, flakyError)).toBe(false);
  });

  it("does not retry deterministic failures, 500 included", () => {
    for (const status of [400, 404, 405, 409, 422, 500, 501]) {
      const refusal = Object.assign(new Error("nope"), { status });
      expect(defaultActionQueryRetry(0, refusal)).toBe(false);
    }
  });

  it("retries only statuses a second identical request can resolve", () => {
    const rateLimited = Object.assign(new Error("slow down"), { status: 429 });

    expect(defaultActionQueryRetry(0, rateLimited)).toBe(true);
    expect(defaultActionQueryRetry(2, rateLimited)).toBe(true);
    expect(defaultActionQueryRetry(3, rateLimited)).toBe(false);

    for (const status of [502, 503, 504]) {
      const transient = Object.assign(new Error("down"), { status });
      expect(defaultActionQueryRetry(0, transient)).toBe(true);
      expect(defaultActionQueryRetry(2, transient)).toBe(true);
      expect(defaultActionQueryRetry(3, transient)).toBe(false);
    }
  });

  it("caps retry backoff at 2s so real failures surface fast", () => {
    expect(defaultActionQueryRetryDelay(0)).toBe(500);
    expect(defaultActionQueryRetryDelay(1)).toBe(1_000);
    expect(defaultActionQueryRetryDelay(2)).toBe(2_000);
    expect(defaultActionQueryRetryDelay(5)).toBe(2_000);
  });
});

describe("shouldRetryActionQueryForError", () => {
  it("does not retry browser resource-exhaustion failures", () => {
    expect(
      shouldRetryActionQueryForError(
        0,
        new Error(
          "Action list-documents failed: net::ERR_INSUFFICIENT_RESOURCES",
        ),
      ),
    ).toBe(false);
  });

  it("allows a single retry for network-level failures (Chrome reports pool exhaustion as a generic fetch failure)", () => {
    const networkError = new Error(
      "Action list-documents failed: Failed to fetch",
    );
    expect(shouldRetryActionQueryForError(0, networkError)).toBe(true);
    expect(shouldRetryActionQueryForError(1, networkError)).toBe(false);
  });

  it("keeps three retries for transient errors that reached the server", () => {
    const gatewayError = Object.assign(
      new Error("Action list-documents failed: HTTP 503"),
      { status: 503 },
    );
    expect(shouldRetryActionQueryForError(2, gatewayError)).toBe(true);
    expect(shouldRetryActionQueryForError(3, gatewayError)).toBe(false);

    const appError = Object.assign(
      new Error("Action list-documents failed: HTTP 500"),
      { status: 500 },
    );
    expect(shouldRetryActionQueryForError(0, appError)).toBe(false);
  });

  it("does not retry auth failures", () => {
    expect(shouldRetryActionQueryForError(0, { status: 401 })).toBe(false);
    expect(shouldRetryActionQueryForError(0, { status: 403 })).toBe(false);
  });
});

describe("guardActionQueryRefetchInterval", () => {
  function queryWithError(error: unknown) {
    return { state: { error } } as any;
  }

  it("stops polling once the query's last error is a terminal auth failure", () => {
    const guarded = guardActionQueryRefetchInterval<unknown>(5_000);

    expect(guarded(queryWithError({ status: 401 }))).toBe(false);
    expect(guarded(queryWithError({ status: 403 }))).toBe(false);
  });

  it("keeps polling at the caller's interval for a non-auth error or no error", () => {
    const guarded = guardActionQueryRefetchInterval<unknown>(5_000);

    expect(guarded(queryWithError(undefined))).toBe(5_000);
    expect(guarded(queryWithError({ status: 500 }))).toBe(5_000);
  });

  it("still calls a function-form refetchInterval when there is no terminal auth failure", () => {
    const intervalFn = vi.fn().mockReturnValue(2_000);
    const guarded = guardActionQueryRefetchInterval<unknown>(intervalFn);
    const query = queryWithError(undefined);

    expect(guarded(query)).toBe(2_000);
    expect(intervalFn).toHaveBeenCalledWith(query);
  });

  it("does not call a function-form refetchInterval on a terminal auth failure", () => {
    const intervalFn = vi.fn().mockReturnValue(2_000);
    const guarded = guardActionQueryRefetchInterval<unknown>(intervalFn);

    expect(guarded(queryWithError({ status: 401 }))).toBe(false);
    expect(intervalFn).not.toHaveBeenCalled();
  });
});

describe("computePageHidden", () => {
  it("is undefined with no document to ask (SSR, no DOM)", () => {
    expect(computePageHidden(false, 0, 0, undefined)).toBeUndefined();
  });

  it("is true when the hidden epoch changed during the call", () => {
    expect(computePageHidden(false, 0, 1, "visible")).toBe(true);
  });

  it("is true when the document is still hidden at completion", () => {
    expect(computePageHidden(false, 2, 2, "hidden")).toBe(true);
  });

  it("is false for a call that stayed visible with no hidden transition", () => {
    expect(computePageHidden(false, 3, 3, "visible")).toBe(false);
  });

  it("is true when the call started already hidden even if no transition fires and it is visible again by completion", () => {
    expect(computePageHidden(true, 4, 4, "visible")).toBe(true);
  });
});
