import { drizzle } from "drizzle-orm/pglite";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import { ownableColumns, table, text } from "../db/schema.js";

let pglite: Awaited<ReturnType<typeof createTestPglite>>;

type Exec = {
  execute: (
    input: string | { sql: string; args?: unknown[] },
  ) => Promise<{ rows: any[]; rowsAffected: number }>;
  transaction: <T>(fn: (tx: Exec) => Promise<T>) => Promise<T>;
};

// Runs once, right after a grant reads the principal's current share row, to
// stand in for another session changing it before the grant writes.
const afterShareRead: { run: (() => Promise<void>) | null } = { run: null };

const rawClient: Exec = {
  async execute(input) {
    if (typeof input === "string") {
      await pglite.exec(input);
      return { rows: [], rowsAffected: 0 };
    }
    const result = await pglite.query(input.sql, input.args ?? []);
    const run = afterShareRead.run;
    if (
      run &&
      /^select "id", "role" from "qa_request_doc_shares"/.test(input.sql)
    ) {
      afterShareRead.run = null;
      await run();
    }
    return {
      rows: result.rows as any[],
      rowsAffected: result.affectedRows ?? 0,
    };
  },
  async transaction(fn) {
    await pglite.exec("BEGIN");
    try {
      const result = await fn(rawClient);
      await pglite.exec("COMMIT");
      return result;
    } catch (error) {
      await pglite.exec("ROLLBACK");
      throw error;
    }
  },
};

vi.mock("../db/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/client.js")>();
  return {
    ...actual,
    getDbExec: () => actual.getScopedDbExec() ?? rawClient,
  };
});

const notifyWithDelivery = vi.fn(
  async (_input: any, _meta: { owner: string }) => ({
    notification: { id: "notification" } as any,
    deliveredChannels: ["inbox"],
  }),
);
vi.mock("../notifications/registry.js", () => ({
  notifyWithDelivery: (input: any, meta: any) =>
    notifyWithDelivery(input, meta),
}));

const sendEmail = vi.fn(
  async (
    _args: any,
  ): Promise<
    | { status: "sent"; provider: "resend" }
    | { status: "suppressed"; reason: "test-identity" }
  > => ({ status: "sent", provider: "resend" }),
);
const emailConfigured: {
  value: boolean;
  error: Error | null;
  broken: "misconfigured" | "unavailable" | null;
} = { value: true, error: null, broken: null };
vi.mock("../server/email.js", () => ({
  isEmailConfigured: async () => {
    if (emailConfigured.error) throw emailConfigured.error;
    return emailConfigured.value && !emailConfigured.broken;
  },
  getEmailReadiness: async () =>
    emailConfigured.broken
      ? { status: emailConfigured.broken, provider: "unknown" }
      : emailConfigured.value
        ? { status: "ready", provider: "resend" }
        : { status: "not-configured", provider: "dev" },
  sendEmail: (args: any) => sendEmail(args),
}));

vi.mock("../server/app-url.js", () => ({
  getAppProductionUrl: () => "https://app.example.com",
}));

vi.mock("../user-profile/store.js", () => ({
  getUserProfile: async (email: string) => ({
    email,
    name: email.startsWith("outsider") ? "Olive Outsider" : null,
  }),
}));

const orgMembers = new Set<string>();
vi.mock("../org/membership.js", () => ({
  isOrgMember: async (orgId: string, email: string) =>
    orgMembers.has(`${orgId}:${email}`),
}));

const { runWithRequestContext } = await import("../server/request-context.js");
const { registerShareableResource } = await import("./registry.js");
const { createSharesTable } = await import("./schema.js");
const {
  ACCESS_REQUEST_DECLINE_COOLDOWN_MS,
  ACCESS_REQUEST_SEND_WINDOW_MS,
  ACCESS_REQUESTS_PER_OWNER_PER_DAY,
  ACCESS_REQUESTS_PER_REQUESTER_PER_DAY,
  approveAccessRequest,
  declineAccessRequest,
  getAccessRequestReview,
  listResourceAccessRequests,
  requestResourceAccess,
  resolveLinkStatus,
} = await import("./access-requests.js");
const { deleteAccessRequest, ensureTable } =
  await import("./access-request-store.js");

const requestableType = "qa-request-doc";
const closedType = "qa-request-closed";
const orgOnlyType = "qa-request-org-only";
const ownerEmail = "owner+request@example.com";
const adminEmail = "admin+request@example.com";
const editorEmail = "editor+request@example.com";
const outsiderEmail = "outsider+request@example.com";

const docs = table("qa_request_docs", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  trashedAt: text("trashed_at"),
  ...ownableColumns(),
});
const docShares = createSharesTable("qa_request_doc_shares");
let db: ReturnType<typeof drizzle>;

function as<T>(
  userEmail: string | undefined,
  run: () => Promise<T>,
  orgId?: string,
) {
  return runWithRequestContext({ userEmail, orgId }, run);
}

async function insertDoc(id: string, orgId: string | null = null) {
  await db.insert(docs).values({
    id,
    title: `Launch plan ${id}`,
    trashedAt: null,
    ownerEmail,
    orgId,
    visibility: "private",
  });
}

async function shareWith(
  resourceId: string,
  email: string,
  role: "viewer" | "editor" | "admin",
) {
  await db.insert(docShares).values({
    id: `share-${resourceId}-${email}`,
    resourceId,
    principalType: "user",
    principalId: email,
    role,
    createdBy: ownerEmail,
    createdAt: new Date().toISOString(),
  });
}

async function shareRole(resourceId: string, email: string) {
  const { rows } = await pglite.query(
    `SELECT role FROM qa_request_doc_shares WHERE resource_id = ? AND principal_id = ?`,
    [resourceId, email],
  );
  return (rows[0] as { role?: string } | undefined)?.role ?? null;
}

async function requestRow(resourceId: string) {
  const { rows } = await pglite.query(
    `SELECT * FROM resource_access_requests WHERE resource_id = ?`,
    [resourceId],
  );
  return rows[0] as Record<string, any> | undefined;
}

function requestAs(
  email: string | undefined,
  resourceId: string,
  note?: string,
) {
  return as(email, () =>
    requestResourceAccess({
      resourceType: requestableType,
      resourceId,
      note,
    }),
  );
}

async function errorOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as {
      message: string;
      errorCode?: string;
      statusCode?: number;
      details?: any;
    };
  }
  throw new Error("Expected the call to fail");
}

beforeAll(async () => {
  pglite = await createTestPglite();
  await pglite.exec(`
    CREATE TABLE qa_request_docs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      trashed_at TEXT,
      owner_email TEXT NOT NULL,
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    );
    CREATE TABLE qa_request_doc_shares (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL,
      principal_type TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      notified_at TEXT
    );
    CREATE UNIQUE INDEX qa_request_doc_shares_principal
      ON qa_request_doc_shares (resource_id, principal_type, principal_id);
    CREATE TABLE org_invitations (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      email TEXT NOT NULL,
      status TEXT NOT NULL
    );
  `);
  db = drizzle(pglite.db);
  await ensureTable();
  const base = {
    resourceTable: docs,
    sharesTable: docShares,
    displayName: "Document",
    titleColumn: "title",
    getResourcePath: (doc: { id: string }) => `/page/${doc.id}`,
    getDb: () => db,
  };
  registerShareableResource({
    ...base,
    type: requestableType,
    accessRequests: true,
  });
  registerShareableResource({ ...base, type: closedType });
  registerShareableResource({
    ...base,
    type: orgOnlyType,
    accessRequests: true,
    requireOrgMemberForUserShares: true,
  });
});

afterAll(async () => {
  await pglite.close();
});

beforeEach(async () => {
  await pglite.exec(`
    DELETE FROM qa_request_docs;
    DELETE FROM qa_request_doc_shares;
    DELETE FROM org_invitations;
    DELETE FROM resource_access_requests;
  `);
  orgMembers.clear();
  notifyWithDelivery.mockClear();
  notifyWithDelivery.mockImplementation(async () => ({
    notification: { id: "notification" } as any,
    deliveredChannels: ["inbox"],
  }));
  sendEmail.mockReset();
  sendEmail.mockImplementation(async () => ({
    status: "sent",
    provider: "resend",
  }));
  emailConfigured.value = true;
  emailConfigured.error = null;
  emailConfigured.broken = null;
  afterShareRead.run = null;
});

describe("resolveLinkStatus", () => {
  it("offers a request only to a signed-in viewer who can't open a requestable resource", async () => {
    await insertDoc("doc");

    expect(
      await as(outsiderEmail, () => resolveLinkStatus(requestableType, "doc")),
    ).toEqual({ state: "denied", canRequest: true });
    expect(
      await as(outsiderEmail, () => resolveLinkStatus(closedType, "doc")),
    ).toEqual({ state: "denied" });
    expect(
      await as(ownerEmail, () => resolveLinkStatus(requestableType, "doc")),
    ).toEqual({ state: "allowed", role: "owner" });
    expect(
      await as(outsiderEmail, () =>
        resolveLinkStatus(requestableType, "nothing"),
      ),
    ).toEqual({ state: "missing" });
    expect(
      await as(undefined, () => resolveLinkStatus(requestableType, "doc")),
    ).toEqual({ state: "signed-out" });
  });

  it("shows the viewer's open request, and nothing about anyone else's", async () => {
    await insertDoc("doc");
    await requestAs(outsiderEmail, "doc");

    const status = await as(outsiderEmail, () =>
      resolveLinkStatus(requestableType, "doc"),
    );
    expect(status).toMatchObject({
      state: "denied",
      canRequest: false,
      request: { state: "pending" },
    });
    expect(
      await as("someone-else@example.com", () =>
        resolveLinkStatus(requestableType, "doc"),
      ),
    ).toEqual({ state: "denied", canRequest: true });
  });
});

describe("requestResourceAccess", () => {
  it("tells the owner and admins, not editors, by inbox and email", async () => {
    await insertDoc("doc");
    await shareWith("doc", adminEmail, "admin");
    await shareWith("doc", editorEmail, "editor");

    const result = await requestAs(outsiderEmail, "doc", "  For Friday  ");

    expect(result).toMatchObject({
      state: "requested",
      sent: true,
      request: { state: "pending" },
    });
    const owners = notifyWithDelivery.mock.calls.map(([, meta]) => meta.owner);
    expect(owners.sort()).toEqual([adminEmail, ownerEmail].sort());
    const [input] = notifyWithDelivery.mock.calls[0];
    const row = await requestRow("doc");
    expect(input).toMatchObject({
      channels: ["inbox"],
      title: 'Olive Outsider is asking for access to "Launch plan doc"',
      body: "For Friday",
      metadata: { link: `/access-requests/${row?.id}` },
    });
    expect(sendEmail).toHaveBeenCalledTimes(2);
    const email = sendEmail.mock.calls[0][0];
    expect(email.replyTo).toBe(outsiderEmail);
    expect(email.subject).toContain("Olive Outsider");
    expect(email.html).toContain(
      `https://app.example.com/access-requests/${row?.id}`,
    );
    expect(email.text).toContain("For Friday");
    expect(row).toMatchObject({
      state: "pending",
      generation: 1,
      note: "For Friday",
      owner_email: ownerEmail,
    });
  });

  it("tells only people whose access still lets them manage it", async () => {
    await insertDoc("org-doc", "org-1");
    orgMembers.add(`org-1:${ownerEmail}`);
    // An admin share on a restricted resource grants nothing to someone
    // outside its organization, such as an invitee whose invitation lapsed.
    await shareWith("org-doc", adminEmail, "admin");

    const result = await as(outsiderEmail, () =>
      requestResourceAccess({
        resourceType: orgOnlyType,
        resourceId: "org-doc",
      }),
    );

    expect(result).toMatchObject({ state: "requested", sent: true });
    expect(notifyWithDelivery.mock.calls.map(([, meta]) => meta.owner)).toEqual(
      [ownerEmail],
    );
    expect(sendEmail.mock.calls.map(([email]) => email.to)).toEqual([
      ownerEmail,
    ]);
  });

  it("still sends when telling one of the people fails", async () => {
    await insertDoc("doc");
    await shareWith("doc", adminEmail, "admin");
    emailConfigured.value = false;
    notifyWithDelivery.mockImplementation(async (_input, meta) => {
      if (meta.owner === ownerEmail) throw new Error("inbox down");
      return {
        notification: { id: "notification" } as any,
        deliveredChannels: ["inbox"],
      };
    });

    expect(await requestAs(outsiderEmail, "doc")).toMatchObject({ sent: true });
    expect(JSON.parse((await requestRow("doc"))?.delivery)).toEqual({
      recipients: 2,
      inbox: 1,
      email: 0,
      failed: 1,
    });
  });

  it("sends nothing when the viewer asks again while their request is open", async () => {
    await insertDoc("doc");
    await requestAs(outsiderEmail, "doc");
    notifyWithDelivery.mockClear();
    sendEmail.mockClear();

    const again = await requestAs(outsiderEmail, "doc");

    expect(again).toMatchObject({ state: "requested", sent: false });
    expect(notifyWithDelivery).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  describe("after an ask was cut off before anyone was told", () => {
    // The row an ask leaves when its process stops partway through sending.
    async function cutOffRequest(askedAt: number) {
      await rawClient.execute({
        sql: `INSERT INTO resource_access_requests (id, resource_type, resource_id, requester_email, owner_email, state, generation, requested_at, created_at) VALUES ('cut-off', ?, 'doc', ?, ?, 'pending', 1, ?, ?)`,
        args: [requestableType, outsiderEmail, ownerEmail, askedAt, askedAt],
      });
    }

    it("lets the viewer ask again, and sends the same request under the same keys", async () => {
      await insertDoc("doc");
      await cutOffRequest(Date.now() - ACCESS_REQUEST_SEND_WINDOW_MS - 1_000);

      expect(
        await as(outsiderEmail, () =>
          resolveLinkStatus(requestableType, "doc"),
        ),
      ).toEqual({ state: "denied", canRequest: true });
      expect(await requestAs(outsiderEmail, "doc")).toMatchObject({
        state: "requested",
        sent: true,
      });

      expect(notifyWithDelivery).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: "access-request:cut-off:1" }),
        { owner: ownerEmail },
      );
      expect(sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: `access-request:cut-off:1:${ownerEmail}`,
        }),
      );
      const row = await requestRow("doc");
      expect(row).toMatchObject({ id: "cut-off", generation: 1 });
      expect(row?.delivery).not.toBeNull();
    });

    it("waits while the send may still be running", async () => {
      await insertDoc("doc");
      await cutOffRequest(Date.now() - 1_000);

      expect(
        await as(outsiderEmail, () =>
          resolveLinkStatus(requestableType, "doc"),
        ),
      ).toMatchObject({ state: "denied", canRequest: false });
      expect(await requestAs(outsiderEmail, "doc")).toMatchObject({
        state: "requested",
        sent: false,
      });
      expect(notifyWithDelivery).not.toHaveBeenCalled();
    });

    it("sends it again from one ask when several arrive at once", async () => {
      await insertDoc("doc");
      await cutOffRequest(Date.now() - ACCESS_REQUEST_SEND_WINDOW_MS - 1_000);

      const results = await Promise.all([
        requestAs(outsiderEmail, "doc"),
        requestAs(outsiderEmail, "doc"),
        requestAs(outsiderEmail, "doc"),
      ]);

      expect(
        results.filter((result) => "sent" in result && result.sent),
      ).toHaveLength(1);
      expect(notifyWithDelivery).toHaveBeenCalledTimes(1);
    });
  });

  it("never withdraws a request someone was told about", async () => {
    await insertDoc("doc");
    await requestAs(outsiderEmail, "doc");
    const row = await requestRow("doc");

    await deleteAccessRequest(row!.id, row!.generation);

    expect(await requestRow("doc")).toMatchObject({ id: row!.id });
  });

  it("refuses signed-out callers, missing resources, and types that don't take requests", async () => {
    await insertDoc("doc");

    expect(await errorOf(requestAs(undefined, "doc"))).toMatchObject({
      errorCode: "sign_in_required",
      statusCode: 401,
    });
    expect(await errorOf(requestAs(outsiderEmail, "nothing"))).toMatchObject({
      errorCode: "resource_missing",
      statusCode: 404,
    });
    expect(
      await errorOf(
        as(outsiderEmail, () =>
          requestResourceAccess({
            resourceType: closedType,
            resourceId: "doc",
          }),
        ),
      ),
    ).toMatchObject({ errorCode: "access_requests_unsupported" });
    expect(await requestAs(ownerEmail, "doc")).toEqual({ state: "allowed" });
    expect(notifyWithDelivery).not.toHaveBeenCalled();
  });

  it("stops a requester past their daily limit, with a retry time", async () => {
    await insertDoc("doc");
    const now = Date.now();
    for (let i = 0; i < ACCESS_REQUESTS_PER_REQUESTER_PER_DAY; i++) {
      await insertDoc(`other-${i}`);
      await requestAs(outsiderEmail, `other-${i}`);
    }
    notifyWithDelivery.mockClear();

    const error = await errorOf(requestAs(outsiderEmail, "doc"));

    expect(error).toMatchObject({
      errorCode: "access_request_rate_limited",
      statusCode: 429,
    });
    expect(Date.parse(error.details.retryAt)).toBeGreaterThan(now);
    expect(notifyWithDelivery).not.toHaveBeenCalled();
    expect(await requestRow("doc")).toBeUndefined();
  });

  it("holds the daily limit when requests arrive at the same moment", async () => {
    const ids = Array.from(
      { length: ACCESS_REQUESTS_PER_REQUESTER_PER_DAY + 5 },
      (_, i) => `burst-${i}`,
    );
    for (const id of ids) await insertDoc(id);

    const results = await Promise.allSettled(
      ids.map((id) => requestAs(outsiderEmail, id)),
    );

    const sent = results.filter((result) => result.status === "fulfilled");
    expect(sent.length).toBeLessThanOrEqual(
      ACCESS_REQUESTS_PER_REQUESTER_PER_DAY,
    );
    const { rows } = await pglite.query(
      `SELECT COUNT(*)::int AS n FROM resource_access_requests WHERE requester_email = ?`,
      [outsiderEmail],
    );
    expect((rows[0] as { n: number }).n).toBe(sent.length);
  });

  it("stops requests to an owner past their daily limit", async () => {
    await insertDoc("doc");
    for (let i = 0; i < ACCESS_REQUESTS_PER_OWNER_PER_DAY; i++) {
      await rawClient.execute({
        sql: `INSERT INTO resource_access_requests (id, resource_type, resource_id, requester_email, owner_email, state, generation, requested_at, created_at) VALUES (?, ?, ?, ?, ?, 'pending', 1, ?, ?)`,
        args: [
          `seed-${i}`,
          requestableType,
          `seed-doc-${i}`,
          `asker-${i}@example.com`,
          ownerEmail,
          Date.now(),
          Date.now(),
        ],
      });
    }

    expect(await errorOf(requestAs(outsiderEmail, "doc"))).toMatchObject({
      errorCode: "access_request_rate_limited",
      statusCode: 429,
    });
  });

  it("withdraws a request nobody could be told about, so the viewer can try again", async () => {
    await insertDoc("doc");
    notifyWithDelivery.mockImplementation(async () => ({
      notification: undefined,
      deliveredChannels: [],
    }));
    sendEmail.mockRejectedValue(new Error("provider down"));

    expect(await errorOf(requestAs(outsiderEmail, "doc"))).toMatchObject({
      errorCode: "access_request_undelivered",
      statusCode: 503,
    });
    expect(await requestRow("doc")).toBeUndefined();
    expect(
      await as(outsiderEmail, () => resolveLinkStatus(requestableType, "doc")),
    ).toEqual({ state: "denied", canRequest: true });
  });

  it("withdraws a request when telling anyone throws, so asking again sends it", async () => {
    await insertDoc("doc");
    emailConfigured.error = new Error("email settings unreadable");

    expect((await errorOf(requestAs(outsiderEmail, "doc"))).message).toBe(
      "email settings unreadable",
    );
    expect(await requestRow("doc")).toBeUndefined();

    emailConfigured.error = null;
    expect(await requestAs(outsiderEmail, "doc")).toMatchObject({ sent: true });
    expect(notifyWithDelivery).toHaveBeenCalledTimes(1);
  });
});

describe("reviewing a request", () => {
  async function openRequest(resourceId = "doc", type = requestableType) {
    await as(outsiderEmail, () =>
      requestResourceAccess({ resourceType: type, resourceId }),
    );
    const row = await requestRow(resourceId);
    return { id: String(row!.id), generation: Number(row!.generation) };
  }

  it("shows the requester and page only to people who manage access", async () => {
    await insertDoc("doc");
    await shareWith("doc", adminEmail, "admin");
    await shareWith("doc", editorEmail, "editor");
    const { id } = await openRequest();

    for (const email of [ownerEmail, adminEmail]) {
      expect(await as(email, () => getAccessRequestReview(id))).toMatchObject({
        state: "pending",
        requester: { email: outsiderEmail, name: "Olive Outsider" },
        resource: { title: "Launch plan doc", path: "/page/doc" },
      });
    }
    const hidden = await errorOf(
      as(editorEmail, () => getAccessRequestReview(id)),
    );
    const missing = await errorOf(
      as(ownerEmail, () => getAccessRequestReview("no-such-request")),
    );
    expect(hidden).toMatchObject({
      errorCode: "access_request_not_found",
      statusCode: 404,
    });
    expect(hidden.message).toBe(missing.message);
    expect(
      await errorOf(
        as(editorEmail, () =>
          listResourceAccessRequests(requestableType, "doc"),
        ),
      ),
    ).toMatchObject({ statusCode: 403 });
    expect(
      await as(ownerEmail, () =>
        listResourceAccessRequests(requestableType, "doc"),
      ),
    ).toMatchObject({
      requests: [{ id, requester: { email: outsiderEmail } }],
      hasMore: false,
    });
  });

  it("says when older pending requests are past the list", async () => {
    await insertDoc("doc");
    for (let i = 0; i < 51; i++) {
      await rawClient.execute({
        sql: `INSERT INTO resource_access_requests (id, resource_type, resource_id, requester_email, owner_email, state, generation, requested_at, created_at) VALUES (?, ?, ?, ?, ?, 'pending', 1, ?, ?)`,
        args: [
          `backlog-${i}`,
          requestableType,
          "doc",
          `asker-${i}@example.com`,
          ownerEmail,
          i,
          i,
        ],
      });
    }

    const list = await as(ownerEmail, () =>
      listResourceAccessRequests(requestableType, "doc"),
    );

    expect(list.hasMore).toBe(true);
    expect(list.requests).toHaveLength(50);
    expect(list.requests[0].id).toBe("backlog-50");
  });

  it("grants view by default, opens the page for the requester, and emails them", async () => {
    await insertDoc("doc");
    const { id, generation } = await openRequest();
    sendEmail.mockClear();

    expect(
      await as(ownerEmail, () =>
        approveAccessRequest({ requestId: id, generation, role: "viewer" }),
      ),
    ).toEqual({ state: "approved", role: "viewer", email: "sent" });

    expect(await shareRole("doc", outsiderEmail)).toBe("viewer");
    expect(
      await as(outsiderEmail, () => resolveLinkStatus(requestableType, "doc")),
    ).toEqual({ state: "allowed", role: "viewer" });
    expect(await requestRow("doc")).toMatchObject({
      state: "approved",
      decided_by: ownerEmail,
      granted_role: "viewer",
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ to: outsiderEmail });
    expect(sendEmail.mock.calls[0][0].html).toContain(
      "https://app.example.com/page/doc",
    );
    expect(
      await as(ownerEmail, () =>
        listResourceAccessRequests(requestableType, "doc"),
      ),
    ).toEqual({ requests: [], hasMore: false });
  });

  it("keeps the access when the email telling the requester fails, and says so", async () => {
    await insertDoc("doc");
    await insertDoc("quiet-doc");
    await insertDoc("broken-doc");
    const failed = await openRequest();
    const quiet = await openRequest("quiet-doc");
    const broken = await openRequest("broken-doc");
    sendEmail.mockRejectedValue(new Error("provider down"));

    expect(
      await as(ownerEmail, () =>
        approveAccessRequest({
          requestId: failed.id,
          generation: failed.generation,
          role: "viewer",
        }),
      ),
    ).toEqual({ state: "approved", role: "viewer", email: "failed" });
    expect(await shareRole("doc", outsiderEmail)).toBe("viewer");

    // A setup that's broken or unreadable is a failure, not "no email here".
    emailConfigured.broken = "misconfigured";
    expect(
      await as(ownerEmail, () =>
        approveAccessRequest({
          requestId: broken.id,
          generation: broken.generation,
          role: "viewer",
        }),
      ),
    ).toMatchObject({ email: "failed" });

    emailConfigured.broken = null;
    emailConfigured.value = false;
    expect(
      await as(ownerEmail, () =>
        approveAccessRequest({
          requestId: quiet.id,
          generation: quiet.generation,
          role: "viewer",
        }),
      ),
    ).toMatchObject({ email: "skipped" });
  });

  it("says the email was skipped when it would have gone to a test identity", async () => {
    await insertDoc("doc");
    const { id, generation } = await openRequest();
    sendEmail.mockResolvedValue({
      status: "suppressed",
      reason: "test-identity",
    });

    expect(
      await as(ownerEmail, () =>
        approveAccessRequest({ requestId: id, generation, role: "viewer" }),
      ),
    ).toEqual({ state: "approved", role: "viewer", email: "skipped" });
  });

  it("never lowers a stronger role the requester already holds", async () => {
    await insertDoc("doc");
    const { id, generation } = await openRequest();
    await shareWith("doc", outsiderEmail, "editor");

    expect(
      await as(ownerEmail, () =>
        approveAccessRequest({ requestId: id, generation, role: "viewer" }),
      ),
    ).toEqual({ state: "approved", role: "editor", email: "sent" });
    expect(await shareRole("doc", outsiderEmail)).toBe("editor");
  });

  it("keeps a stronger role granted while the approval was being written", async () => {
    await insertDoc("doc");
    const { id, generation } = await openRequest();
    await shareWith("doc", outsiderEmail, "viewer");
    afterShareRead.run = async () => {
      await pglite.query(
        `UPDATE qa_request_doc_shares SET role = 'admin' WHERE principal_id = ?`,
        [outsiderEmail],
      );
    };

    expect(
      await as(ownerEmail, () =>
        approveAccessRequest({ requestId: id, generation, role: "editor" }),
      ),
    ).toMatchObject({ state: "approved", role: "admin" });
    expect(afterShareRead.run).toBeNull();
    expect(await shareRole("doc", outsiderEmail)).toBe("admin");
    expect(await requestRow("doc")).toMatchObject({ granted_role: "admin" });
  });

  it("refuses a decision on a request someone already handled", async () => {
    await insertDoc("doc");
    const { id, generation } = await openRequest();
    await as(ownerEmail, () =>
      approveAccessRequest({ requestId: id, generation, role: "viewer" }),
    );

    expect(
      await errorOf(
        as(ownerEmail, () =>
          approveAccessRequest({ requestId: id, generation, role: "editor" }),
        ),
      ),
    ).toMatchObject({ errorCode: "access_request_stale", statusCode: 409 });
    expect(
      await errorOf(
        as(ownerEmail, () =>
          declineAccessRequest({ requestId: id, generation: generation + 1 }),
        ),
      ),
    ).toMatchObject({ errorCode: "access_request_stale" });
    expect(await shareRole("doc", outsiderEmail)).toBe("viewer");
  });

  it("lets nobody but a manager approve", async () => {
    await insertDoc("doc");
    await shareWith("doc", editorEmail, "editor");
    const { id, generation } = await openRequest();

    expect(
      await errorOf(
        as(editorEmail, () =>
          approveAccessRequest({ requestId: id, generation, role: "viewer" }),
        ),
      ),
    ).toMatchObject({ errorCode: "access_request_not_found" });
    expect(await shareRole("doc", outsiderEmail)).toBeNull();
  });

  it("follows sharing policy, and leaves the request pending when policy refuses", async () => {
    await insertDoc("org-doc", "org-1");
    orgMembers.add(`org-1:${ownerEmail}`);
    const { id, generation } = await openRequest("org-doc", orgOnlyType);

    const error = await errorOf(
      as(
        ownerEmail,
        () =>
          approveAccessRequest({ requestId: id, generation, role: "viewer" }),
        "org-1",
      ),
    );

    expect(error.message).toContain("is not in your organization");
    expect(await shareRole("org-doc", outsiderEmail)).toBeNull();
    expect(await requestRow("org-doc")).toMatchObject({ state: "pending" });

    orgMembers.add(`org-1:${outsiderEmail}`);
    expect(
      await as(
        ownerEmail,
        () =>
          approveAccessRequest({ requestId: id, generation, role: "viewer" }),
        "org-1",
      ),
    ).toEqual({ state: "approved", role: "viewer", email: "sent" });
  });

  it("declines quietly, and lets the requester ask again only after the cooldown", async () => {
    await insertDoc("doc");
    const { id, generation } = await openRequest();
    sendEmail.mockClear();
    notifyWithDelivery.mockClear();

    expect(
      await as(ownerEmail, () =>
        declineAccessRequest({ requestId: id, generation }),
      ),
    ).toEqual({ state: "declined" });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(
      await as(outsiderEmail, () => resolveLinkStatus(requestableType, "doc")),
    ).toMatchObject({ canRequest: false, request: { state: "pending" } });
    expect(await requestAs(outsiderEmail, "doc")).toMatchObject({
      sent: false,
    });
    expect(notifyWithDelivery).not.toHaveBeenCalled();

    await pglite.query(
      `UPDATE resource_access_requests SET decided_at = ? WHERE id = ?`,
      [Date.now() - ACCESS_REQUEST_DECLINE_COOLDOWN_MS - 1000, id],
    );
    expect(
      await as(outsiderEmail, () => resolveLinkStatus(requestableType, "doc")),
    ).toEqual({ state: "denied", canRequest: true });
    expect(await requestAs(outsiderEmail, "doc")).toMatchObject({
      sent: true,
    });
    expect(await requestRow("doc")).toMatchObject({
      id,
      state: "pending",
      generation: generation + 1,
    });
  });
});
