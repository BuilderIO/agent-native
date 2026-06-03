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
      "[self-dispatch] dispatch to /_agent-native/agent-teams/_process-run failed:",
      expect.any(Error),
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
