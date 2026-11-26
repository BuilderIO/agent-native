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
import { monitorForCaller, UNREADABLE_URL } from "./monitor-redaction";
import { getMonitor, saveMonitor } from "./uptime-monitors";

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

  it("does not carry the stored headers or body to a new URL", async () => {
    await saveMonitor(
      {
        id: "monitor-1",
        name: "Prod",
        url: "https://other.example.com/health",
      },
      ctx,
    );

    expect(fake.updates[0]).toMatchObject({
      url: "https://other.example.com/health",
      requestHeaders: "{}",
      requestBody: null,
      slackWebhookUrl: storedRow.slackWebhookUrl,
      webhookUrl: storedRow.webhookUrl,
    });
  });

  it("treats a reformatted URL as a new URL", async () => {
    await saveMonitor(
      {
        id: "monitor-1",
        name: "Prod",
        url: `${storedRow.url}/`,
      },
      ctx,
    );

    expect(fake.updates[0]).toMatchObject({
      requestHeaders: "{}",
      requestBody: null,
    });
  });

  it("uses the headers and body the caller sends with a new URL", async () => {
    await saveMonitor(
      {
        id: "monitor-1",
        name: "Prod",
        url: "https://other.example.com/health",
        requestHeaders: { Authorization: "Bearer new-bearer-fixture" },
        requestBody: "new-body-fixture",
      },
      ctx,
    );

    expect(fake.updates[0]).toMatchObject({
      requestHeaders: JSON.stringify({
        Authorization: "Bearer new-bearer-fixture",
      }),
      requestBody: "new-body-fixture",
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

describe("saveMonitor and the URL a non-UI caller was shown", () => {
  const keyedUrl = "https://api.example.com/health?api_key=secret123";
  const mcpCtx = { ...ctx, caller: "mcp" as const };
  const uiCtx = { ...ctx, caller: "frontend" as const };

  async function readAsAgent() {
    const found = await getMonitor("monitor-1", ctx);
    return monitorForCaller(found!.monitor, "mcp");
  }

  it("keeps the real URL, headers and body when the masked URL is sent back with a new name", async () => {
    fake.rows = new Map([[schema.monitors, [{ ...storedRow, url: keyedUrl }]]]);
    const shown = await readAsAgent();
    expect(shown.url).toBe("https://api.example.com/health?api_key=***");

    await saveMonitor(
      { id: "monitor-1", name: "Renamed", url: shown.url },
      mcpCtx,
    );

    expect(fake.updates[0]).toMatchObject({
      name: "Renamed",
      url: keyedUrl,
      requestHeaders: storedRow.requestHeaders,
      requestBody: "body-fixture",
    });
  });

  it("keeps the real URL when the stored URL could not be masked", async () => {
    fake.rows = new Map([
      [schema.monitors, [{ ...storedRow, url: "not a url" }]],
    ]);
    const shown = await readAsAgent();
    expect(shown.url).toBe(UNREADABLE_URL);

    await saveMonitor(
      { id: "monitor-1", name: "Renamed", url: shown.url },
      mcpCtx,
    );

    expect(fake.updates[0]).toMatchObject({
      name: "Renamed",
      url: "not a url",
      requestHeaders: storedRow.requestHeaders,
      requestBody: "body-fixture",
    });
  });

  it("still clears the headers and body for a different URL that looks masked", async () => {
    fake.rows = new Map([[schema.monitors, [{ ...storedRow, url: keyedUrl }]]]);

    await saveMonitor(
      {
        id: "monitor-1",
        name: "Prod",
        url: "https://other.example/health?api_key=***",
      },
      mcpCtx,
    );

    expect(fake.updates[0]).toMatchObject({
      url: "https://other.example/health?api_key=***",
      requestHeaders: "{}",
      requestBody: null,
    });
  });

  it("still treats a URL with nothing to mask as unchanged only when it is identical", async () => {
    await saveMonitor(
      { id: "monitor-1", name: "Renamed", url: storedRow.url },
      mcpCtx,
    );
    expect(fake.updates[0]).toMatchObject({
      url: storedRow.url,
      requestHeaders: storedRow.requestHeaders,
      requestBody: "body-fixture",
    });

    await saveMonitor(
      { id: "monitor-1", name: "Renamed", url: `${storedRow.url}?v=2` },
      mcpCtx,
    );
    expect(fake.updates[1]).toMatchObject({
      url: `${storedRow.url}?v=2`,
      requestHeaders: "{}",
      requestBody: null,
    });
  });

  it("keeps everything when the app UI saves the exact stored URL", async () => {
    fake.rows = new Map([[schema.monitors, [{ ...storedRow, url: keyedUrl }]]]);

    await saveMonitor(
      { id: "monitor-1", name: "Renamed", url: keyedUrl },
      uiCtx,
    );

    expect(fake.updates[0]).toMatchObject({
      name: "Renamed",
      url: keyedUrl,
      requestHeaders: storedRow.requestHeaders,
      requestBody: "body-fixture",
    });
  });

  it("lets the app UI remove the userinfo from a stored URL, as a real URL change", async () => {
    fake.rows = new Map([
      [
        schema.monitors,
        [
          {
            ...storedRow,
            url: "https://user:pass-fixture@api.example.com/health",
          },
        ],
      ],
    ]);

    await saveMonitor(
      { id: "monitor-1", name: "Prod", url: "https://api.example.com/health" },
      uiCtx,
    );

    expect(fake.updates[0]).toMatchObject({
      url: "https://api.example.com/health",
      requestHeaders: "{}",
      requestBody: null,
    });
  });

  it("does not read a masked URL from the app UI as unchanged", async () => {
    fake.rows = new Map([[schema.monitors, [{ ...storedRow, url: keyedUrl }]]]);

    await saveMonitor(
      {
        id: "monitor-1",
        name: "Prod",
        url: "https://api.example.com/health?api_key=***",
      },
      uiCtx,
    );

    expect(fake.updates[0]).toMatchObject({
      url: "https://api.example.com/health?api_key=***",
      requestHeaders: "{}",
      requestBody: null,
    });
  });

  it("does not read a masked URL as unchanged when no caller is given", async () => {
    fake.rows = new Map([[schema.monitors, [{ ...storedRow, url: keyedUrl }]]]);

    await saveMonitor(
      {
        id: "monitor-1",
        name: "Prod",
        url: "https://api.example.com/health?api_key=***",
      },
      ctx,
    );

    expect(fake.updates[0]).toMatchObject({
      url: "https://api.example.com/health?api_key=***",
      requestHeaders: "{}",
      requestBody: null,
    });
  });
});
