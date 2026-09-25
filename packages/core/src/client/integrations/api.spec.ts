import { afterEach, describe, expect, it, vi } from "vitest";

import {
  IntegrationClientError,
  listIntegrationEnvStatuses,
  listIntegrationStatuses,
  saveIntegrationEnvVars,
  setIntegrationEnabled,
  setupIntegration,
} from "./api.js";

describe("integration client helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("uses framework paths and returns status arrays", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ platform: "slack", enabled: false }]), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("window", { location: { pathname: "/dispatch/settings" } });

    await expect(listIntegrationStatuses()).resolves.toEqual([
      { platform: "slack", enabled: false },
    ]);

    expect(fetch).toHaveBeenCalledWith(
      "/_agent-native/integrations/status",
      undefined,
    );
  });

  it("uses named helpers for integration mutations and scoped saves", async () => {
    const fetch = vi
      .fn()
      .mockImplementation(
        async () =>
          new Response(JSON.stringify({ saved: ["SLACK_BOT_TOKEN"] })),
      );
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("window", { location: { pathname: "/dispatch/settings" } });

    await setIntegrationEnabled("slack", true);
    await setupIntegration("telegram");
    await saveIntegrationEnvVars([
      { key: "SLACK_BOT_TOKEN", value: "not-a-real-token" },
    ]);

    expect(fetch.mock.calls).toEqual([
      ["/_agent-native/integrations/slack/enable", { method: "POST" }],
      ["/_agent-native/integrations/telegram/setup", { method: "POST" }],
      [
        "/_agent-native/env-vars",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vars: [{ key: "SLACK_BOT_TOKEN", value: "not-a-real-token" }],
          }),
        },
      ],
    ]);
  });

  it("returns empty arrays for malformed list payloads and surfaces route errors", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ nope: true })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Missing credentials" }), {
          status: 400,
          statusText: "Bad Request",
        }),
      );
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("window", { location: { pathname: "/" } });

    await expect(listIntegrationEnvStatuses()).resolves.toEqual([]);
    await expect(setIntegrationEnabled("slack", true)).rejects.toEqual(
      new IntegrationClientError("Missing credentials", 400),
    );
  });

  it("throws an explicit parse error for malformed successful JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("{not-json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("window", { location: { pathname: "/" } });

    await expect(listIntegrationStatuses()).rejects.toEqual(
      new IntegrationClientError(
        "Integration response was not valid JSON.",
        200,
      ),
    );
  });
});
