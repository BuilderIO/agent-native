import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  deleteAppSecret,
  readAppSecret,
  writeAppSecret,
} from "@agent-native/core/secrets";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq, inArray, sql } from "drizzle-orm";
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
import { firstRow } from "../server/lib/first-row.js";

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
// receiver is faked one layer below it: URL checks still run for real, except
// that names resolve without a network. TAILNET_HOST resolves to a Tailnet
// (100.64.0.0/10) address and every other name to a public one.
vi.mock("@agent-native/core/extensions/url-safety", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@agent-native/core/extensions/url-safety")
    >();
  return {
    ...actual,
    isBlockedExtensionUrlWithDns: vi.fn(
      async (url: string) =>
        actual.isBlockedExtensionUrl(url) ||
        new URL(url).hostname === "receiver.tail1234.ts.net",
    ),
    ssrfSafeFetch: vi.fn(async (url: string, init: RequestInit) => {
      receiver.requests.push({
        url,
        headers: { ...(init.headers as Record<string, string>) },
        body: init.body as string,
      });
      return new Response(null, { status: receiver.status });
    }),
  };
});

const tombstoneReads = vi.hoisted(() => ({
  /** Runs once, right after the next tombstone read and before its values. */
  thenWrite: null as null | (() => Promise<void>),
}));

// Lets a test land a write between a read's tombstones and its values, the
// race a read's generations and change IDs must not fall into.
vi.mock("./_property-generations.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./_property-generations.js")>();
  return {
    ...actual,
    readPropertyTombstones: async (
      ...args: Parameters<typeof actual.readPropertyTombstones>
    ) => {
      const stored = await actual.readPropertyTombstones(...args);
      const write = tombstoneReads.thenWrite;
      tombstoneReads.thenWrite = null;
      if (write) await write();
      return stored;
    },
  };
});

type LockTx = Parameters<
  (typeof import("./_content-database-mutation-lock.js"))["lockContentDatabaseMutation"]
>[0];

const lockHook = vi.hoisted(() => ({
  /** Runs once inside the next collection lock call, just before the lock. */
  beforeNext: null as null | ((tx: LockTx) => Promise<unknown>),
}));

// Lets a test land a write between a source writer's unlocked scan and the
// locked write that follows it.
vi.mock("./_content-database-mutation-lock.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("./_content-database-mutation-lock.js")
    >();
  return {
    ...actual,
    lockContentDatabaseMutation: async (
      ...args: Parameters<typeof actual.lockContentDatabaseMutation>
    ) => {
      const write = lockHook.beforeNext;
      lockHook.beforeNext = null;
      if (write) await write(args[0]);
      return actual.lockContentDatabaseMutation(...args);
    },
  };
});

const TEST_DB_PATH = join(
  tmpdir(),
  `content-webhooks-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "owner@example.com";
const STRANGER = "stranger@example.com";
const COLLABORATOR = "collaborator@example.com";
const RECEIVER_URL = "https://hooks.example.com/content";

type Schema = typeof import("../server/db/schema.js");

function found<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`${what} not found.`);
  return value;
}

/** One property's generation in a read; throws when the read has none. */
function generationOf(
  read: { propertyGenerations?: Record<string, number> },
  propertyId: string,
): number {
  return found(
    read.propertyGenerations?.[propertyId],
    `Generation of ${propertyId}`,
  );
}

/** One property's change ID in a read, null when empty; throws when the read has none. */
function changeIdOf(
  read: { propertyChangeIds?: Record<string, number | null> },
  propertyId: string,
): number | null {
  return found(
    read.propertyChangeIds?.[propertyId],
    `Change ID of ${propertyId}`,
  );
}

let getDb: (typeof import("../server/db/index.js"))["getDb"];
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
let trashDatabase: typeof import("./delete-content-database.js").default;
let restoreDatabase: typeof import("./restore-content-database.js").default;
let deleteDocumentRecursive: typeof import("./delete-document.js").deleteDocumentRecursive;

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
  trashDatabase = (await import("./delete-content-database.js")).default;
  restoreDatabase = (await import("./restore-content-database.js")).default;
  deleteDocumentRecursive = (await import("./delete-document.js"))
    .deleteDocumentRecursive;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
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
    options?: Parameters<typeof configureProperty.run>[0]["options"],
  ) => {
    const response = await asOwner(() =>
      configureProperty.run({
        documentId: ids.databaseDocumentId,
        databaseId: ids.databaseId,
        name,
        type,
        options,
      }),
    );
    return found(
      response.properties.find(
        (candidate) => candidate.definition.name === name,
      ),
      `Property ${name}`,
    ).definition.id;
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
  return found(
    response.items.find((item) => item.id === itemId),
    `Row ${itemId}`,
  ).rowRevision as string;
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
        { caller: "mcp", userEmail: OWNER },
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

  it("W2-2: resolving a thread while editing its first comment sends the new text", async () => {
    const ids = await fixture();
    const [row] = ids.rows;
    const { webhook } = await asOwner(() =>
      createWebhook.run({
        url: RECEIVER_URL,
        documentId: row.documentId,
        events: ["comment.resolved"],
      }),
    );
    const comment = await asOwner(() =>
      addComment.run({ documentId: row.documentId, content: "Draft" }),
    );
    await asOwner(() =>
      updateComment.run({
        id: comment.id,
        content: "Done, back to you",
        resolved: true,
      }),
    );
    await settled(webhook.id, 1);
    expect(eventsFor(webhook.id).map((request) => request.event)).toMatchObject(
      [
        {
          type: "comment.resolved",
          data: { commentId: comment.id, content: "Done, back to you" },
        },
      ],
    );
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

  it("W2-3: retries while the signing secret can't be read, and sends once it's back", async () => {
    const ids = await fixture();
    const [row] = ids.rows;
    const created = await asOwner(() =>
      createWebhook.run({
        url: RECEIVER_URL,
        documentId: row.documentId,
        events: ["property.changed"],
      }),
    );
    const [stored] = await getDb()
      .select()
      .from(schema.contentWebhooks)
      .where(eq(schema.contentWebhooks.id, created.webhook.id));
    const secretRef = hooks.contentWebhookSecretRef(stored);
    // A secret that won't decrypt, after a key rotation say, reads as missing.
    await deleteAppSecret(secretRef);
    await asOwner(() =>
      setProperty.run({
        documentId: row.documentId,
        databaseId: ids.databaseId,
        propertyId: ids.properties.turn,
        value: "agent",
      }),
    );
    const [waiting] = await settled(created.webhook.id, 1);
    expect(waiting).toMatchObject({ status: "pending", attempts: 1 });
    expect(waiting.lastError).toMatch(/signing secret/);
    expect(receiver.requests).toHaveLength(0);

    await writeAppSecret({
      ...secretRef,
      value: created.secret,
      description: "Content webhook signing secret",
    });
    await makeDue(created.webhook.id);
    expect(await hooks.drainContentWebhookDeliveries()).toMatchObject({
      delivered: 1,
    });
    expect(receiver.requests).toHaveLength(1);
  });

  it("purges settled deliveries in batches and keeps recent ones", async () => {
    const ids = await fixture();
    const [row] = ids.rows;
    const { webhook } = await asOwner(() =>
      createWebhook.run({
        url: RECEIVER_URL,
        documentId: row.documentId,
        events: ["property.changed"],
      }),
    );
    for (const value of ["agent", "alice", "agent", "alice", "agent"]) {
      await asOwner(() =>
        setProperty.run({
          documentId: row.documentId,
          databaseId: ids.databaseId,
          propertyId: ids.properties.turn,
          value,
        }),
      );
    }
    const sent = await settled(webhook.id, 5);
    // The four oldest are past the seven days a delivered event is kept.
    await getDb()
      .update(schema.contentWebhookDeliveries)
      .set({
        updatedAt: new Date(Date.now() - 8 * 24 * 60 * 60_000).toISOString(),
      })
      .where(
        inArray(
          schema.contentWebhookDeliveries.id,
          sent.slice(0, 4).map((delivery) => delivery.id),
        ),
      );
    await hooks.purgeSettledContentWebhookDeliveries({ batchSize: 3 });
    expect(
      (await deliveries(webhook.id)).map((delivery) => delivery.id),
    ).toEqual([sent[4].id]);
  });

  it("W2-3: events wait while their collection is in Trash and go out once it's restored", async () => {
    const ids = await fixture();
    const [row] = ids.rows;
    const { webhook } = await asOwner(() =>
      createWebhook.run({
        url: RECEIVER_URL,
        databaseId: ids.databaseId,
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
    const [queued] = await settled(webhook.id, 1);
    await asOwner(() => trashDatabase.run({ databaseId: ids.databaseId }));
    receiver.status = 200;
    receiver.requests.length = 0;

    // In Trash, the event waits without using up an attempt.
    for (let check = 0; check < hooks.CONTENT_WEBHOOK_MAX_ATTEMPTS; check++) {
      await makeDue(webhook.id);
      expect(await hooks.drainContentWebhookDeliveries()).toEqual({
        delivered: 0,
        failed: 0,
        retrying: 1,
      });
    }
    const [waiting] = await deliveries(webhook.id);
    expect(waiting).toMatchObject({
      status: "pending",
      attempts: queued.attempts,
      lastError: expect.stringContaining("Trash"),
    });
    expect(Date.parse(waiting.nextAttemptAt)).toBeGreaterThan(Date.now());
    expect(receiver.requests).toHaveLength(0);

    await asOwner(() => restoreDatabase.run({ databaseId: ids.databaseId }));
    await makeDue(webhook.id);
    expect(await hooks.drainContentWebhookDeliveries()).toMatchObject({
      delivered: 1,
    });
    expect(eventsFor(webhook.id)).toHaveLength(1);
    expect((await deliveries(webhook.id))[0]).toMatchObject({
      status: "delivered",
    });
  });

  it("W2-3: stops sending in the same run once the creator loses access", async () => {
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
    for (const value of ["agent", "alice"]) {
      await asOwner(() =>
        setProperty.run({
          documentId: row.documentId,
          databaseId: ids.databaseId,
          propertyId: ids.properties.turn,
          value,
        }),
      );
    }
    await settled(webhook.id, 2);
    await makeDue(webhook.id);

    // Access is revoked while the first send is in flight.
    const sent: string[] = [];
    const counts = await hooks.drainContentWebhookDeliveries({
      transport: async (request) => {
        sent.push(request.headers["webhook-id"]);
        await getDb()
          .update(schema.contentWebhooks)
          .set({ createdBy: STRANGER })
          .where(eq(schema.contentWebhooks.id, webhook.id));
        return { ok: true, status: 200 };
      },
    });
    expect(counts).toMatchObject({ delivered: 1, failed: 1 });
    expect(sent).toHaveLength(1);
    const [, second] = await deliveries(webhook.id);
    expect(second).toMatchObject({ status: "failed" });
    expect(second.lastError).toMatch(/no longer manages/);
  });

  it("W2-1: a collection webhook sends nothing from a row its creator can't open", async () => {
    const ids = await fixture(2);
    const [open, closed] = ids.rows;
    const { webhook } = await asOwner(() =>
      createWebhook.run({
        url: RECEIVER_URL,
        databaseId: ids.databaseId,
        events: ["property.changed", "comment.created"],
      }),
    );
    // The webhook now belongs to an admin of the collection who can open
    // only the first row's page.
    const now = new Date().toISOString();
    await getDb()
      .insert(schema.documentShares)
      .values([
        {
          id: `${webhook.id}-collection`,
          resourceId: ids.databaseDocumentId,
          principalType: "user",
          principalId: COLLABORATOR,
          role: "admin",
          createdBy: OWNER,
          createdAt: now,
        },
        {
          id: `${webhook.id}-row`,
          resourceId: open.documentId,
          principalType: "user",
          principalId: COLLABORATOR,
          role: "viewer",
          createdBy: OWNER,
          createdAt: now,
        },
      ]);
    await getDb()
      .update(schema.contentWebhooks)
      .set({ createdBy: COLLABORATOR })
      .where(eq(schema.contentWebhooks.id, webhook.id));

    for (const row of [open, closed]) {
      await asOwner(() =>
        setProperty.run({
          documentId: row.documentId,
          databaseId: ids.databaseId,
          propertyId: ids.properties.turn,
          value: "agent",
        }),
      );
      await asOwner(() =>
        addComment.run({ documentId: row.documentId, content: "Private note" }),
      );
    }
    const sent = await settled(webhook.id, 4);
    expect(
      eventsFor(webhook.id).map((request) => [
        request.event.type,
        request.event.documentId,
      ]),
    ).toEqual([
      ["property.changed", open.documentId],
      ["comment.created", open.documentId],
    ]);
    const refused = sent.filter(
      (delivery: { documentId: string }) =>
        delivery.documentId === closed.documentId,
    );
    expect(refused).toHaveLength(2);
    for (const delivery of refused) {
      expect(delivery).toMatchObject({ status: "failed", attempts: 1 });
      expect(delivery.lastError).toMatch(/can't open this row's page/);
    }
  });

  it("W2-3: a slow receiver doesn't hold up another webhook's events", async () => {
    const ids = await fixture(2);
    const [slowRow, fastRow] = ids.rows;
    const watch = (documentId: string) =>
      asOwner(() =>
        createWebhook.run({
          url: RECEIVER_URL,
          documentId,
          events: ["property.changed"],
        }),
      );
    const { webhook: slow } = await watch(slowRow.documentId);
    const { webhook: fast } = await watch(fastRow.documentId);
    receiver.status = 500;
    // The slow webhook's events are older, so they come first in line.
    for (const value of ["agent", "alice", "agent"]) {
      await asOwner(() =>
        setProperty.run({
          documentId: slowRow.documentId,
          databaseId: ids.databaseId,
          propertyId: ids.properties.turn,
          value,
        }),
      );
    }
    // More than one claim's worth, so the fast webhook needs a second one.
    for (const value of ["agent", "alice", "agent", "alice"]) {
      await asOwner(() =>
        setProperty.run({
          documentId: fastRow.documentId,
          databaseId: ids.databaseId,
          propertyId: ids.properties.turn,
          value,
        }),
      );
    }
    await settled(slow.id, 3);
    await settled(fast.id, 4);
    await makeDue(slow.id);
    await makeDue(fast.id);

    // The slow receiver answers only once all the other webhook's events
    // have been sent, or gives up after two seconds.
    let markFastSent!: () => void;
    const fastSent = new Promise<void>((resolve) => {
      markFastSent = resolve;
    });
    const order: string[] = [];
    await hooks.drainContentWebhookDeliveries({
      transport: async (request) => {
        const { webhookId } = JSON.parse(request.body);
        if (webhookId === fast.id) {
          order.push("fast");
          if (order.filter((entry) => entry === "fast").length === 4) {
            markFastSent();
          }
        } else if (webhookId === slow.id) {
          const served = await Promise.race([
            fastSent.then(() => true),
            new Promise<boolean>((resolve) =>
              setTimeout(() => resolve(false), 2_000),
            ),
          ]);
          order.push(served ? "slow" : "slow, before fast");
        }
        return { ok: true, status: 200 };
      },
    });
    expect(order).toEqual([
      "fast",
      "fast",
      "fast",
      "fast",
      "slow",
      "slow",
      "slow",
    ]);
  });

  it("W2-3: drains running at once send one webhook's events one at a time", async () => {
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
    for (const value of ["agent", "alice", "agent", "alice"]) {
      await asOwner(() =>
        setProperty.run({
          documentId: row.documentId,
          databaseId: ids.databaseId,
          propertyId: ids.properties.turn,
          value,
        }),
      );
    }
    await settled(webhook.id, 4);
    await makeDue(webhook.id);

    // The first request waits until a second drain has run.
    let inFlight = 0;
    let mostInFlight = 0;
    let calls = 0;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const transport: import("./_content-webhooks.js").ContentWebhookTransport =
      async () => {
        calls++;
        inFlight++;
        mostInFlight = Math.max(mostInFlight, inFlight);
        if (calls === 1) {
          markStarted();
          await released;
        }
        inFlight--;
        return { ok: true, status: 200 };
      };
    const first = hooks.drainContentWebhookDeliveries({ transport });
    await started;
    const second = await hooks.drainContentWebhookDeliveries({ transport });
    release();
    expect(second.delivered).toBe(0);
    expect((await first).delivered).toBe(4);
    expect(mostInFlight).toBe(1);
    expect(calls).toBe(4);
  });

  it("W2-1: marks a long value or comment as cut short", async () => {
    const ids = await fixture();
    const [row] = ids.rows;
    const { webhook } = await asOwner(() =>
      createWebhook.run({
        url: RECEIVER_URL,
        documentId: row.documentId,
        events: ["property.changed", "comment.created"],
      }),
    );
    await asOwner(() =>
      setProperty.run({
        documentId: row.documentId,
        databaseId: ids.databaseId,
        propertyId: ids.properties.notes,
        value: "n".repeat(16_001),
      }),
    );
    await asOwner(() =>
      addComment.run({ documentId: row.documentId, content: "short" }),
    );
    await asOwner(() =>
      addComment.run({
        documentId: row.documentId,
        content: "c".repeat(2_001),
      }),
    );
    await settled(webhook.id, 3);
    const [value, short, long] = eventsFor(webhook.id).map(
      (request) => request.event.data,
    );
    expect(value.newValue).toHaveLength(16_000);
    expect(value.truncated).toBe(true);
    expect(short).toMatchObject({ content: "short", truncated: false });
    expect(long.content).toHaveLength(2_000);
    expect(long.truncated).toBe(true);
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
    const busySent = await settled(busy.id, 6);

    const byScope = await asOwner(() =>
      listWebhooks.run({ databaseId: ids.databaseId }),
    );
    expect(byScope.webhooks).toHaveLength(2);
    const listed = (id: string) =>
      found(
        byScope.webhooks.find((hook) => hook.id === id),
        `Webhook ${id}`,
      );
    expect(listed(created.webhook.id).recentDeliveries).toMatchObject([
      { type: "property.changed", status: "delivered", attempts: 1 },
    ]);
    expect(
      listed(busy.id).recentDeliveries.map((delivery) => delivery.id),
    ).toEqual(
      busySent
        .slice(1)
        .reverse()
        .map((delivery) => delivery.id),
    );
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
    // Its delivered event goes too, with the value it carried.
    expect(await deliveries(created.webhook.id)).toEqual([]);
    expect(
      (
        await asOwner(() => listWebhooks.run({ databaseId: ids.databaseId }))
      ).webhooks.map((hook) => hook.id),
    ).toEqual([busy.id]);
  });

  it("W2-4: an event that commits just after its webhook is removed is deleted, not sent", async () => {
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
    const [queued] = await settled(webhook.id, 1);
    await asOwner(() => deleteWebhook.run({ id: webhook.id }));
    expect(await deliveries(webhook.id)).toEqual([]);

    // The race: a write that read the webhook before the removal commits its
    // event after it.
    await getDb()
      .insert(schema.contentWebhookDeliveries)
      .values({ ...queued, status: "pending", leaseExpiresAt: null });
    await makeDue(webhook.id);
    receiver.status = 200;
    receiver.requests.length = 0;
    await hooks.drainContentWebhookDeliveries();
    expect(receiver.requests).toHaveLength(0);
    expect(await deliveries(webhook.id)).toEqual([]);
  });

  it("W2-4: permanently deleting a collection removes its webhooks, secrets and deliveries", async () => {
    const ids = await fixture();
    const kept = await fixture();
    const register = (
      target: { databaseId: string } | { documentId: string },
    ) =>
      asOwner(() =>
        createWebhook.run({
          url: RECEIVER_URL,
          ...target,
          events: ["property.changed"],
        }),
      );
    const collection = await register({ databaseId: ids.databaseId });
    const page = await register({ documentId: ids.rows[0].documentId });
    const survivor = await register({ databaseId: kept.databaseId });
    const secretOf = (webhookId: string) =>
      readAppSecret({
        key: `content-webhook:${webhookId}`,
        scope: "user",
        scopeId: OWNER,
      });

    // One event goes out, and a failed send leaves the next one waiting.
    await asOwner(() =>
      setProperty.run({
        documentId: ids.rows[0].documentId,
        databaseId: ids.databaseId,
        propertyId: ids.properties.turn,
        value: "agent",
      }),
    );
    await settled(collection.webhook.id, 1);
    receiver.status = 500;
    await asOwner(() =>
      setProperty.run({
        documentId: ids.rows[0].documentId,
        databaseId: ids.databaseId,
        propertyId: ids.properties.turn,
        value: "alice",
      }),
    );
    const sent = await settled(collection.webhook.id, 2);
    expect(sent.map((delivery) => delivery.status)).toEqual([
      "delivered",
      "pending",
    ]);

    await deleteDocumentRecursive(getDb(), ids.databaseDocumentId, OWNER);
    // Gone from the actions at once: they check the page the webhook watches.
    await expect(
      asOwner(() => deleteWebhook.run({ id: collection.webhook.id })),
    ).rejects.toMatchObject({ errorCode: "WEBHOOK_NOT_FOUND" });

    expect(await hooks.removeOrphanedContentWebhooks()).toBe(2);
    const remaining = await getDb()
      .select({ id: schema.contentWebhooks.id })
      .from(schema.contentWebhooks)
      .where(
        inArray(schema.contentWebhooks.id, [
          collection.webhook.id,
          page.webhook.id,
          survivor.webhook.id,
        ]),
      );
    expect(remaining.map((row: { id: string }) => row.id)).toEqual([
      survivor.webhook.id,
    ]);
    expect(await secretOf(collection.webhook.id)).toBeNull();
    expect(await secretOf(page.webhook.id)).toBeNull();
    expect((await secretOf(survivor.webhook.id))?.value).toBe(survivor.secret);
    expect(await deliveries(collection.webhook.id)).toEqual([]);
    expect(await deliveries(page.webhook.id)).toEqual([]);
    expect(await hooks.removeOrphanedContentWebhooks()).toBe(0);
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
      // A name, not an address, that resolves into the Tailnet.
      "https://receiver.tail1234.ts.net/content",
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
    // An empty filter would watch nothing; omitting it watches everything.
    await expect(
      asOwner(() =>
        createWebhook.run({ ...base, url: RECEIVER_URL, propertyIds: [] }),
      ),
    ).rejects.toThrow();
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

  it("W2-4: holds a collection to ten webhooks when they're added at once", async () => {
    const ids = await fixture();
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, index) =>
        asOwner(() =>
          createWebhook.run({
            databaseId: ids.databaseId,
            url: `${RECEIVER_URL}?n=${index}`,
            events: ["comment.created"],
          }),
        ),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(10);
    for (const result of results) {
      if (result.status === "rejected") {
        expect(result.reason).toMatchObject({ errorCode: "WEBHOOK_LIMIT" });
      }
    }
    const stored = await getDb()
      .select()
      .from(schema.contentWebhooks)
      .where(eq(schema.contentWebhooks.scopeId, ids.databaseId));
    expect(stored).toHaveLength(10);
  });
});

describe("property generations", () => {
  async function readItem(databaseId: string, itemId: string) {
    const response = await asOwner(() =>
      getDatabase.run({ databaseId, limit: 500 }),
    );
    if (!("items" in response)) throw new Error("Collection has no rows.");
    return found(
      response.items.find((item) => item.id === itemId),
      `Row ${itemId}`,
    );
  }

  function valueRow(documentId: string, propertyId: string) {
    return and(
      eq(schema.documentPropertyValues.documentId, documentId),
      eq(schema.documentPropertyValues.propertyId, propertyId),
    );
  }

  async function storedValue(documentId: string, propertyId: string) {
    const row = firstRow(
      await getDb()
        .select({ valueJson: schema.documentPropertyValues.valueJson })
        .from(schema.documentPropertyValues)
        .where(valueRow(documentId, propertyId)),
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
    const start = generationOf(before, ids.properties.turn);
    expect(start).toBeGreaterThan(0);
    expect(
      Object.keys(found(before.propertyGenerations, "Generations")),
    ).toEqual(expect.arrayContaining(Object.values(ids.properties)));
    expect(
      Object.keys(found(before.propertyGenerations, "Generations")),
    ).toHaveLength(3);
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
    expect(generationOf(after, ids.properties.turn)).toBe(
      backToAlice.generation,
    );
    expect(generationOf(after, ids.properties.notes)).toBe(
      generationOf(before, ids.properties.notes),
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
    const read = generationOf(
      await readItem(ids.databaseId, row.itemId),
      ids.properties.turn,
    );
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

  it("a cleared value can't make an old generation current again", async () => {
    const ids = await fixture();
    const [row] = ids.rows;
    const configured = await asOwner(() =>
      configureProperty.run({
        documentId: ids.databaseDocumentId,
        databaseId: ids.databaseId,
        name: "Owner",
        type: "text",
      }),
    );
    const owner = found(
      configured.properties.find(
        (candidate) => candidate.definition.name === "Owner",
      ),
      "Property Owner",
    ).definition.id;
    const empty = await readItem(ids.databaseId, row.itemId);
    expect(generationOf(empty, owner)).toBe(0);
    const notesBefore = generationOf(empty, ids.properties.notes);

    const filled = await asOwner(() =>
      setProperty.run({
        documentId: row.documentId,
        databaseId: ids.databaseId,
        propertyId: owner,
        value: "Ada",
      }),
    );
    // Clearing a field outright, as a type change or source binding does,
    // deletes the value row and its generation with it.
    await getDb()
      .delete(schema.documentPropertyValues)
      .where(
        and(
          eq(schema.documentPropertyValues.documentId, row.documentId),
          eq(schema.documentPropertyValues.propertyId, owner),
        ),
      );

    const cleared = await readItem(ids.databaseId, row.itemId);
    expect(await storedValue(row.documentId, owner)).toBeUndefined();
    expect(generationOf(cleared, owner)).toBeGreaterThan(filled.generation);
    // The tombstone is this property's alone; the page's others keep theirs.
    expect(generationOf(cleared, ids.properties.notes)).toBe(notesBefore);
    await expect(
      asOwner(() =>
        setProperty.run({
          documentId: row.documentId,
          databaseId: ids.databaseId,
          propertyId: owner,
          value: "Grace",
          expectedGeneration: 0,
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "PROPERTY_GENERATION_CONFLICT" });
    expect(await storedValue(row.documentId, owner)).toBeUndefined();

    const written = await asOwner(() =>
      setProperty.run({
        documentId: row.documentId,
        databaseId: ids.databaseId,
        propertyId: owner,
        value: "Grace",
        expectedGeneration: generationOf(cleared, owner),
      }),
    );
    expect(written.generation).toBeGreaterThan(generationOf(cleared, owner));
    expect(
      generationOf(await readItem(ids.databaseId, row.itemId), owner),
    ).toBe(written.generation);
  });

  it("row receipts and set-document-property list a cleared property's generation", async () => {
    const ids = await fixture();
    const [row] = ids.rows;
    const configured = await asOwner(() =>
      configureProperty.run({
        documentId: ids.databaseDocumentId,
        databaseId: ids.databaseId,
        name: "Owner",
        type: "text",
      }),
    );
    const owner = found(
      configured.properties.find(
        (candidate) => candidate.definition.name === "Owner",
      ),
      "Property Owner",
    ).definition.id;
    await asOwner(() =>
      setProperty.run({
        documentId: row.documentId,
        databaseId: ids.databaseId,
        propertyId: owner,
        value: "Ada",
      }),
    );
    // Cleared outright, as a type change does, so only a tombstone is left.
    await getDb()
      .delete(schema.documentPropertyValues)
      .where(
        and(
          eq(schema.documentPropertyValues.documentId, row.documentId),
          eq(schema.documentPropertyValues.propertyId, owner),
        ),
      );
    const cleared = await readItem(ids.databaseId, row.itemId);
    const tombstone = generationOf(cleared, owner);
    expect(tombstone).toBeGreaterThan(0);

    const discovered = await contract(ids.databaseId);
    const updated = await asOwner(() =>
      updateRow.run({
        ...envelope(discovered, "cleared-receipt"),
        itemId: row.itemId,
        documentId: row.documentId,
        expectedRowRevision: found(cleared.rowRevision, "Row revision"),
        propertyValues: { [ids.properties.notes]: "done" },
      }),
    );
    const afterUpdate = await readItem(ids.databaseId, row.itemId);
    expect(updated.receipt.readback.propertyGenerations).toEqual(
      afterUpdate.propertyGenerations,
    );
    expect(updated.receipt.readback.propertyChangeIds).toEqual(
      afterUpdate.propertyChangeIds,
    );
    expect(generationOf(updated.receipt.readback, owner)).toBe(tombstone);
    expect(changeIdOf(updated.receipt.readback, owner)).toBeNull();

    const patchContract = await contract(ids.databaseId);
    const patched = await asOwner(() =>
      patchRows.run({
        ...envelope(patchContract, "cleared-patch-receipt"),
        rows: [
          {
            itemId: row.itemId,
            documentId: row.documentId,
            expectedRowRevision: found(afterUpdate.rowRevision, "Row revision"),
            propertyEntries: [
              {
                propertyId: ids.properties.rank,
                propertyType: "number" as const,
                value: 7,
              },
            ],
          },
        ],
      }),
    );
    const afterPatch = await readItem(ids.databaseId, row.itemId);
    expect(patched.receipt.rows[0].readback.propertyGenerations).toEqual(
      afterPatch.propertyGenerations,
    );
    expect(patched.receipt.rows[0].readback.propertyChangeIds).toEqual(
      afterPatch.propertyChangeIds,
    );
    expect(generationOf(patched.receipt.rows[0].readback, owner)).toBe(
      tombstone,
    );

    const written = await asOwner(() =>
      setProperty.run({
        documentId: row.documentId,
        databaseId: ids.databaseId,
        propertyId: ids.properties.notes,
        value: "later",
      }),
    );
    expect(generationOf(written, owner)).toBe(tombstone);
    expect(changeIdOf(written, owner)).toBeNull();
    expect(changeIdOf(written, ids.properties.notes)).toBe(written.changeId);
    expect(written.propertyGenerations).toEqual(
      (await readItem(ids.databaseId, row.itemId)).propertyGenerations,
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
          expectedRowRevision: found(firstRead.rowRevision, "Row revision"),
          expectedPropertyGenerations: generations,
          propertyValues: { [ids.properties.notes]: "done" },
        }),
      );
    await expect(
      update("stale-update", {
        [ids.properties.turn]: generationOf(firstRead, ids.properties.turn),
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

    const fresh = found(
      (await readItem(ids.databaseId, first.itemId)).propertyGenerations,
      "Generations",
    );
    const updated = await update("fresh-update", {
      [ids.properties.turn]: fresh[ids.properties.turn],
    });
    expect(updated.receipt.readback.propertyValues).toMatchObject({
      [ids.properties.notes]: "done",
    });
    expect(
      generationOf(updated.receipt.readback, ids.properties.notes),
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
              expectedRowRevision: found(firstNow.rowRevision, "Row revision"),
              expectedPropertyGenerations: {
                [ids.properties.turn]: generationOf(
                  firstNow,
                  ids.properties.turn,
                ),
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
              expectedRowRevision: found(
                secondRead.rowRevision,
                "Row revision",
              ),
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
      patch("stale-patch", generationOf(secondRead, ids.properties.turn) + 1),
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
      generationOf(secondRead, ids.properties.turn),
    );
    expect(await storedValue(first.documentId, ids.properties.rank)).toBe(20);
    // Both maps cover the whole row, not just the patched property.
    for (const [index, patchedRow] of [first, second].entries()) {
      const fresh = await readItem(ids.databaseId, patchedRow.itemId);
      expect(patched.receipt.rows[index].readback.propertyGenerations).toEqual(
        fresh.propertyGenerations,
      );
      expect(patched.receipt.rows[index].readback.propertyChangeIds).toEqual(
        fresh.propertyChangeIds,
      );
    }
  });

  it("update-database-item and patch-database-items refuse a guard on a property with no generation", async () => {
    const ids = await fixture();
    const [row] = ids.rows;
    const addProperty = async (name: string, type: "blocks" | "created_time") =>
      found(
        (
          await asOwner(() =>
            configureProperty.run({
              documentId: ids.databaseDocumentId,
              databaseId: ids.databaseId,
              name,
              type,
            }),
          )
        ).properties.find((candidate) => candidate.definition.name === name),
        `Property ${name}`,
      ).definition.id;
    const blocks = await addProperty("Brief", "blocks");
    const createdTime = await addProperty("Created", "created_time");
    const read = await readItem(ids.databaseId, row.itemId);
    expect(read.propertyGenerations).not.toHaveProperty(blocks);
    expect(read.propertyGenerations).not.toHaveProperty(createdTime);
    const discovered = await contract(ids.databaseId);

    // Each would read 0 forever, so a guard of 0 used to pass unchecked.
    for (const propertyId of ["no-such-property", blocks, createdTime]) {
      const generations = {
        [ids.properties.turn]: generationOf(read, ids.properties.turn),
        [propertyId]: 0,
      };
      await expect(
        asOwner(() =>
          updateRow.run({
            ...envelope(discovered, `unguardable-update-${propertyId}`),
            itemId: row.itemId,
            documentId: row.documentId,
            expectedRowRevision: found(read.rowRevision, "Row revision"),
            expectedPropertyGenerations: generations,
            propertyValues: { [ids.properties.notes]: "done" },
          }),
        ),
      ).rejects.toMatchObject({
        errorCode: "PROPERTY_NOT_GUARDABLE",
        details: {
          itemId: row.itemId,
          documentId: row.documentId,
          propertyIds: [propertyId],
        },
      });
      await expect(
        asOwner(() =>
          patchRows.run({
            ...envelope(discovered, `unguardable-patch-${propertyId}`),
            rows: [
              {
                itemId: row.itemId,
                documentId: row.documentId,
                expectedRowRevision: found(read.rowRevision, "Row revision"),
                expectedPropertyGenerations: generations,
                propertyEntries: [
                  {
                    propertyId: ids.properties.rank,
                    propertyType: "number" as const,
                    value: 20,
                  },
                ],
              },
            ],
          }),
        ),
      ).rejects.toMatchObject({
        errorCode: "PROPERTY_NOT_GUARDABLE",
        details: {
          rows: [
            {
              index: 0,
              itemId: row.itemId,
              documentId: row.documentId,
              propertyIds: [propertyId],
            },
          ],
        },
      });
    }
    expect(await storedValue(row.documentId, ids.properties.notes)).toBe(
      "first",
    );
    expect(await storedValue(row.documentId, ids.properties.rank)).toBe(0);
  });

  it("a change ID moves only when its own value does, and reads, writes and events agree", async () => {
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
    const readChangeIds = async () => {
      const item = await readItem(ids.databaseId, row.itemId);
      const page = await asOwner(() =>
        getDocument.run({ id: row.documentId, databaseId: ids.databaseId }),
      );
      expect(page.propertyChangeIds).toEqual(item.propertyChangeIds);
      return item;
    };

    const toAgent = await setTurn(ids, "agent");
    const before = await readChangeIds();
    expect(changeIdOf(before, ids.properties.turn)).toBe(toAgent.changeId);

    // Clearing another field moves that field's generation and leaves this
    // property's generation and change ID as they were.
    await getDb()
      .delete(schema.documentPropertyValues)
      .where(valueRow(row.documentId, ids.properties.notes));
    const cleared = await readChangeIds();
    expect(generationOf(cleared, ids.properties.turn)).toBe(
      generationOf(before, ids.properties.turn),
    );
    expect(generationOf(cleared, ids.properties.notes)).not.toBe(
      generationOf(before, ids.properties.notes),
    );
    expect(cleared.propertyChangeIds).toMatchObject({
      [ids.properties.turn]: toAgent.changeId,
      [ids.properties.notes]: null,
    });

    // Agent → Alice → Agent is two changes, so two new IDs. A write that
    // leaves the value as it was keeps its ID.
    const toAlice = await setTurn(ids, "alice");
    const backToAgent = await setTurn(ids, "agent");
    const unchanged = await setTurn(ids, "agent");
    expect(
      new Set([toAgent.changeId, toAlice.changeId, backToAgent.changeId]).size,
    ).toBe(3);
    expect(unchanged.changeId).toBe(backToAgent.changeId);
    const after = await readChangeIds();
    expect(changeIdOf(after, ids.properties.turn)).toBe(backToAgent.changeId);

    await settled(webhook.id, 3);
    expect(
      eventsFor(webhook.id).map((request) => [
        request.event.data.newValue,
        request.event.data.changeId,
      ]),
    ).toEqual([
      ["agent", toAgent.changeId],
      ["alice", toAlice.changeId],
      ["agent", backToAgent.changeId],
    ]);

    const updated = await asOwner(async () =>
      updateRow.run({
        ...envelope(await contract(ids.databaseId), "change-id-update"),
        itemId: row.itemId,
        documentId: row.documentId,
        expectedRowRevision: found(after.rowRevision, "Row revision"),
        propertyValues: { [ids.properties.turn]: "alice" },
      }),
    );
    const updatedTurn = changeIdOf(
      updated.receipt.readback,
      ids.properties.turn,
    );
    expect(updatedTurn).not.toBe(backToAgent.changeId);
    expect(changeIdOf(await readChangeIds(), ids.properties.turn)).toBe(
      updatedTurn,
    );
  });

  it("a read takes each value and its change ID from one row", async () => {
    const ids = await fixture();
    const [row] = ids.rows;
    const toAgent = await setTurn(ids, "agent");
    const writeTurn = (value: string) => async () => {
      await getDb()
        .update(schema.documentPropertyValues)
        .set({ valueJson: JSON.stringify(value) })
        .where(valueRow(row.documentId, ids.properties.turn));
    };
    const storedChangeId = async () => {
      const [stored] = await getDb()
        .select({ generation: schema.documentPropertyValues.generation })
        .from(schema.documentPropertyValues)
        .where(valueRow(row.documentId, ids.properties.turn));
      return Number(stored.generation);
    };

    // A writer lands after get-document reads tombstones and before it reads
    // values. The value, its change ID and its generation all come from the
    // new row.
    tombstoneReads.thenWrite = writeTurn("alice");
    const page = await asOwner(() =>
      getDocument.run({ id: row.documentId, databaseId: ids.databaseId }),
    );
    expect(
      found(
        page.properties.find(
          (property) => property.definition.id === ids.properties.turn,
        ),
        "Turn",
      ).value,
    ).toBe("alice");
    const aliceChangeId = await storedChangeId();
    expect(aliceChangeId).not.toBe(toAgent.changeId);
    expect(changeIdOf(page, ids.properties.turn)).toBe(aliceChangeId);
    expect(generationOf(page, ids.properties.turn)).toBe(aliceChangeId);

    tombstoneReads.thenWrite = writeTurn("agent");
    const item = await readItem(ids.databaseId, row.itemId);
    expect(
      found(
        item.properties.find(
          (property) => property.definition.id === ids.properties.turn,
        ),
        "Turn",
      ).value,
    ).toBe("agent");
    const agentChangeId = await storedChangeId();
    expect(changeIdOf(item, ids.properties.turn)).toBe(agentChangeId);
    expect(generationOf(item, ids.properties.turn)).toBe(agentChangeId);

    // A deletion lands in the same gap. The read shows no value and the
    // generation from before the deletion, so a write guarded on it conflicts
    // and rereads instead of passing.
    tombstoneReads.thenWrite = async () => {
      await getDb()
        .delete(schema.documentPropertyValues)
        .where(valueRow(row.documentId, ids.properties.turn));
    };
    const emptied = await readItem(ids.databaseId, row.itemId);
    expect(changeIdOf(emptied, ids.properties.turn)).toBeNull();
    const staleGeneration = generationOf(emptied, ids.properties.turn);
    await expect(setTurn(ids, "alice", staleGeneration)).rejects.toMatchObject({
      errorCode: "PROPERTY_GENERATION_CONFLICT",
    });
    expect(await storedValue(row.documentId, ids.properties.turn)).toBe(
      undefined,
    );
    const reread = await readItem(ids.databaseId, row.itemId);
    expect(generationOf(reread, ids.properties.turn)).not.toBe(staleGeneration);
    await setTurn(ids, "alice", generationOf(reread, ids.properties.turn));
    expect(await storedValue(row.documentId, ids.properties.turn)).toBe(
      "alice",
    );
  });

  it("a deletion elsewhere can't make a stale write pass", async () => {
    const ids = await fixture();
    const [row] = ids.rows;
    const setSequence = (value: number) =>
      getDb().execute(
        sql`SELECT setval('content_property_value_generation_seq', ${value})`,
      );
    const toAgent = await setTurn(ids, "agent");
    try {
      // Stands in for a write that takes its number, then commits after a
      // deletion on the same page takes a larger one: the sequence moves
      // ahead for the deletion and back for the write.
      await setSequence(toAgent.generation + 10);
      await getDb()
        .delete(schema.documentPropertyValues)
        .where(valueRow(row.documentId, ids.properties.notes));
      const read = await readItem(ids.databaseId, row.itemId);
      expect(generationOf(read, ids.properties.turn)).toBe(toAgent.generation);
      await setSequence(toAgent.generation);
      const toAlice = await setTurn(ids, "alice");
      expect(toAlice.generation).toBeLessThan(
        generationOf(read, ids.properties.notes),
      );

      // The agent's finish, computed from the read, must not land on Alice's
      // turn.
      await expect(
        setTurn(ids, "agent", generationOf(read, ids.properties.turn)),
      ).rejects.toMatchObject({
        errorCode: "PROPERTY_GENERATION_CONFLICT",
        details: {
          conflicts: [
            {
              propertyId: ids.properties.turn,
              expected: toAgent.generation,
              current: toAlice.generation,
            },
          ],
        },
      });
      expect(await storedValue(row.documentId, ids.properties.turn)).toBe(
        "alice",
      );
    } finally {
      await setSequence(toAgent.generation + 1000);
    }
  });

  it("the Source column fill writes only rows whose source changed", async () => {
    const ids = await fixture(3);
    const { ensureDatabaseSourceProperty } =
      await import("./_database-source-utils.js");
    const [database] = await getDb()
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, ids.databaseId));
    const sources = ["Sheet A", "Sheet B"].map((name, index) => ({
      id: `${ids.databaseId}-source-${index}`,
      ownerEmail: OWNER,
      databaseId: ids.databaseId,
      sourceType: "test",
      sourceName: name,
      sourceTable: name,
      createdAt: new Date(Date.now() + index).toISOString(),
    }));
    await getDb().insert(schema.contentDatabaseSources).values(sources);
    const linkRow = (row: number, source: number) =>
      getDb()
        .insert(schema.contentDatabaseSourceRows)
        .values({
          id: `${ids.rows[row].itemId}-link`,
          ownerEmail: OWNER,
          sourceId: sources[source].id,
          databaseItemId: ids.rows[row].itemId,
          documentId: ids.rows[row].documentId,
          sourceRowId: `row-${row}`,
          sourceQualifiedId: `row-${row}`,
          sourceDisplayKey: `row-${row}`,
        });
    const sourceColumn = async () => {
      const [definition] = await getDb()
        .select({ id: schema.documentPropertyDefinitions.id })
        .from(schema.documentPropertyDefinitions)
        .where(
          and(
            eq(schema.documentPropertyDefinitions.databaseId, ids.databaseId),
            eq(schema.documentPropertyDefinitions.name, "Source"),
          ),
        );
      const values = await getDb()
        .select()
        .from(schema.documentPropertyValues)
        .where(eq(schema.documentPropertyValues.propertyId, definition.id));
      return ids.rows.map((row) => {
        const value = found(
          values.find(
            (candidate: { documentId: string }) =>
              candidate.documentId === row.documentId,
          ),
          `Value of ${row.documentId}`,
        );
        return {
          source: JSON.parse(value.valueJson),
          generation: value.generation,
          updatedAt: value.updatedAt,
        };
      });
    };

    await linkRow(0, 0);
    await ensureDatabaseSourceProperty({
      database,
      now: "2026-10-24T10:00:00.000Z",
    });
    const first = await sourceColumn();
    expect(first.map((cell) => cell.source)).toEqual([
      sources[0].id,
      "local",
      "local",
    ]);

    await linkRow(1, 1);
    await ensureDatabaseSourceProperty({
      database,
      now: "2026-10-24T11:00:00.000Z",
    });
    const second = await sourceColumn();
    expect(second.map((cell) => cell.source)).toEqual([
      sources[0].id,
      sources[1].id,
      "local",
    ]);
    // Only the row that moved was written: the others keep their generation
    // and their write time.
    expect(second[1].generation).toBeGreaterThan(first[1].generation);
    expect(second[1].updatedAt).toBe("2026-10-24T11:00:00.000Z");
    for (const row of [0, 2]) expect(second[row]).toEqual(first[row]);
  });

  it("the source writers work out their writes again under the lock", async () => {
    const ids = await fixture(2);
    const {
      ensureDatabaseSourceProperty,
      materializeSourceFieldPropertyValues,
    } = await import("./_database-source-utils.js");
    const [database] = await getDb()
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, ids.databaseId));
    const sources = ["Sheet A", "Sheet B"].map((name, index) => ({
      id: `${ids.databaseId}-source-${index}`,
      ownerEmail: OWNER,
      databaseId: ids.databaseId,
      sourceType: "test",
      sourceName: name,
      sourceTable: name,
      createdAt: new Date(Date.now() + index).toISOString(),
    }));
    await getDb().insert(schema.contentDatabaseSources).values(sources);
    const links = schema.contentDatabaseSourceRows;
    await getDb()
      .insert(links)
      .values(
        ids.rows.map((row, index) => ({
          id: `${row.itemId}-link`,
          ownerEmail: OWNER,
          sourceId: sources[0].id,
          databaseItemId: row.itemId,
          documentId: row.documentId,
          sourceRowId: `row-${index}`,
          sourceQualifiedId: `row-${index}`,
          sourceDisplayKey: `row-${index}`,
          sourceValuesJson: JSON.stringify({ note: "from the scan" }),
        })),
      );
    const [noteField] = await getDb()
      .insert(schema.contentDatabaseSourceFields)
      .values({
        id: `${sources[0].id}-note`,
        ownerEmail: OWNER,
        sourceId: sources[0].id,
        propertyId: ids.properties.notes,
        localFieldKey: ids.properties.notes,
        sourceFieldKey: "note",
        sourceFieldLabel: "Note",
        sourceFieldType: "text",
      })
      .returning();

    // A refresh of the first row lands between the materializer's scan and
    // its lock. The write must carry the refresh, not what the scan read.
    lockHook.beforeNext = (tx) =>
      tx
        .update(links)
        .set({ sourceValuesJson: JSON.stringify({ note: "from the refresh" }) })
        .where(eq(links.documentId, ids.rows[0].documentId));
    await materializeSourceFieldPropertyValues({
      database,
      sourceId: sources[0].id,
      fields: [noteField],
      now: new Date().toISOString(),
    });
    expect(lockHook.beforeNext).toBeNull();
    expect(
      await storedValue(ids.rows[0].documentId, ids.properties.notes),
    ).toBe("from the refresh");
    expect(
      await storedValue(ids.rows[1].documentId, ids.properties.notes),
    ).toBe("from the scan");

    // The second row moves to the other source between the Source column's
    // scan and its lock.
    lockHook.beforeNext = (tx) =>
      tx
        .update(links)
        .set({ sourceId: sources[1].id })
        .where(eq(links.documentId, ids.rows[1].documentId));
    await ensureDatabaseSourceProperty({
      database,
      now: new Date().toISOString(),
    });
    expect(lockHook.beforeNext).toBeNull();
    const [source] = await getDb()
      .select({ id: schema.documentPropertyDefinitions.id })
      .from(schema.documentPropertyDefinitions)
      .where(
        and(
          eq(schema.documentPropertyDefinitions.databaseId, ids.databaseId),
          eq(schema.documentPropertyDefinitions.name, "Source"),
        ),
      );
    expect(await storedValue(ids.rows[0].documentId, source.id)).toBe(
      sources[0].id,
    );
    expect(await storedValue(ids.rows[1].documentId, source.id)).toBe(
      sources[1].id,
    );
  });

  it("the Source column scans again for a row that moves after its scan", async () => {
    const ids = await fixture(2);
    const { ensureDatabaseSourceProperty } =
      await import("./_database-source-utils.js");
    const [database] = await getDb()
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, ids.databaseId));
    const sources = [0, 1].map((index) => ({
      id: `${ids.databaseId}-source-${index}`,
      ownerEmail: OWNER,
      databaseId: ids.databaseId,
      sourceType: "test",
      sourceName: `Sheet ${index}`,
      sourceTable: `Sheet ${index}`,
      createdAt: new Date(Date.now() + index).toISOString(),
    }));
    await getDb().insert(schema.contentDatabaseSources).values(sources);
    const links = schema.contentDatabaseSourceRows;
    const link = (row: number, source: number) => ({
      id: `${ids.rows[row].itemId}-link`,
      ownerEmail: OWNER,
      sourceId: sources[source].id,
      databaseItemId: ids.rows[row].itemId,
      documentId: ids.rows[row].documentId,
      sourceRowId: `row-${row}`,
      sourceQualifiedId: `row-${row}`,
      sourceDisplayKey: `row-${row}`,
    });
    await getDb().insert(links).values(link(0, 0));
    await ensureDatabaseSourceProperty({
      database,
      now: new Date().toISOString(),
    });
    const [sourceColumn] = await getDb()
      .select({ id: schema.documentPropertyDefinitions.id })
      .from(schema.documentPropertyDefinitions)
      .where(
        and(
          eq(schema.documentPropertyDefinitions.databaseId, ids.databaseId),
          eq(schema.documentPropertyDefinitions.name, "Source"),
        ),
      );
    expect(await storedValue(ids.rows[0].documentId, sourceColumn.id)).toBe(
      sources[0].id,
    );

    // The second row joins the second source, so the next fill's scan finds
    // it. The first row, which that scan finds correct, moves to the second
    // source just before the lock that writes the second row. (The fill's
    // first lock sets the options; the hook waits for the next one.) The scan
    // after that locked pass catches the move.
    await getDb().insert(links).values(link(1, 1));
    lockHook.beforeNext = async () => {
      lockHook.beforeNext = (tx) =>
        tx
          .update(links)
          .set({ sourceId: sources[1].id })
          .where(eq(links.documentId, ids.rows[0].documentId));
    };
    await ensureDatabaseSourceProperty({
      database,
      now: new Date().toISOString(),
    });
    expect(lockHook.beforeNext).toBeNull();
    for (const row of ids.rows)
      expect(await storedValue(row.documentId, sourceColumn.id)).toBe(
        sources[1].id,
      );

    // With nothing to change, a fill still scans after its lock: the first row
    // moves back while the options are set, and the fill's scan catches it.
    lockHook.beforeNext = (tx) =>
      tx
        .update(links)
        .set({ sourceId: sources[0].id })
        .where(eq(links.documentId, ids.rows[0].documentId));
    await ensureDatabaseSourceProperty({
      database,
      now: new Date().toISOString(),
    });
    expect(lockHook.beforeNext).toBeNull();
    expect(await storedValue(ids.rows[0].documentId, sourceColumn.id)).toBe(
      sources[0].id,
    );
  });

  it("the source writers read bindings and sources again under the lock", async () => {
    const ids = await fixture(2);
    const {
      ensureDatabaseSourceProperty,
      materializeSourceFieldPropertyValues,
    } = await import("./_database-source-utils.js");
    const [database] = await getDb()
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, ids.databaseId));
    const sources = [0, 1, 2].map((index) => ({
      id: `${ids.databaseId}-source-${index}`,
      ownerEmail: OWNER,
      databaseId: ids.databaseId,
      sourceType: "test",
      sourceName: `Sheet ${index}`,
      sourceTable: `Sheet ${index}`,
      createdAt: new Date(Date.now() + index).toISOString(),
    }));
    await getDb()
      .insert(schema.contentDatabaseSources)
      .values(sources.slice(0, 2));
    const links = schema.contentDatabaseSourceRows;
    const link = (row: number, source: number) => ({
      id: `${ids.rows[row].itemId}-link`,
      ownerEmail: OWNER,
      sourceId: sources[source].id,
      databaseItemId: ids.rows[row].itemId,
      documentId: ids.rows[row].documentId,
      sourceRowId: `row-${row}`,
      sourceQualifiedId: `row-${row}`,
      sourceDisplayKey: `row-${row}`,
      sourceValuesJson: JSON.stringify({ note: "from the source" }),
    });
    await getDb().insert(links).values(link(0, 0));
    const fields = schema.contentDatabaseSourceFields;
    const [noteField] = await getDb()
      .insert(fields)
      .values({
        id: `${sources[0].id}-note`,
        ownerEmail: OWNER,
        sourceId: sources[0].id,
        propertyId: ids.properties.notes,
        localFieldKey: ids.properties.notes,
        sourceFieldKey: "note",
        sourceFieldLabel: "Note",
        sourceFieldType: "text",
      })
      .returning();

    // The field is unbound between the materializer's scan and its lock, so
    // the column it fed keeps its own value.
    lockHook.beforeNext = (tx) =>
      tx
        .update(fields)
        .set({ propertyId: null, localFieldKey: "note" })
        .where(eq(fields.id, noteField.id));
    await materializeSourceFieldPropertyValues({
      database,
      sourceId: sources[0].id,
      fields: [noteField],
      now: new Date().toISOString(),
    });
    expect(lockHook.beforeNext).toBeNull();
    expect(
      await storedValue(ids.rows[0].documentId, ids.properties.notes),
    ).toBe("first");

    // A third source, holding the second row, is attached between the Source
    // column's scan and its lock. That row's Source is the new source, not
    // Local, and the column lists it as an option. (The fill's first lock
    // sets the options; the hook waits for the lock that writes the rows.)
    lockHook.beforeNext = async () => {
      lockHook.beforeNext = async (tx) => {
        await tx.insert(schema.contentDatabaseSources).values(sources[2]);
        await tx.insert(links).values(link(1, 2));
      };
    };
    await ensureDatabaseSourceProperty({
      database,
      now: new Date().toISOString(),
    });
    expect(lockHook.beforeNext).toBeNull();
    const [sourceColumn] = await getDb()
      .select({
        id: schema.documentPropertyDefinitions.id,
        optionsJson: schema.documentPropertyDefinitions.optionsJson,
      })
      .from(schema.documentPropertyDefinitions)
      .where(
        and(
          eq(schema.documentPropertyDefinitions.databaseId, ids.databaseId),
          eq(schema.documentPropertyDefinitions.name, "Source"),
        ),
      );
    expect(await storedValue(ids.rows[0].documentId, sourceColumn.id)).toBe(
      sources[0].id,
    );
    expect(await storedValue(ids.rows[1].documentId, sourceColumn.id)).toBe(
      sources[2].id,
    );
    expect(
      JSON.parse(sourceColumn.optionsJson).options.map(
        (option: { id: string }) => option.id,
      ),
    ).toEqual([...sources.map((source) => source.id), "local"]);
  });
});
