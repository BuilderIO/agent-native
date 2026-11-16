import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  rows: new Map<unknown, unknown[]>(),
  updates: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<Record<string, unknown>>,
}));

vi.mock("@agent-native/core/server", () => ({ recordChange: vi.fn() }));

vi.mock("../db/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/index.js")>();
  function select() {
    let table: unknown;
    const chain: Record<string, unknown> = {
      from: (next: unknown) => {
        table = next;
        return chain;
      },
      where: () => chain,
      orderBy: () => chain,
      groupBy: () => chain,
      limit: () => chain,
      then: (resolve: (rows: unknown[]) => unknown) =>
        Promise.resolve(fake.rows.get(table) ?? []).then(resolve),
    };
    return chain;
  }
  return {
    ...actual,
    getDb: () => ({
      select,
      update: () => ({
        set: (values: Record<string, unknown>) => {
          fake.updates.push(values);
          return { where: async () => ({}) };
        },
      }),
      insert: () => ({
        values: async (values: Record<string, unknown>) => {
          fake.inserts.push(values);
        },
      }),
    }),
  };
});

import { schema } from "../db/index.js";
import { saveMonitor } from "./uptime-monitors";

const ctx = { email: "owner@example.test", orgId: null };

const storedRow = {
  id: "monitor-1",
  name: "Prod",
  url: "https://api.example.com/health",
  method: "GET",
  requestHeaders: JSON.stringify({ Authorization: "Bearer bearer-fixture" }),
  requestBody: "body-fixture",
  intervalSeconds: 300,
  timeoutMs: 10_000,
  expectedStatus: JSON.stringify({ mode: "class", classes: ["2xx"] }),
  assertions: "[]",
  followRedirects: true,
  severity: "critical",
  channels: JSON.stringify(["inbox", "slack"]),
  emailRecipients: "[]",
  slackWebhookUrl: "https://hooks.example.test/services/slack-fixture",
  webhookUrl: "https://hooks.example.test/generic/webhook-fixture",
  cooldownMinutes: 15,
  enabled: true,
  ownerEmail: ctx.email,
  orgId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  fake.rows = new Map([[schema.monitors, [storedRow]]]);
  fake.updates = [];
  fake.inserts = [];
});

describe("saveMonitor keeps what callers cannot see", () => {
  it("keeps the stored headers, body and webhook URLs when an update leaves them out", async () => {
    await saveMonitor(
      {
        id: "monitor-1",
        name: "Prod",
        url: storedRow.url,
        intervalSeconds: 60,
      },
      ctx,
    );

    expect(fake.updates[0]).toMatchObject({
      intervalSeconds: 60,
      requestHeaders: storedRow.requestHeaders,
      requestBody: "body-fixture",
      slackWebhookUrl: storedRow.slackWebhookUrl,
      webhookUrl: storedRow.webhookUrl,
    });
  });

  it("clears them when the update says so", async () => {
    await saveMonitor(
      {
        id: "monitor-1",
        name: "Prod",
        url: storedRow.url,
        requestHeaders: {},
        requestBody: null,
        slackWebhookUrl: null,
        webhookUrl: null,
      },
      ctx,
    );

    expect(fake.updates[0]).toMatchObject({
      requestHeaders: "{}",
      requestBody: null,
      slackWebhookUrl: null,
      webhookUrl: null,
    });
  });

  it("does not invent headers for a new monitor", async () => {
    await saveMonitor({ name: "New", url: "https://api.example.com/new" }, ctx);

    expect(fake.inserts[0]).toMatchObject({
      requestHeaders: "{}",
      requestBody: null,
      slackWebhookUrl: null,
      webhookUrl: null,
    });
  });
});

describe("saveMonitor and URL credentials", () => {
  const withCredentials = "https://user:pass-fixture@api.example.com/health";

  it("refuses a new monitor whose URL has a username or password", async () => {
    await expect(
      saveMonitor({ name: "New", url: withCredentials }, ctx),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(fake.inserts).toEqual([]);
  });

  it("refuses an existing monitor moved to a URL with credentials", async () => {
    await expect(
      saveMonitor({ id: "monitor-1", name: "Prod", url: withCredentials }, ctx),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(fake.updates).toEqual([]);
  });

  it("still saves a monitor that already holds such a URL while the URL is unchanged", async () => {
    fake.rows = new Map([
      [schema.monitors, [{ ...storedRow, url: withCredentials }]],
    ]);

    await saveMonitor(
      {
        id: "monitor-1",
        name: "Prod",
        url: withCredentials,
        enabled: false,
      },
      ctx,
    );

    expect(fake.updates[0]).toMatchObject({
      url: withCredentials,
      enabled: false,
    });
  });
});
