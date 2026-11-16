import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import { resetAppConfigForTests } from "../app-config/index.js";
import { runWithRequestContext } from "../server/request-context.js";
import { slackOAuthResponseToInstallation } from "./slack-oauth.js";
import type { SlackOAuthAccessResponse } from "./slack-oauth.js";
import {
  assertSlackUserInstallAllowed,
  installSlackUserGrant,
  parseSlackInternalTeamIds,
  resolveSlackUserInstallGate,
  slackUserInstallOperationId,
  slackUserInstallSummary,
} from "./slack-user-install.js";
import {
  ensureUserIntegrationGrantsTable,
  getUserIntegrationGrant,
  resolveUserIntegrationGrant,
} from "./user-grants-store.js";

const holder = vi.hoisted(() => ({ exec: null as any }));
vi.mock("../db/client.js", async (original) => ({
  ...(await original<typeof import("../db/client.js")>()),
  getDbExec: () => holder.exec,
}));

const ALLOWED_TEAM = "T0INTERNAL1";
const OTHER_TEAM = "T0SOMEWHERE2";
const USER_TOKEN = "synthetic-user-access-7a1";
const BOT_TOKEN = "synthetic-bot-access-7a1";

let pg: Awaited<ReturnType<typeof createTestPglite>>;

const alice = {
  authUserId: "install-principal-a",
  userEmail: "a@example.test",
};
const bob = { authUserId: "install-principal-b", userEmail: "b@example.test" };
const asAlice = <T>(fn: () => Promise<T>) => runWithRequestContext(alice, fn);
const asBob = <T>(fn: () => Promise<T>) => runWithRequestContext(bob, fn);

/** A Slack response for a user-only install: no bot token at all. */
function userOnlyResponse(
  overrides: Partial<SlackOAuthAccessResponse> & {
    authedUser?: Record<string, unknown>;
  } = {},
): SlackOAuthAccessResponse {
  const { authedUser, ...rest } = overrides;
  return {
    ok: true,
    app_id: "A0INTERNAL",
    team: { id: ALLOWED_TEAM, name: "Synthetic Workspace" },
    scope: "",
    authed_user: {
      id: "U0ALICE",
      access_token: USER_TOKEN,
      token_type: "user",
      scope: "channels:read,users:read",
      ...authedUser,
    },
    ...rest,
  } as SlackOAuthAccessResponse;
}

beforeAll(async () => {
  // Isolated test process only: synthetic keys, in-memory database.
  vi.stubEnv("DATABASE_URL", "pglite:memory://slack-user-install"); // guard:allow-env-mutation
  vi.stubEnv(
    "WORKSPACE_SECRETS_ENCRYPTION_KEY",
    "synthetic-user-install-encryption-material",
  ); // guard:allow-env-mutation
  vi.stubEnv(
    "SECRETS_ENCRYPTION_KEY",
    "synthetic-user-install-encryption-material",
  ); // guard:allow-env-mutation
  pg = await createTestPglite();
  holder.exec = {
    async execute(input: string | { sql: string; args?: unknown[] }) {
      if (typeof input === "string") {
        await pg.exec(input);
        return { rows: [], rowsAffected: 0 };
      }
      const r = await pg.query(input.sql, input.args ?? []);
      return { rows: r.rows, rowsAffected: r.affectedRows ?? 0 };
    },
  };
  await ensureUserIntegrationGrantsTable();
  await pg.exec(
    'CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT NOT NULL)',
  );
  await pg.query('INSERT INTO "user" (id, email) VALUES (?, ?)', [
    alice.authUserId,
    alice.userEmail,
  ]);
  await pg.query('INSERT INTO "user" (id, email) VALUES (?, ?)', [
    bob.authUserId,
    bob.userEmail,
  ]);
}, 30_000);

afterAll(async () => {
  await pg?.close();
  holder.exec = null;
  vi.unstubAllEnvs();
});

describe("internal workspace allow-list", () => {
  it("keeps only well-formed team ids and fails closed when empty", () => {
    expect(parseSlackInternalTeamIds(undefined)).toEqual([]);
    expect(parseSlackInternalTeamIds("")).toEqual([]);
    expect(parseSlackInternalTeamIds(" , ,")).toEqual([]);
    expect(parseSlackInternalTeamIds(`${OTHER_TEAM}, not-a-team`)).toEqual([
      OTHER_TEAM,
    ]);
    expect(
      parseSlackInternalTeamIds(`${OTHER_TEAM},${ALLOWED_TEAM},${OTHER_TEAM}`),
    ).toEqual([OTHER_TEAM, ALLOWED_TEAM].sort());
  });

  it("refuses a missing, malformed or unlisted workspace", () => {
    for (const teamId of [null, undefined, "", "T0", "t0internal1", 42]) {
      expect(() =>
        assertSlackUserInstallAllowed(teamId as never, [ALLOWED_TEAM]),
      ).toThrow(/unavailable/i);
    }
    expect(() => assertSlackUserInstallAllowed(OTHER_TEAM, [])).toThrow(
      /unavailable/i,
    );
    expect(() =>
      assertSlackUserInstallAllowed(OTHER_TEAM, [ALLOWED_TEAM]),
    ).toThrow(/unavailable/i);
    expect(() =>
      assertSlackUserInstallAllowed(ALLOWED_TEAM, [ALLOWED_TEAM]),
    ).not.toThrow();
  });
});

describe("user-only install", () => {
  it("stores the authed_user token as a personal grant", async () => {
    const installed = await asAlice(() =>
      installSlackUserGrant({
        response: userOnlyResponse(),
        allowlist: [ALLOWED_TEAM],
        operationId: slackUserInstallOperationId("alice-install-1"),
        now: 1_700_000_000_000,
      }),
    );

    expect(installed.teamId).toBe(ALLOWED_TEAM);
    expect(installed.externalUserId).toBe("U0ALICE");
    expect(installed.scopes).toEqual(["channels:read", "users:read"]);

    const grant = await asAlice(() =>
      getUserIntegrationGrant(installed.grantId),
    );
    expect(grant).toMatchObject({
      id: installed.grantId,
      provider: "slack",
      teamId: ALLOWED_TEAM,
      externalUserId: "U0ALICE",
      status: "connected",
    });

    // The stored credential is the user token, read back through the vault.
    const bundle = await asAlice(() =>
      resolveUserIntegrationGrant(installed.grantId),
    );
    expect(bundle?.accessToken).toBe(USER_TOKEN);
    expect(bundle?.tokenType).toBe("user");

    // Nothing token-shaped is exposed by the public summary.
    const summary = slackUserInstallSummary(grant!);
    expect(JSON.stringify(summary)).not.toContain(USER_TOKEN);
    expect(Object.keys(summary).sort()).toEqual(
      ["grantId", "scopes", "teamId"].sort(),
    );

    // The vault row itself holds ciphertext, never the plaintext token.
    const rows = await pg.query<{ token_secret_key: string }>(
      "SELECT token_secret_key FROM integration_user_grants WHERE id = ?",
      [installed.grantId],
    );
    expect(rows.rows[0]?.token_secret_key).toMatch(/^integration-user-grant:/);
    expect(rows.rows[0]?.token_secret_key).not.toContain(USER_TOKEN);
  });

  it("never stores a bot token, even when one is present", async () => {
    const installed = await asAlice(() =>
      installSlackUserGrant({
        response: userOnlyResponse({
          access_token: BOT_TOKEN,
          bot_user_id: "U0BOT",
          authedUser: { id: "U0ALICE2", access_token: USER_TOKEN + "-2" },
        }),
        allowlist: [ALLOWED_TEAM],
        operationId: slackUserInstallOperationId("alice-install-b"),
      }),
    );
    const bundle = await asAlice(() =>
      resolveUserIntegrationGrant(installed.grantId),
    );
    expect(bundle?.accessToken).toBe(USER_TOKEN + "-2");
    expect(JSON.stringify(bundle)).not.toContain(BOT_TOKEN);
  });

  it("refuses a workspace outside the allow-list and stores nothing", async () => {
    await expect(
      asAlice(() =>
        installSlackUserGrant({
          response: userOnlyResponse(),
          allowlist: [OTHER_TEAM],
          operationId: slackUserInstallOperationId("alice-install-3"),
        }),
      ),
    ).rejects.toThrow(/unavailable/i);
  });

  it("rejects a response with no user token", async () => {
    await expect(
      asAlice(() =>
        installSlackUserGrant({
          response: userOnlyResponse({
            authedUser: { access_token: undefined, token_type: "bot" },
          }),
          allowlist: [ALLOWED_TEAM],
          operationId: slackUserInstallOperationId("alice-install-4"),
        }),
      ),
      // The mapper's own constant, non-leaking rejection.
    ).rejects.toThrow(/invalid/i);
  });

  it("reuses one grant attempt when the callback is retried", async () => {
    const operationId = slackUserInstallOperationId("alice-retried");
    const first = await asAlice(() =>
      installSlackUserGrant({
        response: userOnlyResponse({
          authedUser: { id: "U0RETRY", access_token: USER_TOKEN + "-r" },
        }),
        allowlist: [ALLOWED_TEAM],
        operationId,
      }),
    );
    const second = await asAlice(() =>
      installSlackUserGrant({
        response: userOnlyResponse({
          authedUser: { id: "U0RETRY", access_token: USER_TOKEN + "-r" },
        }),
        allowlist: [ALLOWED_TEAM],
        operationId,
      }),
    );
    expect(second.grantId).toBe(first.grantId);
  });
});

describe("personal grant isolation between two users of one workspace", () => {
  it("gives each user their own grant and hides it from the other", async () => {
    const a = await asAlice(() =>
      installSlackUserGrant({
        response: userOnlyResponse({
          authedUser: { id: "U0SHARED-A", access_token: USER_TOKEN + "-a" },
        }),
        allowlist: [ALLOWED_TEAM],
        operationId: slackUserInstallOperationId("isolation-a"),
      }),
    );
    const b = await asBob(() =>
      installSlackUserGrant({
        response: userOnlyResponse({
          authedUser: { id: "U0SHARED-B", access_token: USER_TOKEN + "-b" },
        }),
        allowlist: [ALLOWED_TEAM],
        operationId: slackUserInstallOperationId("isolation-b"),
      }),
    );

    expect(a.grantId).not.toBe(b.grantId);
    expect(a.teamId).toBe(b.teamId);

    // Each user resolves only their own token.
    expect(
      (await asAlice(() => resolveUserIntegrationGrant(a.grantId)))
        ?.accessToken,
    ).toBe(USER_TOKEN + "-a");
    expect(
      (await asBob(() => resolveUserIntegrationGrant(b.grantId)))?.accessToken,
    ).toBe(USER_TOKEN + "-b");

    // Cross-user reads are structurally refused, by id or by token.
    expect(await asBob(() => getUserIntegrationGrant(a.grantId))).toBeNull();
    expect(
      await asBob(() => resolveUserIntegrationGrant(a.grantId)),
    ).toBeNull();
    expect(
      await asAlice(() => resolveUserIntegrationGrant(b.grantId)),
    ).toBeNull();

    // Bob's install did not overwrite Alice's grant.
    expect(
      (await asAlice(() => resolveUserIntegrationGrant(a.grantId)))
        ?.accessToken,
    ).toBe(USER_TOKEN + "-a");
  });
});

describe("installed token is usable for a channel read (stubbed provider)", () => {
  // This is a plumbing receipt, not a live Slack call: it proves the token
  // that comes back out of the vault is the one placed on the wire, and that
  // the read targets the requested channel only.
  it("reads a channel with the stored user token", async () => {
    const channelId = "C0SYNTHETIC1";
    const installed = await asBob(() =>
      installSlackUserGrant({
        response: userOnlyResponse({
          authedUser: { id: "U0READ", access_token: USER_TOKEN + "-read" },
        }),
        allowlist: [ALLOWED_TEAM],
        operationId: slackUserInstallOperationId("bob-read"),
      }),
    );
    const bundle = await asBob(() =>
      resolveUserIntegrationGrant(installed.grantId),
    );
    expect(bundle).not.toBeNull();

    const seen: { url: string; authorization: string | null }[] = [];
    const stubFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return new Response(
        JSON.stringify({
          ok: true,
          channel: { id: channelId, is_private: true, num_members: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const response = await stubFetch(
      `https://slack.com/api/conversations.info?channel=${channelId}`,
      { headers: { Authorization: `Bearer ${bundle?.accessToken}` } },
    );
    const data = (await response.json()) as {
      ok: boolean;
      channel: { id: string; num_members: number };
    };

    expect(data.ok).toBe(true);
    expect(data.channel.id).toBe(channelId);
    expect(data.channel.num_members).toBe(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.authorization).toBe(`Bearer ${USER_TOKEN}-read`);
    expect(seen[0]?.url).toContain(`channel=${channelId}`);
  });
});

describe("existing bot installation path", () => {
  const access = {
    ownerEmail: "a@example.test",
    orgId: null,
    secretScope: "user" as const,
    secretScopeId: "a@example.test",
  };

  it("still requires a bot token and still maps it unchanged", () => {
    expect(() =>
      slackOAuthResponseToInstallation(
        // A user-only response has no bot access_token.
        userOnlyResponse(),
        access,
      ),
    ).toThrow(/bot access token/i);

    const botInstall = slackOAuthResponseToInstallation(
      {
        ok: true,
        access_token: BOT_TOKEN,
        app_id: "A0INTERNAL",
        team: { id: ALLOWED_TEAM, name: "Synthetic Workspace" },
        scope: "chat:write,channels:read",
        bot_user_id: "U0BOT",
        authed_user: { id: "U0ALICE", access_token: USER_TOKEN },
      } as SlackOAuthAccessResponse,
      access,
    );
    expect(botInstall.installationKey).toBe(
      `team:${ALLOWED_TEAM}:app:A0INTERNAL`,
    );
    expect(botInstall.tokenBundle.accessToken).toBe(BOT_TOKEN);
    expect(botInstall.tokenBundle).not.toHaveProperty("userToken");
  });
});

describe("first-install bootstrap", () => {
  it("stays closed when neither the allow-list nor the bootstrap switch is set", () => {
    expect(resolveSlackUserInstallGate({})).toEqual({
      allowlist: [],
      bootstrap: false,
    });
    expect(
      resolveSlackUserInstallGate({ slackUserInstallBootstrap: false }),
    ).toEqual({ allowlist: [], bootstrap: false });
  });

  it("reads the deployment gate from app config and its env aliases", () => {
    vi.stubEnv("SLACK_INTERNAL_TEAM_IDS", `${ALLOWED_TEAM}, not-a-team`);
    vi.stubEnv("SLACK_USER_INSTALL_BOOTSTRAP", "true");
    resetAppConfigForTests();
    try {
      expect(resolveSlackUserInstallGate()).toEqual({
        allowlist: [ALLOWED_TEAM],
        bootstrap: false,
      });
      vi.stubEnv("SLACK_INTERNAL_TEAM_IDS", "");
      resetAppConfigForTests();
      expect(resolveSlackUserInstallGate()).toEqual({
        allowlist: [],
        bootstrap: true,
      });
    } finally {
      vi.stubEnv("SLACK_INTERNAL_TEAM_IDS", undefined);
      vi.stubEnv("SLACK_USER_INSTALL_BOOTSTRAP", undefined);
      resetAppConfigForTests();
    }
  });

  it("opens only for the first install, and the allow-list always wins", () => {
    expect(
      resolveSlackUserInstallGate({ slackUserInstallBootstrap: true }),
    ).toEqual({ allowlist: [], bootstrap: true });
    // A configured allow-list disables the bootstrap entirely.
    expect(
      resolveSlackUserInstallGate({
        slackUserInstallBootstrap: true,
        slackInternalTeamIds: [OTHER_TEAM],
      }),
    ).toEqual({ allowlist: [OTHER_TEAM], bootstrap: false });
  });

  it("installs with the bootstrap switch and still refuses a pinned mismatch", async () => {
    const bootstrapped = await asAlice(() =>
      installSlackUserGrant({
        response: userOnlyResponse({
          authedUser: { id: "U0BOOTSTRAP", access_token: USER_TOKEN + "-boot" },
        }),
        allowlist: [],
        bootstrap: true,
        operationId: slackUserInstallOperationId("bootstrap-install"),
      }),
    );
    expect(bootstrapped.teamId).toBe(ALLOWED_TEAM);

    // Once the operator pins a different workspace, bootstrap cannot bypass it.
    await expect(
      asAlice(() =>
        installSlackUserGrant({
          response: userOnlyResponse({
            authedUser: {
              id: "U0BOOTSTRAP2",
              access_token: USER_TOKEN + "-b2",
            },
          }),
          allowlist: [OTHER_TEAM],
          bootstrap: true,
          operationId: slackUserInstallOperationId("bootstrap-pinned"),
        }),
      ),
    ).rejects.toThrow(/unavailable/i);
  });
});
