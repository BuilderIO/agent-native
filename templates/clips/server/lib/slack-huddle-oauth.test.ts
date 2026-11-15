import { createHash } from "node:crypto";

import { mockEvent } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  encodeOAuthState: vi.fn(),
  getSession: vi.fn(),
  exchangeSlackOAuthCode: vi.fn(),
  readAppSecret: vi.fn(),
  writeAppSecret: vi.fn(),
  deleteAppSecret: vi.fn(),
  inserted: [] as unknown[],
  updates: [] as unknown[],
  connectionRow: null as Record<string, unknown> | null,
}));

vi.mock("@agent-native/core/server", () => ({
  encodeOAuthState: (payload: unknown) => mocks.encodeOAuthState(payload),
  getSession: (...args: unknown[]) => mocks.getSession(...args),
  isElectron: () => false,
  oauthCallbackResponse: () => new Response("connected"),
  oauthErrorPage: (message: string) => new Response(message, { status: 400 }),
  resolveOAuthRedirectUri: () =>
    "https://clips.example.test/api/slack/oauth/callback",
  safeReturnPath: (value: string | undefined) => value || "/",
}));

vi.mock("@agent-native/core/integrations", () => ({
  exchangeSlackOAuthCode: (...args: unknown[]) =>
    mocks.exchangeSlackOAuthCode(...args),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  runWithRequestContext: (_ctx: unknown, fn: () => unknown) => fn(),
}));

vi.mock("@agent-native/core/secrets", () => ({
  readAppSecret: (...args: unknown[]) => mocks.readAppSecret(...args),
  writeAppSecret: (...args: unknown[]) => mocks.writeAppSecret(...args),
  deleteAppSecret: (...args: unknown[]) => mocks.deleteAppSecret(...args),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: vi.fn(),
}));

vi.mock("./meeting-participant-shares.js", () => ({
  shareStoppedMeetingWithHuddleParticipants: vi.fn(),
}));

vi.mock("./recordings.js", () => ({
  getActiveOrganizationId: async () => null,
  sameOwnerEmail: (a?: string | null, b?: string | null) =>
    !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase(),
}));

vi.mock("../db/index.js", () => {
  const chain = (result: () => unknown) => {
    const proxy: Record<string, unknown> = {};
    for (const name of [
      "from",
      "where",
      "limit",
      "set",
      "onConflictDoUpdate",
    ]) {
      proxy[name] = () => proxy;
    }
    proxy.then = (resolve: (value: unknown) => unknown) => resolve(result());
    return proxy;
  };
  return {
    getDb: () => ({
      select: () =>
        chain(() => (mocks.connectionRow ? [mocks.connectionRow] : [])),
      insert: () => ({
        values: (values: unknown) => {
          mocks.inserted.push(values);
          return chain(() => undefined);
        },
      }),
      update: () => ({
        set: (values: unknown) => {
          mocks.updates.push(values);
          return chain(() => undefined);
        },
      }),
    }),
    schema: {
      slackUserConnections: new Proxy({}, { get: (_t, key) => String(key) }),
    },
  };
});

import {
  buildSlackHuddlesInstallUrl,
  CLIPS_SLACK_HUDDLES_OAUTH_APP_ID,
  disconnectSlackHuddleConnection,
  handleSlackHuddlesOAuthCallback,
  readConnectionToken,
  SLACK_HUDDLES_OAUTH_COOKIE,
} from "./slack-huddle-oauth.js";
import { SlackTokenError } from "./slack-huddles.js";

/** Shaped like core's AppSecretDecryptionError (not exported by core). */
function decryptionError(): Error {
  return Object.assign(
    new Error("A saved connection could not be decrypted."),
    {
      name: "AppSecretDecryptionError",
      errorCode: "app_secret_unreadable",
    },
  );
}

const OWNER = "nevil@example.test";
const BASE = "https://clips.example.test";

function hash(nonce: string): string {
  return createHash("sha256").update(nonce).digest("base64url");
}

function callbackEvent(cookieNonce?: string) {
  return mockEvent(`${BASE}/api/slack/oauth/callback?code=temp-code&state=s`, {
    headers: cookieNonce
      ? { cookie: `${SLACK_HUDDLES_OAUTH_COOKIE}=${cookieNonce}` }
      : {},
  });
}

function stateFor(nonce: string, owner = OWNER) {
  return {
    redirectUri: `${BASE}/api/slack/oauth/callback`,
    owner,
    addAccount: true,
    app: CLIPS_SLACK_HUDDLES_OAUTH_APP_ID,
    flowId: hash(nonce),
    returnUrl: "/settings",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inserted.length = 0;
  mocks.updates.length = 0;
  mocks.connectionRow = null;
  process.env.SLACK_CLIENT_ID = "client-id";
  process.env.SLACK_CLIENT_SECRET = "client-secret";
  mocks.exchangeSlackOAuthCode.mockResolvedValue({
    ok: true,
    team: { id: "T0TEAM", name: "Team" },
    authed_user: {
      id: "U0OWNER",
      access_token: "xoxp-user",
      scope: "users:read",
    },
  });
});

describe("Connect Slack for huddles: start", () => {
  it("binds the flow to this browser with an httpOnly nonce cookie and its hash in the state", async () => {
    mocks.getSession.mockResolvedValue({ email: OWNER });
    mocks.encodeOAuthState.mockReturnValue("signed-state");
    const event = mockEvent(`${BASE}/api/slack/huddles/install?redirect=1`);

    const url = await buildSlackHuddlesInstallUrl(event);

    expect(typeof url).toBe("string");
    const cookie = event.res.headers.getSetCookie().join("; ");
    const nonce = new RegExp(`${SLACK_HUDDLES_OAUTH_COOKIE}=([^;]+)`).exec(
      cookie,
    )?.[1];
    expect(nonce).toBeTruthy();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(mocks.encodeOAuthState).toHaveBeenCalledWith(
      expect.objectContaining({ owner: OWNER, flowId: hash(nonce!) }),
    );
  });
});

describe("Connect Slack for huddles: callback", () => {
  it("rejects a callback without a Clips session, even with the owner in the state", async () => {
    mocks.getSession.mockResolvedValue(null);
    const response = (await handleSlackHuddlesOAuthCallback(
      callbackEvent("nonce-1"),
      stateFor("nonce-1"),
    )) as Response;
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/Sign in to Clips/);
    expect(mocks.exchangeSlackOAuthCode).not.toHaveBeenCalled();
    expect(mocks.writeAppSecret).not.toHaveBeenCalled();
  });

  it("rejects a callback signed in as someone else", async () => {
    mocks.getSession.mockResolvedValue({ email: "victim@example.test" });
    const response = (await handleSlackHuddlesOAuthCallback(
      callbackEvent("nonce-1"),
      stateFor("nonce-1"),
    )) as Response;
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/someone else/);
    expect(mocks.writeAppSecret).not.toHaveBeenCalled();
  });

  it("rejects a callback in a browser without the flow cookie", async () => {
    mocks.getSession.mockResolvedValue({ email: OWNER });
    const response = (await handleSlackHuddlesOAuthCallback(
      callbackEvent(),
      stateFor("nonce-1"),
    )) as Response;
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/another browser/);
    expect(mocks.exchangeSlackOAuthCode).not.toHaveBeenCalled();
  });

  it("rejects a callback whose cookie belongs to another flow", async () => {
    mocks.getSession.mockResolvedValue({ email: OWNER });
    const response = (await handleSlackHuddlesOAuthCallback(
      callbackEvent("nonce-other"),
      stateFor("nonce-1"),
    )) as Response;
    expect(response.status).toBe(400);
    expect(mocks.writeAppSecret).not.toHaveBeenCalled();
  });

  it("rejects a state without a flow binding", async () => {
    mocks.getSession.mockResolvedValue({ email: OWNER });
    const { flowId: _flowId, ...unbound } = stateFor("nonce-1");
    const response = (await handleSlackHuddlesOAuthCallback(
      callbackEvent("nonce-1"),
      unbound,
    )) as Response;
    expect(response.status).toBe(400);
    expect(mocks.writeAppSecret).not.toHaveBeenCalled();
  });

  it("stores the token for the signed-in owner in the browser that started it, and spends the cookie", async () => {
    mocks.getSession.mockResolvedValue({ email: "Nevil@Example.test" });
    const event = callbackEvent("nonce-1");
    const response = (await handleSlackHuddlesOAuthCallback(
      event,
      stateFor("nonce-1"),
    )) as Response;
    expect(response.status).toBe(200);
    expect(mocks.writeAppSecret).toHaveBeenCalledWith(
      expect.objectContaining({
        value: "xoxp-user",
        scope: "user",
        scopeId: "Nevil@Example.test",
      }),
    );
    expect(mocks.inserted).toEqual([
      expect.objectContaining({
        ownerEmail: "Nevil@Example.test",
        teamId: "T0TEAM",
        slackUserId: "U0OWNER",
      }),
    ]);
    expect(event.res.headers.getSetCookie().join("; ")).toMatch(
      new RegExp(`${SLACK_HUDDLES_OAUTH_COOKIE}=;.*Max-Age=0`, "i"),
    );
  });
});

describe("disconnectSlackHuddleConnection", () => {
  beforeEach(() => {
    mocks.connectionRow = {
      id: "conn-1",
      ownerEmail: OWNER,
      tokenSecretRef: "secret-ref",
    };
    mocks.readAppSecret.mockResolvedValue({ value: "xoxp-user" });
  });

  function slackAnswer(body: unknown, status = 200) {
    return vi.fn(async () => new Response(JSON.stringify(body), { status }));
  }

  it("keeps the token when Slack cannot be reached", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(
      disconnectSlackHuddleConnection({
        id: "conn-1",
        userEmail: OWNER,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/could not be reached.*kept/);
    expect(mocks.deleteAppSecret).not.toHaveBeenCalled();
    expect(mocks.updates).not.toContainEqual(
      expect.objectContaining({ status: "disconnected" }),
    );
  });

  it("keeps the token when Slack does not confirm the revoke", async () => {
    await expect(
      disconnectSlackHuddleConnection({
        id: "conn-1",
        userEmail: OWNER,
        fetchImpl: slackAnswer(
          { ok: false, error: "ratelimited" },
          429,
        ) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/ratelimited/);
    expect(mocks.deleteAppSecret).not.toHaveBeenCalled();
  });

  it("forgets the token once Slack revoked it", async () => {
    await expect(
      disconnectSlackHuddleConnection({
        id: "conn-1",
        userEmail: OWNER,
        fetchImpl: slackAnswer({
          ok: true,
          revoked: true,
        }) as unknown as typeof fetch,
      }),
    ).resolves.toBe(true);
    expect(mocks.deleteAppSecret).toHaveBeenCalledTimes(1);
    expect(mocks.updates).toContainEqual(
      expect.objectContaining({ status: "disconnected" }),
    );
  });

  it("forgets a token Slack no longer accepts", async () => {
    await expect(
      disconnectSlackHuddleConnection({
        id: "conn-1",
        userEmail: OWNER,
        fetchImpl: slackAnswer({
          ok: false,
          error: "token_revoked",
        }) as unknown as typeof fetch,
      }),
    ).resolves.toBe(true);
    expect(mocks.deleteAppSecret).toHaveBeenCalledTimes(1);
  });

  it("disconnects a token that can never be decrypted, without trying to revoke it", async () => {
    mocks.readAppSecret.mockRejectedValue(decryptionError());
    const fetchImpl = vi.fn();
    await expect(
      disconnectSlackHuddleConnection({
        id: "conn-1",
        userEmail: OWNER,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(mocks.deleteAppSecret).toHaveBeenCalledTimes(1);
    expect(mocks.updates).toContainEqual(
      expect.objectContaining({ status: "disconnected" }),
    );
  });

  it("keeps the connection when the token cannot be read right now", async () => {
    mocks.readAppSecret.mockRejectedValue(new Error("connection reset"));
    await expect(
      disconnectSlackHuddleConnection({ id: "conn-1", userEmail: OWNER }),
    ).rejects.toThrow(/Could not read the stored Slack token/);
    expect(mocks.deleteAppSecret).not.toHaveBeenCalled();
  });
});

describe("readConnectionToken", () => {
  const connection = {
    id: "conn-1",
    ownerEmail: OWNER,
    teamId: "T0TEAM",
    slackUserId: "U0OWNER",
    tokenSecretRef: "secret-ref",
  };

  it("reports a token that can never be decrypted as a dead token", async () => {
    mocks.readAppSecret.mockRejectedValue(decryptionError());
    const error = await readConnectionToken(connection).catch((e) => e);
    expect(error).toBeInstanceOf(SlackTokenError);
    expect(error.slackError).toBe("token_unreadable");
  });

  it("passes other read failures through, so the connection is kept", async () => {
    mocks.readAppSecret.mockRejectedValue(new Error("connection reset"));
    await expect(readConnectionToken(connection)).rejects.toThrow(
      "connection reset",
    );
    await expect(readConnectionToken(connection)).rejects.not.toBeInstanceOf(
      SlackTokenError,
    );
  });

  it("returns null when the token is gone", async () => {
    mocks.readAppSecret.mockResolvedValue(null);
    expect(await readConnectionToken(connection)).toBeNull();
  });
});
