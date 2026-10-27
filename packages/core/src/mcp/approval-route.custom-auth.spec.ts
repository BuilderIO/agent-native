import { getRequestHeader, mockEvent, type H3Event } from "h3";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { z } from "zod";

import { createTestPglite } from "../a2a/test-pglite.js";
import { defineAction } from "../action.js";
import type { ActionEntry } from "../agent/production-agent.js";
import { MCP_APPROVAL_MESSAGES } from "../localization/mcp-approval-messages.js";
import { autoMountAuth, type AuthOptions } from "../server/auth.js";
import { handleMcpApprovalRequest } from "./approval-route.js";
import {
  consumeReviewedMcpApprovalGrant,
  createMcpApprovalGrant,
  ensureApprovalTable,
  storedApprovalArguments,
  type NewMcpApprovalGrant,
} from "./approval-store.js";

// The review page under an app's own authentication, as Design's Builder
// identity sets it up: `getSession` also accepts credentials the page must
// never count, and only the cookie-only `getBrowserSession` hook may sign the
// reader in. Auth is real here; the grant store runs on PGlite.
let pglite: Awaited<ReturnType<typeof createTestPglite>>;

vi.mock("../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client.js")>()),
  getDbExec: () => executor,
}));

const executor = {
  execute: async (input: string | { sql: string; args?: unknown[] }) => {
    const result =
      typeof input === "string"
        ? await pglite.query(input)
        : await pglite.query(input.sql, input.args ?? []);
    return {
      rows: result.rows as Record<string, unknown>[],
      rowsAffected: result.affectedRows ?? 0,
    };
  },
};

vi.mock("../server/better-auth-instance.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/better-auth-instance.js")
  >()),
  getAuthSecret: () => "approval-custom-auth-test-secret",
  resumeIdentityRekeysForEmail: async () => {},
}));

vi.mock("../settings/user-settings.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../settings/user-settings.js")>()),
  getUserSetting: async () => null,
}));

vi.mock("../server/framework-request-handler.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/framework-request-handler.js")
  >()),
  getH3App: (app: unknown) => app,
}));

vi.mock("./oauth-store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./oauth-store.js")>()),
  getOAuthClientConnection: async () => ({
    clientName: "Claude Code",
    connectedAt: 1_790_000_000_000,
  }),
}));

const ORIGIN = "http://localhost:3000";
const OWNER = "owner@example.com";
const ORG = "org-1";
const IDENTITY_COOKIE = "an_builder_identity";

const actions: Record<string, ActionEntry> = {
  "create-event": defineAction({
    title: "Create event",
    description: "Create a calendar event.",
    schema: z.object({ title: z.string() }),
    run: async () => ({ ok: true }),
  }) as unknown as ActionEntry,
};

/** Design's resolver reads one signed identity cookie and nothing else. */
const builderIdentitySession = vi.fn(async (event: H3Event) =>
  (getRequestHeader(event, "cookie") ?? "")
    .split(/;\s*/)
    .includes(`${IDENTITY_COOKIE}=owner-identity`)
    ? { email: OWNER, orgId: ORG }
    : null,
);
/** Its `getSession` also takes an API bearer, which the page must not. */
const getSession = vi.fn(async (event: H3Event) =>
  getRequestHeader(event, "authorization") === "Bearer owner-api-token"
    ? { email: OWNER, orgId: ORG }
    : builderIdentitySession(event),
);

beforeAll(async () => {
  pglite = await createTestPglite();
  await ensureApprovalTable();
});

afterAll(async () => {
  await pglite?.close();
});

beforeEach(async () => {
  await pglite.exec("DELETE FROM mcp_action_approvals");
  builderIdentitySession.mockClear();
  getSession.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function mountCustomAuth(options: Partial<AuthOptions>): Promise<void> {
  await autoMountAuth({ use: vi.fn() } as any, { getSession, ...options });
}

async function createdGrant(): Promise<NewMcpApprovalGrant> {
  const grant: NewMcpApprovalGrant = {
    nonce: globalThis.crypto.randomUUID(),
    callerKey: "caller-1",
    actionName: "create-event",
    argumentsHash: "arguments-1",
    expiresAt: Date.now() + 10 * 60_000,
    ownerEmail: OWNER,
    orgId: ORG,
    appId: "design",
    argumentsJson: storedApprovalArguments({ title: "Team sync" }),
    oauthClientId: "client-1",
    retrySafe: false,
  };
  await createMcpApprovalGrant(grant);
  return grant;
}

const signedIn = { cookie: `theme=dark; ${IDENTITY_COOKIE}=owner-identity` };
const sameOrigin = { "sec-fetch-site": "same-origin" };
const json = { accept: "application/json" };

async function send(
  method: "GET" | "POST",
  id: string,
  headers: Record<string, string>,
  body?: unknown,
) {
  const event = mockEvent(`${ORIGIN}/${id}`, {
    method,
    headers: {
      host: "localhost:3000",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await handleMcpApprovalRequest(event, {
    appId: "design",
    actions,
  });
  return { status: event.res.status ?? 200, body: result as any };
}

describe("the review page with an app's own authentication", () => {
  it("opens and approves once through the cookie-only hook, never through getSession", async () => {
    await mountCustomAuth({ getBrowserSession: builderIdentitySession });
    const grant = await createdGrant();

    const page = await send("GET", grant.nonce, {
      accept: "text/html",
      ...signedIn,
    });
    expect(page.status).toBe(200);
    expect(page.body).toContain("Team sync");

    expect(
      (await send("GET", grant.nonce, { ...json, ...signedIn })).status,
    ).toBe(403);
    const view = await send("GET", grant.nonce, {
      ...json,
      ...signedIn,
      ...sameOrigin,
    });
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ state: "pending" });

    // The API bearer `getSession` accepts never counts on this page.
    expect(
      await send(
        "POST",
        grant.nonce,
        { ...json, ...sameOrigin, authorization: "Bearer owner-api-token" },
        { decision: "approve", csrfToken: view.body.csrfToken },
      ),
    ).toMatchObject({ status: 401 });

    const approved = await send(
      "POST",
      grant.nonce,
      { ...json, ...signedIn, ...sameOrigin },
      { decision: "approve", csrfToken: view.body.csrfToken },
    );
    expect(approved).toMatchObject({
      status: 200,
      body: { state: "approved" },
    });
    expect(
      await send(
        "POST",
        grant.nonce,
        { ...json, ...signedIn, ...sameOrigin },
        { decision: "approve", csrfToken: view.body.csrfToken },
      ),
    ).toMatchObject({ status: 409, body: { state: "approved" } });

    const call = {
      appId: grant.appId,
      callerKey: grant.callerKey,
      actionName: grant.actionName,
      argumentsHash: grant.argumentsHash,
    };
    await expect(consumeReviewedMcpApprovalGrant(call)).resolves.toMatchObject({
      nonce: grant.nonce,
    });
    await expect(consumeReviewedMcpApprovalGrant(call)).resolves.toBeNull();
    expect(getSession).not.toHaveBeenCalled();
  });

  it("can't sign anyone in without the hook, and says so instead of asking for a sign-in", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await mountCustomAuth({});
    const grant = await createdGrant();

    const page = await send("GET", grant.nonce, {
      accept: "text/html",
      ...signedIn,
    });
    expect(page.status).toBe(401);
    expect(page.body).toContain(
      MCP_APPROVAL_MESSAGES["en-US"].signInUnavailable.replace("'", "&#39;"),
    );
    expect(page.body).not.toContain("Team sync");

    for (const request of [
      send("GET", grant.nonce, { ...json, ...signedIn, ...sameOrigin }),
      send(
        "POST",
        grant.nonce,
        { ...json, ...signedIn, ...sameOrigin },
        { decision: "approve", csrfToken: "x" },
      ),
    ]) {
      expect(await request).toMatchObject({
        status: 401,
        body: {
          error: expect.stringContaining("AuthOptions.getBrowserSession"),
        },
      });
    }
    expect(getSession).not.toHaveBeenCalled();
    expect(
      warn.mock.calls.filter(([message]) =>
        String(message).includes("AuthOptions.getBrowserSession"),
      ),
    ).toHaveLength(1);
    const { rows } = await pglite.query(
      "SELECT status FROM mcp_action_approvals WHERE nonce = $1",
      [grant.nonce],
    );
    expect(rows).toEqual([{ status: "pending" }]);
  });
});
