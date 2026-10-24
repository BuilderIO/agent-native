import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readAppSecret } from "@agent-native/core/secrets";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { verifyContentWebhook } from "../server/lib/content-webhook-signature.js";

// guard:allow-unscoped — isolated PGlite fixtures intentionally inspect rows directly.

const receiver = vi.hoisted(() => ({
  requests: [] as Array<{
    url: string;
    headers: Record<string, string>;
    body: string;
  }>,
  status: 200,
}));

// The real guard refuses every address a test could listen on, so the
// receiver is faked one layer below it: URL checks still run for real.
vi.mock("@agent-native/core/extensions/url-safety", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/extensions/url-safety")
  >()),
  ssrfSafeFetch: vi.fn(async (url: string, init: RequestInit) => {
    receiver.requests.push({
      url,
      headers: { ...(init.headers as Record<string, string>) },
      body: init.body as string,
    });
    return new Response(null, { status: receiver.status });
  }),
}));

const TEST_DB_PATH = join(
  tmpdir(),
  `content-webhooks-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "owner@example.com";
const STRANGER = "stranger@example.com";
const RECEIVER_URL = "https://hooks.example.com/content";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let hooks: typeof import("./_content-webhooks.js");
let createDatabase: typeof import("./create-content-database.js").default;
let configureProperty: typeof import("./configure-document-property.js").default;
let getDatabase: typeof import("./get-content-database.js").default;
let getDocument: typeof import("./get-document.js").default;
let createRow: typeof import("./add-database-item.js").default;
let updateRow: typeof import("./update-database-item.js").default;
let patchRows: typeof import("./patch-database-items.js").default;
let setProperty: typeof import("./set-document-property.js").default;
let addComment: typeof import("./add-comment.js").default;
let updateComment: typeof import("./update-comment.js").default;
let createWebhook: typeof import("./create-content-webhook.js").default;
let listWebhooks: typeof import("./list-content-webhooks.js").default;
let deleteWebhook: typeof import("./delete-content-webhook.js").default;

const asOwner = <T>(run: () => Promise<T>) =>
  runWithRequestContext({ userEmail: OWNER }, run) as Promise<T>;
const asStranger = <T>(run: () => Promise<T>) =>
  runWithRequestContext({ userEmail: STRANGER }, run) as Promise<T>;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  process.env.SECRETS_ENCRYPTION_KEY = "content-webhooks-test-key";
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  hooks = await import("./_content-webhooks.js");
  createDatabase = (await import("./create-content-database.js")).default;
  configureProperty = (await import("./configure-document-property.js"))
    .default;
  getDatabase = (await import("./get-content-database.js")).default;
  getDocument = (await import("./get-document.js")).default;
  createRow = (await import("./add-database-item.js")).default;
  updateRow = (await import("./update-database-item.js")).default;
  patchRows = (await import("./patch-database-items.js")).default;
  setProperty = (await import("./set-document-property.js")).default;
  addComment = (await import("./add-comment.js")).default;
  updateComment = (await import("./update-comment.js")).default;
  createWebhook = (await import("./create-content-webhook.js")).default;
  listWebhooks = (await import("./list-content-webhooks.js")).default;
  deleteWebhook = (await import("./delete-content-webhook.js")).default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

beforeEach(() => {
  receiver.requests.length = 0;
  receiver.status = 200;
});

async function fixture(rowCount = 1) {
  const created = await asOwner(() =>
    createDatabase.run({ title: "Webhook tasks" }),
  );
  const ids = {
    databaseId: created.database.id,
    databaseDocumentId: created.database.documentId,
  };
  const addProperty = async (
    name: string,
    type: "text" | "number" | "select",
    options?: unknown,
  ) => {
    const response = await asOwner(() =>
      configureProperty.run({
        documentId: ids.databaseDocumentId,
        databaseId: ids.databaseId,
        name,
        type,
        options: options as any,
      }),
    );
    return response.properties.find(
      (candidate) => candidate.definition.name === name,
    )!.definition.id;
  };
  const turn = await addProperty("Whose turn", "select", {
    options: [
      { id: "alice", name: "Alice", color: "blue" },
      { id: "agent", name: "Agent", color: "green" },
    ],
  });
  const notes = await addProperty("Notes", "text");
  const rank = await addProperty("Rank", "number");
  const rows = [];
  for (let index = 0; index < rowCount; index += 1) {
    const discovered = await contract(ids.databaseId);
    const row = await asOwner(() =>
      createRow.run({
        ...envelope(discovered, `seed-${ids.databaseId}-${index}`),
        title: `Task ${index + 1}`,
        propertyValues: { [turn]: "alice", [notes]: "first", [rank]: index },
      }),
    );
    rows.push({
      itemId: row.receipt.row.itemId,
      documentId: row.receipt.row.documentId,
    });
  }
  return { ...ids, properties: { turn, notes, rank }, rows };
}

async function contract(databaseId: string) {
  const response = await asOwner(() => getDatabase.run({ databaseId }));
  if (!("database" in response) || !response.mutationContract)
    throw new Error("Fixture database has no mutation contract.");
  return response.mutationContract;
}

function envelope(
  discovered: Awaited<ReturnType<typeof contract>>,
  idempotencyKey: string,
) {
  return {
    target: {
      spaceId: discovered.target.spaceId,
      databaseId: discovered.target.databaseId,
      databaseDocumentId: discovered.target.databaseDocumentId,
    },
    expectedSchemaRevision: discovered.schemaRevision,
    idempotencyKey,
  };
}

async function rowRevision(databaseId: string, itemId: string) {
  const response = await asOwner(() =>
    getDatabase.run({ databaseId, limit: 500 }),
  );
  if (!("items" in response)) throw new Error("Collection has no rows.");
  return response.items.find((item) => item.id === itemId)!
    .rowRevision as string;
}

async function deliveries(webhookId: string) {
  return getDb()
    .select()
    .from(schema.contentWebhookDeliveries)
    .where(eq(schema.contentWebhookDeliveries.webhookId, webhookId))
    .orderBy(schema.contentWebhookDeliveries.sequence);
}

/** Waits for the send that follows each change, then returns what arrived. */
async function settled(webhookId: string, count: number) {
  await vi.waitFor(
    async () => {
      const rows = await deliveries(webhookId);
      expect(rows).toHaveLength(count);
      for (const row of rows) {
        expect(row.leaseToken).toBeNull();
        expect(row.attempts).toBeGreaterThan(0);
      }
    },
    { timeout: 10_000, interval: 50 },
  );
  return deliveries(webhookId);
}

function eventsFor(webhookId: string) {
  return receiver.requests
    .map((request) => ({ ...request, event: JSON.parse(request.body) }))
    .filter((request) => request.event.webhookId === webhookId);
}

async function makeDue(webhookId: string, attempts?: number) {
  await getDb()
    .update(schema.contentWebhookDeliveries)
    .set({
      nextAttemptAt: new Date(Date.now() - 1000).toISOString(),
      ...(attempts === undefined ? {} : { attempts }),
    })
    .where(eq(schema.contentWebhookDeliveries.webhookId, webhookId));
}

describe("content webhooks", () => {
  it("W2-1: a property change sends one signed event with old and new value and who changed it", async () => {
    const ids = await fixture();
    const [row] = ids.rows;
    const { webhook, secret } = await asOwner(() =>
      createWebhook.run({
        url: RECEIVER_URL,
        databaseId: ids.databaseId,
        events: ["property.changed"],
        propertyIds: [ids.properties.turn],
      }),
    );

    // Notes is filtered out; an unchanged value sends nothing.
    await asOwner(() =>
      setProperty.run({
        documentId: row.documentId,
        databaseId: ids.databaseId,
        propertyId: ids.properties.notes,
        value: "second",
      }),
    );
    await asOwner(() =>
      setProperty.run(
        {
          documentId: row.documentId,
          databaseId: ids.databaseId,
          propertyId: ids.properties.turn,
          value: "agent",
        },
        { caller: "mcp", userEmail: OWNER } as any,
      ),
    );
    await asOwner(() =>
      setProperty.run({
        documentId: row.documentId,
        databaseId: ids.databaseId,
        propertyId: ids.properties.turn,
        value: "agent",
      }),
    );

    const [delivery] = await settled(webhook.id, 1);
    expect(delivery.status).toBe("delivered");
    const events = eventsFor(webhook.id);
    expect(events).toHaveLength(1);
    const [request] = events;
    expect(request.url).toBe(RECEIVER_URL);
    expect(request.headers["webhook-id"]).toBe(delivery.id);
    expect(
      verifyContentWebhook({
        secret,
        headers: request.headers,
        body: request.body,
      }),
    ).toBe(true);
    expect(
      verifyContentWebhook({
        secret,
        headers: request.headers,
        body: request.body.replace("agent", "alice"),
      }),
    ).toBe(false);
    expect(request.event).toMatchObject({
      id: delivery.id,
      type: "property.changed",
      webhookId: webhook.id,
      documentId: row.documentId,
      databaseId: ids.databaseId,
      actor: { kind: "agent", email: OWNER },
      data: {
        propertyId: ids.properties.turn,
        propertyName: "Whose turn",
        propertyType: "select",
        oldValue: "alice",
        newValue: "agent",
        oldLabel: "Alice",
        newLabel: "Agent",
      },
    });
    expect(typeof request.event.sequence).toBe("number");
  });

  it("W2-1: row updates and batch patches send one event per changed property, named for a person", async () => {
    const ids = await fixture(2);
    const { webhook } = await asOwner(() =>
      createWebhook.run({
        url: RECEIVER_URL,
        databaseId: ids.databaseId,
        events: ["property.changed"],
      }),
    );
    const [first, second] = ids.rows;

    const discovered = await contract(ids.databaseId);
    const expectedRowRevision = await rowRevision(ids.databaseId, first.itemId);
    // Rank stays 0, so only Notes changes.
    await asOwner(() =>
      updateRow.run({
        ...envelope(discovered, "update-first"),
        itemId: first.itemId,
        documentId: first.documentId,
        expectedRowRevision,
        propertyValues: {
          [ids.properties.notes]: "edited",
          [ids.properties.rank]: 0,
        },
      }),
    );
    await settled(webhook.id, 1);

    await asOwner(async () =>
      patchRows.run({
        ...envelope(await contract(ids.databaseId), "patch-both"),
        rows: await Promise.all(
          [first, second].map(async (row, index) => ({
            itemId: row.itemId,
            documentId: row.documentId,
            expectedRowRevision: await rowRevision(ids.databaseId, row.itemId),
            propertyEntries: [
              {
                propertyId: ids.properties.rank,
                propertyType: "number" as const,
                value: 10 + index,
              },
            ],
          })),
        ),
      }),
    );

    await settled(webhook.id, 3);
    const events = eventsFor(webhook.id).map((request) => request.event);
    expect(events).toHaveLength(3);
    expect(
      events.map((event) => [
        event.documentId,
        event.data.propertyName,
        event.data.oldValue,
        event.data.newValue,
      ]),
    ).toEqual([
      [first.documentId, "Notes", "first", "edited"],
      [first.documentId, "Rank", 0, 10],
      [second.documentId, "Rank", 1, 11],
    ]);
    for (const event of events) {
      expect(event.actor).toEqual({ kind: "human", email: OWNER });
    }
  });

  it("W2-2: creating or resolving a comment sends one event each", async () => {
    const ids = await fixture();
    const [row] = ids.rows;
    const { webhook: pageHook } = await asOwner(() =>
      createWebhook.run({
        url: RECEIVER_URL,
        documentId: row.documentId,
        events: ["comment.created", "comment.resolved"],
      }),
    );
    const { webhook: propertyOnly } = await asOwner(() =>
      createWebhook.run({
        url: RECEIVER_URL,
        databaseId: ids.databaseId,
        events: ["property.changed"],
      }),
    );

    const comment = await asOwner(() =>
      addComment.run({ documentId: row.documentId, content: "Your turn" }),
    );
    await settled(pageHook.id, 1);
    await asOwner(() => updateComment.run({ id: comment.id, resolved: true }));
    await settled(pageHook.id, 2);
    // Resolving an already resolved thread is not a new event.
    await asOwner(() => updateComment.run({ id: comment.id, resolved: true }));

    const events = eventsFor(pageHook.id).map((request) => request.event);
    expect(events.map((event) => event.type)).toEqual([
      "comment.created",
      "comment.resolved",
    ]);
    expect(events[0]).toMatchObject({
      documentId: row.documentId,
      databaseId: ids.databaseId,
      actor: { kind: "human", email: OWNER },
      data: {
        commentId: comment.id,
        threadId: comment.id,
        parentId: null,
        authorEmail: OWNER,
        content: "Your turn",
        resolved: false,
      },
    });
    expect(events[1].data).toMatchObject({
      commentId: comment.id,
      resolved: true,
    });
    expect(await deliveries(pageHook.id)).toHaveLength(2);
    expect(await deliveries(propertyOnly.id)).toHaveLength(0);
  });

  it("W2-3: a failing receiver is retried with the same event ID and body", async () => {
    const ids = await fixture();
    const [row] = ids.rows;
    const { webhook } = await asOwner(() =>
      createWebhook.run({
        url: RECEIVER_URL,
        documentId: row.documentId,
        events: ["property.changed"],
      }),
    );
    receiver.status = 503;
    await asOwner(() =>
      setProperty.run({
        documentId: row.documentId,
        databaseId: ids.databaseId,
        propertyId: ids.properties.turn,
        value: "agent",
      }),
    );
    const [firstTry] = await settled(webhook.id, 1);
    expect(firstTry).toMatchObject({
      status: "pending",
      attempts: 1,
      lastStatusCode: 503,
    });
    const retryIn = Date.parse(firstTry.nextAttemptAt) - Date.now();
    expect(retryIn).toBeGreaterThan(5_000);
    expect(retryIn).toBeLessThanOrEqual(10_000);
    // Not due yet: a sweep now leaves it alone.
    expect(await hooks.drainContentWebhookDeliveries()).toEqual({
      delivered: 0,
      failed: 0,
      retrying: 0,
    });

    await makeDue(webhook.id);
    expect(await hooks.drainContentWebhookDeliveries()).toMatchObject({
      retrying: 1,
    });
    receiver.status = 200;
    await makeDue(webhook.id);
    expect(await hooks.drainContentWebhookDeliveries()).toMatchObject({
      delivered: 1,
    });

    const attempts = eventsFor(webhook.id);
    expect(attempts).toHaveLength(3);
    expect(
      new Set(attempts.map((request) => request.headers["webhook-id"])),
    ).toEqual(new Set([firstTry.id]));
    expect(new Set(attempts.map((request) => request.body)).size).toBe(1);
    const [done] = await deliveries(webhook.id);
    expect(done).toMatchObject({ status: "delivered", attempts: 3 });
  });

  it("W2-3: gives up after the last attempt, and at once when the receiver can never work", async () => {
    const ids = await fixture();
    const [row] = ids.rows;
    const { webhook } = await asOwner(() =>
      createWebhook.run({
        url: RECEIVER_URL,
        documentId: row.documentId,
        events: ["property.changed"],
      }),
    );
    receiver.status = 500;
    await asOwner(() =>
      setProperty.run({
        documentId: row.documentId,
        databaseId: ids.databaseId,
        propertyId: ids.properties.turn,
        value: "agent",
      }),
    );
    await settled(webhook.id, 1);
    await makeDue(webhook.id, hooks.CONTENT_WEBHOOK_MAX_ATTEMPTS - 1);
    expect(await hooks.drainContentWebhookDeliveries()).toMatchObject({
      failed: 1,
    });
    const [exhausted] = await deliveries(webhook.id);
    expect(exhausted).toMatchObject({
      status: "failed",
      attempts: hooks.CONTENT_WEBHOOK_MAX_ATTEMPTS,
    });

    // A receiver that moved to a private address is never tried.
    await getDb()
      .update(schema.contentWebhooks)
      .set({ url: "https://127.0.0.1/content" })
      .where(eq(schema.contentWebhooks.id, webhook.id));
    receiver.requests.length = 0;
    await asOwner(() =>
      setProperty.run({
        documentId: row.documentId,
        databaseId: ids.databaseId,
        propertyId: ids.properties.turn,
        value: "alice",
      }),
    );
    const [, blocked] = await settled(webhook.id, 2);
    expect(blocked).toMatchObject({ status: "failed", attempts: 1 });
    expect(receiver.requests).toHaveLength(0);
  });

  it("W2-4: registers, lists and removes a webhook, and keeps others out", async () => {
    const ids = await fixture();
    const created = await asOwner(() =>
      createWebhook.run({
        url: RECEIVER_URL,
        databaseId: ids.databaseId,
        events: ["property.changed", "comment.created"],
        propertyIds: [ids.properties.turn],
        description: "Wake the task thread",
      }),
    );
    expect(created.secret).toMatch(/^whsec_[A-Za-z0-9+/]+=*$/);
    expect(created.webhook).toMatchObject({
      id: expect.stringMatching(/^wh_/),
      url: RECEIVER_URL,
      databaseId: ids.databaseId,
      documentId: null,
      events: ["property.changed", "comment.created"],
      propertyIds: [ids.properties.turn],
      description: "Wake the task thread",
      createdBy: OWNER,
    });

    await asOwner(() =>
      setProperty.run({
        documentId: ids.rows[0].documentId,
        databaseId: ids.databaseId,
        propertyId: ids.properties.turn,
        value: "agent",
      }),
    );
    await settled(created.webhook.id, 1);
    // A busier webhook on the same collection can't crowd this one out.
    const { webhook: busy } = await asOwner(() =>
      createWebhook.run({
        url: RECEIVER_URL,
        databaseId: ids.databaseId,
        events: ["property.changed"],
        propertyIds: [ids.properties.rank],
      }),
    );
    for (let rank = 1; rank <= 6; rank += 1) {
      await asOwner(() =>
        setProperty.run({
          documentId: ids.rows[0].documentId,
          databaseId: ids.databaseId,
          propertyId: ids.properties.rank,
          value: rank,
        }),
      );
    }
    await settled(busy.id, 6);

    const byScope = await asOwner(() =>
      listWebhooks.run({ databaseId: ids.databaseId }),
    );
    expect(byScope.webhooks).toHaveLength(2);
    const listed = (id: string) =>
      byScope.webhooks.find((hook) => hook.id === id)!;
    expect(listed(created.webhook.id).recentDeliveries).toMatchObject([
      { type: "property.changed", status: "delivered", attempts: 1 },
    ]);
    expect(listed(busy.id).recentDeliveries).toHaveLength(5);
    expect(JSON.stringify(byScope)).not.toContain(created.secret);
    const mine = await asOwner(() => listWebhooks.run({}));
    expect(mine.webhooks.map((hook) => hook.id)).toContain(created.webhook.id);

    await expect(
      asStranger(() => listWebhooks.run({ databaseId: ids.databaseId })),
    ).rejects.toThrow();
    await expect(
      asStranger(() =>
        createWebhook.run({
          url: RECEIVER_URL,
          databaseId: ids.databaseId,
          events: ["property.changed"],
        }),
      ),
    ).rejects.toThrow();
    await expect(
      asStranger(() => deleteWebhook.run({ id: created.webhook.id })),
    ).rejects.toMatchObject({ errorCode: "WEBHOOK_NOT_FOUND" });
    expect((await asStranger(() => listWebhooks.run({}))).webhooks).toEqual([]);

    const secretRef = {
      key: `content-webhook:${created.webhook.id}`,
      scope: "user" as const,
      scopeId: OWNER,
    };
    expect((await readAppSecret(secretRef))?.value).toBe(created.secret);
    await expect(
      asOwner(() => deleteWebhook.run({ id: created.webhook.id })),
    ).resolves.toEqual({ ok: true, id: created.webhook.id });
    expect(await readAppSecret(secretRef)).toBeNull();
    expect(
      (
        await asOwner(() => listWebhooks.run({ databaseId: ids.databaseId }))
      ).webhooks.map((hook) => hook.id),
    ).toEqual([busy.id]);
  });

  it("W2-4: refuses URLs it can't safely call and properties outside the scope", async () => {
    const ids = await fixture();
    const other = await fixture();
    const base = {
      databaseId: ids.databaseId,
      events: ["property.changed" as const],
    };
    for (const url of [
      "http://hooks.example.com/content",
      "https://127.0.0.1/content",
      "https://10.0.0.8/content",
      "https://localhost/content",
    ]) {
      await expect(
        asOwner(() => createWebhook.run({ ...base, url })),
      ).rejects.toMatchObject({ errorCode: "WEBHOOK_URL_NOT_ALLOWED" });
    }
    await expect(
      asOwner(() =>
        createWebhook.run({
          ...base,
          url: RECEIVER_URL,
          propertyIds: [other.properties.turn],
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "WEBHOOK_PROPERTY_NOT_FOUND" });
    await expect(
      asOwner(() =>
        createWebhook.run({
          url: RECEIVER_URL,
          databaseId: ids.databaseId,
          documentId: ids.rows[0].documentId,
          events: ["property.changed"],
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "WEBHOOK_SCOPE_REQUIRED" });
    const stored = await getDb()
      .select()
      .from(schema.contentWebhooks)
      .where(
        and(
          eq(schema.contentWebhooks.scopeType, "database"),
          eq(schema.contentWebhooks.scopeId, ids.databaseId),
        ),
      );
    expect(stored).toEqual([]);
  });
});

describe("property generations", () => {
  async function readItem(databaseId: string, itemId: string) {
    const response = await asOwner(() =>
      getDatabase.run({ databaseId, limit: 500 }),
    );
    if (!("items" in response)) throw new Error("Collection has no rows.");
    return response.items.find((item) => item.id === itemId)!;
  }

  async function storedValue(documentId: string, propertyId: string) {
    const [row] = await getDb()
      .select({ valueJson: schema.documentPropertyValues.valueJson })
      .from(schema.documentPropertyValues)
      .where(
        and(
          eq(schema.documentPropertyValues.documentId, documentId),
          eq(schema.documentPropertyValues.propertyId, propertyId),
        ),
      );
    return row ? JSON.parse(row.valueJson) : undefined;
  }

  const setTurn = (
    ids: Awaited<ReturnType<typeof fixture>>,
    value: string,
    expectedGeneration?: number,
  ) =>
    asOwner(() =>
      setProperty.run({
        documentId: ids.rows[0].documentId,
        databaseId: ids.databaseId,
        propertyId: ids.properties.turn,
        value,
        ...(expectedGeneration === undefined ? {} : { expectedGeneration }),
      }),
    );

  it("goes up on every change, A to B to A included, and reads and events carry it", async () => {
    const ids = await fixture();
    const [row] = ids.rows;
    const { webhook } = await asOwner(() =>
      createWebhook.run({
        url: RECEIVER_URL,
        databaseId: ids.databaseId,
        events: ["property.changed"],
        propertyIds: [ids.properties.turn],
      }),
    );
    const before = await readItem(ids.databaseId, row.itemId);
    const start = before.propertyGenerations![ids.properties.turn];
    expect(start).toBeGreaterThan(0);
    expect(Object.keys(before.propertyGenerations!)).toEqual(
      expect.arrayContaining(Object.values(ids.properties)),
    );
    expect(Object.keys(before.propertyGenerations!)).toHaveLength(3);
    const page = await asOwner(() =>
      getDocument.run({ id: row.documentId, databaseId: ids.databaseId }),
    );
    expect(page.propertyGenerations).toEqual(before.propertyGenerations);

    const toAgent = await setTurn(ids, "agent");
    const backToAlice = await setTurn(ids, "alice");
    const unchanged = await setTurn(ids, "alice");
    expect(toAgent.generation).toBeGreaterThan(start);
    expect(backToAlice.generation).toBeGreaterThan(toAgent.generation);
    expect(unchanged.generation).toBe(backToAlice.generation);

    // The row revision hashes values, so it can't tell A from A → B → A.
    const after = await readItem(ids.databaseId, row.itemId);
    expect(after.rowRevision).toBe(before.rowRevision);
    expect(after.propertyGenerations![ids.properties.turn]).toBe(
      backToAlice.generation,
    );
    expect(after.propertyGenerations![ids.properties.notes]).toBe(
      before.propertyGenerations![ids.properties.notes],
    );

    await settled(webhook.id, 2);
    expect(
      eventsFor(webhook.id).map((request) => [
        request.event.data.newValue,
        request.event.data.generation,
      ]),
    ).toEqual([
      ["agent", toAgent.generation],
      ["alice", backToAlice.generation],
    ]);
  });

  it("set-document-property with a stale expectedGeneration writes nothing", async () => {
    const ids = await fixture();
    const [row] = ids.rows;
    const read = (await readItem(ids.databaseId, row.itemId))
      .propertyGenerations![ids.properties.turn];
    await setTurn(ids, "agent");
    const current = (await setTurn(ids, "alice")).generation;

    // A finish computed from the first read must not land on the new turn.
    await expect(setTurn(ids, "agent", read)).rejects.toMatchObject({
      errorCode: "PROPERTY_GENERATION_CONFLICT",
      statusCode: 409,
      details: {
        documentId: row.documentId,
        conflicts: [
          { propertyId: ids.properties.turn, expected: read, current },
        ],
      },
    });
    expect(await storedValue(row.documentId, ids.properties.turn)).toBe(
      "alice",
    );

    const written = await setTurn(ids, "agent", current);
    expect(written.generation).toBeGreaterThan(current);
    expect(await storedValue(row.documentId, ids.properties.turn)).toBe(
      "agent",
    );
  });

  it("update-database-item and patch-database-items refuse a stale generation the row revision misses", async () => {
    const ids = await fixture(2);
    const [first, second] = ids.rows;
    const firstRead = await readItem(ids.databaseId, first.itemId);
    const secondRead = await readItem(ids.databaseId, second.itemId);
    await setTurn(ids, "agent");
    await setTurn(ids, "alice");

    const discovered = await contract(ids.databaseId);
    const update = (key: string, generations: Record<string, number>) =>
      asOwner(() =>
        updateRow.run({
          ...envelope(discovered, key),
          itemId: first.itemId,
          documentId: first.documentId,
          expectedRowRevision: firstRead.rowRevision!,
          expectedPropertyGenerations: generations,
          propertyValues: { [ids.properties.notes]: "done" },
        }),
      );
    await expect(
      update("stale-update", {
        [ids.properties.turn]:
          firstRead.propertyGenerations![ids.properties.turn],
      }),
    ).rejects.toMatchObject({
      errorCode: "PROPERTY_GENERATION_CONFLICT",
      details: {
        documentId: first.documentId,
        conflicts: [{ propertyId: ids.properties.turn }],
      },
    });
    expect(await storedValue(first.documentId, ids.properties.notes)).toBe(
      "first",
    );

    const fresh = (await readItem(ids.databaseId, first.itemId))
      .propertyGenerations!;
    const updated = await update("fresh-update", {
      [ids.properties.turn]: fresh[ids.properties.turn],
    });
    expect(updated.receipt.readback.propertyValues).toMatchObject({
      [ids.properties.notes]: "done",
    });
    expect(
      updated.receipt.readback.propertyGenerations![ids.properties.notes],
    ).toBeGreaterThan(fresh[ids.properties.notes]);

    const firstNow = await readItem(ids.databaseId, first.itemId);
    const patch = (key: string, secondTurn: number) =>
      asOwner(async () =>
        patchRows.run({
          ...envelope(await contract(ids.databaseId), key),
          rows: [
            {
              itemId: first.itemId,
              documentId: first.documentId,
              expectedRowRevision: firstNow.rowRevision!,
              expectedPropertyGenerations: {
                [ids.properties.turn]:
                  firstNow.propertyGenerations![ids.properties.turn],
              },
              propertyEntries: [
                {
                  propertyId: ids.properties.rank,
                  propertyType: "number" as const,
                  value: 20,
                },
              ],
            },
            {
              itemId: second.itemId,
              documentId: second.documentId,
              expectedRowRevision: secondRead.rowRevision!,
              expectedPropertyGenerations: {
                [ids.properties.turn]: secondTurn,
              },
              propertyEntries: [
                {
                  propertyId: ids.properties.rank,
                  propertyType: "number" as const,
                  value: 21,
                },
              ],
            },
          ],
        }),
      );
    await expect(
      patch(
        "stale-patch",
        secondRead.propertyGenerations![ids.properties.turn] + 1,
      ),
    ).rejects.toMatchObject({
      errorCode: "PROPERTY_GENERATION_CONFLICT",
      details: {
        rows: [
          {
            index: 1,
            itemId: second.itemId,
            documentId: second.documentId,
            conflicts: [{ propertyId: ids.properties.turn }],
          },
        ],
      },
    });
    expect(await storedValue(first.documentId, ids.properties.rank)).toBe(0);

    const patched = await patch(
      "fresh-patch",
      secondRead.propertyGenerations![ids.properties.turn],
    );
    expect(
      patched.receipt.rows.map((receipt) =>
        Object.keys(receipt.readback.propertyGenerations ?? {}),
      ),
    ).toEqual([[ids.properties.rank], [ids.properties.rank]]);
    expect(await storedValue(first.documentId, ids.properties.rank)).toBe(20);
  });
});
