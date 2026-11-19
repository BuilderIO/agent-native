import { describe, expect, it } from "vitest";

import { maskMonitorUrl, monitorForCaller } from "./monitor-redaction";
import type { Monitor } from "./uptime-monitors";

function monitor(overrides: Partial<Monitor> = {}): Monitor {
  return {
    id: "m1",
    name: "Prod API",
    url: "https://api.example.com/health",
    method: "GET",
    requestHeaders: {},
    requestBody: null,
    intervalSeconds: 300,
    timeoutMs: 10_000,
    expectedStatus: { mode: "class", classes: ["2xx"] },
    assertions: [],
    followRedirects: true,
    severity: "critical",
    channels: ["inbox"],
    emailRecipients: [],
    slackWebhookUrl: null,
    webhookUrl: null,
    cooldownMinutes: 15,
    enabled: true,
    lastStatus: "up",
    lastCheckedAt: null,
    lastSuccessAt: null,
    lastError: null,
    lastLatencyMs: null,
    lastStatusCode: null,
    consecutiveFailures: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ownerEmail: "owner@example.test",
    orgId: null,
    ...overrides,
  };
}

describe("maskMonitorUrl", () => {
  it("drops userinfo and the fragment", () => {
    expect(
      maskMonitorUrl(
        "https://user:pass-fixture@api.example.com/h#frag-fixture",
      ),
    ).toBe("https://api.example.com/h");
  });

  it("hides the value of credential-looking query parameters only", () => {
    const masked = maskMonitorUrl(
      "https://api.example.com/h?region=us&api_key=key-fixture&X-Auth-Token=tok-fixture&access%5Ftoken=t2-fixture",
    );
    expect(masked).toBe(
      "https://api.example.com/h?region=us&api_key=***&X-Auth-Token=***&access_token=***",
    );
  });

  it("leaves a URL without secrets as it is", () => {
    expect(maskMonitorUrl("https://api.example.com/health?region=us")).toBe(
      "https://api.example.com/health?region=us",
    );
  });

  it("returns null for a URL it cannot read", () => {
    expect(maskMonitorUrl("not a url")).toBeNull();
  });
});

describe("monitorForCaller", () => {
  const stored = monitor({
    url: "https://api.example.com/h?api_key=key-fixture",
    requestHeaders: {
      Authorization: "Bearer bearer-fixture",
      Accept: "application/json",
    },
    requestBody: '{"token":"body-fixture"}',
    slackWebhookUrl: "https://hooks.example.test/services/T0/B0/slack-fixture",
    webhookUrl: "https://hooks.example.test/generic/webhook-fixture",
  });

  it("gives the signed-in UI the stored monitor, since its edit form saves it back", () => {
    expect(monitorForCaller(stored, "frontend")).toBe(stored);
  });

  it.each(["tool", "mcp", "webmcp", "a2a", "http", "cli", undefined] as const)(
    "gives a %s caller no header values, body or webhook URLs",
    (caller) => {
      const projected = monitorForCaller(stored, caller);
      const text = JSON.stringify(projected);
      for (const secret of [
        "key-fixture",
        "bearer-fixture",
        "body-fixture",
        "slack-fixture",
        "webhook-fixture",
      ]) {
        expect(text).not.toContain(secret);
      }
      expect(projected).not.toHaveProperty("requestHeaders");
      expect(projected).not.toHaveProperty("requestBody");
      expect(projected).toMatchObject({
        id: "m1",
        url: "https://api.example.com/h?api_key=***",
        hasAuthHeader: true,
        hasRequestBody: true,
        slackWebhookUrl: "https://hooks.example.test/***",
        webhookUrl: "https://hooks.example.test/***",
      });
    },
  );

  it("reports no auth header or body when none is stored", () => {
    expect(
      monitorForCaller(
        monitor({ requestHeaders: { Accept: "application/json" } }),
        "tool",
      ),
    ).toMatchObject({
      hasAuthHeader: false,
      hasRequestBody: false,
      slackWebhookUrl: null,
      webhookUrl: null,
    });
  });
});

describe("monitorForCaller and check errors", () => {
  const url = "https://api.example.com/h?api_key=key-fixture";
  const lastError = `SSRF blocked: refusing to fetch private/internal address (${url})`;

  it("masks the monitor URL inside the last error for callers other than the UI", () => {
    const projected = monitorForCaller(monitor({ url, lastError }), "tool");

    expect(projected.lastError).toBe(
      "SSRF blocked: refusing to fetch private/internal address (https://api.example.com/h?api_key=***)",
    );
    expect(JSON.stringify(projected)).not.toContain("key-fixture");
  });

  it("masks every occurrence of the URL", () => {
    const projected = monitorForCaller(
      monitor({ url, lastError: `${url} then ${url}` }),
      "mcp",
    );

    expect(projected.lastError).toBe(
      "https://api.example.com/h?api_key=*** then https://api.example.com/h?api_key=***",
    );
  });

  it("gives the signed-in UI the last error as stored", () => {
    const stored = monitor({ url, lastError });

    expect(monitorForCaller(stored, "frontend").lastError).toBe(lastError);
  });

  it("leaves an error that does not quote the URL, and a missing one, alone", () => {
    expect(
      monitorForCaller(
        monitor({ url, lastError: "Timed out after 5000ms" }),
        "a2a",
      ).lastError,
    ).toBe("Timed out after 5000ms");
    expect(
      monitorForCaller(monitor({ url, lastError: null }), "a2a").lastError,
    ).toBeNull();
  });

  it("swaps a URL it cannot read for the placeholder inside the error", () => {
    const projected = monitorForCaller(
      monitor({ url: "not a url", lastError: "bad address (not a url)" }),
      "tool",
    );

    expect(projected.lastError).toBe("bad address ([unreadable URL])");
  });
});
