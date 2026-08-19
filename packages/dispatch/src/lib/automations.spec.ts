import { afterEach, describe, expect, it, vi } from "vitest";

import { listDispatchAutomations } from "./automations.js";

describe("listDispatchAutomations", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the automation list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            {
              id: "automation-1",
              name: "daily-digest",
              path: "jobs/daily-digest.md",
              owner: "alice@example.com",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    await expect(listDispatchAutomations()).resolves.toEqual([
      expect.objectContaining({ name: "daily-digest" }),
    ]);
  });

  it("surfaces request failures instead of presenting an empty list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Database unavailable" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(listDispatchAutomations()).rejects.toThrow(
      "Database unavailable",
    );
  });

  it("rejects malformed successful responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ automations: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(listDispatchAutomations()).rejects.toThrow(
      "Automation list returned an invalid response",
    );
  });
});
