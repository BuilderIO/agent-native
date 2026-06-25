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
});
