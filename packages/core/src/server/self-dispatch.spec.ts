import { afterEach, describe, expect, it, vi } from "vitest";

import { fireInternalDispatch } from "./self-dispatch.js";

describe("fireInternalDispatch", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("rejects quickly returned non-2xx processor responses", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      text: async () =>
        "Agent Teams processor not configured - set A2A_SECRET on this deployment.",
    })) as unknown as typeof fetch;

    await expect(
      fireInternalDispatch({
        baseUrl: "https://slides.example.test",
        path: "/_agent-native/agent-teams/_process-run",
        taskId: "task-1",
        settleMs: 1000,
      }),
    ).rejects.toThrow(
      "Self-dispatch to /_agent-native/agent-teams/_process-run returned HTTP 503 Service Unavailable",
    );
    expect(errorSpy).toHaveBeenCalledWith(
      "[self-dispatch] dispatch to /_agent-native/agent-teams/_process-run " +
        "(base https://slides.example.test) failed:",
      expect.any(Error),
    );
  });

  it("dispatches /.netlify/functions/* to the HOST ROOT (strips the app base path)", async () => {
    const previous = process.env.APP_BASE_PATH;
    process.env.APP_BASE_PATH = "/starter";
    let calledUrl = "";
    globalThis.fetch = vi.fn(async (url: string) => {
      calledUrl = url;
      return {
        ok: true,
        status: 202,
        statusText: "Accepted",
        text: async () => "",
      };
    }) as unknown as typeof fetch;

    try {
      await fireInternalDispatch({
        // Base url is already app-base-path-prefixed (as resolveSelfDispatchBaseUrl
        // returns it for a workspace app).
        baseUrl: "https://workspace.example.test/starter",
        path: "/.netlify/functions/starter-agent-background",
        taskId: "task-1",
        settleMs: 1000,
      });
    } finally {
      if (previous === undefined)
        Reflect.deleteProperty(process.env, "APP_BASE_PATH");
      else process.env.APP_BASE_PATH = previous;
    }

    // The /starter base path must be stripped for the host-root function url.
    expect(calledUrl).toBe(
      "https://workspace.example.test/.netlify/functions/starter-agent-background",
    );
  });

  it("keeps the app base path for non-function (framework-route) dispatches", async () => {
    const previous = process.env.APP_BASE_PATH;
    process.env.APP_BASE_PATH = "/starter";
    let calledUrl = "";
    globalThis.fetch = vi.fn(async (url: string) => {
      calledUrl = url;
      return { ok: true, status: 200, statusText: "OK", text: async () => "" };
    }) as unknown as typeof fetch;

    try {
      await fireInternalDispatch({
        baseUrl: "https://workspace.example.test/starter",
        path: "/_agent-native/agent-chat/_process-run",
        taskId: "task-1",
        settleMs: 1000,
      });
    } finally {
      if (previous === undefined)
        Reflect.deleteProperty(process.env, "APP_BASE_PATH");
      else process.env.APP_BASE_PATH = previous;
    }

    expect(calledUrl).toBe(
      "https://workspace.example.test/starter/_agent-native/agent-chat/_process-run",
    );
  });

  it("does not wait for long-running processor responses", async () => {
    globalThis.fetch = vi.fn(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                ok: true,
                status: 200,
                statusText: "OK",
                text: async () => "",
              }),
            50,
          );
        }),
    ) as unknown as typeof fetch;

    await expect(
      fireInternalDispatch({
        baseUrl: "https://slides.example.test",
        path: "/_agent-native/agent-teams/_process-run",
        taskId: "task-1",
        settleMs: 1,
      }),
    ).resolves.toBeUndefined();
  });

  // ─── awaitResponse (confirmed handoff for continuation dispatch) ───────────

  describe("awaitResponse", () => {
    it("resolves once the target confirms receipt with a 2xx", async () => {
      globalThis.fetch = vi.fn(async () => ({
        ok: true,
        status: 202,
        statusText: "Accepted",
        text: async () => "",
      })) as unknown as typeof fetch;

      await expect(
        fireInternalDispatch({
          baseUrl: "https://slides.example.test",
          path: "/_agent-native/agent-chat/_process-run",
          taskId: "task-await-ok",
          awaitResponse: true,
        }),
      ).resolves.toBeUndefined();
    });

    it("throws on a non-2xx response instead of racing the settle timer", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      globalThis.fetch = vi.fn(async () => ({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "boom",
      })) as unknown as typeof fetch;

      await expect(
        fireInternalDispatch({
          baseUrl: "https://slides.example.test",
          path: "/_agent-native/agent-chat/_process-run",
          taskId: "task-await-500",
          awaitResponse: true,
        }),
      ).rejects.toThrow(
        "Self-dispatch to /_agent-native/agent-chat/_process-run returned HTTP 500 Internal Server Error",
      );
      errorSpy.mockRestore();
    });

    it("throws when the fetch itself rejects (network error)", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      globalThis.fetch = vi.fn(async () => {
        throw new Error("network unreachable");
      }) as unknown as typeof fetch;

      await expect(
        fireInternalDispatch({
          baseUrl: "https://slides.example.test",
          path: "/_agent-native/agent-chat/_process-run",
          taskId: "task-await-network-fail",
          awaitResponse: true,
        }),
      ).rejects.toThrow("network unreachable");
      errorSpy.mockRestore();
    });

    it("bounds the wait with an AbortSignal derived from responseTimeoutMs", async () => {
      let sawSignal: AbortSignal | undefined;
      globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
        sawSignal = init?.signal ?? undefined;
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => "",
        };
      }) as unknown as typeof fetch;

      await fireInternalDispatch({
        baseUrl: "https://slides.example.test",
        path: "/_agent-native/agent-chat/_process-run",
        taskId: "task-await-timeout-signal",
        awaitResponse: true,
        responseTimeoutMs: 5_000,
      });

      expect(sawSignal).toBeInstanceOf(AbortSignal);
    });

    it("regression: WITHOUT awaitResponse, a slow non-2xx response after the settle window does not throw or reject the call", async () => {
      // Old behavior must be preserved for every other caller: the settle race
      // resolves once the dispatch has had time to leave the process, and a
      // late-arriving error response (after settleMs) must not surface as a
      // rejection — the caller has already moved on.
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      let rejectUnhandled: (() => void) | undefined;
      const unhandledGuard = new Promise<void>((_resolve, reject) => {
        rejectUnhandled = () =>
          reject(new Error("unhandled rejection surfaced"));
      });
      const onUnhandledRejection = () => rejectUnhandled?.();
      process.on("unhandledRejection", onUnhandledRejection);

      globalThis.fetch = vi.fn(
        () =>
          new Promise((resolve) => {
            setTimeout(
              () =>
                resolve({
                  ok: false,
                  status: 503,
                  statusText: "Service Unavailable",
                  text: async () => "late failure",
                }),
              50,
            );
          }),
      ) as unknown as typeof fetch;

      await expect(
        fireInternalDispatch({
          baseUrl: "https://slides.example.test",
          path: "/_agent-native/agent-chat/_process-run",
          taskId: "task-no-await-late-failure",
          settleMs: 1,
          // awaitResponse intentionally omitted.
        }),
      ).resolves.toBeUndefined();

      // Let the late 503 land and be swallowed by the existing .catch path.
      await new Promise((resolve) => setTimeout(resolve, 80));
      process.off("unhandledRejection", onUnhandledRejection);
      await Promise.race([unhandledGuard, Promise.resolve()]);
      errorSpy.mockRestore();
    });
  });
});
