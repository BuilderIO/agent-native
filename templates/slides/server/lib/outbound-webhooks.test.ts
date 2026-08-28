import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

type Subscription = {
  id: string;
  url: string;
  events: string;
  secret: string;
  enabled: boolean;
  consecutiveFailures: number;
  ownerEmail: string;
  orgId: string | null;
  disabledReason?: string | null;
  createdAt: string;
  updatedAt: string;
};
type Delivery = {
  id: string;
  subscriptionId: string;
  event: string;
  payload: string;
  status: string;
  attempts: number;
  nextAttemptAt: string | null;
  claimedAt?: string | null;
  claimExpiresAt?: string | null;
  lastError?: string | null;
  deliveredAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

const state = vi.hoisted(() => ({
  subscriptions: [] as Subscription[],
  deliveries: [] as Delivery[],
  delivered: [] as Array<{
    serializedBody: string;
    headers: Record<string, string>;
  }>,
  response: { ok: true, status: 200, blocked: false },
}));

const tables = vi.hoisted(() => ({
  webhookSubscriptions: {
    id: "subscription.id",
    enabled: "subscription.enabled",
    ownerEmail: "subscription.ownerEmail",
    orgId: "subscription.orgId",
    createdAt: "subscription.createdAt",
  },
  webhookDeliveries: {
    id: "delivery.id",
    subscriptionId: "delivery.subscriptionId",
    status: "delivery.status",
    nextAttemptAt: "delivery.nextAttemptAt",
    claimedAt: "delivery.claimedAt",
    claimExpiresAt: "delivery.claimExpiresAt",
    createdAt: "delivery.createdAt",
  },
}));

function key(column: unknown): string {
  return String(column).split(".").at(-1)!;
}
function matches(row: Record<string, unknown>, condition: any): boolean {
  if (!condition) return true;
  if (condition.kind === "and")
    return condition.conditions.every((item: any) => matches(row, item));
  if (condition.kind === "or")
    return condition.conditions.some((item: any) => matches(row, item));
  const value = row[key(condition.column)];
  if (condition.kind === "eq") return value === condition.value;
  if (condition.kind === "lte")
    return typeof value === "string" && value <= condition.value;
  if (condition.kind === "null") return value === null || value === undefined;
  if (condition.kind === "in") return condition.values.includes(value);
  return false;
}

function rowsFor(table: unknown): Array<Record<string, unknown>> {
  return table === tables.webhookSubscriptions
    ? state.subscriptions
    : state.deliveries;
}
function query(table: unknown, condition?: any) {
  let rows = rowsFor(table).filter((row) => matches(row, condition));
  const builder: any = {
    where: (next: any) => {
      rows = rows.filter((row) => matches(row, next));
      return builder;
    },
    orderBy: () => builder,
    limit: (limit: number) => Promise.resolve(rows.slice(0, limit)),
    then: (
      resolve: (value: unknown[]) => unknown,
      reject: (error: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject),
  };
  return builder;
}

const db = {
  select: () => ({ from: (table: unknown) => query(table) }),
  insert: (table: unknown) => ({
    values: async (
      values: Record<string, unknown> | Array<Record<string, unknown>>,
    ) => {
      rowsFor(table).push(...(Array.isArray(values) ? values : [values]));
    },
  }),
  update: (table: unknown) => ({
    set: (patch: Record<string, unknown>) => {
      let changed: Array<Record<string, unknown>> = [];
      const builder: any = {
        where: (condition: any) => {
          changed = rowsFor(table).filter((row) => matches(row, condition));
          changed.forEach((row) => Object.assign(row, patch));
          return builder;
        },
        returning: async () => changed,
        then: (
          resolve: (value: unknown[]) => unknown,
          reject: (error: unknown) => unknown,
        ) => Promise.resolve(changed).then(resolve, reject),
      };
      return builder;
    },
  }),
  delete: (table: unknown) => ({
    where: (condition: any) => {
      const rows = rowsFor(table);
      const deleted = rows.filter((row) => matches(row, condition));
      rows.splice(
        0,
        rows.length,
        ...rows.filter((row) => !matches(row, condition)),
      );
      return { returning: async () => deleted };
    },
  }),
};

vi.mock("@agent-native/core/integrations", () => ({
  isWebhookUrlAllowed: () => true,
  deliverJsonWebhook: async (input: {
    serializedBody: string;
    headers: Record<string, string>;
  }) => {
    state.delivered.push(input);
    return state.response;
  },
}));
vi.mock("@agent-native/core/secrets", () => ({
  encryptSecretValue: (value: string) => value,
  decryptSecretValue: (value: string) => value,
}));
const mockGetRequestUserEmail = vi.hoisted(() => vi.fn());
const mockResolveConnectBearerCaller = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/server", () => ({
  fireInternalDispatch: vi.fn(),
  resolveConnectBearerCaller: (...args: unknown[]) =>
    mockResolveConnectBearerCaller(...args),
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => mockGetRequestUserEmail(),
  getRequestOrgId: () => null,
}));
vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ kind: "and", conditions }),
  or: (...conditions: unknown[]) => ({ kind: "or", conditions }),
  asc: (column: unknown) => column,
  eq: (column: unknown, value: unknown) => ({ kind: "eq", column, value }),
  inArray: (column: unknown, values: unknown[]) => ({
    kind: "in",
    column,
    values,
  }),
  isNull: (column: unknown) => ({ kind: "null", column }),
  lte: (column: unknown, value: string) => ({ kind: "lte", column, value }),
}));
vi.mock("../db/index.js", () => ({ getDb: () => db, schema: tables }));

import {
  deleteWebhookSubscription,
  enqueueWebhookEvent,
  processDueWebhookDeliveries,
  resolveWebhookRouteCaller,
} from "./outbound-webhooks.js";

function subscription(
  events: string[],
  overrides: Partial<Subscription> = {},
): Subscription {
  const createdAt = new Date().toISOString();
  return {
    id: `wh-${state.subscriptions.length + 1}`,
    url: "https://receiver.example/webhooks",
    events: JSON.stringify(events),
    secret: "test-secret",
    enabled: true,
    consecutiveFailures: 0,
    ownerEmail: "owner@example.com",
    orgId: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

beforeEach(() => {
  state.subscriptions = [];
  state.deliveries = [];
  state.delivered = [];
  state.response = { ok: true, status: 200, blocked: false };
  mockGetRequestUserEmail.mockReset().mockReturnValue(undefined);
  mockResolveConnectBearerCaller.mockReset().mockResolvedValue(null);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-26T12:00:00.000Z"));
});

describe("Slides outbound webhooks", () => {
  it("delivers the exact signed raw event payload", async () => {
    state.subscriptions.push(subscription(["deck.created"]));

    await enqueueWebhookEvent(
      "deck.created",
      { id: "deck-1", title: "Quarterly review" },
      { ownerEmail: "owner@example.com", orgId: null },
    );
    await processDueWebhookDeliveries();

    expect(state.delivered).toHaveLength(1);
    const delivery = state.delivered[0]!;
    expect(JSON.parse(delivery.serializedBody)).toMatchObject({
      event: "deck.created",
      data: { id: "deck-1", title: "Quarterly review" },
    });
    expect(delivery.headers["X-Agent-Native-Signature"]).toBe(
      `sha256=${createHmac("sha256", "test-secret").update(delivery.serializedBody).digest("hex")}`,
    );
    expect(state.deliveries[0]?.status).toBe("delivered");
  });

  it("filters deliveries to subscribers for the emitted event", async () => {
    state.subscriptions.push(
      subscription(["deck.created"]),
      subscription(["comment.updated"]),
    );

    await enqueueWebhookEvent(
      "deck.created",
      { id: "deck-1" },
      { ownerEmail: "owner@example.com", orgId: null },
    );

    expect(state.deliveries).toHaveLength(1);
    expect(state.deliveries[0]?.subscriptionId).toBe("wh-1");
  });

  it("never fans out to a webhook owned by a different tenant", async () => {
    state.subscriptions.push(
      subscription(["deck.created"], {
        id: "wh-tenant-a",
        ownerEmail: "tenant-a@example.com",
      }),
      subscription(["deck.created"], {
        id: "wh-tenant-b",
        ownerEmail: "tenant-b@example.com",
      }),
    );

    await enqueueWebhookEvent(
      "deck.created",
      { id: "deck-a" },
      { ownerEmail: "tenant-a@example.com", orgId: null },
    );

    expect(state.deliveries).toHaveLength(1);
    expect(state.deliveries[0]?.subscriptionId).toBe("wh-tenant-a");

    await enqueueWebhookEvent(
      "deck.created",
      { id: "deck-b" },
      { ownerEmail: "tenant-b@example.com", orgId: null },
    );

    expect(state.deliveries).toHaveLength(2);
    expect(state.deliveries[1]?.subscriptionId).toBe("wh-tenant-b");
  });

  it("cancels queued deliveries when a subscription is deleted", async () => {
    state.subscriptions.push(subscription(["deck.created"]));
    await enqueueWebhookEvent(
      "deck.created",
      { id: "deck-1" },
      { ownerEmail: "owner@example.com", orgId: null },
    );

    await expect(
      deleteWebhookSubscription("wh-1", "owner@example.com", null),
    ).resolves.toBe(true);
    expect(state.deliveries[0]?.status).toBe("cancelled");
    expect(state.delivered).toHaveLength(0);
  });

  it("retries 500s and disables a repeatedly failing subscription", async () => {
    state.subscriptions.push(subscription(["deck.created"]));
    state.response = { ok: false, status: 500, blocked: false };
    await enqueueWebhookEvent(
      "deck.created",
      { id: "deck-1" },
      { ownerEmail: "owner@example.com", orgId: null },
    );

    for (let attempt = 0; attempt < 5; attempt++) {
      state.deliveries[0]!.nextAttemptAt = new Date().toISOString();
      await processDueWebhookDeliveries();
    }

    expect(state.delivered).toHaveLength(5);
    expect(state.deliveries[0]).toMatchObject({
      status: "failed",
      attempts: 5,
    });
    expect(state.subscriptions[0]).toMatchObject({
      enabled: false,
      consecutiveFailures: 5,
    });
  });

  it("reclaims an expired processing lease and delivers the stranded row", async () => {
    const createdAt = new Date().toISOString();
    state.subscriptions.push(subscription(["deck.created"]));
    state.deliveries.push({
      id: "whd-stranded",
      subscriptionId: "wh-1",
      event: "deck.created",
      payload: JSON.stringify({
        id: "evt-stranded",
        event: "deck.created",
        createdAt,
        data: { id: "deck-1" },
      }),
      status: "processing",
      attempts: 1,
      nextAttemptAt: null,
      claimedAt: "2026-08-26T11:50:00.000Z",
      claimExpiresAt: "2026-08-26T11:55:00.000Z",
      createdAt,
      updatedAt: createdAt,
    });

    await expect(processDueWebhookDeliveries()).resolves.toBe(1);

    expect(state.delivered).toHaveLength(1);
    expect(state.deliveries[0]).toMatchObject({
      status: "delivered",
      claimedAt: null,
      claimExpiresAt: null,
    });
  });

  it("authenticates a Connect/API bearer caller when there is no session", async () => {
    mockResolveConnectBearerCaller.mockResolvedValue({
      owner: "bearer@example.com",
      orgId: "org-1",
      anonymous: false,
    });

    await expect(resolveWebhookRouteCaller({})).resolves.toEqual({
      ownerEmail: "bearer@example.com",
      orgId: "org-1",
    });
  });

  it("prefers the session caller over a bearer token when both are present", async () => {
    mockGetRequestUserEmail.mockReturnValue("session@example.com");
    mockResolveConnectBearerCaller.mockResolvedValue({
      owner: "bearer@example.com",
      orgId: null,
      anonymous: false,
    });

    await expect(resolveWebhookRouteCaller({})).resolves.toEqual({
      ownerEmail: "session@example.com",
      orgId: null,
    });
    expect(mockResolveConnectBearerCaller).not.toHaveBeenCalled();
  });

  it("returns null when neither a session nor a valid bearer token is present", async () => {
    await expect(resolveWebhookRouteCaller({})).resolves.toBeNull();
  });
});
