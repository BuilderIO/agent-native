import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NotificationChannel } from "./types.js";

// Each test imports channels.js fresh (vi.resetModules) so the module-level
// `_registered` guard re-runs and the channel closure captures the current
// NOTIFICATIONS_WEBHOOK_URL / _AUTH env. We capture the registered channel,
// then drive its deliver() directly to exercise the real webhook logic: key-
// reference resolution, URL allowlist enforcement, auth header, POST body, and
// non-ok handling.

const resolveKeyReferences = vi.fn();
const validateUrlAllowlist = vi.fn();
const getKeyAllowlist = vi.fn();
const sendEmail = vi.fn();

let fetchMock: ReturnType<typeof vi.fn>;

function okResponse() {
  return { ok: true, status: 200, body: null } as unknown as Response;
}

async function loadWebhookChannel(): Promise<NotificationChannel | undefined> {
  const channels = await loadChannels();
  return channels.find((c) => c.name === "webhook");
}

async function loadChannels(): Promise<NotificationChannel[]> {
  vi.resetModules();
  const registered: NotificationChannel[] = [];
  vi.doMock("./registry.js", () => ({
    registerNotificationChannel: (channel: NotificationChannel) => {
      registered.push(channel);
    },
  }));
  vi.doMock("../secrets/substitution.js", () => ({
    resolveKeyReferences: (...args: unknown[]) => resolveKeyReferences(...args),
    validateUrlAllowlist: (...args: unknown[]) => validateUrlAllowlist(...args),
    getKeyAllowlist: (...args: unknown[]) => getKeyAllowlist(...args),
  }));
  vi.doMock("../extensions/url-safety.js", () => ({
    ssrfSafeFetch: (...args: unknown[]) => fetchMock(...args),
  }));
  vi.doMock("../server/email.js", () => ({
    sendEmail: (...args: unknown[]) => sendEmail(...args),
  }));
  const { registerBuiltinNotificationChannels } = await import("./channels.js");
  registerBuiltinNotificationChannels();
  return registered;
}

beforeEach(() => {
  process.env.NOTIFICATIONS_WEBHOOK_URL = "https://hooks.example.com/notify";
  delete process.env.NOTIFICATIONS_WEBHOOK_AUTH;
  fetchMock = vi.fn(async () => okResponse());
  vi.stubGlobal("fetch", fetchMock);
  resolveKeyReferences.mockImplementation(async (text: string) => ({
    resolved: text,
    usedKeys: [],
    secretValues: [],
  }));
  validateUrlAllowlist.mockReturnValue(true);
  getKeyAllowlist.mockResolvedValue(null);
  sendEmail.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
  delete process.env.NOTIFICATIONS_WEBHOOK_URL;
  delete process.env.NOTIFICATIONS_WEBHOOK_AUTH;
  delete process.env.NOTIFICATIONS_SLACK_WEBHOOK_URL;
  delete process.env.NOTIFICATIONS_SLACK_WEBHOOK_AUTH;
  delete process.env.NOTIFICATIONS_EMAIL_RECIPIENTS;
  delete process.env.NOTIFICATIONS_EMAIL_CHANNEL;
});

describe("webhook notification channel", () => {
  it("is not registered when NOTIFICATIONS_WEBHOOK_URL is unset", async () => {
    delete process.env.NOTIFICATIONS_WEBHOOK_URL;
    await expect(loadWebhookChannel()).resolves.toBeUndefined();
  });

  it("POSTs the notification payload as JSON scoped to the owner", async () => {
    const channel = (await loadWebhookChannel())!;
    await channel.deliver(
      {
        severity: "critical",
        title: "DB offline",
        body: "primary down",
        metadata: { region: "us-east" },
      },
      { owner: "alice@example.com" },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://hooks.example.com/notify");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    const payload = JSON.parse(init.body);
    expect(payload).toMatchObject({
      severity: "critical",
      title: "DB offline",
      body: "primary down",
      metadata: { region: "us-east" },
      owner: "alice@example.com",
    });
    expect(typeof payload.emittedAt).toBe("string");
    // No Authorization header when NOTIFICATIONS_WEBHOOK_AUTH is unset.
    expect(init.headers.Authorization).toBeUndefined();
  });

  it("resolves an Authorization header from NOTIFICATIONS_WEBHOOK_AUTH", async () => {
    process.env.NOTIFICATIONS_WEBHOOK_AUTH = "Bearer ${keys.HOOK_TOKEN}";
    resolveKeyReferences.mockImplementation(async (text: string) => ({
      resolved: text.includes("HOOK_TOKEN") ? "Bearer secret-xyz" : text,
      usedKeys: [],
      secretValues: [],
    }));
    const channel = (await loadWebhookChannel())!;

    await channel.deliver(
      { severity: "info", title: "Hi" },
      { owner: "alice@example.com" },
    );

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer secret-xyz");
  });

  it("enforces the per-key URL allowlist and never POSTs a disallowed origin", async () => {
    process.env.NOTIFICATIONS_WEBHOOK_URL = "${keys.HOOK_URL}";
    resolveKeyReferences.mockImplementation(async () => ({
      resolved: "https://evil.example.com/steal",
      usedKeys: ["HOOK_URL"],
      secretValues: [],
    }));
    getKeyAllowlist.mockResolvedValue(["https://hooks.example.com"]);
    validateUrlAllowlist.mockReturnValue(false);

    const channel = (await loadWebhookChannel())!;

    await expect(
      channel.deliver(
        { severity: "critical", title: "x" },
        { owner: "alice@example.com" },
      ),
    ).rejects.toThrow(/not in the allowlist/i);

    // Critically, the disallowed request must never be sent.
    expect(fetchMock).not.toHaveBeenCalled();
    // The allowlist was looked up for the referenced key, scoped to the owner.
    expect(getKeyAllowlist).toHaveBeenCalledWith(
      "HOOK_URL",
      "user",
      "alice@example.com",
    );
  });

  it("delivers when the resolved URL satisfies the allowlist", async () => {
    process.env.NOTIFICATIONS_WEBHOOK_URL = "${keys.HOOK_URL}";
    resolveKeyReferences.mockImplementation(async () => ({
      resolved: "https://hooks.example.com/notify",
      usedKeys: ["HOOK_URL"],
      secretValues: [],
    }));
    getKeyAllowlist.mockResolvedValue(["https://hooks.example.com"]);
    validateUrlAllowlist.mockReturnValue(true);

    const channel = (await loadWebhookChannel())!;
    await channel.deliver(
      { severity: "info", title: "ok" },
      { owner: "alice@example.com" },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws with the status when the webhook responds non-ok", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      body: null,
    } as unknown as Response);

    const channel = (await loadWebhookChannel())!;
    await expect(
      channel.deliver(
        { severity: "warning", title: "x" },
        { owner: "alice@example.com" },
      ),
    ).rejects.toThrow(/503/);
  });

  it("appends a body snippet to the error when the failing response has a body", async () => {
    let cancelled = false;
    const chunk = new TextEncoder().encode("upstream rejected: bad token");
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      body: {
        getReader() {
          let sent = false;
          return {
            async read() {
              if (sent) return { value: undefined, done: true };
              sent = true;
              return { value: chunk, done: false };
            },
            async cancel() {
              cancelled = true;
            },
          };
        },
      },
    } as unknown as Response);

    const channel = (await loadWebhookChannel())!;
    await expect(
      channel.deliver(
        { severity: "critical", title: "x" },
        { owner: "alice@example.com" },
      ),
    ).rejects.toThrow(/401: upstream rejected: bad token/);
    // The reader is drained then released rather than left open.
    expect(cancelled).toBe(true);
  });
});

describe("Slack notification channel", () => {
  it("is registered from NOTIFICATIONS_SLACK_WEBHOOK_URL and posts Slack JSON", async () => {
    process.env.NOTIFICATIONS_SLACK_WEBHOOK_URL =
      "https://hooks.slack.example.com/services/T/B/C";
    const channels = await loadChannels();
    const channel = channels.find((c) => c.name === "slack")!;

    await channel.deliver(
      {
        severity: "critical",
        title: "Clip uploads failing",
        body: "8 failures in 10 minutes",
        metadata: { ruleId: "alert_1" },
      },
      { owner: "alice@example.com" },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://hooks.slack.example.com/services/T/B/C");
    expect(init.method).toBe("POST");
    const payload = JSON.parse(init.body);
    expect(payload.text).toContain("[critical] Clip uploads failing");
    expect(payload.blocks[0].text.text).toBe("*Clip uploads failing*");
  });
});

describe("email notification channel", () => {
  it("sends to metadata recipients and environment fallback recipients once each", async () => {
    process.env.NOTIFICATIONS_EMAIL_CHANNEL = "1";
    process.env.NOTIFICATIONS_EMAIL_RECIPIENTS =
      "ops@example.com, Alice@Example.com";
    const channels = await loadChannels();
    const channel = channels.find((c) => c.name === "email")!;

    await channel.deliver(
      {
        severity: "warning",
        title: "Error spike",
        body: "More failures than expected",
        metadata: {
          emailRecipients: ["alice@example.com", "alerts@example.com"],
          emailSubject: "Custom subject",
          ruleId: "rule_1",
        },
      },
      { owner: "alice@example.com" },
    );

    expect(sendEmail).toHaveBeenCalledTimes(3);
    expect(sendEmail.mock.calls.map(([args]) => args.to).sort()).toEqual([
      "alerts@example.com",
      "alice@example.com",
      "ops@example.com",
    ]);
    expect(sendEmail.mock.calls[0][0].subject).toBe("Custom subject");
    expect(sendEmail.mock.calls[0][0].text).toContain('"ruleId": "rule_1"');
    expect(sendEmail.mock.calls[0][0].text).not.toContain("emailRecipients");
  });

  it("does nothing when email has no recipients", async () => {
    process.env.NOTIFICATIONS_EMAIL_CHANNEL = "1";
    const channels = await loadChannels();
    const channel = channels.find((c) => c.name === "email")!;

    await channel.deliver(
      { severity: "info", title: "FYI" },
      { owner: "alice@example.com" },
    );

    expect(sendEmail).not.toHaveBeenCalled();
  });
});
