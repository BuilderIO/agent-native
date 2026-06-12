import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  body: undefined as unknown,
  setResponseStatus: vi.fn(),
  requireCredential: vi.fn(async () => null),
  runDemoPanel: vi.fn(async () => ({
    rows: [
      {
        timestamp: "2026-06-10T20:00:00.000Z",
        series: 'up{instance="demo:9100"}',
        value: 1,
      },
    ],
    schema: [
      { name: "timestamp", type: "string" },
      { name: "series", type: "string" },
      { name: "value", type: "number" },
    ],
  })),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  setResponseStatus: mocks.setResponseStatus,
}));

vi.mock("@agent-native/core/server", () => ({
  readBody: vi.fn(async () => mocks.body),
}));

vi.mock("../lib/credentials", () => ({
  requireCredential: mocks.requireCredential,
  runApiHandlerWithContext: (_event: unknown, fn: (ctx: any) => unknown) =>
    fn({ userEmail: "alice@example.com", orgId: null }),
}));

vi.mock("../lib/bigquery", () => ({
  runQuery: vi.fn(),
}));

vi.mock("../lib/google-analytics", () => ({
  runReport: vi.fn(),
}));

vi.mock("../lib/amplitude", () => ({
  getUserSegmentation: vi.fn(),
  queryEvents: vi.fn(),
}));

vi.mock("../lib/first-party-analytics", () => ({
  queryFirstPartyAnalytics: vi.fn(),
}));

vi.mock("../lib/prometheus", () => ({
  runPrometheusPanel: vi.fn(),
  serializePanelDescriptorInput: vi.fn((raw: unknown) =>
    typeof raw === "string" ? raw : JSON.stringify(raw),
  ),
}));

vi.mock("../lib/demo-source", () => ({
  runDemoPanel: mocks.runDemoPanel,
  serializeDemoDescriptorInput: vi.fn((raw: unknown) =>
    typeof raw === "string" ? raw : JSON.stringify(raw),
  ),
}));

const { handleSqlQuery } = await import("./sql-query");

describe("/api/sql-query demo source", () => {
  beforeEach(() => {
    mocks.body = undefined;
    mocks.setResponseStatus.mockClear();
    mocks.requireCredential.mockClear();
    mocks.runDemoPanel.mockClear();
    mocks.runDemoPanel.mockResolvedValue({
      rows: [
        {
          timestamp: "2026-06-10T20:00:00.000Z",
          series: 'up{instance="demo:9100"}',
          value: 1,
        },
      ],
      schema: [
        { name: "timestamp", type: "string" },
        { name: "series", type: "string" },
        { name: "value", type: "number" },
      ],
    });
  });

  it("runs valid demo descriptors without credential checks", async () => {
    mocks.body = {
      source: "demo",
      query: {
        promql: "up",
        mode: "instant",
      },
    };

    const result = (await handleSqlQuery({} as any)) as {
      rows: Record<string, unknown>[];
      schema: { name: string; type: string }[];
    };

    expect(mocks.requireCredential).not.toHaveBeenCalled();
    expect(mocks.runDemoPanel).toHaveBeenCalledWith(
      JSON.stringify({ promql: "up", mode: "instant" }),
    );
    expect(result.rows).toEqual([
      expect.objectContaining({
        timestamp: expect.any(String),
        series: expect.stringContaining('up{instance="demo:9100"'),
        value: 1,
      }),
    ]);
    expect(result.schema).toEqual([
      { name: "timestamp", type: "string" },
      { name: "series", type: "string" },
      { name: "value", type: "number" },
    ]);
  });

  it("rejects malformed demo descriptors", async () => {
    mocks.runDemoPanel.mockRejectedValueOnce(
      new Error("demo Prometheus panel sql must be a JSON object"),
    );
    mocks.body = {
      source: "demo",
      query: "not json",
    };

    const result = await handleSqlQuery({} as any);

    expect(mocks.setResponseStatus).toHaveBeenCalledWith({}, 400);
    expect(result).toEqual({
      error: expect.stringContaining(
        "demo Prometheus panel sql must be a JSON object",
      ),
    });
  });

  it("lists demo in invalid source errors", async () => {
    mocks.body = {
      source: "unknown",
      query: "SELECT 1",
    };

    const result = await handleSqlQuery({} as any);

    expect(mocks.setResponseStatus).toHaveBeenCalledWith({}, 400);
    expect(result).toEqual({
      error: expect.stringContaining("'demo'"),
    });
  });
});
