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

let fetchMock: ReturnType<typeof vi.fn>;

function okResponse() {
  return { ok: true, status: 200, body: null } as unknown as Response;
}

async function loadWebhookChannel(): Promise<NotificationChannel | undefined> {
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
  const { registerBuiltinNotificationChannels } = await import("./channels.js");
  registerBuiltinNotificationChannels();
  return registered.find((c) => c.name === "webhook");
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
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
  delete process.env.NOTIFICATIONS_WEBHOOK_URL;
  delete process.env.NOTIFICATIONS_WEBHOOK_AUTH;
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
