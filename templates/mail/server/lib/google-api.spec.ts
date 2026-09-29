import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const quotaState = vi.hoisted(() => ({
  rows: new Map<string, any>(),
  clearCalls: 0,
  failClear: false,
}));

vi.mock("./inbox-store.js", () => ({
  reserveGmailQuota: async (
    ownerEmail: string,
    accountEmail: string,
    units: number,
    lane: string,
    now = Date.now(),
  ) => {
    const key = accountEmail.toLowerCase();
    let row = quotaState.rows.get(key);
    if (!row) {
      row = { windowStartedAt: now, units: 0, background: 0, backfill: 0 };
      quotaState.rows.set(key, row);
    }
    if (row.cooldownUntil > now) {
      return {
        retryAfterMs: row.cooldownUntil - now,
        quotaCooldownAttempts: row.attempts ?? 0,
      };
    }
    if (now >= row.windowStartedAt + 60_000) {
      row.windowStartedAt = now;
      row.units = 0;
      row.background = 0;
      row.backfill = 0;
    }
    if (
      row.units + units > 6_000 ||
      (lane !== "interactive" && row.background + units > 3_000) ||
      (lane === "backfill" && row.backfill + units > 2_000)
    ) {
      return {
        retryAfterMs: Math.max(1, row.windowStartedAt + 60_000 - now),
        quotaCooldownAttempts: row.attempts ?? 0,
      };
    }
    row.units += units;
    if (lane !== "interactive") row.background += units;
    if (lane === "backfill") row.backfill += units;
    return {
      retryAfterMs: 0,
      quotaCooldownAttempts: row.attempts ?? 0,
    };
  },
  recordGmailQuotaCooldown: async (
    ownerEmail: string,
    accountEmail: string,
    retryAfterMs: number | undefined,
    now = Date.now(),
  ) => {
    const key = accountEmail.toLowerCase();
    const row = quotaState.rows.get(key) ?? {
      windowStartedAt: now,
      units: 0,
      background: 0,
      backfill: 0,
    };
    const exponential = Math.min(60_000, 1_000 * 2 ** (row.attempts ?? 0));
    const remainingWindow = Math.max(1, row.windowStartedAt + 60_000 - now);
    row.cooldownUntil = Math.max(
      row.cooldownUntil ?? 0,
      now + Math.max(retryAfterMs ?? 0, remainingWindow) + exponential,
    );
    row.attempts = (row.attempts ?? 0) + 1;
    quotaState.rows.set(key, row);
    return row.cooldownUntil - now;
  },
  clearGmailQuotaCooldownAfterSuccess: async (
    accountEmail: string,
    now = Date.now(),
  ) => {
    quotaState.clearCalls++;
    if (quotaState.failClear) throw new Error("quota storage unavailable");
    const key = accountEmail.toLowerCase();
    const row = quotaState.rows.get(key);
    if (row && (row.cooldownUntil ?? 0) <= now) {
      row.cooldownUntil = 0;
      row.attempts = 0;
    }
  },
}));

import {
  GmailQuotaCooldownError,
  createOAuth2Client,
  gmailBatchGetMessages,
  estimateRequestCost,
  googleFetch,
  registerGmailAccountToken,
} from "./google-api.js";

function jsonResponse(status: number, body: unknown, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("googleFetch quota handling", () => {
  beforeEach(() => {
    quotaState.rows.clear();
    quotaState.clearCalls = 0;
    quotaState.failClear = false;
    for (const token of [
      "gateway-token-a",
      "gateway-token-b",
      "gateway-token-c",
      "quota-token-a",
      "quota-token-floor",
      "quota-token-cap",
      "quota-token-whole-batch",
      "quota-token-b",
      "chunk-token-c",
      "shared-token-a",
      "shared-token-b",
      "streak-token-a",
      "streak-token-b",
      "streak-token-c",
      "shared-owner-token",
    ]) {
      registerGmailAccountToken(
        token,
        `${token}@example.com`,
        "account@example.com",
      );
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("retries transient Gmail gateway failures", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(502, { error: { message: "bad gateway" } }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { messages: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = googleFetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages",
      "gateway-token-a",
    );
    await vi.advanceTimersByTimeAsync(1000);

    await expect(resultPromise).resolves.toEqual({ messages: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(quotaState.rows.get("account@example.com")?.units).toBe(10);
    expect(quotaState.clearCalls).toBe(0);
  });

  it("does not replay state-changing requests after a gateway failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(502, { error: { message: "bad gateway" } }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { id: "sent-message" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      googleFetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        "gateway-token-b",
        {
          method: "POST",
          body: JSON.stringify({ raw: "message" }),
        },
      ),
    ).rejects.toThrow("Google API error (502): bad gateway");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves a successful Gmail mutation when quota cleanup fails", async () => {
    quotaState.rows.set("account@example.com", {
      windowStartedAt: Date.now(),
      units: 0,
      background: 0,
      backfill: 0,
      attempts: 1,
    });
    quotaState.failClear = true;
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { id: "sent-message" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      googleFetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        "gateway-token-a",
        {
          method: "POST",
          body: JSON.stringify({ raw: "message" }),
        },
      ),
    ).resolves.toEqual({ id: "sent-message" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(quotaState.clearCalls).toBe(1);
    expect(warning).toHaveBeenCalledWith(
      "[google-api] Failed to clear Gmail quota cooldown after success:",
      expect.any(Error),
    );
    warning.mockRestore();
  });

  it("preserves the final 503 error body after read retries are exhausted", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(503, { error: { message: "backend overloaded" } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = googleFetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages",
      "gateway-token-c",
    );
    const rejection = expect(resultPromise).rejects.toThrow(
      "Google API error (503): backend overloaded",
    );
    await vi.advanceTimersByTimeAsync(7000);

    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("preserves the HTTP status when OAuth refresh returns a non-JSON error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("upstream unavailable", {
          status: 503,
          statusText: "Service Unavailable",
        }),
      ),
    );

    await expect(
      createOAuth2Client("client-id", "client-secret", "").refreshToken(
        "refresh-token",
      ),
    ).rejects.toMatchObject({
      message: "OAuth token refresh failed: Service Unavailable",
      status: 503,
    });
  });

  it("preserves the HTTP status and OAuth code for permanent refresh failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(400, { error: "invalid_scope" })),
    );

    await expect(
      createOAuth2Client("client-id", "client-secret", "").refreshToken(
        "refresh-token",
      ),
    ).rejects.toMatchObject({
      message: "OAuth token refresh failed: invalid_scope",
      status: 400,
    });
  });

  it("trips cooldown on the first quota response instead of retrying inside the exhausted window", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          429,
          { error: { message: "User-rate limit exceeded" } },
          { "retry-after": "120" },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      googleFetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages",
        "quota-token-a",
      ),
    ).rejects.toThrow(/about 121s/);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(
      googleFetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages",
        "quota-token-a",
      ),
    ).rejects.toBeInstanceOf(GmailQuotaCooldownError);

    await expect(
      googleFetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages",
        "quota-token-a",
      ),
    ).rejects.toThrow(/briefly busy/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("waits through the current quota window when Retry-After is shorter", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          429,
          { error: { message: "User-rate limit exceeded" } },
          { "retry-after": "30" },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    let caught: unknown;
    try {
      await googleFetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages",
        "quota-token-floor",
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(GmailQuotaCooldownError);
    expect(
      (caught as GmailQuotaCooldownError).retryAfterMs,
    ).toBeGreaterThanOrEqual(60_000);
    expect((caught as Error).message).toMatch(/about 61s/);
    expect((caught as Error).message).not.toContain("Ask the user");
    expect(caught).toMatchObject({
      statusCode: 429,
      errorCode: "gmail_quota_cooldown",
      details: { retryAfterSeconds: 61 },
    });
  });

  it("honors a long provider Retry-After without truncating it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          429,
          { error: { message: "User-rate limit exceeded" } },
          { "retry-after": "600" },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    let caught: unknown;
    try {
      await googleFetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages",
        "quota-token-cap",
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(GmailQuotaCooldownError);
    expect(
      (caught as GmailQuotaCooldownError).retryAfterMs,
    ).toBeGreaterThanOrEqual(600_000);
    expect((caught as Error).message).toMatch(/about 601s/);
  });

  it("classifies a whole-batch HTTP 429 as a typed cooldown error, not raw batch-failure text", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          429,
          { error: { message: "User-rate limit exceeded" } },
          { "retry-after": "30" },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const rejection = gmailBatchGetMessages(
      "quota-token-whole-batch",
      ["msg-1"],
      "metadata",
    );
    await expect(rejection).rejects.toBeInstanceOf(GmailQuotaCooldownError);
    await expect(rejection).rejects.toThrow(/about 61s/);
  });

  it("treats quota failures inside Gmail batch parts as a whole-call cooldown", async () => {
    const boundary = "batch_test";
    const body = [
      `--${boundary}`,
      "Content-Type: application/http",
      "Content-ID: <response-part-0>",
      "",
      "HTTP/1.1 429 Too Many Requests",
      "Content-Type: application/json",
      "",
      JSON.stringify({ error: { message: "User-rate limit exceeded" } }),
      `--${boundary}--`,
      "",
    ].join("\r\n");

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { "content-type": `multipart/mixed; boundary=${boundary}` },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      gmailBatchGetMessages("quota-token-b", ["msg-1"], "metadata"),
    ).rejects.toThrow(/briefly busy/);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(
      gmailBatchGetMessages("quota-token-b", ["msg-2"], "metadata"),
    ).rejects.toThrow(/briefly busy/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("splits large Gmail batches by quota cost instead of sending one burst", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const requestBody = String(init?.body || "");
      const partCount = (requestBody.match(/Content-ID: <part-/g) || []).length;
      const boundary = "batch_chunked";
      const parts = Array.from({ length: partCount }, (_, i) =>
        [
          `--${boundary}`,
          "Content-Type: application/http",
          `Content-ID: <response-part-${i}>`,
          "",
          "HTTP/1.1 200 OK",
          "Content-Type: application/json",
          "",
          JSON.stringify({ id: `message-${i}` }),
        ].join("\r\n"),
      );
      const body = [...parts, `--${boundary}--`, ""].join("\r\n");
      return new Response(body, {
        status: 200,
        headers: { "content-type": `multipart/mixed; boundary=${boundary}` },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const ids = Array.from({ length: 137 }, (_, i) => `msg-${i}`);
    const result = await gmailBatchGetMessages(
      "chunk-token-c",
      ids,
      "metadata",
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(137);
  });

  it("charges the published Gmail unit costs", () => {
    expect(
      estimateRequestCost(
        "https://gmail.googleapis.com/gmail/v1/users/me/threads/t1?format=full",
        "GET",
      ),
    ).toBe(40);
    expect(
      estimateRequestCost(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/m1?format=metadata",
        "GET",
      ),
    ).toBe(20);
    expect(
      estimateRequestCost(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/batchModify",
        "POST",
      ),
    ).toBe(50);
    expect(
      estimateRequestCost(
        "https://gmail.googleapis.com/gmail/v1/users/me/labels",
        "GET",
      ),
    ).toBe(1);
    expect(
      estimateRequestCost(
        "https://gmail.googleapis.com/gmail/v1/users/me/labels/INBOX",
        "GET",
      ),
    ).toBe(1);
    expect(
      estimateRequestCost(
        "https://gmail.googleapis.com/gmail/v1/users/me/profile",
        "GET",
      ),
    ).toBe(1);
    expect(
      estimateRequestCost(
        "https://gmail.googleapis.com/gmail/v1/users/me/threads",
        "GET",
      ),
    ).toBe(10);
    expect(
      estimateRequestCost(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages",
        "GET",
      ),
    ).toBe(5);
    expect(
      estimateRequestCost(
        "https://gmail.googleapis.com/gmail/v1/users/me/history",
        "GET",
      ),
    ).toBe(2);
    expect(
      estimateRequestCost(
        "https://gmail.googleapis.com/gmail/v1/users/me/threads/t1/modify",
        "POST",
      ),
    ).toBe(10);
    expect(
      estimateRequestCost(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/m1/modify",
        "POST",
      ),
    ).toBe(5);
    expect(
      estimateRequestCost(
        "https://gmail.googleapis.com/gmail/v1/users/me/watch",
        "POST",
      ),
    ).toBe(100);
  });

  it("shares one account cooldown across refreshed tokens", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(429, { error: { message: "User-rate limit exceeded" } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      googleFetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages",
        "shared-token-a",
      ),
    ).rejects.toBeInstanceOf(GmailQuotaCooldownError);

    registerGmailAccountToken(
      "shared-owner-token",
      "different-owner@example.com",
      "account@example.com",
    );
    await expect(
      googleFetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages",
        "shared-owner-token",
      ),
    ).rejects.toBeInstanceOf(GmailQuotaCooldownError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the previous token mapped until its own expiry after rotation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(429, { error: { message: "User-rate limit exceeded" } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    registerGmailAccountToken(
      "rotating-token-old",
      "owner@example.com",
      "rotating@example.com",
    );

    await expect(
      googleFetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages",
        "rotating-token-old",
      ),
    ).rejects.toBeInstanceOf(GmailQuotaCooldownError);

    registerGmailAccountToken(
      "rotating-token-new",
      "owner@example.com",
      "rotating@example.com",
    );

    await expect(
      googleFetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages",
        "rotating-token-old",
      ),
    ).rejects.toBeInstanceOf(GmailQuotaCooldownError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caps concurrent requests from two clients at one shared 6,000-unit budget", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-28T12:00:00.000Z"));
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const ids = [
        ...String(init?.body ?? "").matchAll(
          /GET \/gmail\/v1\/users\/me\/messages\/([^?\r\n]+)/g,
        ),
      ].map((match) => decodeURIComponent(match[1] ?? ""));
      const boundary = "batch_shared_budget";
      const parts = ids.map((id, index) =>
        [
          `--${boundary}`,
          "Content-Type: application/http",
          `Content-ID: <response-part-${index}>`,
          "",
          "HTTP/1.1 200 OK",
          "Content-Type: application/json",
          "",
          JSON.stringify({ id }),
        ].join("\r\n"),
      );
      return new Response([...parts, `--${boundary}--`, ""].join("\r\n"), {
        status: 200,
        headers: { "content-type": `multipart/mixed; boundary=${boundary}` },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    registerGmailAccountToken(
      "shared-owner-token",
      "different-owner@example.com",
      "account@example.com",
    );
    const ids = Array.from({ length: 50 }, (_, i) => `shared-${i}`);

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, index) =>
        gmailBatchGetMessages(
          index % 2 === 0 ? "shared-token-a" : "shared-owner-token",
          ids,
          "metadata",
        ),
      ),
    );
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(6);
    expect(rejected).toHaveLength(4);
    expect(
      rejected.every(
        (result) =>
          result.status === "rejected" &&
          result.reason instanceof GmailQuotaCooldownError,
      ),
    ).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("increases consecutive 429 cooldowns and carries each through its quota window", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse(429, { error: { message: "User-rate limit exceeded" } }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const cooldowns: number[] = [];
    for (const token of [
      "streak-token-a",
      "streak-token-b",
      "streak-token-c",
    ]) {
      try {
        await googleFetch(
          "https://gmail.googleapis.com/gmail/v1/users/me/messages",
          token,
        );
      } catch (error) {
        expect(error).toBeInstanceOf(GmailQuotaCooldownError);
        const cooldownMs = (error as GmailQuotaCooldownError).retryAfterMs;
        cooldowns.push(cooldownMs);
        const row = quotaState.rows.get("account@example.com");
        expect(cooldownMs).toBeGreaterThanOrEqual(
          Math.max(1, row.windowStartedAt + 60_000 - Date.now()),
        );
        if (token !== "streak-token-c") {
          await vi.advanceTimersByTimeAsync(cooldownMs);
        }
      }
    }

    expect(cooldowns[0]).toBeLessThan(cooldowns[1]);
    expect(cooldowns[1]).toBeLessThan(cooldowns[2]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("clears the shared 429 streak only after a successful request", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() =>
        Promise.resolve(
          jsonResponse(429, { error: { message: "User-rate limit exceeded" } }),
        ),
      )
      .mockImplementation(() => Promise.resolve(jsonResponse(200, {})));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      googleFetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages",
        "streak-token-a",
      ),
    ).rejects.toBeInstanceOf(GmailQuotaCooldownError);
    expect(quotaState.clearCalls).toBe(0);

    await vi.advanceTimersByTimeAsync(61_001);
    await googleFetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages",
      "streak-token-b",
    );

    expect(quotaState.clearCalls).toBe(1);
    expect(quotaState.rows.get("account@example.com").attempts).toBe(0);
  });
});
