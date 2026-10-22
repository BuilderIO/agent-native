import { mockEvent } from "h3";
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
import { hasRecurringSweepHandler } from "../jobs/sweep-hooks.js";
import {
  handleMcpApprovalRequest,
  MCP_APPROVAL_PRUNE_SWEEP_ID,
  mountMcpApprovalRoute,
} from "./approval-route.js";
import {
  consumeMcpApprovalGrant,
  consumeReviewedMcpApprovalGrant,
  createMcpApprovalGrant,
  ensureApprovalTable,
  recordMcpApprovalRun,
  storedApprovalArguments,
  type NewMcpApprovalGrant,
} from "./approval-store.js";

// The review page runs against the real grant store on PGlite. Only what sits
// outside it is stubbed: the browser session, the auth secret the decision
// token is signed with, the reader's saved language, and the OAuth connection
// that names the requesting client.
let pglite: Awaited<ReturnType<typeof createTestPglite>>;

vi.mock("../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client.js")>()),
  getDbExec: () => executor,
}));

// No `transaction`: on a fresh database the store registry then runs the
// grant store's migrations one by one rather than installing the generated
// schema snapshot.
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

const signedIn = vi.hoisted(() => ({
  session: null as { email: string; orgId?: string | null } | null,
  loginPage: null as { html: string; status: number } | null,
}));
// The page reads only the browser's sign-in cookie, never `getSession`.
vi.mock("../server/auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/auth.js")>()),
  getBrowserCookieSession: async () => signedIn.session,
  getSession: async () => {
    throw new Error("The review page must not resolve getSession.");
  },
  getConfiguredLoginHtml: () => signedIn.loginPage,
}));

vi.mock("../server/better-auth-instance.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/better-auth-instance.js")
  >()),
  getAuthSecret: () => "approval-route-test-secret",
}));

const settings = vi.hoisted(() => ({
  getUserSetting: vi.fn(
    async (_email: string, _key: string): Promise<unknown> => null,
  ),
}));
vi.mock("../settings/user-settings.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../settings/user-settings.js")>()),
  getUserSetting: settings.getUserSetting,
}));

// Mounting needs a Nitro app, and the long-lived prune timer is captured
// rather than left running.
const mounted = vi.hoisted(() => ({
  use: vi.fn(),
  startIntervalJob: vi.fn(() => ({ stop: () => {} })),
}));
vi.mock("../server/framework-request-handler.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/framework-request-handler.js")
  >()),
  getH3App: () => ({ use: mounted.use }),
}));
vi.mock("../server/interval-job.js", () => ({
  startIntervalJob: mounted.startIntervalJob,
}));

const CONNECTED_AT = 1_790_000_000_000;
const oauth = vi.hoisted(() => ({
  getOAuthClientConnection: vi.fn(),
}));
vi.mock("./oauth-store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./oauth-store.js")>()),
  getOAuthClientConnection: oauth.getOAuthClientConnection,
}));

const ORIGIN = "http://localhost:3000";
const OWNER = "owner@example.com";
const ORG = "org-1";
const TTL_MS = 10 * 60_000;
const NOW = 1_800_000_000_000;

const actions: Record<string, ActionEntry> = {
  "create-event": defineAction({
    title: "Create event",
    description: "Create a calendar event.",
    schema: z.object({
      title: z.string(),
      attendees: z.array(z.object({ email: z.string() })).optional(),
      apiKey: z.string().optional(),
    }),
    run: async () => ({ ok: true }),
  }) as unknown as ActionEntry,
};

beforeAll(async () => {
  pglite = await createTestPglite();
  await ensureApprovalTable();
});

afterAll(async () => {
  await pglite?.close();
});

beforeEach(async () => {
  await pglite.exec("DELETE FROM mcp_action_approvals");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  signedIn.session = { email: OWNER, orgId: ORG };
  signedIn.loginPage = null;
  settings.getUserSetting.mockReset();
  settings.getUserSetting.mockResolvedValue(null);
  oauth.getOAuthClientConnection.mockReset();
  oauth.getOAuthClientConnection.mockResolvedValue({
    clientName: "Claude Code",
    connectedAt: CONNECTED_AT,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

let sequence = 0;

async function createdGrant(
  overrides: Partial<NewMcpApprovalGrant> = {},
  args: Record<string, unknown> = {
    title: "Team sync",
    attendees: [{ email: "ana@example.com" }, { email: "bo@example.com" }],
    apiKey: "sk-live-1234567890",
  },
): Promise<NewMcpApprovalGrant> {
  sequence++;
  const grant: NewMcpApprovalGrant = {
    nonce: globalThis.crypto.randomUUID(),
    callerKey: "caller-1",
    actionName: "create-event",
    argumentsHash: `arguments-${sequence}`,
    expiresAt: Date.now() + TTL_MS,
    ownerEmail: OWNER,
    orgId: ORG,
    appId: "calendar",
    argumentsJson: storedApprovalArguments(args),
    oauthClientId: "client-1",
    retrySafe: false,
    ...overrides,
  };
  await createMcpApprovalGrant(grant);
  return grant;
}

function callOf(grant: NewMcpApprovalGrant) {
  return {
    appId: grant.appId,
    callerKey: grant.callerKey,
    actionName: grant.actionName,
    argumentsHash: grant.argumentsHash,
  };
}

async function storedRow(nonce: string): Promise<Record<string, unknown>> {
  const { rows } = await pglite.query(
    "SELECT * FROM mcp_action_approvals WHERE nonce = ?",
    [nonce],
  );
  expect(rows).toHaveLength(1);
  return rows[0] as Record<string, unknown>;
}

/** One request to the route, as mounted: the path is relative to the mount. */
async function send(
  method: string,
  id: string,
  init: {
    headers?: Record<string, string>;
    body?: string;
    appId?: string;
  } = {},
) {
  const event = mockEvent(`${ORIGIN}/${id}`, {
    method,
    headers: { host: "localhost:3000", ...init.headers },
    ...(init.body !== undefined ? { body: init.body } : {}),
  });
  const body = await handleMcpApprovalRequest(event, {
    appId: init.appId ?? "calendar",
    actions,
  });
  return {
    status: event.res.status ?? 200,
    headers: event.res.headers,
    body: body as any,
  };
}

const getJson = (
  id: string,
  headers: Record<string, string> = { "sec-fetch-site": "same-origin" },
  appId?: string,
) =>
  send("GET", id, {
    headers: { accept: "application/json", ...headers },
    ...(appId ? { appId } : {}),
  });

const getHtml = (id: string, headers: Record<string, string> = {}) =>
  send("GET", id, {
    headers: { accept: "text/html,application/xhtml+xml", ...headers },
  });

function post(
  id: string,
  body: unknown,
  headers: Record<string, string> = {},
  appId?: string,
) {
  return send("POST", id, {
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...(appId ? { appId } : {}),
  });
}

/** The token the owner's page carries for this grant. */
async function pageToken(id: string): Promise<string> {
  const { body } = await getJson(id);
  expect(body.csrfToken).toEqual(expect.any(String));
  return body.csrfToken;
}

describe("signed out", () => {
  it("serves the configured sign-in page at the review URL", async () => {
    const grant = await createdGrant();
    signedIn.session = null;
    signedIn.loginPage = { html: "<p>Sign in</p>", status: 200 };

    const { body } = await getHtml(grant.nonce);

    expect(body).toBeInstanceOf(Response);
    expect((body as Response).status).toBe(200);
    await expect((body as Response).text()).resolves.toBe("<p>Sign in</p>");
  });

  it("answers 401 without a sign-in page, to JSON, and to a decision, in the reader's language", async () => {
    const grant = await createdGrant();
    signedIn.session = null;
    const french = { "accept-language": "fr-FR,fr;q=0.9" };
    const signIn = "Connectez-vous pour examiner cette demande.";

    const page = await getHtml(grant.nonce, french);
    expect(page.status).toBe(401);
    expect(page.body).toContain('<html lang="fr-FR" dir="ltr">');
    expect(page.body).toContain(signIn);
    expect(page.body).not.toContain(grant.nonce);
    signedIn.loginPage = { html: "<p>Sign in</p>", status: 200 };
    expect(
      await getJson(grant.nonce, {
        "sec-fetch-site": "same-origin",
        ...french,
      }),
    ).toMatchObject({ status: 401, body: { error: signIn } });
    expect(
      (await post(grant.nonce, { decision: "approve", csrfToken: "x" }, french))
        .body,
    ).toEqual({ error: signIn });
    expect((await storedRow(grant.nonce)).status).toBe("pending");
  });
});

describe("someone other than the owner", () => {
  it.each([
    ["another user", { email: "other@example.com", orgId: ORG }, false],
    [
      "the owner in another organization",
      { email: OWNER, orgId: "org-2" },
      true,
    ],
    ["the owner outside any organization", { email: OWNER, orgId: null }, true],
  ])("%s finds nothing and changes nothing", async (_label, session, own) => {
    const grant = await createdGrant();
    const ownerToken = await pageToken(grant.nonce);
    signedIn.session = session;

    const json = await getJson(grant.nonce);
    expect(json.status).toBe(404);
    expect(json.body).toEqual(
      own
        ? { error: "Approval not found", reason: "other-organization" }
        : { error: "Approval not found" },
    );

    const html = await getHtml(grant.nonce);
    expect(html.status).toBe(404);
    expect(html.body).toContain(
      own
        ? `This request belongs to ${session.email} in another organization. Switch to the organization this request came from`
        : `No request at this link belongs to ${session.email}`,
    );
    expect(html.body).not.toContain("Team sync");

    const decision = await post(grant.nonce, {
      decision: "approve",
      csrfToken: ownerToken,
    });
    expect(decision.status).toBe(404);
    expect(await storedRow(grant.nonce)).toMatchObject({
      status: "pending",
      approver_email: null,
    });
  });
});

describe("the owner's view", () => {
  it("summarizes the stored call without its secrets", async () => {
    const grant = await createdGrant();

    const { status, body } = await getJson(grant.nonce);

    expect(status).toBe(200);
    expect(body).toMatchObject({
      id: grant.nonce,
      state: "pending",
      actionName: "create-event",
      expiresAt: grant.expiresAt,
      createdAt: NOW,
      readerTimeZone: null,
      requester: { name: "Claude Code", connectedAt: CONNECTED_AT },
      csrfToken: expect.any(String),
    });
    expect(body.summary).toMatchObject({
      title: "Create event",
      recipients: ["ana@example.com", "bo@example.com"],
      arguments: "stored",
    });
    expect(body.summary.fields).toContainEqual({
      label: "Title",
      value: "Team sync",
    });
    expect(body.priorRun).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("sk-live");
    expect(oauth.getOAuthClientConnection).toHaveBeenCalledWith(
      "client-1",
      OWNER,
    );
  });

  it("shows every recipient and field whole, and says plainly when it can't show the whole call", async () => {
    const people = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        email: `guest-${i}@example.com`,
      }));
    const body = "Agenda. ".repeat(60);
    const whole = await createdGrant({}, { attendees: people(60), body });

    const page = await getHtml(whole.nonce);
    expect(page.body).toContain("guest-59@example.com");
    expect(page.body).toContain(body.trim());
    expect(page.body).not.toContain("too large to keep");

    // Storage keeps 100 items of an array.
    const cut = await createdGrant({}, { attendees: people(150) });
    expect((await getJson(cut.nonce)).body.summary).toMatchObject({
      cut: true,
      recipients: expect.arrayContaining(["guest-99@example.com"]),
    });
    expect((await getHtml(cut.nonce)).body).toContain(
      "Part of this request was too large to keep, so not all of it can be shown, and the list of who it reaches may be incomplete.",
    );
  });

  it("names a client identified by URL by that URL's host", async () => {
    const grant = await createdGrant({
      oauthClientId: "https://claude.ai/oauth/client-metadata.json",
    });

    const { body } = await getJson(grant.nonce);

    expect(body.requester).toEqual({
      name: "claude.ai",
      connectedAt: CONNECTED_AT,
    });
  });

  it("names no requester for a call made without an OAuth client", async () => {
    const grant = await createdGrant({ oauthClientId: undefined });

    const { body } = await getJson(grant.nonce);

    expect(body.requester).toBeUndefined();
    expect(oauth.getOAuthClientConnection).not.toHaveBeenCalled();
  });

  it("uses the reader's saved language and time zone", async () => {
    settings.getUserSetting.mockResolvedValue({
      locale: "de-DE",
      timezone: "America/New_York",
    });
    const grant = await createdGrant();

    expect((await getJson(grant.nonce)).body.readerTimeZone).toBe(
      "America/New_York",
    );
    const html = await getHtml(grant.nonce, { "accept-language": "ar-SA" });
    expect(html.body).toContain('<html lang="de-DE" dir="ltr">');
    expect(html.body).toContain("Genehmigen");
  });

  describe("an earlier run of the identical call", () => {
    async function completedEarlierRun() {
      const earlier = await createdGrant();
      expect(await consumeMcpApprovalGrant(earlier)).toBe(true);
      await recordMcpApprovalRun(earlier.nonce, "completed");
      return earlier;
    }

    it("is shown before the call is approved again", async () => {
      const earlier = await completedEarlierRun();
      const grant = await createdGrant({
        argumentsHash: earlier.argumentsHash,
      });

      const { body } = await getJson(grant.nonce);

      expect(body.priorRun).toEqual({ status: "completed", at: NOW });
    });

    it("is not shown for a call its action declares safe to repeat", async () => {
      const earlier = await completedEarlierRun();
      const grant = await createdGrant({
        argumentsHash: earlier.argumentsHash,
        retrySafe: true,
      });

      const { body } = await getJson(grant.nonce);

      expect(body.state).toBe("pending");
      expect(body.priorRun).toBeUndefined();
    });
  });
});

describe("the review page", () => {
  it("is a locked-down HTML page whose script carries the policy's nonce", async () => {
    const grant = await createdGrant();

    const { status, headers, body } = await getHtml(grant.nonce);

    expect(status).toBe(200);
    expect(headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("cache-control")).toBe("no-store");
    const nonce = /script-src 'nonce-([^']+)'/.exec(
      headers.get("content-security-policy") ?? "",
    )?.[1];
    expect(nonce).toBeTruthy();
    expect(body).toContain(`<script nonce="${nonce}">`);
    expect(body).toContain('<html lang="en-US" dir="ltr">');
    expect(body).toContain("<h1>Create event</h1>");
  });

  it("escapes every stored argument", async () => {
    const grant = await createdGrant(
      {},
      { title: "<script>alert(1)</script>", notes: `"><img src=x>` },
    );

    const { body } = await getHtml(grant.nonce);

    expect(body).not.toContain("<script>alert(1)</script>");
    expect(body).not.toContain("<img src=x>");
    expect(body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("is laid out right to left for a right-to-left language", async () => {
    const grant = await createdGrant();

    const { body } = await getHtml(grant.nonce, { "accept-language": "ar-SA" });

    expect(body).toContain('<html lang="ar-SA" dir="rtl">');
  });
});

describe("deciding", () => {
  it.each([
    [
      "from another app on the same site",
      { origin: "https://mail.example.com", "sec-fetch-site": "same-site" },
    ],
    ["from another site", { "sec-fetch-site": "cross-site" }],
    ["without the browser's fetch metadata", { "sec-fetch-site": "" }],
  ])("refuses a decision %s", async (_label, headers) => {
    const grant = await createdGrant();
    const csrfToken = await pageToken(grant.nonce);

    const { status } = await post(
      grant.nonce,
      { decision: "approve", csrfToken },
      headers,
    );

    expect(status).toBe(403);
    expect((await storedRow(grant.nonce)).status).toBe("pending");
  });

  it("refuses a decision that is not JSON", async () => {
    const grant = await createdGrant();
    const csrfToken = await pageToken(grant.nonce);

    const { status } = await post(
      grant.nonce,
      `decision=approve&csrfToken=${encodeURIComponent(csrfToken)}`,
      { "content-type": "application/x-www-form-urlencoded" },
    );

    expect(status).toBe(415);
    expect((await storedRow(grant.nonce)).status).toBe("pending");
  });

  it("refuses an unknown decision", async () => {
    const grant = await createdGrant();
    const csrfToken = await pageToken(grant.nonce);

    const { status } = await post(grant.nonce, {
      decision: "maybe",
      csrfToken,
    });

    expect(status).toBe(400);
    expect((await storedRow(grant.nonce)).status).toBe("pending");
  });

  it("refuses a decision without this page's token", async () => {
    const grant = await createdGrant();
    const otherGrant = await createdGrant();
    const otherGrantToken = await pageToken(otherGrant.nonce);
    const otherUsersGrant = await createdGrant({
      ownerEmail: "other@example.com",
    });
    signedIn.session = { email: "other@example.com", orgId: ORG };
    const otherUsersToken = await pageToken(otherUsersGrant.nonce);
    signedIn.session = { email: OWNER, orgId: ORG };

    for (const csrfToken of [undefined, "", otherGrantToken, otherUsersToken]) {
      const { status, body } = await post(grant.nonce, {
        decision: "approve",
        csrfToken,
      });
      expect(status).toBe(403);
      expect(body).toEqual({
        error: "This page is out of date. Reload it and decide again.",
      });
    }
    expect((await storedRow(grant.nonce)).status).toBe("pending");
  });

  it("approves once; a replay is a conflict", async () => {
    const grant = await createdGrant();
    const csrfToken = await pageToken(grant.nonce);
    vi.setSystemTime(NOW + 30_000);

    const approved = await post(grant.nonce, {
      decision: "approve",
      csrfToken,
    });

    expect(approved.status).toBe(200);
    expect(approved.body).toEqual({
      state: "approved",
      expiresAt: NOW + 30_000 + TTL_MS,
    });
    expect(await storedRow(grant.nonce)).toMatchObject({
      status: "approved",
      approver_email: OWNER,
      approved_at: NOW + 30_000,
      expires_at: NOW + 30_000 + TTL_MS,
    });

    const replay = await post(grant.nonce, { decision: "approve", csrfToken });
    expect(replay.status).toBe(409);
    expect(replay.body).toMatchObject({
      state: "approved",
      expiresAt: NOW + 30_000 + TTL_MS,
    });
    const view = await getJson(grant.nonce);
    expect(view.body.state).toBe("approved");
    expect(view.body.csrfToken).toBeUndefined();
  });

  it("denies; approving afterwards is a conflict", async () => {
    const grant = await createdGrant();
    const csrfToken = await pageToken(grant.nonce);

    const denied = await post(grant.nonce, { decision: "deny", csrfToken });
    expect(denied.status).toBe(200);
    expect(denied.body).toEqual({
      state: "denied",
      expiresAt: grant.expiresAt,
    });

    const late = await post(grant.nonce, { decision: "approve", csrfToken });
    expect(late.status).toBe(409);
    expect(late.body).toMatchObject({ state: "denied" });
    expect(await storedRow(grant.nonce)).toMatchObject({
      status: "denied",
      approved_at: null,
    });
    await expect(
      consumeReviewedMcpApprovalGrant(callOf(grant)),
    ).resolves.toBeNull();
  });

  it("is too late once the grant has expired", async () => {
    const grant = await createdGrant({ expiresAt: NOW + 60_000 });
    const csrfToken = await pageToken(grant.nonce);
    vi.setSystemTime(NOW + 60_001);

    const view = await getJson(grant.nonce);
    expect(view.body.state).toBe("expired");
    expect(view.body.csrfToken).toBeUndefined();

    const late = await post(grant.nonce, { decision: "approve", csrfToken });
    expect(late.status).toBe(409);
    expect(late.body).toMatchObject({ state: "expired" });
    expect((await storedRow(grant.nonce)).status).toBe("pending");
  });

  it("lets the identical call run exactly once after a page approval", async () => {
    const grant = await createdGrant();
    const csrfToken = await pageToken(grant.nonce);
    await post(grant.nonce, { decision: "approve", csrfToken });

    await expect(
      consumeReviewedMcpApprovalGrant(callOf(grant)),
    ).resolves.toMatchObject({ nonce: grant.nonce });
    await expect(
      consumeReviewedMcpApprovalGrant(callOf(grant)),
    ).resolves.toBeNull();
    expect((await getJson(grant.nonce)).body.state).toBe("used");
  });
});

it("allows only GET and POST", async () => {
  const grant = await createdGrant();

  const { status, headers } = await send("DELETE", grant.nonce);

  expect(status).toBe(405);
  expect(headers.get("allow")).toBe("GET, POST");
  expect((await storedRow(grant.nonce)).status).toBe("pending");
});

describe("another app on the same database", () => {
  // Calendar's grant, opened on Mail's page: both apps have a same-named
  // action, and share the database and the user.
  it("finds nothing, decides nothing, and can't use the grant", async () => {
    const grant = await createdGrant();
    const csrfToken = await pageToken(grant.nonce);

    const json = await getJson(
      grant.nonce,
      { "sec-fetch-site": "same-origin" },
      "mail",
    );
    expect(json.status).toBe(404);
    expect(json.body).toEqual({ error: "Approval not found" });
    const html = await send("GET", grant.nonce, {
      headers: { accept: "text/html" },
      appId: "mail",
    });
    expect(html.status).toBe(404);
    expect(html.body).toContain(`No request at this link belongs to ${OWNER}`);
    expect(html.body).not.toContain("Team sync");
    const decision = await post(
      grant.nonce,
      { decision: "approve", csrfToken },
      {},
      "mail",
    );
    expect(decision.status).toBe(404);
    expect((await storedRow(grant.nonce)).status).toBe("pending");

    await post(grant.nonce, { decision: "approve", csrfToken });
    await expect(
      consumeReviewedMcpApprovalGrant({ ...callOf(grant), appId: "mail" }),
    ).resolves.toBeNull();
    await expect(
      consumeReviewedMcpApprovalGrant(callOf(grant)),
    ).resolves.toMatchObject({ nonce: grant.nonce });
  });
});

describe("the page's own data", () => {
  it.each([
    ["without the browser's fetch metadata", {}],
    ["for another site", { "sec-fetch-site": "cross-site" }],
  ])("is refused %s", async (_label, headers) => {
    const grant = await createdGrant();

    const { status, body } = await getJson(grant.nonce, headers);

    expect(status).toBe(403);
    expect(JSON.stringify(body)).not.toContain(grant.nonce);
  });

  it("still opens from a link on another site", async () => {
    const grant = await createdGrant();

    const { status, body } = await getHtml(grant.nonce, {
      "sec-fetch-site": "cross-site",
    });

    expect(status).toBe(200);
    expect(body).toContain("Team sync");
  });
});

describe("a grant that can no longer be decided", () => {
  it.each([
    [
      "used",
      async (grant: NewMcpApprovalGrant) => {
        await consumeMcpApprovalGrant(grant);
      },
    ],
    [
      "expired",
      async (grant: NewMcpApprovalGrant) => {
        vi.setSystemTime(grant.expiresAt + 1);
      },
    ],
  ])("shows none of its arguments once %s", async (state, end) => {
    const grant = await createdGrant();
    await end(grant);

    const json = await getJson(grant.nonce);
    expect(json.body.state).toBe(state);
    expect(json.body.summary).toMatchObject({
      recipients: [],
      fields: [],
      arguments: "not-stored",
    });
    const html = await getHtml(grant.nonce);
    expect(html.body).not.toContain("Team sync");
    expect(html.body).not.toContain("<details>");
  });
});

describe("mounting", () => {
  it("prunes grants from the platform sweep, and on its own timer on a long-lived server", async () => {
    const app = { appId: "calendar", actions };
    mountMcpApprovalRoute({}, app);
    mountMcpApprovalRoute({}, app);

    expect(mounted.use).toHaveBeenCalledWith(
      "/_agent-native/mcp/approvals",
      expect.any(Function),
    );
    expect(hasRecurringSweepHandler(MCP_APPROVAL_PRUNE_SWEEP_ID)).toBe(true);
    expect(mounted.startIntervalJob).toHaveBeenCalledTimes(1);
    const [prune, options] = mounted.startIntervalJob.mock.calls[0] as [
      (signal: AbortSignal) => Promise<void>,
      { intervalMs: number; leading: boolean },
    ];
    expect(options).toMatchObject({ intervalMs: TTL_MS, leading: false });

    const grant = await createdGrant();
    vi.setSystemTime(grant.expiresAt + 1);
    await prune(new AbortController().signal);
    expect((await storedRow(grant.nonce)).call_arguments).toBeNull();
  });
});
