import { afterEach, describe, expect, it, vi } from "vitest";

const OWNER = "owner@example.com";
const ACCOUNT = "inbox@example.com";
const LIST_URL = "https://gmail.googleapis.com/gmail/v1/users/me/threads";

function json(status: number, body: unknown, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("Gmail cooldown across serverless instances (PGlite)", () => {
  afterEach(async () => {
    const { closeDbExec } = await import("@agent-native/core/db");
    await closeDbExec();
    Reflect.deleteProperty(globalThis as object, "__agentNativePgliteClients");
    Reflect.deleteProperty(
      globalThis as object,
      "__agentNativePgliteProcessLocks",
    );
    Reflect.deleteProperty(
      globalThis as object,
      "__agentNativePgliteProcessExitCleanupRegistered",
    );
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.resetModules();
  });

  it("makes one Gmail 429 a persisted value every instance and tool call sees, with no Gmail traffic until it ends", async () => {
    vi.stubEnv("DATABASE_URL", "pglite:memory");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T12:00:00.000Z"));

    const { default: initializeMailDb } = await import("../plugins/db.js");
    await initializeMailDb({});

    // Instance A obtains the token and is the one Gmail rate-limits.
    const instanceA = await import("./google-api.js");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json(
          429,
          { error: { message: "rateLimitExceeded" } },
          {
            "retry-after": "30",
          },
        ),
      )
      .mockResolvedValue(json(200, { threads: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await instanceA.registerGmailAccountToken("fake-token-a", OWNER, ACCOUNT);

    const tripped = await instanceA
      .googleFetch(LIST_URL, "fake-token-a")
      .catch((error: unknown) => error);
    expect(tripped).toBeInstanceOf(instanceA.GmailQuotaCooldownError);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Instance B never saw the token. It resolves it from the shared table and
    // refuses locally, with the same typed error, without touching Gmail.
    vi.resetModules();
    const instanceB = await import("./google-api.js");
    const quotaB = await import("./gmail-quota.js");
    expect(instanceB.GmailQuotaCooldownError).not.toBe(
      instanceA.GmailQuotaCooldownError,
    );
    for (let call = 0; call < 3; call++) {
      const refused = await instanceB
        .googleFetch(LIST_URL, "fake-token-a")
        .catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(instanceB.GmailQuotaCooldownError);
      expect(refused).toMatchObject({
        errorCode: "gmail_quota_cooldown",
        statusCode: 429,
        details: { retryAfterMs: expect.any(Number) },
      });
    }
    // The tool-level pre-check answers from the same persisted state.
    const preCheck = await quotaB
      .assertGmailNotCoolingDown([ACCOUNT])
      .catch((error: unknown) => error);
    expect(preCheck).toBeInstanceOf(quotaB.GmailQuotaCooldownError);
    const cooling = await quotaB.readOwnerGmailCooldowns(OWNER);
    const until = cooling.get(ACCOUNT);
    expect(until).toBeGreaterThan(Date.now());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Once the window passes the next call reaches Gmail and clears the state.
    vi.setSystemTime(new Date(until! + 1_000));
    await expect(
      instanceB.googleFetch(LIST_URL, "fake-token-a"),
    ).resolves.toEqual({ threads: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(
      quotaB.assertGmailNotCoolingDown([ACCOUNT]),
    ).resolves.toBeUndefined();
    expect((await quotaB.readOwnerGmailCooldowns(OWNER)).size).toBe(0);
  }, 30_000);
});
